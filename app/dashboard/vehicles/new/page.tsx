import Link from "next/link";
import { redirect } from "next/navigation";
import { Btn, BtnLink } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import { canCreate } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import { VEHICLE_FORM_ID, VehicleForm } from "../vehicle-form";

export const metadata = {
  title: "Шинэ машин",
};

export default async function NewVehiclePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const user = await requireUser();
  if (!canCreate(user, "vehicles")) redirect("/dashboard/vehicles");

  const { customerId } = await searchParams;

  const customers = await prisma.customer.findMany({
    where: { tenantId: user.tenantId },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, phone: true, isOrganization: true, orgRegnum: true },
  });

  const backHref = customerId
    ? `/dashboard/customers/${customerId}`
    : "/dashboard/vehicles";

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/vehicles" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Машинууд
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">Шинэ машин</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Шинэ машин</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            Машины үндсэн мэдээлэл, эзэмшигчийг сонгоно уу.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BtnLink href={backHref} variant="ghost">
            ← Буцах
          </BtnLink>
          <Btn type="submit" form={VEHICLE_FORM_ID}>
            Үүсгэх
          </Btn>
        </div>
      </div>

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-5">
        <VehicleForm
          customers={customers}
          defaultCustomerId={customerId}
          backHref={backHref}
        />
      </div>
    </div>
  );
}

