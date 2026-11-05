import Link from "next/link";
import { redirect } from "next/navigation";
import { Prisma } from "@/app/generated/prisma/client";
import { Chip } from "@/app/_components/landing-ops-ui";
import {
  BackLink,
  Chevron,
  DateTile,
  FilterBar,
  PageHero,
  SectionTitle,
} from "@/app/(app)/_components/consumer-ui";
import { EmptyState } from "@/app/_components/empty-state";
import {
  APPOINTMENT_STATUS_BADGE,
  APPOINTMENT_STATUS_LABEL,
} from "@/lib/appointments";
import { requireAccount } from "@/lib/auth/account";
import { formerPlate } from "@/lib/vehicle-plate";
import { customerOwnershipFilters, normalizePlate } from "@/lib/vehicles";
import {
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  formatTugrik,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { FilterSelect, SearchBox } from "@/app/_components/list-filters";
import { Pagination } from "@/app/_components/pagination";
import { getPageInfo, buildMeta } from "@/lib/pagination";

const MONTH_OPTIONS = [
  "1-р сар", "2-р сар", "3-р сар", "4-р сар", "5-р сар", "6-р сар",
  "7-р сар", "8-р сар", "9-р сар", "10-р сар", "11-р сар", "12-р сар",
].map((label, i) => ({ value: String(i + 1), label }));

export const metadata = {
  title: "Үйлчилгээний түүх",
};

export const dynamic = "force-dynamic";

function formatDate(d: Date): string {
  return d.toLocaleDateString("mn-MN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * Тухайн оны (эсвэл он+сарын) [эхлэл, дараа мужийн эхлэл) муж (локал цагаар).
 * `month` зөвхөн `year`-тэй хамт утгатай тул үргэлж хамт дамжина.
 */
function yearRange(year: number, month: number | null): { gte: Date; lt: Date } {
  if (month == null) return { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) };
  return { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) };
}

export default async function AccountHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    plate?: string;
    q?: string;
    year?: string;
    month?: string;
    page?: string;
  }>;
}) {
  const account = await requireAccount();
  const {
    plate,
    q: rawQuery,
    year: rawYear,
    month: rawMonth,
    page: rawPage,
  } = await searchParams;
  const { page, pageSize, skip, take } = getPageInfo(rawPage, 20);
  const query = (rawQuery ?? "").trim();
  // "Бүх он" сонголт байхгүй — үргэлж тодорхой жил сонгогдсон байна, анхны
  // утга нь одоогийн жил (mobile-ийн HistoryController-той ижил зарчим).
  // URL-д жилийг ЯВЦУУЛААГҮЙ бол одоогийн жилээр redirect хийж, шүүлтийн
  // сонголт (FilterSelect, зөвхөн URL-аас уншдаг) бодит үр дүнтэй зөрөхгүй
  // байхыг баталгаажуулна.
  if (!rawYear) {
    const params = new URLSearchParams();
    if (plate) params.set("plate", plate);
    if (rawQuery) params.set("q", rawQuery);
    params.set("year", String(new Date().getFullYear()));
    if (rawMonth) params.set("month", rawMonth);
    redirect(`/account/history?${params.toString()}`);
  }
  const parsedYear = Number.parseInt(rawYear, 10);
  const year = Number.isInteger(parsedYear) ? parsedYear : new Date().getFullYear();
  const parsedMonth = Number.parseInt(rawMonth ?? "", 10);
  const month =
    Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12
      ? parsedMonth
      : null;

  // Cross-tenant түүх — гэхдээ ЗӨВХӨН энэ эзний: захиалгын Customer нь
  // account-той (accountId эсвэл утсаар) холбоотой байх ёстой. Машин-аар
  // (vehicleId) нэмж багтаахгүй — ижил машины өмнөх эзний захиалга харагдахгүй
  // (Vehicle = эзэмшигчийн бүртгэл; хуучин олон эзэнтэй мөр дээр ч хамгаална).
  // AccountVehicle нь өөрөө claim хийдэг тул эзэмшлийн нотолгоо БОЛОХГҮЙ.
  // Түүх дууссан AND цуцлагдсан ажлыг харуулна (D-085) — SCHEDULED/IN_PROGRESS
  // хараахан идэвхтэй, /account (Миний захиалгууд) дээр харагдана.
  // Дууссан ч бүрэн төлөгдөөгүй ажил энд биш — /account дээр "Төлбөр дутуу"
  // badge-тэй үлдэнэ; бүрэн төлөгдмөгц энд шилжинэ (2026-09-24 шийдвэр).
  // Эзэмшлийн нөхцөл — дор дахин ашиглагдана (боломжит онуудыг тооцоход).
  const ownershipWhere: Prisma.ServiceOrderWhereInput = {
    // Дотоод засвар үйлчлүүлэгчид харагдахгүй.
    isInternal: false,
    status: { in: ["COMPLETED", "CANCELLED"] },
    NOT: { status: "COMPLETED", paymentStatus: { not: "PAID" } },
    OR: customerOwnershipFilters(account.id, account.phone),
  };

  // Текст хайлт (mobile-ийн Түүх табтай ижил талбарууд: байгууллага, салбар,
  // улсын дугаар) + захиалгын дугаар. Он нь ЖАГСААЛТАД ХАРАГДАХ огноотой
  // (completedAt ?? scheduledAt ?? createdAt) яг ижил урьтамжаар шүүгдэнэ.
  const filters: Prisma.ServiceOrderWhereInput[] = [];
  if (plate) {
    const normalized = normalizePlate(plate);
    filters.push({
      OR: [{ plateSnapshot: normalized }, { vehicle: { plate: normalized } }],
    });
  }
  if (query) {
    filters.push({
      OR: [
        { tenant: { name: { contains: query, mode: "insensitive" } } },
        { branch: { name: { contains: query, mode: "insensitive" } } },
        { plateSnapshot: { contains: query, mode: "insensitive" } },
        { vehicle: { plate: { contains: query, mode: "insensitive" } } },
        { number: { contains: query, mode: "insensitive" } },
      ],
    });
  }
  {
    const range = yearRange(year, month);
    filters.push({
      OR: [
        { completedAt: range },
        { completedAt: null, scheduledAt: range },
        { completedAt: null, scheduledAt: null, createdAt: range },
      ],
    });
  }

  const where: Prisma.ServiceOrderWhereInput = filters.length
    ? { ...ownershipWhere, AND: filters }
    : ownershipWhere;

  const [orders, ordersTotal] = await Promise.all([
    prisma.serviceOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        number: true,
        status: true,
        paymentStatus: true,
        scheduledAt: true,
        completedAt: true,
        createdAt: true,
        totalAmount: true,
        plateSnapshot: true,
        tenant: { select: { name: true } },
        branch: { select: { name: true } },
        vehicle: { select: { plate: true, make: true, model: true } },
        review: { select: { rating: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.serviceOrder.count({ where }),
  ]);
  const ordersMeta = buildMeta(ordersTotal, page, pageSize);

  // D-085: цуцлагдсан/ирээгүй/татгалзсан цаг (ServiceOrder огт үүсээгүй тул
  // дээрх query-д тусахгүй) — эдгээр нь одоо идэвхтэй жагсаалтад (D-083/D-084)
  // байхгүй болсон тул, мөнхөд алга болохгүйн тулд энд харагдана. `plate`-ээр
  // шүүхгүй — цаг захиалахдаа машин сонгоогүй байж болно, мөн энэ бол цөөн
  // тооны бичлэг тул шүүлт хийх шаардлагагүй.
  const cancelledWhere: Prisma.AppointmentWhereInput = {
    accountId: account.id,
    status: { in: ["CANCELLED", "NO_SHOW", "REJECTED"] },
    serviceOrderId: null,
  };
  const cancelledFilters: Prisma.AppointmentWhereInput[] = [];
  if (query) {
    cancelledFilters.push({
      OR: [
        { tenant: { name: { contains: query, mode: "insensitive" } } },
        { branch: { name: { contains: query, mode: "insensitive" } } },
        { category: { name: { contains: query, mode: "insensitive" } } },
      ],
    });
  }
  cancelledFilters.push({ requestedAt: yearRange(year, month) });

  const cancelledAppointments = await prisma.appointment.findMany({
    where: cancelledFilters.length
      ? { ...cancelledWhere, AND: cancelledFilters }
      : cancelledWhere,
    orderBy: { requestedAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      requestedAt: true,
      tenant: { select: { name: true } },
      branch: { select: { name: true } },
      category: { select: { name: true } },
    },
  });

  // Боломжит онууд — ЗӨВХӨН өгөгдөлд бодитоор байгаа онууд (mobile-тай ижил
  // зарчим: хоосон он санал болгохгүй). Шүүлтээс хамаарахгүй тул шүүлт
  // хийсний дараа ч сонголт бүтнээрээ үлдэнэ.
  const [orderDates, cancelledDates] = await Promise.all([
    prisma.serviceOrder.findMany({
      where: ownershipWhere,
      select: { completedAt: true, scheduledAt: true, createdAt: true },
    }),
    prisma.appointment.findMany({
      where: cancelledWhere,
      select: { requestedAt: true },
    }),
  ]);
  const availableYears = [
    ...new Set([
      year,
      ...orderDates.map((o) =>
        (o.completedAt ?? o.scheduledAt ?? o.createdAt).getFullYear(),
      ),
      ...cancelledDates.map((a) => a.requestedAt.getFullYear()),
    ]),
  ].sort((a, b) => b - a);

  const hasFilter = Boolean(query) || month !== null;

  const spent = await prisma.serviceOrder.aggregate({
    where: { ...where, status: "COMPLETED" },
    _sum: { totalAmount: true },
  });
  const periodLabel = month ? `${year} оны ${month}-р сар` : `${year} он`;

  return (
    <div className="w-full flex flex-col gap-5">
      <BackLink href="/account">Миний захиалгууд</BackLink>

      <PageHero
        eyebrow={periodLabel}
        title="Үйлчилгээний түүх"
        description={
          plate ? `${plate} — хийгдсэн үйлчилгээнүүд` : "Таны машинд хийгдсэн, төлбөр нь төлөгдсөн бүх үйлчилгээ"
        }
        actions={
          plate ? (
            <>
              <Chip tone="accent" bordered>
                {plate}
              </Chip>
              <Link
                href="/account/history"
                className="text-xs font-medium text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
              >
                Бүх машины түүхийг харах →
              </Link>
            </>
          ) : null
        }
        stats={[
          { label: "Үйлчилгээ", value: ordersTotal },
          { label: "Нийт зарцуулсан", value: formatTugrik(spent._sum.totalAmount?.toString() ?? "0") },
          { label: "Цуцлагдсан", value: cancelledAppointments.length },
        ]}
      />

      {/* Хайлт + он — mobile-ийн Түүх табтай ижил (текст + он). */}
      <FilterBar>
        <SearchBox placeholder="Байгууллага, салбар, дугаараар хайх" paramName="q" />
        <FilterSelect
          paramName="year"
          allowClear={false}
          options={availableYears.map((y) => ({ value: String(y), label: String(y) }))}
        />
        <FilterSelect paramName="month" placeholder="Бүх сар" options={MONTH_OPTIONS} />
      </FilterBar>

      {orders.length === 0 && cancelledAppointments.length === 0 ? (
        <EmptyState>
          {hasFilter
            ? "Илэрц олдсонгүй."
            : "Одоогоор хийгдсэн үйлчилгээ алга. Цаг захиалга баталгаажиж, үйлчилгээ хийгдсэний дараа энд харагдана."}
        </EmptyState>
      ) : orders.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionTitle count={ordersTotal}>Хийгдсэн үйлчилгээ</SectionTitle>
          <div className="flex flex-col gap-2.5">
            {orders.map((o) => {
              const when = o.completedAt ?? o.scheduledAt ?? o.createdAt;
              const former = formerPlate(o.plateSnapshot, o.vehicle.plate);
              return (
                <Link
                  key={o.id}
                  href={`/account/history/${o.id}`}
                  className="group flex items-center gap-3 sm:gap-4 rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-3.5 sm:p-4 shadow-sm transition-all hover:border-[var(--oc-accent)]/50 hover:shadow-md"
                >
                  <DateTile date={when} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-[var(--oc-ink)] group-hover:text-[var(--oc-accent)] transition-colors">
                        {o.tenant.name}
                      </span>
                      <span
                        className={`font-plex-mono text-[11px] px-2 py-0.5 rounded-full ${ORDER_STATUS_BADGE[o.status as OrderStatus]}`}
                      >
                        {ORDER_STATUS_LABEL[o.status as OrderStatus]}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--oc-muted)]">
                      <span className="rounded-md border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-1.5 py-px font-plex-mono text-xs font-semibold text-[var(--oc-ink2)]">
                        {o.vehicle.plate}
                      </span>
                      <span className="truncate">
                        {o.vehicle.make} {o.vehicle.model}
                        {former ? ` (хуучин: ${former})` : ""}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-[var(--oc-muted3)] tabular-nums">
                      {o.branch.name} · №{o.number} · {o._count.items} мөр · {formatDate(when)}
                    </div>
                    {o.status === "COMPLETED" ? (
                      o.review ? (
                        <div className="mt-1.5 text-xs" aria-label={`Таны үнэлгээ: ${o.review.rating} од`}>
                          <span className="text-amber-400">{"★".repeat(o.review.rating)}</span>
                          <span className="text-[var(--oc-line)]">{"★".repeat(5 - o.review.rating)}</span>
                          <span className="ml-1.5 text-[var(--oc-muted3)]">Таны үнэлгээ</span>
                        </div>
                      ) : (
                        <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-400/10 px-2.5 py-0.5 text-xs font-semibold text-amber-500 light:text-amber-700">
                          ★ Үнэлгээ өгөх
                        </span>
                      )
                    ) : null}
                    <div className="mt-1.5 flex items-center gap-2 text-sm sm:hidden">
                      <span className="font-semibold tabular-nums text-[var(--oc-ink)]">
                        {formatTugrik(o.totalAmount?.toString() ?? null)}
                      </span>
                      <span
                        className={`text-xs ${
                          o.paymentStatus === "PAID" ? "text-emerald-400 light:text-emerald-600" : "text-[var(--oc-muted3)]"
                        }`}
                      >
                        · {PAYMENT_STATUS_LABEL[o.paymentStatus as PaymentStatus]}
                      </span>
                    </div>
                  </div>
                  <div className="hidden shrink-0 text-right sm:block">
                    <div className="font-semibold tabular-nums text-[var(--oc-ink)]">
                      {formatTugrik(o.totalAmount?.toString() ?? null)}
                    </div>
                    <div
                      className={`mt-0.5 text-xs ${
                        o.paymentStatus === "PAID" ? "text-emerald-400 light:text-emerald-600" : "text-[var(--oc-muted3)]"
                      }`}
                    >
                      {PAYMENT_STATUS_LABEL[o.paymentStatus as PaymentStatus]}
                    </div>
                  </div>
                  <Chevron />
                </Link>
              );
            })}
          </div>
          <Pagination
            page={ordersMeta.page}
            totalPages={ordersMeta.totalPages}
            total={ordersMeta.total}
            params={{ plate, q: query, year, month }}
          />
        </section>
      ) : null}

      {cancelledAppointments.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionTitle count={cancelledAppointments.length}>Цуцлагдсан / ирээгүй цагууд</SectionTitle>
          <div className="overflow-hidden rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] divide-y divide-[var(--oc-line2)]">
            {cancelledAppointments.map((a) => (
              <Link
                key={a.id}
                href={`/account/appointments/${a.id}`}
                className="group flex items-center gap-4 p-3.5 sm:px-4 transition-colors hover:bg-[var(--oc-panel2)]"
              >
                <DateTile date={a.requestedAt} muted />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-[var(--oc-ink2)]">{a.tenant.name}</span>
                    <span
                      className={`font-plex-mono text-[11px] px-2 py-0.5 rounded-full ${APPOINTMENT_STATUS_BADGE[a.status]}`}
                    >
                      {APPOINTMENT_STATUS_LABEL[a.status]}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--oc-muted3)] tabular-nums">
                    {a.category ? `${a.category.name} · ` : ""}
                    {a.branch.name} · {formatDate(a.requestedAt)}
                  </div>
                </div>
                <Chevron />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
