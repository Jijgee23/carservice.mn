"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  canChooseAllBranches,
  eligibleBranchIds,
} from "@/lib/auth/roles";
import { safeNext } from "@/lib/safe-redirect";
import { normalizeRegno, regnoKind, splitPersonName } from "@/lib/tenant-regno";
import {
  createTenantWithOwner,
  findTenantSignupConflicts,
  type TenantSignupInput,
  validateTenantSignup,
} from "@/lib/auth/tenant-signup";
import {
  clearSessionCookie,
  setSessionCookie,
} from "@/lib/auth/cookies";
import { getSession } from "@/lib/auth";
import { issueOtp, revokeAllOtps, verifyOtp } from "@/lib/auth/otp";
import { revokeAllForUser } from "@/lib/auth/refresh-token";
import {
  MAX_LOGIN_ATTEMPTS,
  recordFailedLogin,
  revokeAllUserSessions,
} from "@/lib/auth/login-lockout";
import { resolveInitialWorkingBranchId } from "@/lib/auth/initial-working-branch";
import { ALL_BRANCHES, signSession } from "@/lib/auth/session";
import { resolveTodayLockedBranch } from "@/lib/employee-branch-lock";
import { notifySuperAdmins } from "@/lib/notifications";
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
import {
  consumeRateLimit,
  ipFromHeaders,
  ipOrNull,
  LOGIN_WINDOW_MS,
  RATE_LIMITED_MESSAGE,
} from "@/lib/rate-limit";
import { setBypassContext, setTenantContext } from "@/lib/tenant-context";
import { sendOtpSms } from "@/lib/sms";
import { logAudit } from "@/lib/audit";

export type SignUpFormValues = {
  orgName: string;
  registerNumber: string;
  orgEmail: string;
  phone1: string;
  phone2: string;
  lastName: string;
  firstName: string;
  ownerName: string;
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

// Ажилтны нэвтрэх нэр — имэйл ЭСВЭЛ утасны дугаар (харах: lib/auth/login-identifier.ts).
/** Form-ын `identifier` (хуучин `email`) талбарыг задлана. Хүчингүй бол null. */
function getIdentifier(fd: FormData): LoginIdentifier | null {
  return parseLoginIdentifier(getStr(fd, "identifier") || getStr(fd, "email"));
}

// ---- SIGN UP --------------------------------------------------------------
// Шалгалт/давхцал/transaction нь lib/auth/tenant-signup.ts-д (мобайл
// /api/v1/auth/signup-тэй хуваалцана).

export async function signUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Шинэ tenant бүртгэгдэх урсгал — session/tenant хараахан байхгүй.
  setBypassContext();

  // Үндсэн салбар — байршлыг зөвхөн газрын зураг дээр тэмдэглэнэ (заавал).
  // Хот/дүүрэг/хороо/хаяг нь тэр цэгийн reverse geocode-оос ирнэ (олдохгүй бол хоосон).
  // Admin (OWNER) — утас/имэйлийг 1-р алхмаас авна (тусдаа админ алхамгүй).
  const input: TenantSignupInput = {
    orgName: getStr(formData, "orgName"),
    registerNumber: getStr(formData, "registerNumber"),
    orgEmail: getStr(formData, "orgEmail"),
    phone1: getStr(formData, "phone1"),
    ownerName: getStr(formData, "ownerName"),
    password: getStr(formData, "password"),
    passwordConfirm: getStr(formData, "passwordConfirm"),
    city: getStr(formData, "city"),
    district: getStr(formData, "district"),
    khoroo: getStr(formData, "khoroo"),
    address: getStr(formData, "address"),
    latitude: getStr(formData, "latitude"),
    longitude: getStr(formData, "longitude"),
  };

  // OTP — хоёр дахь шатанд илгээгдэнэ
  const otpCode = getStr(formData, "otpCode");

  // Алдаа гарсан үед form-руу буцаах нэг удаагийн "values" snapshot
  const registerNumber = normalizeRegno(input.registerNumber);
  const isPerson = regnoKind(registerNumber) === "person";
  const ownerName = isPerson ? "" : input.ownerName;
  const { lastName, firstName } = splitPersonName(isPerson ? input.orgName : ownerName);
  const orgEmail = input.orgEmail.toLowerCase();
  const values: SignUpFormValues = {
    orgName: input.orgName,
    registerNumber,
    orgEmail,
    phone1: input.phone1,
    phone2: "",
    lastName,
    firstName,
    ownerName,
    adminPhone: input.phone1,
    adminEmail: orgEmail,
  };

  const validated = validateTenantSignup(input);
  if (!validated.ok) {
    return { ok: false, fieldErrors: validated.fieldErrors, values };
  }
  const data = validated.data;

  // --- 1-р шат: OTP илгээх ---
  // Дугаар / имэйл аль хэдийн бүртгэгдсэн эсэхийг урьдчилан шалгаж, дараа нь
  // SMS-ээр код илгээнэ.
  if (!otpCode) {
    const conflicts = await findTenantSignupConflicts(data);
    if (conflicts) return { ok: false, fieldErrors: conflicts, values };

    const h = await headers();
    const ua = h.get("user-agent");
    const ip = ipOrNull(h);

    // SIGNUP OTP нь утсаар түлхүүрлэгдэнэ (lib/auth/otp.ts) — код очсон утас
    // л 2-р шатанд баталгаажина.
    const { code } = await issueOtp({
      phone: data.phone,
      type: "SIGNUP",
      userAgent: ua,
      ip,
    });
    const sent = await sendOtpSms(code, "SIGNUP", data.phone);
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
      message: `Утас ${input.phone1} руу 6 оронтой код илгээлээ. Кодоо оруулна уу.`,
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
    phone: data.phone,
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

  // 1-р шатнаас хойш өөр хэн нэгэн ижил РД/утас/имэйлээр бүртгүүлсэн байж
  // болох тул давхцлыг дахин шалгана (1-р шаттай ижил fieldErrors).
  const lateConflicts = await findTenantSignupConflicts(data);
  if (lateConflicts) return { ok: false, fieldErrors: lateConflicts, values };

  // Transaction: Tenant + салбар + OWNER User
  const result = await createTenantWithOwner(data);
  if (!result.ok) {
    return "fieldErrors" in result
      ? { ok: false, fieldErrors: result.fieldErrors, values }
      : { ok: false, message: result.message, values };
  }
  const session = result.created;

  // Web session-ийг DB-д бүртгэж, JWT-д sid шигтгэнэ (revoke/төхөөрөмжийн жагсаалт).
  const h = await headers();
  const userSession = await createUserSession({
    userId: session.userId,
    userAgent: h.get("user-agent"),
    ip: ipOrNull(h),
  });
  const token = await signSession({ ...session, sid: userSession.id });
  await setSessionCookie(token);

  try {
    await notifySuperAdmins({
      type: "tenant_created",
      input: { tenantId: session.tenantId, tenantName: data.orgName },
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
    const ip = ipOrNull(h);
    const { code } = await issueOtp({
      email: user.email,
      phone: user.phone,
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
    // Атомаар нэмнэ — зэрэгцээ оролдлогууд тоологчийг дарахгүй.
    const { locked, remaining } = await recordFailedLogin(user.id, MAX_LOGIN_ATTEMPTS);
    if (locked) {
      return {
        ok: false,
        message:
          "Хэт олон удаа буруу оролдсон тул аккаунт түгжигдсэн. Нууц үгээ сэргээнэ үү.",
      };
    }
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
  const ip = ipOrNull(h);
  const session = await createUserSession({ userId: user.id, userAgent: ua, ip });

  // Өнөөдрийн ажлын хувиараар тодорхой салбар "түгжигдсэн" бол (харах:
  // lib/employee-branch-lock.ts) сонголт хийлгэхгүйгээр шууд тэр рүү нь
  // оруулна — олон салбарт ажилладаг ч гэсэн өнөөдрийн хувиар
  // ойлгомжтой байвал choose-branch алгасна. Үгүй бол хуучин дүрэм: яг НЭГ
  // сонголттой (branchId + assignableBranchIds) ажилтан шууд тэр салбартаа
  // ажилладаг гэж тооцно; Owner/2+ салбарт ажилладаг ажилтныг undefined-ээр
  // үлдээж, дараагийн /dashboard хүсэлт дээр proxy.ts /page/choose-branch
  // руу чиглүүлнэ (харах: lib/auth/roles.ts seedWorkingBranchId).
  // Сонгох салбар ганцхан бол (хувиараар түгжигдсэн, 1 eligible, эсвэл
  // байгууллага 1 салбартай) choose-branch-ийг алгасна.
  const token = await signSession({
    userId: user.id,
    tenantId: user.tenantId,
    isOwner: user.isOwner,
    sid: session.id,
    workingBranchId: await resolveInitialWorkingBranchId(user),
  });
  await setSessionCookie(token);

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "User",
    entityId: user.id,
    action: "LOGIN",
    summary: user.email ?? user.phone,
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
    const ip = ipOrNull(h);
    const { code } = await issueOtp({
      email: user.email,
      phone: user.phone,
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
    select: { id: true, email: true, phone: true, tenantId: true },
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

  const otp = await verifyOtp({ email, phone: user.phone, type: "RESET_PASSWORD", code });
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
  // Бүх идэвхтэй refresh token + web session-уудыг хүчингүй болгож, бусад OTP-уудыг ч revoke
  await Promise.all([
    revokeAllForUser(user.id),
    revokeAllUserSessions(user.id),
    revokeAllOtps({ email, phone: user.phone }, "RESET_PASSWORD"),
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
    const ip = ipOrNull(h);
    const { code } = await issueOtp({
      email: user.email,
      phone: user.phone,
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

  const otp = await verifyOtp({ email, phone: user.phone, type: "SET_PASSWORD", code });
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
  await revokeAllOtps({ email, phone: user.phone }, "SET_PASSWORD");

  // Web session-ийг DB-д бүртгэж, шууд нэвтрүүлнэ.
  const h = await headers();
  const ua = h.get("user-agent");
  const ip = ipOrNull(h);
  const session = await createUserSession({ userId: user.id, userAgent: ua, ip });
  // Сонгох салбар ганцхан бол (хувиараар түгжигдсэн, 1 eligible, эсвэл
  // байгууллага 1 салбартай) choose-branch-ийг алгасна.
  const token = await signSession({
    userId: user.id,
    tenantId: user.tenantId,
    isOwner: user.isOwner,
    sid: session.id,
    workingBranchId: await resolveInitialWorkingBranchId(user),
  });
  await setSessionCookie(token);

  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "User",
    entityId: user.id,
    action: "LOGIN",
    summary: `${user.email ?? user.phone} · аккаунт идэвхжүүлэв`,
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
