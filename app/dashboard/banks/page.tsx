import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/roles";
import { listPaymentAccounts } from "@/lib/payment-account-service";
import { PaymentAccountsList } from "./payment-accounts-list";

export const metadata = {
  title: "Төлбөрийн сонголт",
};

// Owner-only /dashboard/settings-ээс тусдаа — cash.manage эрхтэй ажилтан
// (owner биш) ч хандах ёстой тул audit хуудасны адил dashboard түвшинд.
export default async function PaymentAccountsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "cash.manage")) redirect("/dashboard");

  const accounts = await listPaymentAccounts({ actor: user, includeInactive: true });

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Төлбөрийн сонголт</h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          Шилжүүлэг (данс) болон картын (POS) төлбөр бүртгэхэд сонгогдох хүлээн авагч данс, терминал.
        </p>
      </div>
      <PaymentAccountsList accounts={accounts} />
    </div>
  );
}
