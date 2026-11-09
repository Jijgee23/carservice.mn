"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { NotificationItem } from "@/lib/notifications";
import { bookingDateKey } from "@/lib/booking-time";

// Realm-agnostic мэдэгдэлийн хонх — server action-уудыг prop-оор авна (ажилтан ба
// Account layout тус бүр өөрийн action-уудыг дамжуулна). lib/push энд орохгүй.

const POLL_MS = 45_000;
const PANEL_W = 368; // w-[23rem]

type Props = {
  initialUnread: number;
  getUnreadCount: () => Promise<number>;
  getRecent: () => Promise<NotificationItem[]>;
  markRead: (id: string) => Promise<number>;
  markAllRead: () => Promise<number>;
  historyHref: string;
  // Dropdown-ийн тэгшлэлт. Зүүн талын sidebar-д "left" (баруун тийш нээгдэнэ),
  // баруун талын header/topbar-д "right" (default).
  align?: "left" | "right";
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "саяхан";
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} цаг`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} өдөр`;
  return new Date(iso).toLocaleDateString("mn-MN", {
    month: "short",
    day: "2-digit",
    timeZone: "Asia/Ulaanbaatar",
  });
}

// ---- Төрлөөр дүрс/өнгө ----------------------------------------------------

type Visual = { icon: ReactNode; tone: string };

const svg = (d: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const ICONS = {
  calendar: svg(<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>),
  wrench: svg(<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />),
  money: svg(<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>),
  star: svg(<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />),
  shield: svg(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />),
  crown: svg(<path d="m2 7 5 5 5-7 5 7 5-5-2 12H4L2 7z" />),
  message: svg(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />),
  megaphone: svg(<><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>),
  file: svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>),
  bell: svg(<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></>),
};

const TONE = {
  accent: "bg-[var(--oc-accent)]/15 text-[var(--oc-accent)]",
  sky: "bg-sky-500/15 text-sky-300 light:text-sky-700",
  ok: "bg-emerald-500/15 text-emerald-300 light:text-emerald-700",
  warn: "bg-amber-500/15 text-amber-300 light:text-amber-700",
  danger: "bg-red-500/15 text-red-300 light:text-red-700",
  violet: "bg-violet-500/15 text-violet-300 light:text-violet-700",
  neutral: "bg-white/[0.06] text-[var(--oc-muted2)] light:bg-black/[0.05]",
};

const NEGATIVE = /(cancelled|rejected|no_show|expired|blocked)$/;

/** Мэдэгдлийн төрлөөр дүрс, өнгө. Мэдэгдээгүй төрөл → хонх. */
export function notificationVisual(type: string): Visual {
  const negative = NEGATIVE.test(type);
  if (type === "order_payment_received" || type === "appointment_fee_paid") return { icon: ICONS.money, tone: TONE.ok };
  if (type.startsWith("appointment_")) return { icon: ICONS.calendar, tone: negative ? TONE.danger : TONE.sky };
  if (type.startsWith("order_") || type === "expected_finish_revised" || type === "service_reminder")
    return { icon: ICONS.wrench, tone: negative ? TONE.danger : TONE.accent };
  if (type === "review_received") return { icon: ICONS.star, tone: TONE.warn };
  if (type.startsWith("credit_")) return { icon: ICONS.shield, tone: type === "credit_unblocked" ? TONE.ok : TONE.danger };
  if (type.startsWith("subscription_") || type.startsWith("tenant_")) return { icon: ICONS.crown, tone: TONE.violet };
  if (type.startsWith("feedback_")) return { icon: ICONS.message, tone: TONE.accent };
  if (type.startsWith("broadcast_")) return { icon: ICONS.megaphone, tone: TONE.violet };
  if (type.startsWith("quote_request")) return { icon: ICONS.file, tone: TONE.sky };
  return { icon: ICONS.bell, tone: TONE.neutral };
}

/** Өдрөөр бүлэглэх шошго (Улаанбаатарын цагаар). */
function dayGroup(iso: string, todayKey: string, yesterdayKey: string): string {
  const key = bookingDateKey(new Date(iso));
  if (key === todayKey) return "Өнөөдөр";
  if (key === yesterdayKey) return "Өчигдөр";
  return "Өмнө";
}

export function NotificationBell({
  initialUnread,
  getUnreadCount,
  getRecent,
  markRead,
  markAllRead,
  historyHref,
  align = "right",
}: Props) {
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Overlay-г <body> руу portal хийнэ — topbar-ийн glass (backdrop-filter)
  // stacking/containing context-оос мултлахын тулд. Desktop: bell-д тулгасан
  // dropdown (координат хэмжинэ). Mobile: доод sheet.
  const [isMobile, setIsMobile] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function updatePosition() {
    const el = triggerRef.current;
    if (!el || typeof window === "undefined") return;
    const r = el.getBoundingClientRect();
    const mobile = window.innerWidth < 640;
    setIsMobile(mobile);
    if (mobile) {
      setPos(null);
      return;
    }
    let left = align === "left" ? r.left : r.right - PANEL_W;
    left = Math.min(left, window.innerWidth - PANEL_W - 8);
    left = Math.max(8, left);
    setPos({ top: r.bottom + 8, left });
  }

  // Уншаагүй тоог тогтмол шинэчлэх — таб идэвхтэй үед л.
  const refreshCount = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    getUnreadCount()
      .then(setUnread)
      .catch(() => {});
  }, [getUnreadCount]);

  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Push ирэх мөчид dropdown нээлттэй байвал жагсаалтыг ч дахин татна —
  // зөвхөн тоог шинэчлээд items хуучин хэвээр үлдэхгүйн тулд.
  const refreshAll = useCallback(() => {
    refreshCount();
    if (openRef.current) {
      getRecent()
        .then(setItems)
        .catch(() => {});
    }
  }, [refreshCount, getRecent]);

  useEffect(() => {
    const id = window.setInterval(refreshCount, POLL_MS);
    window.addEventListener("focus", refreshCount);
    document.addEventListener("visibilitychange", refreshCount);
    // Foreground push ирмэгц (web-push.tsx-ийн onMessage) шууд шинэчилнэ — 45с
    // polling-ийг хүлээхгүй.
    window.addEventListener("carcare:notification-received", refreshAll);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", refreshCount);
      document.removeEventListener("visibilitychange", refreshCount);
      window.removeEventListener("carcare:notification-received", refreshAll);
    };
  }, [refreshCount, refreshAll]);

  // Нээлттэй үед: Escape-д хаах, scroll/resize-д дахин байрлуулах.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReflow = () => updatePosition();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function toggle() {
    const next = !open;
    if (next) updatePosition();
    setOpen(next);
    if (next) {
      setLoading(true);
      try {
        setItems(await getRecent());
        setUnread(await getUnreadCount());
      } catch {
        // чимээгүй
      } finally {
        setLoading(false);
      }
    }
  }

  function onItemClick(n: NotificationItem) {
    setOpen(false);
    if (!n.read) {
      setItems((prev) =>
        prev?.map((it) => (it.id === n.id ? { ...it, read: true } : it)) ?? prev,
      );
      setUnread((u) => Math.max(0, u - 1));
      markRead(n.id)
        .then(setUnread)
        .catch(() => {});
    }
  }

  async function onMarkAll() {
    setItems((prev) => prev?.map((it) => ({ ...it, read: true })) ?? prev);
    setUnread(0);
    try {
      setUnread(await markAllRead());
    } catch {
      // чимээгүй
    }
  }

  const visible = (items ?? []).filter((n) => filter === "all" || !n.read);
  const now = new Date();
  const todayKey = bookingDateKey(now);
  const yesterdayKey = bookingDateKey(new Date(now.getTime() - 86_400_000));
  const groups: { label: string; items: NotificationItem[] }[] = [];
  for (const n of visible) {
    const label = dayGroup(n.createdAt, todayKey, yesterdayKey);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Мэдэгдэл — ${unread} уншаагүй` : "Мэдэгдэл"}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
          open
            ? "bg-[var(--oc-accent)]/12 text-[var(--oc-accent)]"
            : "text-[var(--oc-muted3)] hover:bg-white/[0.06] hover:text-[var(--oc-ink2)] light:hover:bg-black/[0.05]"
        }`}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--oc-accent)] px-1 text-[10px] font-bold tabular-nums text-[var(--oc-on-accent)] ring-2 ring-[var(--oc-panel)]">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            // Portal (`document.body`) нь `.landing-ops`-ийн гадна тул `--oc-*`
            // token-ууд (dark/light) уламжлагдахгүй — Modal/Select-тэй адил
            // wrapper-аар дахин тодорхойлно.
            <div className="landing-ops">
              <button
                type="button"
                tabIndex={-1}
                aria-label="Хаах"
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-[60] cursor-default bg-black/50 backdrop-blur-[2px] sm:bg-transparent sm:backdrop-blur-0"
              />
              <div
                role="dialog"
                aria-label="Мэдэгдэл"
                style={!isMobile && pos ? { top: pos.top, left: pos.left, width: PANEL_W } : undefined}
                className={`fixed z-[70] flex flex-col overflow-hidden border border-[var(--oc-line)] bg-[var(--oc-panel)] text-[var(--oc-ink)] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.55)] ${
                  isMobile || !pos
                    ? "inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
                    : "max-w-[calc(100vw-1rem)] rounded-2xl"
                }`}
              >
                {/* mobile grabber */}
                <div className="mx-auto mb-1 mt-2 h-1 w-10 rounded-full bg-[var(--oc-line)] sm:hidden" />

                <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold text-[var(--oc-ink)]">Мэдэгдэл</span>
                    {unread > 0 ? (
                      <span className="rounded-full bg-[var(--oc-accent)]/15 px-2 py-0.5 font-plex-mono text-[11px] font-medium tabular-nums text-[var(--oc-accent)]">
                        {unread} шинэ
                      </span>
                    ) : null}
                  </div>
                  {unread > 0 ? (
                    <button
                      type="button"
                      onClick={onMarkAll}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--oc-muted2)] transition-colors hover:bg-white/[0.06] hover:text-[var(--oc-ink)] light:hover:bg-black/[0.05]"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 6 7 17l-5-5" />
                        <path d="m22 10-7.5 7.5L13 16" />
                      </svg>
                      Бүгдийг уншсан
                    </button>
                  ) : null}
                </div>

                {/* Шүүлт */}
                <div className="px-4 pb-2">
                  <div role="tablist" className="inline-flex rounded-lg border border-[var(--oc-line)] p-0.5 text-xs">
                    {(
                      [
                        ["all", "Бүгд"],
                        ["unread", "Уншаагүй"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={filter === key}
                        onClick={() => setFilter(key)}
                        className={`rounded-md px-3 py-1 transition-colors ${
                          filter === key
                            ? "bg-[var(--oc-panel2)] font-medium text-[var(--oc-ink)] shadow-sm"
                            : "text-[var(--oc-muted3)] hover:text-[var(--oc-ink2)]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--oc-line)] sm:max-h-[26rem]">
                  {loading && !items ? (
                    <ul aria-busy="true" className="flex flex-col gap-1 p-2">
                      {[0, 1, 2].map((i) => (
                        <li key={i} className="flex items-start gap-3 rounded-xl px-2 py-2.5">
                          <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-white/[0.06] light:bg-black/[0.06]" />
                          <span className="flex flex-1 flex-col gap-1.5 pt-0.5">
                            <span className="h-3 w-2/3 animate-pulse rounded bg-white/[0.06] light:bg-black/[0.06]" />
                            <span className="h-2.5 w-full animate-pulse rounded bg-white/[0.05] light:bg-black/[0.05]" />
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : groups.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                      <span className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.05] text-[var(--oc-muted3)] light:bg-black/[0.05]">
                        {ICONS.bell}
                      </span>
                      <p className="text-sm font-medium text-[var(--oc-ink2)]">
                        {filter === "unread" ? "Уншаагүй мэдэгдэл алга" : "Мэдэгдэл алга байна"}
                      </p>
                      <p className="text-xs text-[var(--oc-muted3)]">Шинэ үйл явдал гарвал энд харагдана.</p>
                    </div>
                  ) : (
                    groups.map((g) => (
                      <div key={g.label} className="px-2 pb-1">
                        <div className="sticky top-0 z-[1] bg-[var(--oc-panel)] px-2 pb-1 pt-2.5 font-plex-mono text-[10px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
                          {g.label}
                        </div>
                        <ul className="flex flex-col gap-0.5">
                          {g.items.map((n) => {
                            const v = notificationVisual(n.type);
                            return (
                              <li key={n.id}>
                                <Link
                                  href={n.href}
                                  onClick={() => onItemClick(n)}
                                  className={`group flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-[var(--oc-panel2)] ${
                                    n.read ? "" : "bg-[var(--oc-accent)]/[0.05]"
                                  }`}
                                >
                                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${v.tone}`}>{v.icon}</span>
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-baseline gap-2">
                                      <span
                                        className={`min-w-0 flex-1 truncate text-sm ${
                                          n.read ? "text-[var(--oc-ink2)]" : "font-semibold text-[var(--oc-ink)]"
                                        }`}
                                      >
                                        {n.title}
                                      </span>
                                      <span className="shrink-0 font-plex-mono text-[10.5px] text-[var(--oc-muted3)]">
                                        {timeAgo(n.createdAt)}
                                      </span>
                                    </span>
                                    <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-[var(--oc-muted2)]">
                                      {n.body}
                                    </span>
                                  </span>
                                  {!n.read ? (
                                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--oc-accent)]" aria-label="Уншаагүй" />
                                  ) : null}
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))
                  )}
                </div>

                <Link
                  href={historyHref}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-center gap-1 border-t border-[var(--oc-line)] px-4 py-3 text-xs font-medium text-[var(--oc-accent)] transition-colors hover:bg-[var(--oc-panel2)] hover:text-[var(--oc-accent-hi)]"
                >
                  Бүх мэдэгдэл харах
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
