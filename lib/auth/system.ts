import { cache } from "react";
import { redirect } from "next/navigation";
import { isRootKind } from "@/lib/auth/system-permissions";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";
import { clearSystemSessionCookie, getSystemSessionCookie } from "./system-cookies";
import {
  verifySystemSession,
  type SystemSessionPayload,
} from "./system-session";

export type { SystemSessionPayload } from "./system-session";

export const getSystemSession = cache(
  async (): Promise<SystemSessionPayload | null> => {
    // JWT verify (jose/WebCrypto)-ээс өмнө context тавина — lib/auth/index.ts
    // дахь getSession-тэй адил шалтгаанаар (доорх тайлбарыг үз).
    setBypassContext();
    const token = await getSystemSessionCookie();
    if (!token) return null;
    return verifySystemSession(token);
  },
);

export async function requireSystemSession(): Promise<SystemSessionPayload> {
  const session = await getSystemSession();
  if (!session) redirect("/system/login");
  return session;
}

const loadSuperAdmin = cache(async () => {
  const session = await requireSystemSession();
  // Superadmin бүх үйлдэл cross-tenant тул RLS-г бүхэлд нь тойрч гарна.
  setBypassContext();
  const admin = await prisma.superAdmin.findUnique({
    where: { id: session.adminId },
  });
  if (!admin) redirect("/system/login");
  // Өөр admin идэвхгүй болгосон бол сесс хүчинтэй ч энд түлхэж гаргана
  // (харах: app/system/(authed)/admins/ — идэвхгүй болгох, устгахгүй).
  if (!admin.isActive) {
    await clearSystemSessionCookie();
    redirect("/system/login");
  }
  // «System ажилтан» (STAFF) вэб /system-д огт нэвтэрдэггүй — зөвхөн мобайл апп-аар (lib/auth/system-api.ts).
  // requireSuperAdmin нь 70 гаруй газар дуудагддаг ТУЛ энд ROOT-оос өөрийг хаах нь бүх хуудас/action-ыг default-аар
  // аюулгүй болгоно (шинэ хуудас нэмэхэд ажилтан хандахаас сэргийлнэ).
  if (!isRootKind(admin.kind)) {
    await clearSystemSessionCookie();
    redirect("/system/login");
  }
  return admin;
});

/** cache hit-д ч bypass context-г дахин тохируулна (харах: requireUser). */
export async function requireSuperAdmin() {
  const result = await loadSuperAdmin();
  setBypassContext();
  return result;
}

/**
 * Redirect хийхгүй хувилбар — system session хүчинтэй бөгөөд admin идэвхтэй
 * бол true (/system/login-оос /system руу шилжүүлэхэд; loop-оос сэргийлж DB
 * шалгана — харах: hasActiveUserSession).
 */
export async function hasActiveSystemSession(): Promise<boolean> {
  const session = await getSystemSession();
  if (!session) return false;
  setBypassContext();
  const admin = await prisma.superAdmin.findUnique({
    where: { id: session.adminId },
    select: { isActive: true, kind: true },
  });
  return Boolean(admin?.isActive && isRootKind(admin.kind));
}
