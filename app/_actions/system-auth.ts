"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyPassword } from "@/lib/auth/password";
import {
  clearSystemSessionCookie,
  setSystemSessionCookie,
} from "@/lib/auth/system-cookies";
import { signSystemSession } from "@/lib/auth/system-session";
import { prisma } from "@/lib/prisma";
import {
  consumeRateLimit,
  ipFromHeaders,
  LOGIN_WINDOW_MS,
  RATE_LIMITED_MESSAGE,
} from "@/lib/rate-limit";
import { setBypassContext } from "@/lib/tenant-context";

export type SystemActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  // Submit алдсан үед оруулсан утгуудыг хадгалж form-руу буцаана.
  // React 19-ийн form action нь автоматаар reset хийдэг тул defaultValue-р
  // дамжуулан утгыг сэргээх шаардлагатай.
  values?: { email?: string };
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function signInSystemAction(
  _prev: SystemActionState,
  formData: FormData,
): Promise<SystemActionState> {
  const email = s(formData, "email");
  const password = s(formData, "password");

  const fieldErrors: Record<string, string> = {};
  if (!isEmail(email)) fieldErrors.email = "Имэйл буруу.";
  if (!password) fieldErrors.password = "Нууц үгээ оруулна уу.";
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors, values: { email } };
  }

  // Brute-force хамгаалалт: IP болон имэйлээр тус тусад нь хязгаарлана.
  const ip = ipFromHeaders(await headers());
  const byIp = consumeRateLimit(`system-login-ip:${ip}`, { limit: 20, windowMs: LOGIN_WINDOW_MS });
  const byEmail = consumeRateLimit(`system-login:${email.toLowerCase()}`, {
    limit: 10,
    windowMs: LOGIN_WINDOW_MS,
  });
  if (!byIp.ok || !byEmail.ok) {
    return { ok: false, message: RATE_LIMITED_MESSAGE, values: { email } };
  }

  // SuperAdmin login нь pre-auth, cross-tenant тул RLS-г тойрч гарна.
  setBypassContext();
  const admin = await prisma.superAdmin.findUnique({ where: { email } });
  if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
    return {
      ok: false,
      message: "Имэйл эсвэл нууц үг буруу.",
      values: { email },
    };
  }
  if (!admin.isActive) {
    return {
      ok: false,
      message: "Энэ admin эрх идэвхгүй болсон байна.",
      values: { email },
    };
  }

  // «System ажилтан» вэбээр нэвтэрдэггүй — мобайл апп-аар.
  if (admin.kind !== "ROOT") {
    return {
      ok: false,
      message: "Энэ бүртгэлээр зөвхөн мобайл апп-аар нэвтэрнэ.",
      values: { email },
    };
  }

  const token = await signSystemSession({
    adminId: admin.id,
    email: admin.email,
  });
  await setSystemSessionCookie(token);
  redirect("/system");
}

export async function signOutSystemAction(): Promise<void> {
  await clearSystemSessionCookie();
  redirect("/system/login");
}
