"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeStockCountAction, saveStockCountLinesAction } from "@/app/_actions/stock-counts";
import { Btn } from "@/app/_components/landing-ops-ui";
import { Modal } from "@/app/_components/modal";
import { formatTugrik } from "@/lib/orders";
import { formatStock } from "@/lib/services";

export type SheetLine = {
  id: string;
  name: string;
  code: string | null;
  unit: string | null;
  costPrice: string | null;
  systemQty: string;
  countedQty: string | null;
};

type View = "all" | "todo" | "diff";

const QTY_RE = /^\d{1,9}([.,]\d{1,3})?$/;
const toNum = (v: string) => Number(v.replace(",", "."));

/**
 * Editable count of a DRAFT: type the counted quantity per item («=» copies the system figure). Edits stay local until
 * «Хадгалах»; «Дуусгах» saves what is pending and applies the count in one request.
 */
export function CountSheet({ countId, lines }: { countId: string; lines: SheetLine[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.countedQty == null ? "" : String(Number(l.countedQty))])),
  );
  const [saved, setSaved] = useState<Record<string, string>>(values);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = useMemo(() => lines.filter((l) => (values[l.id] ?? "") !== (saved[l.id] ?? "")), [lines, values, saved]);
  const pendingEntries = () => dirty.map((l) => ({ lineId: l.id, countedQty: values[l.id].trim() === "" ? null : values[l.id].trim() }));

  const diffOf = (l: SheetLine): number | null => {
    const v = (values[l.id] ?? "").trim();
    if (v === "" || !QTY_RE.test(v)) return null;
    return Math.round((toNum(v) - Number(l.systemQty)) * 1000) / 1000;
  };

  const summary = useMemo(() => {
    let counted = 0;
    let diffs = 0;
    let shortage = 0;
    let surplus = 0;
    for (const l of lines) {
      const d = diffOf(l);
      if ((values[l.id] ?? "").trim() !== "" && QTY_RE.test(values[l.id].trim())) counted += 1;
      if (d == null || d === 0) continue;
      diffs += 1;
      const cost = l.costPrice == null ? 0 : Number(l.costPrice);
      if (d < 0) shortage += -d * cost;
      else surplus += d * cost;
    }
    return { counted, diffs, shortage, surplus };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- diffOf only reads `values`
  }, [lines, values]);

  const q = query.trim().toLowerCase();
  const shown = lines.filter((l) => {
    if (q && !l.name.toLowerCase().includes(q) && !(l.code ?? "").toLowerCase().includes(q)) return false;
    if (view === "todo") return (values[l.id] ?? "").trim() === "";
    if (view === "diff") return (diffOf(l) ?? 0) !== 0;
    return true;
  });

  function setValue(id: string, v: string) {
    setValues((s) => ({ ...s, [id]: v }));
    setErrors((e) => {
      if (!e[id]) return e;
      const next = { ...e };
      delete next[id];
      return next;
    });
  }

  function save() {
    const entries = pendingEntries();
    if (entries.length === 0) return setNotice({ ok: true, text: "Өөрчлөлт алга." });
    setNotice(null);
    startTransition(async () => {
      const res = await saveStockCountLinesAction(countId, entries);
      if (res?.ok) {
        setSaved({ ...values });
        setErrors({});
        setNotice({ ok: true, text: res.message ?? "Хадгалагдлаа." });
      } else {
        setErrors(res?.fieldErrors ?? {});
        setNotice({ ok: false, text: res?.message ?? "Хадгалахад алдаа гарлаа." });
      }
    });
  }

  function complete() {
    setNotice(null);
    startTransition(async () => {
      const res = await completeStockCountAction(countId, pendingEntries());
      setConfirmOpen(false);
      if (res?.ok) {
        router.refresh();
      } else {
        setErrors(res?.fieldErrors ?? {});
        setNotice({ ok: false, text: res?.message ?? "Дуусгахад алдаа гарлаа." });
      }
    });
  }

  const tabs: Array<{ value: View; label: string; n: number }> = [
    { value: "all", label: "Бүгд", n: lines.length },
    { value: "todo", label: "Тоолоогүй", n: lines.length - summary.counted },
    { value: "diff", label: "Зөрүүтэй", n: summary.diffs },
  ];
  const th = "font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] font-medium px-3 py-2.5 whitespace-nowrap";
  const tdR = "px-3 py-2 text-right text-sm tabular-nums whitespace-nowrap";

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Тоолсон", value: `${summary.counted} / ${lines.length}` },
          { label: "Зөрүүтэй", value: String(summary.diffs) },
          { label: "Дутагдал (өртгөөр)", value: formatTugrik(summary.shortage), tone: summary.shortage ? "text-red-400 light:text-red-600" : "" },
          { label: "Илүүдэл (өртгөөр)", value: formatTugrik(summary.surplus), tone: summary.surplus ? "text-[var(--oc-ok)]" : "" },
        ].map((c) => (
          <div key={c.label} className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-4 py-3">
            <div className="text-xs text-[var(--oc-muted3)]">{c.label}</div>
            <div className={`text-lg font-semibold tabular-nums ${c.tone || "text-[var(--oc-ink)]"}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Нэр, код..."
          aria-label="Бараа хайх"
          className="compact-input w-56"
        />
        <div role="tablist" aria-label="Харах" className="inline-flex rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-0.5">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={view === t.value}
              onClick={() => setView(t.value)}
              className={`rounded-[8px] px-3 py-1.5 text-sm ${view === t.value ? "bg-[var(--oc-line)] text-[var(--oc-ink)] font-medium" : "text-[var(--oc-muted3)] hover:text-[var(--oc-ink)]"}`}
            >
              {t.label} <span className="ml-1 text-xs tabular-nums text-[var(--oc-muted3)]">{t.n}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {dirty.length > 0 ? <span className="text-xs text-[var(--oc-warn)]">{dirty.length} хадгалаагүй</span> : null}
          <Btn type="button" variant="ghost" size="md" disabled={pending} onClick={save}>
            Хадгалах
          </Btn>
          <Btn type="button" size="md" disabled={pending || summary.counted === 0} onClick={() => setConfirmOpen(true)}>
            Дуусгах
          </Btn>
        </div>
      </div>

      <div aria-live="polite" className="empty:hidden">
        {notice ? (
          <p
            role={notice.ok ? undefined : "alert"}
            className={`rounded-[10px] border px-4 py-2 text-sm ${notice.ok ? "border-[var(--oc-ok)]/25 bg-[var(--oc-ok)]/10 text-[var(--oc-ok)]" : "border-red-500/30 bg-red-500/10 text-red-400 light:text-red-600"}`}
          >
            {notice.text}
          </p>
        ) : null}
      </div>

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-auto flex-1 min-h-0">
        <table className="w-full min-w-[760px]">
          <thead className="sticky top-0 bg-[var(--oc-panel)] z-[1]">
            <tr className="border-b border-[var(--oc-line)]">
              <th className={`${th} text-left`}>Код</th>
              <th className={`${th} text-left`}>Нэр</th>
              <th className={`${th} text-right`}>Систем</th>
              <th className={`${th} text-right w-44`}>Тоолсон</th>
              <th className={`${th} text-right`}>Зөрүү</th>
              <th className={`${th} text-right`}>Зөрүү (өртгөөр)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--oc-line)]">
            {shown.map((l) => {
              const d = diffOf(l);
              const cost = l.costPrice == null ? null : Number(l.costPrice);
              const isDirty = (values[l.id] ?? "") !== (saved[l.id] ?? "");
              const err = errors[l.id] ?? ((values[l.id] ?? "").trim() !== "" && !QTY_RE.test(values[l.id].trim()) ? "Буруу тоо" : undefined);
              return (
                <tr key={l.id} className="hover:bg-white/[0.02]">
                  <td className="px-3 py-2 font-plex-mono text-xs text-[var(--oc-muted2)]">{l.code ?? "—"}</td>
                  <td className="px-3 py-2 text-sm text-[var(--oc-ink)]">{l.name}</td>
                  <td className={`${tdR} text-[var(--oc-ink2)]`}>{formatStock(l.systemQty, l.unit)}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        title="Системийн тоотой тэнцүү"
                        aria-label={`${l.name}: системийн тоотой тэнцүү`}
                        onClick={() => setValue(l.id, String(Number(l.systemQty)))}
                        className="h-8 w-8 shrink-0 rounded-lg border border-[var(--oc-line)] text-sm text-[var(--oc-muted3)] hover:text-[var(--oc-ink)] hover:border-[var(--oc-line2)]"
                      >
                        =
                      </button>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={values[l.id] ?? ""}
                        onChange={(e) => setValue(l.id, e.target.value)}
                        aria-label={`${l.name}: тоолсон тоо`}
                        aria-invalid={err ? true : undefined}
                        title={err}
                        placeholder="—"
                        className={`compact-input w-24 text-right tabular-nums ${err ? "border-red-500/60" : isDirty ? "border-[var(--oc-warn)]/60" : ""}`}
                      />
                    </div>
                  </td>
                  <td className={`${tdR} ${d == null || d === 0 ? "text-[var(--oc-muted3)]" : d < 0 ? "text-red-400 light:text-red-600" : "text-[var(--oc-ok)]"}`}>
                    {d == null ? "—" : d === 0 ? "0" : `${d > 0 ? "+" : "−"}${formatStock(Math.abs(d), l.unit)}`}
                  </td>
                  <td className={`${tdR} text-[var(--oc-ink2)]`}>
                    {d == null || d === 0 ? "—" : cost == null ? <span className="text-[var(--oc-muted4)]">өртөггүй</span> : `${d > 0 ? "+" : "−"}${formatTugrik(Math.abs(d) * cost)}`}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-[var(--oc-muted3)]">
                  Илэрц алга.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Тооллого дуусгах" widthClassName="max-w-md">
        <div className="flex flex-col gap-3 p-5 text-sm text-[var(--oc-ink2)]">
          <p>
            {summary.counted} / {lines.length} бараа тоолсон. <b className="text-[var(--oc-ink)]">{summary.diffs}</b> барааны үлдэгдэл зөрүүгээр
            засагдана (дутагдал {formatTugrik(summary.shortage)}, илүүдэл {formatTugrik(summary.surplus)}).
          </p>
          {summary.counted < lines.length ? (
            <p className="text-[var(--oc-warn)]">Тоолоогүй {lines.length - summary.counted} барааны үлдэгдэл өөрчлөгдөхгүй.</p>
          ) : null}
          <p className="text-xs text-[var(--oc-muted3)]">Дуусгасны дараа засах боломжгүй.</p>
          <div className="flex items-center gap-2 pt-1">
            <Btn type="button" size="md" disabled={pending} onClick={complete}>
              {pending ? "Дуусгаж байна…" : "Дуусгах"}
            </Btn>
            <Btn type="button" variant="ghost" size="md" onClick={() => setConfirmOpen(false)}>
              Болих
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
