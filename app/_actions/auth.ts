"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma } from "@/app/generated/prisma/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  canChooseAllBranches,
  eligibleBranchIds,
  seedWorkingBranchId,
} from "@/lib/auth/roles";
import { safeNext } from "@/lib/safe-redirect";
import {
  mapPersonAdminErrors,
  normalizeRegno,
  regnoKind,
  splitPersonName,
  TENANT_REGNO_MESSAGE,
} from "@/lib/tenant-regno";
import {
  clearSessionCookie,
  setSessionCookie,
} from "@/lib/auth/cookies";
import { getSession } from "@/lib/auth";
import { issueOtp, revokeAllOtps, verifyOtp } from "@/lib/auth/otp";
import { revokeAllForUser } from "@/lib/auth/refresh-token";
import { ALL_BRANCHES, signSession } from "@/lib/auth/session";
import { resolveTodayLockedBranch } from "@/lib/employee-branch-lock";
import { notifySuperAdmins } from "@/lib/notifications";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import {
  IDENTIFIER_ERROR,
  type LoginIdentifier,
  loginIdentifierLabel,
  loginIdentifierValue,
  parseLoginIdentifier,
} from "@/lib/auth/login-identifier";
import {
  createUserSession,
  revokeUserSession,
} from "@/lib/auth/user-session";
import { prisma } from "@/lib/prisma";
import { ensureCashAccount } from "@/lib/payment-accounts";
import {
  consumeRateLimit,
  ipFromHeaders,
  LOGIN_WINDOW_MS,
  RATE_LIMITED_MESSAGE,
} from "@/lib/rate-limit";
import { setBypassContext, setTenantContext } from "@/lib/tenant-context";
import { sendOtpSms } from "@/lib/sms";
import { saveUpload } from "@/lib/storage";
import { logAudit } from "@/lib/audit";
import {
  ALL_WEEKDAYS,
  DEFAULT_OPEN_DAYS,
  isValidTime,
  isWeekday,
} from "@/lib/branches";
import { trialEndDate } from "@/lib/subscription";
import { DEFAULT_UNITS } from "@/lib/units";
import {
  DEFAULT_INTAKE_TEMPLATE_NAME,
  DEFAULT_INTAKE_TEMPLATE_SCHEMA,
} from "@/lib/diagnostics";

export type SignUpFormValues = {
  orgName: string;
  registerNumber: string;
  orgEmail: string;
  phone1: string;
  phone2: string;
  lastName: string;
  firstName: string;
  adminPhone: string;
  adminEmail: string;
};

export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  awaitingOtp?: boolean;
  // Алдаа гарсан үед form-нд бөглөсөн утгуудыг буцааж сэргээхэд хэрэглэнэ.
  values?: SignUpFormValues;
} | null;

// ---- helpers --------------------------------------------------------------

function getStr(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Ажилтны нэвтрэх нэр — имэйл ЭСВЭЛ утасны дугаар (харах: lib/auth/login-identifier.ts).
/** Form-ын `identifier` (хуучин `email`) талбарыг задлана. Хүчингүй бол null. */
function getIdentifier(fd: FormData): LoginIdentifier | null {
  return parseLoginIdentifier(getStr(fd, "identifier") || getStr(fd, "email"));
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

// ---- SIGN UP --------------------------------------------------------------

export async function signUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Шинэ tenant бүртгэгдэх урсгал — session/tenant хараахан байхгүй.
  setBypassContext();
  // Organization
  const orgName = getStr(formData, "orgName");
  const registerNumber = normalizeRegno(getStr(formData, "registerNumber"));
  const orgEmail = getStr(formData, "orgEmail").toLowerCase();
  const phone1 = getStr(formData, "phone1");
  const phone2 = getStr(formData, "phone2");
  const logoFile = formData.get("logo");

  // Үндсэн салбар
  const branchCity = getStr(formData, "city");
  const branchDistrict = getStr(formData, "district");
  const branchKhoroo = getStr(formData, "khoroo");
  const branchAddress = getStr(formData, "address");
  const branchLatRaw = getStr(formData, "latitude");
  const branchLngRaw = getStr(formData, "longitude");
  const branchOpenTimeRaw = getStr(formData, "openTime");
  const branchCloseTimeRaw = getStr(formData, "closeTime");
  const branchWorkDays = formData.getAll("workDays").map(String).filter(isWeekday);

  // Admin — хувь хүн бол админ нь тухайн хүн өөрөө: нэр/утас/имэйлийг
  // 1-р алхмын мэдээллээс авна (дахин бөглүүлэхгүй).
  const isPerson = regnoKind(registerNumber) === "person";
  const personName = isPerson ? splitPersonName(orgName) : null;
  const lastName = personName ? personName.lastName : getStr(formData, "lastName");
  const firstName = personName ? personName.firstName : getStr(formData, "firstName");
  const adminPhone = isPerson ? phone1 : getStr(formData, "adminPhone");
  const adminEmail = isPerson ? orgEmail : getStr(formData, "adminEmail").toLowerCase();
  const password = getStr(formData, "password");
  const passwordConfirm = getStr(formData, "passwordConfirm");

  // OTP — хоёр дахь шатанд илгээгдэнэ
  const otpCode = getStr(formData, "otpCode");

  // Алдаа гарсан үед form-руу буцаах нэг удаагийн "values" snapshot
  const values: SignUpFormValues = {
    orgName,
    registerNumber,
    orgEmail,
    phone1,
    phone2,
    lastName,
    firstName,
    adminPhone,
    adminEmail,
  };

  const fieldErrors: Record<string, string> = {};

  if (!orgName) fieldErrors.orgName = "Байгууллагын нэр (хувь хүн бол овог нэр)-ээ оруулна уу.";
  if (!regnoKind(registerNumber))
    fieldErrors.registerNumber = TENANT_REGNO_MESSAGE;
  if (!isEmail(orgEmail)) fieldErrors.orgEmail = "Байгууллагын Gmail буруу.";
  if (!phone1) fieldErrors.phone1 = "Утасны дугаар оруулна уу.";
  else if (!isValidPhone(phone1))
    fieldErrors.phone1 = "Утасны дугаар 8 оронтой тоо байх ёстой.";
  if (phone2 && !isValidPhone(phone2))
    fieldErrors.phone2 = "Утасны дугаар 8 оронтой тоо байх ёстой.";

  // Үндсэн салбарын хаяг — хэрэглэгчид харагдах, захиалга авахад заавал хэрэгтэй.
  if (!branchCity) fieldErrors.city = "Хотоо сонгоно уу.";
  if (!branchDistrict) fieldErrors.district = "Дүүргээ сонгоно уу.";
  if (!branchAddress) fieldErrors.address = "Дэлгэрэнгүй хаягаа оруулна уу.";

  let branchLat: number | null = null;
  if (branchLatRaw) {
    const n = Number.parseFloat(branchLatRaw);
    if (!Number.isFinite(n) || n < -90 || n > 90)
      fieldErrors.latitude = "Latitude -90 ба 90-ийн хооронд байна.";
    else branchLat = n;
  }
  let branchLng: number | null = null;
  if (branchLngRaw) {
    const n = Number.parseFloat(branchLngRaw);
    if (!Number.isFinite(n) || n < -180 || n > 180)
      fieldErrors.longitude = "Longitude -180 ба 180-ийн хооронд байна.";
    else branchLng = n;
  }
  const branchOpenTime = branchOpenTimeRaw || null;
  const branchCloseTime = branchCloseTimeRaw || null;
  if (branchOpenTime && !isValidTime(branchOpenTime))
    fieldErrors.openTime = "Цагийн форматыг HH:MM (24 цаг) хэлбэрээр оруулна уу.";
  if (branchCloseTime && !isValidTime(branchCloseTime))
    fieldErrors.closeTime = "Цагийн форматыг HH:MM (24 цаг) хэлбэрээр оруулна уу.";

  // Хувь хүний утас/имэйл/нэрийг дээр шалгасан тул зөвхөн байгууллагад.
  if (!isPerson) {
    if (!lastName) fieldErrors.lastName = "Овгоо оруулна уу.";
    if (!firstName) fieldErrors.firstName = "Нэрээ оруулна уу.";
    if (!adminPhone) fieldErrors.adminPhone = "Утасны дугаар оруулна уу.";
    else if (!isValidPhone(adminPhone))
      fieldErrors.adminPhone = "Утасны дугаар 8 оронтой тоо байх ёстой.";
    if (!isEmail(adminEmail)) fieldErrors.adminEmail = "Имэйл хаяг буруу.";
  }
  if (password.length < 8)
    fieldErrors.password = "Нууц үг хамгийн багадаа 8 тэмдэгт байна.";
  if (password !== passwordConfirm)
    fieldErrors.passwordConfirm = "Нууц үг таарахгүй байна.";

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors, values };
  }

  // Утаснуудыг канон 8 оронтой хэлбэрт оруулна (хадгалах, OTP, давхцал шалгах).
  const normAdminPhone = normalizePhone(adminPhone) ?? adminPhone;
  const normPhone1 = normalizePhone(phone1) ?? phone1;
  const normPhone2 = phone2 ? normalizePhone(phone2) : null;

  // --- 1-р шат: OTP илгээх ---
  // Дугаар / имэйл аль хэдийн бүртгэгдсэн эсэхийг урьдчилан шалгаж, дараа нь
  // SMS-ээр код илгээнэ.
  if (!otpCode) {
    const [tenantConflict, userConflict] = await Promise.all([
      prisma.tenant.findFirst({
        where: {
          // Хувь хүмүүс адилхан нэртэй байж болох тул нэрээр зөвхөн байгууллагыг шалгана.
          OR: [
            { registerNumber },
            { email: orgEmail },
            ...(isPerson ? [] : [{ name: orgName }]),
          ],
        },
        select: { registerNumber: true, email: true, name: true },
      }),
      prisma.user.findFirst({
        where: { OR: [{ email: adminEmail }, { phone: normAdminPhone }] },
        select: { email: true, phone: true },
      }),
    ]);
    if (tenantConflict) {
      const fe: Record<string, string> = {};
      if (tenantConflict.registerNumber === registerNumber)
        fe.registerNumber = "Энэ регистр аль хэдийн бүртгэгдсэн байна.";
      if (tenantConflict.email === orgEmail)
        fe.orgEmail = "Энэ имэйл аль хэдийн бүртгэгдсэн байна.";
      if (!isPerson && tenantConflict.name === orgName)
        fe.orgName = "Энэ нэртэй байгууллага аль хэдийн бүртгэгдсэн байна.";
      return { ok: false, fieldErrors: fe, values };
    }
    if (userConflict) {
      const fe: Record<string, string> = {};
      if (userConflict.email === adminEmail)
        fe.adminEmail = "Энэ имэйл хаяг аль хэдийн бүртгэгдсэн байна.";
      if (userConflict.phone === normAdminPhone)
        fe.adminPhone = "Энэ утасны дугаар аль хэдийн бүртгэгдсэн байна.";
      return {
        ok: false,
        fieldErrors: isPerson ? mapPersonAdminErrors(fe) : fe,
        values,
      };
    }

    const h = await headers();
    const ua = h.get("user-agent");
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      null;

    const { code } = await issueOtp({
      email: adminEmail,
      type: "SIGNUP",
      userAgent: ua,
      ip,
    });
    const sent = await sendOtpSms(code, "SIGNUP", normAdminPhone);
    if (!sent) {
      return {
        ok: false,
        message:
          "Баталгаажуулах код илгээгдсэнгүй. Утсаа шалгаж дахин оролдоно уу.",
        values,
      };
    }

    return {
      ok: false,
      awaitingOtp: true,
      message: `Утас ${adminPhone} руу 6 оронтой код илгээлээ. Кодоо оруулна уу.`,
      values,
    };
  }

  // --- 2-р шат: OTP баталгаажуулалт ---
  if (!/^\d{6}$/.test(otpCode)) {
    return {
      ok: false,
      awaitingOtp: true,
      fieldErrors: { otpCode: "6 оронтой код оруулна уу." },
      values,
    };
  }
  const otpResult = await verifyOtp({
    email: adminEmail,
    type: "SIGNUP",
    code: otpCode,
  });
  if (!otpResult.ok) {
    const message =
      otpResult.reason === "expired"
        ? "Кодны хугацаа дууссан. Шинээр код илгээнэ үү."
        : otpResult.reason === "too_many_attempts"
          ? "Хэт олон удаа буруу оролдсон. Шинээр код илгээнэ үү."
          : "Код буруу байна.";
    return {
      ok: false,
      awaitingOtp: true,
      fieldErrors: { otpCode: message },
      values,
    };
  }

  // Logo upload (заавал биш)
  let logoUrl: string | null = null;
  if (logoFile instanceof File && logoFile.size > 0) {
    try {
      const saved = await saveUpload(logoFile, "logos");
      logoUrl = saved.path;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Лого хадгалахад алдаа гарлаа.";
      return { ok: false, fieldErrors: { logo: msg }, values };
    }
  }

  // Transaction: Tenant + OWNER User
  let session;
  try {
    const passwordHash = await hashPassword(password);

    session = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug: makeSlug(orgName),
          name: orgName,
          registerNumber,
          email: orgEmail,
          phone1: normPhone1,
          phone2: normPhone2,
          logoUrl,
        },
      });

      // Төлбөрийн аргууд: «Бэлэн» автоматаар (тенант өөрөө бүртгэхгүй).
      await ensureCashAccount(tx, tenant.id);

      // Default нэгжүүд (ширхэг, цаг, мин, литр, кг, м, удаа, багц)
      await tx.unit.createMany({
        data: DEFAULT_UNITS.map((u) => ({
          tenantId: tenant.id,
          name: u.name,
          code: u.code,
        })),
        skipDuplicates: true,
      });

      // Системийн үндсэн оношилгооны загвар — шинэ тенант шууд ашиглаж
      // эхэлнэ (ангилалгүй; ажилтан хүсвэл дараа нь ангилал/үнэ нэмж болно).
      // isSystemDefault: тенант засах/устгах боломжгүй (харах:
      // app/_actions/diagnostic-templates.ts).
      await tx.diagnosticTemplate.create({
        data: {
          tenantId: tenant.id,
          name: DEFAULT_INTAKE_TEMPLATE_NAME,
          type: "INTAKE",
          schema: DEFAULT_INTAKE_TEMPLATE_SCHEMA,
          isSystemDefault: true,
        },
      });

      // 14 хоногийн free trial subscription автоматаар үүсгэнэ
      const trialStart = new Date();
      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          plan: "FREE",
          status: "TRIAL",
          startsAt: trialStart,
          endsAt: trialEndDate(trialStart),
          notes: "Бүртгэлийн үед автоматаар үүсгэсэн 14 хоногийн туршилт.",
        },
      });

      // Үндсэн салбар үүсгэнэ — тенант бүртгэлийн утсыг өвлүүлж, бүртгэлийн
      // үед хэрэглэгчийн бөглөсөн хаяг/цагийн мэдээллийг хадгална.
      const branch = await tx.branch.create({
        data: {
          tenantId: tenant.id,
          name: "Үндсэн салбар",
          phone: normPhone1,
          isPrimary: true,
          city: branchCity,
          district: branchDistrict,
          khoroo: branchKhoroo || null,
          address: branchAddress,
          latitude: branchLat,
          longitude: branchLng,
          openTime: branchOpenTime,
          closeTime: branchCloseTime,
        },
      });

      // Долоо хоногийн 7 өдрийн хуваарь — хэрэглэгч сонгосон өдрүүд, эсвэл
      // юу ч сонгоогүй бол анхдагч Даваа–Баасан.
      const openDays = new Set(
        branchWorkDays.length ? branchWorkDays : DEFAULT_OPEN_DAYS,
      );
      await tx.branchSchedule.createMany({
        data: ALL_WEEKDAYS.map((wd) => ({
          branchId: branch.id,
          weekday: wd,
          isOpen: openDays.has(wd),
        })),
      });

      const user = await tx.user.create({
        data: {
          email: adminEmail,
          firstName,
          lastName,
          phone: normAdminPhone,
          passwordHash,
          // Админ өөрөө нууц үгээ үүсгэж, OTP-ээр баталгаажсан тул шууд verified.
          verified: true,
          isOwner: true,
          tenantId: tenant.id,
          branchId: branch.id,
        },
      });

      return { userId: user.id, tenantId: tenant.id, isOwner: user.isOwner };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = (e.meta?.target as string[] | undefined)?.join(",") ?? "";
      const fe: Record<string, string> = {};
      if (target.includes("phone"))
        fe.adminPhone = "Энэ утасны дугаар аль хэдийн бүртгэгдсэн байна.";
      else if (target.includes("name"))
        fe.orgName = "Энэ нэртэй байгууллага аль хэдийн бүртгэгдсэн байна.";
      else if (target.includes("registerNumber"))
        fe.registerNumber = "Энэ регистр аль хэдийн бүртгэгдсэн байна.";
      else if (target.includes("Tenant_email") || target.includes("email") && target.includes("Tenant"))
        fe.orgEmail = "Энэ Gmail аль хэдийн бүртгэгдсэн байна.";
      else if (target.includes("User_email") || target.includes("email"))
        fe.adminEmail = "Энэ имэйл хаяг аль хэдийн бүртгэгдсэн байна.";
      else fe._ = "Давхардсан утга бүртгэгдсэн байна.";
      return {
        ok: false,
        fieldErrors: isPerson ? mapPersonAdminErrors(fe) : fe,
        values,
      };
    }
    const msg = e instanceof Error ? e.message : "Бүртгэх явцад алдаа гарлаа.";
    return { ok: false, message: msg, values };
  }

  // Web session-ийг DB-д бүртгэж, JWT-д sid шигтгэнэ (revoke/төхөөрөмжийн жагсаалт).
  const h = await headers();
  const userSession = await createUserSession({
    userId: session.userId,
    userAgent: h.get("user-agent"),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
  });
  const token = await signSession({ ...session, sid: userSession.id });
  await setSessionCookie(token);

  try {
    await notifySuperAdmins({
      type: "tenant_created",
      input: { tenantId: session.tenantId, tenantName: orgName },
    });
  } catch (err) {
    console.warn("[notify] tenant_created:", err);
  }

  redirect("/dashboard");
}

// ---- LOGIN IDENTIFIER CHECK (нэвтрэх хуудасны 1-р шат) ---------------------
// Имэйл эсвэл утасны дугаараа оруулсны дараа дараагийн алхмыг тодорхойлно:
//   - "password"        : бүртгэлтэй, идэвхжсэн → нууц үг асууна
//   - "activate"        : бүртгэлтэй ч нууц үггүй → утсанд OTP илгээж, нууц үг үүсгүүлнэ
//   - "not_registered"  : бүртгэлгүй → мессеж харуулна
// Тэмдэглэл: энэ нь имэйл/утас бүртгэлтэй эсэхийг ил болгодог (enumeration) — UX-ийн
// үүднээс зориуд. Бусад урсгал (signup/forgot/activate) enumeration-safe хэвээр.

export type LoginEmailState = {
  ok: boolean;
  status?: "password" | "activate" | "not_registered";
  /** Канон нэвтрэх нэр (имэйл эсвэл 8 оронтой утас) — дараагийн шатанд дамжина. */
  identifier?: string;
  maskedPhone?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

export async function checkLoginEmailAction(
  _prev: LoginEmailState,
  formData: FormData,
): Promise<LoginEmailState> {
  const id = getIdentifier(formData);
  if (!id) {
    return { ok: false, fieldErrors: { identifier: IDENTIFIER_ERROR } };
  }
  const identifier = loginIdentifierValue(id);

  // Нэвтрэхээс өмнө — session/tenant хараахан байхгүй.
  setBypassContext();
  const user = await prisma.user.findUnique({
    where: id,
    select: { id: true, email: true, verified: true, passwordHash: true, phone: true },
  });

  if (!user) {
    return {
      ok: true,
      status: "not_registered",
      identifier,
      message: `Энэ ${loginIdentifierLabel(id)} бүртгэлгүй байна. Байгууллагаа бүртгүүлэх эсвэл админтайгаа холбогдоно уу.`,
    };
  }

  // Идэвхжсэн — нууц үгээр нэвтэрнэ.
  if (user.verified && user.passwordHash) {
    return { ok: true, status: "password", identifier };
  }

  // Идэвхжээгүй — анхны нэвтрэлт: утсанд OTP илгээж нууц үг үүсгүүлнэ.
  const maskedPhone = maskPhone(user.phone);
  try {
    const h = await headers();
    const ua = h.get("user-agent");
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      null;
    const { code } = await issueOtp({
      email: user.email,
      type: "SET_PASSWORD",
      userId: user.id,
      userAgent: ua,
      ip,
    });
    await sendOtpSms(code, "SET_PASSWORD", user.phone);
  } catch (e) {
    // Код илгээх амжилтгүй (ж: хэт олон хүсэлт) — алхмыг харуулж, мессеж дамжуулна.
    return {
      ok: true,
      status: "activate",
      identifier,
      maskedPhone,
      message: e instanceof Error ? e.message : "Код илгээхэд алдаа гарлаа.",
    };
  }

  return { ok: true, status: "activate", identifier, maskedPhone };
}

// ---- SIGN IN --------------------------------------------------------------

const MAX_LOGIN_ATTEMPTS = 5;

export async function signInAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = getIdentifier(formData);
  const password = getStr(formData, "password");

  const fieldErrors: Record<string, string> = {};
  if (!id) fieldErrors.identifier = IDENTIFIER_ERROR;
  if (!password) fieldErrors.password = "Нууц үгээ оруулна уу.";
  if (!id || Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  // Account-ын түгжээнээс гадна IP-ээр — олон имэйл дээр тархсан оролдлогыг хаана.
  const loginIp = ipFromHeaders(await headers());
  if (!consumeRateLimit(`web-login-ip:${loginIp}`, { limit: 30, windowMs: LOGIN_WINDOW_MS }).ok) {
    return { ok: false, message: RATE_LIMITED_MESSAGE };
  }

  // Нэвтрэхээс өмнө — session/tenant хараахан байхгүй.
  setBypassContext();
  const user = await prisma.user.findUnique({
    where: id,
    include: { tenant: { select: { suspended: true } } },
  });
  // Цаг алдалгүй "имэйл буруу" гэхгүй — нэвтрэгчдийг нэрлэх боломж өгөхгүй.
  if (!user) {
    return { ok: false, message: "Нэвтрэх нэр эсвэл нууц үг буруу байна." };
  }

  // Аккаунт түгжигдсэн бол энд л зогсоо.
  if (user.lockedAt) {
    return {
      ok: false,
      message:
        "Хэт олон удаа буруу оролдсон тул аккаунт түгжигдсэн. Нууц үгээ сэргээнэ үү.",
    };
  }

  // Идэвхжээгүй (нууц үгээ үүсгээгүй) ажилтан — анхны нэвтрэлт рүү чиглүүлнэ.
  if (!user.verified || !user.passwordHash) {
    return {
      ok: false,
      message:
        "Энэ аккаунт идэвхжээгүй байна. «Анх удаа нэвтрэх» хэсгээр нууц үгээ үүсгэнэ үү.",
    };
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const nextAttempts = user.failedLoginAttempts + 1;
    const willLock = nextAttempts >= MAX_LOGIN_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: nextAttempts,
        lockedAt: willLock ? new Date() : undefined,
      },
    });
    if (willLock) {
      return {
        ok: false,
        message:
          "Хэт олон удаа буруу оролдсон тул аккаунт түгжигдсэн. Нууц үгээ сэргээнэ үү.",
      };
    }
    const remaining = MAX_LOGIN_ATTEMPTS - nextAttempts;
    return {
      ok: false,
      message: `Нэвтрэх нэр эсвэл нууц үг буруу байна. Үлдсэн оролдлого: ${remaining}.`,
    };
  }

  if (user.tenant.suspended) {
    return {
      ok: false,
      message:
        "Таны байгууллагын хандалт түр зогссон байна. carservice.mn-тай холбоо барина уу.",
    };
  }

  // Өөрөө хаасан ажилтан нууц үгээр нэвтэрвэл сэргээнэ (api/v1/auth/login-той
  // адил). isActive=false (админ блок) бол хөндөхгүй — доорх шалгалт блоклоно.
  if (user.isActive && user.deactivatedAt) {
    await prisma.user.update({ where: { id: user.id }, data: { deactivatedAt: null } });
    user.deactivatedAt = null;
  }

  // Хэрэглэгчийн идэвхтэй эсэх / хугацаа дуусаагүй эсэхийг шалгах
  const { checkUserActive } = await import("@/lib/auth/active");
  const active = checkUserActive({
    isActive: user.isActive,
    activeUntil: user.activeUntil,
    deactivatedAt: user.deactivatedAt,
  });
  if (!active.ok) {
    return { ok: false, message: active.message };
  }

  // Амжилттай — алдааны тоологчийг тэглэх
  if (user.failedLoginAttempts > 0) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedAt: null },
    });
  }

  // Web session-ийг DB-д бүртгэж (төхөөрөмж/түүх), JWT-д sid шигтгэнэ.
  const h = await headers();
  const ua = h.get("user-agent");
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    null;
  const session = await createUserSession({ userId: user.id, userAgent: ua, ip });

  // Өнөөдрийн ажлын хувиараар тодорхой салбар "түгжигдсэн" бол (харах:
  // lib/employee-branch-lock.ts) сонголт хийлгэхгүйгээр шууд тэр рүү нь
  // оруулна — олон салбарт ажилладаг ч гэсэн өнөөдрийн хувиар
  // ойлгомжтой байвал choose-branch алгасна. Үгүй бол хуучин дүрэм: яг НЭГ
  // сонголттой (branchId + assignableBranchIds) ажилтан шууд тэр салбартаа
  // ажилладаг гэж тооцно; Owner/2+ салбарт ажилладаг ажилтныг undefined-ээр
  // үлдээж, дараагийн /dashboard хүсэлт дээр proxy.ts /page/choose-branch
  // руу чиглүүлнэ (харах: lib/auth/roles.ts seedWorkingBranchId).
  const locked = await resolveTodayLockedBranch(user);
  const token = await signSession({
    userId: user.id,
    tenantId: user.tenantId,
    isOwner: user.isOwner,
    sid: session.id,
    workingBranchId: locked?.branchId ?? seedWorkingBranchId(user),
  });
  await setSessionCookie(token);

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "User",
    entityId: user.id,
    action: "LOGIN",
    summary: user.email,
  });

  redirect("/dashboard");
}

// ---- SIGN OUT -------------------------------------------------------------

export async function signOutAction(): Promise<void> {
  // Logout-аас өмнө хэрэглэгчийн мэдээллийг авна (cookie clear хийсний дараа танигдахгүй)
  try {
    // session.tenantId олдох хүртэл (доор) — getSession() өөрөө UserSession уншина.
    setBypassContext();
    const { getSession } = await import("@/lib/auth");
    const session = await getSession();
    if (session) {
      // JWT дотор гарын үсэгтэй ирсэн, найдвартай tenantId.
      setTenantContext(session.tenantId);
      // Энэ төхөөрөмжийн session-ийг revoke (идэвхтэй жагсаалтаас хасна).
      if (session.sid) {
        await revokeUserSession(session.sid, session.userId);
      }
      await logAudit({
        tenantId: session.tenantId,
        userId: session.userId,
        entity: "User",
        entityId: session.userId,
        action: "LOGOUT",
      });
    }
  } catch {
    // Аудит лог үндсэн logout-ийг тасалдуулахгүй
  }

  await clearSessionCookie();
  redirect("/page/login");
}

// ---- FORGOT PASSWORD ------------------------------------------------------

// Маск хийсэн утсыг харуулна — нийт цифрийн тоо мэдэгдэж эх дугаарыг бүгдийг
// харуулахгүй (security).
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D+/g, "");
  if (digits.length < 4) return digits.replace(/./g, "*");
  return `${"*".repeat(Math.max(0, digits.length - 2))}${digits.slice(-2)}`;
}

export type ForgotPasswordState = {
  ok: boolean;
  step: "request" | "verify";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Канон нэвтрэх нэр (имэйл эсвэл 8 оронтой утас). */
  identifier?: string;
  maskedPhone?: string;
} | null;

/**
 * 1-р шат: имэйл эсвэл утасны дугаар оруулаад, утсанд OTP илгээнэ.
 */
export async function requestPasswordResetAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const id = getIdentifier(formData);
  if (!id) {
    return {
      ok: false,
      step: "request",
      fieldErrors: { identifier: IDENTIFIER_ERROR },
    };
  }
  const identifier = loginIdentifierValue(id);

  // Нууц үг сэргээхээс өмнө — session/tenant хараахан байхгүй.
  setBypassContext();
  const user = await prisma.user.findUnique({
    where: id,
    select: { id: true, email: true, phone: true },
  });

  // Хэрэглэгчийн нууцлалыг хадгалахын тулд бүх тохиолдолд success-тэй адил
  // хариу буцаана — гэхдээ OTP илгээх нь жинхэнэ хэрэглэгчийн хувьд л ажиллана.
  if (user) {
    const h = await headers();
    const ua = h.get("user-agent");
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      null;
    const { code } = await issueOtp({
      email: user.email,
      type: "RESET_PASSWORD",
      userId: user.id,
      userAgent: ua,
      ip,
    });
    await sendOtpSms(code, "RESET_PASSWORD", user.phone);
    return {
      ok: true,
      step: "verify",
      identifier,
      maskedPhone: maskPhone(user.phone),
      message: "Утсанд 6 оронтой код илгээлээ.",
    };
  }

  // Үл байгаа хэрэглэгчийг хүртэл "илгээсэн" гэж харуулна (enumeration-аас сэргийлнэ)
  return {
    ok: true,
    step: "verify",
    identifier,
    maskedPhone: "**",
    message: "Хэрэв энэ бүртгэлтэй бол утсанд код илгээгдсэн.",
  };
}

/**
 * 2-р шат: OTP + шинэ нууц үг. Амжилттай үед бүх refresh token + OTP-уудыг
 * revoke хийгээд аккаунтыг unlock хийнэ.
 */
export async function resetPasswordAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const id = getIdentifier(formData);
  const identifier = id ? loginIdentifierValue(id) : "";
  const code = getStr(formData, "code");
  const password = getStr(formData, "password");
  const passwordConfirm = getStr(formData, "passwordConfirm");

  const fieldErrors: Record<string, string> = {};
  if (!id) fieldErrors.identifier = IDENTIFIER_ERROR;
  if (!/^\d{6}$/.test(code))
    fieldErrors.code = "6 оронтой код оруулна уу.";
  if (password.length < 8)
    fieldErrors.password = "Нууц үг хамгийн багадаа 8 тэмдэгт байна.";
  if (password !== passwordConfirm)
    fieldErrors.passwordConfirm = "Нууц үг таарахгүй байна.";
  if (!id || Object.keys(fieldErrors).length > 0) {
    return { ok: false, step: "verify", identifier, fieldErrors };
  }

  // Нууц үг сэргээхээс өмнө — session/tenant хараахан байхгүй.
  setBypassContext();
  const user = await prisma.user.findUnique({
    where: id,
    select: { id: true, email: true, tenantId: true },
  });
  // Бүртгэлгүй нэвтрэх нэрийг "код буруу"-тай адил харуулна (enumeration-аас сэргийлнэ).
  if (!user) {
    return {
      ok: false,
      step: "verify",
      identifier,
      fieldErrors: { code: "Код буруу байна." },
    };
  }
  const email = user.email;

  const otp = await verifyOtp({ email, type: "RESET_PASSWORD", code });
  if (!otp.ok) {
    const message =
      otp.reason === "expired"
        ? "Кодны хугацаа дууссан. Шинээр код илгээнэ үү."
        : otp.reason === "too_many_attempts"
          ? "Хэт олон удаа буруу оролдсон. Шинээр код илгээнэ үү."
          : "Код буруу байна.";
    return { ok: false, step: "verify", identifier, fieldErrors: { code: message } };
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      // Утсаараа OTP баталгаажуулсан тул аккаунт идэвхтэй гэж үзнэ.
      verified: true,
      failedLoginAttempts: 0,
      lockedAt: null,
    },
  });
  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "User",
    entityId: user.id,
    action: "UPDATE",
    summary: "Нууц үг сэргээв (OTP-ээр баталгаажуулсан)",
  });
  // Бүх идэвхтэй refresh token-уудыг хүчингүй болгож, бусад OTP-уудыг ч revoke
  await Promise.all([
    revokeAllForUser(user.id),
    revokeAllOtps(email, "RESET_PASSWORD"),
  ]);

  return {
    ok: true,
    step: "verify",
    identifier,
    message: "Нууц үг шинэчлэгдлээ. Шинэ нууц үгээрээ нэвтэрнэ үү.",
  };
}

// ---- ACTIVATE ACCOUNT (анхны нэвтрэлт) ------------------------------------
// Админ ажилтан үүсгэхэд нууц үг тавихгүй (passwordHash=null, verified=false).
// Ажилтан энд имэйл эсвэл утасны дугаараа оруулж утсандаа ирэх OTP-ээр баталгаажуулан нууц үгээ
// үүсгэснээр аккаунт идэвхжиж (verified=true), шууд нэвтэрнэ.

export type ActivateAccountState = {
  ok: boolean;
  step: "request" | "verify";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Канон нэвтрэх нэр (имэйл эсвэл 8 оронтой утас). */
  identifier?: string;
  maskedPhone?: string;
} | null;

/**
 * 1-р шат: имэйл эсвэл утас оруулаад, идэвхжээгүй ажилтны утсанд OTP илгээнэ.
 */
export async function requestActivationAction(
  _prev: ActivateAccountState,
  formData: FormData,
): Promise<ActivateAccountState> {
  const id = getIdentifier(formData);
  if (!id) {
    return {
      ok: false,
      step: "request",
      fieldErrors: { identifier: IDENTIFIER_ERROR },
    };
  }
  const identifier = loginIdentifierValue(id);

  // Идэвхжүүлэхээс өмнө — session/tenant хараахан байхгүй.
  setBypassContext();
  const user = await prisma.user.findUnique({
    where: id,
    select: { id: true, email: true, phone: true, verified: true },
  });

  // Аль хэдийн идэвхжсэн бол энгийн нэвтрэлт рүү чиглүүлнэ.
  if (user?.verified) {
    return {
      ok: false,
      step: "request",
      message:
        "Энэ аккаунт аль хэдийн идэвхжсэн байна. Нууц үгээрээ нэвтэрнэ үү. Мартсан бол «Нууц үгээ мартсан» ашиглана уу.",
    };
  }

  if (user && !user.verified) {
    const h = await headers();
    const ua = h.get("user-agent");
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      null;
    const { code } = await issueOtp({
      email: user.email,
      type: "SET_PASSWORD",
      userId: user.id,
      userAgent: ua,
      ip,
    });
    await sendOtpSms(code, "SET_PASSWORD", user.phone);
    return {
      ok: true,
      step: "verify",
      identifier,
      maskedPhone: maskPhone(user.phone),
      message: "Бүртгэлтэй утсанд 6 оронтой код илгээлээ.",
    };
  }

  // Бүртгэлгүй нэвтрэх нэрийг ч "илгээсэн" мэт харуулна (enumeration-аас сэргийлнэ).
  return {
    ok: true,
    step: "verify",
    identifier,
    maskedPhone: "**",
    message: "Хэрэв энэ бүртгэлтэй бол утсанд код илгээгдсэн.",
  };
}

/**
 * 2-р шат: OTP + шинэ нууц үг. Амжилттай үед нууц үгийг тогтоож, verified=true
 * болгон, шууд нэвтрүүлнэ (signup-тэй адил session үүсгэнэ).
 */
export async function activateAccountAction(
  _prev: ActivateAccountState,
  formData: FormData,
): Promise<ActivateAccountState> {
  const id = getIdentifier(formData);
  const identifier = id ? loginIdentifierValue(id) : "";
  const code = getStr(formData, "code");
  const password = getStr(formData, "password");
  const passwordConfirm = getStr(formData, "passwordConfirm");

  const fieldErrors: Record<string, string> = {};
  if (!id) fieldErrors.identifier = IDENTIFIER_ERROR;
  if (!/^\d{6}$/.test(code)) fieldErrors.code = "6 оронтой код оруулна уу.";
  if (password.length < 8)
    fieldErrors.password = "Нууц үг хамгийн багадаа 8 тэмдэгт байна.";
  if (password !== passwordConfirm)
    fieldErrors.passwordConfirm = "Нууц үг таарахгүй байна.";
  if (!id || Object.keys(fieldErrors).length > 0) {
    return { ok: false, step: "verify", identifier, fieldErrors };
  }

  // Идэвхжүүлэхээс өмнө — session/tenant хараахан байхгүй.
  setBypassContext();
  const user = await prisma.user.findUnique({
    where: id,
    include: { tenant: { select: { suspended: true } } },
  });
  // Бүртгэлгүй нэвтрэх нэрийг "код буруу"-тай адил харуулна (enumeration-аас сэргийлнэ).
  if (!user) {
    return {
      ok: false,
      step: "verify",
      identifier,
      fieldErrors: { code: "Код буруу байна." },
    };
  }
  const email = user.email;

  const otp = await verifyOtp({ email, type: "SET_PASSWORD", code });
  if (!otp.ok) {
    const message =
      otp.reason === "expired"
        ? "Кодны хугацаа дууссан. Шинээр код илгээнэ үү."
        : otp.reason === "too_many_attempts"
          ? "Хэт олон удаа буруу оролдсон. Шинээр код илгээнэ үү."
          : "Код буруу байна.";
    return { ok: false, step: "verify", identifier, fieldErrors: { code: message } };
  }

  if (user.verified) {
    return {
      ok: false,
      step: "verify",
      identifier,
      message: "Аккаунт аль хэдийн идэвхжсэн байна. Нэвтэрнэ үү.",
    };
  }
  if (user.tenant.suspended) {
    return {
      ok: false,
      step: "verify",
      identifier,
      message:
        "Таны байгууллагын хандалт түр зогссон байна. carservice.mn-тай холбоо барина уу.",
    };
  }

  const { checkUserActive } = await import("@/lib/auth/active");
  const active = checkUserActive({
    isActive: user.isActive,
    activeUntil: user.activeUntil,
  });
  if (!active.ok) {
    return { ok: false, step: "verify", identifier, message: active.message };
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      verified: true,
      failedLoginAttempts: 0,
      lockedAt: null,
      // Өөрөө хаасан ажилтныг админ нууц үг шинэчилсэн бол — login-той адил сэргээнэ,
      // эс бөгөөс шинэ session дараагийн хүсэлтэд 401 болно.
      deactivatedAt: null,
    },
  });
  await revokeAllOtps(email, "SET_PASSWORD");

  // Web session-ийг DB-д бүртгэж, шууд нэвтрүүлнэ.
  const h = await headers();
  const ua = h.get("user-agent");
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    null;
  const session = await createUserSession({ userId: user.id, userAgent: ua, ip });
  const locked = await resolveTodayLockedBranch(user);
  const token = await signSession({
    userId: user.id,
    tenantId: user.tenantId,
    isOwner: user.isOwner,
    sid: session.id,
    workingBranchId: locked?.branchId ?? seedWorkingBranchId(user),
  });
  await setSessionCookie(token);

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "User",
    entityId: user.id,
    action: "LOGIN",
    summary: `${user.email} · аккаунт идэвхжүүлэв`,
  });

  redirect("/dashboard");
}

// ---- CHOOSE WORKING BRANCH -------------------------------------------------
// Owner, эсвэл 2 ба түүнээс дээш салбарт ажилладаг ажилтан (branchId +
// assignableBranchIds — харах lib/auth/roles.ts eligibleBranchIds) нэвтрэх
// бүрдээ ажиллах салбараа (owner/тогтмол салбаргүй бол "Бүх салбар" ч)
// сонгоно. proxy.ts-ийн middleware workingBranchId байхгүй session-г
// /page/choose-branch руу чиглүүлдэг (харах: lib/auth/session.ts, proxy.ts).

export type ChooseBranchState = {
  ok: boolean;
  message?: string;
} | null;

export async function chooseBranchAction(
  _prev: ChooseBranchState,
  formData: FormData,
): Promise<ChooseBranchState> {
  const branchId = getStr(formData, "branchId");
  const nextRaw = getStr(formData, "next");
  const next = safeNext(nextRaw, "/dashboard");
  if (!branchId) return { ok: false, message: "Салбараа сонгоно уу." };

  // Session/tenant хараахан бүрэн тогтоогоогүй үе тул bypass-аар эхэлнэ.
  setBypassContext();
  const session = await getSession();
  if (!session) redirect("/page/login");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      isOwner: true,
      branchId: true,
      assignableBranchIds: true,
      tenantId: true,
    },
  });
  if (!user) redirect("/page/login");
  setTenantContext(user.tenantId);

  // Өнөөдрийн ажлын хувиараар тодорхой салбар түгжигдсэн бол (харах:
  // lib/employee-branch-lock.ts) гараар өөр салбар сонгохыг хориглоно —
  // UI талд switcher/choose-branch аль хэдийн нуугдсан ч defense-in-depth-
  // ийн үүднээс server дээр давхар шалгана.
  const locked = await resolveTodayLockedBranch({
    id: session.userId,
    tenantId: user.tenantId,
    branchId: user.branchId,
  });
  if (locked && branchId !== locked.branchId) {
    return {
      ok: false,
      message: `Өнөөдрийн ажлын хувиараар «${locked.branchName}» салбарт ажиллахаар тогтоогдсон тул өөр салбар сонгох боломжгүй.`,
    };
  }

  let workingBranchId: string;
  if (branchId === ALL_BRANCHES) {
    if (!canChooseAllBranches(user)) {
      return { ok: false, message: "Танд «Бүх салбар» сонгох эрх байхгүй." };
    }
    workingBranchId = ALL_BRANCHES;
  } else {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, tenantId: user.tenantId, isActive: true },
      select: { id: true },
    });
    if (!branch) return { ok: false, message: "Сонгосон салбар олдсонгүй." };

    // Owner эсвэл тогтмол салбаргүй ч нэмэлт сонголтгүй ("Бүх салбар"-аар
    // хамрагдсан) ажилтан ямар ч тенантын салбарыг сонгож болно. 2+ салбарт
    // ажилладаг (эсвэл цор ганц branchId-тай) ажилтныг зөвхөн ӨӨРИЙН
    // eligibleBranchIds жагсаалтад хязгаарлана.
    const eligible = eligibleBranchIds(user);
    if (!user.isOwner && eligible.length > 0 && !eligible.includes(branch.id)) {
      return { ok: false, message: "Танд энэ салбарыг сонгох эрх байхгүй." };
    }
    workingBranchId = branch.id;
  }

  const token = await signSession({
    userId: session.userId,
    tenantId: session.tenantId,
    isOwner: session.isOwner,
    sid: session.sid,
    workingBranchId,
  });
  await setSessionCookie(token);

  redirect(next);
}

// ---- SYNC WORKING BRANCH TO ROSTER ----------------------------------------
// Ажлын хувиараар өнөөдөр өөр салбар түгжигдсэн (харах:
// lib/employee-branch-lock.ts) боловч session-ий workingBranchId хуучирсан
// (өчигдрийн, эсвэл гараар сонгосон өөр) бол автоматаар шинэчилнэ.
// app/dashboard/layout.tsx энэ мисматчийг илрүүлж client component
// (branch-roster-sync.tsx)-аар дамжуулан mount дээр дуудна — Server
// Component render-ийн үед cookie бичих боломжгүй тул action хэлбэрээр.

export type SyncWorkingBranchResult = {
  swapped: boolean;
  branchName?: string;
};

export async function syncWorkingBranchToRosterAction(): Promise<SyncWorkingBranchResult> {
  setBypassContext();
  const session = await getSession();
  if (!session) return { swapped: false };

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { tenantId: true, branchId: true },
  });
  if (!user) return { swapped: false };
  setTenantContext(user.tenantId);

  const locked = await resolveTodayLockedBranch({
    id: session.userId,
    tenantId: user.tenantId,
    branchId: user.branchId,
  });
  if (!locked || session.workingBranchId === locked.branchId) {
    return { swapped: false };
  }

  const token = await signSession({
    userId: session.userId,
    tenantId: session.tenantId,
    isOwner: session.isOwner,
    sid: session.sid,
    workingBranchId: locked.branchId,
  });
  await setSessionCookie(token);

  return { swapped: true, branchName: locked.branchName };
}
