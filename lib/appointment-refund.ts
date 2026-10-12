/**
 * Atomic claim/finalize/release for an AppointmentPayment refund.
 *
 * Problem (I3/M2): both refund entry points (super-admin web action and the
 * tenant staff route) read the row, call QPay, then write, so two concurrent
 * submits could both reach the provider; the staff route also held a DB
 * transaction + row lock across the QPay HTTP call.
 *
 * Protocol (no schema change; AppointmentPayment has no REFUNDING status):
 *   1. claimAppointmentRefund  - conditional UPDATE ... WHERE status = 'PAID'
 *      AND not already claimed, setting `refundNote` to a claim marker. Exactly
 *      one concurrent caller gets count === 1. `status` stays PAID while the
 *      claim is held, so every other reader (slot hold, account closure,
 *      booking status) is unaffected.
 *   2. caller talks to QPay with NO transaction open.
 *   3. finalizeAppointmentRefund - conditional UPDATE PAID -> REFUNDED
 *      (WHERE refundNote = marker), or releaseAppointmentRefundClaim on
 *      failure to roll the claim back.
 *
 * A claim older than REFUND_CLAIM_STALE_MS (process died between claim and
 * finalize) may be reclaimed. If the provider already refunded in that window a
 * reclaim calls QPay again; QPay rejects a repeat refund for the same payment.
 */

/** Tag put on QPayService.refundPayment/cancelPayment errors that happened BEFORE the provider call (token/config). */
export const QPAY_NOT_SENT_PREFIX = "[QPAY_NOT_SENT] ";

export const REFUND_CLAIM_PREFIX = "__REFUND_IN_PROGRESS__:";
export const REFUND_CLAIM_STALE_MS = 10 * 60 * 1000;

/** Unique per claim, so a stale reclaim by B can never be released/finalized by A. */
export function newRefundClaimToken(): string {
  return `${REFUND_CLAIM_PREFIX}${globalThis.crypto.randomUUID()}`;
}

type ClaimedRow = {
  id: string;
  status: string;
  amount: { toString(): string };
  currency: string;
  paymentType: string | null;
  qpayPaymentId: string | null;
};

/** Minimal slice of `prisma.appointmentPayment` (or a tx client's) used here; fakeable in tests. */
export type AppointmentRefundDb = {
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  findFirst(args: {
    where: Record<string, unknown>;
    select: Record<string, boolean>;
  }): Promise<ClaimedRow | null>;
};

export type ClaimRefundResult =
  | {
      claimed: true;
      payment: ClaimedRow;
      token: string;
      /**
       * true when this claim took over a STALE claim, i.e. an earlier attempt ended
       * ambiguously (money may already have moved at QPay). Callers must NOT
       * auto-release such a claim on a provider 4xx: QPay rejecting a repeat refund
       * does not mean nothing was refunded. A super admin resolves it with
       * `markAppointmentRefundVerified` after checking QPay.
       */
      reclaimed: boolean;
    }
  | { claimed: false; reason: "NOT_FOUND" | "ALREADY_REFUNDED" | "NOT_PAID" | "IN_PROGRESS" };

const SELECT = {
  id: true,
  status: true,
  amount: true,
  currency: true,
  paymentType: true,
  qpayPaymentId: true,
} as const;

export async function claimAppointmentRefund(
  db: AppointmentRefundDb,
  args: {
    paymentId: string;
    tenantId?: string;
    now?: Date;
    token?: string;
    /** Staff (tenant) callers pass false: only a super admin may take over a held claim. */
    allowReclaim?: boolean;
  },
): Promise<ClaimRefundResult> {
  const now = args.now ?? new Date();
  const token = args.token ?? newRefundClaimToken();
  const scope = { id: args.paymentId, ...(args.tenantId ? { tenantId: args.tenantId } : {}) };
  const staleBefore = new Date(now.getTime() - REFUND_CLAIM_STALE_MS);

  // 1) Fresh claim: no prior claim marker on the row.
  let res = await db.updateMany({
    where: {
      ...scope,
      status: "PAID",
      OR: [{ refundNote: null }, { NOT: { refundNote: { startsWith: REFUND_CLAIM_PREFIX } } }],
    },
    data: { refundNote: token },
  });
  let reclaimed = false;
  // 2) Stale takeover of a held claim (super admin only).
  if (res.count !== 1 && args.allowReclaim !== false) {
    res = await db.updateMany({
      where: {
        ...scope,
        status: "PAID",
        AND: [{ refundNote: { startsWith: REFUND_CLAIM_PREFIX } }, { updatedAt: { lt: staleBefore } }],
      },
      data: { refundNote: token },
    });
    reclaimed = res.count === 1;
  }
  if (res.count === 1) {
    const payment = await db.findFirst({ where: scope, select: SELECT });
    if (payment) return { claimed: true, payment, token, reclaimed };
    return { claimed: false, reason: "NOT_FOUND" };
  }

  const row = await db.findFirst({ where: scope, select: SELECT });
  if (!row) return { claimed: false, reason: "NOT_FOUND" };
  if (row.status === "REFUNDED") return { claimed: false, reason: "ALREADY_REFUNDED" };
  if (row.status !== "PAID") return { claimed: false, reason: "NOT_PAID" };
  return { claimed: false, reason: "IN_PROGRESS" };
}

/** PAID (claimed with exactly [token]) -> REFUNDED. Returns false if the claim was lost. */
export async function finalizeAppointmentRefund(
  db: AppointmentRefundDb,
  args: { paymentId: string; token: string; refundNote: string; refundedById?: string | null; now?: Date },
): Promise<boolean> {
  const res = await db.updateMany({
    where: { id: args.paymentId, status: "PAID", refundNote: args.token },
    data: {
      status: "REFUNDED",
      refundedAt: args.now ?? new Date(),
      refundNote: args.refundNote,
      ...(args.refundedById ? { refundedById: args.refundedById } : {}),
    },
  });
  return res.count === 1;
}

/** Finalize with one retry on a thrown DB error or a lost update; never throws. */
export async function finalizeAppointmentRefundWithRetry(
  db: AppointmentRefundDb,
  args: Parameters<typeof finalizeAppointmentRefund>[1],
): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      if (await finalizeAppointmentRefund(db, args)) return true;
    } catch (e) {
      console.error("[appointment-refund] finalize threw", args.paymentId, attempt, e instanceof Error ? e.name : e);
    }
  }
  console.error(
    `[appointment-refund] CRITICAL: provider refund may have succeeded but payment ${args.paymentId} was not marked REFUNDED. Verify at QPay and reconcile manually.`,
  );
  return false;
}

/** Roll the claim back (exact token only) after a DEFINITE provider rejection. */
export async function releaseAppointmentRefundClaim(
  db: AppointmentRefundDb,
  paymentId: string,
  token: string,
): Promise<void> {
  await db.updateMany({
    where: { id: paymentId, status: "PAID", refundNote: token },
    data: { refundNote: null },
  });
}

/**
 * QPayService.refundPayment returns `{ error: "QPay буцаахад алдаа: <status> <body>" }`
 * for HTTP responses and `"...: <ExceptionName>"` for network/timeout/abort. Only a
 * 4xx response (other than 408/429) is a definite rejection (nothing refunded);
 * everything else is ambiguous and the claim must be KEPT for manual verification.
 */
export function isDefiniteRefundRejection(error: string): boolean {
  // Failed before any HTTP request to the refund endpoint (token/config): nothing was sent.
  if (error.startsWith(QPAY_NOT_SENT_PREFIX)) return true;
  const m = /: (\d{3})(?!\d)/.exec(error);
  if (!m) return false;
  const status = Number(m[1]);
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * Super admin resolves a held (ambiguous) claim after verifying the refund at QPay:
 * PAID with a claim marker -> REFUNDED. Conditional on the marker, so it can never
 * touch a payment that has no held claim.
 */
export async function markAppointmentRefundVerified(
  db: AppointmentRefundDb,
  args: { paymentId: string; refundNote: string; refundedById: string; now?: Date },
): Promise<boolean> {
  const res = await db.updateMany({
    where: { id: args.paymentId, status: "PAID", refundNote: { startsWith: REFUND_CLAIM_PREFIX } },
    data: {
      status: "REFUNDED",
      refundedAt: args.now ?? new Date(),
      refundNote: args.refundNote,
      refundedById: args.refundedById,
    },
  });
  return res.count === 1;
}

export const REFUND_VERIFY_MESSAGE =
  "Буцаалт QPay дээр хийгдсэн байж магадгүй. QPay дээр шалгаад «Буцаасан гэж тэмдэглэх» дарна уу.";

/** Staff (tenant) callers cannot reclaim or verify a held claim; only a super admin can. */
export const REFUND_STAFF_WAIT_MESSAGE =
  "Буцаалт хийгдсэн эсэх тодорхойгүй байна. Суперадмин QPay дээр шалгаж баталгаажуулах хүртэл хүлээнэ үү.";

export const REFUND_AMBIGUOUS_MESSAGE =
  "QPay-ийн хариу тодорхойгүй байна. Буцаалт хийгдсэн эсэхийг QPay дээр шалгана уу — төлбөр түр түгжигдсэн (10 минутын дараа дахин оролдох боломжтой).";

export const REFUND_REJECTION_MESSAGE: Record<
  Exclude<ClaimRefundResult, { claimed: true }>["reason"],
  string
> = {
  NOT_FOUND: "Төлбөр олдсонгүй.",
  ALREADY_REFUNDED: "Энэ төлбөр аль хэдийн буцаагдсан.",
  NOT_PAID: "Зөвхөн төлөгдсөн төлбөрийг буцаана.",
  IN_PROGRESS: "Энэ төлбөрийн буцаалт хийгдэж байна. Түр хүлээгээд дахин шалгана уу.",
};
