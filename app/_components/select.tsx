"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SelectOption = {
  value: string;
  label: string;
  hint?: string;
};

// Латин үсгийг дуудлагаар нь кирилл болгоно — хэрэглэгч кирилл гаргүй үед
// улсын дугаарыг "1234uba" гэж бичдэг (≈ "1234УБА"). Хоёр талыг (хайлт ба
// бичлэг) ижил хөрвүүлдэг тул латин нэр ("Toyota") латинаар ч олдоно.
const LATIN_TO_CYRILLIC: Record<string, string> = {
  a: "а", b: "б", c: "ц", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и",
  j: "ж", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "к", r: "р",
  s: "с", t: "т", u: "у", v: "в", w: "в", x: "х", y: "у", z: "з",
};
// Гараас бичихэд андуурагддаг кирилл үсгийг нэгтгэнэ (ө≈о, ү≈у, э≈е).
const CYRILLIC_FOLD: Record<string, string> = { "ө": "о", "ү": "у", "э": "е", "ё": "е", "й": "и" };

/** Хайлтын харьцуулалтад: жижиг үсэг, зай/зураас/цэг хасна, латиныг кирилл болгоно. */
function foldSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\-_.()+]/g, "")
    .replace(/[a-z]/g, (ch) => LATIN_TO_CYRILLIC[ch] ?? ch)
    .replace(/[өүэёй]/g, (ch) => CYRILLIC_FOLD[ch] ?? ch);
}

/** Үг бүр (зайгаар тусгаарласан) label эсвэл hint-д агуулагдаж байвал таарна. */
export function matchesSelectQuery(option: SelectOption, query: string): boolean {
  const tokens = query.split(/\s+/).map(foldSearch).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = foldSearch(`${option.label} ${option.hint ?? ""}`);
  return tokens.every((t) => haystack.includes(t));
}

// Олон мянган бичлэгтэй үед DOM-ыг хүндрүүлэхгүй — эхний N-ийг харуулж,
// үлдсэнийг "нарийвчлан бичнэ үү" гэж мэдэгдэнэ.
const MAX_VISIBLE_OPTIONS = 100;
/** Жагсаалтын дээд өндөр — 16rem. */
const LIST_MAX_HEIGHT = 256;

/**
 * Form-д зориулсан modern dropdown — native <select>-ийн оронд.
 * Hidden input-ээр form submission-д утга илгээнэ. Click-outside + ESC
 * хаагдана. Дотоод state ашиглах ч boldог (`value` prop-гүй үед) — энэ
 * тохиолдолд `defaultValue` ажиллана.
 *
 * Жагсаалтыг `document.body`-руу portal хийж `position: fixed`-ээр
 * байрлуулна (button-ийн bounding rect-ээр тооцно) — эцэг element
 * `overflow-hidden/auto` (жишээ нь modal.tsx-ийн scroll хийдэг content) байсан
 * ч жагсаалт таслагдахгүй/нуугдахгүй байхын тулд (харах: notification-bell.tsx
 * ижил зарчим).
 */
export function Select({
  name,
  options,
  value: controlledValue,
  defaultValue,
  onChange,
  placeholder = "— Сонгох —",
  error,
  required,
  disabled,
  id,
  ariaInvalid,
  clearable = false,
  clearLabel = "Цэвэрлэх",
  searchable = false,
  searchPlaceholder = "Бичиж хайх…",
}: {
  name: string;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  ariaInvalid?: boolean;
  /** Сонгосон утгыг × товчоор арилгах боломж (`required` талбарт ч — буруу
   * сонголтыг цэвэрлэж дахин сонгоход). */
  clearable?: boolean;
  clearLabel?: string;
  /** Нээхэд талбарт шууд бичиж жагсаалтыг шүүнэ (↑/↓, Enter, Esc). Хаалттай
   * үед товч дээр үсэг бичихэд ч нээгдэж хайлт эхэлнэ. */
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const isControlled = controlledValue !== undefined;
  const [internalValue, setInternalValue] = useState<string>(
    defaultValue ?? "",
  );
  const value = isControlled ? (controlledValue as string) : internalValue;

  const [open, setOpen] = useState(false);
  // Доош багтахгүй (хүснэгтийн сүүлийн мөр, дэлгэцийн доод хэсэг) бол дээш
  // нээнэ — `bottom`-оор байрлуулж, өндрийг боломжит зайгаар хязгаарлана.
  const [pos, setPos] = useState<
    | { top?: number; bottom?: number; left: number; width: number; maxHeight: number }
    | null
  >(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searching = searchable && open;
  const filtered = searching && query.trim()
    ? options.filter((o) => matchesSelectQuery(o, query))
    : options;
  const visible = filtered.slice(0, MAX_VISIBLE_OPTIONS);
  const hiddenCount = filtered.length - visible.length;

  function updatePosition() {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    // Жагсаалтын өндрийн ойролцоо тооцоо (мөр ~36px + padding), 16rem хүртэл.
    const rowCount = Math.min(options.length, MAX_VISIBLE_OPTIONS) + (required ? 0 : 1);
    const wanted = Math.min(LIST_MAX_HEIGHT, Math.max(rowCount, 1) * 36 + 8);
    const below = window.innerHeight - r.bottom - gap - margin;
    const above = r.top - gap - margin;
    if (below < wanted && above > below) {
      setPos({
        bottom: window.innerHeight - r.top + gap,
        left: r.left,
        width: r.width,
        maxHeight: Math.min(LIST_MAX_HEIGHT, above),
      });
    } else {
      setPos({
        top: r.bottom + gap,
        left: r.left,
        width: r.width,
        maxHeight: Math.min(LIST_MAX_HEIGHT, Math.max(below, 120)),
      });
    }
  }

  function openList(initialQuery = "") {
    if (disabled) return;
    updatePosition();
    setQuery(initialQuery);
    // Хайлтгүй нээхэд одоогийн сонголт дээр, хайлттай бол эхний үр дүн дээр.
    const current = initialQuery ? -1 : options.findIndex((o) => o.value === value);
    setActiveIndex(current >= 0 ? current : 0);
    setOpen(true);
  }

  function closeList() {
    setOpen(false);
    setQuery("");
  }

  function toggle() {
    if (disabled) return;
    if (open) closeList();
    else openList();
  }

  function moveActive(delta: number) {
    if (visible.length === 0) return;
    setActiveIndex((i) => (i + delta + visible.length) % visible.length);
  }

  // Хаалттай товч дээр үсэг бичвэл нээж, тэр үсгээр хайлт эхлүүлнэ.
  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (!searchable || open || disabled) return;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ") {
      e.preventDefault();
      openList(e.key);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      openList();
    }
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Enter") {
      // Form submit болохоос сэргийлнэ — идэвхтэй мөрийг сонгоно.
      e.preventDefault();
      const option = visible[activeIndex];
      if (option) pick(option.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeList();
      btnRef.current?.focus();
    } else if (e.key === "Tab") {
      closeList();
    }
  }

  // Идэвхтэй мөрийг харагдах хэсэгт байлгана.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (
        btnRef.current?.contains(t) ||
        listRef.current?.contains(t) ||
        searchRef.current?.contains(t)
      ) return;
      setOpen(false);
      setQuery("");
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
    function onReflow() {
      updatePosition();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open]);

  function pick(v: string) {
    setOpen(false);
    setQuery("");
    if (!isControlled) setInternalValue(v);
    onChange?.(v);
  }

  const hasError = Boolean(error) || ariaInvalid;
  const showClear = clearable && !disabled && value !== "";

  return (
    <div style={{ position: "relative", width: "100%" }}>
      {/* Hidden field carries value to FormData */}
      <input type="hidden" name={name} value={value} />

      {/* .auth-input class-аар текст input-той яг ижил өндөр/өргөн/border-radius —
          нэг стандарт хэлбэр (харах: globals.css). Зөвхөн flex layout + сонгогдоогүй
          үеийн бүдэг өнгийг энд нэмнэ. */}
      <button
        ref={btnRef}
        type="button"
        id={id}
        onClick={toggle}
        onKeyDown={onTriggerKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={hasError || undefined}
        aria-required={required || undefined}
        className={`auth-input flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
          hasError ? "border-red-500/50" : ""
        }`}
        style={{
          color: selected ? "var(--input-fg)" : "var(--placeholder)",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            // × товчны зай (chevron-ий зүүн талд байрлана).
            ...(showClear ? { paddingRight: "1.75rem" } : {}),
            // Хайлтын input (хагас тунгалаг дэвсгэртэй) дээр давхарлан харагдахгүй.
            ...(searching ? { visibility: "hidden" as const } : {}),
          }}
        >
          {selected ? selected.label : placeholder}
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
            opacity: 0.5,
            transition: "transform 0.2s",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Хайлт: нээлттэй үед товчны яг дээр ижил хэмжээтэй input давхарлана —
          хэрэглэгч талбарт шууд бичиж байгаа мэт. */}
      {searching ? (
        <input
          ref={searchRef}
          type="text"
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls={id ? `${id}-listbox` : undefined}
          aria-autocomplete="list"
          aria-label={searchPlaceholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onSearchKeyDown}
          placeholder={selected ? selected.label : searchPlaceholder}
          autoComplete="off"
          className="auth-input"
          style={{ position: "absolute", inset: 0, zIndex: 1 }}
        />
      ) : null}

      {/* Товч доторх товч хүчингүй тул × нь тусдаа, chevron-ий зүүн талд. */}
      {showClear && !searching ? (
        <button
          type="button"
          onClick={() => {
            pick("");
            btnRef.current?.focus();
          }}
          aria-label={clearLabel}
          title={clearLabel}
          className="text-[var(--placeholder)] hover:text-[var(--input-fg)] hover:bg-[var(--hover-bg)]"
          style={{
            position: "absolute",
            top: "50%",
            right: "2.25rem",
            transform: "translateY(-50%)",
            width: "1.5rem",
            height: "1.5rem",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "9999px",
            transition: "color 0.15s, background 0.15s",
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      ) : null}

      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <div className="landing-ops">
              <div
                ref={listRef}
                role="listbox"
                id={id ? `${id}-listbox` : undefined}
                style={{
                  position: "fixed",
                  zIndex: 200,
                  top: pos.top,
                  bottom: pos.bottom,
                  left: pos.left,
                  width: pos.width,
                  background: "var(--popover)",
                  border: "1px solid var(--input-border)",
                  borderRadius: "0.625rem",
                  boxShadow: "0 20px 50px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0,0,0,0.4)",
                  overflow: "hidden",
                  padding: "0.25rem 0",
                  maxHeight: pos.maxHeight,
                  overflowY: "auto",
                }}
              >
                {!required && !query.trim() ? (
                  <SelectOptionRow
                    label={placeholder}
                    active={value === ""}
                    onClick={() => pick("")}
                    muted
                  />
                ) : null}
                {visible.map((o, i) => (
                  <SelectOptionRow
                    key={o.value}
                    index={i}
                    label={o.label}
                    hint={o.hint}
                    active={o.value === value}
                    highlighted={searching && i === activeIndex}
                    onClick={() => pick(o.value)}
                  />
                ))}
                {searching && filtered.length === 0 ? (
                  <div style={{ padding: "0.6rem 0.75rem", fontSize: "0.8125rem", color: "var(--placeholder)" }}>
                    Олдсонгүй
                  </div>
                ) : null}
                {hiddenCount > 0 ? (
                  <div style={{ padding: "0.45rem 0.75rem", fontSize: "0.75rem", color: "var(--placeholder)" }}>
                    +{hiddenCount} бичлэг — нарийвчлан бичиж хайна уу
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function SelectOptionRow({
  label,
  hint,
  active,
  onClick,
  muted = false,
  index,
  highlighted = false,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
  muted?: boolean;
  index?: number;
  highlighted?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      data-index={index}
      // Хайлтын input-аас focus авахгүй.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.5rem",
        padding: "0.45rem 0.75rem",
        textAlign: "left",
        fontSize: "0.875rem",
        background: active
          ? "var(--select-option-active-bg, rgba(139, 107, 255, 0.18))"
          : hover || highlighted
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
      <div
        style={{
          flex: 1,
          minWidth: 0,
        }}
      >
        <div
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </div>
        {hint ? (
          <div
            style={{
              fontSize: "0.75rem",
              color: "var(--placeholder)",
              marginTop: "0.125rem",
            }}
          >
            {hint}
          </div>
        ) : null}
      </div>
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
