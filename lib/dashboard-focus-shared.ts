// Хяналтын самбарын «Анхаарах / Өнөөдөр» хэсгийн цэвэр тооцоолол (DB-гүй,
// тестлэгдэнэ). Сервер ачаалагч: lib/dashboard-focus.ts.

import { Prisma } from "@/app/generated/prisma/client";
import { computeOutstanding } from "@/lib/cash/settlement";

export type FocusItemRow = {
  status: string;
  kind: string;
  diagnosticReportId: string | null;
};

export type OrderWorkState = {
  /** Цуцлагдаагүй, сэлбэг (PART) биш мөр — явц тооцогдох ажил. */
  active: number;
  done: number;
  unfilledDiagnostics: number;
  /** Бүх ажил дууссан, оношилгоо бөглөгдсөн — «Дуусгах» дарахад бэлэн. */
  ready: boolean;
  percent: number;
};

/**
 * Хийгдэж буй хуудасны ажлын төлөв. Засварын хуудасны дэлгэрэнгүйн
 * «Гүйцэтгэл» болон `orderCompleteBlockedReason`-тэй ижил дүрэм: PART мөр
 * явцгүй, цуцлагдсан мөр тооцохгүй.
 */
export function orderWorkState(items: ReadonlyArray<FocusItemRow>): OrderWorkState {
  const active = items.filter((it) => it.status !== "CANCELLED" && it.kind !== "PART");
  const done = active.filter((it) => it.status === "COMPLETED").length;
  const unfilledDiagnostics = active.filter(
    (it) => it.kind === "DIAGNOSTIC" && !it.diagnosticReportId,
  ).length;
  return {
    active: active.length,
    done,
    unfilledDiagnostics,
    ready: active.length > 0 && done === active.length && unfilledDiagnostics === 0,
    percent: active.length > 0 ? Math.round((done / active.length) * 100) : 0,
  };
}

export type AgingRow = {
  completedAt: Date | null;
  totalAmount: Prisma.Decimal | null;
  payments: ReadonlyArray<{ amount: Prisma.Decimal }>;
};

export type ReceivableAging = {
  total: Prisma.Decimal;
  count: number;
  /** Дууссанаас хойш 0–30 / 31–60 / 60+ хоног. */
  buckets: [Prisma.Decimal, Prisma.Decimal, Prisma.Decimal];
};

const DAY_MS = 86_400_000;

/** Авлагын насжилт — `sumReceivable`-тэй ижил: зөвхөн үлдэгдэл > 0 хуудас. */
export function receivableAging(rows: ReadonlyArray<AgingRow>, now: Date): ReceivableAging {
  const zero = () => new Prisma.Decimal(0);
  const buckets: [Prisma.Decimal, Prisma.Decimal, Prisma.Decimal] = [zero(), zero(), zero()];
  let total = zero();
  let count = 0;
  for (const row of rows) {
    const outstanding = computeOutstanding(row.totalAmount, row.payments.map((p) => p.amount));
    if (!outstanding.gt(0)) continue;
    count += 1;
    total = total.plus(outstanding);
    const days = row.completedAt ? Math.floor((now.getTime() - row.completedAt.getTime()) / DAY_MS) : 0;
    const idx = days > 60 ? 2 : days > 30 ? 1 : 0;
    buckets[idx] = buckets[idx].plus(outstanding);
  }
  return { total, count, buckets };
}

export type WorkloadRow = { id: string; name: string; count: number; overdue: number };

/** Хийгдэж буй хуудсыг мастераар бүлэглэнэ (олонтой нь эхэнд, мастергүй нь төгсгөлд). */
export function workloadByMaster(
  orders: ReadonlyArray<{ assignedTo: { id: string; firstName: string; lastName: string } | null; overdue: boolean }>,
): WorkloadRow[] {
  const map = new Map<string, WorkloadRow>();
  for (const o of orders) {
    const id = o.assignedTo?.id ?? "";
    const name = o.assignedTo ? `${o.assignedTo.lastName} ${o.assignedTo.firstName}`.trim() : "Мастергүй";
    const row = map.get(id) ?? { id, name, count: 0, overdue: 0 };
    row.count += 1;
    if (o.overdue) row.overdue += 1;
    map.set(id, row);
  }
  return [...map.values()].sort((a, b) => {
    if (!a.id !== !b.id) return a.id ? -1 : 1;
    return b.count - a.count || a.name.localeCompare(b.name);
  });
}
