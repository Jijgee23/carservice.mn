import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Btn, BtnLink } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/auth/roles";
import { customerDisplay, customerLabel } from "@/lib/customers";
import { prisma } from "@/lib/prisma";
import { CUSTOMER_FORM_ID, CustomerForm } from "../customer-form";

export const metadata = {
  title: "Үйлчлүүлэгч засах",
};

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!canEdit(user, "customers")) redirect("/dashboard/customers");

  const { id } = await params;
  const customer = await prisma.customer.findFirst({
    where: { id, tenantId: user.tenantId },
    include: {
      tenantVehicles: {
        orderBy: { createdAt: "desc" },
        select: {
          vehicle: {
            select: {
              id: true,
              plate: true,
              make: true,
              model: true,
              year: true,
            },
          },
        },
      },
      _count: { select: { serviceOrders: true } },
    },
  });
  if (!customer) notFound();

  return (
    <div className="p-4 sm:p-6">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/customers" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Үйлчлүүлэгчид
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">{customerLabel(customer)}</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">
            {customerDisplay(customer).primary}
            {customer.isOrganization ? (
              <span className="ml-3 align-middle rounded-full border border-[var(--oc-line)] px-2 py-0.5 text-xs font-medium text-[var(--oc-muted)]">
                Байгууллага
              </span>
            ) : null}
          </h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            {customer.isOrganization ? `${customerLabel(customer)} · ` : ""}
            {customer.phone} · {customer._count.serviceOrders} засварын хуудас
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BtnLink href="/dashboard/customers" variant="ghost">
            ← Буцах
          </BtnLink>
          <Btn type="submit" form={CUSTOMER_FORM_ID}>
            Хадгалах
          </Btn>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px] items-start">
        <CustomerForm
          initial={{
            id: customer.id,
            fullName: customer.fullName,
            phone: customer.phone,
            email: customer.email,
            note: customer.note,
            isOrganization: customer.isOrganization,
            orgRegnum: customer.orgRegnum,
            orgName: customer.orgName,
            orgEmail: customer.orgEmail,
          }}
        />

        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--oc-line)]">
            <h2 className="font-semibold text-[var(--oc-ink)]">Машинууд</h2>
            <BtnLink
              href={`/dashboard/vehicles/new?customerId=${customer.id}`}
              size="sm"
            >
              + Машин
            </BtnLink>
          </div>

          {customer.tenantVehicles.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-[var(--oc-muted3)]">
              Энэ үйлчлүүлэгчид машин бүртгээгүй байна.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--oc-line)]">
              {customer.tenantVehicles.map(({ vehicle: v }) => (
                <li key={v.id}>
                  <Link
                    href={`/dashboard/vehicles/${v.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="w-9 h-9 rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] flex items-center justify-center font-plex-mono text-xs font-semibold text-[var(--oc-ink2)] shrink-0">
                      {v.plate.slice(0, 3).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-[var(--oc-ink)] truncate">
                        {v.make} {v.model}
                        {v.year ? (
                          <span className="text-[var(--oc-muted3)]"> · {v.year}</span>
                        ) : null}
                      </div>
                      <div className="font-plex-mono text-xs text-[var(--oc-muted3)]">{v.plate}</div>
                    </div>
                    <span className="text-[var(--oc-muted4)] text-sm">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
