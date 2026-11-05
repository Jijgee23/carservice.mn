"use client";

import { useState } from "react";
import type { Weekday } from "@/lib/branches";
import { resolveEffectiveSchedule, scheduleDisplayLabel, type ScheduleException, type ScheduleSeason, type ScheduleRule } from "@/lib/branch-effective-schedule";

// Inline (popover биш) сарын календарь — салбар сонгомогц шууд харагдана.
const WEEKDAYS = ["Да", "Мя", "Лх", "Пү", "Ба", "Бя", "Ня"];

// JS getDay() (0=Ня..6=Бя) → Weekday enum.
const JS_DAY_TO_WEEKDAY: Weekday[] = [
  "SUN",
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Даваагаар эхэлсэн 42 нүдтэй (6 долоо хоног) сарын тор.
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function BookingCalendar({
  value,
  today,
  onChange,
  openWeekdays,
  schedule,
}: {
  value: string;
  today: string; // YYYY-MM-DD — өнөөдөр (минимум сонголт)
  onChange: (dateStr: string) => void;
  // Салбарын ажилладаг гарагууд. Заагдвал бусад (амардаг) гарагийг disabled.
  openWeekdays?: Weekday[];
  schedule?: {
    openTime: string | null;
    closeTime: string | null;
    schedules: ScheduleRule[];
    scheduleExceptions?: ScheduleException[];
    scheduleSeasons?: ScheduleSeason[];
  };
}) {
  const [view, setView] = useState(() => {
    const base = value || today;
    const [y, m] = base.split("-").map(Number);
    return { year: y, month: m - 1 };
  });

  const grid = monthGrid(view.year, view.month);

  function prevMonth() {
    setView((v) =>
      v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 },
    );
  }
  function nextMonth() {
    setView((v) =>
      v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 },
    );
  }

  return (
    <div className="w-full rounded-xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={prevMonth}
          className="grid h-8 w-8 place-items-center rounded-lg text-[var(--oc-muted)] hover:bg-[var(--oc-panel2)] hover:text-[var(--oc-ink)] transition-colors"
          aria-label="Өмнөх сар"
        >
          ‹
        </button>
        <div className="text-sm font-semibold text-[var(--oc-ink)]">
          {view.year} оны {view.month + 1}-р сар
        </div>
        <button
          type="button"
          onClick={nextMonth}
          className="grid h-8 w-8 place-items-center rounded-lg text-[var(--oc-muted)] hover:bg-[var(--oc-panel2)] hover:text-[var(--oc-ink)] transition-colors"
          aria-label="Дараах сар"
        >
          ›
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="grid h-7 place-items-center text-[11px] font-medium text-[var(--oc-muted3)]"
          >
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.map((d) => {
          const ds = ymd(d);
          const inMonth = d.getMonth() === view.month;
          const scheduleForDate = schedule
            ? resolveEffectiveSchedule({ dateStr: ds, branch: schedule })
            : null;
          const closed = scheduleForDate
            ? !scheduleForDate.open
            : openWeekdays != null &&
              !openWeekdays.includes(JS_DAY_TO_WEEKDAY[d.getDay()]);
          const closedReason =
            closed && scheduleForDate
              ? (scheduleDisplayLabel(scheduleForDate) ?? "Амарна")
              : "Амарна";
          const disabled = ds < today || closed;
          const selected = ds === value;
          const isToday = ds === today;
          return (
            <button
              key={ds}
              type="button"
              disabled={disabled}
              title={closed ? closedReason : undefined}
              onClick={() => onChange(ds)}
              className={`relative grid h-11 place-items-center rounded-lg text-sm transition-colors ${
                disabled
                  ? "cursor-not-allowed text-[var(--oc-muted4)] opacity-60"
                  : selected
                    ? "bg-[var(--oc-accent)] font-semibold text-[var(--oc-on-accent)] shadow-sm"
                    : inMonth
                      ? "text-[var(--oc-ink)] hover:bg-[var(--oc-accent)]/10"
                      : "text-[var(--oc-muted4)] hover:bg-[var(--oc-panel2)]"
              } ${isToday && !selected ? "ring-1 ring-inset ring-[var(--oc-accent)]/60" : ""}`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
