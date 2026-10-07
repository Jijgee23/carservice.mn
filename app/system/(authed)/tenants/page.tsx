import Link from "next/link";
import { PageHeader } from "@/app/_components/page-header";
import { Pagination } from "@/app/_components/pagination";
import { requireSuperAdmin } from "@/lib/auth/system";
import { formatTugrik } from "@/lib/orders";
import { buildMeta, getPageInfo } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";

export const metadata = {
  title: "Байгууллагууд",
};

const PLAN_BADGE: Record<string, string> = {
  FREE: "bg-zinc-500/15 text-zinc-300 border border-zinc-500/25 light:bg-zinc-100 light:border-zinc-300 light:text-zinc-600",
  BUSINESS: "bg-violet-500/15 text-violet-300 border border-violet-500/25 light:bg-violet-100 light:border-violet-300 light:text-violet-700",
  ENTERPRISE: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 light:bg-emerald-100 light:border-emerald-300 light:text-emerald-700",
};

export default async function SystemTenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; page?: string }>;
}) {
  await requireSuperAdmin();
  const { filter, q, page: pageParam } = await searchParams;

  const where = {
    ...(filter === "suspended" ? { suspended: true } : {}),
    ...(filter === "active" ? { suspended: false } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { registerNumber: { contains: q } },
            { email: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const { page, pageSize, skip, take } = getPageInfo(pageParam);
  const [tenants, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        _count: {
          select: {
            users: true,
            branches: true,
            customers: true,
            serviceOrders: true,
          },
        },
      },
    }),
    prisma.tenant.count({ where }),
  ]);
  const meta = buildMeta(total, page, pageSize);

  // Тус бүрийн орлогыг тооцох
  const ids = tenants.map((t) => t.id);
  const revenueAgg = await prisma.serviceOrder.groupBy({
    by: ["tenantId"],
    where: { tenantId: { in: ids }, status: "COMPLETED", isInternal: false },
    _sum: { totalAmount: true },
  });
  const revenueByTenant = Object.fromEntries(
    revenueAgg.map((r) => [
      r.tenantId,
      Number.parseFloat(r._sum.totalAmount?.toString() ?? "0"),
    ]),
  );

  return (
    <div className="p-6 sm:p-8 max-w-screen">
      <PageHeader
        title="Байгууллагууд"
        description={`Платформ дээр бүртгэлтэй ${total} байгууллага`}
      />

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
        <div className="p-4 border-b border-[var(--oc-line2)] flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {(
              [
                { v: "", label: "Бүгд" },
                { v: "active", label: "Идэвхтэй" },
                { v: "suspended", label: "Зогссон" },
              ] as const
            ).map((f) => {
              const href =
                "/system/tenants" +
                (f.v ? `?filter=${f.v}` : "") +
                (q ? `${f.v ? "&" : "?"}q=${encodeURIComponent(q)}` : "");
              const active = (filter ?? "") === f.v;
              return (
                <Link
                  key={f.v || "all"}
                  href={href}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                    active
                      ? "bg-[var(--oc-accent)]/20 text-[var(--oc-accent)] border border-[var(--oc-accent)]/30"
                      : "text-[var(--oc-muted3)] hover:text-[var(--oc-muted)] border border-[var(--oc-line)] hover:border-[var(--oc-line2)]"
                  }`}
                >
                  {f.label}
                </Link>
              );
            })}
          </div>

          <form
            className="ml-auto flex items-center gap-2"
            action="/system/tenants"
          >
            {filter ? (
              <input type="hidden" name="filter" value={filter} />
            ) : null}
            <input
              type="text"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Нэр, регистр, имэйл..."
              className="auth-input !py-1.5 !text-xs w-56"
            />
            <button
              type="submit"
              className="text-xs bg-[var(--oc-accent)]/20 hover:bg-[var(--oc-accent)]/30 border border-[var(--oc-accent)]/30 text-[var(--oc-accent)] transition-colors px-3 py-1.5 rounded-lg font-medium"
            >
              Хайх
            </button>
          </form>
        </div>

        {tenants.length === 0 ? (
          <div className="px-5 py-16 text-center text-[var(--oc-muted3)] text-sm">
            Хайлтад тохирох байгууллага алга.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-[var(--oc-line2)]">
                  {[
                    "Байгууллага",
                    "Регистр",
                    "Багц",
                    "Салбар",
                    "Ажилтан",
                    "Засварын хуудас",
                    "Орлого",
                    "Статус",
                    "Бүртгүүлсэн",
                  ].map((h) => (
                    <th
                      key={h}
                      className="text-left text-xs text-[var(--oc-muted3)] font-medium px-5 py-3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-[var(--oc-line2)] last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-5 py-4">
                      <Link
                        href={`/system/tenants/${t.id}`}
                        className="flex items-center gap-3 group"
                      >
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--oc-accent)]/30 to-[var(--oc-accent-hi)]/20 flex items-center justify-center text-sm font-bold text-[var(--oc-accent)] shrink-0">
                          {t.name[0]?.toUpperCase() ?? "?"}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-[var(--oc-ink2)] group-hover:text-[var(--oc-accent)] transition-colors">
                            {t.name}
                          </div>
                          <div className="text-xs text-[var(--oc-muted3)]">
                            {t.email}
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-xs font-mono text-[var(--oc-muted)]">
                      {t.registerNumber}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          PLAN_BADGE[t.plan] ?? PLAN_BADGE.FREE
                        }`}
                      >
                        {t.plan}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm text-[var(--oc-muted)]">
                      {t._count.branches}
                    </td>
                    <td className="px-5 py-4 text-sm text-[var(--oc-muted)]">
                      {t._count.users}
                    </td>
                    <td className="px-5 py-4 text-sm text-[var(--oc-muted)]">
                      {t._count.serviceOrders}
                    </td>
                    <td className="px-5 py-4 text-sm text-[var(--oc-ink2)]">
                      {formatTugrik(revenueByTenant[t.id] ?? 0)}
                    </td>
                    <td className="px-5 py-4">
                      {t.suspended ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--oc-warn)]/15 text-[var(--oc-warn)] border border-[var(--oc-warn)]/25">
                          Зогссон
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 light:bg-emerald-100 light:border-emerald-300 light:text-emerald-700">
                          Идэвхтэй
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs text-[var(--oc-muted3)]">
                      {t.createdAt.toLocaleDateString("mn-MN")}
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
          params={{ filter: filter ?? "", q: q ?? "" }}
          tone="danger"
        />
      </div>
    </div>
  );
}
