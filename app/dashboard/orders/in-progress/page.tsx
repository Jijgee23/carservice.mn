import Link from "next/link";
import { redirect } from "next/navigation";
import { Prisma } from "@/app/generated/prisma/client";
import { BtnLink } from "@/app/_components/landing-ops-ui";
import { PageHeader } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { requireUser } from "@/lib/auth";
import { getBranchVisibility } from "@/lib/branch-visibility";
import { canView, workingBranchScopeId } from "@/lib/auth/roles";
import { orderReadWhere } from "@/lib/auth/order-access";
import { ORDER_STATUS_BADGE, ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/orders";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";

export const metadata = {
  title: "Явц харах",
};

// Dashboard-ийн "Сүүлд шинэчлэгдсэн" widget-тэй ижил карт хэлбэрийн мөр
// (хүснэгт биш) ашиглана — гэхдээ энд зөвхөн IN_PROGRESS, хуудаслагдсан бүгд.
export default async function InProgressOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireUser();
  if (!canView(user, "orders")) redirect("/dashboard");

  const { page: pageParam } = await searchParams;

  // Салбараар хязгаарлагдсан ажилтан зөвхөн өөрийн салбарынхыг харна.
  const scopeBranchId = workingBranchScopeId(user);

  const where: Prisma.ServiceOrderWhereInput = {
    tenantId: user.tenantId,
    status: "IN_PROGRESS",
    ...orderReadWhere(user),
    ...(scopeBranchId ? { branchId: scopeBranchId } : {}),
  };

  const { page, pageSize, skip, take } = getPageInfo(pageParam);
  const [orders, total] = await Promise.all([
    prisma.serviceOrder.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        number: true,
        status: true,
        updatedAt: true,
        customer: { select: { fullName: true } },
        vehicle: { select: { plate: true } },
        branch: { select: { name: true } },
        items: { select: { status: true, kind: true } },
      },
    }),
    prisma.serviceOrder.count({ where }),
  ]);
  const meta = buildMeta(total, page, pageSize);
  // Owner/tenant-wide харагдацад олон салбарын мөр холилдоно тул салбарыг ч
  // харуулна; ганц салбарт хязгаарлагдсан ажилтанд илүүц тул нуугдана.
  // Энгийн багц (ганц салбар): салбарыг огт харуулахгүй.
  const { hideBranches } = await getBranchVisibility(user);
  const showBranch = scopeBranchId == null && !hideBranches;

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <PageHeader
        title="Явц харах"
        description="Одоогоор хийгдэж байгаа захиалгууд"
        actions={
          <BtnLink href="/dashboard/orders" variant="ghost">
            ← Бүх захиалга
          </BtnLink>
        }
      />

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-[var(--oc-line)]">
          <h2 className="font-semibold text-[var(--oc-ink)]">Хийгдэж буй захиалгууд</h2>
          <span className="font-plex-mono text-[11px] text-[var(--oc-muted3)]">
            {total} захиалга
          </span>
        </div>

        {orders.length === 0 ? (
          <p className="text-sm text-[var(--oc-muted3)] py-16 text-center flex-1">
            Одоогоор хийгдэж буй захиалга алга.
          </p>
        ) : (
          <div className="divide-y divide-[var(--oc-line)] overflow-auto flex-1 min-h-0">
            {orders.map((o) => {
              const status = o.status as OrderStatus;
              // Сэлбэг (PART) мөрүүд явцгүй тул тооцоололд оролцохгүй.
              const activeItems = o.items.filter(
                (it) => it.status !== "CANCELLED" && it.kind !== "PART",
              );
              const completedCount = activeItems.filter(
                (it) => it.status === "COMPLETED",
              ).length;
              const percent =
                activeItems.length > 0
                  ? Math.round((completedCount / activeItems.length) * 100)
                  : 0;
              return (
                <Link
                  key={o.id}
                  href={`/dashboard/orders/${o.id}`}
                  className="block px-5 sm:px-6 py-3.5 text-[13px] hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <span className="font-plex-mono text-[var(--oc-ink2)] shrink-0 w-14">
                      #{o.number}
                    </span>
                    <span className="text-[var(--oc-muted2)] flex-1 min-w-0 truncate">
                      {o.customer.fullName}
                      <span className="text-[var(--oc-muted4)]"> · {o.vehicle.plate}</span>
                      {showBranch ? (
                        <span className="text-[var(--oc-muted4)]"> · {o.branch.name}</span>
                      ) : null}
                    </span>
                    <span
                      className={`hidden sm:inline shrink-0 rounded-full px-2 py-0.5 font-plex-mono text-[11px] ${ORDER_STATUS_BADGE[status]}`}
                    >
                      {ORDER_STATUS_LABEL[status]}
                    </span>
                    <span className="font-plex-mono text-[var(--oc-muted3)] text-xs shrink-0 w-[7.5rem] text-right">
                      {o.updatedAt.toLocaleString("mn-MN", {
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ${
                          percent >= 100 ? "bg-emerald-500" : "bg-[var(--oc-accent)]"
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span
                      className={`font-plex-mono text-[11px] tabular-nums shrink-0 w-9 text-right ${
                        percent >= 100
                          ? "text-emerald-400 light:text-emerald-600"
                          : "text-[var(--oc-muted3)]"
                      }`}
                    >
                      {percent}%
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} />
      </div>
    </div>
  );
}
