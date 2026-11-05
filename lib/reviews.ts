// Үйлчлүүлэгчийн үнэлгээ (Review) — дууссан засварын хуудас бүрд Account нэг
// үнэлгээ (1..5 + сэтгэгдэл), засаж болно; засваргүйгээр салбарт шууд өгөх
// (submitBranchReview, account × branch тутам нэг) мөн боломжтой. Засварын газар хариу бичнэ, super
// admin нууна. Салбарын дундаж (Branch.ratingAvg/ratingCount) энд шинэчлэгдэнэ.
// Credit score-ын нэг бүрэлдэхүүн (lib/credit-score.ts).

import { Prisma } from "@/app/generated/prisma/client";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";
import { customerOwnershipFilters } from "@/lib/vehicles";

export const REVIEW_COMMENT_MAX = 1000;
export const REVIEW_REPLY_MAX = 1000;

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly status = 422,
    readonly code = "REVIEW_REJECTED",
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

/** Pure: 1..5 бүхэл тоо + хоосон бол null сэтгэгдэл. */
export function parseReviewInput(rating: unknown, comment: unknown): { rating: number; comment: string | null } {
  const n = typeof rating === "string" ? Number(rating) : rating;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 5) {
    throw new ReviewError("Үнэлгээ 1–5 од байх ёстой.", 422, "INVALID_RATING");
  }
  const text = typeof comment === "string" ? comment.trim() : "";
  if (text.length > REVIEW_COMMENT_MAX) {
    throw new ReviewError(`Сэтгэгдэл ${REVIEW_COMMENT_MAX} тэмдэгтээс хэтэрсэн байна.`, 422, "COMMENT_TOO_LONG");
  }
  return { rating: n, comment: text || null };
}

/** Салбарын дундаж үнэлгээг нуугдаагүй үнэлгээнээс дахин тооцно. */
export async function recomputeBranchRating(branchId: string): Promise<void> {
  const agg = await prisma.review.aggregate({
    where: { branchId, hidden: false },
    _avg: { rating: true },
    _count: { _all: true },
  });
  await prisma.branch.update({
    where: { id: branchId },
    data: {
      ratingAvg: agg._avg.rating == null ? null : new Prisma.Decimal(agg._avg.rating.toFixed(2)),
      ratingCount: agg._count._all,
    },
  });
}

/**
 * Үйлчлүүлэгч (Account) өөрийн дууссан засварын хуудсанд үнэлгээ өгнө/засна.
 * Зөвхөн тухайн засварын үйлчлүүлэгч (Customer.accountId) бөгөөд COMPLETED,
 * дотоод бус засвар. Bypass context-оор (Account нь тенантгүй).
 */
export async function submitReview(input: {
  accountId: string;
  /** Account-ийн утас — утсаар холбогдсон Customer-ийн засварыг (түүхэнд харагддаг) ч үнэлж болно. */
  phone?: string | null;
  orderId: string;
  rating: unknown;
  comment: unknown;
}): Promise<{ id: string; created: boolean }> {
  setBypassContext();
  const { rating, comment } = parseReviewInput(input.rating, input.comment);

  const order = await prisma.serviceOrder.findFirst({
    // Түүх/захиалгын жагсаалттай ижил эзэмшлийн дүрэм (accountId эсвэл утас).
    where: { id: input.orderId, OR: customerOwnershipFilters(input.accountId, input.phone) },
    select: { id: true, status: true, isInternal: true, tenantId: true, branchId: true, number: true },
  });
  if (!order) throw new ReviewError("Засварын хуудас олдсонгүй.", 404, "ORDER_NOT_FOUND");
  if (order.status !== "COMPLETED" || order.isInternal) {
    throw new ReviewError("Зөвхөн дууссан засварт үнэлгээ өгнө.", 422, "ORDER_NOT_COMPLETED");
  }

  const existing = await prisma.review.findUnique({ where: { orderId: order.id }, select: { id: true } });
  const saved = existing
    ? await prisma.review.update({ where: { id: existing.id }, data: { rating, comment }, select: { id: true } })
    : await prisma.review.create({
        data: {
          tenantId: order.tenantId,
          branchId: order.branchId,
          orderId: order.id,
          accountId: input.accountId,
          rating,
          comment,
        },
        select: { id: true },
      });

  await recomputeBranchRating(order.branchId);

  if (!existing) {
    await notifyOwnersOfReview(order.tenantId, saved.id, rating, comment, order.number ? `#${order.number} засвар` : "Засвар");
  }
  return { id: saved.id, created: !existing };
}

async function notifyOwnersOfReview(
  tenantId: string,
  reviewId: string,
  rating: number,
  comment: string | null,
  subject: string,
): Promise<void> {
  const owners = await prisma.user.findMany({
    where: { tenantId, isOwner: true, isActive: true, deletedAt: null },
    select: { id: true },
  });
  for (const o of owners) {
    try {
      await createNotification({
        type: "review_received",
        recipient: { userId: o.id },
        tenantId,
        input: {
          reviewId,
          rating: String(rating),
          body: `${subject}: ${"★".repeat(rating)}${comment ? ` — ${comment.slice(0, 80)}` : ""}`,
        },
      });
    } catch (e) {
      console.warn("[notify] review_received:", e);
    }
  }
}

/**
 * Салбарт шууд үнэлгээ өгөх (/discover, апп) — засвар шаардахгүй. Хэрэглэгч
 * тухайн салбарт ҮНЭЛЭЭГҮЙ дууссан засвартай бол хамгийн сүүлийнхэд нь
 * холбоно (баталгаажсан, credit score-д тооцогдоно); үгүй бол засваргүй
 * үнэлгээ (account × branch тутам нэг, дахин өгвөл засна).
 */
export async function submitBranchReview(input: {
  accountId: string;
  phone?: string | null;
  branchId: string;
  rating: unknown;
  comment: unknown;
}): Promise<{ id: string; created: boolean; verified: boolean }> {
  setBypassContext();
  const { rating, comment } = parseReviewInput(input.rating, input.comment);

  const branch = await prisma.branch.findFirst({
    where: { id: input.branchId, isActive: true, tenant: { isTest: false, suspended: false } },
    select: { id: true, tenantId: true, name: true },
  });
  if (!branch) throw new ReviewError("Салбар олдсонгүй.", 404, "BRANCH_NOT_FOUND");

  const order = await prisma.serviceOrder.findFirst({
    where: {
      branchId: branch.id,
      status: "COMPLETED",
      isInternal: false,
      review: { is: null },
      OR: customerOwnershipFilters(input.accountId, input.phone),
    },
    orderBy: { completedAt: "desc" },
    select: { id: true },
  });
  if (order) {
    const r = await submitReview({ accountId: input.accountId, phone: input.phone, orderId: order.id, rating, comment });
    return { ...r, verified: true };
  }

  const existing = await prisma.review.findFirst({
    where: { accountId: input.accountId, branchId: branch.id, orderId: null },
    select: { id: true },
  });
  const saved = existing
    ? await prisma.review.update({ where: { id: existing.id }, data: { rating, comment }, select: { id: true } })
    : await prisma.review.create({
        data: { tenantId: branch.tenantId, branchId: branch.id, accountId: input.accountId, rating, comment },
        select: { id: true },
      });

  await recomputeBranchRating(branch.id);
  if (!existing) await notifyOwnersOfReview(branch.tenantId, saved.id, rating, comment, branch.name);
  return { id: saved.id, created: !existing, verified: false };
}

/** Засварын газар (ажилтан, тенант context) үнэлгээнд нийтэд харагдах хариу бичнэ. Хоосон бол хариуг устгана. */
export async function replyToReview(input: {
  tenantId: string;
  userId: string;
  reviewId: string;
  reply: string;
}): Promise<void> {
  const text = input.reply.trim();
  if (text.length > REVIEW_REPLY_MAX) {
    throw new ReviewError(`Хариу ${REVIEW_REPLY_MAX} тэмдэгтээс хэтэрсэн байна.`, 422, "REPLY_TOO_LONG");
  }
  const res = await prisma.review.updateMany({
    where: { id: input.reviewId, tenantId: input.tenantId },
    data: text
      ? { reply: text, repliedAt: new Date(), repliedById: input.userId }
      : { reply: null, repliedAt: null, repliedById: null },
  });
  if (res.count !== 1) throw new ReviewError("Үнэлгээ олдсонгүй.", 404, "REVIEW_NOT_FOUND");
}

/** Super admin (bypass) — нуух/ил болгох. */
export async function setReviewHidden(reviewId: string, hidden: boolean, reason: string | null): Promise<void> {
  const review = await prisma.review.update({
    where: { id: reviewId },
    data: { hidden, hiddenAt: hidden ? new Date() : null, hiddenReason: hidden ? reason : null },
    select: { branchId: true },
  });
  await recomputeBranchRating(review.branchId);
}

/** Super admin (bypass) — бүрмөсөн устгах. */
export async function deleteReview(reviewId: string): Promise<void> {
  const review = await prisma.review.delete({ where: { id: reviewId }, select: { branchId: true } });
  await recomputeBranchRating(review.branchId);
}
