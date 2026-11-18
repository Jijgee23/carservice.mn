import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";
import { createJwtSession } from "@/lib/auth/jwt-session";

// Эцсийн хэрэглэгчийн (Account) мобайл API token. User-ийн api-token-аас tag-аар тусгаарлагдсан.
// ХОЁР горим (хоёулаа ижил секрет/tag тул нэг verify хоёуланг шалгана):
//  - "legacy": хугацаагүй (`exp` claim-гүй) — refresh-ийг мэдэхгүй хуучин апп-уудад. Анхдагч; өөрчлөгдөөгүй.
//  - "refresh": ACCOUNT_ACCESS_TOKEN_SECONDS (1 цаг) хугацаатай + refresh token (lib/auth/account-refresh-token.ts).
//    Апп нэвтрэхдээ `supportsRefresh: true` илгээснээр сонгоно.
// Хуучин хугацаагүй token-уудыг ACCOUNT_LEGACY_TOKENS_UNTIL (ISO огноо)-оос хойш хүлээн авахаа болино
// (тохируулаагүй бол үргэлж хүлээн авна → зан төлөв өөрчлөгдөхгүй).
// Хүчингүй болгох арга (хоёр горимд):
//  - Account.isActive = false / deactivatedAt / deletedAt (authenticateAccountRequest шалгана);
//  - `tv` (Account.tokenVersion) — нууц үг тохируулах/солих/устгах, хаасан аккаунтыг сэргээхэд нэмэгдэж,
//    өмнө олгосон бүх access + refresh token хүчингүй болно. `tv`-гүй (хуучин) token-ийг 0 гэж үзнэ.

/** Хугацаатай (refresh горим) access token-ы наслалт. */
export const ACCOUNT_ACCESS_TOKEN_SECONDS = 60 * 60;

export type AccountTokenPayload = {
  accountId: string;
  phone: string;
  /** Account.tokenVersion — олгох үеийн утга. */
  tv: number;
};

/** verify-ийн үр дүн: payload + `exp` (секунд; хугацаагүй legacy token бол null). */
export type VerifiedAccountToken = AccountTokenPayload & { exp: number | null };

/** Payload-ийн `tv`-г задлана; байхгүй (хуучин token) бол 0. Буруу төрөл бол null. */
export function parseTokenVersion(raw: unknown): number | null {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  return null;
}

/** Token-ий хувилбар аккаунтын одоогийн хувилбартай таарч байгаа эсэх. */
export function tokenVersionMatches(tokenTv: number, accountTv: number): boolean {
  return tokenTv === accountTv;
}

/**
 * Хугацаагүй (legacy) token одоо ч хүлээн авах уу. `until` = ACCOUNT_LEGACY_TOKENS_UNTIL (ISO) — байхгүй/буруу
 * бол үргэлж зөвшөөрнө. Хугацаатай (exp-тэй) token-д хамаарахгүй.
 */
export function legacyTokenAllowed(exp: number | null, now: Date, until: string | null | undefined): boolean {
  if (exp !== null) return true;
  if (!until) return true;
  const cutoff = Date.parse(until);
  if (!Number.isFinite(cutoff)) return true;
  return now.getTime() < cutoff;
}

function parseClaims(payload: Record<string, unknown>): VerifiedAccountToken | null {
  if (!payload.accountId || !payload.phone) return null;
  const tv = parseTokenVersion(payload.tv);
  if (tv === null) return null;
  return {
    accountId: payload.accountId as string,
    phone: payload.phone as string,
    tv,
    exp: typeof payload.exp === "number" ? payload.exp : null,
  };
}

const base = { tag: "account-api", secretEnvVars: ["API_TOKEN_SECRET", "SESSION_SECRET"], parse: parseClaims };
const legacyClient = createJwtSession<VerifiedAccountToken>(base);
const expiringClient = createJwtSession<VerifiedAccountToken>({ ...base, maxAgeSeconds: ACCOUNT_ACCESS_TOKEN_SECONDS });

type SignInput = Omit<AccountTokenPayload, never>;
const claimsOf = (p: SignInput) => ({ accountId: p.accountId, phone: p.phone, tv: p.tv }) as VerifiedAccountToken;

/** Хугацаагүй (legacy) token. Хуучин апп-д зориулсан; шинэ код `signExpiringAccountApiToken`-г илүүд үзнэ. */
export const signAccountApiToken = (p: SignInput) => legacyClient.sign(claimsOf(p));
/** Хугацаатай token (ACCOUNT_ACCESS_TOKEN_SECONDS). */
export const signExpiringAccountApiToken = (p: SignInput) => expiringClient.sign(claimsOf(p));
/** Хоёр горимын token-г шалгана (jose нь `exp` байвал хугацааг мөрдөнө). */
export const verifyAccountApiToken = legacyClient.verify;

export type AuthenticatedAccount = {
  account: NonNullable<Awaited<ReturnType<typeof prisma.account.findUnique>>>;
  /** Token-ы `exp` (секунд) — null бол хугацаагүй (legacy) token. */
  tokenExp: number | null;
};

/** Authorization: Bearer <token>-аас Account-ийг тогтооно (token-ы горимтой нь хамт). Хүчингүй бол null. */
export async function authenticateAccountRequest(req: Request, now: Date = new Date()): Promise<AuthenticatedAccount | null> {
  // JWT verify (jose/WebCrypto)-ээс өмнө context тавина — Account глобал
  // (tenant-гүй) объект тул bypass (lib/auth/account.ts-ийн getAccount-той адил).
  setBypassContext();
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const payload = await verifyAccountApiToken(match[1]);
  if (!payload) return null;
  if (!legacyTokenAllowed(payload.exp, now, process.env.ACCOUNT_LEGACY_TOKENS_UNTIL)) return null;
  const account = await prisma.account.findUnique({
    where: { id: payload.accountId },
  });
  if (!account || !account.isActive || account.deactivatedAt || account.deletedAt) return null;
  if (!tokenVersionMatches(payload.tv, account.tokenVersion)) return null;
  return { account, tokenExp: payload.exp };
}

/** Authorization: Bearer <token>-аас Account-ийг тогтооно. Хүчингүй бол null. */
export async function getApiAccountFromRequest(req: Request) {
  return (await authenticateAccountRequest(req))?.account ?? null;
}
