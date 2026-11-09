import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { eligibleBranchIds } from "@/lib/auth/roles";
import { buildMeta, getApiPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import type { ApiUser } from "@/lib/auth/api-token";
import { branchBodyToFormData, createBranch, getBranchDetail, type BranchJsonBody } from "@/lib/branches-commands";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

/**
 * Build the tenant- and eligibility-scoped predicate used by both the list
 * and count queries. A floating employee with no eligible IDs intentionally
 * receives all active branches in their own tenant, matching the switchable
 * branch endpoint's semantics.
 */
export function branchListWhere(user: Pick<ApiUser, "tenantId" | "isOwner" | "branchId" | "assignableBranchIds">) {
  const eligible = user.isOwner ? [] : eligibleBranchIds(user);

  return {
    tenantId: user.tenantId,
    isActive: true,
    ...(!user.isOwner && eligible.length > 0 ? { id: { in: eligible } } : {}),
  };
}

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;

  const url = new URL(req.url);
  const { page, pageSize, skip, take } = getApiPageInfo(url.searchParams);
  const where = branchListWhere(auth.user);

  const [branches, total] = await Promise.all([
    prisma.branch.findMany({
      where,
      orderBy: { name: "asc" },
      skip,
      take,
      select: { id: true, name: true, address: true, phone: true },
    }),
    prisma.branch.count({ where }),
  ]);

  return jsonOk({ branches, pagination: buildMeta(total, page, pageSize) });
}

/**
 * POST /api/v1/branches — шинэ салбар үүсгэнэ (вэбийн createBranchAction-тай ижил дүрэм).
 *
 * Эрх: `branches.create`; идэвхтэй багц шаардана (403 SUBSCRIPTION_EXPIRED).
 * Body (JSON): { name, phone?, city?, district?, khoroo?, address?,
 *   latitude?, longitude?, openTime?, closeTime?, slotMinutes?, slotCapacity?,
 *   isPrimary?: boolean, tagIds: string[] (ядаж 1),
 *   schedules?: [{ weekday: "MON"…"SUN", isOpen, openTime, closeTime }] }.
 *   `schedules`-д ирээгүй өдрүүд DEFAULT_OPEN_DAYS (Да–Ба)-аар бөглөгдөнө.
 * 201: { branch: BranchDetail }.
 * Алдаа: 400 VALIDATION { fieldErrors }, 403 MODULE_DISABLED («Олон салбар»
 * хаалттай үед хоёр дахь салбар), 500.
 */
export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "branches.create");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const body = (await req.json().catch(() => null)) as BranchJsonBody | null;
  if (!body || typeof body !== "object") {
    return jsonError(400, "JSON body шаардлагатай.", { code: "VALIDATION" });
  }

  const result = await createBranch(auth.user, branchBodyToFormData(body));
  if (!result.ok) {
    if (result.code === "VALIDATION") {
      const first = Object.values(result.fieldErrors)[0] ?? "Өгөгдөл буруу.";
      return jsonError(400, first, { code: "VALIDATION", fieldErrors: result.fieldErrors });
    }
    if (result.code === "MODULE_DISABLED") {
      return jsonError(403, result.message, { code: "MODULE_DISABLED" });
    }
    return jsonError(500, result.message, { code: result.code });
  }

  const branch = await getBranchDetail(auth.user.tenantId, result.id);
  return jsonOk({ branch }, { status: 201 });
}
