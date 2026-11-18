/**
 * System realm-ийн мобайл refresh token. lib/auth/account-refresh-token.ts-тэй ИЖИЛ зарчим: опак random, DB-д
 * sha256, ротаци, ротаци хийгдсэн token дахин ирвэл — 60 сек дотор «сүлжээний дахин оролдлого» (зөвхөн invalid),
 * хожим бол хулгай (админы бүх token revoke). Ялгаа: нууц үг солих/сэргээхэд `revokeAllSystemRefreshTokens`-ийг
 * дуудна (tokenVersion байхгүй), идэвхгүй админ refresh хийж чадахгүй.
 * Ротаци transaction-гүй: lib/prisma.ts-ийн extension interactive $transaction-ийг rollback хийдэггүй тул
 * compare-and-set + хожигдсон хүсэлт өөрийн үүсгэсэн мөрийг устгана.
 */

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const SYSTEM_REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;
export const SYSTEM_REFRESH_REUSE_GRACE_MS = 60_000;
export const SYSTEM_REFRESH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type Db = Pick<typeof prisma, "superAdminRefreshToken" | "superAdmin">;

const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");
const generateRaw = () => randomBytes(32).toString("base64url");

export type SystemRefreshMeta = { userAgent?: string | null; ip?: string | null; now?: Date };

export async function issueSystemRefreshToken(
  input: { adminId: string } & SystemRefreshMeta,
  db: Db = prisma,
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  const raw = generateRaw();
  const expiresAt = new Date(now.getTime() + SYSTEM_REFRESH_MAX_AGE_SECONDS * 1000);
  const row = await db.superAdminRefreshToken.create({
    data: { tokenHash: hashToken(raw), adminId: input.adminId, userAgent: input.userAgent ?? null, ip: input.ip ?? null, expiresAt },
    select: { id: true },
  });
  return { id: row.id, token: raw, expiresAt };
}

export async function revokeAllSystemRefreshTokens(adminId: string, db: Db = prisma, now: Date = new Date()): Promise<number> {
  const r = await db.superAdminRefreshToken.updateMany({ where: { adminId, revokedAt: null }, data: { revokedAt: now } });
  return r.count;
}

export async function revokeSystemRefreshToken(rawToken: string, db: Db = prisma, now: Date = new Date()): Promise<void> {
  await db.superAdminRefreshToken.updateMany({ where: { tokenHash: hashToken(rawToken), revokedAt: null }, data: { revokedAt: now } });
}

async function pruneOld(db: Db, adminId: string, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - SYSTEM_REFRESH_RETENTION_MS);
  await db.superAdminRefreshToken.deleteMany({ where: { adminId, OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] } });
}

export type SystemRotateResult =
  | { ok: true; id: string; token: string; expiresAt: Date; adminId: string; email: string; passwordHash: string }
  | { ok: false; reason: "invalid" | "expired" | "reused" };

export async function rotateSystemRefreshToken(rawToken: string, opts: SystemRefreshMeta = {}, db: Db = prisma): Promise<SystemRotateResult> {
  const now = opts.now ?? new Date();
  const existing = await db.superAdminRefreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { id: true, adminId: true, expiresAt: true, revokedAt: true, replacedById: true },
  });
  if (!existing) return { ok: false, reason: "invalid" };

  const reusedVerdict = async (): Promise<SystemRotateResult> => {
    const row = await db.superAdminRefreshToken.findUnique({ where: { id: existing.id }, select: { revokedAt: true, replacedById: true } });
    if (!row?.replacedById) return { ok: false, reason: "invalid" }; // зориуд revoke (logout / нууц үг солих)
    const recent = row.revokedAt && now.getTime() - row.revokedAt.getTime() < SYSTEM_REFRESH_REUSE_GRACE_MS;
    if (recent) return { ok: false, reason: "invalid" };
    await revokeAllSystemRefreshTokens(existing.adminId, db, now);
    return { ok: false, reason: "reused" };
  };

  if (existing.revokedAt) return reusedVerdict();
  if (existing.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };

  const admin = await db.superAdmin.findUnique({
    where: { id: existing.adminId },
    select: { id: true, email: true, isActive: true, passwordHash: true },
  });
  if (!admin || !admin.isActive) {
    await db.superAdminRefreshToken.updateMany({ where: { id: existing.id, revokedAt: null }, data: { revokedAt: now } });
    return { ok: false, reason: "invalid" };
  }

  const newRaw = generateRaw();
  const newExpiresAt = new Date(now.getTime() + SYSTEM_REFRESH_MAX_AGE_SECONDS * 1000);
  const row = await db.superAdminRefreshToken.create({
    data: { tokenHash: hashToken(newRaw), adminId: existing.adminId, userAgent: opts.userAgent ?? null, ip: opts.ip ?? null, expiresAt: newExpiresAt },
    select: { id: true },
  });
  const revoked = await db.superAdminRefreshToken.updateMany({
    where: { id: existing.id, revokedAt: null },
    data: { revokedAt: now, lastUsedAt: now, replacedById: row.id },
  });
  if (revoked.count !== 1) {
    await db.superAdminRefreshToken.deleteMany({ where: { id: row.id } });
    return reusedVerdict();
  }

  await pruneOld(db, existing.adminId, now).catch(() => {});
  return { ok: true, id: row.id, token: newRaw, expiresAt: newExpiresAt, adminId: admin.id, email: admin.email, passwordHash: admin.passwordHash };
}
