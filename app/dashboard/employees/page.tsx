import { BulkEmployeesTable } from "./bulk-employees-table";
import {
  AddLinkButton,
  BtnLink,
  StatCell,
  StatGrid,
  TabLink,
  btnClass,
} from "@/app/_components/landing-ops-ui";
import {
  FilterSelect,
  ResetFilters,
  SearchBox,
} from "@/app/_components/list-filters";
import { EmptyState } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { requireUser } from "@/lib/auth";
import { canCreate, canDelete, canEdit, canView } from "@/lib/auth/roles";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { buildEmployeeWhere, type EmployeeStatusFilter } from "./data";

export const metadata = {
  title: "Ажилтнууд",
};

const STATUS_TABS: {
  key: "all" | "active" | "inactive" | "temp" | "expired";
  label: string;
}[] = [
  { key: "all", label: "Бүгд" },
  { key: "active", label: "Идэвхтэй" },
  { key: "inactive", label: "Идэвхгүй" },
  { key: "temp", label: "Түр" },
  { key: "expired", label: "Хугацаа дууссан" },
];

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    roleId?: string;
    branchId?: string;
    status?: string;
    page?: string;
  }>;
}) {
  const me = await requireUser();
  if (!canView(me, "employees")) redirect("/dashboard");
  const canAdd = canCreate(me, "employees");
  const canRemove = canDelete(me, "employees");
  const canModify = canEdit(me, "employees");

  const {
    q = "",
    roleId = "",
    branchId = "",
    status: statusParam,
    page: pageParam,
  } = await searchParams;
  const status: EmployeeStatusFilter =
    statusParam === "active" ||
    statusParam === "inactive" ||
    statusParam === "temp" ||
    statusParam === "expired"
      ? statusParam
      : undefined;

  const where = buildEmployeeWhere(me.tenantId, q, roleId, branchId, status);
  const { page, pageSize, skip, take } = getPageInfo(pageParam);

  const now = new Date();
  const [
    employees,
    filteredTotal,
    branches,
    roles,
    totalEmployees,
    activeEmployees,
    pendingActivation,
    expiredCount,
  ] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
      skip,
      take,
      include: {
        branch: { select: { id: true, name: true } },
        role: { select: { id: true, name: true } },
      },
    }),
    prisma.user.count({ where }),
    prisma.branch.findMany({
      where: { tenantId: me.tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.role.findMany({
      where: { tenantId: me.tenantId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.count({ where: { tenantId: me.tenantId, deletedAt: null } }),
    prisma.user.count({
      where: {
        tenantId: me.tenantId,
        deletedAt: null,
        isActive: true,
        verified: true,
        OR: [{ activeUntil: null }, { activeUntil: { gt: now } }],
      },
    }),
    prisma.user.count({
      where: {
        tenantId: me.tenantId,
        deletedAt: null,
        verified: false,
        OR: [{ activeUntil: null }, { activeUntil: { gt: now } }],
      },
    }),
    prisma.user.count({
      where: { tenantId: me.tenantId, deletedAt: null, activeUntil: { not: null, lte: now } },
    }),
  ]);
  const meta = buildMeta(filteredTotal, page, pageSize);

  const filterParams = { q, roleId, branchId, status };
  const exportQs = new URLSearchParams(
    Object.entries(filterParams).filter(([, v]) => v) as [string, string][],
  ).toString();
  const exportHref = `/dashboard/employees/export${exportQs ? `?${exportQs}` : ""}`;

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Ажилтнууд</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            Байгууллагын ажилтан, эрхүүдийг удирдах · {totalEmployees} ажилтан
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href={exportHref} className={btnClass("ghost", "md")}>
            Excel татах
          </a>
          {me.isOwner ? (
            <BtnLink href="/dashboard/employees/roles" variant="ghost">
              Үүргүүд
            </BtnLink>
          ) : null}
          {canAdd ? (
            <BtnLink href="/dashboard/employees/import" variant="ghost">
              Excel-ээс оруулах
            </BtnLink>
          ) : null}
          {canAdd ? (
            <AddLinkButton href="/dashboard/employees/new">Ажилтан нэмэх</AddLinkButton>
          ) : null}
        </div>
      </div>

      <StatGrid cols={4}>
        <StatCell label="Нийт ажилтан" value={totalEmployees} />
        <StatCell label="Идэвхтэй" value={activeEmployees} tone="ok" />
        <StatCell label="Идэвхжээгүй" value={pendingActivation} tone="accent" />
        <StatCell label="Хугацаа дууссан" value={expiredCount} tone="warn" />
      </StatGrid>

      {totalEmployees === 0 ? (
        <EmptyState
          title="Ажилтан олдсонгүй"
          description="Шүүлтүүрээ өөрчилж үзнэ үү эсвэл шинээр нэмнэ үү."
          cta={
            canAdd ? (
              <AddLinkButton href="/dashboard/employees/new">Эхний ажилтан нэмэх</AddLinkButton>
            ) : null
          }
        />
      ) : (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--oc-line)]">
            <SearchBox placeholder="Нэр, имэйл, утсаар хайх" className="w-full sm:w-64" />
            <FilterSelect
              paramName="roleId"
              placeholder="Бүх үүрэг"
              options={[
                { value: "__owner__", label: "Админ" },
                ...roles.map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
            <FilterSelect
              paramName="branchId"
              placeholder="Бүх салбар"
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
            />
            <div className="flex items-center gap-1.5">
              {STATUS_TABS.map((tab) => {
                const active = (status ?? "all") === tab.key;
                const params: Record<string, string> = {};
                if (q) params.q = q;
                if (roleId) params.roleId = roleId;
                if (branchId) params.branchId = branchId;
                if (tab.key !== "all") params.status = tab.key;
                const qs = new URLSearchParams(params).toString();
                const href = `/dashboard/employees${qs ? `?${qs}` : ""}`;
                return (
                  <TabLink key={tab.key} href={href} active={active}>
                    {tab.label}
                  </TabLink>
                );
              })}
            </div>
            <ResetFilters paramNames={["q", "roleId", "branchId", "status"]} />
            <span className="ml-auto font-plex-mono text-xs text-[var(--oc-muted3)] whitespace-nowrap">
              {employees.length} / {filteredTotal} харагдаж байна
            </span>
          </div>

          {employees.length === 0 ? (
            <p className="text-sm text-[var(--oc-muted3)] py-16 text-center">
              Хайлтад тохирох ажилтан олдсонгүй.
            </p>
          ) : (
            <BulkEmployeesTable
              rows={employees.map((u) => ({
                id: u.id,
                firstName: u.firstName,
                lastName: u.lastName,
                email: u.email,
                phone: u.phone,
                verified: u.verified,
                isActive: u.isActive,
                isOwner: u.isOwner,
                deactivatedAt: u.deactivatedAt?.toISOString() ?? null,
                activeUntil: u.activeUntil?.toISOString() ?? null,
                roleName: u.role?.name ?? null,
                branchName: u.branch?.name ?? null,
                isMe: u.id === me.id,
              }))}
              roles={roles}
              branches={branches}
              canBulkEdit={canModify}
              canModify={canModify}
              canRemove={canRemove}
            />
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t border-[var(--oc-line)] font-plex-mono text-xs text-[var(--oc-muted3)]">
            <span>
              {employees.length} / {filteredTotal} харагдаж байна
            </span>
            <span>
              Идэвхтэй {activeEmployees} · Идэвхжээгүй {pendingActivation}
            </span>
          </div>
          <Pagination
            page={meta.page}
            totalPages={meta.totalPages}
            total={meta.total}
            params={filterParams}
          />
        </div>
      )}
    </div>
  );
}
