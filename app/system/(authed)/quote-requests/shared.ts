import type { QuoteStatus } from "@/lib/quote-requests";

export const QUOTE_STATUS_BADGE: Record<QuoteStatus, string> = {
  NEW: "bg-red-500/15 text-red-300 border border-red-500/25 light:bg-red-100 light:border-red-300 light:text-red-700",
  CONTACTED: "bg-[var(--oc-warn)]/15 text-[var(--oc-warn)] border border-[var(--oc-warn)]/25",
  CLOSED: "bg-zinc-500/15 text-zinc-300 border border-zinc-500/25 light:bg-zinc-100 light:border-zinc-300 light:text-zinc-600",
};

export function fmtDateTime(d: Date): string {
  return d.toLocaleString("mn-MN", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
