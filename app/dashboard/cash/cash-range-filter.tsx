"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { DatePicker } from "@/app/_components/date-picker";

/**
 * Cash date range. The URL always carries an explicit range: dateFrom/dateTo, or `range=all`
 * (all time). Clearing both dates therefore means "all time", not "back to this month".
 */
export function CashRangeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const from = searchParams.get("dateFrom") ?? "";
  const to = searchParams.get("dateTo") ?? "";
  const all = searchParams.get("range") === "all";

  function setRange(nextFrom: string, nextTo: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("page");
    next.delete("dateFrom");
    next.delete("dateTo");
    next.delete("range");
    if (nextFrom || nextTo) {
      if (nextFrom) next.set("dateFrom", nextFrom);
      if (nextTo) next.set("dateTo", nextTo);
    } else {
      next.set("range", "all");
    }
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  return (
    <div
      className={`relative flex shrink-0 items-center gap-1.5 transition-opacity ${isPending ? "opacity-60 pointer-events-none" : ""}`}
      aria-busy={isPending}
    >
      <span className="text-xs text-[var(--oc-muted3)] shrink-0">Огноо</span>
      <DatePicker mode="range" value={{ from, to }} onChange={(v) => setRange(v.from, v.to)} className="w-[14rem]" />
      <button
        type="button"
        onClick={() => setRange("", "")}
        className={`shrink-0 text-xs underline underline-offset-2 whitespace-nowrap ${
          all ? "text-[var(--oc-accent)]" : "text-[var(--oc-muted3)] hover:text-[var(--oc-ink2)]"
        }`}
      >
        Бүх хугацаа
      </button>
    </div>
  );
}
