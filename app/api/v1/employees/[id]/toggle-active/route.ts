// Contract — POST /api/v1/employees/[id]/toggle-active (P6-B2)
//
// Permission: employees.edit (matches the web's `toggleEmployeeActiveAction`,
// which authorizes with `canEdit(me, "employees")` — this is an edit
// action, not a separate one). Requires an active subscription.
// Body: { isActive: boolean } — the desired next state (mirrors the web
// form's checkbox semantics: absent/false means "off").
// 200: { employee: { id, isActive } }
// Errors: 401, 403 (permission / SUBSCRIPTION_EXPIRED), 404 (NOT_FOUND —
// also returned for the core's silent id-not-found "noop", since an API
// caller has no page to silently no-op on), 409 (SELF_DEACTIVATE /
// LAST_OWNER) — always `{error, code}`.

import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { toggleEmployeeActive } from "@/lib/employees/core";
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

  let body: { isActive?: unknown };
  try {
    body = (await req.json()) as { isActive?: unknown };
  } catch {
    return jsonError(400, "JSON body шаардлагатай.", { code: "VALIDATION" });
  }

  const actor: EmployeeActor = auth.user;
  const fd = new FormData();
  fd.set("id", id);
  if (body?.isActive === true) fd.set("isActive", "on");

  const result = await toggleEmployeeActive(prisma, actor, fd);
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
    before: result.before,
    after: result.after,
  });

  return jsonOk({ employee: { id: result.id, isActive: result.after.isActive } });
}
