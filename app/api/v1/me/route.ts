// Contract — GET/PATCH /api/v1/me (P8-B1)
//
// GET    unchanged (pre-existing).
// PATCH  Auth: any authenticated user, acts on `auth.user.id` only.
//        Body (JSON): { firstName, lastName, email, phone } — whole-record,
//        all four required (matches the web profile form / `PATCH
//        /api/v1/employees/[id]`'s whole-record convention). Delegates to
//        `lib/account/profile.ts`'s `updateProfile` — same validation,
//        P2002 field-error mapping and audit summary ("Профайл шинэчлэв")
//        as `updateProfileAction`.
//        200: same shape as GET (id/email/firstName/lastName/phone/isOwner/
//        role/tenant/branch).
//        Errors: 400 (bad JSON), 401, 422 { error, code: "VALIDATION",
//        fieldErrors } (invalid field or duplicate email/phone).

import { jsonError, jsonOk, requireApiUser } from "@/lib/api";
import { EFFECTIVE_ROLE_SELECT, resolveEffectiveRole } from "@/lib/auth/load-effective";
import { logAudit } from "@/lib/audit";
import { updateProfile } from "@/lib/account/profile";
import { prisma } from "@/lib/prisma";

async function buildMeResponse(userId: string, tenantId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      isOwner: true,
      branchId: true,
      deniedPermissions: true,
      role: {
        select: EFFECTIVE_ROLE_SELECT,
      },
    },
  });
  if (!user) return null;
  // ҮР ДҮНТЭЙ эрх (GET /me-тэй ижил) — tenant context requireApiUser-аар тавигдсан.
  const role = await resolveEffectiveRole({
    isOwner: user.isOwner,
    tenantId,
    deniedPermissions: user.deniedPermissions,
    role: user.role,
  });

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, slug: true, logoUrl: true },
  });
  const branch = user.branchId
    ? await prisma.branch.findUnique({
        where: { id: user.branchId },
        select: { id: true, name: true },
      })
    : null;

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    isOwner: user.isOwner,
    role: role ? { id: role.id, name: role.name, permissions: role.permissions } : null,
    tenant,
    branch,
  };
}

export async function PATCH(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Body нь JSON байх ёстой.");
  }
  if (!body || typeof body !== "object") {
    return jsonError(400, "firstName, lastName, email, phone шаардлагатай.");
  }
  const { firstName, lastName, email, phone } = body as Record<string, unknown>;
  const toStr = (v: unknown) => (typeof v === "string" ? v : "");

  const result = await updateProfile(
    prisma,
    { id: auth.user.id, tenantId: auth.user.tenantId },
    {
      firstName: toStr(firstName),
      lastName: toStr(lastName),
      email: toStr(email),
      phone: toStr(phone),
    },
  );

  if (!result.ok) {
    if (result.fieldErrors) {
      return jsonError(422, "Талбарын алдаа.", {
        code: "VALIDATION",
        fieldErrors: result.fieldErrors,
      });
    }
    return jsonError(422, result.message ?? "Алдаа гарлаа.", { code: "VALIDATION" });
  }

  await logAudit({
    tenantId: auth.user.tenantId,
    userId: auth.user.id,
    entity: "User",
    entityId: auth.user.id,
    action: "UPDATE",
    summary: "Профайл шинэчлэв",
    after: result.data,
  });

  const me = await buildMeResponse(auth.user.id, auth.user.tenantId);
  return jsonOk(me);
}

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;

  const tenant = await prisma.tenant.findUnique({
    where: { id: auth.user.tenantId },
    select: { id: true, name: true, slug: true, logoUrl: true },
  });
  const branch = auth.user.branchId
    ? await prisma.branch.findUnique({
        where: { id: auth.user.branchId },
        select: { id: true, name: true },
      })
    : null;

  return jsonOk({
    id: auth.user.id,
    email: auth.user.email,
    firstName: auth.user.firstName,
    lastName: auth.user.lastName,
    phone: auth.user.phone,
    isOwner: auth.user.isOwner,
    role: auth.user.role
      ? {
          id: auth.user.role.id,
          name: auth.user.role.name,
          permissions: auth.user.role.permissions,
        }
      : null,
    tenant,
    branch,
  });
}
