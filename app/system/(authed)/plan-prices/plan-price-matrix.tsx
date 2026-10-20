"use client";

import { useState } from "react";
import { upsertPlanPriceAction } from "@/app/_actions/system-plan-prices";
import { Btn } from "@/app/_components/landing-ops-ui";
import { formatPriceInput, liveFormatPriceInput } from "@/lib/orders";
import { BILLING_PERIOD_LABEL, PLAN_LABEL } from "@/lib/subscription";

const PLANS = ["BUSINESS", "ENTERPRISE"] as const;
const PERIODS = ["MONTH", "QUARTER", "YEAR"] as const;
const CURRENCY = "MNT";

type Plan = (typeof PLANS)[number];
type Period = (typeof PERIODS)[number];

export type PlanPriceMatrixRow = {
  id: string;
  plan: "FREE" | "BUSINESS" | "ENTERPRISE";
  period: "MONTH" | "QUARTER" | "YEAR";
  amount: string;
  currency: string;
  isActive: boolean;
  notes: string | null;
};

export function PlanPriceMatrix({ prices }: { prices: PlanPriceMatrixRow[] }) {
  const map = new Map<string, PlanPriceMatrixRow>();
  for (const p of prices) {
    if (p.currency === CURRENCY) {
      map.set(`${p.plan}:${p.period}`, p);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--oc-line2)]">
        <h2 className="font-semibold text-sm text-[var(--oc-ink)]">Үнэ ({CURRENCY})</h2>
        <p className="text-xs text-[var(--oc-muted3)] mt-0.5">
          Багц × хугацаа. Утгаа өөрчлөөд «Хадгалах» дарна — нүүр хуудасны үнэ
          (сарын) болон тенантын «Захиалга» хуудас шууд шинэчлэгдэнэ.
          <span className="text-[var(--oc-muted3)]">
            {" "}
            FREE багц нь зөвхөн бүртгүүлэх үед 14 хоногийн туршилт — үнэ
            оруулдаггүй.
          </span>
        </p>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-[var(--oc-line2)] bg-[var(--oc-panel2)]">
              <th className="text-left text-xs text-[var(--oc-muted3)] font-medium px-4 py-2.5">
                Багц
              </th>
              {PERIODS.map((p) => (
                <th
                  key={p}
                  className="text-left text-xs text-[var(--oc-muted3)] font-medium px-4 py-2.5"
                >
                  {BILLING_PERIOD_LABEL[p]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PLANS.map((plan) => (
              <tr
                key={plan}
                className="border-b border-[var(--oc-line2)] last:border-0 hover:bg-white/[0.02]"
              >
                <td className="px-4 py-3 text-[var(--oc-ink2)] font-medium align-top">
                  {PLAN_LABEL[plan]}
                </td>
                {PERIODS.map((period) => {
                  const row = map.get(`${plan}:${period}`);
                  return (
                    <td key={period} className="px-4 py-3 align-top">
                      <PriceCell plan={plan} period={period} row={row ?? null} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PriceCell({
  plan,
  period,
  row,
}: {
  plan: Plan;
  period: Period;
  row: PlanPriceMatrixRow | null;
}) {
  // Хадгалагдсан утга — «өөрчлөгдсөн эсэх»-ийг тооцоход.
  const [saved, setSaved] = useState({
    amount: row ? formatPriceInput(row.amount) : "",
    isActive: row?.isActive ?? true,
    notes: row?.notes ?? "",
  });
  const [amount, setAmount] = useState<string>(saved.amount);
  const [isActive, setIsActive] = useState<boolean>(saved.isActive);
  const [notes, setNotes] = useState<string>(saved.notes);
  const [pending, setPending] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = amount !== saved.amount || isActive !== saved.isActive || notes !== saved.notes;

  async function save() {
    if (!amount.trim()) {
      setError("Үнээ оруулна уу.");
      return;
    }
    setPending(true);
    setError(null);
    setSavedAt(null);
    try {
      const normalized = formatPriceInput(amount);
      const fd = new FormData();
      fd.set("plan", plan);
      fd.set("period", period);
      fd.set("currency", CURRENCY);
      fd.set("amount", normalized.replace(/,/g, ""));
      if (isActive) fd.set("isActive", "on");
      if (notes) fd.set("notes", notes);
      const res = await upsertPlanPriceAction(null, fd);
      if (res && !res.ok) {
        setError(res.fieldErrors?.amount ?? res.message ?? "Алдаа");
        return;
      }
      setAmount(normalized);
      setSaved({ amount: normalized, isActive, notes });
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="relative w-full max-w-[9rem]">
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(liveFormatPriceInput(e.target.value))}
          onBlur={() => setAmount((v) => (v ? formatPriceInput(v) : v))}
          placeholder="0"
          aria-label={`${PLAN_LABEL[plan]} · ${BILLING_PERIOD_LABEL[period]} үнэ`}
          className="compact-input !py-1 !text-sm w-full pr-6 font-plex-mono tabular-nums"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--oc-muted3)]">₮</span>
      </div>
      <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] text-[var(--oc-muted)]">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="accent-[var(--oc-accent)]"
        />
        Идэвхтэй
      </label>
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Тэмдэглэл (заавал биш)"
        className="compact-input !py-1 !text-[11px] w-full max-w-[14rem]"
      />
      <div className="flex items-center gap-2">
        <Btn type="submit" size="sm" disabled={pending || !dirty}>
          {pending ? "Хадгалж..." : "Хадгалах"}
        </Btn>
        <span className="text-[10px]">
          {error ? (
            <span className="text-red-400 light:text-red-700">{error}</span>
          ) : savedAt ? (
            <span className="text-emerald-400 light:text-emerald-700">✓ Хадгалав</span>
          ) : dirty ? (
            <span className="text-[var(--oc-warn)]">Хадгалаагүй</span>
          ) : null}
        </span>
      </div>
    </form>
  );
}
