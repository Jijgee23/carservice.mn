// System админы мобайл нэвтрэлтийн brute-force түгжээ — ХУГАЦААТ (байнгын БИШ). Байнгын түгжээ нь халдагчид ганц
// root-ыг түгжиж платформыг удирдах боломжгүй болгох (DoS) аргыг өгөх тул 15 минутын дараа өөрөө нээгдэнэ.
// lib/auth/login-lockout.ts (ажилтан)-ын атомар `increment` зарчим: уншсан утга дээр +1 хийвэл зэрэгцээ буруу
// оролдлого нэг нэгнийгээ дарна.

import { prisma } from "@/lib/prisma";

export const SYSTEM_MAX_LOGIN_ATTEMPTS = 5;
export const SYSTEM_LOCK_MS = 15 * 60_000;

/** PURE: одоо түгжээтэй юу. */
export function isSystemLocked(lockedUntil: Date | null | undefined, now: Date): boolean {
  return Boolean(lockedUntil && lockedUntil.getTime() > now.getTime());
}

type Db = Pick<typeof prisma, "superAdmin">;

/**
 * Буруу нууц үгийг атомаар бүртгэнэ. Лимитэд хүрвэл түгжээг тавьж тоолуурыг тэглэнэ (дараа нээгдэхэд шинэ 5 оролдлого).
 * Түгжээ аль хэдийн идэвхтэй бол дахин сунгахгүй (зэрэгцээ хүсэлт түгжээг хязгааргүй сунгахаас сэргийлнэ).
 */
export async function recordSystemFailedLogin(
  adminId: string,
  now: Date = new Date(),
  db: Db = prisma,
): Promise<{ locked: boolean; remaining: number }> {
  const updated = await db.superAdmin.update({
    where: { id: adminId },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true },
  });
  if (updated.failedLoginAttempts < SYSTEM_MAX_LOGIN_ATTEMPTS) {
    return { locked: false, remaining: SYSTEM_MAX_LOGIN_ATTEMPTS - updated.failedLoginAttempts };
  }
  await db.superAdmin.updateMany({
    where: { id: adminId, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
    data: { lockedUntil: new Date(now.getTime() + SYSTEM_LOCK_MS), failedLoginAttempts: 0 },
  });
  return { locked: true, remaining: 0 };
}

/** Амжилттай нэвтэрсний дараа тоолуур болон хугацаа дууссан түгжээг цэвэрлэнэ. */
export async function clearSystemLoginFailures(adminId: string, db: Db = prisma): Promise<void> {
  await db.superAdmin.updateMany({
    where: { id: adminId, OR: [{ failedLoginAttempts: { gt: 0 } }, { lockedUntil: { not: null } }] },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
}
