import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { SUBSCRIPTION_LOCKED_MESSAGE } from "@/lib/subscription";
import {
  AppointmentCommandError,
  STAFF_SCOPE_MESSAGES,
  confirmAppointmentCommand,
} from "@/lib/appointments/appointment-commands";

/**
 * `assertStaffScope`/`assertActiveSubscription` inside the P2-B1 command
 * throw a plain `Error` for permission/branch/subscription rejection (not
 * `AppointmentCommandError`) — mirrors `knownAuthorizationMessage` handling
 * in `app/_actions/appointments.ts` for the same command.
 */
function commandErrorResponse(error: unknown) {
  if (error instanceof AppointmentCommandError) {
    return jsonError(error.status, error.message, {
      code: error.code,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    });
  }
  if (error instanceof Error && (STAFF_SCOPE_MESSAGES as readonly string[]).includes(error.message)) {
    return jsonError(403, error.message);
  }
  if (error instanceof Error && error.message === SUBSCRIPTION_LOCKED_MESSAGE) {
    return jsonError(403, error.message, { code: "SUBSCRIPTION_EXPIRED" });
  }
  console.error("[appointments/confirm]", error instanceof Error ? error.name : "UnknownError");
  return jsonError(500, "Серверийн алдаа гарлаа. Дахин оролдоно уу.");
}

/**
 * POST /api/v1/appointments/[id]/confirm
 * Permission: appointments.edit
 * Thin adapter over the P2-B1 `confirmAppointmentCommand` — the same command
 * `app/_actions/appointments.ts`'s `confirmAppointmentAction` calls. All
 * transition/scope/subscription rules and the CONFIRMED account→customer
 * resolve + vehicle snapshot live in that one shared command, not here.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "appointments.edit");
  if (denied) return denied;

  const { id } = await ctx.params;

  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;

  // QA #28: body is optional, but a master-less appointment needs a master to
  // be confirmed: send `assignedToId` (string), or omit it when the caller
  // lacks orders.assign (they become the master). Otherwise 422
  // ASSIGNEE_REQUIRED. `null` never clears a stored master (422).
  let assignedToId: string | null | undefined;
  const raw = await req.text();
  if (raw.trim()) {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonError(400, "JSON body буруу байна.");
    }
    const value = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).assignedToId
      : undefined;
    if (value !== undefined && value !== null && typeof value !== "string") {
      return jsonError(400, "assignedToId нь string эсвэл null байна.");
    }
    assignedToId = typeof value === "string" ? value.trim() || null : value;
  }

  try {
    const result = await confirmAppointmentCommand({
      actor: { ...auth.user, workingBranchId: scopeResult.branchId ?? undefined },
      appointmentId: id,
      ...(assignedToId !== undefined ? { assignedToId } : {}),
    });
    return jsonOk({ ok: true, appointmentId: result.appointmentId, status: "CONFIRMED" });
  } catch (error) {
    return commandErrorResponse(error);
  }
}
