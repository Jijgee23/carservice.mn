// P6-B3 — single-employee schedule write, mirroring
// `upsertEmployeeShiftAction`/`resetEmployeeShiftAction` in
// `app/_actions/employee-schedule.ts` (P6-B1's action wrapper): same
// `authorizeScheduleTarget` gate (employees.schedule + target-in-tenant),
// same cores, same audit summaries. Adapts the actions' FormData input to a
// JSON body.
//
// Contract:
//   PUT /api/v1/employee-schedules/[userId]
//     Permission: employees.schedule
//     Body: { scope: "date"|"weekday", date?: "YYYY-MM-DD", weekday?: Weekday,
//             isWorking: boolean, segments: [{branchId, startTime, endTime}] }
//     200 → { message, scope, date?, weekday? }
//     Errors:
//       401 (no code)
//       403 {error, code:"FORBIDDEN"}            — missing permission
//       404 {error, code:"NOT_FOUND"}             — target not in tenant
//       400 {error, code:"VALIDATION", fieldErrors?} — bad scope/date/weekday/segments
//
//   DELETE /api/v1/employee-schedules/[userId]?scope=date&date=YYYY-MM-DD
//          /api/v1/employee-schedules/[userId]?scope=weekday&weekday=MON
//     Permission: employees.schedule
//     200 → { scope }
//     Errors: 401, 403 {code:"FORBIDDEN"}, 404 {code:"NOT_FOUND"}, 400 {code:"VALIDATION"}
import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { hasPermission } from "@/lib/auth/roles";
import {
  authorizeScheduleTarget,
  resetEmployeeShiftCommand,
  upsertEmployeeShiftCommand,
} from "@/lib/employee-schedule-commands";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

// Body carries `segments` as a structured array; the core still takes a JSON
// string (`segmentsJson`) — matching the web action's FormData contract
// without changing the core (see task instructions: adapt at the edge).
function segmentsToJson(value: unknown): string {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ userId: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "employees.schedule");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const { userId } = await ctx.params;

  const authorized = await authorizeScheduleTarget(prisma, {
    hasSchedulePermission: hasPermission(auth.user, "employees.schedule"),
    tenantId: auth.user.tenantId,
    userId,
  });
  if (!authorized.ok) {
    return jsonError(authorized.code === "FORBIDDEN" ? 403 : 404, authorized.message, { code: authorized.code });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.", { code: "VALIDATION" });
  }
  if (!body || typeof body !== "object") {
    return jsonError(400, "Body буруу.", { code: "VALIDATION" });
  }
  const { scope, date, weekday, isWorking, segments } = body as Record<string, unknown>;

  const result = await upsertEmployeeShiftCommand(prisma, {
    tenantId: auth.user.tenantId,
    userId,
    scope: typeof scope === "string" ? scope : "",
    isWorking: isWorking === true,
    segmentsJson: segmentsToJson(segments),
    date: typeof date === "string" ? date : "",
    weekday: typeof weekday === "string" ? weekday : "",
  });

  if (!result.ok) {
    const status = result.code === "VALIDATION" ? 400 : result.code === "FORBIDDEN" ? 403 : 404;
    return jsonError(status, "message" in result && result.message ? result.message : "Алдаа гарлаа.", {
      code: result.code,
      ...("fieldErrors" in result && result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
    });
  }

  const summary =
    result.scope === "date"
      ? `${authorized.target.lastName} ${authorized.target.firstName} — ажлын хувиар, тусгай өдөр (${result.date})`
      : `${authorized.target.lastName} ${authorized.target.firstName} — ажлын хувиар, ${result.weekday} гараг`;
  await logAudit({
    tenantId: auth.user.tenantId,
    userId: auth.user.id,
    entity: "User",
    entityId: userId,
    action: "UPDATE",
    summary,
  });

  return jsonOk({ message: result.message, scope: result.scope, date: result.date, weekday: result.weekday });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ userId: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "employees.schedule");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const { userId } = await ctx.params;

  const authorized = await authorizeScheduleTarget(prisma, {
    hasSchedulePermission: hasPermission(auth.user, "employees.schedule"),
    tenantId: auth.user.tenantId,
    userId,
  });
  if (!authorized.ok) {
    return jsonError(authorized.code === "FORBIDDEN" ? 403 : 404, authorized.message, { code: authorized.code });
  }

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "";
  const date = url.searchParams.get("date") ?? "";
  const weekday = url.searchParams.get("weekday") ?? "";

  const result = await resetEmployeeShiftCommand(prisma, { userId, scope, date, weekday });
  if (!result.ok) {
    return jsonError(400, "Огноо эсвэл гараг буруу байна.", { code: result.code });
  }

  await logAudit({
    tenantId: auth.user.tenantId,
    userId: auth.user.id,
    entity: "User",
    entityId: userId,
    action: "DELETE",
    summary: `${authorized.target.lastName} ${authorized.target.firstName} — ажлын хувиарын override арилгав`,
  });

  return jsonOk({ scope: result.scope });
}
