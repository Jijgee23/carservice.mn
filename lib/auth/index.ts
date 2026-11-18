import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { setBypassContext, setTenantContext } from "@/lib/tenant-context";
import { checkUserActive } from "./active";
import { EFFECTIVE_ROLE_SELECT, resolveEffectiveRole } from "./load-effective";
import { clearSessionCookie, getSessionCookie } from "./cookies";
import { ALL_BRANCHES, verifySession, type SessionPayload } from "./session";
import { validateUserSession } from "./user-session";

export type { SessionPayload } from "./session";

/**
 * Cookie-оос session-ийг уншиж, баталгаажуулна. Хүчингүй бол null.
 * Request бүрд нэг л удаа дуудна (React cache).
 */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  // ЧУХАЛ: enterWith-г JWT verify (WebCrypto ашигладаг, jose) зэрэг async
  // үйлдлээс ӨМНӨ дуудах ёстой — эс бөгөөс дараа нь тавьсан context Node.js-ийн
  // async_hooks-ийн зарим хувилбарт "алга" болдог нюанс ажиглагдсан (бодит
  // тест: crypto үйлдлийн өмнө нэг ч удаа enterWith дуудагдаагүй байхад дараа
  // нь дуудсан context дараагийн prisma query-д харагдахгүй байсан).
  setBypassContext();
  const token = await getSessionCookie();
  if (!token) return null;
  const payload = await verifySession(token);
  if (!payload) return null;
  // DB session-ийг шалгана (UserSession — tenant-гүй хүснэгт). sid-гүй
  // token-ийг verifySession өөрөө татгалзана.
  if (!payload.sid || !(await validateUserSession(payload.sid))) return null;
  return payload;
});

/**
 * Server Component / Server Action дотроос дуудна. Session байхгүй бол /page/login руу redirect.
 */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/page/login");
  return session;
}

/**
 * Одоогийн нэвтэрсэн хэрэглэгчийг tenant-тай нь хамт буцаана.
 * Request бүрд нэг л удаа DB-д хандана.
 */
const loadCurrentUser = cache(async () => {
  const session = await requireSession();
  // Ямар tenant-тай болохыг хараахан мэдэхгүй тул өөрийн session.userId-аар
  // (найдвартай, сервэрийн session-оос гарсан id) нэг мөр татахад л bypass —
  // доор tenantId олдмогц бүх дараагийн query-г тухайн tenant-д хязгаарлана.
  setBypassContext();
  const dbUser = await prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      tenant: true,
      role: { select: EFFECTIVE_ROLE_SELECT },
    },
  });
  if (!dbUser) redirect("/page/login");

  // Идэвхгүй / хугацаа дууссан хэрэглэгчийг session-оос гаргана
  const active = checkUserActive({
    isActive: dbUser.isActive,
    activeUntil: dbUser.activeUntil,
    deactivatedAt: dbUser.deactivatedAt,
  });
  if (!active.ok) {
    await clearSessionCookie();
    redirect("/page/login");
  }
  setTenantContext(dbUser.tenantId);
  // Роль глобал: супер админ идэвхгүй болгосон бол бүх tenant-ийн эзэмшигчид шууд эрхгүй болно.
  // role.permissions нь ҮР ДҮНТЭЙ эрх (роль + байгууллагын override − ажилтны хязгаарлалт) —
  // sidebar, order-access, hasPermission зэрэг бүх уншигч өөрчлөлтгүй зөв ажиллана.
  // Tenant context тавигдсаны ДАРАА (TenantRoleOverride RLS-тэй; await-аас өмнө context тавих дүрэм).
  const user = { ...dbUser, role: await resolveEffectiveRole(dbUser) };

  // Тухайн нэвтрэлтэд сонгосон ажиллах салбарыг тодруулна (harах:
  // lib/auth/session.ts). Жинхэнэ Branch.id бол нэрийг нь татаж баннерт
  // ашиглана; устгагдсан/идэвхгүй болсон бол "сонгоогүй" мэт үзнэ (proxy.ts-ийн
  // middleware дараагийн хүсэлт дээр дахин сонгуулна).
  let workingBranch: { id: string; name: string } | null = null;
  let workingBranchId = session.workingBranchId;
  if (workingBranchId && workingBranchId !== ALL_BRANCHES) {
    workingBranch = await prisma.branch.findFirst({
      where: { id: workingBranchId, tenantId: user.tenantId, isActive: true },
      select: { id: true, name: true },
    });
    if (!workingBranch) workingBranchId = undefined;
  }

  return { ...user, workingBranchId, workingBranch };
});

/**
 * `cache()` нь хэрэглэгчийг request-д нэг удаа татна, гэхдээ tenant context
 * (AsyncLocalStorage.enterWith) зөвхөн анхны дуудлагын async салбарт
 * тохируулагдана. Cache hit (жишээ нь action-ий дараах re-render дотор
 * notification bell) context-гүй үлдэж query throw хийдэг байсан тул дуудлага
 * бүрд дахин тохируулна.
 */
export async function requireUser() {
  const user = await loadCurrentUser();
  setTenantContext(user.tenantId);
  return user;
}

/**
 * Redirect хийхгүй хувилбар — session хүчинтэй, DB session (sid) цуцлагдаагүй,
 * хэрэглэгч идэвхтэй бол true. Login/signup хуудсууд "аль хэдийн нэвтэрсэн
 * бол консол руу" шилжүүлэхэд ашиглана. JWT-г л биш DB-г бүрэн шалгадаг нь
 * чухал: зөвхөн JWT-ээр шийдвэл цуцлагдсан session дээр login ↔ dashboard
 * redirect loop үүснэ.
 */
export async function hasActiveUserSession(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  setBypassContext();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { isActive: true, activeUntil: true, deactivatedAt: true },
  });
  return Boolean(user && checkUserActive(user).ok);
}
