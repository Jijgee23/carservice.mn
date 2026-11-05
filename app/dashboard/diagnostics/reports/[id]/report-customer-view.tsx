"use client";

// Үйлчлүүлэгчийн (account) тайлангийн харагдац — ReportAnswers-ийн `toneFilter`
// горим. Ажилтны дэлгэрэнгүйгээс ялгаатай нь: дээр нь ерөнхий дүгнэлт
// (өнгөний харьцаа + анхаарах зүйлсийн жагсаалт), хэсэг бүр асуудалгүй бол
// хураагдсан, item бүр нэг мөрөнд (нэр ← → үр дүн) — урт тайланг богиносгоно.
import { useMemo, useState } from "react";
import {
  CHECK_TONE_ACTIVE,
  CHECK_TONES,
  CHECK_TONE_LABEL,
  checkOptionTone,
  itemPositions,
  positionedKey,
  type CheckTone,
  type ReportData,
  type ReportEntry,
  type TemplateItem,
  type TemplateSchema,
} from "@/lib/diagnostics";

type Field = { key: string; posLabel: string | null; entry: ReportEntry; tone: CheckTone | null };
type Row = { item: TemplateItem; fields: Field[] };
type Section = { id: string; title: string; rows: Row[]; counts: Record<CheckTone, number> };

const TONE_BAR: Record<CheckTone, string> = { good: "bg-emerald-500", warn: "bg-amber-400", bad: "bg-red-500" };
const TONE_TEXT: Record<CheckTone, string> = {
  good: "text-emerald-400 light:text-emerald-600",
  warn: "text-amber-400 light:text-amber-600",
  bad: "text-red-400 light:text-red-600",
};
const TONE_EDGE: Record<CheckTone, string> = { good: "border-l-emerald-500", warn: "border-l-amber-400", bad: "border-l-red-500" };

function buildSections(schema: TemplateSchema, data: ReportData): Section[] {
  return schema.sections.map((section) => {
    const counts: Record<CheckTone, number> = { good: 0, warn: 0, bad: 0 };
    const rows: Row[] = section.items.map((item) => {
      const positions = itemPositions(item);
      const defs = positions
        ? positions.map((p) => ({ key: positionedKey(item.id, p.code), posLabel: p.label as string | null }))
        : [{ key: item.id, posLabel: null }];
      const fields = defs.map(({ key, posLabel }) => {
        const entry = data[key] ?? {};
        const v = entry.value;
        const tone = item.type === "check" && typeof v === "string" && v !== "" ? checkOptionTone(v) : null;
        if (tone) counts[tone] += 1;
        return { key, posLabel, entry, tone };
      });
      return { item, fields };
    });
    return { id: section.id, title: section.title, rows, counts };
  });
}

export function ReportCustomerView({ schema, data }: { schema: TemplateSchema; data: ReportData }) {
  const sections = useMemo(() => buildSections(schema, data), [schema, data]);
  const [tone, setTone] = useState<CheckTone | null>(null);

  const totals = useMemo(() => {
    const t: Record<CheckTone, number> = { good: 0, warn: 0, bad: 0 };
    for (const s of sections) for (const k of CHECK_TONES) t[k] += s.counts[k];
    return t;
  }, [sections]);
  const total = totals.good + totals.warn + totals.bad;

  const issues = useMemo(
    () =>
      sections.flatMap((s) =>
        s.rows.flatMap((r) =>
          r.fields
            .filter((f) => f.tone === "bad" || f.tone === "warn")
            .map((f) => ({ section: s.title, item: r.item, field: f })),
        ),
      ).sort((a, b) => (a.field.tone === b.field.tone ? 0 : a.field.tone === "bad" ? -1 : 1)),
    [sections],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Ерөнхий дүгнэлт */}
      {total > 0 ? (
        <section className="rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[var(--oc-ink)]">Ерөнхий дүгнэлт</h2>
            <span className="text-xs text-[var(--oc-muted3)]">{total} шалгалт</span>
          </div>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-[var(--oc-panel2)]" aria-hidden>
            {CHECK_TONES.map((t) =>
              totals[t] > 0 ? <div key={t} className={TONE_BAR[t]} style={{ width: `${(totals[t] / total) * 100}%` }} /> : null,
            )}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
            {CHECK_TONES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTone(tone === t ? null : t)}
                aria-pressed={tone === t}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  tone === t
                    ? CHECK_TONE_ACTIVE[t]
                    : "border-[var(--oc-line)] bg-[var(--oc-panel2)] hover:border-[var(--oc-muted4)]"
                }`}
              >
                <div className="flex items-center gap-1.5 text-[11px] text-[var(--oc-muted3)]">
                  <span className={`h-2 w-2 rounded-full ${TONE_BAR[t]}`} />
                  {CHECK_TONE_LABEL[t]}
                </div>
                <div className={`mt-0.5 text-xl font-bold tabular-nums ${totals[t] > 0 && t !== "good" ? TONE_TEXT[t] : "text-[var(--oc-ink)]"}`}>
                  {totals[t]}
                </div>
              </button>
            ))}
          </div>

          {issues.length === 0 ? (
            <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-400 light:text-emerald-700">
              <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Шалгасан бүх зүйл хэвийн байна.
            </div>
          ) : (
            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--oc-muted3)]">
                Анхаарах зүйлс · {issues.length}
              </div>
              <ul className="flex flex-col gap-2">
                {issues.map(({ section, item, field }) => (
                  <li
                    key={field.key}
                    className={`rounded-xl border border-[var(--oc-line)] border-l-4 ${TONE_EDGE[field.tone!]} bg-[var(--oc-panel2)] px-3.5 py-2.5`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--oc-ink)]">
                          {item.label}
                          {field.posLabel ? <span className="text-[var(--oc-muted)]"> · {field.posLabel}</span> : null}
                        </div>
                        <div className="text-[11px] text-[var(--oc-muted3)]">{section}</div>
                      </div>
                      <ToneBadge value={String(field.entry.value)} />
                    </div>
                    <Extras entry={field.entry} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : null}

      {tone ? (
        <div className="no-print flex items-center gap-2 text-sm text-[var(--oc-muted)]">
          Зөвхөн <b className={TONE_TEXT[tone]}>{CHECK_TONE_LABEL[tone]}</b> харуулж байна
          <button type="button" onClick={() => setTone(null)} className="text-xs font-semibold text-[var(--oc-accent)] hover:underline">
            Бүгдийг харах
          </button>
        </div>
      ) : null}

      {sections.map((s) => {
        const rows = tone
          ? s.rows
              .map((r) => ({ ...r, fields: r.fields.filter((f) => f.tone === tone) }))
              .filter((r) => r.fields.length > 0)
          : s.rows;
        if (rows.length === 0) return null;
        const hasIssue = s.counts.warn + s.counts.bad > 0;
        const checks = s.counts.good + s.counts.warn + s.counts.bad;
        return (
          <details
            key={`${s.id}-${tone ?? "all"}`}
            open={tone !== null || hasIssue || checks === 0}
            className="group overflow-hidden rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)]"
          >
            <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5 hover:bg-[var(--oc-panel2)] [&::-webkit-details-marker]:hidden">
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--oc-ink)]">{s.title}</h2>
              <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium">
                {s.counts.bad > 0 ? <span className={`rounded-full px-2 py-0.5 ${CHECK_TONE_ACTIVE.bad}`}>{s.counts.bad} солих</span> : null}
                {s.counts.warn > 0 ? <span className={`rounded-full px-2 py-0.5 ${CHECK_TONE_ACTIVE.warn}`}>{s.counts.warn} анхаарах</span> : null}
                {!hasIssue && checks > 0 ? (
                  <span className="text-emerald-400 light:text-emerald-600">✓ {checks} хэвийн</span>
                ) : null}
              </span>
              <svg className="h-4 w-4 shrink-0 text-[var(--oc-muted3)] transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <ul className="grid border-t border-[var(--oc-line)] md:grid-cols-2 md:divide-x-0">
              {rows.map(({ item, fields }) => (
                <li key={item.id} className="border-b border-[var(--oc-line2)] px-5 py-2.5 md:odd:border-r">
                  {fields.length === 1 && fields[0].posLabel === null ? (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-[var(--oc-ink2)]">{item.label}</span>
                        <Value item={item} entry={fields[0].entry} />
                      </div>
                      <Extras entry={fields[0].entry} />
                    </>
                  ) : (
                    <>
                      <div className="text-sm text-[var(--oc-ink2)]">{item.label}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {fields.map((f) => (
                          <span key={f.key} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel2)] py-0.5 pl-2 pr-0.5 text-[11px] text-[var(--oc-muted)]">
                            {f.posLabel}
                            <Value item={item} entry={f.entry} />
                          </span>
                        ))}
                      </div>
                      {fields.map((f) => (
                        <Extras key={f.key} entry={f.entry} label={f.posLabel} />
                      ))}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

function ToneBadge({ value }: { value: string }) {
  return (
    <span className={`inline-block shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${CHECK_TONE_ACTIVE[checkOptionTone(value)]}`}>
      {value}
    </span>
  );
}

function Value({ item, entry }: { item: TemplateItem; entry: ReportEntry }) {
  const v = entry.value;
  if (v === undefined || v === "" || v === null) return <span className="text-sm text-[var(--oc-muted4)]">—</span>;
  if (item.type === "signature") {
    return typeof v === "string" ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={v} alt="Гарын үсэг" className="h-12 w-28 rounded-md border border-[var(--oc-line)] bg-[#fff] object-contain" />
    ) : null;
  }
  if (typeof v === "boolean") return <span className="text-sm font-medium text-[var(--oc-ink)]">{v ? "Тийм" : "Үгүй"}</span>;
  if (item.type === "check" && typeof v === "string") return <ToneBadge value={v} />;
  return <span className="text-right text-sm font-medium text-[var(--oc-ink)]">{String(v)}</span>;
}

function Extras({ entry, label }: { entry: ReportEntry; label?: string | null }) {
  const hasPhotos = entry.photos && entry.photos.length > 0;
  if (!entry.note && !hasPhotos) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {entry.note ? (
        <div className="text-xs italic text-[var(--oc-muted)]">
          {label ? `${label}: ` : ""}
          {entry.note}
        </div>
      ) : null}
      {hasPhotos ? (
        <div className="flex flex-wrap gap-2">
          {entry.photos!.map((p, idx) => (
            <a key={idx} href={p} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt="" className="h-20 w-20 rounded-lg border border-[var(--oc-line)] object-cover" />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
