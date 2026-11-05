// Засварын газрын credit score (0..100) — client/server хоёуланд (Prisma-гүй).
// Өгөгдлийг lib/credit-score-server.ts цуглуулна; энд зөвхөн томъёо, блокын шийдвэр.
//
// Бүрэлдэхүүн (жин):
//   rating      35% — үйлчлүүлэгчийн үнэлгээний дундаж (нуугдаагүй, сүүлийн 365 хоног)
//   booking     25% — онлайн цаг захиалгыг баталсан хувь (батлах / (батлах + татгалзах))
//   completion  25% — засварын хуудсыг дуусгасан хувь (дууссан / (дууссан + цуцлагдсан))
//   onTime      15% — тооцоолсон хугацаандаа (+1 цаг) дуусгасан хувь
// Өгөгдөл цөөн тенантыг шударгаар үнэлэхийн тулд бүрэлдэхүүн бүрд «prior»
// (анхдагч таамаг) жигнэнэ — шинэ тенант ~78 оноотой эхэлнэ.

export const CREDIT_WEIGHTS = { rating: 0.35, booking: 0.25, completion: 0.25, onTime: 0.15 } as const;

/** Prior: харьцааны бүрэлдэхүүнд 80% амжилт, үнэлгээнд 4.0 од — тус бүр 5 ажиглалтын жинтэй. */
const PRIOR_RATIO = 0.8;
const PRIOR_RATING = 4;
const PRIOR_WEIGHT = 5;

/** Блокоос гарахад босгоос дээш ийм онооны зай (дахин дахин блок/нээгдэхээс сэргийлнэ). */
export const CREDIT_UNBLOCK_MARGIN = 5;
export const CREDIT_ADJUSTMENT_LIMIT = 50;

export type CreditMetrics = {
  ratingSum: number;
  ratingCount: number;
  bookingConfirmed: number;
  bookingRejected: number;
  ordersCompleted: number;
  ordersCancelled: number;
  onTime: number;
  onTimeTotal: number;
};

export type CreditComponent = {
  key: keyof typeof CREDIT_WEIGHTS;
  label: string;
  /** 0..1 — prior-оор жигнэсэн */
  value: number;
  /** Харуулах түүхий утга, ж: "4.6 ★ (12)" эсвэл "18/20" */
  detail: string;
};

export type CreditBreakdown = {
  components: CreditComponent[];
  base: number;
  adjustment: number;
  score: number;
};

const LABELS: Record<keyof typeof CREDIT_WEIGHTS, string> = {
  rating: "Үйлчлүүлэгчийн үнэлгээ",
  booking: "Цаг захиалга баталсан",
  completion: "Засвар дуусгасан",
  onTime: "Хугацаандаа дуусгасан",
};

function ratio(good: number, total: number): number {
  return (good + PRIOR_RATIO * PRIOR_WEIGHT) / (total + PRIOR_WEIGHT);
}

export function clampAdjustment(n: number): number {
  return Math.max(-CREDIT_ADJUSTMENT_LIMIT, Math.min(CREDIT_ADJUSTMENT_LIMIT, Math.round(n)));
}

export function computeCreditScore(m: CreditMetrics, adjustment = 0): CreditBreakdown {
  const avgRating = (m.ratingSum + PRIOR_RATING * PRIOR_WEIGHT) / (m.ratingCount + PRIOR_WEIGHT);
  const components: CreditComponent[] = [
    {
      key: "rating",
      label: LABELS.rating,
      value: (avgRating - 1) / 4,
      detail: m.ratingCount > 0 ? `${(m.ratingSum / m.ratingCount).toFixed(1)} ★ (${m.ratingCount})` : "үнэлгээ алга",
    },
    {
      key: "booking",
      label: LABELS.booking,
      value: ratio(m.bookingConfirmed, m.bookingConfirmed + m.bookingRejected),
      detail: `${m.bookingConfirmed}/${m.bookingConfirmed + m.bookingRejected}`,
    },
    {
      key: "completion",
      label: LABELS.completion,
      value: ratio(m.ordersCompleted, m.ordersCompleted + m.ordersCancelled),
      detail: `${m.ordersCompleted}/${m.ordersCompleted + m.ordersCancelled}`,
    },
    {
      key: "onTime",
      label: LABELS.onTime,
      value: ratio(m.onTime, m.onTimeTotal),
      detail: `${m.onTime}/${m.onTimeTotal}`,
    },
  ];
  const base = Math.round(components.reduce((sum, c) => sum + c.value * CREDIT_WEIGHTS[c.key], 0) * 100);
  const adj = clampAdjustment(adjustment);
  const score = Math.max(0, Math.min(100, base + adj));
  return { components, base, adjustment: adj, score };
}

export type CreditBlockState = {
  suspended: boolean;
  creditHidden: boolean;
  creditSuspended: boolean;
  creditExempt: boolean;
};

export type CreditBlockSettings = {
  autoBlock: boolean;
  threshold: number;
  mode: "HIDE" | "SUSPEND";
};

export type CreditBlockDecision = {
  next: Pick<CreditBlockState, "suspended" | "creditHidden" | "creditSuspended">;
  event: "blocked" | "unblocked" | null;
};

/**
 * Онооноос блокын төлөв гаргана. Блоклох: autoBlock, exempt биш, оноо < босго.
 * Нээх: оноо ≥ босго + CREDIT_UNBLOCK_MARGIN, эсвэл autoBlock унтарсан / exempt.
 * Админ гараар зогсоосон (suspended && !creditSuspended) тенантыг хэзээ ч
 * автоматаар нээхгүй.
 */
export function decideCreditBlock(
  score: number,
  state: CreditBlockState,
  settings: CreditBlockSettings,
): CreditBlockDecision {
  const blockedNow = state.creditHidden || state.creditSuspended;
  const manualSuspend = state.suspended && !state.creditSuspended;
  const allowAuto = settings.autoBlock && !state.creditExempt;

  const shouldBlock = allowAuto && (blockedNow ? score < settings.threshold + CREDIT_UNBLOCK_MARGIN : score < settings.threshold);

  if (shouldBlock) {
    if (settings.mode === "SUSPEND") {
      // Аль хэдийн гараар зогсоосон бол credit-ийн тэмдэг тавихгүй (гарын шийдвэр давуу).
      const next = manualSuspend
        ? { suspended: true, creditHidden: false, creditSuspended: false }
        : { suspended: true, creditHidden: false, creditSuspended: true };
      return { next, event: blockedNow || manualSuspend ? null : "blocked" };
    }
    return {
      next: {
        suspended: state.creditSuspended ? false : state.suspended,
        creditHidden: true,
        creditSuspended: false,
      },
      event: blockedNow ? null : "blocked",
    };
  }

  return {
    next: {
      suspended: state.creditSuspended ? false : state.suspended,
      creditHidden: false,
      creditSuspended: false,
    },
    event: blockedNow ? "unblocked" : null,
  };
}
