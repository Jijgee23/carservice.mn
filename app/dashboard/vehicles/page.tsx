import Link from "next/link";
import { deleteVehicleAction } from "@/app/_actions/vehicles";
import { ClickableRow } from "@/app/_components/clickable-row";
import {
  FilterSelect,
  ResetFilters,
  SearchBox,
} from "@/app/_components/list-filters";
import { EmptyState } from "@/app/_components/page-header";
import { StatCell, StatGrid } from "@/app/_components/landing-ops-ui";
import { CreateVehicleButton } from "./create-vehicle-modal";
import { Pagination } from "@/app/_components/pagination";
import { CarIcon } from "@/app/_components/landing-icons";
import {
  RowActionsMenu,
  RowMenuFormItem,
} from "@/app/_components/row-actions";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { customerDisplay } from "@/lib/customers";
import { vehicleOwnerIsOrganization } from "@/lib/vehicles/owner-kind";
import { buildVehicleListWhere } from "@/lib/vehicles/vehicle-list-query";
import { POSTPAID_BADGE, POSTPAID_LABEL } from "@/lib/orders";
import { requireUser } from "@/lib/auth";
import { canCreate, canDelete, canView } from "@/lib/auth/roles";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseSort } from "@/lib/list-sort";
import { SortableTh, TH_CLASS } from "@/app/_components/sortable-th";

export const metadata = {
  title: "Машинууд",
};

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    assigned?: string;
    postpaid?: string;
    ownerKind?: string;
    page?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const user = await requireUser();
  if (!canView(user, "vehicles")) redirect("/dashboard");
  const canAdd = canCreate(user, "vehicles");
  const canRemove = canDelete(user, "vehicles");

  const {
    q = "",
    assigned = "",
    postpaid = "",
    ownerKind = "",
    page: pageParam,
    sort: sortParam,
    dir: dirParam,
  } = await searchParams;
  const sort = parseSort(
    { sort: sortParam, dir: dirParam },
    ["plate", "mileage", "date"] as const,
    { key: "date", dir: "desc" },
  );
  const orderBy =
    sort.key === "plate"
      ? { vehicle: { plate: sort.dir } }
      : sort.key === "mileage"
        ? { vehicle: { mileage: { sort: sort.dir, nulls: "last" as const } } }
        : { createdAt: sort.dir };
  const { page, pageSize, skip, take } = getPageInfo(pageParam);
  // P3-B6: канон where-builder — `lib/vehicles/vehicle-list-query.ts`.
  // Тенантын "машинууд" = TenantVehicle link-үүд (global Vehicle руу заана),
  // энэ хуудасны хайлт/шүүлтүүрийн зан төлөв (plate/make/model/vin + эзэмшигчийн
  // нэр/утас, assigned, postpaid) хуучин хэвээр — өөрчлөгдөөгүй.
  const where = buildVehicleListWhere(
    {
      q: q || undefined,
      assigned: assigned === "yes" || assigned === "no" ? assigned : undefined,
      postpaid: postpaid === "yes" || postpaid === "no" ? postpaid : undefined,
      ownerKind: ownerKind === "org" || ownerKind === "person" ? ownerKind : undefined,
      page,
      pageSize,
      skip,
      take,
    },
    { tenantId: user.tenantId },
  );
  const [links, total, totalVehicles, assignedVehicles, postpaidVehicles, customers] =
    await Promise.all([
      prisma.tenantVehicle.findMany({
        where,
        orderBy: [orderBy, { id: "asc" }],
        skip,
        take,
        select: {
          isPostpaid: true,
          customer: {
            select: { id: true, fullName: true, phone: true, isOrganization: true, orgName: true },
          },
          vehicle: {
            select: {
              id: true,
              plate: true,
              make: true,
              model: true,
              year: true,
              mileage: true,
              ownerRegnum: true,
            },
          },
        },
      }),
      prisma.tenantVehicle.count({ where }),
      prisma.tenantVehicle.count({ where: { tenantId: user.tenantId } }),
      prisma.tenantVehicle.count({
        where: { tenantId: user.tenantId, customerId: { not: null } },
      }),
      prisma.tenantVehicle.count({
        where: { tenantId: user.tenantId, isPostpaid: true },
      }),
      prisma.customer.findMany({
        where: { tenantId: user.tenantId },
        orderBy: { fullName: "asc" },
        select: { id: true, fullName: true, phone: true, isOrganization: true, orgRegnum: true },
      }),
    ]);
  const meta = buildMeta(total, page, pageSize);

  // Захиалгын тоог ЭНЭ tenant-аар хязгаарлаж тоолно (global vehicle нийт
  // tenant-ийн захиалгыг агуулдаг тул шууд _count ашиглах нь буруу).
  const vehicleIds = links.map((l) => l.vehicle.id);
  const orderCounts = vehicleIds.length
    ? await prisma.serviceOrder.groupBy({
        by: ["vehicleId"],
        where: { tenantId: user.tenantId, vehicleId: { in: vehicleIds } },
        _count: { _all: true },
      })
    : [];
  const orderCountMap = new Map(
    orderCounts.map((o) => [o.vehicleId, o._count._all]),
  );

  const vehicles = links.map((l) => ({
    id: l.vehicle.id,
    plate: l.vehicle.plate,
    make: l.vehicle.make,
    model: l.vehicle.model,
    year: l.vehicle.year,
    mileage: l.vehicle.mileage,
    isPostpaid: l.isPostpaid,
    customer: l.customer,
    ownerIsOrganization: vehicleOwnerIsOrganization(l.customer, l.vehicle.ownerRegnum),
    _count: { serviceOrders: orderCountMap.get(l.vehicle.id) ?? 0 },
  }));

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Машинууд</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            Үйлчлүүлэгчдийн машин, бүртгэлийн мэдээлэл · {totalVehicles} машин
          </p>
        </div>
        {canAdd ? (
          <CreateVehicleButton label="Машин нэмэх" customers={customers} />
        ) : null}
      </div>

      <StatGrid cols={3}>
        <StatCell label="Нийт машин" value={totalVehicles} />
        <StatCell label="Эзэмшигчтэй" value={assignedVehicles} tone="ok" />
        <StatCell label="Дараа төлбөрт" value={postpaidVehicles} tone="accent" />
      </StatGrid>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <SearchBox placeholder="Дугаар, марк, эзэмшигчээр хайх" />
        <FilterSelect
          paramName="assigned"
          placeholder="Эзэмшигч"
          options={[
            { value: "yes", label: "Эзэмшигчтэй" },
            { value: "no", label: "Эзэмшигчгүй" },
          ]}
        />
        <FilterSelect
          paramName="postpaid"
          placeholder="Төлбөрийн нөхцөл"
          options={[
            { value: "yes", label: "Дараа төлбөрт" },
            { value: "no", label: "Энгийн" },
          ]}
        />
        <FilterSelect
          paramName="ownerKind"
          placeholder="Эзэмшигчийн төрөл"
          options={[
            { value: "org", label: "Байгууллага" },
            { value: "person", label: "Хувь хүн" },
          ]}
        />
        <ResetFilters paramNames={["q", "assigned", "postpaid", "ownerKind"]} />
      </div>

      {vehicles.length === 0 ? (
        <EmptyState
          title={q || assigned || postpaid ? "Машин олдсонгүй" : "Машин алга"}
          description={
            q || assigned || postpaid
              ? "Шүүлтүүрээ цэвэрлэж дахин үзнэ үү."
              : "Эхний машинаа бүртгэж эхлээрэй."
          }
          cta={
            canAdd ? (
              <CreateVehicleButton label="Эхний машин нэмэх" customers={customers} />
            ) : null
          }
        />
      ) : (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-[var(--oc-line)]">
                  <th className={TH_CLASS}>Машин</th>
                  <SortableTh label="Дугаар" sortKey="plate" current={sort} />
                  <th className={TH_CLASS}>Эзэмшигч</th>
                  <SortableTh label="Гүйлт" sortKey="mileage" current={sort} />
                  <th className={TH_CLASS}>Засварын хуудас</th>
                  <th className={TH_CLASS} />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--oc-line)]">
                {vehicles.map((v) => (
                  <ClickableRow
                    key={v.id}
                    href={`/dashboard/vehicles/${v.id}`}
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] flex items-center justify-center text-[var(--oc-ink2)] shrink-0">
                          <CarIcon />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-[var(--oc-ink)]">
                            {v.make} {v.model}
                          </div>
                          <div className="text-xs text-[var(--oc-muted3)]">
                            {v.year ? `${v.year} он` : "—"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="font-plex-mono text-sm font-medium text-[var(--oc-ink2)]">
                        {v.plate}
                      </span>
                      {v.isPostpaid ? (
                        <span
                          className={`ml-2 inline-block align-middle font-plex-mono text-[10px] px-1.5 py-0.5 rounded-full ${POSTPAID_BADGE}`}
                        >
                          {POSTPAID_LABEL}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 text-sm">
                      {v.customer ? (
                        <Link
                          href={`/dashboard/customers/${v.customer.id}`}
                          className="text-[var(--oc-muted2)] hover:text-[var(--oc-accent)] transition-colors"
                        >
                          {customerDisplay(v.customer).primary}
                          {v.ownerIsOrganization ? (
                            <span className="ml-2 inline-block align-middle rounded-full border border-[var(--oc-line)] px-1.5 py-0.5 text-[10px] text-[var(--oc-muted)]">
                          Байгууллага
                        </span>
                          ) : null}
                          <span className="text-[var(--oc-muted3)] text-xs ml-1">
                            · {v.customer.phone}
                          </span>
                        </Link>
                      ) : (
                        <span className="text-[var(--oc-muted4)]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 font-plex-mono text-sm text-[var(--oc-muted2)]">
                      {v.mileage != null
                        ? `${v.mileage.toLocaleString("mn-MN")} км`
                        : "—"}
                    </td>
                    <td className="px-5 py-4 font-plex-mono text-sm text-[var(--oc-ink2)]">
                      {v._count.serviceOrders}
                    </td>
                    <td className="px-5 py-4">
                      {canRemove ? (
                        <RowActionsMenu>
                          <RowMenuFormItem
                            action={deleteVehicleAction}
                            hidden={{ id: v.id }}
                            confirmMessage={`${v.plate} машиныг устгах уу?`}
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
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t border-[var(--oc-line)] font-plex-mono text-xs text-[var(--oc-muted3)]">
            <span>
              {vehicles.length} / {total} харагдаж байна
            </span>
          </div>
          <Pagination
            page={meta.page}
            totalPages={meta.totalPages}
            total={meta.total}
            params={{
              q,
              assigned,
              postpaid,
              ownerKind,
              sort: sortParam ?? "",
              dir: dirParam ?? "",
            }}
          />
        </div>
      )}
    </div>
  );
}
