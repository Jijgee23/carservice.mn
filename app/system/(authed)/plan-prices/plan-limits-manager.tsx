"use client";

import { useState } from "react";
import {
  resetPlanLimitsAction,
  updatePlanLimitAction,
} from "@/app/_actions/system-plan-limits";
import {
  DEFAULT_PLAN_LIMITS,
  MODULE_LIMIT_CODES,
  PLAN_LIMIT_META,
  type PlanLimitCode,
} from "@/lib/plan-limits";
import { PLAN_LABEL } from "@/lib/subscription";

const PLANS = ["FREE", "BUSINESS", "ENTERPRISE"] as const;
type Plan = (typeof PLANS)[number];

export type PlanLimitRow = {
  id: string;
  plan: Plan;
  code: string;
  intValue: number | null;
  boolValue: boolean | null;
  highlighted: boolean;
};

export function PlanLimitsManager({ limits }: { limits: PlanLimitRow[] }) {
  // (plan, code) → row
  const map = new Map<string, PlanLimitRow>();
  for (const l of limits) map.set(`${l.plan}:${l.code}`, l);

  return (
    <div className="rounded-xl border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--oc-line2)] flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-sm text-[var(--oc-ink)]">Модулиуд</h2>
          <p className="text-xs text-[var(--oc-muted3)] mt-0.5">
            Багцыг модулиар ялгана: хаалттай модулийн хуудас, API, үйлдэл
            түгжигдэж «багцад ороогүй» гэж харагдана. Үндсэн хэсэг (засварын
            хуудас, үйлчлүүлэгч, машин, үйлчилгээ, ажилтан, төлбөр, кассын ээлж)
            үргэлж нээлттэй.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {PLANS.map((p) => (
            <form key={p} action={resetPlanLimitsAction}>
              <input type="hidden" name="plan" value={p} />
              <button
                type="submit"
                className="text-[11px] text-[var(--oc-muted3)] hover:text-[var(--oc-muted)] px-2 py-1 rounded hover:bg-white/[0.04] transition-colors"
                title={`${PLAN_LABEL[p]}-ийг default утга руу буцаах`}
              >
                ↻ {p}
              </button>
            </form>
          ))}
        </div>
      </div>

      <LimitsTable codes={[...MODULE_LIMIT_CODES]} map={map} heading="Модуль" />

    </div>
  );
}

function LimitsTable({
  codes,
  map,
  heading,
}: {
  codes: PlanLimitCode[];
  map: Map<string, PlanLimitRow>;
  heading: string;
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="border-b border-[var(--oc-line2)] bg-[var(--oc-panel2)]">
            <th className="text-left text-xs text-[var(--oc-muted3)] font-medium px-4 py-2.5">
              {heading}
            </th>
            {PLANS.map((p) => (
              <th
                key={p}
                className="text-left text-xs text-[var(--oc-muted3)] font-medium px-4 py-2.5"
              >
                {PLAN_LABEL[p]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {codes.map((code) => {
            const meta = PLAN_LIMIT_META[code];
            return (
              <tr
                key={code}
                className="border-b border-[var(--oc-line2)] last:border-0 hover:bg-white/[0.02]"
              >
                <td className="px-4 py-3 align-top">
                  <div className="text-[var(--oc-ink2)] font-medium">{meta.label}</div>
                  <div className="text-[11px] text-[var(--oc-muted3)] mt-0.5">
                    {meta.description}
                  </div>
                  <code className="text-[10px] text-[var(--oc-muted4)] mt-0.5 inline-block">
                    {code}
                  </code>
                </td>
                {PLANS.map((p) => {
                  const row = map.get(`${p}:${code}`);
                  return (
                    <td key={p} className="px-4 py-3 align-top">
                      <LimitCell plan={p} code={code} row={row ?? null} />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LimitCell({
  plan,
  code,
  row,
}: {
  plan: Plan;
  code: PlanLimitCode;
  row: PlanLimitRow | null;
}) {
  // Override мөр байхгүй бол анхдагч утгыг харуулна (эс бөгөөс анхдагчаар
  // нээлттэй модуль «хаалттай» мэт харагдана).
  const def = DEFAULT_PLAN_LIMITS[plan][code];
  const [boolValue, setBoolValue] = useState<boolean>(row?.boolValue ?? def.boolValue ?? false);
  const [highlighted, setHighlighted] = useState<boolean>(row?.highlighted ?? false);
  const [pending, setPending] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save() {
    setPending(true);
    setSavedAt(null);
    try {
      const fd = new FormData();
      fd.set("plan", plan);
      fd.set("code", code);
      if (boolValue) fd.set("boolValue", "on");
      if (highlighted) fd.set("highlighted", "on");
      await updatePlanLimitAction(null, fd);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2000);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={boolValue}
            onChange={(e) => {
              setBoolValue(e.target.checked);
            }}
            onBlur={save}
            className="accent-[var(--oc-accent)]"
          />
          <span className="text-xs text-[var(--oc-muted)]">
            {boolValue ? "Нээлттэй" : "Хаалттай"}
          </span>
        </label>
      <label className="inline-flex items-center gap-1.5 cursor-pointer text-[10px] text-[var(--oc-muted3)]">
        <input
          type="checkbox"
          checked={highlighted}
          onChange={(e) => setHighlighted(e.target.checked)}
          onBlur={save}
          className="accent-[var(--oc-accent)] scale-75"
        />
        Тодруулах
      </label>
      <div className="text-[10px] h-3">
        {pending ? (
          <span className="text-[var(--oc-muted3)]">Хадгалж...</span>
        ) : savedAt ? (
          <span className="text-emerald-400 light:text-emerald-700">✓ Хадгалав</span>
        ) : null}
      </div>
    </div>
  );
}
