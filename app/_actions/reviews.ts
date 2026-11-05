"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/roles";
import { ReviewError, replyToReview } from "@/lib/reviews";

export type ReviewReplyState = { ok: boolean; message?: string } | null;

/** Засварын газар үнэлгээнд нийтэд харагдах хариу бичих (эзэн эсвэл customers.edit). */
export async function replyReviewAction(_prev: ReviewReplyState, formData: FormData): Promise<ReviewReplyState> {
  const user = await requireUser();
  if (!hasPermission(user, "customers.edit")) return { ok: false, message: "Хариу бичих эрх байхгүй." };
  try {
    await replyToReview({
      tenantId: user.tenantId,
      userId: user.id,
      reviewId: String(formData.get("reviewId") ?? ""),
      reply: String(formData.get("reply") ?? ""),
    });
  } catch (e) {
    if (e instanceof ReviewError) return { ok: false, message: e.message };
    throw e;
  }
  revalidatePath("/dashboard/reviews");
  return { ok: true, message: "Хариу хадгалагдлаа." };
}
