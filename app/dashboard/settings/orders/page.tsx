import { requireUser } from "@/lib/auth";
import { permissionLabel } from "@/lib/auth/permissions";
import { orderNumberYear } from "@/lib/orders/order-settings";
import { getOrderSettings } from "@/lib/orders/order-settings-server";
import { prisma } from "@/lib/prisma";
import { OrderSettingsForm } from "./order-settings-form";

export const metadata = {
  title: "Засварын хуудасны тохиргоо",
};

// Owner-only: app/dashboard/settings/layout.tsx.
export default async function OrderSettingsPage() {
  const user = await requireUser();
  const settings = await getOrderSettings(prisma, user.tenantId);

  return (
    <div className="p-4 sm:p-6 max-w-4xl w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Засварын хуудасны тохиргоо</h1>
        <p className="text-sm text-[var(--oc-muted3)] mt-1">
          Дугаарлалт, нээх/хаах дүрэм, хүлээн авалтын шалгах жагсаалт, хэвлэх загвар.
        </p>
      </div>
      <OrderSettingsForm
        initial={settings}
        year={orderNumberYear()}
        canCloseUnpaidLabel={permissionLabel("orders.closeUnpaidPostpaid")}
      />
    </div>
  );
}
