import { prisma } from "@/lib/prisma";
import { SESSION_MAX_AGE_SECONDS } from "./session";

// lastSeenAt-ийг хэт олон бичихгүйн тулд throttle (5 минут).
const TOUCH_THROTTLE_MS = 5 * 60_000;

export async function createUserSession(opts: {
  userId: string;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  return await prisma.userSession.create({
    data: {
      userId: opts.userId,
      userAgent: opts.userAgent ?? null,
      ip: opts.ip ?? null,
      expiresAt,
    },
    select: { id: true, expiresAt: true },
  });
}

/**
 * Session id хүчинтэй (revoke хийгдээгүй, хугацаа дуусаагүй) эсэхийг шалгаад,
 * lastSeenAt-ийг throttle-той шинэчилнэ. getSession бүрт дуудна.
 */
export async function validateUserSession(sid: string): Promise<boolean> {
  const s = await prisma.userSession.findUnique({
    where: { id: sid },
    select: { revokedAt: true, expiresAt: true, lastSeenAt: true },
  });
  if (!s || s.revokedAt || s.expiresAt.getTime() <= Date.now()) return false;
  if (Date.now() - s.lastSeenAt.getTime() > TOUCH_THROTTLE_MS) {
    await prisma.userSession.update({
      where: { id: sid },
      data: { lastSeenAt: new Date() },
    });
  }
  return true;
}

/** Тодорхой session-ийг revoke (зөвхөн өөрийнхөө). */
export async function revokeUserSession(
  id: string,
  userId: string,
): Promise<void> {
  await prisma.userSession.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Одоогийн session-аас бусад бүх идэвхтэй session-ийг revoke. */
export async function revokeOtherUserSessions(
  userId: string,
  exceptId: string,
): Promise<number> {
  const r = await prisma.userSession.updateMany({
    where: { userId, revokedAt: null, id: { not: exceptId } },
    data: { revokedAt: new Date() },
  });
  return r.count;
}

type SessionRowLike = {
  id: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

/**
 * Session жагсаалтыг идэвхтэй / дууссан болгож хуваана. `new Date()`-г render
 * дотор дуудвал react-hooks/purity алдаа өгдөг тул энд (lib) тооцоолно.
 */
export function splitSessions<T extends SessionRowLike>(
  sessions: T[],
  currentSid: string | null,
): { active: T[]; ended: T[]; otherActiveCount: number } {
  const now = Date.now();
  const active = sessions.filter(
    (s) => !s.revokedAt && s.expiresAt.getTime() > now,
  );
  const ended = sessions.filter(
    (s) => s.revokedAt || s.expiresAt.getTime() <= now,
  );
  const otherActiveCount = active.filter((s) => s.id !== currentSid).length;
  return { active, ended, otherActiveCount };
}

export type SessionStatus = "active" | "revoked" | "expired";

/** Session-ийн төлвийг тооцоолно (now-г lib-д — purity lint-ээс зайлс). */
export function sessionStatus(s: {
  revokedAt: Date | null;
  expiresAt: Date;
}): SessionStatus {
  if (s.revokedAt) return "revoked";
  if (s.expiresAt.getTime() <= Date.now()) return "expired";
  return "active";
}

/** userAgent-аас энгийн уншихуйц шошго ("Chrome · Windows"). */
export function deviceLabel(ua: string | null): string {
  if (!ua) return "Тодорхойгүй төхөөрөмж";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Браузер";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}
