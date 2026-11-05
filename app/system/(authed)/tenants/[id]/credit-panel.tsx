import {
  recomputeTenantCreditAction,
  setCreditExemptAction,
} from "@/app/_actions/system-credit";
import { CreditScoreCard } from "@/app/_components/credit-score-card";
import type { CreditBreakdown } from "@/lib/credit-score";
import { getCreditSettings } from "@/lib/credit-score-server";
import { CreditAdjustmentForm } from "./credit-adjustment-form";

/** Super admin: байгууллагын credit score, залруулга, блок цуцлах/дахин идэвхжүүлэх. */
export async function CreditPanel({
  tenant,
}: {
  tenant: {
    id: string;
    isTest: boolean;
    creditScore: number | null;
    creditBreakdown: unknown;
    creditUpdatedAt: Date | null;
    creditAdjustment: number;
    creditAdjustmentNote: string | null;
    creditHidden: boolean;
    creditSuspended: boolean;
    creditExempt: boolean;
  };
}) {
  const settings = await getCreditSettings();
  const blocked = tenant.creditSuspended ? "suspended" : tenant.creditHidden ? "hidden" : null;

  return (
    <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-[var(--oc-ink)]">Credit score</h2>
        <form action={recomputeTenantCreditAction}>
          <input type="hidden" name="tenantId" value={tenant.id} />
          <button type="submit" className="text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)]">
            ↻ Дахин тооцох
          </button>
        </form>
      </div>

      {tenant.isTest ? (
        <p className="text-sm text-[var(--oc-muted3)]">Тест байгууллагад credit score тооцогдохгүй.</p>
      ) : (
        <CreditScoreCard
          score={tenant.creditScore}
          breakdown={tenant.creditBreakdown as CreditBreakdown | null}
          updatedAt={tenant.creditUpdatedAt}
          threshold={settings.threshold}
          blocked={blocked}
        />
      )}

      <div className="mt-5 grid gap-4 border-t border-[var(--oc-line2)] pt-5 sm:grid-cols-2">
        <CreditAdjustmentForm
          tenantId={tenant.id}
          adjustment={tenant.creditAdjustment}
          note={tenant.creditAdjustmentNote ?? ""}
        />
        <form action={setCreditExemptAction} className="flex flex-col gap-2">
          <input type="hidden" name="tenantId" value={tenant.id} />
          <input type="hidden" name="exempt" value={tenant.creditExempt ? "false" : "true"} />
          <div className="text-xs text-[var(--oc-muted)]">Автомат блок</div>
          <p className="text-xs text-[var(--oc-muted3)]">
            {tenant.creditExempt
              ? "Энэ байгууллага автомат блокоос чөлөөлөгдсөн (админ цуцалсан)."
              : blocked
                ? "Credit score-оор блоклогдсон байна. Цуцалбал блок арилж, цаашид автоматаар блоклогдохгүй."
                : "Оноо босгоос доош орвол автоматаар блоклогдоно."}
          </p>
          <button
            type="submit"
            className="self-start rounded-lg border border-[var(--oc-line)] px-3 py-1.5 text-xs font-medium text-[var(--oc-ink2)] hover:bg-[var(--oc-panel2)]"
          >
            {tenant.creditExempt ? "Автомат блокыг дахин идэвхжүүлэх" : blocked ? "Блокыг цуцлах" : "Автомат блокоос чөлөөлөх"}
          </button>
        </form>
      </div>
    </section>
  );
}
