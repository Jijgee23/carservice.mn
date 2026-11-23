"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  type PaymentActionState,
  cancelSubscriptionPaymentAction,
  checkSubscriptionPaymentAction,
  createSubscriptionPaymentAction,
} from "@/app/_actions/subscription-payments";
import { type StartTrialState, startPlanTrialAction } from "@/app/_actions/plan-trials";
import { ConfirmButton } from "@/app/_components/confirm-form";
import { Btn } from "@/app/_components/landing-ops-ui";
import { QPayBankGrid } from "@/app/_components/qpay-bank-grid";
import { QPayDrawer } from "@/app/_components/qpay-drawer";
import { useToast } from "@/app/_components/toast";
import { currencySymbol, formatPriceInput } from "@/lib/orders";
import type { QPayBankUrl } from "@/lib/qpay";
import {
  BILLING_PERIOD_LABEL,
  PLAN_LABEL,
} from "@/lib/subscription";

export type PlanPriceOption = {
  id: string;
  plan: "FREE" | "BUSINESS" | "ENTERPRISE";
  period: "MONTH" | "QUARTER" | "YEAR";
  amount: string;
  currency: string;
  notes: string | null;
  // Багцын модулиудаас (planFeatureLines) — тоон хязгааргүй.
  features: string[];
};

export type PendingPayment = {
  id: string;
  qrImage: string | null;
  urls: QPayBankUrl[];
  amount: string;
  currency: string;
  plan: "FREE" | "BUSINESS" | "ENTERPRISE";
  period: "MONTH" | "QUARTER" | "YEAR";
};

/** Одоо эхлүүлж болох үнэгүй туршилтууд (багц бүр нэг удаа) — карт бүрийн үндсэн товч болно. */
export type AvailableTrial = { plan: string; days: number };

export function PlanCheckout({
  prices,
  pending,
  trials = [],
}: {
  prices: PlanPriceOption[];
  pending: PendingPayment | null;
  trials?: AvailableTrial[];
}) {
  if (pending) {
    return <QRPanel pending={pending} />;
  }
  return <PlanList prices={prices} trials={trials} />;
}

function PlanList({ prices, trials }: { prices: PlanPriceOption[]; trials: AvailableTrial[] }) {
  const toast = useToast();
  const [state, formAction, formPending] = useActionState<
    PaymentActionState,
    FormData
  >(createSubscriptionPaymentAction, null);
  const [trialState, trialAction, trialPending] = useActionState<StartTrialState, FormData>(
    startPlanTrialAction,
    null,
  );
  const trialByPlan = new Map(trials.map((t) => [t.plan, t]));

  useEffect(() => {
    if (state?.message && !state.ok) {
      toast.error("Төлбөр үүсгэх боломжгүй", state.message);
    }
  }, [state, toast]);

  useEffect(() => {
    if (!trialState?.message) return;
    if (trialState.ok) toast.success(trialState.message);
    else toast.error(trialState.message);
  }, [trialState, toast]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {prices.map((p) => (
          <form
            key={p.id}
            action={formAction}
            className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel2)] p-4 flex flex-col gap-3"
          >
            <input type="hidden" name="planPriceId" value={p.id} />
            <div>
              <div className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
                {BILLING_PERIOD_LABEL[p.period]}
              </div>
              <div className="mt-1 text-lg font-semibold text-[var(--oc-ink)]">
                {PLAN_LABEL[p.plan]}
              </div>
            </div>
            <div className="font-plex-mono text-2xl font-bold text-[var(--oc-accent)]">
              {formatPriceInput(p.amount)}{" "}
              <span className="text-sm text-[var(--oc-muted3)]">{currencySymbol(p.currency)}</span>
            </div>
            {p.notes ? (
              <p className="text-xs text-[var(--oc-muted2)] line-clamp-3">{p.notes}</p>
            ) : null}
            {p.features.length > 0 ? (
              <ul className="flex flex-col gap-1.5 text-xs">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[var(--oc-muted2)]">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mt-0.5 shrink-0 text-[var(--oc-ok)]"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span className="text-[var(--oc-ink2)]">{f}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <input type="hidden" name="plan" value={p.plan} />
            {trialByPlan.get(p.plan) ? (
              <div className="mt-auto flex flex-col gap-2">
                {/* formAction: энэ товч карт доторх төлбөрийн form-ыг биш туршилтын action-ыг дуудна. */}
                <Btn type="submit" formAction={trialAction} disabled={trialPending || formPending} className="w-full">
                  {trialPending ? "Эхлүүлж..." : `${trialByPlan.get(p.plan)!.days} хоног үнэгүй туршиж үзэх`}
                </Btn>
                <button
                  type="submit"
                  disabled={formPending || trialPending}
                  className="text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-ink2)] underline underline-offset-2 disabled:opacity-60"
                >
                  {formPending ? "Үүсгэж..." : "Эсвэл шууд багц авах"}
                </button>
              </div>
            ) : (
              <Btn type="submit" disabled={formPending} className="mt-auto w-full">
                {formPending ? "Үүсгэж..." : "Багц авах"}
              </Btn>
            )}
          </form>
        ))}
        <EnterpriseCard
          trial={trialByPlan.get("ENTERPRISE") ?? null}
          trialAction={trialAction}
          trialPending={trialPending}
        />
      </div>
    </div>
  );
}

/** ENTERPRISE тогтсон үнэгүй — модулиудаа сонгоод үнийн санал авна (super admin хариу өгч олгоно). */
function EnterpriseCard({
  trial,
  trialAction,
  trialPending,
}: {
  trial: AvailableTrial | null;
  trialAction: (payload: FormData) => void;
  trialPending: boolean;
}) {
  return (
    <div className="rounded-[10px] border border-dashed border-[var(--oc-line)] bg-[var(--oc-panel2)] p-4 flex flex-col gap-3">
      <div>
        <div className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
          Захиалгат үнэ
        </div>
        <div className="mt-1 text-lg font-semibold text-[var(--oc-ink)]">
          {PLAN_LABEL.ENTERPRISE}
        </div>
      </div>
      <p className="text-xs text-[var(--oc-muted2)]">
        Сүлжээ, олон салбартай байгууллагад. Хэрэгтэй модулиудаа сонгоод үнийн
        санал аваарай — удахгүй тантай холбогдоно.
      </p>
      <div className="mt-auto flex flex-col gap-2">
        {trial ? (
          <form action={trialAction}>
            <input type="hidden" name="plan" value="ENTERPRISE" />
            <Btn type="submit" disabled={trialPending} className="w-full">
              {trialPending ? "Эхлүүлж..." : `${trial.days} хоног үнэгүй туршиж үзэх`}
            </Btn>
          </form>
        ) : null}
        <a
          href="/dashboard/settings/subscription/quote"
          className="inline-flex w-full items-center justify-center rounded-lg border border-[var(--oc-line)] py-2 text-sm font-semibold text-[var(--oc-ink2)] hover:bg-[var(--oc-panel)]"
        >
          Үнийн санал авах
        </a>
      </div>
    </div>
  );
}

function QRPanel({ pending }: { pending: PendingPayment }) {
  const [drawerOpen, setDrawerOpen] = useState(true);

  return (
    <>
      <div className="rounded-[10px] border border-[var(--oc-accent)]/25 bg-[var(--oc-accent)]/[0.05] p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
            {BILLING_PERIOD_LABEL[pending.period]} · {PLAN_LABEL[pending.plan]}
          </div>
          <div className="mt-1 font-plex-mono text-2xl font-bold text-[var(--oc-accent)]">
            {formatPriceInput(pending.amount)}{" "}
            <span className="text-sm text-[var(--oc-muted3)]">{currencySymbol(pending.currency)}</span>
          </div>
        </div>
        <Btn type="button" onClick={() => setDrawerOpen(true)}>
          QR нээх
        </Btn>
      </div>
      <QPayDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="QPay-ээр төлөх"
      >
        <QRPanelContent pending={pending} />
      </QPayDrawer>
    </>
  );
}

function QRPanelContent({ pending }: { pending: PendingPayment }) {
  const toast = useToast();
  const [paid, setPaid] = useState(false);
  const [checking, setChecking] = useState(false);
  const stopRef = useRef(false);

  async function onCancel() {
    stopRef.current = true;
    const fd = new FormData();
    fd.append("paymentId", pending.id);
    await cancelSubscriptionPaymentAction(fd);
    window.location.reload();
  }

  async function checkNow() {
    if (stopRef.current) return;
    setChecking(true);
    try {
      const fd = new FormData();
      fd.append("paymentId", pending.id);
      const res = await checkSubscriptionPaymentAction(fd);
      if (res.paid) {
        setPaid(true);
        stopRef.current = true;
        toast.success("Төлбөр амжилттай", "Багц идэвхжиж байна...");
        setTimeout(() => window.location.reload(), 1500);
      } else if (!res.ok && res.message) {
        toast.error("Төлбөр шалгах боломжгүй", res.message);
      } else {
        toast.warning(
          "Төлбөр төлөгдөөгүй байна",
          "Банкны аппаар QR-аа уншуулсны дараа дахин шалгана уу.",
        );
      }
    } catch (e) {
      toast.error(
        "Алдаа гарлаа",
        e instanceof Error ? e.message : undefined,
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-center">
        <div className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
          {BILLING_PERIOD_LABEL[pending.period]} · {PLAN_LABEL[pending.plan]}
        </div>
        <div className="mt-1 font-plex-mono text-2xl font-bold text-[var(--oc-accent)]">
          {formatPriceInput(pending.amount)}{" "}
          <span className="text-sm text-[var(--oc-muted3)]">{currencySymbol(pending.currency)}</span>
        </div>
      </div>

      {paid ? (
        <div className="bg-[var(--oc-ok)]/15 border border-[var(--oc-ok)]/30 text-[var(--oc-ok)] rounded-[10px] px-4 py-3 text-sm text-center">
          Төлбөр амжилттай — багц идэвхжиж байна...
        </div>
      ) : pending.qrImage ? (
        <div className="bg-white p-3 rounded-[10px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${pending.qrImage}`}
            alt="QPay QR"
            className="w-48 h-48 object-contain"
          />
        </div>
      ) : (
        <div className="w-48 h-48 flex items-center justify-center text-sm text-[var(--oc-muted2)]">
          QR үүсэхэд хүлээнэ үү...
        </div>
      )}

      {!paid ? (
        <>
          <div className="w-full">
            <QPayBankGrid urls={pending.urls} />
          </div>
          <p className="text-xs text-[var(--oc-muted3)] text-center">
            Утсаараа банкны апп нээж QR-ыг уншуулна уу. Төлбөр төлөгдмөгц
            багц автоматаар идэвхжинэ.
          </p>
        </>
      ) : null}

      <div className="flex items-center gap-2">
        <Btn type="button" onClick={checkNow} disabled={checking || paid} size="sm">
          {checking ? "Шалгаж байна..." : "Шалгах"}
        </Btn>
        <ConfirmButton
          onConfirm={onCancel}
          message="Энэ төлбөрийн нэхэмжлэлийг цуцлах уу?"
          title="Төлбөрийн нэхэмжлэл цуцлах"
          confirmLabel="Тийм, цуцлах"
          className="text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-ink2)] underline underline-offset-2"
        >
          Цуцлах
        </ConfirmButton>
      </div>
    </div>
  );
}
