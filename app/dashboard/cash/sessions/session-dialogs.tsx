"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { closeCashSessionAction, getCloseSessionFiguresAction, openCashSessionAction, type CashActionState } from "@/app/_actions/cash";
import { FormError } from "@/app/_components/auth-shell";
import { Btn, Field } from "@/app/_components/landing-ops-ui";
import { Modal } from "@/app/_components/modal";
import { formatPriceInput, formatTugrik, liveFormatPriceInput } from "@/lib/orders";
import type { SerializedCashSession } from "@/lib/cash/session";
import { useRetainedFormAction } from "../use-retained-form-action";
import { methodRowLabel } from "./method-breakdown";

/** Money string -> integer minor units (null when unparsable) so the live difference never drifts. */
function toCents(value: string): number | null {
  const cleaned = value.replace(/[\s,]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** «Касс нээх»: branch, opening cash, note. */
export function OpenSessionButton({ branchId, branchName }: { branchId: string; branchName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn type="button" size="md" onClick={() => setOpen(true)}>
        Касс нээх
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title={`Касс нээх · ${branchName}`}>
        <OpenForm branchId={branchId} branchName={branchName} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function OpenForm({ branchId, branchName, onDone }: { branchId: string; branchName: string; onDone: () => void }) {
  const router = useRouter();
  const [opening, setOpening] = useState("0");
  const { state, pending, onSubmit } = useRetainedFormAction<CashActionState>(openCashSessionAction, () => {
    router.refresh();
    onDone();
  });
  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
      <input type="hidden" name="openingCash" value={opening.replace(/,/g, "")} />
      <input type="hidden" name="branchId" value={branchId} />
      <FormError message={state && !state.ok && Object.keys(fieldErrors).length === 0 ? state.message : undefined} />
      <Field label="Салбар" htmlFor="session-open-branch" error={fieldErrors.branchId}>
        <input id="session-open-branch" type="text" value={branchName} readOnly className="compact-input w-full" />
      </Field>
      <Field label="Эхний үлдэгдэл (₮)" htmlFor="session-open-cash" required error={fieldErrors.openingCash}>
        <input
          id="session-open-cash"
          type="text"
          inputMode="decimal"
          required
          value={opening}
          onChange={(e) => setOpening(liveFormatPriceInput(e.target.value))}
          onBlur={(e) => setOpening(formatPriceInput(e.target.value))}
          className="compact-input w-full text-right tabular-nums"
        />
      </Field>
      <Field label="Тайлбар" htmlFor="session-open-note" error={fieldErrors.note}>
        <textarea id="session-open-note" name="note" rows={2} maxLength={1000} className="compact-input w-full" />
      </Field>
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="ghost" size="md" onClick={onDone}>
          Болих
        </Btn>
        <Btn type="submit" size="md" disabled={pending}>
          {pending ? "Нээж байна..." : "Касс нээх"}
        </Btn>
      </div>
    </form>
  );
}

/** «Касс хаах»: counted cash with the live expected and difference shown before confirming. Figures are fetched fresh on open. */
export function CloseSessionButton({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn type="button" variant="danger" size="md" onClick={() => setOpen(true)}>
        Касс хаах
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title="Касс хаах">
        {open ? <CloseFormLoader sessionId={sessionId} onDone={() => setOpen(false)} /> : null}
      </Modal>
    </>
  );
}

type CloseFigures = { expectedCash: string; byMethod: SerializedCashSession["byMethod"] };

function CloseFormLoader({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const [figures, setFigures] = useState<CloseFigures | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getCloseSessionFiguresAction(sessionId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setError(null);
          setFigures({ expectedCash: res.expectedCash, byMethod: res.byMethod });
        } else {
          setError(res.message);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Тооцоолсон дүнг ачаалахад алдаа гарлаа.");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, attempt]);

  if (figures) return <CloseForm sessionId={sessionId} expectedCash={figures.expectedCash} byMethod={figures.byMethod} onDone={onDone} />;
  if (error) {
    return (
      <div className="flex flex-col gap-4 p-5">
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Btn type="button" variant="ghost" size="md" onClick={onDone}>
            Болих
          </Btn>
          <Btn
            type="button"
            size="md"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Дахин оролдох
          </Btn>
        </div>
      </div>
    );
  }
  return <p className="p-5 text-sm text-[var(--oc-muted3)]">Тооцоолсон дүнг ачаалж байна...</p>;
}

function CloseForm({
  sessionId,
  expectedCash,
  byMethod,
  onDone,
}: {
  sessionId: string;
  expectedCash: string;
  byMethod: SerializedCashSession["byMethod"];
  onDone: () => void;
}) {
  // Non-cash groups present in the shift. QPay is confirmed by the system (no input); the rest take an optional count.
  const groups = byMethod.filter((g) => g.method !== "CASH");
  const keyOf = (g: { method: string; bank: string | null }) => `${g.method}:${g.bank ?? ""}`;
  const [methodCounted, setMethodCounted] = useState<Record<string, string>>({});
  const methodCountsJson = JSON.stringify(
    groups
      .filter((g) => g.method !== "QPAY" && toCents(methodCounted[keyOf(g)] ?? "") != null)
      .map((g) => ({ method: g.method, bank: g.bank ?? "", counted: (methodCounted[keyOf(g)] ?? "").replace(/[\s,]/g, "") })),
  );
  const methodInvalid = groups.some((g) => {
    const v = methodCounted[keyOf(g)] ?? "";
    return g.method !== "QPAY" && v.trim() !== "" && toCents(v) == null;
  });

  const router = useRouter();
  const [counted, setCounted] = useState("");
  const { state, pending, onSubmit } = useRetainedFormAction<CashActionState>(closeCashSessionAction, () => {
    router.refresh();
    onDone();
  });
  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const methodError = Object.entries(fieldErrors).find(([k]) => k.startsWith("methodCounts"))?.[1];
  const countedCents = toCents(counted);
  const expectedCents = Math.round(Number(expectedCash) * 100);
  const diffCents = countedCents == null ? null : countedCents - expectedCents;
  const diffTone =
    diffCents == null || diffCents === 0 ? "text-[var(--oc-ink)]" : diffCents > 0 ? "text-[var(--oc-ok)]" : "text-red-400 light:text-red-600";
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="countedCash" value={counted.replace(/,/g, "")} />
      <FormError message={state && !state.ok && Object.keys(fieldErrors).length === 0 ? state.message : undefined} />
      <div className="rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-4 py-3 flex items-center justify-between text-sm">
        <span className="text-[var(--oc-muted3)]">Тооцоолсон үлдэгдэл</span>
        <span className="font-semibold tabular-nums text-[var(--oc-ink)]">{formatTugrik(expectedCash)}</span>
      </div>
      <Field label="Тоолсон бэлэн мөнгө (₮)" htmlFor="session-close-counted" required error={fieldErrors.countedCash}>
        <input
          id="session-close-counted"
          type="text"
          inputMode="decimal"
          required
          value={counted}
          onChange={(e) => setCounted(liveFormatPriceInput(e.target.value))}
          onBlur={(e) => setCounted(formatPriceInput(e.target.value))}
          placeholder="0"
          className="compact-input w-full text-right tabular-nums"
        />
      </Field>
      <div className="rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-4 py-3 flex items-center justify-between text-sm">
        <span className="text-[var(--oc-muted3)]">Зөрүү</span>
        <span className={`font-semibold tabular-nums ${diffTone}`}>
          {diffCents == null ? "—" : `${diffCents > 0 ? "+" : ""}${formatTugrik(String(diffCents / 100))}`}
        </span>
      </div>
      {groups.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium text-[var(--oc-ink)]">Бусад төлбөрийн арга</div>
          <p className="text-xs text-[var(--oc-muted3)]">Тоолсон дүн заавал биш. Хоосон үлдээвэл зөрүү бодогдохгүй.</p>
          <input type="hidden" name="methodCounts" value={methodCountsJson} />
          {methodError ? <p className="text-xs text-red-400 light:text-red-600">{methodError}</p> : null}
          {groups.map((g) => {
            const k = keyOf(g);
            const expected = Math.round(Number(g.expected ?? g.net) * 100);
            const isQpay = g.method === "QPAY";
            const c = isQpay ? null : toCents(methodCounted[k] ?? "");
            const d = c == null ? null : c - expected;
            const tone = d == null || d === 0 ? "text-[var(--oc-ink)]" : d > 0 ? "text-[var(--oc-ok)]" : "text-red-400 light:text-red-600";
            return (
              <div key={k} className="rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-4 py-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 items-center text-sm">
                <div>
                  <div className="text-[var(--oc-ink)]">{methodRowLabel(g)}</div>
                  <div className="text-xs text-[var(--oc-muted3)]">Тооцоолсон {formatTugrik(String(expected / 100))}</div>
                </div>
                {isQpay ? (
                  <span className="text-xs text-[var(--oc-muted3)]">Системээр баталгаажсан</span>
                ) : (
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Тоолсон · ${methodRowLabel(g)}`}
                    value={methodCounted[k] ?? ""}
                    onChange={(e) => setMethodCounted((prev) => ({ ...prev, [k]: liveFormatPriceInput(e.target.value) }))}
                    onBlur={(e) => setMethodCounted((prev) => ({ ...prev, [k]: formatPriceInput(e.target.value) }))}
                    placeholder="Тоолсон дүн"
                    className="compact-input w-36 text-right tabular-nums"
                  />
                )}
                {!isQpay ? (
                  <>
                    <span className="text-[var(--oc-muted3)]">Зөрүү</span>
                    <span className={`text-right font-semibold tabular-nums ${tone}`}>
                      {d == null ? "—" : `${d > 0 ? "+" : ""}${formatTugrik(String(d / 100))}`}
                    </span>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <Field label="Тайлбар" htmlFor="session-close-note" error={fieldErrors.note}>
        <textarea id="session-close-note" name="note" rows={2} maxLength={1000} className="compact-input w-full" />
      </Field>
      <div className="flex justify-end gap-2">
        <Btn type="button" variant="ghost" size="md" onClick={onDone}>
          Болих
        </Btn>
        <Btn type="submit" variant="danger" size="md" disabled={pending || countedCents == null || methodInvalid}>
          {pending ? "Хааж байна..." : "Касс хаах"}
        </Btn>
      </div>
    </form>
  );
}
