import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { resolveWorkingBranch } from "@/lib/auth/api-branch";
import { hasPermission } from "@/lib/auth/roles";
import { getBranchVisibility } from "@/lib/branch-visibility";
import { buildMeta, getApiPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/v1/reviews — үйлчлүүлэгчдийн үнэлгээ (веб /dashboard/reviews-тэй ижил).
 *
 * Query: rating? (1–5), replied? ("yes" | "no"), page?, pageSize?/limit?
 * Салбар: `X-Working-Branch` header-ээр (ажлын салбарын scope).
 * Эрх: customers.view. `canReply` = customers.edit (PUT /reviews/[id]/reply).
 * `hideBranches` — ганц салбартай багцад салбарын нэрийг UI-д нуух.
 */
export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "customers.view");
  if (denied) return denied;

  const scopeResult = await resolveWorkingBranch(req, auth.user);
  if (scopeResult.response) return scopeResult.response;
  const scope = scopeResult.branchId;

  const sp = new URL(req.url).searchParams;
  const ratingRaw = sp.get("rating");
  const rating = ratingRaw ? Number(ratingRaw) : null;
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
    return jsonError(400, "rating нь 1–5 бүхэл тоо байна.", { code: "VALIDATION", fieldErrors: { rating: "1–5" } });
  }
  const replied = sp.get("replied");
  if (replied && replied !== "yes" && replied !== "no") {
    return jsonError(400, "replied нь yes эсвэл no байна.", { code: "VALIDATION", fieldErrors: { replied: "yes | no" } });
  }
  const { page, pageSize, skip, take } = getApiPageInfo(sp);
  const tenantId = auth.user.tenantId;

  const where = {
    tenantId,
    ...(scope ? { branchId: scope } : {}),
    ...(rating ? { rating } : {}),
    ...(replied === "no" ? { reply: null } : replied === "yes" ? { reply: { not: null } } : {}),
  };

  const [rows, total, branches, visibility] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        rating: true,
        comment: true,
        reply: true,
        repliedAt: true,
        hidden: true,
        createdAt: true,
        branch: { select: { id: true, name: true } },
        order: { select: { id: true, number: true } },
        account: { select: { name: true } },
      },
    }),
    prisma.review.count({ where }),
    prisma.branch.findMany({
      where: { tenantId, ...(scope ? { id: scope } : {}), ratingCount: { gt: 0 } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, ratingAvg: true, ratingCount: true },
    }),
    getBranchVisibility({ tenantId, tenant: { plan: auth.user.tenantPlan } }),
  ]);

  return jsonOk({
    reviews: rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      reply: r.reply,
      repliedAt: r.repliedAt,
      hidden: r.hidden,
      createdAt: r.createdAt,
      customerName: r.account.name?.trim() || null,
      branch: r.branch,
      // null → засваргүйгээр салбарт шууд өгсөн үнэлгээ (credit score-д тооцогдохгүй).
      order: r.order,
    })),
    branches: branches.map((b) => ({
      id: b.id,
      name: b.name,
      ratingAvg: Number(b.ratingAvg ?? 0),
      ratingCount: b.ratingCount,
    })),
    hideBranches: visibility.hideBranches,
    canReply: hasPermission(auth.user, "customers.edit"),
    pagination: buildMeta(total, page, pageSize),
  });
}
