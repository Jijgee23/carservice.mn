"use client";

import { useEffect, useState } from "react";

const SunIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

const MoonIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

/**
 * Light/Dark theme toggle. Theme нь <html>-ийн `light` class-аар тодорхойлогдоно
 * (default light — app/layout.tsx). Сонголтыг localStorage-д хадгална. Анхны төлвийг mount-ийн
 * дараа DOM-оос уншиж hydration зөрчлөөс сэргийлнэ.
 */
export function ThemeToggle({
  variant = "full",
}: {
  variant?: "full" | "icon";
}) {
  const [light, setLight] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLight(document.documentElement.classList.contains("light"));
    setReady(true);
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    const el = document.documentElement;
    el.classList.toggle("light", next);
    try {
      localStorage.setItem("theme", next ? "light" : "dark");
    } catch {
      // localStorage хаалттай байж болно — алгасна
    }
  }

  const label = light ? "Бараан горим" : "Гэрэлт горим";

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        title={label}
        className="p-2 rounded-lg text-[var(--oc-muted)] hover:text-[var(--oc-ink)] hover:bg-white/[0.06] transition-colors"
      >
        {ready ? (light ? MoonIcon : SunIcon) : SunIcon}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      className="w-full flex items-center gap-3 text-sm text-[var(--oc-muted)] hover:text-[var(--oc-ink)] transition-colors px-3 py-2 rounded-xl hover:bg-white/[0.04] text-left"
    >
      <span className="text-[var(--oc-muted3)]">
        {ready ? (light ? MoonIcon : SunIcon) : SunIcon}
      </span>
      {ready ? label : "Горим"}
    </button>
  );
}
