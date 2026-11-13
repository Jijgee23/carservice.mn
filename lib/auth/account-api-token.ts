import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";
import { createJwtSession } from "@/lib/auth/jwt-session";

// Эцсийн хэрэглэгчийн (Account) мобайл API token. User-ийн api-token-аас tag-аар
// тусгаарлагдсан. Refresh-гүй, хугацаагүй (`exp` claim-гүй). Хүчингүй болгох арга:
//  - Account.isActive = false / deactivatedAt / deletedAt (getApiAccountFromRequest шалгана);
//  - `tv` (Account.tokenVersion) — нууц үг тохируулах/солих/устгах, хаасан
//    аккаунтыг сэргээхэд нэмэгдэж, өмнө олгосон бүх token хүчингүй болно.
//    `tv`-гүй (хуучин) token-ийг 0 гэж үзнэ — tokenVersion 0 хэвээр бол ажиллана.

export type AccountTokenPayload = {
  accountId: string;
  phone: string;
  /** Account.tokenVersion — олгох үеийн утга. */
  tv: number;
};

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

const client = createJwtSession<AccountTokenPayload>({
  tag: "account-api",
  secretEnvVars: ["API_TOKEN_SECRET", "SESSION_SECRET"],
  parse(payload) {
    if (!payload.accountId || !payload.phone) return null;
    const tv = parseTokenVersion(payload.tv);
    if (tv === null) return null;
    return {
      accountId: payload.accountId as string,
      phone: payload.phone as string,
      tv,
    };
  },
});

export const signAccountApiToken = client.sign;
export const verifyAccountApiToken = client.verify;

/** Authorization: Bearer <token>-аас Account-ийг тогтооно. Хүчингүй бол null. */

export async function getApiAccountFromRequest(req: Request) {
  // JWT verify (jose/WebCrypto)-ээс өмнө context тавина — Account глобал
  // (tenant-гүй) объект тул bypass (lib/auth/account.ts-ийн getAccount-той адил).
  setBypassContext();
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const payload = await verifyAccountApiToken(match[1]);
  if (!payload) return null;
  const account = await prisma.account.findUnique({
    where: { id: payload.accountId },
  });
  if (!account || !account.isActive || account.deactivatedAt || account.deletedAt) return null;
  if (!tokenVersionMatches(payload.tv, account.tokenVersion)) return null;
  return account;
}
