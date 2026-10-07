import Link from "next/link";
import { cancelAppointmentByAccount } from "@/app/_actions/appointments";
import { AddLinkButton, Btn } from "@/app/_components/landing-ops-ui";
import { ConfirmForm } from "@/app/_components/confirm-form";
import { FilterSelect, ResetFilters, SearchBox } from "@/app/_components/list-filters";
import { WebPushToggle } from "@/app/_components/web-push";
import {
  APPOINTMENT_STATUS_BADGE,
  APPOINTMENT_STATUS_LABEL,
  type AppointmentStatus,
} from "@/lib/appointments";
import { requireAccount } from "@/lib/auth/account";
import {
  formatTugrik,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  type OrderStatus,
} from "@/lib/orders";
import { prisma } from "@/lib/prisma";

// Аппойнтмент+захиалгын статусыг нэг сонголтод нэгтгэнэ (карт дээр аль нь
// харагдаж байгаатай ижил дүрмээр: `a.serviceOrder` байвал ORDER_STATUS,
// эс бөгөөс APPOINTMENT_STATUS) — "CANCELLED" хоёуланд нь байдаг тул нэг
// удаа л жагсаана.
const STATUS_OPTIONS = [
  { value: "PENDING", label: APPOINTMENT_STATUS_LABEL.PENDING },
  { value: "CONFIRMED", label: APPOINTMENT_STATUS_LABEL.CONFIRMED },
  { value: "SCHEDULED", label: ORDER_STATUS_LABEL.SCHEDULED },
  { value: "IN_PROGRESS", label: ORDER_STATUS_LABEL.IN_PROGRESS },
  { value: "COMPLETED", label: ORDER_STATUS_LABEL.COMPLETED },
  { value: "REJECTED", label: APPOINTMENT_STATUS_LABEL.REJECTED },
  { value: "CANCELLED", label: APPOINTMENT_STATUS_LABEL.CANCELLED },
  { value: "NO_SHOW", label: APPOINTMENT_STATUS_LABEL.NO_SHOW },
];

function displayStatus(a: {
  status: AppointmentStatus;
  serviceOrder: { status: OrderStatus } | null;
}): string {
  return a.serviceOrder ? a.serviceOrder.status : a.status;
}

export const metadata = {
  title: "Миний захиалгууд",
};

export const dynamic = "force-dynamic";

const WD_MN: Record<string, string> = {
  Mon: "Даваа",
  Tue: "Мягмар",
  Wed: "Лхагва",
  Thu: "Пүрэв",
  Fri: "Баасан",
  Sat: "Бямба",
  Sun: "Ням",
};

// Огноог Монголын цагаар хэсэгчлэн (огноо/цаг/гараг) буцаана.
function dateParts(d: Date): { date: string; time: string; weekday: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ulaanbaatar",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return {
    date: `${p.day}/${p.month}`,
    time: `${p.hour}:${p.minute}`,
    weekday: WD_MN[p.weekday as string] ?? "",
  };
}

/**
 * Дууссан ч бүрэн төлөгдөөгүй захиалга энэ хуудсанд үлддэг (D-083/D-084) —
 * яагаад үлдсэнийг ойлгуулахын тулд үлдэгдлийг харуулна. Үлдэгдэлгүй бол null.
 */
function outstandingLabel(o: {
  status: string;
  paymentStatus: string;
  totalAmount: { toString(): string } | null;
  paidAmount: { toString(): string } | null;
} | null): string | null {
  if (!o || o.status !== "COMPLETED" || o.paymentStatus === "PAID") return null;
  const due = Number(o.totalAmount?.toString() ?? 0) - Number(o.paidAmount?.toString() ?? 0);
  return due > 0 ? `Төлбөр дутуу · ${formatTugrik(due)}` : "Төлбөр дутуу";
}

const OUTSTANDING_BADGE =
  "font-plex-mono text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap bg-[var(--oc-warn)]/15 text-[var(--oc-warn)]";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const account = await requireAccount();
  const { q: rawQuery, status: rawStatus } = await searchParams;
  const query = (rawQuery ?? "").trim().toLowerCase();
  const status = STATUS_OPTIONS.some((o) => o.value === rawStatus)
    ? (rawStatus as string)
    : null;
  const hasFilter = Boolean(query) || status !== null;

  // Дууссан + бүрэн төлөгдсөн захиалга энд биш, Үйлчилгээний түүхэд харагдана
  // (харах: app/account/history). Дуусаад ч төлөгдөөгүй бол энд үлдэнэ, учир
  // нь хэрэглэгч төлбөрөө хараахан хийгээгүй байгааг мэдэх ёстой.
  // D-083: терминал, хэзээ ч биелэгдээгүй цаг (ServiceOrder огт үүсээгүй)
  // мөнхөд энд үлдэхгүй байх ёстой — /account/history рүү ч хэзээ ч
  // очихгүй (тэр нь зөвхөн COMPLETED-г шүүнэ).
  const appointmentsRaw = await prisma.appointment.findMany({
    where: {
      accountId: account.id,
      NOT: [
        { serviceOrder: { status: "COMPLETED", paymentStatus: "PAID" } },
        { status: { in: ["CANCELLED", "NO_SHOW", "REJECTED"] }, serviceOrderId: null },
      ],
    },
    orderBy: { requestedAt: "desc" },
    include: {
      tenant: { select: { name: true, slug: true } },
      branch: { select: { name: true } },
      category: { select: { name: true } },
      payment: { select: { id: true, amount: true } },
      serviceOrder: { select: { status: true, paymentStatus: true, totalAmount: true, paidAmount: true, isInternal: true } },
    },
  });
  // Дотоод засвар үйлчлүүлэгчид харагдахгүй (төлөв, "Төлбөр дутуу" тэмдэг ч үгүй).
  const appointments = appointmentsRaw.map((a) =>
    a.serviceOrder?.isInternal ? { ...a, serviceOrder: null } : a,
  );

  // Идэвхтэй (хүлээгдэж буй/баталгаажсан) цагуудыг түрүүлж, ойрын нь дээр.
  const ACTIVE = new Set(["PENDING", "CONFIRMED"]);
  const sortedAppts = [...appointments]
    .sort((x, y) => {
      const ax = ACTIVE.has(x.status) ? 0 : 1;
      const ay = ACTIVE.has(y.status) ? 0 : 1;
      if (ax !== ay) return ax - ay;
      const dx = x.requestedAt.getTime();
      const dy = y.requestedAt.getTime();
      return ax === 0 ? dx - dy : dy - dx; // идэвхтэй: ойрын нь; өмнөх: сүүлийн нь
    })
    // Хайлт/статус — картан дээр харагдаж буй нэр/статустай ижил талбараар
    // (мобайл апп-ийн Appointments tab-тай ижил зарчим).
    .filter((a) => {
      if (status !== null && displayStatus(a) !== status) return false;
      if (!query) return true;
      return [a.tenant.name, a.branch.name, a.category?.name ?? ""].some(
        (value) => value.toLowerCase().includes(query),
      );
    });

  // Цаг захиалгагүй (walk-in) захиалга — ажилтан утсаар/шууд ирсэн машинд
  // цаг захиалгагүйгээр шууд засварын хуудас үүсгэсэн бол Appointment мөр
  // огт үүсдэггүй тул дээрх query-д тусахгүй. Тусад нь олж, доор жагсаана
  // (харах: /api/v1/app/appointments-ийн ижил walkInOrders логик).
  const walkInOrders = (
    await prisma.serviceOrder.findMany({
      where: {
        customer: { accountId: account.id },
        isInternal: false,
        appointment: null,
        // D-083: цуцлагдсан walk-in захиалга ч мөн адил мөнхөд энд үлдэхгүй.
        NOT: [{ status: "COMPLETED", paymentStatus: "PAID" }, { status: "CANCELLED" }],
      },
      orderBy: { createdAt: "desc" },
      include: {
        tenant: { select: { name: true } },
        branch: { select: { name: true } },
        vehicle: { select: { plate: true } },
      },
    })
  ).filter((o) => {
    if (status !== null && o.status !== status) return false;
    if (!query) return true;
    return [o.tenant.name, o.branch.name, o.vehicle.plate].some((value) =>
      value.toLowerCase().includes(query),
    );
  });

  return (
    <div className="w-full flex flex-col gap-3.5">
      {/* Шинэ цаг захиалах */}
      <AddLinkButton href="/discover">Шинэ цаг захиалах</AddLinkButton>

      {/* Мэдэгдэл */}
      <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--oc-ink2)]">Мэдэгдэл</div>
          <div className="text-xs text-[var(--oc-muted3)]">
            Цаг баталгаажих, сануулгыг энэ төхөөрөмж дээр авах.
          </div>
        </div>
        <WebPushToggle target="account" />
      </section>

      {/* Хайлт + статус — History/Diagnostics хуудсуудтай ижил, mobile
          апп-ийн Appointments tab-ийн шүүлтүүртэй ижил зарчим. */}
      <div className="flex items-center gap-2 flex-wrap">
        <SearchBox placeholder="Байгууллага, салбар, дугаараар хайх" paramName="q" />
        <FilterSelect paramName="status" placeholder="Бүх төлөв" options={STATUS_OPTIONS} />
        <ResetFilters paramNames={["q", "status"]} />
      </div>

      {/* Цагууд */}
      <div>
        <h1 className="font-semibold text-[var(--oc-ink2)] text-sm mb-2">
          Цагийн захиалгууд
          {sortedAppts.length > 0 ? (
            <span className="text-[var(--oc-muted3)] font-normal"> · {sortedAppts.length}</span>
          ) : null}
        </h1>

        {sortedAppts.length === 0 ? (
          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-8 text-center">
            <p className="text-sm text-[var(--oc-muted3)]">
              {hasFilter
                ? "Илэрц олдсонгүй."
                : "Та одоогоор цаг захиалаагүй байна."}
            </p>
            {hasFilter ? null : (
              <Link
                href="/discover"
                className="inline-block mt-2 text-sm text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
              >
                Автосервис сонгож цаг захиалах →
              </Link>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sortedAppts.map((a) => {
              const isActive = a.status === "PENDING" || a.status === "CONFIRMED";
              // Засварын хуудас холбогдсон бол цуцлахгүй (апп-тай ижил).
              const canCancel = isActive && !a.serviceOrder;
              const dt = dateParts(a.requestedAt);

              // Хураамжийн badge: Invoice (payment) төлөгдсөн, эсвэл fee*
              // талбар (checkout явцад буй/амжилтгүй) байвал л харагдана.
              const feeAmount = a.payment?.amount ?? a.feeAmount;
              const feeLabel = a.payment
                ? "Хураамж төлөгдсөн ✓"
                : a.feeQpayInvoiceId
                  ? `Хураамж төлөх · ${formatTugrik(feeAmount!.toString())}`
                  : "Хураамж — дахин оролдох";

              return (
                <div
                  key={a.id}
                  id={`appt-${a.id}`}
                  className={`scroll-mt-4 rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-3 flex items-stretch gap-3 target:border-[var(--oc-accent)] target:ring-2 target:ring-[var(--oc-accent)]/40 ${isActive ? "" : "opacity-70"
                    }`}
                >
                  {/* Огнооны chip + мэдээлэл — дэлгэрэнгүй хуудас руу линк.
                      Цуцлах/төлбөрийн товч тусдаа, линк доторх линк үүсгэхгүй. */}
                  <Link
                    href={`/account/appointments/${a.id}`}
                    className="shrink-0 w-14 rounded-lg bg-[var(--oc-panel2)] border border-[var(--oc-line2)] flex flex-col items-center justify-center py-1.5 hover:border-[var(--oc-accent)] transition-colors"
                  >
                    <div className="text-sm font-bold tabular-nums leading-tight">
                      {dt.time}
                    </div>
                    <div className="text-[11px] text-[var(--oc-muted3)] tabular-nums">
                      {dt.date}
                    </div>
                  </Link>

                  <Link
                    href={`/account/appointments/${a.id}`}
                    className="min-w-0 flex-1 flex flex-col justify-center"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[var(--oc-ink)] truncate">
                        {a.tenant.name}
                      </span>
                      <span
                        className={`font-plex-mono text-[11px] px-2.5 py-1 rounded-full ${
                          a.serviceOrder
                            ? ORDER_STATUS_BADGE[a.serviceOrder.status as OrderStatus]
                            : APPOINTMENT_STATUS_BADGE[a.status]
                        }`}
                      >
                        {a.serviceOrder
                          ? ORDER_STATUS_LABEL[a.serviceOrder.status as OrderStatus]
                          : APPOINTMENT_STATUS_LABEL[a.status]}
                      </span>
                      {outstandingLabel(a.serviceOrder) ? (
                        <span className={OUTSTANDING_BADGE}>{outstandingLabel(a.serviceOrder)}</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-[var(--oc-muted)] mt-0.5">
                      {dt.weekday} · {a.branch.name}
                      {a.category ? ` · ${a.category.name}` : ""}
                    </div>
                    {a.note ? (
                      <div className="text-xs text-[var(--oc-muted3)] mt-0.5 truncate">
                        {a.note}
                      </div>
                    ) : null}
                  </Link>

                  <div className="shrink-0 flex flex-col items-end justify-center gap-1.5">
                    {a.payment || a.feeAmount ? (
                      <Link
                        href={`/account/appointments/${a.id}/pay`}
                        className={`font-plex-mono text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${
                          a.payment
                            ? "bg-emerald-500/15 text-emerald-400 light:bg-emerald-100 light:text-emerald-700"
                            : "bg-[var(--oc-warn)]/15 text-[var(--oc-warn)] hover:bg-[var(--oc-warn)]/25"
                        }`}
                      >
                        {feeLabel}
                      </Link>
                    ) : null}
                    {canCancel ? (
                      <ConfirmForm
                        action={cancelAppointmentByAccount}
                        message={`\"${a.tenant.name}\" — ${a.branch.name} дахь ${dt.date} ${dt.time} цагийг цуцлах уу?`}
                        title="Захиалга цуцлах"
                        confirmLabel="Тийм, цуцлах"
                      >
                        <input type="hidden" name="id" value={a.id} />
                        <Btn variant="danger" size="sm" type="submit">
                          Цуцлах
                        </Btn>
                      </ConfirmForm>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Цаг захиалгагүй (walk-in) захиалга — ажилтан шууд ирсэн машинд
          үүсгэсэн, доороос тусад нь харагдана (эдгээрт цаг/цуцлах/хураамж
          гэсэн ойлголт байхгүй). */}
      {walkInOrders.length > 0 ? (
        <div>
          <h1 className="font-semibold text-[var(--oc-ink2)] text-sm mb-2">
            Засварын захиалгууд
            <span className="text-[var(--oc-muted3)] font-normal"> · {walkInOrders.length}</span>
          </h1>
          <div className="flex flex-col gap-2">
            {walkInOrders.map((o) => (
              <Link
                key={o.id}
                href={`/account/orders/${o.id}`}
                className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-3 flex flex-col gap-0.5 hover:border-[var(--oc-accent)] transition-colors"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[var(--oc-ink)] truncate">
                    {o.tenant.name}
                  </span>
                  <span
                    className={`font-plex-mono text-[11px] px-2.5 py-1 rounded-full ${ORDER_STATUS_BADGE[o.status as OrderStatus]}`}
                  >
                    {ORDER_STATUS_LABEL[o.status as OrderStatus]}
                  </span>
                  {outstandingLabel(o) ? (
                    <span className={OUTSTANDING_BADGE}>{outstandingLabel(o)}</span>
                  ) : null}
                </div>
                <div className="text-xs text-[var(--oc-muted)] mt-0.5">
                  {o.branch.name} · {o.vehicle.plate} · №{o.number}
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
