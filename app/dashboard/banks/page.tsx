import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/roles";
import { getTenantBanks } from "@/lib/tenant-banks";
import { BanksForm } from "./banks-form";

export const metadata = {
  title: "Банкны тохиргоо",
};

// Owner-only /dashboard/settings-ээс тусдаа — cash.manage эрхтэй ажилтан
// (owner биш) ч хандах ёстой тул audit хуудасны адил dashboard түвшинд.
export default async function BanksSettingsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "cash.manage")) redirect("/dashboard");

  const { banks, enabledBanks, configured } = await getTenantBanks(user.tenantId);

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Банкны тохиргоо</h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          Шилжүүлэг, картын төлбөр бүртгэхэд сонгогдох хүлээн авагч банкууд.
        </p>
      </div>
      <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6 max-w-xl">
        <BanksForm banks={banks} initialEnabled={configured ? enabledBanks : []} />
      </section>
    </div>
  );
}
