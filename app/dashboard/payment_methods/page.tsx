import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/roles";
import { listPaymentAccounts } from "@/lib/payment-account-service";
import { prisma } from "@/lib/prisma";
import { PaymentAccountsList } from "./payment-accounts-list";

export const metadata = {
  title: "Төлбөрийн аргууд",
};

// Owner-only /dashboard/settings-ээс тусдаа — cash.manage эрхтэй ажилтан
// (owner биш) ч хандах ёстой тул audit хуудасны адил dashboard түвшинд.
export default async function PaymentAccountsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "cash.manage")) redirect("/dashboard");

  const [accounts, qpay] = await Promise.all([
    listPaymentAccounts({ actor: user, includeInactive: true }),
    // QPay нь тенантын нэг интеграци (TenantQPaySettings) — энэ хуудсанд тохируулна (зөвхөн админ). Нууц үг клиент рүү явахгүй.
    prisma.tenantQPaySettings.findUnique({
      where: { tenantId: user.tenantId },
      select: { enabled: true, invoiceCode: true, username: true, callbackUrl: true, password: true },
    }),
  ]);
  const qpaySummary = qpay ? { enabled: qpay.enabled, invoiceCode: qpay.invoiceCode } : null;
  const qpayInitial =
    qpay && user.isOwner
      ? { username: qpay.username, invoiceCode: qpay.invoiceCode, callbackUrl: qpay.callbackUrl, enabled: qpay.enabled, hasPassword: Boolean(qpay.password) }
      : null;

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Төлбөрийн аргууд</h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          Төлбөр бүртгэхэд сонгогдох бэлэн, дансаар шилжүүлэх (данс), картын (POS) болон QPay аргууд.
        </p>
      </div>
      <PaymentAccountsList accounts={accounts} qpay={qpaySummary} qpayInitial={qpayInitial} canManageQpay={user.isOwner} />
    </div>
  );
}
