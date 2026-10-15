// P8-B0 — unified session list/revoke logic, extracted from
// `app/_actions/sessions.ts` and `app/dashboard/profile/page.tsx`'s inline
// queries, so the web actions and the future `/api/v1/me/sessions` routes
// (P8-B1) share one core. Framework-free: no `"use server"`, cookies, or
// redirects here; takes an injectable client (mirrors
// `lib/employees/core.ts`) so this file works against an in-memory fake
// client in tests.
//
// D-178: the list is unified across `UserSession` (web) and `RefreshToken`
// (mobile), tagged by `source`. A `RefreshToken` chain (rotation) only
// contributes its latest, non-replaced link — rows with `replacedById` set
// are rotation history, not separate devices. Never expose `tokenHash`.
//
// Session ids from the two tables can collide in theory, so callers must
// always address a row by (source, id) together, never `id` alone.

import { loginDeviceLabel, loginLocationUrl } from "@/lib/auth/login-device";
import { deviceLabel, sessionStatus, type SessionStatus } from "@/lib/auth/user-session";
import type { AccountClient } from "./types";

export type AccountSessionSource = "web" | "mobile";

export type AccountSessionDto = {
  id: string;
  source: AccountSessionSource;
  deviceLabel: string;
  /** Mobile login: "IOS" | "ANDROID" (null for web / older mobile sessions). */
  deviceType: string | null;
  /** Where the mobile login happened, when the app sent it. */
  location: { lat: number; lng: number; mapUrl: string } | null;
  ip: string | null;
  createdAt: Date;
  lastActivityAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  status: SessionStatus;
  current: boolean;
};

export type AccountSessionContext = {
  currentSessionId?: string | null;
  currentRefreshTokenId?: string | null;
};

export type ListAccountSessionsParams = AccountSessionContext & {
  /** Түүх (revoked/expired) хэсгийг хуудаслах — идэвхтэй хэсгийг бүгдийг харуулна. */
  pagination?: { skip: number; take: number };
};

export type ListAccountSessionsResult = {
  active: AccountSessionDto[];
  ended: AccountSessionDto[];
  endedTotal: number;
  otherActiveCount: number;
};

// Хэрэглэгч тус бүрийн түүх ихээхэн байхгүй тул нэг эх сурвалжаас нэг удаад
// татах дээд хэмжээ — үүнээс цааш DB талд биш санах ойд нэгтгэж хуудасална.
const HISTORY_FETCH_CAP = 500;

type SessionLikeRow = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  lastSeenAt?: Date | null;
  lastUsedAt?: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  deviceType?: string | null;
  deviceModel?: string | null;
  deviceOs?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

function toDto(
  source: AccountSessionSource,
  row: SessionLikeRow,
  currentId: string | null | undefined,
): AccountSessionDto {
  return {
    id: row.id,
    source,
    deviceLabel:
      loginDeviceLabel({ deviceModel: row.deviceModel ?? null, deviceOs: row.deviceOs ?? null, deviceType: row.deviceType ?? null }) ??
      deviceLabel(row.userAgent),
    deviceType: row.deviceType ?? null,
    location:
      row.latitude != null && row.longitude != null
        ? { lat: row.latitude, lng: row.longitude, mapUrl: loginLocationUrl(row.latitude, row.longitude)! }
        : null,
    ip: row.ip,
    createdAt: row.createdAt,
    lastActivityAt: row.lastSeenAt ?? row.lastUsedAt ?? null,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    status: sessionStatus(row),
    current: !!currentId && row.id === currentId,
  };
}

function byRecency(a: AccountSessionDto, b: AccountSessionDto): number {
  const at = (a.lastActivityAt ?? a.createdAt).getTime();
  const bt = (b.lastActivityAt ?? b.createdAt).getTime();
  return bt - at;
}

/**
 * Хэрэглэгчийн нэгтгэсэн session жагсаалт: `UserSession` (web) +
 * `RefreshToken` (mobile, зөвхөн rotation хэлхээний сүүлчийн (replacedById
 * байхгүй) мөр). tokenHash хэзээ ч буцахгүй.
 */
export async function listAccountSessions(
  db: AccountClient,
  userId: string,
  params: ListAccountSessionsParams = {},
): Promise<ListAccountSessionsResult> {
  const sessionSelect = {
    id: true,
    userAgent: true,
    ip: true,
    createdAt: true,
    lastSeenAt: true,
    expiresAt: true,
    revokedAt: true,
  } as const;
  const tokenSelect = {
    id: true,
    userAgent: true,
    ip: true,
    createdAt: true,
    lastUsedAt: true,
    expiresAt: true,
    revokedAt: true,
    deviceType: true,
    deviceModel: true,
    deviceOs: true,
    latitude: true,
    longitude: true,
  } as const;

  const now = new Date();
  const activeWhere = { userId, revokedAt: null, expiresAt: { gt: now } };
  const endedWhere = {
    userId,
    OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }],
  };
  // Rotation-ийн зөвхөн сүүлчийн холбоос (шинээр сольогдоогүй) — эхнийхийг
  // "төхөөрөмж" гэж тоолно, дундын түүхийг биш.
  const tokenChainTipWhere = { replacedById: null };

  const [activeUserSessions, endedUserSessions, endedUserSessionTotal, activeTokens, endedTokens, endedTokenTotal] =
    await Promise.all([
      db.userSession.findMany({
        where: activeWhere,
        orderBy: { lastSeenAt: "desc" },
        select: sessionSelect,
      }),
      db.userSession.findMany({
        where: endedWhere,
        orderBy: { lastSeenAt: "desc" },
        take: HISTORY_FETCH_CAP,
        select: sessionSelect,
      }),
      db.userSession.count({ where: endedWhere }),
      db.refreshToken.findMany({
        where: { ...activeWhere, ...tokenChainTipWhere },
        orderBy: { lastUsedAt: "desc" },
        select: tokenSelect,
      }),
      db.refreshToken.findMany({
        where: { ...endedWhere, ...tokenChainTipWhere },
        orderBy: { lastUsedAt: "desc" },
        take: HISTORY_FETCH_CAP,
        select: tokenSelect,
      }),
      db.refreshToken.count({ where: { ...endedWhere, ...tokenChainTipWhere } }),
    ]);

  const active = [
    ...(activeUserSessions as SessionLikeRow[]).map((r) => toDto("web", r, params.currentSessionId)),
    ...(activeTokens as SessionLikeRow[]).map((r) => toDto("mobile", r, params.currentRefreshTokenId)),
  ].sort(byRecency);

  const endedAll = [
    ...(endedUserSessions as SessionLikeRow[]).map((r) => toDto("web", r, params.currentSessionId)),
    ...(endedTokens as SessionLikeRow[]).map((r) => toDto("mobile", r, params.currentRefreshTokenId)),
  ].sort(byRecency);

  const endedTotal = endedUserSessionTotal + endedTokenTotal;
  const { skip = 0, take } = params.pagination ?? {};
  const ended = take != null ? endedAll.slice(skip, skip + take) : endedAll;

  const otherActiveCount = active.filter((s) => !s.current).length;

  return { active, ended, endedTotal, otherActiveCount };
}

export type RevokeAccountSessionResult = { ok: true } | { ok: false; reason: "not_found" };

/** Тодорхой session/token-ийг revoke — зөвхөн `userId`-д хамаарах бол. Foreign id -> not_found. */
export async function revokeAccountSession(
  db: AccountClient,
  userId: string,
  source: AccountSessionSource,
  id: string,
): Promise<RevokeAccountSessionResult> {
  if (!id) return { ok: false, reason: "not_found" };

  if (source === "web") {
    const row = await db.userSession.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!row || row.userId !== userId) return { ok: false, reason: "not_found" };
    await db.userSession.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  const row = await db.refreshToken.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!row || row.userId !== userId) return { ok: false, reason: "not_found" };
  await db.refreshToken.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { ok: true };
}

/** Дурын нэг session/token-оос бусад бүх идэвхтэйг revoke хийнэ (хоёр хүснэгтэд). */
export async function revokeOtherAccountSessions(
  db: AccountClient,
  userId: string,
  ctx: AccountSessionContext = {},
): Promise<{ webRevoked: number; mobileRevoked: number }> {
  const [webResult, mobileResult] = await Promise.all([
    db.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(ctx.currentSessionId ? { id: { not: ctx.currentSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    }),
    db.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(ctx.currentRefreshTokenId ? { id: { not: ctx.currentRefreshTokenId } } : {}),
      },
      data: { revokedAt: new Date() },
    }),
  ]);
  return { webRevoked: webResult.count, mobileRevoked: mobileResult.count };
}
