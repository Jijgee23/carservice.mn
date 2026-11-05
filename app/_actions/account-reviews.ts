"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/account";
import { ReviewError, submitBranchReview, submitReview } from "@/lib/reviews";

export type AccountReviewState = { ok: boolean; message?: string } | null;

/** Үйлчлүүлэгч (вэб /account) дууссан засварт үнэлгээ өгөх/засах. */
export async function submitAccountReviewAction(
  _prev: AccountReviewState,
  formData: FormData,
): Promise<AccountReviewState> {
  const account = await requireAccount();
  const orderId = String(formData.get("orderId") ?? "");
  const branchId = String(formData.get("branchId") ?? "");
  try {
    if (!orderId && branchId) {
      // Засваргүйгээр салбарт шууд (/discover).
      const r = await submitBranchReview({
        accountId: account.id,
        phone: account.phone,
        branchId,
        rating: String(formData.get("rating") ?? ""),
        comment: formData.get("comment"),
      });
      revalidatePath("/discover");
      return { ok: true, message: r.created ? "Үнэлгээ өгсөнд баярлалаа!" : "Үнэлгээ шинэчлэгдлээ." };
    }
    const r = await submitReview({
      accountId: account.id,
      phone: account.phone,
      orderId,
      rating: String(formData.get("rating") ?? ""),
      comment: formData.get("comment"),
    });
    revalidatePath(`/account/orders/${orderId}`);
    revalidatePath(`/account/history/${orderId}`);
    revalidatePath("/account/history");
    return { ok: true, message: r.created ? "Үнэлгээ өгсөнд баярлалаа!" : "Үнэлгээ шинэчлэгдлээ." };
  } catch (e) {
    if (e instanceof ReviewError) return { ok: false, message: e.message };
    throw e;
  }
}
