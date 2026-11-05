"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { DatePicker } from "@/app/_components/date-picker";

/**
 * URL-н query string-аар жагсаалт шүүх — server component-ууд `searchParams`-аас
 * уншиж Prisma where-руу буулгана.
 */

type Option = { value: string; label: string; hint?: string };

function updateParam(
  params: URLSearchParams,
  key: string,
  value: string,
): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  if (value) next.set(key, value);
  else next.delete(key);
  // Хайлт солих үед хуудасны pagination-ыг тэгшилнэ
  next.delete("page");
  return next;
}

// Олон параметрийг нэг дор шинэчилнэ (нэг л навигаци хийхийн тулд).
function updateParams(
  params: URLSearchParams,
  entries: Record<string, string>,
): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  for (const [key, value] of Object.entries(entries)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  next.delete("page");
  return next;
}

export function SearchBox({
  placeholder = "Хайх...",
  paramName = "q",
  debounceMs = 300,
  className,
}: {
  placeholder?: string;
  paramName?: string;
  debounceMs?: number;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Объектын reference биш, ПРИМИТИВ string-ээс хамаарна. `useSearchParams()`
  // dev-д render бүрт шинэ reference буцаах боломжтой тул объектыг effect-ийн
  // dependency болгож болохгүй (тасралтгүй re-run → хүсэлтийн loop).
  const urlValue = searchParams.get(paramName) ?? "";

  const [value, setValue] = useState(urlValue);
  const [, startTransition] = useTransition();

  // Бид өөрсдөө хамгийн сүүлд URL-руу бичсэн утга. Гаднаас (reset товч,
  // шүүлтүүрийн линк) URL өөрчлөгдсөнийг өөрсдийн push-аас ялгахад хэрэглэнэ.
  const lastUrlValue = useRef(urlValue);

  // URL → input синк: ЗӨВХӨН URL утга үнэхээр өөрчлөгдсөн үед (объектын
  // reference солигдоход биш). Ингэснээр хэрэглэгчийн бичилттэй зөрчилдөхгүй.
  useEffect(() => {
    if (urlValue !== lastUrlValue.current) {
      lastUrlValue.current = urlValue;
      setValue(urlValue);
    }
  }, [urlValue]);

  // input → URL: debounce-той push. Утга URL-тэй ижил бол push хийхгүй.
  useEffect(() => {
    if (value === urlValue) return;
    const t = setTimeout(() => {
      lastUrlValue.current = value; // өөрийн push гэдгийг тэмдэглэнэ
      const next = updateParam(searchParams, paramName, value);
      startTransition(() => {
        router.push(`${pathname}?${next.toString()}`, { scroll: false });
      });
    }, debounceMs);
    return () => clearTimeout(t);
  }, [value, urlValue, debounceMs, paramName, pathname, router, searchParams]);

  return (
    <div className={`relative ${className ?? "flex-1 min-w-[10rem] sm:flex-none sm:w-56"}`}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--oc-muted4)] pointer-events-none"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="auth-input !py-1.5 !pl-9 !text-sm !rounded-lg"
      />
    </div>
  );
}

/**
 * Modern custom dropdown — native <select>-ийн оронд click-outside хаагдах,
 * сонгосон утга highlight-тай, dark theme-д тохирсон.
 */
export function FilterSelect({
  paramName,
  options,
  placeholder = "Бүгд",
  className,
  searchable = false,
  searchPlaceholder = "Хайх...",
  allowClear = true,
}: {
  paramName: string;
  options: Option[];
  placeholder?: string;
  className?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  // `false` үед "Бүгд" (цэвэрлэх) мөрийг жагсаалтаас хасна — заавал нэг утга
  // сонгогдсон байх ёстой шүүлтэд (жиш: он, "Бүх он" сонголтгүй).
  allowClear?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = searchParams.get(paramName) ?? "";
  const [, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label;
  const triggerText = selectedLabel || placeholder;

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Хаагдах үед хайлтын утгыг цэвэрлэнэ
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  function pick(v: string) {
    setOpen(false);
    if (v === value) return;
    const next = updateParam(searchParams, paramName, v);
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  const q = query.trim().toLowerCase();
  const filteredOptions =
    searchable && q
      ? options.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            o.hint?.toLowerCase().includes(q),
        )
      : options;

  const hasValue = Boolean(value);

  return (
    <div
      ref={wrapperRef}
      className={`relative shrink-0 ${className ?? ""}`}
      style={{ minWidth: "9rem" }}
    >
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          padding: "0.375rem 0.75rem",
          borderRadius: "0.5rem",
          border: `1px solid ${hasValue ? "var(--filter-active-border, rgba(139, 107, 255, 0.45))" : "var(--input-border)"}`,
          background: hasValue
            ? "var(--filter-active-bg, rgba(231, 76, 60, 0.18))"
            : "var(--input-bg)",
          color: hasValue ? "var(--accent-strong)" : "var(--input-fg)",
          fontSize: "0.875rem",
          cursor: "pointer",
          transition: "all 0.15s ease",
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: "left",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {triggerText}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transition: "transform 0.2s",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 50,
            marginTop: "0.25rem",
            width: "max-content",
            minWidth: "100%",
            maxWidth: "20rem",
            background: "var(--popover)",
            border: "1px solid var(--input-border)",
            borderRadius: "0.75rem",
            boxShadow: "0 20px 50px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0,0,0,0.4)",
            overflow: "hidden",
            padding: "0.25rem 0",
          }}
        >
          {searchable ? (
            <div style={{ padding: "0.25rem 0.5rem 0.375rem" }}>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                autoFocus
                style={{
                  width: "100%",
                  padding: "0.35rem 0.6rem",
                  borderRadius: "0.45rem",
                  border: "1px solid var(--input-border)",
                  background: "var(--input-bg)",
                  color: "var(--input-fg)",
                  fontSize: "0.8125rem",
                  outline: "none",
                }}
              />
            </div>
          ) : null}
          {allowClear ? (
            <DropdownOption
              label={placeholder}
              active={value === ""}
              onClick={() => pick("")}
              muted
            />
          ) : null}
          {allowClear && filteredOptions.length > 0 ? (
            <div
              style={{
                height: "1px",
                background: "var(--hover-bg)",
                margin: "0.125rem 0.5rem",
              }}
            />
          ) : null}
          <div style={{ maxHeight: "18rem", overflowY: "auto" }}>
            {filteredOptions.length === 0 ? (
              <div
                style={{
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.8125rem",
                  color: "var(--placeholder)",
                }}
              >
                Олдсонгүй
              </div>
            ) : (
              filteredOptions.map((o) => (
                <DropdownOption
                  key={o.value}
                  label={o.label}
                  hint={o.hint}
                  active={o.value === value}
                  onClick={() => pick(o.value)}
                />
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DropdownOption({
  label,
  hint,
  active,
  onClick,
  muted = false,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
  muted?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.5rem",
        padding: "0.4rem 0.75rem",
        textAlign: "left",
        fontSize: "0.875rem",
        background: active
          ? "var(--select-option-active-bg, rgba(139, 107, 255, 0.18))"
          : hover
            ? "var(--hover-bg)"
            : "transparent",
        color: active
          ? "var(--accent-strong)"
          : muted
            ? "var(--placeholder)"
            : "var(--input-fg)",
        cursor: "pointer",
        border: "none",
        transition: "background 0.1s ease",
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
        {hint ? (
          <span
            style={{
              marginLeft: "0.4rem",
              fontSize: "0.75rem",
              color: "var(--placeholder)",
            }}
          >
            {hint}
          </span>
        ) : null}
      </span>
      {active ? (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : null}
    </button>
  );
}

export function ResetFilters({
  paramNames,
}: {
  paramNames: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = paramNames.some((k) => searchParams.get(k));
  if (!active) return null;
  return (
    <button
      type="button"
      onClick={() => {
        const next = new URLSearchParams(searchParams.toString());
        for (const k of paramNames) next.delete(k);
        next.delete("page");
        router.push(`${pathname}?${next.toString()}`, { scroll: false });
      }}
      className="shrink-0 text-xs text-[var(--oc-muted3)] hover:text-[var(--oc-ink2)] underline underline-offset-2 whitespace-nowrap"
    >
      Цэвэрлэх
    </button>
  );
}

/**
 * Огнооны муж шүүлтүүр — `fromParam` / `toParam` (YYYY-MM-DD) query-г шинэчилнэ.
 * Хоёр утгыг нэг л навигациар хадгалахын тулд `updateParams`-ыг ашиглана.
 */
export function DateRangeFilter({
  fromParam = "dateFrom",
  toParam = "dateTo",
  label = "Огноо",
  className,
}: {
  fromParam?: string;
  toParam?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const from = searchParams.get(fromParam) ?? "";
  const to = searchParams.get(toParam) ?? "";

  function setRange(nextFrom: string, nextTo: string) {
    const next = updateParams(searchParams, {
      [fromParam]: nextFrom,
      [toParam]: nextTo,
    });
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  return (
    <div className={`relative flex shrink-0 items-center gap-1.5 ${className ?? ""}`}>
      <span className="text-xs text-[var(--oc-muted3)] shrink-0">{label}</span>
      <DatePicker
        mode="range"
        value={{ from, to }}
        onChange={(v) => setRange(v.from, v.to)}
        className="w-[14rem]"
      />
    </div>
  );
}
