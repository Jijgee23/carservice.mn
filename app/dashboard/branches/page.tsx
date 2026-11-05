import { deleteBranchAction, toggleBranchActiveAction } from "@/app/_actions/branches";
import { ClickableRow } from "@/app/_components/clickable-row";
import {
  AddLinkButton,
  Chip,
  StatCell,
  StatGrid,
  TabLink,
  btnClass,
} from "@/app/_components/landing-ops-ui";
import { EmptyState } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { RowActionsMenu, RowMenuFormItem } from "@/app/_components/row-actions";
import { SearchBox } from "@/app/_components/list-filters";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { requireUser } from "@/lib/auth";
import { getEnabledModules } from "@/lib/plan-modules-server";
import { canCreate, canDelete, canEdit, canView } from "@/lib/auth/roles";
import { redirect } from "next/navigation";
import { formatAddress, formatWorkDays, formatWorkHoursSummary } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { buildBranchWhere, type BranchStatusFilter } from "./data";

export const metadata = {
  title: "Салбарууд",
};

const STATUS_TABS: { key: "all" | "active" | "inactive"; label: string }[] = [
  { key: "all", label: "Бүгд" },
  { key: "active", label: "Идэвхтэй" },
  { key: "inactive", label: "Идэвхгүй" },
];

export default async function BranchesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string; scheduleWarning?: string }>;
}) {
  const user = await requireUser();
  if (!canView(user, "branches")) redirect("/dashboard");
  const canAdd = canCreate(user, "branches");
  // «Олон салбар» модуль багцад ороогүй бол зөвхөн анхны салбарыг үүсгэнэ.
  const multiBranch = (await getEnabledModules(user.tenant.plan)).has("enable_multi_branch");
  const canRemove = canDelete(user, "branches");
  const canModify = canEdit(user, "branches");

  const { page: pageParam, q: qParam, status: statusParam, scheduleWarning } = await searchParams;
  const q = qParam ?? "";
  const status: BranchStatusFilter =
    statusParam === "active" || statusParam === "inactive" ? statusParam : undefined;
  const where = buildBranchWhere(user.tenantId, q, status);
  const { page, pageSize, skip, take } = getPageInfo(pageParam);

  const [branches, filteredTotal, totalBranches, activeBranches, totalStaff, openOrders] =
    await Promise.all([
      prisma.branch.findMany({
        where,
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        skip,
        take,
        include: {
          _count: { select: { users: true, serviceOrders: true } },
          schedules: { select: { weekday: true, isOpen: true, openTime: true, closeTime: true } },
        },
      }),
      prisma.branch.count({ where }),
      prisma.branch.count({ where: { tenantId: user.tenantId } }),
      prisma.branch.count({ where: { tenantId: user.tenantId, isActive: true } }),
      prisma.user.count({
        where: { tenantId: user.tenantId, branchId: { not: null } },
      }),
      prisma.serviceOrder.count({
        where: {
          tenantId: user.tenantId,
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        },
      }),
    ]);
  const meta = buildMeta(filteredTotal, page, pageSize);

  const exportHref = `/dashboard/branches/export${
    q || status ? `?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) }).toString()}` : ""
  }`;

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Салбарууд</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            Байгууллагын салбаруудыг удирдах · {totalBranches} салбар
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href={exportHref} className={btnClass("ghost", "md")}>
            Excel татах
          </a>
          {canAdd && (multiBranch || totalBranches === 0) ? (
            <AddLinkButton href="/dashboard/branches/new">Салбар нэмэх</AddLinkButton>
          ) : null}
        </div>
      </div>

      <StatGrid cols={4}>
        <StatCell label="Нийт салбар" value={totalBranches} />
        <StatCell label="Идэвхтэй" value={activeBranches} tone="ok" />
        <StatCell label="Ажилтан" value={totalStaff} />
        <StatCell label="Нээлттэй засварын хуудас" value={openOrders} tone="accent" />
      </StatGrid>

      {scheduleWarning && Number(scheduleWarning) > 0 ? (
        <div className="mt-5 rounded-[10px] border border-[var(--oc-warn)]/30 bg-[var(--oc-warn)]/10 px-4 py-3 text-sm text-[var(--oc-warn)]">
          Хуваарь хадгалагдлаа. {scheduleWarning} захиалгын үргэлжлэх хугацааг шинэ хаах цагт тааруулан богиносголоо.
        </div>
      ) : null}

      {totalBranches === 0 ? (
        <EmptyState
          title="Салбар алга байна"
          description="Эхний салбараа үүсгэж эхлээрэй. Олон салбар нэмэх боломжтой."
          cta={
            canAdd ? (
              <AddLinkButton href="/dashboard/branches/new">Эхний салбар үүсгэх</AddLinkButton>
            ) : null
          }
        />
      ) : (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--oc-line)]">
            <SearchBox placeholder="Нэр, хаяг, утсаар хайх" className="w-full sm:w-72" />
            <div className="flex items-center gap-1.5">
              {STATUS_TABS.map((tab) => {
                const active = (status ?? "all") === tab.key;
                const params: Record<string, string> = {};
                if (q) params.q = q;
                if (tab.key !== "all") params.status = tab.key;
                const qs = new URLSearchParams(params).toString();
                const href = `/dashboard/branches${qs ? `?${qs}` : ""}`;
                return (
                  <TabLink key={tab.key} href={href} active={active}>
                    {tab.label}
                  </TabLink>
                );
              })}
            </div>
            <span className="ml-auto font-plex-mono text-xs text-[var(--oc-muted3)] whitespace-nowrap">
              {branches.length} / {filteredTotal} харагдаж байна
            </span>
          </div>

          {branches.length === 0 ? (
            <p className="text-sm text-[var(--oc-muted3)] py-16 text-center">
              Хайлтад тохирох салбар олдсонгүй.
            </p>
          ) : (
            <div className="overflow-auto flex-1 min-h-0">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-[var(--oc-line)]">
                    {[
                      "Нэр",
                      "Хаяг",
                      "Цаг",
                      "Ажиллах өдөр",
                      "Утас",
                      "Ажилтан",
                      "Засварын хуудас",
                      "Үйлдэл",
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-5 py-3"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--oc-line)]">
                  {branches.map((b) => (
                    <ClickableRow key={b.id} href={`/dashboard/branches/${b.id}`}>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] flex items-center justify-center text-sm font-bold text-[var(--oc-ink2)] shrink-0">
                            {b.name[0]?.toUpperCase() ?? "?"}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-[var(--oc-ink)]">
                                {b.name}
                              </span>
                              {b.isPrimary ? <Chip tone="accent">Үндсэн</Chip> : null}
                            </div>
                            <div className="text-xs text-[var(--oc-muted3)]">
                              {b.createdAt.toLocaleDateString("mn-MN")}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-[var(--oc-muted2)] max-w-xs">
                        <div className="line-clamp-2">{formatAddress(b)}</div>
                        {b.latitude != null && b.longitude != null ? (
                          <a
                            href={`https://www.google.com/maps?q=${b.latitude},${b.longitude}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
                          >
                            Газрын зураг →
                          </a>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 font-plex-mono text-sm text-[var(--oc-muted)] whitespace-nowrap">
                        {formatWorkHoursSummary(b)}
                      </td>
                      <td className="px-5 py-4 text-xs text-[var(--oc-muted3)] whitespace-nowrap">
                        {formatWorkDays(b.schedules)}
                      </td>
                      <td className="px-5 py-4 font-plex-mono text-sm text-[var(--oc-muted2)]">
                        {b.phone ?? "—"}
                      </td>
                      <td className="px-5 py-4 font-plex-mono text-sm text-[var(--oc-ink2)]">
                        {b._count.users}
                      </td>
                      <td className="px-5 py-4 font-plex-mono text-sm text-[var(--oc-ink2)]">
                        {b._count.serviceOrders}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <Chip tone={b.isActive ? "ok" : "neutral"}>
                            {b.isActive ? "Идэвхтэй" : "Идэвхгүй"}
                          </Chip>
                          <BranchRowActions
                            branch={b}
                            canModify={canModify}
                            canRemove={canRemove}
                          />
                        </div>
                      </td>
                    </ClickableRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t border-[var(--oc-line)] font-plex-mono text-xs text-[var(--oc-muted3)]">
            <span>
              {branches.length} / {filteredTotal} харагдаж байна
            </span>
            <span>
              Нийт ажилтан {totalStaff} · Нээлттэй засварын хуудас {openOrders}
            </span>
          </div>
          <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} />
        </div>
      )}
    </div>
  );
}

function BranchRowActions({
  branch,
  canModify,
  canRemove,
}: {
  branch: { id: string; name: string; isPrimary: boolean; isActive: boolean };
  canModify: boolean;
  canRemove: boolean;
}) {
  const showToggle = canModify && !(branch.isPrimary && branch.isActive);
  const showDelete = canRemove && !branch.isPrimary;
  if (!showToggle && !showDelete) return null;

  return (
    <RowActionsMenu>
      {showToggle ? (
        <RowMenuFormItem action={toggleBranchActiveAction} hidden={{ id: branch.id }}>
          {branch.isActive ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
        </RowMenuFormItem>
      ) : null}
      {showDelete ? (
        <RowMenuFormItem
          action={deleteBranchAction}
          hidden={{ id: branch.id }}
          confirmMessage={`"${branch.name}" салбарыг устгах уу?`}
          destructive
        >
          Устгах
        </RowMenuFormItem>
      ) : null}
    </RowActionsMenu>
  );
}
