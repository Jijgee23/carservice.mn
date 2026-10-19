// Contract — POST /api/v1/employees/[id]/reset-password (P6-B2)
//
// Permission: employees.edit (matches the web's
// `resetEmployeePasswordAction`, authorized with `canEdit(me, "employees")`).
// Requires an active subscription. No body.
// Never generates or returns a password — it only invalidates the
// employee's current credential, sending them back through
// OTP+set-new-password on next login, exactly like the web action (see
// `lib/employees/core.ts`'s `resetEmployeePassword` doc comment).
// 200: { employee: { id } }
// Errors: 401, 403 (permission / SUBSCRIPTION_EXPIRED), 404 (NOT_FOUND —
// also covers the core's silent noop), 409 (SELF_ACTION) — `{error, code}`.

import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { resetEmployeePassword } from "@/lib/employees/core";
import type { EmployeeActor } from "@/lib/employees/types";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "employees.edit");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const { id } = await ctx.params;
  const actor: EmployeeActor = auth.user;

  const fd = new FormData();
  fd.set("id", id);

  const result = await resetEmployeePassword(prisma, actor, fd);
  if ("noop" in result) return jsonError(404, "Ажилтан олдсонгүй.", { code: "NOT_FOUND" });
  if (!result.ok) {
    return jsonError(result.code === "OWNER_ONLY" ? 403 : 409, result.error, { code: result.code });
  }

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "User",
    entityId: result.id,
    action: "UPDATE",
    summary: result.summary,
  });

  return jsonOk({ employee: { id: result.id } });
}
