import { jsonError, jsonOk } from "@/lib/api";
import { getApiAccountFromRequest } from "@/lib/auth/account-api-token";
import { ReviewError, submitBranchReview } from "@/lib/reviews";
import { prisma } from "@/lib/prisma";
import { loadPublicReviews } from "@/lib/reviews-public";
import { setBypassContext } from "@/lib/tenant-context";
import { PUBLIC_TENANT_WHERE } from "@/lib/tenant-visibility";

// GET /api/v1/app/branches/[branchId]/reviews?page=1 — салбарын нийтэд харагдах
// үнэлгээ (нуугдаагүй), 20-оор. Нэвтрэх шаардлагагүй.
export async function GET(req: Request, ctx: { params: Promise<{ branchId: string }> }) {
  setBypassContext();
  const { branchId } = await ctx.params;
  const page = Math.max(1, Number(new URL(req.url).searchParams.get("page")) || 1);
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, isActive: true, tenant: PUBLIC_TENANT_WHERE },
    select: { ratingAvg: true, ratingCount: true },
  });
  if (!branch) return jsonError(404, "Салбар олдсонгүй.");
  const reviews = await loadPublicReviews(branchId, 20, (page - 1) * 20);
  return jsonOk({
    rating: branch.ratingAvg == null ? null : Number(branch.ratingAvg.toString()),
    ratingCount: branch.ratingCount,
    page,
    reviews,
  });
}

// POST /api/v1/app/branches/[branchId]/reviews — нэвтэрсэн хэрэглэгч салбарт
// үнэлгээ өгөх/засах (засвар шаардахгүй). Body: { "rating": 1..5, "comment"?: string }.
// Үнэлээгүй дууссан засвартай бол түүнд холбогдоно (verified: true).
export async function POST(req: Request, ctx: { params: Promise<{ branchId: string }> }) {
  const account = await getApiAccountFromRequest(req);
  if (!account) return jsonError(401, "Нэвтрэх шаардлагатай.");
  const { branchId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { rating?: unknown; comment?: unknown } | null;
  if (!body) return jsonError(400, "Буруу өгөгдөл");
  try {
    const saved = await submitBranchReview({
      accountId: account.id,
      phone: account.phone,
      branchId,
      rating: body.rating,
      comment: body.comment,
    });
    return jsonOk({ review: saved });
  } catch (e) {
    if (e instanceof ReviewError) return jsonError(e.status, e.message, { code: e.code });
    throw e;
  }
}
