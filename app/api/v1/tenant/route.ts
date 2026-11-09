// Contract — GET/PATCH /api/v1/tenant (байгууллагын тохиргоо)
//
// GET /api/v1/tenant
//   Эрх: нэвтэрсэн бүх ажилтан. Вэбийн /dashboard/settings хуудас layout-аараа
//   зөвхөн эзэмшигчид нээлттэй (бусдыг /dashboard/profile руу чиглүүлдэг) ч
//   permission code байхгүй, мэдээлэл нь (нэр, регистр, холбоо барих, лого)
//   нэхэмжлэх/баримт дээр ч харагддаг тул уншихыг бүх ажилтанд зөвшөөрнө;
//   засах эрхийг `canEdit` (= isOwner)-аар мэдэгдэнэ.
//   200: { tenant: TenantDto, modules: { onlineBooking, appointments }, canEdit }
//
// PATCH /api/v1/tenant
//   Зөвхөн эзэмшигч (`auth.user.isOwner`) — app/_actions/tenant.ts-ийн
//   `authorizeOwner()`-тэй адил. Хэсэгчилсэн шинэчлэл: ирсэн талбарыг
//   одоогийн утгатай нэгтгээд вэбийн `updateTenantAction`-ийн шалгалтыг
//   бүтнээр нь ажиллуулна (lib/tenant-settings.ts).
//   Body (бүгд optional, дор хаяж 1):
//     name, registerNumber, phone1: string
//     email, phone2: string | null   (хоосон/null → арилгана)
//     acceptsOnlineBooking, requireCashSession: boolean
//     appointmentReminderLeadMinutes: integer (60-ийн үржвэр, 60..10080)
//       — вэбийн `updateAppointmentReminderLeadAction` (хоног+цаг).
//   200: GET-тэй ижил хэлбэр (шинэчлэгдсэн утгаар).
//   Алдаа: 400 VALIDATION {fieldErrors}, 401, 403 (эзэмшигч биш, эсвэл
//   MODULE_DISABLED — багц онлайн цаг захиалгыг дэмжихгүй), 409 CONFLICT
//   {fieldErrors} (нэр/регистр/имэйл давхцал).

import { jsonError, jsonForbidden, jsonOk, requireApiUser } from "@/lib/api";
import type { ApiUser } from "@/lib/auth/api-token";
import { MODULE_DISABLED_CODE } from "@/lib/plan-modules";
import { getEnabledModules } from "@/lib/plan-modules-server";
import { prisma } from "@/lib/prisma";
import {
  checkTenantProfile,
  saveReminderLead,
  saveTenantProfile,
  type TenantSettingsFailure,
  validateReminderLead,
  validateTenantProfile,
} from "@/lib/tenant-settings";

const TENANT_SELECT = {
  id: true,
  name: true,
  registerNumber: true,
  email: true,
  phone1: true,
  phone2: true,
  logoUrl: true,
  acceptsOnlineBooking: true,
  requireCashSession: true,
  appointmentReminderLeadMinutes: true,
  slug: true,
  plan: true,
  createdAt: true,
  creditScore: true,
  creditBreakdown: true,
  creditUpdatedAt: true,
  creditHidden: true,
  creditSuspended: true,
} as const;

async function loadTenant(tenantId: string) {
  return await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: TENANT_SELECT,
  });
}

async function buildResponse(user: ApiUser) {
  const t = await loadTenant(user.tenantId);
  if (!t) return jsonError(404, "Байгууллага олдсонгүй.", { code: "NOT_FOUND" });
  const modules = await getEnabledModules(user.tenantPlan);
  const { creditHidden, creditSuspended, ...rest } = t;
  return jsonOk({
    tenant: {
      ...rest,
      // Вэбийн CreditScoreCard-ийн `blocked`-тэй адил.
      creditBlocked: creditSuspended ? "suspended" : creditHidden ? "hidden" : null,
    },
    modules: {
      onlineBooking: modules.has("online_booking"),
      appointments: modules.has("enable_appointments"),
    },
    canEdit: user.isOwner,
  });
}

function failureResponse(f: TenantSettingsFailure) {
  const fieldErrors = f.fieldErrors ?? {};
  const first = f.message ?? Object.values(fieldErrors)[0] ?? "Алдаа гарлаа.";
  switch (f.kind) {
    case "VALIDATION":
      return jsonError(400, first, { code: "VALIDATION", fieldErrors });
    case "CONFLICT":
      return jsonError(409, first, { code: "CONFLICT", fieldErrors });
    case "PLAN":
      return jsonError(403, first, {
        code: MODULE_DISABLED_CODE,
        fieldErrors: { acceptsOnlineBooking: first },
      });
    default:
      console.error("[api/v1/tenant PATCH]", f.message);
      return jsonError(500, "Шинэчлэх явцад алдаа гарлаа.");
  }
}

const STRING_FIELDS = ["name", "registerNumber", "phone1"] as const;
const NULLABLE_STRING_FIELDS = ["email", "phone2"] as const;
const BOOLEAN_FIELDS = ["acceptsOnlineBooking", "requireCashSession"] as const;
const LEAD_FIELD = "appointmentReminderLeadMinutes";
const PROFILE_FIELDS = [...STRING_FIELDS, ...NULLABLE_STRING_FIELDS, ...BOOLEAN_FIELDS];
const ALLOWED_FIELDS = new Set<string>([...PROFILE_FIELDS, LEAD_FIELD]);

function validationError(field: string, message: string) {
  return jsonError(400, message, { code: "VALIDATION", fieldErrors: { [field]: message } });
}

/**
 * GET /api/v1/tenant — байгууллагын тохиргооны мэдээлэл (лого, үндсэн
 * мэдээлэл, сануулгын хугацаа, credit, slug/багц). Нэвтэрсэн бүх ажилтан.
 */
export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  return await buildResponse(auth.user);
}

/**
 * PATCH /api/v1/tenant — үндсэн мэдээлэл ба/эсвэл цаг захиалгын сануулгын
 * хугацааг шинэчилнэ. Зөвхөн эзэмшигч. Бүх шалгалт бичихээс өмнө хийгдэнэ.
 */
export async function PATCH(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!auth.user.isOwner) return jsonForbidden("Зөвхөн админ тохиргоог өөрчилнө.");

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "Буруу өгөгдөл");
  }
  const input = body as Record<string, unknown>;

  // Төрлийн шалгалт.
  const typeErrors: Record<string, string> = {};
  for (const key of Object.keys(input)) {
    if (!ALLOWED_FIELDS.has(key)) typeErrors[key] = "Тодорхойгүй талбар.";
  }
  for (const key of STRING_FIELDS) {
    if (key in input && typeof input[key] !== "string")
      typeErrors[key] = "Текст утга байх ёстой.";
  }
  for (const key of NULLABLE_STRING_FIELDS) {
    if (key in input && input[key] !== null && typeof input[key] !== "string")
      typeErrors[key] = "Текст эсвэл null байх ёстой.";
  }
  for (const key of BOOLEAN_FIELDS) {
    if (key in input && typeof input[key] !== "boolean")
      typeErrors[key] = "true/false утга байх ёстой.";
  }
  if (Object.keys(typeErrors).length > 0) {
    return jsonError(400, Object.values(typeErrors)[0], {
      code: "VALIDATION",
      fieldErrors: typeErrors,
    });
  }

  const profileTouched = PROFILE_FIELDS.some((k) => k in input);
  const leadTouched = LEAD_FIELD in input;
  if (!profileTouched && !leadTouched) {
    return jsonError(400, "Шинэчлэх талбар илгээнэ үү.", { code: "VALIDATION", fieldErrors: {} });
  }

  // Сануулгын хугацаа: минутыг вэбийн хоног+цаг руу задлаад адил шалгалтаар.
  let lead: { days: number; hours: number; minutes: number } | null = null;
  if (leadTouched) {
    const raw = input[LEAD_FIELD];
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw % 60 !== 0) {
      return validationError(LEAD_FIELD, "Хугацаа буруу.");
    }
    const days = Math.floor(raw / 1440);
    const hours = (raw % 1440) / 60;
    const v = validateReminderLead(days, hours);
    if (!v.ok) return validationError(LEAD_FIELD, v.message ?? "Хугацаа буруу.");
    lead = { days, hours, minutes: v.minutes };
  }

  const actor = { tenantId: auth.user.tenantId, userId: auth.user.id };

  if (profileTouched) {
    const current = await loadTenant(auth.user.tenantId);
    if (!current) return jsonError(404, "Байгууллага олдсонгүй.", { code: "NOT_FOUND" });
    const str = (key: string, fallback: string | null): string =>
      key in input ? ((input[key] as string | null) ?? "") : (fallback ?? "");
    const bool = (key: string, fallback: boolean): boolean =>
      key in input ? (input[key] as boolean) : fallback;

    const parsed = validateTenantProfile({
      name: str("name", current.name),
      registerNumber: str("registerNumber", current.registerNumber),
      email: str("email", current.email),
      phone1: str("phone1", current.phone1),
      phone2: str("phone2", current.phone2),
      acceptsOnlineBooking: bool("acceptsOnlineBooking", current.acceptsOnlineBooking),
      requireCashSession: bool("requireCashSession", current.requireCashSession),
    });
    if (!parsed.ok) return failureResponse(parsed);
    const checked = await checkTenantProfile(actor, parsed.data);
    if (!checked.ok) return failureResponse(checked);
    const saved = await saveTenantProfile(actor, parsed.data);
    if (!saved.ok) return failureResponse(saved);
  }

  if (lead) {
    await saveReminderLead(actor, lead.days, lead.hours, lead.minutes);
  }

  return await buildResponse(auth.user);
}
