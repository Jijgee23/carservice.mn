import Link from "next/link";
import { appointmentAssigneeLabel, type AssigneeCandidate } from "@/lib/appointments/appointment-assignee-label";
import { canAssignOrders } from "@/lib/auth/order-access";
import { buildAssignableUserWhere } from "@/lib/orders/order-assignable-users";
import { redirect } from "next/navigation";
import { BtnLink } from "@/app/_components/landing-ops-ui";
import { FilterSelect } from "@/app/_components/list-filters";
import {
  APPOINTMENT_STATUS_BADGE,
  APPOINTMENT_STATUS_LABEL,
} from "@/lib/appointments";
import {
  WEEKDAY_LABELS,
  dateKey,
  resolveCalendar,
} from "@/lib/appointments-calendar";
import { requireUser } from "@/lib/auth";
import { canEdit, canView, workingBranchScopeId } from "@/lib/auth/roles";
import { customerLabel } from "@/lib/customers";
import { prisma } from "@/lib/prisma";
import {
  loadBranchSchedule,
  loadBranchScheduleHistory,
} from "@/lib/branch-schedule-loader";
import { branchHoursForDate } from "@/lib/branches";
import { branchScheduleDisplaySelect } from "@/lib/branch-effective-schedule-server";
import { bookingSlotTime } from "@/lib/booking-time";
import { ORDER_STATUS_BADGE, ORDER_STATUS_LABEL } from "@/lib/orders";
import { RowExpand } from "./row-expand";
import { buildDayRows, SCHEDULE_ISSUE_LABEL } from "./day-rows";
import { GridSchedule } from "./grid-schedule";
import { CalendarDateJump } from "./calendar-date-jump";

// Салбарын ажиллах цаг тодорхойгүй (branch.openTime/closeTime хоосон, эсвэл
// тухайн гараг хаалттай) үед grid-ийн цагийн тэнхлэгийг ямар ч утгагүй
// орхихгүйн тулд ажил хэргийн ердийн цонх (08:00–20:00) руу буцна.
const DEFAULT_GRID_OPEN_MINUTES = 8 * 60;
const DEFAULT_GRID_CLOSE_MINUTES = 20 * 60;

// Асиа/Улаанбаатар цагийн бүсээр — сервер өөр бүсэд байршиж болзошгүй тул.
function fmtUbTime(d: Date): string {
  return new Intl.DateTimeFormat("mn-MN", {
    timeZone: "Asia/Ulaanbaatar",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export const metadata = {
  title: "Цаг захиалгын календарь",
};

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("mn-MN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default async function AppointmentsCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    interval?: string;
    anchor?: string;
    branchId?: string;
    view?: string;
    layout?: string;
  }>;
}) {
  const user = await requireUser();
  if (!canView(user, "appointments")) redirect("/dashboard");
  const canRespondAppointments = canEdit(user, "appointments");
  const canEditOrders = canEdit(user, "orders");

  const sp = await searchParams;
  const cal = resolveCalendar(sp);
  const scopeBranchId = workingBranchScopeId(user);
  // QA #28: candidates for the master picker shown when confirming a
  // master-less appointment (same eligibility filter as the list page).
  const branchId = scopeBranchId ?? (sp.branchId || "");

  const [branches, dayAssigneeCandidates] = await Promise.all([
    prisma.branch.findMany({
      where: {
        tenantId: user.tenantId,
        isActive: true,
        ...(scopeBranchId ? { id: scopeBranchId } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    canRespondAppointments && cal.interval === "day"
      ? (prisma.user.findMany({
          where: buildAssignableUserWhere({ tenantId: user.tenantId, branchId: scopeBranchId }),
          orderBy: { firstName: "asc" },
          select: { id: true, firstName: true, lastName: true, branchId: true, assignableBranchIds: true },
        }) as Promise<AssigneeCandidate[]>)
      : Promise.resolve(null),
  ]);
  const dayAssignees = dayAssigneeCandidates
    ? { candidates: dayAssigneeCandidates, onlyUserId: canAssignOrders(user) ? null : user.id }
    : undefined;

  // Хоцорсон ажлууд/Тэр өдрийн түүх зэрэг нэг салбарын хуваарь шаарддаг
  // харагдацуудад ашиглах "нэг сонгогдсон салбар" — тодорхой сонгосон бол тэр,
  // эсвэл идэвхтэй салбар яг ганц бол тэрийг л ашиглана. Хэд хэдэн салбартай
  // тохиолдолд ямар нэг салбарыг санаачлагагүйгээр сонгож (жишээ нь эхнийх)
  // "Бүх салбар" мэт харагдуулж байгаад цөөрүүлж харуулах эрсдэлтэй тул энд
  // санаатайгаар хоосон үлдээнэ — Өдрийн үндсэн хуваарь доор (isMultiBranchDay)
  // үүнээс үл хамааран бүх салбараар тусад нь ачаалдаг.
  const dayBranchId = branchId || (branches.length === 1 ? branches[0].id : "");

  const appointments =
    cal.interval === "day"
      ? []
      : await prisma.appointment.findMany({
          where: {
            tenantId: user.tenantId,
            status: { notIn: ["CANCELLED", "REJECTED"] },
            requestedAt: { gte: cal.rangeStart, lt: cal.rangeEnd },
            ...(branchId ? { branchId } : {}),
          },
          orderBy: { requestedAt: "asc" },
          include: {
            account: { select: { name: true, phone: true } },
            customer: { select: { fullName: true, phone: true } },
            branch: { select: { name: true } },
            // QA #28: хариуцах мастер (хуучин оноолтыг ч харуулна).
            assignedTo: { select: { firstName: true, lastName: true } },
            // S14: this week/month view lists appointments directly (not the
            // interval-projected day schedule, which already reads the
            // order-derived time once linked) — without this it kept showing
            // only requestedAt even after the linked order progressed past
            // SCHEDULED, diverging from the day view. Mirrors the dashboard
            // list page's same fix.
            serviceOrder: {
              select: {
                status: true,
                scheduledAt: true,
              },
            },
          },
        });

  // History mode only makes sense for a single past day — a future/today day
  // has no "what actually happened" to show yet, so requesting it on such a
  // day is a no-op that falls back to the normal live day view.
  const isPastDay = cal.interval === "day" && cal.days[0].key < cal.todayKey;
  const isHistory = sp.view === "history" && cal.interval === "day" && isPastDay;
  const isDay = cal.interval === "day" && !isHistory;
  const isGrid = isDay && sp.layout !== "list";

  // Өдөр харагдацад тодорхой салбар сонгоогүй, харин идэвхтэй хэд хэдэн салбар
  // байгаа тохиолдолд — өмнө нь дур мэдэн эхний салбарыг сонгоод "Бүх салбар"
  // гэж харуулсан хэвээрээ үлдэж, бусад салбарын ажлыг нуудаг байсан алдааг
  // засаж, салбар тус бүрийг тусад нь (Promise.all-аар зэрэг) ачаалж харуулна.
  const isMultiBranchDay = isDay && !branchId && branches.length > 1;

  const daySchedule =
    isDay && !isMultiBranchDay && dayBranchId
      ? await loadBranchSchedule({
          tenantId: user.tenantId,
          branchId: dayBranchId,
          dateStr: cal.days[0].key,
        })
      : null;

  const multiDaySchedules = isMultiBranchDay
    ? await Promise.all(
        branches.map((b) =>
          loadBranchSchedule({
            tenantId: user.tenantId,
            branchId: b.id,
            dateStr: cal.days[0].key,
          }),
        ),
      )
    : null;

  const dayHistory =
    isHistory && dayBranchId
      ? await loadBranchScheduleHistory({
          tenantId: user.tenantId,
          branchId: dayBranchId,
          rangeStart: cal.rangeStart,
          rangeEnd: cal.rangeEnd,
        })
      : null;


  // Grid харагдацын цагийн тэнхлэгийг салбарын тухайн өдрийн ажиллах цагаар
  // хязгаарлана — тодорхойгүй бол ердийн ажлын цонх руу буцна (доор).
  const dayBranchHours =
    isGrid && !isMultiBranchDay && dayBranchId
      ? await prisma.branch.findFirst({
          where: { id: dayBranchId, tenantId: user.tenantId },
          select: {
            ...branchScheduleDisplaySelect(),
            slotCapacity: true,
          },
        })
      : null;

  const multiDayBranchHours = isGrid && isMultiBranchDay
    ? await Promise.all(
        branches.map((b) =>
          prisma.branch.findFirst({
            where: { id: b.id, tenantId: user.tenantId },
            select: {
              ...branchScheduleDisplaySelect(),
              slotCapacity: true,
            },
          }),
        ),
      )
    : null;

  type Appt = (typeof appointments)[number];
  const byDay = new Map<string, Appt[]>();
  for (const a of appointments) {
    const k = dateKey(a.requestedAt);
    const arr = byDay.get(k);
    if (arr) arr.push(a);
    else byDay.set(k, [a]);
  }

  // Нэргүй бол placeholder биш — утсаар нь харуулна (customerLabel).
  const apptName = (a: Appt) =>
    customerLabel({
      fullName: a.account?.name ?? a.customer?.fullName,
      phone: a.account?.phone ?? a.customer?.phone,
    });

  // Навигаци / toggle линкийн query-г бүрдүүлэгч. `view` (Хоцорсон ажлууд) болон
  // `interval` (Өдөр/7 хоног/Сар) харилцан адилгүй — аль нэгийг сонговол
  // нөгөөг цэвэрлэнэ. `layout` (Жагсаалт/Grid) зөвхөн Өдөр харагдацад хамаатай
  // тул interval/view солиход автоматаар хасагдана — доор тусад нь удирдана.
  const hrefWith = (over: {
    interval?: string;
    anchor?: string;
    view?: string;
    layout?: string;
  }) => {
    const p = new URLSearchParams();
    if (sp.branchId) p.set("branchId", sp.branchId);
    if (over.view) {
      p.set("view", over.view);
    } else {
      p.set("interval", over.interval ?? cal.interval);
      const layout = over.layout ?? (over.anchor !== undefined ? sp.layout : undefined);
      if (layout) p.set("layout", layout);
    }
    const anchor = over.anchor ?? sp.anchor;
    if (anchor) p.set("anchor", anchor);
    return `/dashboard/appointments/calendar?${p.toString()}`;
  };

  const navBtn =
    "px-3 py-1.5 rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] hover:border-[var(--oc-line2)] hover:bg-white/[0.05] text-sm text-[var(--oc-ink2)] transition-colors";

  // Энэ хуудасны яг одоогийн URL (interval/anchor/branchId/layout хэвээр) —
  // энэ хуудаснаас захиалга/цаг захиалга үүсгэхэд `next`-ээр дамжуулж, ажил
  // дуусаад яг энэ хуудас руу (жагсаж байсан өдөр/харагдацаараа) буцаана.
  const returnTo = hrefWith({});

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/appointments" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Цаг захиалга
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">Календарь</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Цаг захиалгын календарь</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            {cal.interval === "day"
              ? "Аль салбарт, хэзээ цаг захиалагдсан, аль нь сул болохыг харна."
              : "Энэ хугацаанд ирсэн цаг захиалгуудыг харна — захиалгагүй (walk-in) ажил болон хойшлуулсан ажлын буцах цаг эндэхгүй тул сул мэт харагдах өдөр бодит дээрээ завгүй байж болно. Бодит сул/завгүй байдлыг өдрийн харагдацаас шалгана уу."}
          </p>
        </div>
        <BtnLink href="/dashboard/appointments" variant="ghost">
          Жагсаалт
        </BtnLink>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Өдөр / 7 хоног / Сар toggle */}
        <div className="flex rounded-lg border border-[var(--oc-line)] overflow-hidden">
          <Link
            href={hrefWith({ interval: "day" })}
            className={`px-3 py-1.5 text-sm transition-colors ${
              cal.interval === "day"
                ? "bg-[var(--oc-accent)] text-[var(--oc-on-accent)] font-medium"
                : "text-[var(--oc-muted2)] hover:bg-white/[0.05]"
            }`}
          >
            Өдөр
          </Link>
          <Link
            href={hrefWith({ interval: "week" })}
            className={`px-3 py-1.5 text-sm transition-colors border-l border-[var(--oc-line)] ${
              cal.interval === "week"
                ? "bg-[var(--oc-accent)] text-[var(--oc-on-accent)] font-medium"
                : "text-[var(--oc-muted2)] hover:bg-white/[0.05]"
            }`}
          >
            7 хоног
          </Link>
          <Link
            href={hrefWith({ interval: "month" })}
            className={`px-3 py-1.5 text-sm transition-colors border-l border-[var(--oc-line)] ${
              cal.interval === "month"
                ? "bg-[var(--oc-accent)] text-[var(--oc-on-accent)] font-medium"
                : "text-[var(--oc-muted2)] hover:bg-white/[0.05]"
            }`}
          >
            Сар
          </Link>
        </div>

        {/* Prev / Өнөөдөр / Next */}
        <div className="flex items-center gap-1.5">
          <Link href={hrefWith({ anchor: cal.prevAnchorKey })} className={navBtn}>
            ‹
          </Link>
          <Link href={hrefWith({ anchor: cal.todayKey })} className={navBtn}>
            Өнөөдөр рүү буцах
          </Link>
          <Link href={hrefWith({ anchor: cal.nextAnchorKey })} className={navBtn}>
            ›
          </Link>
        </div>

        <CalendarDateJump
          anchorKey={sp.anchor ?? cal.todayKey}
          interval={cal.interval}
          branchId={sp.branchId}
          layout={sp.layout}
        />

        {isPastDay ? (
          <Link
            href={hrefWith({ view: "history" })}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
              isHistory
                ? "border-sky-500/50 bg-sky-500/20 text-sky-300 font-medium"
                : "border-sky-500/25 bg-sky-500/10 text-sky-300 hover:border-sky-500/40 hover:bg-sky-500/15"
            }`}
          >
            Тэр өдрийн түүх
          </Link>
        ) : null}

        {isDay ? (
          <div className="flex rounded-lg border border-[var(--oc-line)] overflow-hidden">
            <Link
              href={hrefWith({ layout: "list" })}
              className={`px-3 py-1.5 text-sm transition-colors ${
                !isGrid
                  ? "bg-[var(--oc-accent)] text-[var(--oc-on-accent)] font-medium"
                  : "text-[var(--oc-muted2)] hover:bg-white/[0.05]"
              }`}
            >
              Жагсаалт
            </Link>
            <Link
              href={hrefWith({ layout: "grid" })}
              className={`px-3 py-1.5 text-sm transition-colors border-l border-[var(--oc-line)] ${
                isGrid
                  ? "bg-[var(--oc-accent)] text-[var(--oc-on-accent)] font-medium"
                  : "text-[var(--oc-muted2)] hover:bg-white/[0.05]"
              }`}
            >
              Хүснэгт
            </Link>
          </div>
        ) : null}

        <div className="ml-auto">
          {!scopeBranchId && branches.length > 1 ? (
            <FilterSelect
              paramName="branchId"
              placeholder="Бүх салбар"
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
            />
          ) : null}
        </div>
      </div>

      {isHistory ? (
        <HistoryView
          data={dayHistory}
          branchName={branches.find((b) => b.id === dayBranchId)?.name ?? null}
        />
      ) : cal.interval === "day" && isGrid && isMultiBranchDay ? (
        <div className="flex flex-col gap-6">
          {branches.map((b, i) => (
            <DayScheduleGrid
              key={b.id}
              schedule={multiDaySchedules?.[i] ?? null}
              branchHours={multiDayBranchHours?.[i] ?? null}
              dateKey={cal.days[0].key}
              branchId={b.id}
              branchName={b.name}
              canRespondAppointments={canRespondAppointments}
              canEditOrders={canEditOrders}
              returnTo={returnTo}
              assignees={dayAssignees}
            />
          ))}
        </div>
      ) : cal.interval === "day" && isGrid ? (
        <DayScheduleGrid
          schedule={daySchedule}
          branchHours={dayBranchHours}
          dateKey={cal.days[0].key}
          branchId={dayBranchId}
          branchName={branches.find((b) => b.id === dayBranchId)?.name ?? null}
          canRespondAppointments={canRespondAppointments}
          canEditOrders={canEditOrders}
          returnTo={returnTo}
          assignees={dayAssignees}
        />
      ) : cal.interval === "day" && isMultiBranchDay ? (
        <div className="flex flex-col gap-6">
          {branches.map((b, i) => (
            <DaySchedule
              key={b.id}
              schedule={multiDaySchedules?.[i] ?? null}
              branchName={b.name}
              canRespondAppointments={canRespondAppointments}
              canEditOrders={canEditOrders}
              returnTo={returnTo}
              assignees={dayAssignees}
            />
          ))}
        </div>
      ) : cal.interval === "day" ? (
        <DaySchedule
          schedule={daySchedule}
          branchName={branches.find((b) => b.id === dayBranchId)?.name ?? null}
          canRespondAppointments={canRespondAppointments}
          canEditOrders={canEditOrders}
          returnTo={returnTo}
          assignees={dayAssignees}
        />
      ) : cal.interval === "week" ? (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
          {cal.days.map((d) => {
            const items = byDay.get(d.key) ?? [];
            const booked = items.length > 0;
            return (
              <Link
                key={d.key}
                href={hrefWith({ interval: "day", anchor: d.key })}
                className={`rounded-[10px] bg-[var(--oc-panel)] border min-h-[8rem] p-2.5 flex flex-col gap-1.5 transition-colors hover:border-[var(--oc-line2)] hover:bg-white/[0.02] ${
                  d.isToday
                    ? "border-[var(--oc-accent)]/50"
                    : booked
                      ? "border-[var(--oc-line2)]"
                      : "border-[var(--oc-line)]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-plex-mono text-xs text-[var(--oc-muted3)]">
                    {WEEKDAY_LABELS[(d.date.getDay() + 6) % 7]}
                  </span>
                  <span
                    className={`font-plex-mono text-sm font-semibold tabular-nums ${
                      d.isToday ? "text-[var(--oc-accent)]" : "text-[var(--oc-ink2)]"
                    }`}
                  >
                    {d.date.getDate()}
                  </span>
                </div>

                {booked ? (
                  items.map((a) => (
                    <div
                      key={a.id}
                      className="rounded-lg bg-[var(--oc-panel2)] border border-[var(--oc-line)] px-2 py-1.5"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-plex-mono text-xs font-semibold text-[var(--oc-ink2)] tabular-nums">
                          {fmtTime(a.requestedAt)}
                        </span>
                        <span
                          className={`ml-auto font-plex-mono text-[10px] px-1.5 py-0.5 rounded-full ${APPOINTMENT_STATUS_BADGE[a.status]}`}
                        >
                          {APPOINTMENT_STATUS_LABEL[a.status]}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--oc-muted2)] truncate mt-0.5">
                        {apptName(a)}
                      </div>
                      {a.assignedTo ? (
                        <div className="text-[10px] text-[var(--oc-muted3)] truncate">
                          Мастер: {appointmentAssigneeLabel(a.assignedTo)}
                        </div>
                      ) : null}
                      {a.serviceOrder && a.serviceOrder.status !== "SCHEDULED" ? (
                        <div className="text-[10px] text-[var(--oc-muted4)] truncate">
                          {a.serviceOrder.scheduledAt
                            ? `Товлосон: ${fmtTime(a.serviceOrder.scheduledAt)}`
                            : null}
                        </div>
                      ) : null}
                      {!branchId ? (
                        <div className="text-[10px] text-[var(--oc-muted4)] truncate">
                          {a.branch.name}
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="flex-1 flex items-center justify-center text-xs text-[var(--oc-muted4)]">
                    Захиалга алга
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
          <div className="grid grid-cols-7 border-b border-[var(--oc-line)]">
            {WEEKDAY_LABELS.map((w) => (
              <div
                key={w}
                className="text-center font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium py-2"
              >
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cal.days.map((d) => {
              const items = byDay.get(d.key) ?? [];
              const booked = items.length > 0;
              return (
                <Link
                  key={d.key}
                  href={hrefWith({ interval: "day", anchor: d.key })}
                  className={`min-h-[5.5rem] p-2 border-b border-r border-[var(--oc-line)] flex flex-col gap-1 transition-colors hover:bg-white/[0.04] ${
                    d.inMonth ? "" : "opacity-40"
                  } ${booked ? "bg-[var(--oc-accent)]/[0.07]" : ""}`}
                >
                  <span
                    className={`font-plex-mono text-sm tabular-nums ${
                      d.isToday
                        ? "text-[var(--oc-accent)] font-bold"
                        : "text-[var(--oc-muted2)]"
                    }`}
                  >
                    {d.date.getDate()}
                  </span>
                  {booked ? (
                    <span className="mt-auto font-plex-mono text-[11px] text-[var(--oc-accent)] font-medium">
                      {items.length} захиалга
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

type DayScheduleData = Awaited<ReturnType<typeof loadBranchSchedule>>;

// Цаг захиалгын хуваарийг цагийн дараалалд харуулна — зөвхөн цаг захиалга
// (bookings), захиалга/walk-in энэ харагдацад байхгүй. buildDayRows-тэй ижил
// өгөгдлийг GridSchedule-тэй хуваалцана (харах: day-rows.tsx).
function DaySchedule({
  schedule,
  branchName,
  canRespondAppointments,
  canEditOrders,
  returnTo,
  assignees,
}: {
  schedule: DayScheduleData | null;
  branchName: string | null;
  canRespondAppointments: boolean;
  canEditOrders: boolean;
  returnTo: string;
  assignees?: { candidates: AssigneeCandidate[]; onlyUserId: string | null };
}) {
  if (!schedule) {
    return (
      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6 text-sm text-[var(--oc-muted3)]">
        Өдрийн хуваарийг харахын тулд эхлээд салбар сонгоно уу.
      </div>
    );
  }

  const { rows, issues } = buildDayRows(schedule, canRespondAppointments, canEditOrders, returnTo, assignees);

  return (
    <div className="flex flex-col gap-3">
      {branchName ? (
        <div className="text-sm text-[var(--oc-muted3)]">
          Салбар: <span className="text-[var(--oc-ink2)] font-medium">{branchName}</span>
        </div>
      ) : null}

      {issues.length > 0 ? (
        <div className="rounded-[10px] border border-[var(--oc-warn)]/25 bg-[var(--oc-warn)]/[0.06] p-3 flex flex-wrap gap-1.5">
          {issues.map((issue, i) => (
            <span
              key={`${issue.source}-${issue.id}-${i}`}
              className="font-plex-mono text-[10.5px] px-2 py-1 rounded-full bg-[var(--oc-warn)]/15 text-[var(--oc-warn)] border border-[var(--oc-warn)]/25"
            >
              {SCHEDULE_ISSUE_LABEL[issue.reason]}
            </span>
          ))}
        </div>
      ) : null}

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-[var(--oc-muted4)]">
            Энэ өдөр хуваарь хоосон байна.
          </div>
        ) : (
          <div className="divide-y divide-[var(--oc-line)]">
            {rows.map((row) => (
              <div
                key={row.key}
                className="relative px-3 py-2.5 flex flex-wrap items-center gap-3"
              >
                <span className="font-plex-mono text-xs font-semibold text-[var(--oc-ink2)] tabular-nums w-32 shrink-0">
                  {row.uncertain
                    ? `${fmtUbTime(new Date(row.startMs))} → тодорхойгүй`
                    : `${fmtUbTime(new Date(row.startMs))}–${row.endsAtDayBoundary ? "24:00" : fmtUbTime(new Date(row.endMs))}`}
                </span>
                <span className="font-plex-mono text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--oc-panel2)] border border-[var(--oc-line)] text-[var(--oc-muted3)] shrink-0">
                  Цаг захиалга
                </span>
                {row.statusLabel ? (
                  <span
                    className={`font-plex-mono text-[10px] px-1.5 py-0.5 rounded-full ${row.statusClass}`}
                  >
                    {row.statusLabel}
                  </span>
                ) : null}
                {row.paymentStatusLabel ? (
                  <span
                    className={`font-plex-mono text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${row.paymentStatusClass}`}
                  >
                    {row.paymentStatusLabel}
                  </span>
                ) : null}
                <span className="text-sm text-[var(--oc-ink2)] truncate flex-1">
                  {row.name}
                </span>
                {row.assigneeName ? (
                  <span className="text-xs text-[var(--oc-muted3)] truncate max-w-[200px] shrink-0">
                    Мастер: {row.assigneeName}
                  </span>
                ) : null}
                {row.issueLabel ? (
                  <span className="font-plex-mono text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 shrink-0">
                    {row.issueLabel}
                  </span>
                ) : null}
                {row.actions ? <RowExpand>{row.actions}</RowExpand> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Жагсаалттай яг ижил өгөгдлөөс (buildDayRows) визуал grid харагдацыг угсарна —
// цагийн тэнхлэгийг салбарын ажиллах цагаар (эсвэл дутуу бол 08:00–20:00
// анхны утгаар) хязгаарлана.
function DayScheduleGrid({
  schedule,
  branchHours,
  dateKey: dayKey,
  branchId,
  branchName,
  canRespondAppointments,
  canEditOrders,
  returnTo,
  assignees,
}: {
  schedule: DayScheduleData | null;
  branchHours: {
    openTime: string | null;
    closeTime: string | null;
    slotCapacity: number | null;
    schedules: Array<{
      weekday: "SUN" | "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT";
      isOpen: boolean;
      openTime: string | null;
      closeTime: string | null;
    }>;
    scheduleExceptions?: Array<{
      date: Date;
      isOpen: boolean;
      openTime: string | null;
      closeTime: string | null;
      label: string | null;
    }>;
    scheduleSeasons?: Array<{
      name: string;
      startsOn: Date;
      endsOn: Date;
      isActive: boolean;
      days: Array<{
        weekday: "SUN" | "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT";
        isOpen: boolean;
        openTime: string | null;
        closeTime: string | null;
      }>;
    }>;
  } | null;
  dateKey: string;
  branchId: string;
  branchName: string | null;
  canRespondAppointments: boolean;
  canEditOrders: boolean;
  returnTo: string;
  assignees?: { candidates: AssigneeCandidate[]; onlyUserId: string | null };
}) {
  if (!schedule) {
    return (
      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6 text-sm text-[var(--oc-muted3)]">
        Өдрийн хуваарийг харахын тулд эхлээд салбар сонгоно уу.
      </div>
    );
  }

  const { rows, issues } = buildDayRows(
    schedule,
    canRespondAppointments,
    canEditOrders,
    returnTo,
    assignees,
  );

  const hours = branchHours
    ? branchHoursForDate(branchHours, new Date(`${dayKey}T00:00:00+08:00`))
    : null;
  const openMinutes = hours?.openMinutes ?? DEFAULT_GRID_OPEN_MINUTES;
  const closeMinutes = hours?.closeMinutes ?? DEFAULT_GRID_CLOSE_MINUTES;
  // Захиалга нээлттэй цагийн гадна (жишээ нь эрт эхэлсэн) ч бүрэн харагдах ёстой
  // тул тэнхлэгийг мөрүүдийн бодит цаг хамарч байгаа эсэхээр өргөтгөнө.
  let axisStartMs = bookingSlotTime(dayKey, openMinutes).getTime();
  let axisEndMs = bookingSlotTime(dayKey, closeMinutes).getTime();
  // Хаалтын цагийн тэмдэглэгээ (GridSchedule доторх "Хаалт" шугам) — ажил
  // хаалтаас цааш явж болно (D-087 superseded, зөвхөн confirm-той анхааруулга),
  // тул grid дээр хаалтын цагийг тодруулж харуулна.
  const closingAtMs = bookingSlotTime(dayKey, closeMinutes).getTime();
  for (const row of rows) {
    if (row.startMs < axisStartMs) axisStartMs = row.startMs;
    if (!row.uncertain && row.endMs > axisEndMs) axisEndMs = row.endMs;
  }

  return (
    <div className="flex flex-col gap-3">
      {branchName ? (
        <div className="text-sm text-[var(--oc-muted3)]">
          Салбар: <span className="text-[var(--oc-ink2)] font-medium">{branchName}</span>
        </div>
      ) : null}

      {/* Жагсаалтын харагдац (`DaySchedule`) дээр байдаг анхааруулгын хэсэг —
          өмнө нь grid дээр `issues`-ийг огт харуулдаггүй байсан тул хоёр
          харагдацын хооронд сэлгэхэд мэдээлэл алдагддаг байв. */}
      {issues.length > 0 ? (
        <div className="rounded-[10px] border border-[var(--oc-warn)]/25 bg-[var(--oc-warn)]/[0.06] p-3 flex flex-wrap gap-1.5">
          {issues.map((issue, i) => (
            <span
              key={`${issue.source}-${issue.id}-${i}`}
              className="font-plex-mono text-[10.5px] px-2 py-1 rounded-full bg-[var(--oc-warn)]/15 text-[var(--oc-warn)] border border-[var(--oc-warn)]/25"
            >
              {SCHEDULE_ISSUE_LABEL[issue.reason]}
            </span>
          ))}
        </div>
      ) : null}

      <GridSchedule
        rows={rows}
        axisStartMs={axisStartMs}
        axisEndMs={axisEndMs}
        closingAtMs={closingAtMs}
        branchId={branchId}
        returnTo={returnTo}
        slotCapacity={branchHours?.slotCapacity ?? 1}
      />
    </div>
  );
}

type DayHistoryData = Awaited<ReturnType<typeof loadBranchScheduleHistory>>;

// S11: read-only view of what actually happened on a past day — every real
// OrderTimeBooking session intersecting that day (open or closed), not the
// single "current" row loadBranchSchedule's live pipeline collapses down to.
// No status-change controls here: this is history, not a page for acting on
// the present.
function HistoryView({
  data,
  branchName,
}: {
  data: DayHistoryData | null;
  branchName: string | null;
}) {
  if (!data) {
    return (
      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6 text-sm text-[var(--oc-muted3)]">
        Түүхийг харахын тулд эхлээд салбар сонгоно уу.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {branchName ? (
        <div className="text-sm text-[var(--oc-muted3)]">
          Салбар: <span className="text-[var(--oc-ink2)] font-medium">{branchName}</span>
        </div>
      ) : null}
      <p className="text-sm text-[var(--oc-muted3)]">
        Тэр өдөр бодитоор болсон бүх ажлын сессүүд — одоогийн байдал биш,
        байсан цаг захиргаа. &ldquo;Ажилласан&rdquo; тэмдэглэгээ нь тухайн
        сесс ямар нэг байдлаар ажил эхэлж (ACTIVE) байсныг илэрхийлнэ;
        &ldquo;Цуцлагдсан/эхлээгүй&rdquo; нь ажил эхлэхээс өмнө хугацаа
        хаагдсан (жишээ нь өөр өдөр рүү шилжсэн) захиалгыг илэрхийлнэ — энэ нь
        тодорхой байдлыг батлах биш, ойролцоо тооцоолол.
      </p>

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
        {data.sessions.length === 0 ? (
          <div className="p-6 text-center text-sm text-[var(--oc-muted4)]">
            Энэ өдөр түүхэн бичлэг алга.
          </div>
        ) : (
          <div className="divide-y divide-[var(--oc-line)]">
            {data.sessions.map((session, i) => {
              const order = session.order;
              const name = order
                ? (() => {
                    const vehicle = order.vehicle
                      ? `${order.vehicle.plate} · ${order.vehicle.make} ${order.vehicle.model}`
                      : null;
                    const customer = customerLabel({
                      fullName: order.customer?.fullName,
                      phone: order.customer?.phone,
                    });
                    return vehicle ? `${customer} — ${vehicle}` : customer;
                  })()
                : session.orderId;
              return (
                <div
                  key={`${session.orderId}-${i}`}
                  className="px-3 py-2.5 flex flex-wrap items-center gap-3"
                >
                  <span className="font-plex-mono text-xs font-semibold text-[var(--oc-ink2)] tabular-nums w-32 shrink-0">
                    {fmtUbTime(session.start)}–{fmtUbTime(session.end)}
                  </span>
                  {order ? (
                    <span
                      className={`font-plex-mono text-[10px] px-1.5 py-0.5 rounded-full ${ORDER_STATUS_BADGE[order.status]} shrink-0`}
                    >
                      {ORDER_STATUS_LABEL[order.status]}
                    </span>
                  ) : null}
                  <span
                    className={`font-plex-mono text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${
                      session.wasWorked
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-[var(--oc-panel2)] text-[var(--oc-muted3)] border-[var(--oc-line)]"
                    }`}
                  >
                    {session.wasWorked ? "Ажилласан" : "Цуцлагдсан/эхлээгүй"}
                  </span>
                  <span className="text-sm text-[var(--oc-ink2)] truncate flex-1">
                    {name}
                  </span>
                  {order ? (
                    <Link
                      href={`/dashboard/orders/${order.id}`}
                      className="font-plex-mono text-[10px] px-2 py-1 rounded-full border border-[var(--oc-line)] bg-[var(--oc-panel2)] text-[var(--oc-muted3)] hover:border-[var(--oc-line2)] hover:bg-white/[0.05] transition-colors shrink-0"
                    >
                      Захиалга руу →
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

