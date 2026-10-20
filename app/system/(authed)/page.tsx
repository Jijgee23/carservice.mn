import Link from "next/link";
import { PageHeader } from "@/app/_components/page-header";
import { requireSuperAdmin } from "@/lib/auth/system";
import { formatTugrik } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export const metadata = {
  title: "Системийн тойм",
};


const REAL_TENANT = { isTest: false } as const;

export default async function SystemOverviewPage() {
  const admin = await requireSuperAdmin();

  const [
    tenantCount,
    activeTenants,
    suspendedTenants,
    userCount,
    orderCount,
    subscriptionRevenueAgg,
    bookingRevenueAgg,
    planCounts,
    recentTenants,
  ] = await Promise.all([
    // Тест/демо тенант (isTest) системийн тоо, орлогод орохгүй.
    prisma.tenant.count({ where: REAL_TENANT }),
    prisma.tenant.count({ where: { ...REAL_TENANT, suspended: false } }),
    prisma.tenant.count({ where: { ...REAL_TENANT, suspended: true } }),
    prisma.user.count({ where: { tenant: REAL_TENANT } }),
    prisma.serviceOrder.count({ where: { tenant: REAL_TENANT } }),
    // Платформын өөрийн орлого — байгууллагуудаас авсан багцын (subscription)
    // ТӨЛӨГДСӨН төлбөрийн нийлбэр. Өмнө нь энд буруугаар бүх тенантын
    // ДУУССАН засварын хуудасны нийлбэр (тэдгээрийн ӨӨРСДИЙН орлого, платформын
    // орлого биш) харагдаж байсныг засав.
    prisma.subscriptionPayment.aggregate({
      where: { status: "PAID", tenant: REAL_TENANT },
      _sum: { amount: true },
    }),
    // Цэвэр орлого — буцаагдсаныг (REFUNDED) хасна.
    prisma.appointmentPayment.aggregate({
      where: { status: "PAID", tenant: REAL_TENANT },
      _sum: { amount: true },
    }),
    prisma.tenant.groupBy({
      by: ["plan"],
      where: REAL_TENANT,
      _count: { _all: true },
    }),
    prisma.tenant.findMany({
      where: REAL_TENANT,
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        name: true,
        registerNumber: true,
        plan: true,
        suspended: true,
        createdAt: true,
        _count: { select: { users: true } },
      },
    }),
  ]);

  const subscriptionRevenue = Number.parseFloat(
    subscriptionRevenueAgg._sum.amount?.toString() ?? "0",
  );
  const bookingRevenue = Number.parseFloat(
    bookingRevenueAgg._sum.amount?.toString() ?? "0",
  );

  const planMap = Object.fromEntries(
    planCounts.map((p) => [p.plan, p._count._all]),
  );

  return (
    <div className="p-6 sm:p-8 max-screen">
      <PageHeader
        title={`Сайн байна уу, ${admin.firstName}`}
        description="carservice.mn платформын ерөнхий тойм"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <BigStat
          label="Идэвхтэй байгууллага"
          value={activeTenants.toLocaleString("mn-MN")}
          accent
        />
        <BigStat
          label="Түр зогссон"
          value={suspendedTenants.toLocaleString("mn-MN")}
          color="text-[var(--oc-warn)]"
        />
        <BigStat
          label="Нийт хэрэглэгч"
          value={userCount.toLocaleString("mn-MN")}
        />
        <BigStat
          label="Дуусгасан засварын хуудас"
          value={orderCount.toLocaleString("mn-MN")}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-semibold text-[var(--oc-ink)]">Сүүлд бүртгүүлсэн</h2>
              <p className="text-xs text-[var(--oc-muted3)] mt-0.5">
                Шинээр нэгдсэн байгууллагууд
              </p>
            </div>
            <Link
              href="/system/tenants"
              className="text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
            >
              Бүгдийг харах →
            </Link>
          </div>

          {recentTenants.length === 0 ? (
            <p className="text-sm text-[var(--oc-muted3)] py-6 text-center">
              Байгууллага бүртгүүлээгүй байна.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--oc-line2)]">
              {recentTenants.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/system/tenants/${t.id}`}
                    className="flex items-center gap-3 py-3 hover:bg-white/[0.02] -mx-2 px-2 rounded-lg transition-colors"
                  >
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--oc-accent)]/30 to-[var(--oc-accent-hi)]/20 flex items-center justify-center text-sm font-bold text-[var(--oc-accent)] shrink-0">
                      {t.name[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--oc-ink2)] truncate">
                        {t.name}
                        {t.suspended ? (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[var(--oc-warn)]/20 text-[var(--oc-warn)]">
                            ЗОГССОН
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-[var(--oc-muted3)]">
                        #{t.registerNumber} · {t._count.users} ажилтан
                      </div>
                    </div>
                    <span className="text-xs text-[var(--oc-muted3)] shrink-0">
                      {t.createdAt.toLocaleDateString("mn-MN")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6">
            <h2 className="font-semibold text-[var(--oc-ink)] mb-1">Багцаар</h2>
            <p className="text-xs text-[var(--oc-muted3)] mb-5">
              Нийт {tenantCount} байгууллага
            </p>
            <div className="space-y-3">
              {(["FREE", "BUSINESS", "ENTERPRISE"] as const).map((p) => {
                const count = planMap[p] ?? 0;
                const pct = tenantCount > 0 ? (count / tenantCount) * 100 : 0;
                return (
                  <div key={p}>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="text-[var(--oc-ink2)]">{p}</span>
                      <span className="text-[var(--oc-muted)]">{count}</span>
                    </div>
                    <div className="h-1.5 bg-[var(--oc-line)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[var(--oc-accent)] to-[var(--oc-accent-hi)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-[10px] border border-[var(--oc-ok)]/20 bg-[var(--oc-panel)] p-6">
            <div className="text-xs text-[var(--oc-muted3)] uppercase tracking-wider">
              Нийт орлого (платформ)
            </div>
            <div className="mt-2 text-2xl sm:text-3xl font-bold text-[var(--oc-ink)]">
              {formatTugrik(subscriptionRevenue)}
            </div>
            <p className="text-xs text-[var(--oc-muted3)] mt-2">
              Байгууллагуудын багцын (subscription) төлсөн төлбөрийн нийлбэр
            </p>
          </div>

          <Link
            href="/system/booking-revenue"
            className="rounded-[10px] border border-[var(--oc-accent)]/20 bg-[var(--oc-panel)] hover:border-[var(--oc-accent)]/40 transition-colors p-6"
          >
            <div className="text-xs text-[var(--oc-muted3)] uppercase tracking-wider">
              Цаг захиалгын орлого
            </div>
            <div className="mt-2 text-2xl sm:text-3xl font-bold text-[var(--oc-ink)]">
              {formatTugrik(bookingRevenue)}
            </div>
            <p className="text-xs text-[var(--oc-muted3)] mt-2">
              Онлайн цаг захиалгаас хэрэглэгчээс авсан хураамжийн нийлбэр →
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}

function BigStat({
  label,
  value,
  accent = false,
  color,
}: {
  label: string;
  value: string;
  accent?: boolean;
  color?: string;
}) {
  return (
    <div
      className={`rounded-[10px] border bg-[var(--oc-panel)] p-5 ${
        accent ? "border-[var(--oc-accent)]/30" : "border-[var(--oc-line)]"
      }`}
    >
      <div
        className={`text-2xl sm:text-3xl font-bold ${
          color ?? (accent ? "text-[var(--oc-accent)]" : "text-[var(--oc-ink)]")
        }`}
      >
        {value}
      </div>
      <div className="text-sm text-[var(--oc-muted3)] mt-1">{label}</div>
    </div>
  );
}
