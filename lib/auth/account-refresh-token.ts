/**
 * Эцсийн хэрэглэгчийн (Account) мобайл refresh token. Опак (random байт), DB-д sha256 hex. Нэвтрэхэд олгож,
 * /api/v1/app/auth/refresh-ээр ротаци (хуучныг revoke + шинийг олгоно), /api/v1/app/auth/logout-оор revoke.
 * lib/auth/refresh-token.ts (ажилтан)-тай ижил зарчим, гэхдээ:
 *  - token нь олгох үеийн Account.tokenVersion-г барина → нууц үг солих/устгах/сэргээхэд бүгд автоматаар үхнэ;
 *  - хаасан/идэвхгүй/устгасан Account-д refresh хийхгүй;
 *  - ротаци хийгдсэн token богино хугацаанд (GRACE) дахин ирвэл — сүлжээний алдаа (хариу алдагдаж, апп дахин
 *    оролдсон) гэж үзэж зөвхөн «invalid» буцаана, бүх төхөөрөмжийг гаргахгүй. Хугацаа нь өнгөрсөн бол хулгайн
 *    шинж гэж үзэж Account-ийн бүх refresh token-ыг revoke хийнэ.
 * Дуудагч bypass context тавьсан байх ёстой (Account глобал объект).
 */

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const ACCOUNT_REFRESH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 хоног, ротаци бүрд шинэчлэгдэнэ
/** Ротаци хийгдсэн token дахин ирвэл «сүлжээний дахин оролдлого» гэж үзэх хугацаа. */
export const ACCOUNT_REFRESH_REUSE_GRACE_MS = 60_000;
/** Дууссан/revoke хийсэн мөрийг хэр удаан хадгалах вэ (reuse илрүүлэхэд хэрэгтэй). */
export const ACCOUNT_REFRESH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type Db = Pick<typeof prisma, "accountRefreshToken" | "account">;

const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");
const generateRaw = () => randomBytes(32).toString("base64url");

export type AccountRefreshMeta = { userAgent?: string | null; ip?: string | null; now?: Date };

export async function issueAccountRefreshToken(
  input: { accountId: string; tokenVersion: number } & AccountRefreshMeta,
  db: Db = prisma,
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  const raw = generateRaw();
  const expiresAt = new Date(now.getTime() + ACCOUNT_REFRESH_TOKEN_MAX_AGE_SECONDS * 1000);
  const row = await db.accountRefreshToken.create({
    data: {
      tokenHash: hashToken(raw),
      accountId: input.accountId,
      tokenVersion: input.tokenVersion,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
      expiresAt,
    },
    select: { id: true },
  });
  return { id: row.id, token: raw, expiresAt };
}

export type RotateResult =
  | { ok: true; id: string; token: string; expiresAt: Date; accountId: string; phone: string; tokenVersion: number }
  | { ok: false; reason: "invalid" | "expired" | "reused" };

/** Дууссан/revoke хийсэн хуучин мөрийг цэвэрлэнэ (хүснэгт хязгааргүй өсөхөөс сэргийлнэ) — хямд, accountId-аар индексжсэн. */
async function pruneOld(db: Db, accountId: string, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - ACCOUNT_REFRESH_RETENTION_MS);
  await db.accountRefreshToken.deleteMany({
    where: { accountId, OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
  });
}

export async function revokeAllAccountRefreshTokens(accountId: string, db: Db = prisma, now: Date = new Date()): Promise<number> {
  const r = await db.accountRefreshToken.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: now } });
  return r.count;
}

export async function rotateAccountRefreshToken(rawToken: string, opts: AccountRefreshMeta = {}, db: Db = prisma): Promise<RotateResult> {
  const now = opts.now ?? new Date();
  const existing = await db.accountRefreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { id: true, accountId: true, tokenVersion: true, expiresAt: true, revokedAt: true, replacedById: true },
  });
  if (!existing) return { ok: false, reason: "invalid" };

  // Ротаци хийгдсэн token дахин ирлээ: grace дотор бол сүлжээний дахин оролдлого, дараа нь бол хулгай.
  const reusedVerdict = async (): Promise<RotateResult> => {
    const row = await db.accountRefreshToken.findUnique({ where: { id: existing.id }, select: { revokedAt: true, replacedById: true } });
    if (!row?.replacedById) return { ok: false, reason: "invalid" }; // зориуд revoke (logout)
    const recent = row.revokedAt && now.getTime() - row.revokedAt.getTime() < ACCOUNT_REFRESH_REUSE_GRACE_MS;
    if (recent) return { ok: false, reason: "invalid" };
    await revokeAllAccountRefreshTokens(existing.accountId, db, now);
    return { ok: false, reason: "reused" };
  };

  if (existing.revokedAt) return reusedVerdict();
  if (existing.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };

  // Аккаунт идэвхтэй, token-ы хувилбар одоогийнхтой таарна (нууц үг солигдсон бол бүх token үхсэн).
  const account = await db.account.findUnique({
    where: { id: existing.accountId },
    select: { id: true, phone: true, isActive: true, deactivatedAt: true, deletedAt: true, tokenVersion: true },
  });
  if (!account || !account.isActive || account.deactivatedAt || account.deletedAt || account.tokenVersion !== existing.tokenVersion) {
    await db.accountRefreshToken.updateMany({ where: { id: existing.id, revokedAt: null }, data: { revokedAt: now } });
    return { ok: false, reason: "invalid" };
  }

  const newRaw = generateRaw();
  const newExpiresAt = new Date(now.getTime() + ACCOUNT_REFRESH_TOKEN_MAX_AGE_SECONDS * 1000);
  // Шинийг үүсгээд хуучныг `revokedAt: null` НӨХЦӨЛТЭЙ revoke хийнэ — зэрэгцээ хоёр rotate-оос нэг нь л амжина.
  // Interactive transaction-д найдахгүй: lib/prisma.ts-ийн extension нь query бүрийг тусад нь ажиллуулдаг тул
  // transaction дотор throw хийсэн ч rollback хийгдэхгүй (локал DB дээр зэрэгцээ refresh-ээр баталгаажсан).
  // Тиймээс хожигдсон хүсэлт өөрийн үүсгэсэн мөрийг ӨӨРӨӨ устгана (нөхөх үйлдэл).
  const row = await db.accountRefreshToken.create({
    data: {
      tokenHash: hashToken(newRaw),
      accountId: existing.accountId,
      tokenVersion: existing.tokenVersion,
      userAgent: opts.userAgent ?? null,
      ip: opts.ip ?? null,
      expiresAt: newExpiresAt,
    },
    select: { id: true },
  });
  const revoked = await db.accountRefreshToken.updateMany({
    where: { id: existing.id, revokedAt: null },
    data: { revokedAt: now, lastUsedAt: now, replacedById: row.id },
  });
  if (revoked.count !== 1) {
    // Өрсөлдөгч хүсэлт аль хэдийн ротаци хийсэн: бидний үүсгэсэн token хэнд ч очоогүй — устгаад, төлвөөр нь шийднэ.
    await db.accountRefreshToken.deleteMany({ where: { id: row.id } });
    return reusedVerdict(); // grace дотор → invalid (бүх төхөөрөмжийг гаргахгүй)
  }
  const newId = row.id;

  await pruneOld(db, existing.accountId, now).catch(() => {}); // цэвэрлэгээний алдаа refresh-ийг унагаахгүй
  return { ok: true, id: newId, token: newRaw, expiresAt: newExpiresAt, accountId: account.id, phone: account.phone, tokenVersion: existing.tokenVersion };
}

/** Тухайн token-ыг revoke (logout). Олдохгүй ч алдаагүй (idempotent). */
export async function revokeAccountRefreshToken(rawToken: string, db: Db = prisma, now: Date = new Date()): Promise<void> {
  await db.accountRefreshToken.updateMany({ where: { tokenHash: hashToken(rawToken), revokedAt: null }, data: { revokedAt: now } });
}
