import Link from "next/link";
import { redirect } from "next/navigation";
import { Prisma } from "@/app/generated/prisma/client";
import { BtnLink, Chip } from "@/app/_components/landing-ops-ui";
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

  return (
    <div className="w-full flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Үйлчилгээний түүх</h1>
          <p className="text-[var(--oc-muted3)] text-sm mt-0.5">
            {plate
              ? `${plate} — хийгдсэн үйлчилгээнүүд`
              : "Таны машинд хийгдсэн бүх үйлчилгээ"}
          </p>
        </div>
        <BtnLink href="/account" variant="ghost">
          ← Буцах
        </BtnLink>
      </div>

      {plate ? (
        <div className="flex items-center gap-2">
          <Chip tone="accent" bordered>
            {plate}
          </Chip>
          <Link
            href="/account/history"
            className="text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
          >
            Бүх машины түүхийг харах
          </Link>
        </div>
      ) : null}

      {/* Хайлт + он — mobile-ийн Түүх табтай ижил (текст + он). */}
      <div className="flex items-center gap-2 flex-wrap">
        <SearchBox
          placeholder="Байгууллага, салбар, дугаараар хайх"
          paramName="q"
        />
        <FilterSelect
          paramName="year"
          allowClear={false}
          options={availableYears.map((y) => ({ value: String(y), label: String(y) }))}
        />
        <FilterSelect paramName="month" placeholder="Бүх сар" options={MONTH_OPTIONS} />
      </div>

      {orders.length === 0 && cancelledAppointments.length === 0 ? (
        <EmptyState>
          {hasFilter
            ? "Илэрц олдсонгүй."
            : "Одоогоор хийгдсэн үйлчилгээ алга. Цаг захиалга баталгаажиж, үйлчилгээ хийгдсэний дараа энд харагдана."}
        </EmptyState>
      ) : orders.length > 0 ? (
        <div className="flex flex-col gap-3">
          {orders.map((o) => {
            const when = o.completedAt ?? o.scheduledAt ?? o.createdAt;
            return (
              <Link
                key={o.id}
                href={`/account/history/${o.id}`}
                className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 block hover:bg-[var(--oc-panel2)] transition-colors"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[var(--oc-ink)]">
                        {o.tenant.name}
                      </span>
                      <span className="text-xs text-[var(--oc-muted3)] font-plex-mono">
                        №{o.number}
                      </span>
                      <span
                        className={`font-plex-mono text-[11px] px-2.5 py-1 rounded-full ${ORDER_STATUS_BADGE[o.status as OrderStatus]}`}
                      >
                        {ORDER_STATUS_LABEL[o.status as OrderStatus]}
                      </span>
                    </div>
                    <div className="text-sm text-[var(--oc-muted)] mt-1">
                      {o.vehicle.plate} · {o.vehicle.make} {o.vehicle.model}
                      {formerPlate(o.plateSnapshot, o.vehicle.plate) ? ` (хуучин: ${formerPlate(o.plateSnapshot, o.vehicle.plate)})` : ""}
                    </div>
                    <div className="text-xs text-[var(--oc-muted3)] mt-0.5 tabular-nums">
                      {formatDate(when)} · {o.branch.name} · {o._count.items} мөр
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-[var(--oc-ink)] tabular-nums">
                      {formatTugrik(o.totalAmount?.toString() ?? null)}
                    </div>
                    <div className="text-xs text-[var(--oc-muted3)] mt-0.5">
                      {PAYMENT_STATUS_LABEL[o.paymentStatus as PaymentStatus]}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
          <Pagination
            page={ordersMeta.page}
            totalPages={ordersMeta.totalPages}
            total={ordersMeta.total}
            params={{ plate, q: query, year, month }}
          />
        </div>
      ) : null}

      {cancelledAppointments.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold text-[var(--oc-ink2)] text-sm">
            Цуцлагдсан / ирээгүй цагууд
            <span className="text-[var(--oc-muted3)] font-normal">
              {" "}
              · {cancelledAppointments.length}
            </span>
          </h2>
          {cancelledAppointments.map((a) => (
            <Link
              key={a.id}
              href={`/account/appointments/${a.id}`}
              className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 block hover:bg-[var(--oc-panel2)] transition-colors"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[var(--oc-ink)]">
                      {a.tenant.name}
                    </span>
                    <span
                      className={`font-plex-mono text-[11px] px-2.5 py-1 rounded-full ${APPOINTMENT_STATUS_BADGE[a.status]}`}
                    >
                      {APPOINTMENT_STATUS_LABEL[a.status]}
                    </span>
                  </div>
                  {a.category ? (
                    <div className="text-sm text-[var(--oc-muted)] mt-1">
                      {a.category.name}
                    </div>
                  ) : null}
                  <div className="text-xs text-[var(--oc-muted3)] mt-0.5 tabular-nums">
                    {formatDate(a.requestedAt)} · {a.branch.name}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
