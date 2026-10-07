"use client";

import Link from "next/link";
import {
  Fragment,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  cancelOrderItemAction,
  changeOrderItemPriceAction,
  changeOrderItemStatusAction,
} from "@/app/_actions/orders";
import { ConfirmForm } from "@/app/_components/confirm-form";
import {
  ITEM_KIND_LABEL,
  SERVICE_ITEM_STATUSES,
  SERVICE_ITEM_STATUS_BADGE,
  SERVICE_ITEM_STATUS_LABEL,
  canChangeServiceItemStatus,
  formatPriceInput,
  formatTugrik,
  isServiceItemCancellable,
  liveFormatPriceInput,
  type ItemKind,
  type ServiceItemStatus,
} from "@/lib/orders";

const COMPLETED_LOCKED_REASON = "Дууссан ажлыг засах боломжгүй.";
const DIAGNOSTIC_REPORT_LINKED_REASON = "Оношилгоо бөглөгдсөн тул явцыг буцаах боломжгүй.";

// Цуцлахаас бусад бүх явц — чөлөөтэй сонгож болно.
const CHANGEABLE_STATUSES = SERVICE_ITEM_STATUSES.filter(
  (s) => s !== "CANCELLED",
);

// Засварын хуудасны мөр — серверээс plain string-ээр дамжина (Decimal биш).
export type OrderItemLite = {
  id: string;
  kind: string;
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
  status: string;
  cancelledAt: string | null;
  cancelledByName: string | null;
  diagnosticReportId: string | null;
};

// Харуулах дараалал: Ажил → Оношилгоо → Сэлбэг → Хураамж
const KIND_ORDER: ItemKind[] = ["LABOR", "DIAGNOSTIC", "PART", "FEE"];

function qtyText(q: string): string {
  const n = Number.parseFloat(q);
  return Number.isFinite(n) ? n.toLocaleString("mn-MN") : q;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// Intl.toLocaleString("mn-MN") ашиглахгүй — зарим орчинд (client дээр
// mn-MN locale өгөгдөл байхгүй бол) server/client өөр форматтай гарч
// hydration mismatch өгдөг. Гараар форматлавал аль ч орчинд ижил байна.
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Үйлчилгээний мөрүүдийг төрлөөр нь tab болгож харуулна. "Бүгд" tab дээр
 * төрөл тус бүрийн жижиг гарчигтайгаар, тодорхой tab дээр зөвхөн тухайн
 * төрлийн мөрүүдийг харуулна. Доор төрөл бүрийн дэд дүн + нийт дүн.
 * Мөр бүр явцтай (хүлээгдэж буй/эхэлсэн/дууссан/цуцлагдсан) — цуцлагдсан мөр
 * УСТГАГДАХГҮЙ, харагдана (харин дүнд орохгүй) — цуцалсан хүн/огноог хадгална.
 */
export function OrderItems({
  items,
  orderId,
  canEdit,
  canChangeStatus,
  canChangePrice,
  canViewHistory,
  orderStarted,
  paymentLocked = false,
}: {
  items: OrderItemLite[];
  orderId: string;
  canEdit: boolean;
  canChangeStatus: boolean;
  canChangePrice: boolean;
  canViewHistory: boolean;
  orderStarted: boolean;
  /** Төлөгдсөн төлбөртэй — үнэ засах, мөр цуцлахыг хаана (сервер ч хориглоно). */
  paymentLocked?: boolean;
}) {
  const showActionColumn = canEdit || canChangeStatus;
  const cancelledCount = items.filter((i) => i.status === "CANCELLED").length;
  const [showHistory, setShowHistory] = useState(false);
  // Цуцлагдсан ажил/оношилгоо/сэлбэгийг шууд харуулахгүй — эрхтэй хэрэглэгч
  // "Түүх" товч дарсан үед л жагсаалтад орно.
  const visibleItems =
    showHistory && canViewHistory
      ? items
      : items.filter((i) => i.status !== "CANCELLED");
  const groups = KIND_ORDER.map((kind) => {
    const list = visibleItems.filter((i) => i.kind === kind);
    const subtotal = list.reduce(
      (acc, i) =>
        acc + (i.status === "CANCELLED" ? 0 : Number.parseFloat(i.total) || 0),
      0,
    );
    return { kind, items: list, subtotal };
  }).filter((g) => g.items.length > 0);

  const grandTotal = groups.reduce((acc, g) => acc + g.subtotal, 0);

  const [tab, setTab] = useState<ItemKind | "ALL">("ALL");
  // Идэвхтэй tab байхгүй болсон бол (мөр устгасны дараа) "Бүгд" рүү унана.
  const tabExists = tab === "ALL" || groups.some((g) => g.kind === tab);
  const activeTab = tabExists ? tab : "ALL";
  const visibleGroups =
    activeTab === "ALL" ? groups : groups.filter((g) => g.kind === activeTab);

  return (
    <div>
      {/* Tabs */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-[var(--oc-line)] overflow-x-auto">
        <TabButton
          active={activeTab === "ALL"}
          onClick={() => setTab("ALL")}
          label="Бүгд"
          count={visibleItems.length}
        />
        {groups.map((g) => (
          <TabButton
            key={g.kind}
            active={activeTab === g.kind}
            onClick={() => setTab(g.kind)}
            label={ITEM_KIND_LABEL[g.kind]}
            count={g.items.length}
            kind={g.kind}
          />
        ))}
        {canViewHistory && cancelledCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-pressed={showHistory}
            title={
              showHistory
                ? "Цуцлагдсан мөрүүдийг нуух"
                : "Цуцлагдсан мөрүүдийг харах"
            }
            className={`ml-auto shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${showHistory
              ? "bg-red-500/15 text-red-400 light:bg-red-100 light:text-red-700"
              : "text-[var(--oc-muted2)] hover:text-[var(--oc-ink2)] hover:bg-white/[0.05]"
              }`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
              <path d="M12 7v5l3 3" />
            </svg>
            Түүх
            <span className="font-plex-mono tabular-nums text-xs opacity-70">
              {cancelledCount}
            </span>
          </button>
        ) : null}
      </div>

      {paymentLocked && (canEdit || canChangePrice) ? (
        <p className="px-5 py-2 text-xs text-sky-400/90 light:text-sky-700 border-b border-[var(--oc-line)]">
          Төлбөр төлөгдсөн тул мөрийн үнэ засах, мөр цуцлах боломжгүй. Өөрчлөх бол эхлээд төлбөрийг буцаана уу.
        </p>
      ) : null}

      {items.some((i) => i.status === "COMPLETED") && (canEdit || canChangeStatus || canChangePrice) ? (
        <p className="px-5 py-2 text-xs text-[var(--oc-muted3)] border-b border-[var(--oc-line)]">
          Дууссан ажлыг засах, цуцлах боломжгүй (явцыг буцааж болно, бөглөгдсөн оношилгооноос бусад). Алдааг засахын тулд шинэ мөр нэмнэ үү.
        </p>
      ) : null}

      {/* Мөрүүд — багана толгойтой хүснэгт: Тоо / Нэгж үнэ / Дүн зэрэгцэнэ */}
      <table className="w-full text-sm">
        <thead>
          <tr className="font-plex-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--oc-muted3)] border-b border-[var(--oc-line)]">
            <th className="text-left font-medium px-5 py-2">Үйлчилгээ</th>
            <th className="hidden sm:table-cell text-right font-medium px-2 py-2 w-16">
              Тоо
            </th>
            <th className="hidden sm:table-cell text-right font-medium px-2 py-2 w-28">
              Нэгж үнэ
            </th>
            <th className="text-right font-medium px-5 py-2 w-32">Дүн</th>
            {showActionColumn ? <th className="w-44" aria-label="Үйлдэл" /> : null}
          </tr>
        </thead>
        <tbody>
          {visibleGroups.map((g, groupIndex) => (
            <Fragment key={g.kind}>
              {activeTab === "ALL" && groupIndex > 0 ? (
                /* Бүлгүүдийн хоорондох цоо зай — эмх цэгцтэй харагдахын тулд
                   мөр хоорондын нимгэн зураас (divide-y) биш, панелийн өнгөөр
                   бодит завсар үлдээнэ. */
                <tr aria-hidden="true">
                  <td
                    colSpan={showActionColumn ? 5 : 4}
                    className="h-5 p-0 bg-[var(--oc-panel)]"
                  />
                </tr>
              ) : null}
              {activeTab === "ALL" ? (
                /* Бүлгийн гарчиг — зөвхөн зүүн талд нь бүлгийн өнгөт зураас. */
                <tr className="bg-[var(--oc-panel2)]">
                  <td
                    colSpan={showActionColumn ? 5 : 4}
                    className={`px-5 py-1.5 border-l ${ITEM_KIND_BORDER[g.kind]}`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${ITEM_KIND_DOT[g.kind]}`}
                      />
                      <span className="font-plex-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--oc-muted3)]">
                        {ITEM_KIND_LABEL[g.kind]} · {g.items.length}
                      </span>
                      <span className="ml-auto font-plex-mono text-xs text-[var(--oc-muted2)] tabular-nums">
                        {formatTugrik(g.subtotal)}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : null}
              {g.items.map((it, itemIndex) => {
                const status = it.status as ServiceItemStatus;
                const cancelled = status === "CANCELLED";
                // Дууссан ажил түгжигдсэн — засах/цуцлахыг сервер ч хориглоно. Явцыг
                // буцааж болно, харин тайлантай оношилгооны мөрийг буцаахгүй.
                const completedLocked = status === "COMPLETED";
                const statusLocked =
                  completedLocked && it.kind === "DIAGNOSTIC" && !!it.diagnosticReportId;
                const needsReport =
                  it.kind === "DIAGNOSTIC" && !it.diagnosticReportId;
                const rowStatuses = needsReport
                  ? CHANGEABLE_STATUSES.filter((s) => s !== "COMPLETED")
                  : CHANGEABLE_STATUSES;
                // Бүлгийг ялгах зорилгоор (Бүгд tab) зөвхөн зүүн талд нь
                // бүлгийн өнгөт зураас зурна.
                const boxed = activeTab === "ALL";
                const groupBorder = ITEM_KIND_BORDER[g.kind];
                return (
                  <tr
                    key={it.id}
                    className={`hover:bg-white/[0.02] transition-colors ${itemIndex > 0 ? "border-t border-[var(--oc-line)]" : ""}`}
                  >
                    <td
                      className={`px-5 py-2.5 ${boxed ? `border-l ${groupBorder}` : ""} ${cancelled ? "opacity-50" : "text-[var(--oc-ink)]"}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{it.description}</span>
                        {g.kind !== "PART" || cancelled ? (
                          <span
                            className={`shrink-0 font-plex-mono text-[9px] px-1.5 py-0.5 rounded-full ${SERVICE_ITEM_STATUS_BADGE[status]}`}
                          >
                            {SERVICE_ITEM_STATUS_LABEL[status]}
                          </span>
                        ) : null}
                        {it.kind === "DIAGNOSTIC" && it.diagnosticReportId ? (
                          <Link
                            href={`/dashboard/diagnostics/reports/${it.diagnosticReportId}`}
                            className="shrink-0 text-[11px] font-medium text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
                          >
                            Тайлан үзэх →
                          </Link>
                        ) : needsReport && !cancelled && orderStarted && canEdit ? (
                          <Link
                            href={`/dashboard/orders/${orderId}/diagnostics/new?itemId=${it.id}`}
                            className="shrink-0 text-[11px] font-medium text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
                          >
                            Бөглөх →
                          </Link>
                        ) : needsReport && !cancelled ? (
                          <span
                            title="Захиалга эхлээгүй байна — эхлүүлсний дараа оношилгоо бөглөх боломжтой"
                            className="shrink-0 text-[11px] font-medium text-[var(--oc-muted3)] cursor-not-allowed"
                          >
                            Бөглөх →
                          </span>
                        ) : null}
                      </div>
                      {cancelled && it.cancelledAt ? (
                        <div className="text-[11px] text-[var(--oc-muted3)] mt-0.5">
                          Цуцалсан: {it.cancelledByName ?? "—"} ·{" "}
                          {fmtDateTime(it.cancelledAt)}
                        </div>
                      ) : null}
                      {/* Нарийн дэлгэцэд тоо×үнэ нэрийн доор */}
                      <span className="sm:hidden block font-plex-mono text-xs text-[var(--oc-muted3)] tabular-nums mt-0.5">
                        {qtyText(it.quantity)} × {formatTugrik(it.unitPrice)}
                      </span>
                    </td>
                    <td
                      className="hidden sm:table-cell px-2 py-2.5 text-right font-plex-mono text-[var(--oc-muted2)] tabular-nums whitespace-nowrap"
                    >
                      {qtyText(it.quantity)}
                    </td>
                    <td className="hidden sm:table-cell px-2 py-2.5 text-right font-plex-mono text-[var(--oc-muted2)] tabular-nums whitespace-nowrap">
                      <PriceCell
                        itemId={it.id}
                        unitPrice={it.unitPrice}
                        editable={canChangePrice && !cancelled && !completedLocked && !paymentLocked}
                      />
                    </td>
                    <td
                      className={`px-5 py-2.5 text-right font-plex-mono font-semibold tabular-nums whitespace-nowrap ${cancelled ? "opacity-50" : "text-[var(--oc-ink)]"}`}
                    >
                      {formatTugrik(it.total)}
                    </td>
                    {showActionColumn ? (
                      <td className="pr-3 py-2.5">
                        <div className="flex items-center justify-start gap-1">
                          {canChangeStatus &&
                            g.kind !== "PART" &&
                            canChangeServiceItemStatus(status) ? (
                            <ItemStatusSelect
                              itemId={it.id}
                              status={status}
                              statuses={rowStatuses}
                              disabledReason={
                                statusLocked
                                  ? DIAGNOSTIC_REPORT_LINKED_REASON
                                  : !orderStarted
                                  ? "Захиалга эхлээгүй байна — эхлүүлсний дараа явц өөрчлөх боломжтой"
                                  : needsReport && status === "PENDING"
                                    ? "Оношилгоо эхлээгүй байна — бөглөж эхлэхэд автоматаар \"Эхэлсэн\" болно"
                                    : null
                              }
                            />
                          ) : null}
                          {completedLocked && !canChangeStatus ? (
                            <span
                              title={COMPLETED_LOCKED_REASON}
                              className="text-[11px] text-[var(--oc-muted3)] cursor-not-allowed"
                            >
                              Түгжигдсэн
                            </span>
                          ) : null}
                          {canEdit && !paymentLocked && isServiceItemCancellable(status) ? (
                            <ConfirmForm
                              action={cancelOrderItemAction}
                              message={`\"${it.description}\" мөрийг цуцлах уу?`}
                            >
                              <input type="hidden" name="itemId" value={it.id} />
                              <button
                                type="submit"
                                aria-label={`"${it.description}" мөрийг цуцлах`}
                                title="Цуцлах"
                                className="w-7 h-7 shrink-0 rounded-lg inline-flex items-center justify-center text-[var(--oc-muted4)] hover:text-red-400 hover:bg-red-500/10 light:hover:text-red-600 transition-colors"
                              >
                                <svg
                                  width="13"
                                  height="13"
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
                            </ConfirmForm>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>

      {/* Нийт дүн — бүлэг тус бүрийн дэд дүнг дээрх бүлгийн гарчигт аль
          хэдийн харуулсан тул энд давхардуулахгүй. */}
      <div className="px-5 py-4 bg-[var(--oc-panel2)] border-t border-[var(--oc-line)]">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--oc-ink)]">Нийт дүн</span>
          <span className="font-plex-mono text-lg font-bold text-[var(--oc-accent)] tabular-nums">
            {formatTugrik(grandTotal)}
          </span>
        </div>
      </div>
    </div>
  );
}

// `orders.itemPrice` эрхтэй хэрэглэгчид мөрийн нэгж үнийг шууд энд засна —
// "100,000.00" форматтай (formatPriceInput), фокус алдахад утга өөрчлөгдсөн
// бол автоматаар submit хийнэ (статус <select>-тэй адил зарчим). Амжилттай
// хадгалсны дараа сервэрээс шинэ `unitPrice` ирэхэд (анхны mount-ыг тооцохгүй)
// local state-ийг дахин тохируулаад, дараагийн мөрийг шууд засаж болохоор
// input-ыг дахин focus/select хийнэ — олон мөр дараалан засахад тав тухтай.
/**
 * Мөрийн явц сонгогч — controlled select. Өмнө нь `<form action>` доторх
 * uncontrolled `defaultValue` байсан тул React 19 action дууссаны дараа формыг
 * автоматаар reset хийж, select эхний сонголт ("Хүлээгдэж буй") руу буцдаг
 * байв. Одоо action-ыг шууд дуудаж, дуустал optimistic утгыг харуулна;
 * дараа нь серверээс ирсэн `status` (амжилтгүй бол хуучин утга) руу шилжинэ.
 */
function ItemStatusSelect({
  itemId,
  status,
  statuses,
  disabledReason,
}: {
  itemId: string;
  status: ServiceItemStatus;
  statuses: readonly ServiceItemStatus[];
  /** null бол идэвхтэй; утгатай бол идэвхгүй бөгөөд tooltip-д харагдана. */
  disabledReason: string | null;
}) {
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(status);
  const [pending, startTransition] = useTransition();

  return (
    <select
      name="status"
      value={optimisticStatus}
      disabled={disabledReason !== null || pending}
      title={disabledReason ?? "Явц өөрчлөх"}
      onChange={(e) => {
        const next = e.currentTarget.value as ServiceItemStatus;
        startTransition(async () => {
          setOptimisticStatus(next);
          const fd = new FormData();
          fd.set("itemId", itemId);
          fd.set("status", next);
          await changeOrderItemStatusAction(fd);
        });
      }}
      className="compact-input !py-1 !px-1.5 !text-[11px] !rounded-lg !w-[9.5rem] disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {statuses.map((s) => (
        <option key={s} value={s}>
          {SERVICE_ITEM_STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

function PriceCell({
  itemId,
  unitPrice,
  editable,
}: {
  itemId: string;
  unitPrice: string;
  editable: boolean;
}) {
  const [value, setValue] = useState(() => formatPriceInput(unitPrice));
  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    setValue(formatPriceInput(unitPrice));
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [unitPrice]);

  // Бичиж байх үед курсорыг үргэлж утгын төгсгөлд байлгана — таслал
  // нэмэгдэх/хасагдахад курсор дундуур үсэрч эвдрэхээс сэргийлнэ.
  useEffect(() => {
    const el = inputRef.current;
    if (el && document.activeElement === el) {
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [value]);

  if (!editable) return <>{formatTugrik(unitPrice)}</>;

  return (
    <form action={changeOrderItemPriceAction}>
      <input type="hidden" name="itemId" value={itemId} />
      <div className="flex items-center justify-end">
        <input
          ref={inputRef}
          name="unitPrice"
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(liveFormatPriceInput(e.target.value))}
          onBlur={(e) => {
            const formatted = formatPriceInput(e.target.value);
            setValue(formatted);
            if (formatted !== formatPriceInput(unitPrice)) {
              e.currentTarget.form?.requestSubmit();
            }
          }}
          className="compact-input !py-1 !pl-1.5 !pr-1 !text-[11px] !rounded-lg w-full min-w-0 text-right"
        />
        <span className="shrink-0 text-[11px] text-[var(--oc-muted3)] pr-1.5">₮</span>
      </div>
    </form>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
  kind,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  kind?: ItemKind;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${active
        ? "bg-[var(--oc-accent)] text-[var(--oc-on-accent)]"
        : "text-[var(--oc-muted2)] hover:text-[var(--oc-ink2)] hover:bg-white/[0.05]"
        }`}
    >
      {kind && !active ? (
        <span className={`w-1.5 h-1.5 rounded-full ${ITEM_KIND_DOT[kind]}`} />
      ) : null}
      {label}
      <span
        className={`font-plex-mono tabular-nums text-xs ${active ? "text-[var(--oc-on-accent)]/70" : "text-[var(--oc-muted3)]"}`}
      >
        {count}
      </span>
    </button>
  );
}

// Tab дээрх жижиг өнгөт цэг (badge-ийн өнгийг ойролцоо тусгана).
const ITEM_KIND_DOT: Record<ItemKind, string> = {
  LABOR: "bg-blue-400",
  DIAGNOSTIC: "bg-violet-400",
  PART: "bg-amber-400",
  FEE: "bg-zinc-400",
};

// Бүлэг тус бүрийг бүтнээр нь хүрээлэх өнгө (badge-ийн өнгөтэй адил) —
// "Бүгд" tab дээр ажил/оношилгоо/сэлбэг/хураамжийг тод хайрцаглаж ялгана.
const ITEM_KIND_BORDER: Record<ItemKind, string> = {
  LABOR: "border-blue-500/40",
  DIAGNOSTIC: "border-violet-500/40",
  PART: "border-amber-500/40",
  FEE: "border-zinc-500/40",
};
