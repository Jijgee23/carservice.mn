"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { knownAuthorizationMessage } from "@/lib/action-errors";
import { requireUser } from "@/lib/auth";
import { PaymentAccountError } from "@/lib/payment-accounts";
import { createPayloadFromForm, updatePayloadFromForm } from "@/lib/payment-account-form";
import { createPaymentAccount, updatePaymentAccount } from "@/lib/payment-account-service";
import { assertActiveSubscription } from "@/lib/subscription-server";

export type PaymentAccountActionState = { ok: boolean; message?: string; fieldErrors?: Record<string, string> } | null;

function failure(error: unknown): PaymentAccountActionState {
  if (error instanceof PaymentAccountError) return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
  const known = knownAuthorizationMessage(error); // subscription-locked only; never arbitrary error text
  if (known) return { ok: false, message: known };
  return { ok: false, message: "Хадгалахад алдаа гарлаа." };
}

function refresh() {
  revalidatePath("/dashboard/payment_methods");
  revalidatePath("/dashboard", "layout");
}

/** formData: type, name, accountNumber, terminalId?, merchantId?, isTest ("on" when checked). */
export async function createPaymentAccountAction(_prev: PaymentAccountActionState, fd: FormData): Promise<PaymentAccountActionState> {
  try {
    const user = await requireUser();
    await assertActiveSubscription(user.tenantId);
    await createPaymentAccount({ actor: user, data: createPayloadFromForm(fd) });
    refresh();
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return failure(error);
  }
}

/** formData: id, name, accountNumber, terminalId?, merchantId?, isTest? (POS only). Type is never sent. */
export async function updatePaymentAccountAction(_prev: PaymentAccountActionState, fd: FormData): Promise<PaymentAccountActionState> {
  try {
    const user = await requireUser();
    await assertActiveSubscription(user.tenantId);
    const { id, data } = updatePayloadFromForm(fd);
    await updatePaymentAccount({ actor: user, id, data });
    refresh();
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return failure(error);
  }
}

export async function setPaymentAccountActiveAction(id: string, isActive: boolean): Promise<PaymentAccountActionState> {
  try {
    const user = await requireUser();
    await assertActiveSubscription(user.tenantId);
    await updatePaymentAccount({ actor: user, id, data: { isActive } });
    refresh();
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return failure(error);
  }
}
