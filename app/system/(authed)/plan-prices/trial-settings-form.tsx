"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  type TrialSettingsState,
  grantBulkTrialAction,
  previewBulkTrialAction,
  saveTrialSettingsAction,
} from "@/app/_actions/system-trials";
import { useToast } from "@/app/_components/toast";

type PlanKey = "BUSINESS" | "ENTERPRISE";

export type TrialSettingsInitial = {
  plans: Record<PlanKey, { enabled: boolean; days: number }>;
  signupEnabled: boolean;
  signupPlan: PlanKey;
};

const PLANS: PlanKey[] = ["BUSINESS", "ENTERPRISE"];

/** Багц бүрийн үнэгүй туршилт: асаах/унтраах, хоног, бүртгэлийн автомат туршилт, одоогийн байгууллагуудад бөөнөөр олгох. */
export function TrialSettingsForm({ initial }: { initial: TrialSettingsInitial }) {
  const toast = useToast();
  const [state, formAction, pending] = useActionState<TrialSettingsState, FormData>(saveTrialSettingsAction, null);
  const handled = useRef<TrialSettingsState>(null);
  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;
    if (state.ok) toast.success(state.message ?? "Хадгалагдлаа.");
    else toast.error(state.message ?? Object.values(state.fieldErrors ?? {})[0] ?? "Алдаа гарлаа.");
  }, [state, toast]);

  const [bulkPlan, setBulkPlan] = useState<PlanKey>("BUSINESS");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [busy, startBusy] = useTransition();

  function preview() {
    startBusy(async () => {
      const r = await previewBulkTrialAction(bulkPlan);
      if (r.ok) setPreviewCount(r.count ?? 0);
      else toast.error(r.message);
    });
  }
  function grant() {
    startBusy(async () => {
      const r = await grantBulkTrialAction(bulkPlan);
      setPreviewCount(null);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });
  }

  return (
    <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 flex flex-col gap-5">
      <form action={formAction} className="flex flex-col gap-4">
        <div>
          <h2 className="font-semibold text-[var(--oc-ink)]">Үнэгүй туршилт</h2>
          <p className="mt-0.5 text-xs text-[var(--oc-muted3)]">
            Байгууллага төлбөртэй багц бүрийг нэг удаа үнэгүй туршиж болно. Хугацаа дуусахад автоматаар үндсэн (FREE)
            багц руу буцна.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <div key={plan} className="rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] p-3 flex flex-col gap-2">
              <span className="font-plex-mono text-xs uppercase tracking-[0.1em] text-[var(--oc-muted3)]">{plan}</span>
              <label className="inline-flex items-center gap-2 text-sm text-[var(--oc-muted)]">
                <input
                  type="checkbox"
                  name={`enabled_${plan}`}
                  defaultChecked={initial.plans[plan].enabled}
                  className="accent-[var(--oc-accent)]"
                />
                Туршилт идэвхтэй
              </label>
              <label className="text-xs text-[var(--oc-muted)]">
                Хугацаа (хоног)
                <input
                  name={`days_${plan}`}
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={initial.plans[plan].days}
                  className="auth-input mt-1 w-full font-plex-mono"
                />
                {state?.fieldErrors?.[`days_${plan}`] ? (
                  <span className="text-red-400">{state.fieldErrors[`days_${plan}`]}</span>
                ) : null}
              </label>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] p-3 flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-[var(--oc-muted)]">
            <input
              type="checkbox"
              name="signupTrialEnabled"
              defaultChecked={initial.signupEnabled}
              className="accent-[var(--oc-accent)]"
            />
            Шинэ бүртгэлд автоматаар олгох
          </label>
          <label className="text-xs text-[var(--oc-muted)] inline-flex items-center gap-2">
            Багц
            <select name="signupTrialPlan" defaultValue={initial.signupPlan} className="auth-input !py-1.5 !text-sm">
              {PLANS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="self-end rounded-lg bg-[var(--oc-accent)] px-4 py-2 text-sm font-medium text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)] disabled:opacity-60"
        >
          {pending ? "Хадгалж байна..." : "Хадгалах"}
        </button>
      </form>

      <div className="border-t border-[var(--oc-line)] pt-4 flex flex-col gap-2">
        <h3 className="text-sm font-medium text-[var(--oc-ink)]">Одоогийн байгууллагуудад олгох</h3>
        <p className="text-xs text-[var(--oc-muted3)]">
          Тухайн багцыг өмнө туршаагүй, идэвхтэй төлбөртэй багцгүй, түдгэлзүүлээгүй бүх байгууллагад одоогийн
          тохиргооны хугацаагаар туршилт олгоно. Эхлээд хэдэн байгууллагад хамаарахыг харна уу.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={bulkPlan}
            onChange={(e) => {
              setBulkPlan(e.target.value as PlanKey);
              setPreviewCount(null);
            }}
            className="auth-input !py-1.5 !text-sm"
          >
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={preview}
            disabled={busy}
            className="rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-3 py-1.5 text-sm text-[var(--oc-ink2)] disabled:opacity-60"
          >
            Урьдчилан харах
          </button>
          {previewCount !== null ? (
            <>
              <span className="text-sm text-[var(--oc-muted)]">{previewCount} байгууллага</span>
              <button
                type="button"
                onClick={grant}
                disabled={busy || previewCount === 0}
                className="rounded-lg bg-[var(--oc-accent)] px-3 py-1.5 text-sm font-medium text-[var(--oc-on-accent)] disabled:opacity-60"
              >
                {busy ? "Олгож байна..." : "Баталж олгох"}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
