"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DayRow } from "./day-rows";
import type { AppointmentStatus } from "@/lib/appointments";
import { assignLanes, pctOf, hourMarksBetween } from "@/lib/schedule-grid-layout";

const SLOT_MINUTES = 15; // хоосон зайг дарахад цаг энэ нарийвчлалаар бүхэлдэнэ

function roundToSlot(ms: number): number {
  const slotMs = SLOT_MINUTES * 60 * 1000;
  return Math.round(ms / slotMs) * slotMs;
}

/** `ms`-ийг дараагийн слот руу ДЭЭШ бүхэлдэнэ — одооноос хойшхи анхны боломжит
 * цагийг гаргахад (доош бүхэлдвэл өнгөрсөн цаг гарч, үүсгэх боломжгүй болно). */
function ceilToSlot(ms: number): number {
  const slotMs = SLOT_MINUTES * 60 * 1000;
  return Math.ceil(ms / slotMs) * slotMs;
}

// react-hooks/purity: `Date.now()`-г component-ийн render биед шууд бичихгүй
// (app/(app)/account/appointments/[id]/page.tsx-ийн computeIsDelayed-ийн ижил
// тайлбарыг үз) — тусдаа module-level helper-т шилжүүлнэ.
function nowMs(): number {
  return Date.now();
}

// Асиа/Улаанбаатар цагийн бүсээр цаг форматлана — сервер өөр бүсэд байршиж болзошгүй.
function fmtUbTime(ms: number): string {
  return new Intl.DateTimeFormat("mn-MN", {
    timeZone: "Asia/Ulaanbaatar",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

const ROW_HEIGHT = 46; // нэг давхаргын (sub-lane) өндөр, px
const MIN_BLOCK_WIDTH_PCT = 2.5; // маш богино ажлыг ч дор хаяж хараагдахуйц өргөнтэй байлгана
const BLOCK_NAME_TIER_PX = 44; // үүнээс өргөн бол нэр багтана
const BLOCK_FULL_TIER_PX = 132; // үүнээс өргөн бол цаг + нэр + төлбөрийн чип бүгд багтана
const OPEN_END_FADE_PX = 26; // төгсгөл нь тодорхойгүй блокийн баруун ирмэгийн бүдгэрэл

/**
 * Блокийн өнгө нь ТӨЛӨВ-ийг илэрхийлнэ — салбарын өнгө биш. Өдрийн grid нэг
 * салбарын хуваарийг харуулдаг тул салбарын өнгө энд мэдээлэл дамжуулахгүй,
 * харин "юу хийх ёстой" (батлах хүлээгдэж буй эсэх) нь хамгийн чухал.
 *
 * `globals.css`-ийн `.shift-box` (ажилтны хуваарийн grid ашигладаг) нь өнгөө
 * `--branch-color` хувьсагчаас авдаг тул тэр класcыг хэвээр нь ашиглаад
 * хувьсагчийг төлвийн өнгөөр л солино — шинэ CSS бичихгүйгээр хоёр хуваарийн
 * дүрслэл (10% дэвсгэр, 28% хүрээ, 3px зүүн зураас) нэг ижил болно.
 */
const STATUS_COLOR: Record<AppointmentStatus, string> = {
  PENDING: "var(--oc-warn)",
  CONFIRMED: "var(--oc-ok)",
  REJECTED: "var(--oc-muted3)",
  CANCELLED: "var(--oc-muted3)",
  NO_SHOW: "var(--oc-b3)",
};
const ISSUE_COLOR = "var(--oc-b5)"; // өгөгдлийн алдаатай мөр — төлвөөс давамгайлна
const UNKNOWN_STATUS_COLOR = "var(--oc-muted3)";
const ISSUE_LEGEND_LABEL = "Анхаарах";

function blockColor(row: DayRow): string {
  if (row.issueLabel) return ISSUE_COLOR;
  return row.status ? STATUS_COLOR[row.status] : UNKNOWN_STATUS_COLOR;
}

/** Блокийн бүтэн тайлбар — явцуу блок дээр текст багтахгүй тул `title`/
 * `aria-label`-ээр ҮРГЭЛЖ бүрэн мэдээллийг өгнө (жагсаалтын харагдацад
 * харагддаг төлөв/алдааг grid дээр алдахгүйн тулд). */
function blockTitle(row: DayRow): string {
  const end = row.uncertain
    ? "тодорхойгүй"
    : row.endsAtDayBoundary
      ? "24:00"
      : fmtUbTime(row.endMs);
  const parts = [`${fmtUbTime(row.startMs)}–${end}`, row.name];
  if (row.assigneeName) parts.push(`Мастер: ${row.assigneeName}`);
  if (row.statusLabel) parts.push(row.statusLabel);
  if (row.paymentStatusLabel) parts.push(row.paymentStatusLabel);
  if (row.issueLabel) parts.push(`⚠ ${row.issueLabel}`);
  return parts.join(" · ");
}

/** Тэнхлэгийн зах дээрх бөмбөлөг шошгыг гаднаа гарч таслагдахаас хамгаална. */
function pillTransform(percent: number): string {
  if (percent < 8) return "translateX(0)";
  if (percent > 92) return "translateX(-100%)";
  return "translateX(-50%)";
}

export function GridSchedule({
  rows,
  axisStartMs,
  axisEndMs,
  closingAtMs,
  branchId,
  returnTo,
  slotCapacity,
}: {
  rows: DayRow[];
  axisStartMs: number;
  axisEndMs: number;
  closingAtMs?: number | null;
  branchId: string;
  returnTo: string;
  // Branch's configured concurrent-slot count — the grid always reserves
  // this many rows, even empty, so staff see the branch's real capacity
  // rather than only as many rows as happen to be booked right now.
  slotCapacity: number;
}) {
  const router = useRouter();
  const bodyRef = useRef<HTMLDivElement>(null);
  // Hover-ийг мөр тус бүрээр тэмдэглэнэ — өмнө нь ганц утга байсан тул нэг мөр
  // дээр хулгана авчрахад БҮХ мөрийн cursor зэрэг өөрчлөгддөг байв.
  const [hover, setHover] = useState<{ lane: number; ms: number } | null>(null);
  // Гарын хяналтын байрлал — mouse-гүйгээр (Tab → сум → Enter) цаг захиалга
  // үүсгэх боломж. Өмнө нь mouse-оор л үүсгэх боломжтой байсан.
  const [keyCursor, setKeyCursor] = useState<{ lane: number; ms: number } | null>(null);

  const positioned = useMemo(() => assignLanes(rows), [rows]);
  const laneCount = Math.max(slotCapacity, 1, ...positioned.map((r) => r.lane + 1));
  const hasOverflowLanes = laneCount > Math.max(slotCapacity, 1);
  const axisSpan = Math.max(1, axisEndMs - axisStartMs);

  // Өнгөрсөн цагийг (өнөөдрийн харагдац дээр) саарлаар "дүүргэж" тэмдэглэнэ —
  // тухайн хэсэгт дарж шинэ захиалга/цаг захиалга үүсгэх боломжгүй (доорх
  // handleBodyClick-д `ms < now` бол алгасна). Ирээдүйн өдөр бол now нь
  // axisStartMs-ээс өмнө тул дүүргэлт харагдахгүй; бүтэн өнгөрсөн өдөр бол
  // (жишээ нь өчигдрийг харж байгаа) бүхэлдээ дүүрнэ.
  //
  // `now`-ыг render биед шууд `Date.now()`-оор биш, mount-ийн дараах effect-ээр
  // тохируулна: SSR ба client-ийн эхний render хоёр өөр агшинд явагдах тул
  // (`nowMs()`-г шууд дуудвал) hydration mismatch өгдөг байсан (server-ийн
  // HTML дэх "Одоо" тэмдэглэгээний байрлал/цаг client дээр өөр гарна). Эхний
  // render (server ба client аль алинд) `null` — тэмдэглэгээ mount хүртэл
  // харагдахгүй, дараа нь бодит утгаараа шинэчлэгдэнэ.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  const pastFillEndMs = now != null ? Math.min(now, axisEndMs) : axisStartMs;
  const showPastFill = now != null && pastFillEndMs > axisStartMs;
  const showNowMarker = now != null && now > axisStartMs && now < axisEndMs;

  // Grid-ийн бодит px өргөн — блокийн доторх агуулгыг өргөнөөс нь хамааруулж
  // сонгох (явцуу блок дээр таслагдсан цагийн хэсэг харуулахын оронд), мөн
  // цагийн шошгыг шигүү үед сийрэгжүүлэхэд хэрэгтэй. `null` үед (SSR болон
  // эхний render) бүтэн агуулга — server/client ижил тул hydration зөрөхгүй.
  const [gridWidth, setGridWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const apply = (w: number) => {
      if (w > 0) setGridWidth(w);
    };
    apply(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w != null) apply(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Хаалтын цагийн шугам — ажил хаалтаас цааш үргэлжилж болно (staff-side
  // confirm-able warning, D-087 superseded), тул хаалтын цагийг тэнхлэг дээр
  // тодруулж, хаалтаас хойших хэсэгт хөнгөн өнгө өгнө (past-fill-тэй адил
  // хэв маягаар, гэхдээ "past/unavailable" гэсэн санааг өгөхгүйн тулд бүдэг).
  const showClosingMarker =
    closingAtMs != null && closingAtMs > axisStartMs && closingAtMs < axisEndMs;
  const showClosingTint = closingAtMs != null && closingAtMs < axisEndMs;
  const closingTintStartMs = closingAtMs != null ? Math.max(closingAtMs, axisStartMs) : axisStartMs;

  // Босоо саарал шугам харуулах цагийн тэмдэглэгээ — цаг тутам.
  const hourMarks = useMemo(
    () => hourMarksBetween(axisStartMs, axisEndMs),
    [axisStartMs, axisEndMs],
  );

  // Шошго бүх цагт багтахгүй нарийн дэлгэц дээр (эсвэл эрт эхэлсэн захиалгаас
  // болж тэнхлэг сунгасан үед) шошгыг 2/3/4 цаг тутам сийрэгжүүлнэ — босоо
  // зураас нь цаг тутам хэвээр үлдэнэ.
  const labelStep = useMemo(() => {
    if (gridWidth == null || hourMarks.length < 2) return 1;
    const spacing = gridWidth / (hourMarks.length - 1);
    if (spacing >= 56) return 1;
    if (spacing >= 30) return 2;
    if (spacing >= 20) return 3;
    return 4;
  }, [gridWidth, hourMarks.length]);

  // Өнгө нь утга далдалж эхэлсэн тул тухайн өдөр БОДИТООР байгаа төлвүүдийн
  // тайллыг grid-ийн доор харуулна (бүх боломжит төлвийн статик legend биш).
  const legend = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) {
      const label = row.issueLabel
        ? ISSUE_LEGEND_LABEL
        : row.statusLabel || "Тодорхойгүй";
      seen.set(label, blockColor(row));
    }
    return [...seen.entries()];
  }, [rows]);

  const pct = (ms: number) => pctOf(ms, axisStartMs, axisSpan);

  // Хулганы x-координатыг тэнхлэг дээрх цаг (ms) руу хөрвүүлнэ, 15 минутад
  // бүхэлдэнэ — хоосон зай дээр дарахад шинэ цаг захиалга нээхэд ашиглана.
  function msFromClientX(clientX: number): number | null {
    const el = bodyRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return roundToSlot(axisStartMs + ratio * axisSpan);
  }

  /** Гарын хяналт эхлэх цаг — одооноос хойшхи анхны слот, тэнхлэгийн дотор. */
  function defaultCursorMs(): number {
    return Math.min(axisEndMs, Math.max(axisStartMs, ceilToSlot(nowMs())));
  }

  function goCreateAppointment(ms: number) {
    const params = new URLSearchParams({
      branchId,
      scheduledAt: new Date(ms).toISOString(),
      next: returnTo,
    });
    router.push(`/dashboard/appointments/new?${params.toString()}`);
  }

  // Захиалгын жагсаалт хуудсанд ганцхан тухайн мөрийг шүүж харуулна — тусдаа
  // дэлгэрэнгүй хуудас байхгүй тул одоо байгаа "highlight" загварыг ашиглана
  // (харах: app/dashboard/appointments/page.tsx-ийн highlightId).
  function goToBookingDetail(appointmentId: string) {
    router.push(`/dashboard/appointments?highlight=${encodeURIComponent(appointmentId)}`);
  }

  function handleBodyClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return; // блок дээр дарсан бол үл хайхрана
    const ms = msFromClientX(e.clientX);
    if (ms == null) return;
    if (ms < nowMs()) return; // өнгөрсөн цаг дээр шинэ зүйл үүсгэхгүй
    goCreateAppointment(ms);
  }

  function handleLaneKeyDown(e: React.KeyboardEvent<HTMLDivElement>, lane: number) {
    if (e.target !== e.currentTarget) return; // доторх блокийн товчны үйлдэлд саад болохгүй
    const base = keyCursor?.lane === lane ? keyCursor.ms : defaultCursorMs();

    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      // Shift-тэй бол цагаар, эс бөгөөс слотоор (15 мин) шилжинэ.
      const stepMs = (e.shiftKey ? 60 : SLOT_MINUTES) * 60 * 1000;
      const next = base + (e.key === "ArrowRight" ? stepMs : -stepMs);
      setKeyCursor({
        lane,
        ms: Math.min(axisEndMs, Math.max(axisStartMs, roundToSlot(next))),
      });
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (base < nowMs()) return; // өнгөрсөн цаг дээр шинэ зүйл үүсгэхгүй
      goCreateAppointment(base);
      return;
    }

    if (e.key === "Escape") setKeyCursor(null);
  }

  // Хөндлөн шугам/бөмбөлөг — хулгана давамгайлна, эс бөгөөс гарын хяналт.
  const caretMs = hover?.ms ?? keyCursor?.ms ?? null;
  const showCaret = now != null && caretMs != null && caretMs >= now;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
        {/* Grid ҮРГЭЛЖ эзэмшигч контейнерийн өргөнд багтана — хэвтээ гүйлгэлт
            байхгүй (хэрэглэгчийн шийдвэр). Өмнө нь нэг цагт ногдох доод өргөн
            (64px) барьж, багтахгүй үед гүйлгэдэг байсан ч тэр гүйлгэх зурвас
            өргөн дэлгэц дээр ч харагдаж, самбарын дотор харь мэт байв. Цагийн
            шошгыг шигүү үед сийрэгжүүлэх (`labelStep`) болон блокийн агуулгыг
            өргөнөөр нь сонгох (`gridWidth`) механизм хэвээр — нарийн дэлгэцэд
            унших боломжийг одоо ТЭД хоёр л барина. */}
        <div>
          {/* Цагийн тэнхлэг — эхний/сүүлийн тэмдэглэгээг зах руу тулгаж, дундуур
              зогсохгүй тул харагдах хэсгээс гарч таслагдахгүй. */}
          <div className="relative h-7 border-b border-[var(--oc-line)]">
            {hourMarks.map((t, i) =>
              i % labelStep === 0 || i === hourMarks.length - 1 ? (
                <span
                  key={t}
                  className={`absolute top-1 font-plex-mono text-[10px] text-[var(--oc-muted3)] ${
                    i === 0
                      ? ""
                      : i === hourMarks.length - 1
                        ? "-translate-x-full"
                        : "-translate-x-1/2"
                  }`}
                  style={{ left: `${pct(t)}%` }}
                >
                  {fmtUbTime(t)}
                </span>
              ) : null,
            )}
          </div>

          {/* Грид бие — салбарын багтаамжийн мөр тус бүрийг тусдаа, зааглагдсан
              жижиг грид болгож харуулна (нэг цул талбар дундуур зураас татаад
              харуулахын оронд). Хоосон зай дээр дарахад тухайн цагаар шинэ
              (walk-in) захиалга нээнэ — блок дээр дарсныг
              e.target !== e.currentTarget-ээр ялгана. */}
          <div ref={bodyRef} className="relative flex flex-col gap-2 pt-3">
            {rows.length === 0 ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none text-sm text-[var(--oc-muted4)]">
                Энэ өдөр хуваарь хоосон байна.
              </div>
            ) : null}

            {Array.from({ length: laneCount }).map((_, lane) => {
              // Багтаамжаас хэтэрсэн мөр — давхацсан захиалга багтаамжаас олон
              // болсныг илэрхийлнэ; өмнө нь энгийн мөрөөс ялгагдахгүй байв.
              const isOverflowLane = lane >= Math.max(slotCapacity, 1);
              const laneHovered = hover?.lane === lane;
              return (
                <div
                  key={`lane-${lane}`}
                  role="group"
                  tabIndex={0}
                  aria-label={`${lane + 1}-р ажлын байр. Сум товчоор цаг сонгож, Enter дарж шинэ цаг захиалга үүсгэнэ.${
                    isOverflowLane ? " Салбарын багтаамжаас хэтэрсэн мөр." : ""
                  }`}
                  className={`relative rounded-lg border bg-[var(--oc-panel)] overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--oc-accent)]/40 ${
                    isOverflowLane
                      ? "border-[var(--oc-warn)]/35"
                      : "border-[var(--oc-line)]"
                  }`}
                  style={{
                    height: `${ROW_HEIGHT}px`,
                    cursor:
                      laneHovered && now != null && hover.ms < now ? "not-allowed" : "pointer",
                  }}
                  onClick={handleBodyClick}
                  onKeyDown={(e) => handleLaneKeyDown(e, lane)}
                  onFocus={(e) => {
                    if (e.target !== e.currentTarget) return; // доторх блок focus авсныг тоохгүй
                    setKeyCursor((c) => (c?.lane === lane ? c : { lane, ms: defaultCursorMs() }));
                  }}
                  onBlur={(e) => {
                    if (e.target !== e.currentTarget) return;
                    setKeyCursor((c) => (c?.lane === lane ? null : c));
                  }}
                  onMouseMove={(e) => {
                    const ms = msFromClientX(e.clientX);
                    setHover(ms == null ? null : { lane, ms });
                  }}
                  onMouseLeave={() => setHover((h) => (h?.lane === lane ? null : h))}
                >
                  {positioned
                    .filter((row) => row.lane === lane)
                    .map((row) => {
                      const left = pct(row.startMs);
                      const right = pct(row.endMs);
                      // Доод өргөнийг барина, гэхдээ тэнхлэгийн зааг давуулахгүй
                      // — мөр `overflow-hidden` тул давсан хэсэг таслагдах ба
                      // доорх түвшин сонголт бодит харагдах өргөнөөр тооцоологдоно.
                      const widthPct = Math.min(
                        Math.max(MIN_BLOCK_WIDTH_PCT, right - left),
                        Math.max(0, 100 - left),
                      );
                      const widthPx =
                        gridWidth != null ? (widthPct / 100) * gridWidth : null;
                      // Өргөнөөс хамаарсан 3 түвшин — багтахгүй агуулгыг
                      // таслахын оронд огт харуулахгүй (бүрэн мэдээлэл title-д).
                      const tier =
                        widthPx == null || widthPx >= BLOCK_FULL_TIER_PX
                          ? "full"
                          : widthPx >= BLOCK_NAME_TIER_PX
                            ? "name"
                            : "bar";
                      // Төгсгөл нь тодорхойгүй (хугацаа тооцоологдоогүй) эсвэл
                      // шөнө дамнасан ажлын баруун ирмэгийг ХАТУУ зурвал "яг энд
                      // дуусна" гэж худал уншигдана — ирмэгийг бүдгэрүүлж, `›`
                      // тэмдгээр үргэлжилж буйг илэрхийлнэ.
                      const openEnded = row.uncertain || row.endsAtDayBoundary;
                      const title = blockTitle(row);
                      return (
                        <button
                          key={row.key}
                          type="button"
                          title={title}
                          aria-label={title}
                          onClick={() => goToBookingDetail(row.id)}
                          className={`shift-box group absolute top-0.5 bottom-0.5 flex items-center gap-1.5 overflow-hidden rounded-lg text-left text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--oc-accent)] ${
                            tier === "bar" ? "px-0" : "px-2"
                          }`}
                          style={{
                            left: `${left}%`,
                            width: `${widthPct}%`,
                            // `.shift-box` өнгөө эндээс авна — салбарын өнгөний
                            // оронд төлвийн өнгө (дээрх STATUS_COLOR-ын тайлбар).
                            ["--branch-color" as string]: blockColor(row),
                            ...(openEnded ? { borderRightColor: "transparent" } : null),
                          }}
                        >
                          {/* `.shift-box` дэвсгэрийг `globals.css`-д давхаргагүй
                              зарласан тул Tailwind-ийн `hover:bg-*` дарж чадахгүй
                              — hover-ийг тусдаа давхаргаар өгнө. */}
                          <span
                            aria-hidden
                            className="pointer-events-none absolute inset-0 bg-white/[0.06] opacity-0 transition-opacity group-hover:opacity-100"
                          />

                          {tier === "bar" ? null : (
                            <span className="relative flex min-w-0 items-center gap-1.5">
                              {tier === "full" ? (
                                <span className="font-plex-mono text-[10px] text-[var(--oc-muted3)] shrink-0">
                                  {fmtUbTime(row.startMs)}
                                </span>
                              ) : null}
                              {row.issueLabel ? (
                                <span className="shrink-0 text-[10px] text-[var(--oc-b5)]">⚠</span>
                              ) : null}
                              <span className="truncate text-[var(--oc-ink2)]">{row.name}</span>
                              {tier === "full" && row.paymentStatusLabel ? (
                                <span
                                  className={`shrink-0 rounded-full border px-1.5 py-0.5 font-plex-mono text-[9px] ${row.paymentStatusClass}`}
                                >
                                  {row.paymentStatusLabel}
                                </span>
                              ) : null}
                            </span>
                          )}

                          {openEnded ? (
                            <>
                              <span
                                aria-hidden
                                className="pointer-events-none absolute inset-y-0 right-0"
                                style={{
                                  width: `${OPEN_END_FADE_PX}px`,
                                  background:
                                    "linear-gradient(to right, transparent, var(--oc-panel))",
                                }}
                              />
                              <span
                                aria-hidden
                                className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 font-plex-mono text-[11px] text-[var(--oc-muted2)]"
                              >
                                ›
                              </span>
                            </>
                          ) : null}
                        </button>
                      );
                    })}
                </div>
              );
            })}

            {/* Одоо/өнгөрсөн цаг, хаалт зэрэг цагийн шугамууд — мөр бүрт
                тусад нь давтахын оронд бүх мөрийг дамнасан НЭГ тасралтгүй
                давхарга болгож зурна (хоосон зайнуудыг ч дамжуулан), эс
                бөгөөс мөр хооронд тасарч харагдана. */}
            <div className="absolute inset-0 pointer-events-none">
              {showPastFill ? (
                <div
                  className="absolute top-0 bottom-0 left-0 bg-[var(--oc-muted2)]/[0.16]"
                  style={{ width: `${pct(pastFillEndMs)}%` }}
                  title="Өнгөрсөн цаг"
                />
              ) : null}

              {showNowMarker ? (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-[var(--oc-muted)]/80"
                  style={{ left: `${pct(now!)}%` }}
                />
              ) : null}

              {showClosingTint ? (
                <div
                  className="absolute top-0 bottom-0 right-0 bg-[var(--oc-warn)]/[0.06]"
                  style={{ width: `${100 - pct(closingTintStartMs)}%` }}
                  title="Хаалтын цагаас хойш"
                />
              ) : null}

              {showClosingMarker ? (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-[var(--oc-warn)]/70"
                  style={{ left: `${pct(closingAtMs!)}%` }}
                />
              ) : null}

              {hourMarks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 bottom-0 w-px bg-[var(--oc-line)]/60"
                  style={{ left: `${pct(t)}%` }}
                />
              ))}

              {showCaret ? (
                <div
                  className="absolute top-0 bottom-0 w-px bg-[var(--oc-accent)]/70"
                  style={{ left: `${pct(caretMs!)}%` }}
                />
              ) : null}
            </div>

            {showNowMarker ? (
              <span
                className="absolute -top-1 whitespace-nowrap rounded-full bg-[var(--oc-muted2)] px-1.5 py-0.5 font-plex-mono text-[9px] text-[var(--oc-carbon)] pointer-events-none"
                style={{ left: `${pct(now!)}%`, transform: pillTransform(pct(now!)) }}
              >
                Одоо · {fmtUbTime(now!)}
              </span>
            ) : null}

            {showClosingMarker ? (
              <span
                className="absolute -top-1 whitespace-nowrap rounded-full bg-[var(--oc-warn)]/80 px-1.5 py-0.5 font-plex-mono text-[9px] text-[var(--oc-carbon)] pointer-events-none"
                style={{
                  left: `${pct(closingAtMs!)}%`,
                  transform: pillTransform(pct(closingAtMs!)),
                }}
              >
                Хаалт · {fmtUbTime(closingAtMs!)}
              </span>
            ) : null}

            {showCaret ? (
              <span
                className="absolute -top-1 whitespace-nowrap rounded-full bg-[var(--oc-accent)] px-1.5 py-0.5 font-plex-mono text-[9px] text-[var(--oc-on-accent)] pointer-events-none"
                style={{
                  left: `${pct(caretMs!)}%`,
                  transform: pillTransform(pct(caretMs!)),
                }}
              >
                + {fmtUbTime(caretMs!)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {legend.length > 0 || hasOverflowLanes ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-[var(--oc-muted3)]">
          {legend.map(([label, color]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              {label}
            </span>
          ))}
          {hasOverflowLanes ? (
            <span className="flex items-center gap-1.5 text-[var(--oc-warn)]">
              <span
                aria-hidden
                className="h-2 w-3 rounded-sm border border-[var(--oc-warn)]/60"
              />
              Багтаамжаас хэтэрсэн мөр
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
