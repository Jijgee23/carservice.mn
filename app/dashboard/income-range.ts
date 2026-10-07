import type { IncomePoint } from "./income-chart";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY = ["Ня", "Да", "Мя", "Лх", "Пү", "Ба", "Бя"];

export type IncomeRangeKey = "week" | "month" | "3month" | "custom";

// Quick-range buttons shown above the chart.
export const INCOME_QUICK_RANGES: { key: IncomeRangeKey; label: string }[] = [
  { key: "week", label: "7 хоног" },
  { key: "month", label: "Энэ сар" },
  { key: "3month", label: "3 сар" },
];

export type ResolvedIncomeRange = {
  key: IncomeRangeKey;
  from: Date; // inclusive period start
  to: Date; // period end (now, or end of custom range)
  fetchFrom: Date; // from minus one period length — covers the comparison window
  bucket: "day" | "week";
  label: string;
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function withComparison(
  r: Omit<ResolvedIncomeRange, "fetchFrom">,
): ResolvedIncomeRange {
  const periodMs = r.to.getTime() - r.from.getTime();
  return { ...r, fetchFrom: new Date(r.from.getTime() - periodMs) };
}

export function resolveIncomeRange(sp: {
  range?: string;
  from?: string;
  to?: string;
}): ResolvedIncomeRange {
  const now = new Date();
  const today = startOfDay(now);

  if (sp.from || sp.to) {
    const from = sp.from
      ? new Date(`${sp.from}T00:00:00`)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = sp.to ? new Date(`${sp.to}T23:59:59.999`) : now;
    const spanDays =
      Math.round(
        (startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS,
      ) + 1;
    return withComparison({
      key: "custom",
      from,
      to,
      bucket: spanDays > 45 ? "week" : "day",
      label: `${from.toLocaleDateString("mn-MN")} – ${to.toLocaleDateString("mn-MN")}`,
    });
  }

  switch (sp.range) {
    case "month":
      return withComparison({
        key: "month",
        from: new Date(now.getFullYear(), now.getMonth(), 1),
        to: now,
        bucket: "day",
        label: "Энэ сар",
      });
    case "3month":
      return withComparison({
        key: "3month",
        from: startOfDay(
          new Date(now.getFullYear(), now.getMonth() - 3, now.getDate() + 1),
        ),
        to: now,
        bucket: "week",
        label: "Сүүлийн 3 сар",
      });
    default:
      return withComparison({
        key: "week",
        from: new Date(today.getTime() - 6 * DAY_MS),
        to: now,
        bucket: "day",
        label: "Сүүлийн 7 хоног",
      });
  }
}

export type IncomeSeries = {
  points: IncomePoint[];
  total: number;
  changePct: number | null;
};

// `isInternal` rows (дотоод засвар) are never revenue; callers also filter in
// the query, this is a defensive second guard.
type OrderRow = { completedAt: Date | null; totalAmount: unknown; isInternal?: boolean };

function labelFor(start: Date, range: ResolvedIncomeRange): string {
  if (range.bucket === "week") return `${start.getMonth() + 1}/${start.getDate()}`;
  if (range.key === "week") return WEEKDAY[start.getDay()];
  return String(start.getDate());
}

export function buildIncomeSeries(
  orders: OrderRow[],
  range: ResolvedIncomeRange,
): IncomeSeries {
  const fromDayMs = startOfDay(range.from).getTime();
  const toDayMs = startOfDay(range.to).getTime();
  const bucketDays = range.bucket === "week" ? 7 : 1;

  const count =
    Math.floor((toDayMs - fromDayMs) / DAY_MS / bucketDays) + 1;
  const buckets: { start: Date; value: number }[] = [];
  for (let i = 0; i < count; i++) {
    buckets.push({
      start: new Date(fromDayMs + i * bucketDays * DAY_MS),
      value: 0,
    });
  }

  let prevTotal = 0;
  const fromMs = range.from.getTime();
  for (const o of orders) {
    if (!o.completedAt || o.isInternal) continue;
    const amount = Number.parseFloat(String(o.totalAmount ?? "0")) || 0;
    if (o.completedAt.getTime() < fromMs) {
      prevTotal += amount; // belongs to the comparison window
      continue;
    }
    const localDayMs = startOfDay(o.completedAt).getTime();
    const idx = Math.floor((localDayMs - fromDayMs) / DAY_MS / bucketDays);
    if (idx >= 0 && idx < buckets.length) buckets[idx].value += amount;
  }

  const points = buckets.map((b) => ({
    label: labelFor(b.start, range),
    value: b.value,
  }));
  const total = buckets.reduce((a, b) => a + b.value, 0);
  const changePct =
    prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;

  return { points, total, changePct };
}
