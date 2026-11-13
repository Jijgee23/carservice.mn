/**
 * Ажилтны нэвтрэлтийн brute-force түгжээ + нууц үг сэргээсний дараах session
 * цуцлалт. Web (app/_actions/auth.ts) болон мобайл API (/api/v1/auth/*)
 * хуваалцана.
 *
 * Race-гүй: `failedLoginAttempts`-г `user.failedLoginAttempts + 1` гэж
 * (уншсан утгаас) бичвэл зэрэгцээ буруу оролдлогууд нэг нэгнийгээ дарж
 * тоологч өсөхгүй — атомаар `increment` хийж шинэ утгыг буцаана.
 */

import { prisma } from "@/lib/prisma";

export const MAX_LOGIN_ATTEMPTS = 5;

/**
 * Буруу нууц үгийн оролдлогыг атомаар бүртгэнэ. Лимитэд хүрвэл `lockedAt`-г
 * (аль хэдийн түгжигдээгүй бол) тавина.
 */
export async function recordFailedLogin(
  userId: string,
  maxAttempts: number = MAX_LOGIN_ATTEMPTS,
): Promise<{ attempts: number; locked: boolean; remaining: number }> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true },
  });
  const attempts = updated.failedLoginAttempts;
  const locked = attempts >= maxAttempts;
  if (locked) {
    await prisma.user.updateMany({
      where: { id: userId, lockedAt: null },
      data: { lockedAt: new Date() },
    });
  }
  return { attempts, locked, remaining: Math.max(0, maxAttempts - attempts) };
}

/**
 * Хэрэглэгчийн бүх идэвхтэй web session (UserSession)-ийг цуцална — нууц үг
 * сэргээсний дараа хулгайлагдсан cookie хүчингүй болно.
 */
export async function revokeAllUserSessions(userId: string): Promise<number> {
  const r = await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return r.count;
}
