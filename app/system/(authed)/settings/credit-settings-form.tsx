"use client";

import { useActionState, useEffect, useRef } from "react";
import { type SystemCreditState, updateCreditSettingsAction } from "@/app/_actions/system-credit";
import { useToast } from "@/app/_components/toast";

/** Credit score-оор автомат блоклох тохиргоо (lib/credit-score.ts). */
export function CreditSettingsForm({
  initial,
}: {
  initial: { autoBlock: boolean; threshold: number; mode: "HIDE" | "SUSPEND" };
}) {
  const toast = useToast();
  const [state, formAction, pending] = useActionState<SystemCreditState, FormData>(updateCreditSettingsAction, null);
  const handled = useRef<SystemCreditState>(null);
  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;
    if (state.ok) toast.success(state.message ?? "Хадгалагдлаа.");
    else toast.error(state.message ?? Object.values(state.fieldErrors ?? {})[0] ?? "Алдаа гарлаа.");
  }, [state, toast]);

  return (
    <form action={formAction} className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 flex flex-col gap-4">
      <div>
        <h2 className="font-semibold text-[var(--oc-ink)]">Credit score — автомат блок</h2>
        <p className="mt-0.5 text-xs text-[var(--oc-muted3)]">
          Байгууллагын оноо (0–100) босгоос доош орвол автоматаар блоклогдоно, босго + 5-аас дээш сэргэвэл нээгдэнэ.
          Байгууллага бүрийн хуудаснаас блокыг гараар цуцалж болно.
        </p>
      </div>
      <label className="inline-flex items-center gap-2 text-sm text-[var(--oc-muted)]">
        <input type="checkbox" name="creditAutoBlock" defaultChecked={initial.autoBlock} className="accent-[var(--oc-accent)]" />
        Автомат блок идэвхтэй
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-[var(--oc-muted)]">
          Босго (0–100)
          <input
            name="creditBlockThreshold"
            type="number"
            min={0}
            max={100}
            defaultValue={initial.threshold}
            className="auth-input mt-1 w-full font-plex-mono"
          />
        </label>
        <label className="text-xs text-[var(--oc-muted)]">
          Блокын хэлбэр
          <select name="creditBlockMode" defaultValue={initial.mode} className="auth-input mt-1 w-full">
            <option value="HIDE">Нийтээс нуух (ажилтан системээ ашиглана)</option>
            <option value="SUSPEND">Бүрэн түдгэлзүүлэх (нэвтэрч чадахгүй)</option>
          </select>
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="self-end rounded-lg bg-[var(--oc-accent)] px-4 py-2 text-sm font-medium text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)] disabled:opacity-60"
      >
        {pending ? "Хадгалж байна..." : "Хадгалах ба дахин тооцох"}
      </button>
    </form>
  );
}
