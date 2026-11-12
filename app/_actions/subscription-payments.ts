"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  cancelTenantSubscriptionPayment,
  checkTenantSubscriptionPayment,
  createSubscriptionQPayPayment,
} from "@/lib/subscription-payments";

// Бизнес логик нь lib/subscription-payments.ts-д — мобайл staff API
// (app/api/v1/subscription/qpay/**) мөн адил функцуудыг дуудна.

export type PaymentActionState = {
  ok: boolean;
  message?: string;
  paymentId?: string;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Тенант OWNER нь PlanPrice сонгоод төлбөр үүсгэнэ. SubscriptionPayment(PENDING)
 * + QPay invoice үүсгэнэ. QR + payment-н id-г буцаана. UI нь шалгуурын polling
 * хийж PAID болсон үед subscription идэвхжүүлнэ.
 */
export async function createSubscriptionPaymentAction(
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const user = await requireUser();
  if (!user.isOwner) {
    return { ok: false, message: "Зөвхөн админ багц авна." };
  }

  const result = await createSubscriptionQPayPayment(user, s(formData, "planPriceId"));
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/dashboard/settings/subscription");
  return { ok: true, paymentId: result.payment.id };
}

/**
 * UI-аас тогтмол дуудна — QPay-аас тус payment-ийн төлөв шалгаж, PAID болсон
 * үед subscription үүсгэж payment-ийг шинэчилнэ. Дахин дуудсан ч idempotent.
 *
 * Form fields: paymentId
 */
export async function checkSubscriptionPaymentAction(
  formData: FormData,
): Promise<{ ok: boolean; paid: boolean; message?: string }> {
  const user = await requireUser();
  // Энэ payment тухайн тенантынх эсэхийг шалгаад, баталгаажуулалтыг хуваалцсан
  // core логикт даатгана (web polling + QPay callback хоёул адил замаар явна).
  const { ok, paid, message } = await checkTenantSubscriptionPayment(
    user.tenantId,
    s(formData, "paymentId"),
  );
  return message === undefined ? { ok, paid } : { ok, paid, message };
}

/**
 * Хэрэглэгч QR-ыг хаах үед PENDING-ийг CANCELLED болгоно.
 */
export async function cancelSubscriptionPaymentAction(
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const paymentId = s(formData, "paymentId");
  if (!paymentId) return;

  const { cancelled } = await cancelTenantSubscriptionPayment(user, paymentId);
  if (!cancelled) return;

  revalidatePath("/dashboard/settings/subscription");
}
