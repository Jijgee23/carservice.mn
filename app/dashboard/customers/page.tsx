import { deleteCustomerAction } from "@/app/_actions/customers";
import { ClickableRow } from "@/app/_components/clickable-row";
import { RowActionsMenu, RowMenuFormItem } from "@/app/_components/row-actions";
import { BtnLink } from "@/app/_components/landing-ops-ui";
import { FilterSelect, ResetFilters, SearchBox } from "@/app/_components/list-filters";
import { Pagination } from "@/app/_components/pagination";
import { EmptyState } from "@/app/_components/page-header";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { customerDisplay, customerLabel, orgRegnumLabel } from "@/lib/customers";
import { buildCustomerListWhere, parseCustomerKind } from "@/lib/customers/customer-list-query";
import { requireUser } from "@/lib/auth";
import { canCreate, canDelete, canView, hasPermission } from "@/lib/auth/roles";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseSort } from "@/lib/list-sort";
import { SortableTh, TH_CLASS } from "@/app/_components/sortable-th";
import { CreateCustomerButton } from "./create-customer-modal";

export const metadata = {
  title: "Үйлчлүүлэгчид",
};

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; page?: string; sort?: string; dir?: string }>;
}) {
  const user = await requireUser();
  if (!canView(user, "customers")) redirect("/dashboard");
  const canAdd = canCreate(user, "customers");
  const canRemove = canDelete(user, "customers");
  const canNotify = hasPermission(user, "customers.notify");

  const { q = "", kind: kindParam, page: pageParam, sort: sortParam, dir: dirParam } =
    await searchParams;
  const sort = parseSort(
    { sort: sortParam, dir: dirParam },
    ["name", "date", "orders"] as const,
    { key: "date", dir: "desc" },
  );
  const orderBy =
    sort.key === "name"
      ? { fullName: sort.dir }
      : sort.key === "orders"
        ? { serviceOrders: { _count: sort.dir } }
        : { createdAt: sort.dir };
  const { page, pageSize, skip, take } = getPageInfo(pageParam);
  // P3-B6: канон where-builder — `lib/customers/customer-list-query.ts`.
  // Хайлтын талбарууд (fullName/phone/email) энэ хуудасны хуучин зан
  // төлөвтэй яг адил хэвээр; зөвхөн `q`-г дамжуулна, page/pageSize нь энд
  // тусад нь (`getPageInfo`-оор) удирддаг тул query-д хэрэггүй.
  const kind = parseCustomerKind(kindParam);
  const where = buildCustomerListWhere(
    { q: q || undefined, kind: kind === "invalid" ? undefined : kind, page, pageSize, skip, take },
    { tenantId: user.tenantId },
  );
  const [customers, total, allTotal] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: [orderBy, { id: "asc" }],
      skip,
      take,
      include: {
        _count: { select: { tenantVehicles: true, serviceOrders: true } },
      },
    }),
    prisma.customer.count({ where }),
    prisma.customer.count({ where: { tenantId: user.tenantId } }),
  ]);
  const meta = buildMeta(total, page, pageSize);

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Үйлчлүүлэгчид</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            Үйлчлүүлэгчдийн харилцагч мэдээлэл, түүх · {allTotal} үйлчлүүлэгч
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canNotify ? (
            <BtnLink href="/dashboard/customers/notify" variant="ghost">
              Зар илгээх
            </BtnLink>
          ) : null}
          {canAdd ? <CreateCustomerButton label="Үйлчлүүлэгч нэмэх" /> : null}
        </div>
      </div>

      {allTotal === 0 ? (
        <EmptyState
          title="Үйлчлүүлэгч алга"
          description="Эхний үйлчлүүлэгчээ нэмж эхлээрэй."
          cta={
            canAdd ? <CreateCustomerButton label="Эхний үйлчлүүлэгч нэмэх" /> : null
          }
        />
      ) : (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--oc-line)]">
            <SearchBox placeholder="Нэр, утас, имэйл, регистр, дугаараар хайх" />
            <FilterSelect
              paramName="kind"
              placeholder="Төрөл"
              options={[
                { value: "org", label: "Байгууллага" },
                { value: "person", label: "Хувь хүн" },
              ]}
            />
            <ResetFilters paramNames={["q", "kind"]} />
            <span className="ml-auto font-plex-mono text-xs text-[var(--oc-muted3)] whitespace-nowrap">
              {customers.length} / {total} харагдаж байна
            </span>
          </div>

          {customers.length === 0 ? (
            <p className="text-sm text-[var(--oc-muted3)] py-16 text-center">
              Хайлтад тохирох үйлчлүүлэгч олдсонгүй.
            </p>
          ) : (
            <div className="overflow-auto flex-1 min-h-0">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-[var(--oc-line)]">
                    <SortableTh label="Үйлчлүүлэгч" sortKey="name" current={sort} />
                    {["Утас", "Имэйл", "Машин"].map((h) => (
                      <th key={h} className={TH_CLASS}>
                        {h}
                      </th>
                    ))}
                    <SortableTh label="Засварын хуудас" sortKey="orders" current={sort} />
                    <SortableTh label="Огноо" sortKey="date" current={sort} />
                    <th className={TH_CLASS}>Үйлдэл</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--oc-line)]">
                  {customers.map((c) => (
                    <ClickableRow
                      key={c.id}
                      href={`/dashboard/customers/${c.id}`}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3 min-w-0 max-w-[280px]">
                          <div className="w-9 h-9 rounded-full border border-[var(--oc-line)] bg-[var(--oc-panel2)] flex items-center justify-center text-xs font-bold text-[var(--oc-ink2)] shrink-0">
                            {customerDisplay(c).primary[0]?.toUpperCase() ?? "?"}
                          </div>
                          <div className="min-w-0">
                            <span
                              className="block text-sm font-medium text-[var(--oc-ink)] truncate"
                              title={customerDisplay(c).primary}
                            >
                              {customerDisplay(c).primary}
                            </span>
                            {c.isOrganization ? (
                              <span className="flex items-center gap-2 text-xs text-[var(--oc-muted3)]">
                                <span className="rounded-full border border-[var(--oc-line)] px-1.5 text-[10px]">
                                  Байгууллага
                                </span>
                                {orgRegnumLabel(c) ? (
                                  <span className="font-plex-mono">{orgRegnumLabel(c)}</span>
                                ) : null}
                                <span className="truncate">{customerLabel(c)}</span>
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 font-plex-mono text-sm text-[var(--oc-muted2)]">
                        {c.phone}
                      </td>
                      <td className="px-5 py-4 text-sm text-[var(--oc-muted2)]">
                        {c.email ?? "—"}
                      </td>
                      <td className="px-5 py-4 font-plex-mono text-sm text-[var(--oc-ink2)]">
                        {c._count.tenantVehicles}
                      </td>
                      <td className="px-5 py-4 font-plex-mono text-sm text-[var(--oc-ink2)]">
                        {c._count.serviceOrders}
                      </td>
                      <td className="px-5 py-4 font-plex-mono text-xs text-[var(--oc-muted3)] whitespace-nowrap">
                        {c.createdAt.toLocaleDateString("mn-MN")}
                      </td>
                      <td className="px-5 py-4">
                        {canRemove ? (
                          <RowActionsMenu>
                            <RowMenuFormItem
                              action={deleteCustomerAction}
                              hidden={{ id: c.id }}
                              confirmMessage={`"${customerLabel(c)}" үйлчлүүлэгчийг устгах уу?`}
                              destructive
                            >
                              Устгах
                            </RowMenuFormItem>
                          </RowActionsMenu>
                        ) : null}
                      </td>
                    </ClickableRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t border-[var(--oc-line)] font-plex-mono text-xs text-[var(--oc-muted3)]">
            <span>
              {customers.length} / {total} харагдаж байна
            </span>
          </div>
          <Pagination
            page={meta.page}
            totalPages={meta.totalPages}
            total={meta.total}
            params={{ q, kind: kindParam ?? "", sort: sortParam ?? "", dir: dirParam ?? "" }}
          />
        </div>
      )}
    </div>
  );
}
