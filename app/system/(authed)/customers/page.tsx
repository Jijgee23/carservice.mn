import { Prisma } from "@/app/generated/prisma/client";
import { FilterSelect, SearchBox } from "@/app/_components/list-filters";
import { PageHeader } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { requireSuperAdmin } from "@/lib/auth/system";
import { customerLabel, orgRegnumLabel } from "@/lib/customers";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { formatPhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { customerTextSearchClauses } from "@/lib/customers/customer-search";

export const metadata = { title: "Үйлчлүүлэгчид" };

export default async function SystemCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tenantId?: string; page?: string }>;
}) {
  await requireSuperAdmin();
  const { q = "", tenantId = "", page: pageParam } = await searchParams;

  const where: Prisma.CustomerWhereInput = {
    ...(tenantId ? { tenantId } : {}),
    ...(q
      ? {
          OR: [
            ...customerTextSearchClauses(q),
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const { page, pageSize, skip, take } = getPageInfo(pageParam);
  const [customers, total, tenants] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        isOrganization: true,
        orgRegnum: true,
        accountId: true,
        createdAt: true,
        tenant: { select: { name: true } },
        _count: { select: { tenantVehicles: true, serviceOrders: true } },
      },
    }),
    prisma.customer.count({ where }),
    prisma.tenant.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const meta = buildMeta(total, page, pageSize);

  return (
    <div className="p-6 sm:p-8 max-w-screen">
      <PageHeader
        title="Үйлчлүүлэгчид"
        description={`Платформ даяар ${total} үйлчлүүлэгч`}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <SearchBox placeholder="Нэр, утас, имэйл, регистрээр хайх" />
        <FilterSelect
          paramName="tenantId"
          placeholder="Бүх байгууллага"
          searchable
          options={tenants.map((t) => ({ value: t.id, label: t.name }))}
        />
      </div>

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
        {customers.length === 0 ? (
          <div className="px-5 py-16 text-center text-[var(--oc-muted3)] text-sm">
            Хайлтад тохирох үйлчлүүлэгч алга.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="border-b border-[var(--oc-line2)]">
                  {[
                    "Үйлчлүүлэгч",
                    "Утас",
                    "Байгууллага",
                    "Машин",
                    "Засварын хуудас",
                    "Аккаунт",
                    "Бүртгүүлсэн",
                  ].map((h) => (
                    <th
                      key={h}
                      className="text-left text-xs text-[var(--oc-muted4)] font-medium px-5 py-3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-[var(--oc-line2)] last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-5 py-4">
                      <div className="text-sm font-medium text-[var(--oc-ink2)]">
                        {customerLabel(c)}
                      </div>
                      {orgRegnumLabel(c) ? (
                        <div className="text-xs text-[var(--oc-muted3)]">{orgRegnumLabel(c)}</div>
                      ) : null}
                      {c.email ? (
                        <div className="text-xs text-[var(--oc-muted3)]">{c.email}</div>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 text-sm text-[var(--oc-muted)] tabular-nums">
                      {formatPhone(c.phone)}
                    </td>
                    <td className="px-5 py-4 text-sm text-[var(--oc-muted)]">
                      {c.tenant.name}
                    </td>
                    <td className="px-5 py-4 text-sm text-[var(--oc-muted)]">
                      {c._count.tenantVehicles}
                    </td>
                    <td className="px-5 py-4 text-sm text-[var(--oc-muted)]">
                      {c._count.serviceOrders}
                    </td>
                    <td className="px-5 py-4">
                      {c.accountId ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 light:bg-emerald-100 light:border-emerald-300 light:text-emerald-700">
                          Холбоотой
                        </span>
                      ) : (
                        <span className="text-[var(--oc-muted3)] text-xs">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs text-[var(--oc-muted3)]">
                      {c.createdAt.toLocaleDateString("mn-MN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={meta.page}
          totalPages={meta.totalPages}
          total={meta.total}
          params={{ q, tenantId }}
          tone="danger"
        />
      </div>
    </div>
  );
}
