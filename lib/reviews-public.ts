// Нийтэд харагдах үнэлгээ (байгууллага/салбарын хуудас, үйлчлүүлэгчийн апп) —
// зөвхөн нуугдаагүй. Үнэлгээ өгөгчийн нэрийг бүрэн ил гаргахгүй (нэрний эхний
// үг + эхний үсэг). Bypass context-д дуудна (нийтийн хуудас).

import { prisma } from "@/lib/prisma";

export type PublicReview = {
  id: string;
  rating: number;
  comment: string | null;
  reply: string | null;
  reviewer: string;
  /** Засвартай холбоотой (тухайн газарт үйлчлүүлсэн). */
  verified: boolean;
  createdAt: Date;
};

/** "Батболд Ганбаатар" → "Батболд Г.", хоосон → "Үйлчлүүлэгч". */
export function maskReviewerName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Үйлчлүүлэгч";
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[1].slice(0, 1)}.`;
}

export async function loadPublicReviews(branchId: string, take = 10, skip = 0): Promise<PublicReview[]> {
  const rows = await prisma.review.findMany({
    where: { branchId, hidden: false },
    orderBy: { createdAt: "desc" },
    take,
    skip,
    select: { id: true, rating: true, comment: true, reply: true, createdAt: true, orderId: true, account: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    reply: r.reply,
    reviewer: maskReviewerName(r.account.name),
    verified: r.orderId != null,
    createdAt: r.createdAt,
  }));
}
