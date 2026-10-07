"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { setTenantEnabledBanks, TenantBanksError } from "@/lib/tenant-banks";

export type TenantBanksActionState = {
  ok: boolean;
  message?: string;
  enabledBanks?: string[];
} | null;

/**
 * Идэвхтэй банкуудыг хадгална (cash.manage, owner implicit).
 * formData: `enabledBanks` — давтагдах талбар (банк тус бүрийн код). Хоосон = бүх банк.
 */
export async function saveEnabledBanksAction(
  _prev: TenantBanksActionState,
  formData: FormData,
): Promise<TenantBanksActionState> {
  try {
    const user = await requireUser();
    const codes = formData.getAll("enabledBanks").filter((v): v is string => typeof v === "string");
    const result = await setTenantEnabledBanks({ actor: user, enabledBanks: codes });
    revalidatePath("/dashboard/banks");
    revalidatePath("/dashboard/orders", "layout");
    return { ok: true, enabledBanks: result.enabledBanks };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: error instanceof TenantBanksError ? error.message : "Хадгалахад алдаа." };
  }
}
