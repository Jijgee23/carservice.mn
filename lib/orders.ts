export const ORDER_STATUSES = [
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  SCHEDULED: "Товлогдсон",
  IN_PROGRESS: "Хийгдэж байна",
  COMPLETED: "Дууссан",
  CANCELLED: "Цуцлагдсан",
};

export const ORDER_STATUS_BADGE: Record<OrderStatus, string> = {
  SCHEDULED:
    "bg-[var(--oc-warn)]/15 text-[var(--oc-warn)] border border-[var(--oc-warn)]/25",
  IN_PROGRESS:
    "bg-blue-500/15 text-blue-400 border border-blue-500/25 light:bg-blue-100 light:border-blue-300 light:text-blue-700",
  COMPLETED:
    "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 light:bg-emerald-100 light:border-emerald-300 light:text-emerald-700",
  CANCELLED:
    "bg-red-500/10 text-red-400 border border-red-500/20 light:bg-red-100 light:border-red-300 light:text-red-700",
};

// Аль статус руу шилжих боломжтой вэ?
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

// Эцсийн (цоожтой) төлөв — захиалгын мэдээлэл засах, мөр нэмэх/устгах боломжгүй.
export function isOrderLocked(status: OrderStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}

// Захиалга эхэлсэн үү — оношилгоо бөглөх боломжтой эсэх. Зөвхөн эхэлсэн идэвхтэй
// төлөвт (SCHEDULED биш, дууссан/цуцлагдсан биш) бөглөнө.
export function canFillDiagnostics(status: OrderStatus): boolean {
  return status === "IN_PROGRESS";
}

export const PAYMENT_STATUSES = ["UNPAID", "PARTIAL", "PAID"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  UNPAID: "Төлөгдөөгүй",
  PARTIAL: "Хагас",
  PAID: "Төлөгдсөн",
};

export const PAYMENT_STATUS_BADGE: Record<PaymentStatus, string> = {
  UNPAID:
    "bg-red-500/15 text-red-300 border border-red-500/25 light:bg-red-100 light:border-red-300 light:text-red-700",
  PARTIAL:
    "bg-[var(--oc-warn)]/15 text-[var(--oc-warn)] border border-[var(--oc-warn)]/25",
  PAID:
    "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 light:bg-emerald-100 light:border-emerald-300 light:text-emerald-700",
};

// --- Захиалгын төлбөрийн арга (OrderPayment.method) -----------------------
// QPay-аас гадна гараар (аль хэдийн хүлээн авсан) төлбөр бүртгэх боломжтой
// аргууд. "OTHER" нь DB enum-д байгаа ч UI-д сонголт болгон харуулахгүй
// (тодорхойгүй тохиолдолд ашиглах нөөц утга — жагсаалт бүтэн байлгахын тулд).
export const ORDER_PAYMENT_METHODS = [
  "QPAY",
  "CASH",
  "BANK_TRANSFER",
  "CARD",
] as const;
export type OrderPaymentMethod = (typeof ORDER_PAYMENT_METHODS)[number];

export const ORDER_PAYMENT_METHOD_LABEL: Record<string, string> = {
  QPAY: "QPay",
  CASH: "Бэлэн",
  BANK_TRANSFER: "Дансаар",
  CARD: "Карт",
  OTHER: "Бусад",
};

export const ORDER_PAYMENT_METHOD_BADGE: Record<string, string> = {
  QPAY: "bg-sky-500/15 text-sky-300 border border-sky-500/25 light:bg-sky-100 light:border-sky-300 light:text-sky-700",
  CASH: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 light:bg-emerald-100 light:border-emerald-300 light:text-emerald-700",
  BANK_TRANSFER: "bg-violet-500/15 text-violet-300 border border-violet-500/25 light:bg-violet-100 light:border-violet-300 light:text-violet-700",
  CARD: "bg-amber-500/15 text-amber-300 border border-amber-500/25 light:bg-amber-100 light:border-amber-300 light:text-amber-700",
  OTHER: "bg-zinc-500/15 text-zinc-300 border border-zinc-500/25 light:bg-zinc-100 light:border-zinc-300 light:text-zinc-600",
};

export const ORDER_PAYMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Хүлээгдэж буй",
  PAID: "Төлөгдсөн",
  CANCELLED: "Цуцлагдсан",
  FAILED: "Амжилтгүй",
};

// Дараа төлбөрт (гэрээт) машин/захиалгын тэмдэг — олон хуудсанд нийтлэг.
export const POSTPAID_LABEL = "Дараа төлбөрт";
export const POSTPAID_BADGE =
  "bg-sky-500/15 text-sky-300 border border-sky-500/25 light:bg-sky-100 light:border-sky-300 light:text-sky-700";

// Дотоод засвар — төлбөргүй, дотоод зардалд бүртгэгдэнэ (дараа төлбөртэй зэрэг байж болохгүй).
export const INTERNAL_LABEL = "Дотоод";
export const INTERNAL_BADGE =
  "bg-slate-500/15 text-slate-300 border border-slate-500/25 light:bg-slate-100 light:border-slate-300 light:text-slate-700";
export const INTERNAL_REPAIR_LABEL = "Дотоод засвар";
export const INTERNAL_COST_LABEL = "Дотоод зардал";
export const INTERNAL_POSTPAID_CONFLICT_MESSAGE = "Дотоод засвар болон дараа тооцоо зэрэг байж болохгүй.";
export const INTERNAL_NO_PAYMENT_MESSAGE = "Дотоод засварт төлбөр бүртгэхгүй.";
export const INTERNAL_HAS_PAYMENTS_MESSAGE = "Төлбөр бүртгэгдсэн захиалгыг дотоод засвар болгох боломжгүй.";
export const INTERNAL_PAYMENT_NOTE = "Дотоод засвар — төлбөргүй, дотоод зардалд бүртгэгдэнэ.";

export const POSTPAID_CLOSE_FORBIDDEN_MESSAGE =
  "Дараа тооцоот захиалгыг төлбөр дутуу байхад зөвхөн эрхтэй хэрэглэгч (нягтлан) хаана.";

export const POSTPAID_SETTLEMENT_FORBIDDEN_MESSAGE =
  "Дууссан дараа тооцоот захиалгын төлбөрийг зөвхөн эрхтэй хэрэглэгч (нягтлан) бүртгэнэ.";
export const POSTPAID_SETTLEMENT_NOTE =
  "Дууссан дараа тооцоот захиалгын төлбөрийг нягтлан бүртгэнэ.";

export const ITEM_KINDS = ["LABOR", "DIAGNOSTIC", "PART", "FEE"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  LABOR: "Ажил",
  DIAGNOSTIC: "Оношилгоо",
  PART: "Сэлбэг",
  FEE: "Хураамж",
};

export const ITEM_KIND_BADGE: Record<ItemKind, string> = {
  LABOR:
    "bg-blue-500/15 text-blue-300 border border-blue-500/25 light:bg-blue-100 light:border-blue-300 light:text-blue-700",
  DIAGNOSTIC:
    "bg-violet-500/15 text-violet-300 border border-violet-500/25 light:bg-violet-100 light:border-violet-300 light:text-violet-700",
  PART: "bg-amber-500/15 text-amber-300 border border-amber-500/25 light:bg-amber-100 light:border-amber-300 light:text-amber-700",
  FEE: "bg-zinc-500/15 text-zinc-300 border border-zinc-500/25 light:bg-zinc-100 light:border-zinc-300 light:text-zinc-600",
};

// --- Мөрийн (ажил/оношилгоо/сэлбэг) явц ------------------------------------

export const SERVICE_ITEM_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;
export type ServiceItemStatus = (typeof SERVICE_ITEM_STATUSES)[number];

export const SERVICE_ITEM_STATUS_LABEL: Record<ServiceItemStatus, string> = {
  PENDING: "Хүлээгдэж буй",
  IN_PROGRESS: "Эхэлсэн",
  COMPLETED: "Дууссан",
  CANCELLED: "Цуцлагдсан",
};

export const SERVICE_ITEM_STATUS_BADGE: Record<ServiceItemStatus, string> = {
  PENDING:
    "bg-white/[0.06] text-[var(--oc-muted2)] border border-[var(--oc-line2)] light:bg-zinc-100 light:border-zinc-300 light:text-zinc-600",
  IN_PROGRESS:
    "bg-sky-500/15 text-sky-300 border border-sky-500/25 light:bg-sky-100 light:border-sky-300 light:text-sky-700",
  COMPLETED:
    "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 light:bg-emerald-100 light:border-emerald-300 light:text-emerald-700",
  CANCELLED:
    "bg-red-500/10 text-red-400 border border-red-500/20 light:bg-red-100 light:border-red-300 light:text-red-700",
};

// Мөрийг цуцлах боломжтой эсэх (эцсийн — дууссан/цуцлагдсан мөрийг цуцлахгүй).
export function isServiceItemCancellable(status: ServiceItemStatus): boolean {
  return status === "PENDING" || status === "IN_PROGRESS";
}

// Мөрийн явцыг (хүлээгдэж буй/эхэлсэн/дууссан хооронд) чөлөөтэй, дурын
// дарааллаар өөрчилж болно — ганцхан нөхцөл: одоогийн явц ЦУЦЛАГДСАН биш байх
// ёстой (цуцлахыг тусдаа cancel action-аар хийдэг тул энд зөвшөөрөхгүй).
export function canChangeServiceItemStatus(status: ServiceItemStatus): boolean {
  return status !== "CANCELLED";
}

/**
 * Мөрийн `startedAt`/`completedAt`-д (нэг ажил гүйцэтгэх дундаж хугацаа
 * тооцоход ашиглагдана, харах: app/dashboard/reports/data.ts) шинэ статустай
 * нийцүүлж бичих утгыг гаргана. Статус чөлөөтэй, дурын дарааллаар (буцаж ч)
 * солигддог тул "анх удаа" биш "одоогийн төлөвт нийцсэн" гэж үзнэ:
 * PENDING руу буцвал хоёуланг нь цэвэрлэнэ; IN_PROGRESS анх удаа ороход л
 * `startedAt` тавигдана (дараа дахин орвол ХЭВЭЭР — анхны эхэлсэн цагаа
 * хадгална); COMPLETED болгонд `completedAt` ШИНЭЧЛЭГДЭНЭ, `startedAt`
 * байхгүй (PENDING→COMPLETED шууд) бол түүнийг ч мөн тавина. CANCELLED-д
 * хүрэхгүй (өөр action-аар зохицуулагдана).
 */
export function serviceItemTimingPatch(
  nextStatus: ServiceItemStatus,
  currentStartedAt: Date | null,
): { startedAt?: Date | null; completedAt?: Date | null } {
  if (nextStatus === "PENDING") return { startedAt: null, completedAt: null };
  if (nextStatus === "IN_PROGRESS") {
    return { startedAt: currentStartedAt ?? new Date(), completedAt: null };
  }
  if (nextStatus === "COMPLETED") {
    const now = new Date();
    return currentStartedAt ? { completedAt: now } : { startedAt: now, completedAt: now };
  }
  return {};
}

export function formatTugrik(amount: number | string | null | undefined): string {
  if (amount == null) return "—";
  const n = typeof amount === "string" ? Number.parseFloat(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("mn-MN", { maximumFractionDigits: 2 })}₮`;
}

/**
 * Дүн/валютыг тусад нь (өөр өөр фонт хэмжээгээр) харуулдаг хэсгүүдэд
 * (жиш нь PlanPrice, SubscriptionPayment) зориулсан валютын тэмдэг —
 * "MNT" бол апп даяар ашигладаг "₮" тэмдэгтэй нийцүүлж харуулна, өөр
 * (ирээдүйн) валют бол raw кодыг нь хэвээр үзүүлнэ.
 */
export function currencySymbol(currency: string): string {
  return currency === "MNT" ? "₮" : currency;
}

// "100,000" хэлбэрээр (мянгатын таслал, бутархайгүй бол цэг харуулахгүй)
// форматлана — үнэ бичих/засах input-д ашиглана. "en-US" locale
// санаатайгаар — "mn-MN" зарим орчинд server/client өөр гарч hydration
// mismatch өгдөг асуудлаас чөлөөтэй, бүх орчинд тогтмол ижил формат өгнө.
// Comma-той утга дамжвал (жиш. input-аас шууд) эхлээд цэвэрлэнэ.
export function formatPriceInput(v: string): string {
  const n = Number.parseFloat(v.replace(/,/g, ""));
  if (!Number.isFinite(n)) return v;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// Бичиж байх үедээ шууд мянгатын таслалтай харагдуулна ("540,000") — 2-оос
// олон бутархай орон, олон цэг зэргийг хориглоно, харин бичиж дуусаагүй
// байгаа цэгийг (жиш. "540.") устгахгүй — onBlur дээр эцсийн байдлаар
// цэвэрлэнэ.
export function liveFormatPriceInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const dotIndex = cleaned.indexOf(".");
  const groupInt = (digits: string) =>
    digits.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (dotIndex === -1) return groupInt(cleaned);
  const intPart = cleaned.slice(0, dotIndex);
  const decPart = cleaned.slice(dotIndex + 1).replace(/\./g, "").slice(0, 2);
  return `${groupInt(intPart)}.${decPart}`;
}
