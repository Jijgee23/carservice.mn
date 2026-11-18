// Account-ийн нэвтрэлтийн хариуны token хэсгийг бүрдүүлнэ: verify-otp, login-password, нууц үг солих/устгах
// (шинэ token буцаадаг) бүгд ЭНЭ нэг цэгийг дуудна.
//  - "legacy": өмнөх хариу (зөвхөн хугацаагүй accessToken) — refresh-ийг мэдэхгүй апп.
//  - "refresh": хугацаатай accessToken + refreshToken. Апп `supportsRefresh: true` илгээснээр сонгоно.

import { ACCOUNT_ACCESS_TOKEN_SECONDS, signAccountApiToken, signExpiringAccountApiToken } from "./account-api-token";
import { ACCOUNT_REFRESH_TOKEN_MAX_AGE_SECONDS, issueAccountRefreshToken } from "./account-refresh-token";
import { ipOrNull } from "@/lib/rate-limit";

export type AccountSessionMode = "legacy" | "refresh";

export type AccountTokenFields =
  | { accessToken: string }
  | {
      accessToken: string;
      accessTokenExpiresInSeconds: number;
      refreshToken: string;
      refreshTokenExpiresInSeconds: number;
      refreshTokenExpiresAt: string;
    };

/** Нэвтрэх хүсэлтийн body-д `supportsRefresh: true` байвал refresh горим. */
export function wantsRefreshSession(body: unknown): boolean {
  return Boolean(body && typeof body === "object" && (body as { supportsRefresh?: unknown }).supportsRefresh === true);
}

/** Нууц үг солих зэрэг АЛЬ ХЭДИЙН нэвтэрсэн хүсэлтэд: одоогийн token хугацаатай (exp-тэй) бол refresh горим. */
export function modeForExistingToken(tokenExp: number | null): AccountSessionMode {
  return tokenExp !== null ? "refresh" : "legacy";
}

export async function issueAccountSession(
  account: { id: string; phone: string; tokenVersion: number },
  mode: AccountSessionMode,
  req: Request,
): Promise<AccountTokenFields> {
  const claims = { accountId: account.id, phone: account.phone, tv: account.tokenVersion };
  if (mode === "legacy") return { accessToken: await signAccountApiToken(claims) };

  const refresh = await issueAccountRefreshToken({
    accountId: account.id,
    tokenVersion: account.tokenVersion,
    userAgent: req.headers.get("user-agent"),
    ip: ipOrNull(req.headers),
  });
  return {
    accessToken: await signExpiringAccountApiToken(claims),
    accessTokenExpiresInSeconds: ACCOUNT_ACCESS_TOKEN_SECONDS,
    refreshToken: refresh.token,
    refreshTokenExpiresInSeconds: ACCOUNT_REFRESH_TOKEN_MAX_AGE_SECONDS,
    refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
  };
}
