"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";

const links = [
  { href: "/discover", label: "Засварын газар хайх" },
  { href: "#boloms", label: "Боломжууд" },
  { href: "#hows", label: "Хэрхэн ажилладаг" },
  { href: "#price", label: "Үнэ" },
  { href: "#faq", label: "Асуулт хариулт" },
];

export function Nav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--oc-line2)] bg-[var(--oc-carbon)]/90 backdrop-blur">
      <div className="max-w-[1240px] mx-auto">
        <div className="flex items-center justify-between h-14 px-4 sm:px-6 lg:px-8">
          <Link href="/">
            <Brand />
          </Link>

          <nav className="hidden lg:flex items-center gap-5 xl:gap-8 text-[14px] whitespace-nowrap text-[var(--oc-muted)]">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="hover:text-[var(--oc-accent-hi)] transition-colors"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="hidden lg:flex items-center gap-2">
            <ThemeToggle variant="icon" />
            <Link
              href="/page/login"
              className="text-[14px] text-[var(--oc-ink2)] hover:text-[var(--oc-accent-hi)] transition-colors px-3 py-2"
            >
              Нэвтрэх
            </Link>
            <Link
              href="/page/signup"
              className="text-[14px] font-semibold rounded-md bg-[var(--oc-accent)] px-[18px] py-2.5 text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)] transition-colors"
            >
              Бүртгүүлэх
            </Link>
          </div>

          <div className="flex lg:hidden items-center gap-2">
            <ThemeToggle variant="icon" />
            <button
              type="button"
              aria-label={open ? "Цэс хаах" : "Цэс нээх"}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="w-10 h-10 rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel)] flex items-center justify-center"
            >
              <span className="block w-5 h-0.5 bg-[var(--oc-ink2)] relative">
                <span
                  className={`absolute left-0 w-5 h-0.5 bg-[var(--oc-ink2)] transition-transform ${
                    open ? "rotate-45 top-0" : "-top-1.5"
                  }`}
                />
                <span
                  className={`absolute left-0 w-5 h-0.5 bg-[var(--oc-ink2)] transition-transform ${
                    open ? "-rotate-45 top-0" : "top-1.5"
                  }`}
                />
              </span>
            </button>
          </div>
        </div>

        {open ? (
          <div className="lg:hidden border-t border-[var(--oc-line2)]">
            <div className="px-3 py-3 flex flex-col gap-1">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="px-3 py-3 rounded-lg text-base font-medium text-[var(--oc-ink2)] hover:bg-[var(--oc-panel)]"
                >
                  {l.label}
                </Link>
              ))}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Link
                  href="/page/login"
                  onClick={() => setOpen(false)}
                  className="h-11 inline-flex items-center justify-center rounded-lg border border-[var(--oc-line)] bg-[var(--oc-panel)] text-sm font-medium text-[var(--oc-ink2)]"
                >
                  Нэвтрэх
                </Link>
                <Link
                  href="/page/signup"
                  onClick={() => setOpen(false)}
                  className="h-11 inline-flex items-center justify-center rounded-lg bg-[var(--oc-accent)] text-sm font-semibold text-[var(--oc-on-accent)]"
                >
                  Бүртгүүлэх
                </Link>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
