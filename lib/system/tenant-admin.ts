// System ажилтан/админ харилцагч (tenant)-ийн МЭДЭЭЛЭЛ ЗАСАХ цөм. Эрхийг (tenants.edit) дуудагч шалгасан байх ёстой.
//
// Засах хүрээ: нэр, регистр, имэйл, утас 1/2, онлайн цаг захиалга хүлээн авах эсэх, Үндсэн салбарын утас/хаяг/байршил.
// ЗАСАХГҮЙ: эзний (User) нэвтрэх утас/имэйл — эзэн өөрөө профайлаасаа солино; багц, зээл, төлбөр, касс тохиргоо.
// PATCH семантик: ирээгүй талбар өөрчлөгдөхгүй; имэйл/phone2/салбарын текст талбарыг "" эсвэл null-оор цэвэрлэнэ.
// Өөрчлөлт бүр before/after-тэй SystemAuditLog-д бичигдэнэ.

import { Prisma } from "@/app/generated/prisma/client";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { isFeatureEnabled } from "@/lib/plan-limits-server";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { prisma, withBookingTransaction } from "@/lib/prisma";
import { logSystemAudit } from "@/lib/system/audit";
import { validateTenantProfile } from "@/lib/tenant-settings";

export type FieldErrors = Record<string, string>;

export type TenantEditState = {
  name: string;
  registerNumber: string;
  email: string | null;
  phone1: string;
  phone2: string | null;
  acceptsOnlineBooking: boolean;
  requireCashSession: boolean;
  branch: BranchEditState | null;
};

export type BranchEditState = {
  id: string;
  phone: string | null;
  city: string | null;
  district: string | null;
  khoroo: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type TenantPatch = {
  profile: Partial<Pick<TenantEditState, "name" | "registerNumber" | "email" | "phone1" | "phone2" | "acceptsOnlineBooking">>;
  branch: Partial<Omit<BranchEditState, "id">>;
};

const BRANCH_TEXT_FIELDS = ["city", "district", "khoroo", "address"] as const;
const BRANCH_TEXT_MAX = 200;
const PROFILE_TEXT_FIELDS = ["name", "registerNumber", "email", "phone1", "phone2"] as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Body-г PATCH болгон задална (DB-д хандахгүй). Төрлийн алдаа → fieldErrors. Хоосон patch → алдаа. */
export function parseTenantPatch(body: unknown): { ok: true; patch: TenantPatch } | { ok: false; fieldErrors: FieldErrors } {
  const fieldErrors: FieldErrors = {};
  const patch: TenantPatch = { profile: {}, branch: {} };
  if (!isObj(body)) return { ok: false, fieldErrors: { _: "Body буруу." } };

  // phone нь signup-ийн нэршилтэй нийцүүлж phone1-ийн alias.
  const raw: Record<string, unknown> = { ...body };
  if (raw.phone1 === undefined && raw.phone !== undefined) raw.phone1 = raw.phone;

  for (const k of PROFILE_TEXT_FIELDS) {
    const v = raw[k];
    if (v === undefined) continue;
    if (v === null && (k === "email" || k === "phone2")) {
      patch.profile[k] = null;
      continue;
    }
    if (typeof v !== "string") {
      fieldErrors[k] = "Текст байх ёстой.";
      continue;
    }
    // Хоосон имэйл/phone2 = цэвэрлэх; бусад талбар хоосон бол validateTenantProfile алдаа өгнө.
    if ((k === "email" || k === "phone2") && v.trim() === "") patch.profile[k] = null;
    else patch.profile[k] = v.trim();
  }
  if (raw.acceptsOnlineBooking !== undefined) {
    if (typeof raw.acceptsOnlineBooking !== "boolean") fieldErrors.acceptsOnlineBooking = "true эсвэл false байх ёстой.";
    else patch.profile.acceptsOnlineBooking = raw.acceptsOnlineBooking;
  }

  if (raw.branch !== undefined) {
    if (!isObj(raw.branch)) {
      fieldErrors.branch = "Объект байх ёстой.";
    } else {
      const b = raw.branch;
      for (const k of BRANCH_TEXT_FIELDS) {
        const v = b[k];
        if (v === undefined) continue;
        if (v === null) patch.branch[k] = null;
        else if (typeof v !== "string") fieldErrors[`branch.${k}`] = "Текст байх ёстой.";
        else if (v.trim().length > BRANCH_TEXT_MAX) fieldErrors[`branch.${k}`] = `${BRANCH_TEXT_MAX} тэмдэгтээс ихгүй байх ёстой.`;
        else patch.branch[k] = v.trim() || null;
      }
      if (b.phone !== undefined) {
        if (b.phone === null || (typeof b.phone === "string" && b.phone.trim() === "")) patch.branch.phone = null;
        else if (typeof b.phone !== "string" || !isValidPhone(b.phone.trim())) fieldErrors["branch.phone"] = "Утасны дугаар 8 оронтой тоо байх ёстой.";
        else patch.branch.phone = normalizePhone(b.phone.trim());
      }
      // Байршил: өргөрөг, уртраг хоёул хамт (эсвэл хоёул null-оор цэвэрлэнэ).
      const hasLat = b.latitude !== undefined;
      const hasLng = b.longitude !== undefined;
      if (hasLat !== hasLng) {
        fieldErrors["branch.latitude"] = "Өргөрөг, уртрагийг хамт оруулна уу.";
      } else if (hasLat && hasLng) {
        if (b.latitude === null && b.longitude === null) {
          patch.branch.latitude = null;
          patch.branch.longitude = null;
        } else if (
          typeof b.latitude !== "number" ||
          typeof b.longitude !== "number" ||
          !Number.isFinite(b.latitude) ||
          !Number.isFinite(b.longitude) ||
          Math.abs(b.latitude) > 90 ||
          Math.abs(b.longitude) > 180
        ) {
          fieldErrors["branch.latitude"] = "Байршил буруу (өргөрөг ±90, уртраг ±180 тоо).";
        } else {
          patch.branch.latitude = b.latitude;
          patch.branch.longitude = b.longitude;
        }
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  if (Object.keys(patch.profile).length === 0 && Object.keys(patch.branch).length === 0) {
    return { ok: false, fieldErrors: { _: "Өөрчлөх талбар алга." } };
  }
  return { ok: true, patch };
}

type Db = Pick<typeof prisma, "tenant" | "branch">;

const CURRENT_SELECT = {
  name: true,
  registerNumber: true,
  email: true,
  phone1: true,
  phone2: true,
  acceptsOnlineBooking: true,
  requireCashSession: true,
  branches: {
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    take: 1,
    select: { id: true, phone: true, city: true, district: true, khoroo: true, address: true, latitude: true, longitude: true },
  },
} satisfies Prisma.TenantSelect;

export async function loadTenantEditState(id: string, db: Db = prisma): Promise<TenantEditState | null> {
  const t = await db.tenant.findUnique({ where: { id }, select: CURRENT_SELECT });
  if (!t) return null;
  const { branches, ...rest } = t;
  return { ...rest, branch: branches[0] ?? null };
}

export type TenantEditResult =
  | { ok: true; changed: boolean; before: Record<string, unknown>; after: Record<string, unknown> }
  | { ok: false; status: 404 | 409 | 422 | 403 | 500; code: "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "PLAN" | "SERVER_ERROR"; message: string; fieldErrors?: FieldErrors };

const firstMessage = (fe: FieldErrors) => Object.values(fe)[0] ?? "Оруулсан мэдээлэл буруу.";

/** before/after-д зөвхөн өөрчлөгдсөн түлхүүрүүд (аудит жижиг, уншигдахуйц). */
function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    if (before[k] !== after[k]) {
      b[k] = before[k] ?? null;
      a[k] = after[k] ?? null;
    }
  }
  return { before: b, after: a };
}

export async function updateTenantBySystem(
  input: { tenantId: string; adminId: string; body: unknown; req?: Request },
  deps: { audit: typeof logSystemAudit } = { audit: logSystemAudit },
): Promise<TenantEditResult> {
  const parsed = parseTenantPatch(input.body);
  if (!parsed.ok) return { ok: false, status: 422, code: "VALIDATION", message: firstMessage(parsed.fieldErrors), fieldErrors: parsed.fieldErrors };
  const { patch } = parsed;

  const current = await loadTenantEditState(input.tenantId);
  if (!current) return { ok: false, status: 404, code: "NOT_FOUND", message: "Байгууллага олдсонгүй." };

  if (Object.keys(patch.branch).length > 0 && !current.branch) {
    return { ok: false, status: 422, code: "VALIDATION", message: "Үндсэн салбар олдсонгүй.", fieldErrors: { branch: "Үндсэн салбар олдсонгүй." } };
  }

  // Одоогийн төлөв дээр patch-ийг давхарлаж, самбарын (tenant) validator-ыг дахин ашиглана → нэг дүрэм.
  const merged = { ...current, ...patch.profile };
  const validated = validateTenantProfile({
    name: merged.name,
    registerNumber: merged.registerNumber,
    email: merged.email ?? "",
    phone1: merged.phone1,
    phone2: merged.phone2 ?? "",
    acceptsOnlineBooking: merged.acceptsOnlineBooking,
    requireCashSession: current.requireCashSession, // System талаас өөрчлөхгүй
  });
  if (!validated.ok) {
    const fe = validated.fieldErrors ?? {};
    return { ok: false, status: 422, code: "VALIDATION", message: firstMessage(fe), fieldErrors: fe };
  }
  const data = validated.data;

  // Давхцал (өөрийг нь хасч). Нэр DB-д unique биш ч бүртгэлтэй ижил сануулга.
  const conflicts: FieldErrors = {};
  if (data.name !== current.name) {
    const nameClash = await prisma.tenant.findFirst({ where: { name: data.name, id: { not: input.tenantId } }, select: { id: true } });
    if (nameClash) conflicts.name = "Энэ нэртэй байгууллага аль хэдийн бүртгэлтэй байна. Өөр нэр сонгоно уу.";
  }
  if (data.registerNumber !== current.registerNumber) {
    const c = await prisma.tenant.findFirst({ where: { registerNumber: data.registerNumber, id: { not: input.tenantId } }, select: { id: true } });
    if (c) conflicts.registerNumber = "Энэ регистр өөр байгууллагад ашиглагдсан байна.";
  }
  if (data.email && data.email !== current.email) {
    const c = await prisma.tenant.findFirst({ where: { email: data.email, id: { not: input.tenantId } }, select: { id: true } });
    if (c) conflicts.email = "Энэ имэйл өөр байгууллагад ашиглагдсан байна.";
  }
  if (Object.keys(conflicts).length > 0) return { ok: false, status: 409, code: "CONFLICT", message: firstMessage(conflicts), fieldErrors: conflicts };

  // Онлайн цаг захиалгыг ШИНЭЭР асаахад л багцын шалгалт (аль хэдийн асаалттай бол бусад засварыг хаахгүй).
  if (data.acceptsOnlineBooking && !current.acceptsOnlineBooking) {
    const allowed = await isFeatureEnabled(input.tenantId, PLAN_LIMIT_CODES.ENABLE_APPOINTMENTS);
    if (!allowed) {
      return { ok: false, status: 403, code: "PLAN", message: "Энэ байгууллагын багц онлайн цаг захиалгыг дэмжихгүй байна." };
    }
  }

  const tenantAfter = {
    name: data.name,
    registerNumber: data.registerNumber,
    email: data.email,
    phone1: data.phone1,
    phone2: data.phone2,
    acceptsOnlineBooking: data.acceptsOnlineBooking,
  };
  const tenantBefore = {
    name: current.name,
    registerNumber: current.registerNumber,
    email: current.email,
    phone1: current.phone1,
    phone2: current.phone2,
    acceptsOnlineBooking: current.acceptsOnlineBooking,
  };
  const tenantDiff = diff(tenantBefore, tenantAfter);

  let branchDiff = { before: {} as Record<string, unknown>, after: {} as Record<string, unknown> };
  if (current.branch && Object.keys(patch.branch).length > 0) {
    const { id: _id, ...branchBefore } = current.branch;
    void _id;
    branchDiff = diff(branchBefore, { ...branchBefore, ...patch.branch });
  }

  const tenantChanged = Object.keys(tenantDiff.after).length > 0;
  const branchChanged = Object.keys(branchDiff.after).length > 0;
  const before = { ...tenantDiff.before, ...(branchChanged ? { branch: branchDiff.before } : {}) };
  const after = { ...tenantDiff.after, ...(branchChanged ? { branch: branchDiff.after } : {}) };
  if (!tenantChanged && !branchChanged) return { ok: true, changed: false, before, after };

  try {
    // ЖИНХЭНЭ transaction: tenant + салбар хамт бичигдэнэ эсвэл хамт буцна (prisma.$transaction extension-тэй rollback хийдэггүй).
    await withBookingTransaction(input.tenantId, async (tx) => {
      if (tenantChanged) await tx.tenant.update({ where: { id: input.tenantId }, data: tenantDiff.after });
      if (branchChanged && current.branch) await tx.branch.update({ where: { id: current.branch.id }, data: branchDiff.after });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = (e.meta?.target as string[] | undefined)?.join(",") ?? "";
      const fe: FieldErrors = target.includes("registerNumber")
        ? { registerNumber: "Энэ регистр өөр байгууллагад ашиглагдсан байна." }
        : target.includes("email")
          ? { email: "Энэ имэйл өөр байгууллагад ашиглагдсан байна." }
          : { _: "Давхардсан утга." };
      return { ok: false, status: 409, code: "CONFLICT", message: firstMessage(fe), fieldErrors: fe };
    }
    console.warn("[system-tenant-edit] failed:", e instanceof Error ? e.name : e);
    return { ok: false, status: 500, code: "SERVER_ERROR", message: "Шинэчлэх явцад алдаа гарлаа." };
  }

  await deps.audit({
    adminId: input.adminId,
    tenantId: input.tenantId,
    entity: "Tenant",
    entityId: input.tenantId,
    action: "UPDATE",
    summary: `${data.name} · мэдээлэл шинэчлэв (System ажилтан): ${[...Object.keys(tenantDiff.after), ...(branchChanged ? ["салбар"] : [])].join(", ")}`,
    before: before as Prisma.InputJsonValue,
    after: after as Prisma.InputJsonValue,
    req: input.req,
  });
  return { ok: true, changed: true, before, after };
}
