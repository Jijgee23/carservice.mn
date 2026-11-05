"use client";

import { useState } from "react";

type WeeklyRow = {
  weekday: string;
  label: string;
  isOpen: boolean;
  hours: string | null;
  isToday: boolean;
};

type Notice = { key: string; text: string };

/**
 * Салбарын 7 хоногийн хуваарь (өнөөдрийг тодруулна) + удахгүй болох онцгой
 * өдрүүд. Өгөгдөл бүгд server-ээс props-оор ирнэ. Онцгой өдрүүд олон бол
 * эхний 2-ыг харуулж, үлдсэнийг «Бүгдийг харах»-аар дэлгэнэ.
 */
export function HoursDisclosure({
  weeklyRows,
  notices,
}: {
  weeklyRows: WeeklyRow[];
  notices: Notice[];
}) {
  const [expanded, setExpanded] = useState(false);
  const shownNotices = expanded ? notices : notices.slice(0, 2);

  return (
    <div className="text-sm">
      <ul className="flex flex-col gap-0.5">
        {weeklyRows.map((row) => (
          <li
            key={row.weekday}
            className={`flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 ${
              row.isToday ? "bg-[var(--oc-accent)]/10" : ""
            }`}
          >
            <span className={row.isToday ? "font-semibold text-[var(--oc-ink)]" : "text-[var(--oc-muted)]"}>
              {row.label}
              {row.isToday ? (
                <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--oc-accent)]">өнөөдөр</span>
              ) : null}
            </span>
            <span
              className={`tabular-nums ${
                row.isOpen
                  ? row.isToday
                    ? "font-semibold text-[var(--oc-ink)]"
                    : "text-[var(--oc-ink2)]"
                  : "text-[var(--oc-muted4)]"
              }`}
            >
              {row.isOpen ? row.hours ?? "Нээлттэй" : "Хаалттай"}
            </span>
          </li>
        ))}
      </ul>
      {notices.length > 0 ? (
        <div className="mt-3 rounded-xl border border-[var(--oc-warn)]/30 bg-[var(--oc-warn)]/10 px-3 py-2.5">
          <div className="text-xs font-semibold text-[var(--oc-ink2)]">Онцгой өдрүүд</div>
          <ul className="mt-1 flex flex-col gap-0.5">
            {shownNotices.map((n) => (
              <li key={n.key} className="text-xs text-[var(--oc-muted)]">
                {n.text}
              </li>
            ))}
          </ul>
          {notices.length > 2 ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="mt-1 text-xs font-semibold text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]"
            >
              {expanded ? "Хураах" : `Бүгдийг харах (${notices.length})`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
