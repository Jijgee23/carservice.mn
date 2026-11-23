"use client";

import { useState } from "react";
import Link from "next/link";

export type PlanCardData = {
  key: string;
  name: string;
  desc: string;
  cta: string;
  href: string;
  highlighted: boolean;
  price: string;
  period: string;
  features: string[];
};

const INITIAL_VISIBLE_COUNT = 5;

export function PricingCards({ plans }: { plans: PlanCardData[] }) {
  const [expanded, setExpanded] = useState(false);

  // Аль нэг карт 5-аас олон боломжтой эсэхийг шалгах
  const hasMoreFeatures = plans.some((p) => p.features.length > INITIAL_VISIBLE_COUNT);

  return (
    <div className="grid items-stretch gap-6 lg:grid-cols-3">
      {plans.map((p) => {
        const visibleFeatures = expanded
          ? p.features
          : p.features.slice(0, INITIAL_VISIBLE_COUNT);
        const hiddenCount = p.features.length - INITIAL_VISIBLE_COUNT;

        return (
          <div
            key={p.key}
            className={
              p.highlighted
                ? "flex h-full flex-col rounded-[10px] border border-[var(--oc-accent)] bg-[var(--oc-panel2)] px-8 py-[30px] shadow-[0_24px_60px_-30px_rgba(192,57,43,0.3)]"
                : "flex h-full flex-col rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] px-8 py-[30px]"
            }
          >
            {/* Дээд хэсэг: Гарчиг болон Badge */}
            <div className="flex items-center justify-between gap-2">
              <div className="text-[18px] font-semibold text-[var(--oc-ink2)]">{p.name}</div>
              {p.highlighted ? (
                <span className="shrink-0 rounded bg-[var(--oc-accent)] px-2.5 py-1 font-plex-mono text-[11.5px] tracking-[0.06em] text-[var(--oc-on-accent)]">
                  ХАМГИЙН ТОХИРОМЖТОЙ
                </span>
              ) : null}
            </div>

            {/* Тайлбар */}
            <div className="mt-1.5 min-h-[42px] text-[14px] text-[var(--oc-muted2)]">{p.desc}</div>

            {/* Үнэ */}
            <div className="mt-[22px] font-plex-mono text-[32px] font-semibold text-[var(--oc-ink)]">
                {/* Захиалгат */}
              {p.price} 
              {p.period ? (
                <span className="text-[15px] font-normal text-[var(--oc-muted3)]"> {p.period}</span>
              ) : null}
            </div>

            {/* CTA Товч */}
            <Link
              href={p.href}
              className={
                p.highlighted
                  ? "mt-[26px] block rounded-lg bg-[var(--oc-accent)] py-3 text-center text-[14.5px] font-semibold text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)]"
                  : "mt-[26px] block rounded-lg border border-[var(--oc-line)] py-3 text-center text-[14.5px] font-semibold text-[var(--oc-ink2)] hover:border-[var(--oc-muted4)] hover:bg-[var(--oc-panel2)]"
              }
            >
              {/* {p.cta} */} 30 хоног үнэгүй турших
            </Link>

            {/* Боломжуудын жагсаалт (flex-1 нь үлдсэн зайг дүүргэж товчийг доор тэгшилнэ) */}
            <ul className="mt-[22px] flex flex-1 flex-col gap-2.5 text-[14.5px]">
              {visibleFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2 text-[var(--oc-muted)]">
                  <span className="mt-0.5 text-[var(--oc-accent)]">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {/* Expand / Collapse товч */}
            {hasMoreFeatures ? (
              <div className="mt-auto border-t border-[var(--oc-line)] pt-4 first:mt-6">
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => !prev)}
                  aria-expanded={expanded}
                  className="flex w-full items-center justify-between text-[13.5px] font-medium text-[var(--oc-muted2)] transition-colors hover:text-[var(--oc-ink)]"
                >
                  <span>
                    {expanded
                      ? "Хураах"
                      : hiddenCount > 0
                        ? `Бүх боломжийг харах (+${hiddenCount})`
                        : "Бүх боломжийг харах"}
                  </span>
                  <span
                    className={`text-[12px] transition-transform duration-300 ease-out ${
                      expanded ? "rotate-180" : "rotate-0"
                    }`}
                  >
                    ▼
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}