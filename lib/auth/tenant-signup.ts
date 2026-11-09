/**
 * Шинэ tenant (засвар) бүртгэх үндсэн логик — веб `signUpAction` болон мобайл
 * `/api/v1/auth/signup*` хоёул энэ модулийг ашиглана (шалгалт, давхцал,
 * transaction нэг газар — хоёр урсгал зөрөхөөс сэргийлнэ).
 *
 * Дуудагч тал `setBypassContext()`-ийг урьдчилан тавина (session/tenant алга).
 */

import { randomBytes } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { ALL_WEEKDAYS, DEFAULT_OPEN_DAYS } from "@/lib/branches";
import {
  DEFAULT_INTAKE_TEMPLATE_NAME,
  DEFAULT_INTAKE_TEMPLATE_SCHEMA,
} from "@/lib/diagnostics";
import { ensureCashAccount } from "@/lib/payment-accounts";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import {
  mapPersonAdminErrors,
  normalizeRegno,
  regnoKind,
  splitPersonName,
  TENANT_REGNO_MESSAGE,
} from "@/lib/tenant-regno";
import { DEFAULT_UNITS } from "@/lib/units";

// Бүртгэлд ажлын цаг асуухгүй — шинэ салбарын анхдагч цаг.
export const SIGNUP_OPEN_TIME = "09:00";
export const SIGNUP_CLOSE_TIME = "18:00";

/** Түүхий оролт (form эсвэл JSON body) — бүх талбар trim хийгдсэн string. */
export type TenantSignupInput = {
  orgName: string;
  registerNumber: string;
  orgEmail: string;
  phone1: string;
  /** Зөвхөн байгууллага (хуулийн этгээд)-д: «Эзний овог нэр». */
  ownerName: string;
  password: string;
  passwordConfirm: string;
  city: string;
  district: string;
  khoroo: string;
  address: string;
  latitude: string;
  longitude: string;
};

export type TenantSignupData = {
  orgName: string;
  registerNumber: string;
  /** Жижиг үсгээр; хоосон байж болно. */
  orgEmail: string;
  isPerson: boolean;
  ownerName: string;
  firstName: string;
  lastName: string;
  /** Канон 8 оронтой утас (tenant phone1 = админы утас). */
  phone: string;
  /** Имэйл заавал биш — хоосон бол null, OTP/нэвтрэлт утсаар явна. */
  adminEmail: string | null;
  password: string;
  branch: {
    city: string | null;
    district: string | null;
    khoroo: string | null;
    address: string | null;
    latitude: number;
    longitude: number;
  };
};

export type FieldErrors = Record<string, string>;

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function makeSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = randomBytes(3).toString("hex");
  return base ? `${base}-${suffix}` : suffix;
}

/** JSON body-ийн утгыг (string/number) trim хийсэн string болгоно. */
function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** Мобайл JSON body → TenantSignupInput (`phone` нь `phone1`-ийн alias). */
export function tenantSignupInputFromBody(body: unknown): TenantSignupInput {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    orgName: str(b.orgName),
    registerNumber: str(b.registerNumber),
    orgEmail: str(b.orgEmail ?? b.email),
    phone1: str(b.phone1 ?? b.phone),
    ownerName: str(b.ownerName),
    password: typeof b.password === "string" ? b.password : "",
    passwordConfirm:
      typeof b.passwordConfirm === "string"
        ? b.passwordConfirm
        : typeof b.password === "string"
          ? b.password
          : "",
    city: str(b.city),
    district: str(b.district),
    khoroo: str(b.khoroo),
    address: str(b.address),
    latitude: str(b.latitude),
    longitude: str(b.longitude),
  };
}

/** Талбаруудыг шалгаж, хэвийн болгоно. Нууц үгийн шалгалт орно. */
export function validateTenantSignup(
  input: TenantSignupInput,
): { ok: true; data: TenantSignupData } | { ok: false; fieldErrors: FieldErrors } {
  const orgName = input.orgName.trim();
  const registerNumber = normalizeRegno(input.registerNumber);
  const orgEmail = input.orgEmail.trim().toLowerCase();
  const phone1 = input.phone1.trim();

  // Нэр: хувь хүн бол регистрийн нэрээс, засвар бол «Эзний овог нэр» талбараас.
  const isPerson = regnoKind(registerNumber) === "person";
  const ownerName = isPerson ? "" : input.ownerName.trim();
  const { lastName, firstName } = splitPersonName(isPerson ? orgName : ownerName);

  const fieldErrors: FieldErrors = {};
  if (!orgName) fieldErrors.orgName = "Засварын нэр (хувь хүн бол овог нэр)-ээ оруулна уу.";
  if (!regnoKind(registerNumber)) fieldErrors.registerNumber = TENANT_REGNO_MESSAGE;
  if (orgEmail && !isEmail(orgEmail)) fieldErrors.orgEmail = "Имэйл хаяг буруу.";
  if (!phone1) fieldErrors.phone1 = "Утасны дугаар оруулна уу.";
  else if (!isValidPhone(phone1))
    fieldErrors.phone1 = "Утасны дугаар 8 оронтой тоо байх ёстой.";

  // Байршил заавал: үйлчлүүлэгч газрын зургаас олж, захиалга өгөхөд хэрэгтэй.
  const latitude = Number.parseFloat(input.latitude);
  const longitude = Number.parseFloat(input.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    fieldErrors.latitude = "Газрын зураг дээр байршлаа тэмдэглэнэ үү.";

  // Хувь хүний нэрийг регистрийн нэрээс авдаг тул зөвхөн байгууллагад.
  if (!isPerson && !firstName) fieldErrors.ownerName = "Эзний овог нэрийг оруулна уу.";
  if (input.password.length < 8)
    fieldErrors.password = "Нууц үг хамгийн багадаа 8 тэмдэгт байна.";
  if (input.password !== input.passwordConfirm)
    fieldErrors.passwordConfirm = "Нууц үг таарахгүй байна.";

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return {
    ok: true,
    data: {
      orgName,
      registerNumber,
      orgEmail,
      isPerson,
      ownerName,
      firstName,
      lastName,
      phone: normalizePhone(phone1) ?? phone1,
      adminEmail: orgEmail || null,
      password: input.password,
      branch: {
        city: input.city.trim() || null,
        district: input.district.trim() || null,
        khoroo: input.khoroo.trim() || null,
        address: input.address.trim() || null,
        latitude,
        longitude,
      },
    },
  };
}

/**
 * Регистр / имэйл / нэр / утас аль хэдийн бүртгэгдсэн эсэх. Давхцалгүй бол null.
 * Хэрэглэгчийн давхцлыг 1-р алхмын талбарууд руу (phone1/orgEmail) буулгана.
 */
export async function findTenantSignupConflicts(
  data: TenantSignupData,
): Promise<FieldErrors | null> {
  const { registerNumber, orgEmail, orgName, isPerson, adminEmail, phone } = data;
  const [tenantConflict, userConflict] = await Promise.all([
    prisma.tenant.findFirst({
      where: {
        // Хувь хүмүүс адилхан нэртэй байж болох тул нэрээр зөвхөн байгууллагыг шалгана.
        OR: [
          { registerNumber },
          ...(orgEmail ? [{ email: orgEmail }] : []),
          ...(isPerson ? [] : [{ name: orgName }]),
        ],
      },
      select: { registerNumber: true, email: true, name: true },
    }),
    prisma.user.findFirst({
      where: {
        OR: [...(adminEmail ? [{ email: adminEmail }] : []), { phone }],
      },
      select: { email: true, phone: true },
    }),
  ]);
  if (tenantConflict) {
    const fe: FieldErrors = {};
    if (tenantConflict.registerNumber === registerNumber)
      fe.registerNumber = "Энэ регистр аль хэдийн бүртгэгдсэн байна.";
    if (orgEmail && tenantConflict.email === orgEmail)
      fe.orgEmail = "Энэ имэйл аль хэдийн бүртгэгдсэн байна.";
    if (!isPerson && tenantConflict.name === orgName)
      fe.orgName = "Энэ нэртэй засвар аль хэдийн бүртгэгдсэн байна.";
    return fe;
  }
  if (userConflict) {
    const fe: FieldErrors = {};
    if (adminEmail && userConflict.email === adminEmail)
      fe.adminEmail = "Энэ имэйл хаяг аль хэдийн бүртгэгдсэн байна.";
    if (userConflict.phone === phone)
      fe.adminPhone = "Энэ утасны дугаар аль хэдийн бүртгэгдсэн байна.";
    // Админы утас/имэйл = 1-р алхмын утас/имэйл — алдааг тэнд харуулна.
    return mapPersonAdminErrors(fe);
  }
  return null;
}

export type CreatedTenant = {
  userId: string;
  tenantId: string;
  isOwner: boolean;
  /** Шинэ байгууллага ганц салбартай — салбар сонгох алхмыг алгасна. */
  workingBranchId: string;
};

/**
 * Tenant + үндсэн салбар (+7 өдрийн хуваарь) + анхдагч нэгж/касс/оношилгооны
 * загвар + OWNER хэрэглэгчийг нэг transaction-д үүсгэнэ. OTP баталгаажсаны
 * дараа л дуудна. Unique зөрчлийг талбарын алдаа болгон буцаана.
 */
export async function createTenantWithOwner(
  data: TenantSignupData,
): Promise<
  | { ok: true; created: CreatedTenant }
  | { ok: false; fieldErrors: FieldErrors }
  | { ok: false; message: string }
> {
  try {
    const passwordHash = await hashPassword(data.password);

    const created = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug: makeSlug(data.orgName),
          name: data.orgName,
          registerNumber: data.registerNumber,
          email: data.orgEmail || null,
          phone1: data.phone,
        },
      });

      // Төлбөрийн аргууд: «Бэлэн» автоматаар (тенант өөрөө бүртгэхгүй).
      await ensureCashAccount(tx, tenant.id);

      // Default нэгжүүд (ширхэг, цаг, мин, литр, кг, м, удаа, багц)
      await tx.unit.createMany({
        data: DEFAULT_UNITS.map((u) => ({ tenantId: tenant.id, name: u.name, code: u.code })),
        skipDuplicates: true,
      });

      // Системийн үндсэн оношилгооны загвар (isSystemDefault: засах/устгах боломжгүй).
      await tx.diagnosticTemplate.create({
        data: {
          tenantId: tenant.id,
          name: DEFAULT_INTAKE_TEMPLATE_NAME,
          type: "INTAKE",
          schema: DEFAULT_INTAKE_TEMPLATE_SCHEMA,
          isSystemDefault: true,
        },
      });

      // Subscription үүсгэхгүй: шинэ тенант үргэлж үнэгүй FREE багцтай эхэлнэ.

      // Үндсэн салбар — тенантын утсыг өвлүүлж, газрын зураг дээр тэмдэглэсэн
      // байршил (+ geocode-ийн хаяг). Ажлын цаг анхдагч 09:00–18:00, Даваа–Баасан.
      const branch = await tx.branch.create({
        data: {
          tenantId: tenant.id,
          name: "Үндсэн салбар",
          phone: data.phone,
          isPrimary: true,
          city: data.branch.city,
          district: data.branch.district,
          khoroo: data.branch.khoroo,
          address: data.branch.address,
          latitude: data.branch.latitude,
          longitude: data.branch.longitude,
          openTime: SIGNUP_OPEN_TIME,
          closeTime: SIGNUP_CLOSE_TIME,
        },
      });

      const openDays = new Set<string>(DEFAULT_OPEN_DAYS);
      await tx.branchSchedule.createMany({
        data: ALL_WEEKDAYS.map((wd) => ({
          branchId: branch.id,
          weekday: wd,
          isOpen: openDays.has(wd),
        })),
      });

      const user = await tx.user.create({
        data: {
          email: data.adminEmail,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          passwordHash,
          // Админ өөрөө нууц үгээ үүсгэж, OTP-ээр баталгаажсан тул шууд verified.
          verified: true,
          isOwner: true,
          tenantId: tenant.id,
          branchId: branch.id,
        },
      });

      return { userId: user.id, tenantId: tenant.id, isOwner: user.isOwner, workingBranchId: branch.id };
    });
    return { ok: true, created };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = (e.meta?.target as string[] | undefined)?.join(",") ?? "";
      const fe: FieldErrors = {};
      if (target.includes("phone"))
        fe.adminPhone = "Энэ утасны дугаар аль хэдийн бүртгэгдсэн байна.";
      else if (target.includes("name"))
        fe.orgName = "Энэ нэртэй засвар аль хэдийн бүртгэгдсэн байна.";
      else if (target.includes("registerNumber"))
        fe.registerNumber = "Энэ регистр аль хэдийн бүртгэгдсэн байна.";
      else if (target.includes("Tenant_email") || (target.includes("email") && target.includes("Tenant")))
        fe.orgEmail = "Энэ Gmail аль хэдийн бүртгэгдсэн байна.";
      else if (target.includes("User_email") || target.includes("email"))
        fe.adminEmail = "Энэ имэйл хаяг аль хэдийн бүртгэгдсэн байна.";
      else fe._ = "Давхардсан утга бүртгэгдсэн байна.";
      return { ok: false, fieldErrors: mapPersonAdminErrors(fe) };
    }
    return { ok: false, message: e instanceof Error ? e.message : "Бүртгэх явцад алдаа гарлаа." };
  }
}
