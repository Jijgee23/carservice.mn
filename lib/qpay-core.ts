/**
 * QPay merchant HTTP клиентийн нийтлэг цөм — OAuth token амьдралын мөчлөг
 * (авах/сэргээх/кэш), invoice үүсгэх, төлбөр шалгах/цуцлах/буцаах.
 *
 * Платформ-level (`lib/qpay.ts`, `QPaySettings` singleton) болон tenant-level
 * (`lib/qpay-tenant.ts`, `TenantQPaySettings`) хоёулаа энэ нэг HTTP/token
 * логикийг ашигладаг тул `createQPayClient`-аар нэгтгэсэн — эх сурвалж нь
 * (`store`) л ялгаатай. `Id` нь тохиргоог таних түлхүүр: платформд `void`,
 * tenant-д `string` (tenantId).
 */

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { Prisma } from "@/app/generated/prisma/client";

const QPAY_URL =
  process.env.QPAY_MERCHANT_URL ?? "https://merchant.qpay.mn/v2/";
const TOKEN_EXPIRY_BUFFER_MS = 30_000;

export type QPayBankUrl = {
  name: string;
  name_mn: string;
  logo: string;
  description: string;
  link: string;
};

export type QPayInvoiceCreated = {
  invoice_id: string;
  qr_text: string;
  qr_image: string; // base64 (without data: prefix)
  urls?: QPayBankUrl[]; // банкны апп руу шилжих deep link-үүд
};

// QPay-ийн бодит enum: NEW (эхлэн, төлөгдөөгүй), PAID, FAILED, REFUNDED.
// "PENDING" гэж ЭРГЭЖ ИРДЭГГҮЙ — хуучин код үүнийг андуурч бичсэн байсан
// (2026-09-02 засав, developer.qpay.mn v2.0.0 баримт бичгийг судалж
// баталгаажуулсан).
export type QPayPaymentStatus = "NEW" | "PAID" | "FAILED" | "REFUNDED";

export type QPayCheckResponse = {
  count: number;
  paid_amount: number | string;
  rows: {
    payment_id: string;
    payment_status: QPayPaymentStatus;
    // Бодит талбарын нэр `payment_date` (өмнө нь буруу `paid_at` гэж
    // уншдаг байсан тул огноо үргэлж null ирж, `?? new Date()` fallback-аар
    // "одоо" цагаар орлуулагддаг байсан — 2026-09-02 засав).
    payment_date: string;
    payment_amount?: string;
    // "P2P" (банкны шилжүүлэг/QR) эсвэл "CARD" — баримт бичигт талбарын нэр
    // тодорхойгүй тул хоёр боломжит хувилбарыг аль алиныг нь уншина.
    payment_type?: string;
    transaction_type?: string;
  }[];
};

export type QPayCheckResult =
  | {
      paid: boolean;
      paymentId: string | null;
      paidAt: Date | null;
      paidAmount: number;
      underpaidAmount: number | null;
      paymentType: string | null;
    }
  | { error: string };

/** Exact decimal result used by tenant order payments. */
export type QPayExactCheckResult =
  | {
      paid: boolean;
      paymentId: string | null;
      paidAt: Date | null;
      paidAmount: string;
      underpaidAmount: string | null;
      paymentType: string | null;
    }
  | { error: string };

export type QPayCancelInvoiceResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_configured" | "already_paid" | "not_found" | "http_error";
      status?: number;
      message?: string;
    };

/**
 * Classify a failed `DELETE /invoice/{id}`.
 * ⚠️ The error codes below (INVOICE_PAID, INVOICE_NOTFOUND, INVOICE_ALREADY_CANCELED) MUST be verified against the
 * QPay sandbox before production use. Fail-safe rule: "gone" (not_found) is reported ONLY when the body explicitly
 * says the invoice does not exist / is already cancelled. A bare, HTML or unknown 404 (wrong URL/path, gateway) is an
 * http_error so the caller never cancels locally while the invoice may still be live.
 */
export function classifyCancelInvoiceFailure(status: number, body: string): QPayCancelInvoiceResult {
  const text = body.slice(0, 300);
  if (/INVOICE_PAID/i.test(text)) return { ok: false, reason: "already_paid", status, message: text };
  if (/INVOICE_NOTFOUND|INVOICE_NOT_FOUND|INVOICE_ALREADY_CANCEL(?:L)?ED/i.test(text)) {
    return { ok: false, reason: "not_found", status, message: text };
  }
  return { ok: false, reason: "http_error", status, message: text };
}

/** Тохиргооны эх сурвалжид байх ёстой QPay-ийн нийтлэг талбарууд. */
export type QPayTokenFields = {
  username: string | null;
  password: string | null; // encrypted (эсвэл хуучин plaintext)
  invoiceCode: string | null;
  callbackUrl: string | null;
  accessToken: string | null; // encrypted
  refreshToken: string | null; // encrypted
  tokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
};

type TokenResult = { accessToken: string; expiresAt: Date } | { error: string };

/** `Id`-аар тохиргоо унших/хадгалах эх сурвалж (платформ singleton эсвэл tenant). */
export type QPayStore<Id, Settings extends QPayTokenFields = QPayTokenFields> = {
  getSettings(id: Id): Promise<Settings | null>;
  saveTokens(
    id: Id,
    tokens: {
      accessToken: string;
      refreshToken: string;
      tokenExpiresAt: Date;
      refreshTokenExpiresAt: Date;
    },
  ): Promise<void>;
  /** Тохиргоо олдсон ч ашиглах боломжгүй бол (жиш нь идэвхгүй) алдааны мессеж. */
  checkAvailable?(settings: Settings): string | null;
  messages: {
    notConfigured: string;
    incomplete: string;
  };
};

export function createQPayClient<Id, Settings extends QPayTokenFields = QPayTokenFields>(
  store: QPayStore<Id, Settings>,
) {
  async function saveTokens(
    id: Id,
    body: {
      access_token: string;
      refresh_token: string;
      expires_in: number; // QPay-ийн `expires_in` — Unix секунд
      refresh_expires_in: number;
    },
  ): Promise<{ accessToken: string; expiresAt: Date }> {
    const expiresAt = new Date(body.expires_in * 1000);
    await store.saveTokens(id, {
      accessToken: encryptSecret(body.access_token),
      refreshToken: encryptSecret(body.refresh_token),
      tokenExpiresAt: expiresAt,
      refreshTokenExpiresAt: new Date(body.refresh_expires_in * 1000),
    });
    // Шууд хэрэглэхэд plaintext-ийг буцаана (DB-д шифрлэгдсэн).
    return { accessToken: body.access_token, expiresAt };
  }

  async function fetchNewToken(
    id: Id,
    username: string,
    password: string,
  ): Promise<TokenResult> {
    const basic = Buffer.from(`${username}:${password}`).toString("base64");
    const res = await fetch(`${QPAY_URL}auth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      return {
        error:
          "QPay токен авах явцад алдаа гарлаа. Тохиргоо болон холболтоо шалгана уу.",
      };
    }
    return saveTokens(id, await res.json());
  }

  async function refreshAccessToken(id: Id, refreshTkn: string): Promise<TokenResult> {
    const res = await fetch(`${QPAY_URL}auth/refresh`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${refreshTkn}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      return { error: "QPay токен шинэчлэх явцад алдаа гарлаа." };
    }
    return saveTokens(id, await res.json());
  }

  async function getAccessToken(id: Id): Promise<TokenResult> {
    const settings = await store.getSettings(id);
    if (!settings) return { error: store.messages.notConfigured };

    const unavailable = store.checkAvailable?.(settings);
    if (unavailable) return { error: unavailable };

    if (!settings.username || !settings.password || !settings.invoiceCode) {
      return { error: store.messages.incomplete };
    }

    // Эмзэг утгуудыг тайлна (хуучин plaintext мөрийг ч дэмжинэ).
    const password = decryptSecret(settings.password);
    const accessToken = decryptSecret(settings.accessToken);
    const refreshToken = decryptSecret(settings.refreshToken);

    const now = Date.now();
    const accessValid =
      accessToken &&
      settings.tokenExpiresAt &&
      settings.tokenExpiresAt.getTime() - now > TOKEN_EXPIRY_BUFFER_MS;
    if (accessValid) {
      return { accessToken: accessToken!, expiresAt: settings.tokenExpiresAt! };
    }

    const refreshValid =
      refreshToken &&
      settings.refreshTokenExpiresAt &&
      settings.refreshTokenExpiresAt.getTime() - now > TOKEN_EXPIRY_BUFFER_MS;
    if (refreshValid) return refreshAccessToken(id, refreshToken!);

    return fetchNewToken(id, settings.username, password ?? "");
  }

  /**
   * Шинэ invoice үүсгэнэ. `senderInvoiceNo` нь дуудагч талын өөрийн
   * SubscriptionPayment/OrderPayment.id-г QPay-руу дамжуулдаг түлхүүр.
   * Хариунд QR image (base64) + invoice_id ирнэ.
   *
   * `allow_partial`/`allow_exceed`-ийг ЭНД тогтмол false тавьсан — доод тал нь
   * QPay-ийн invoice түвшинд дутуу/илүү дүнгээр "төлөгдсөн" гэж бүртгэгдэхээс
   * сэргийлнэ (дуудагч тал `checkPayment`-ийн `paidAmount`-ыг заавал expected-тэй
   * дахин тулгах ёстой хэвээр — QPay-ийн P2P (банкны шилжүүлэг) гүйлгээнд энэ
   * хязгаарлалт баталгаат биш байж болзошгүй тул).
   */
  async function createInvoice(args: {
    id: Id;
    senderInvoiceNo: string;
    invoiceReceiverCode: string;
    invoiceDescription: string;
    amount: number;
    callbackUrl?: string;
  }): Promise<QPayInvoiceCreated | { error: string }> {
    const tokenResult = await getAccessToken(args.id);
    if ("error" in tokenResult) return { error: tokenResult.error };
    const settings = await store.getSettings(args.id);
    if (!settings) return { error: store.messages.notConfigured };

    const res = await fetch(`${QPAY_URL}invoice`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        invoice_code: settings.invoiceCode,
        sender_invoice_no: args.senderInvoiceNo,
        invoice_receiver_code: args.invoiceReceiverCode,
        invoice_description: args.invoiceDescription,
        amount: args.amount,
        callback_url: args.callbackUrl ?? settings.callbackUrl ?? undefined,
        allow_partial: false,
        allow_exceed: false,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: `QPay invoice үүсгэхэд алдаа: ${res.status} ${text}` };
    }
    return (await res.json()) as QPayInvoiceCreated;
  }

  /**
   * Үүсгэсэн invoice-ийн дэлгэрэнгүйг (банкны deeplink `urls` зэрэг) QPay-аас
   * дахин татна. invoice create-ийн хариунд urls ирээгүй, эсвэл хуучин код
   * хадгалаагүй pending төлбөрийн urls-ийг нөхөхөд хэрэглэнэ.
   */
  async function getInvoiceUrls(id: Id, invoiceId: string): Promise<QPayBankUrl[] | null> {
    if (!invoiceId) return null;
    const tokenResult = await getAccessToken(id);
    if ("error" in tokenResult) return null;

    const res = await fetch(`${QPAY_URL}invoice/${invoiceId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { urls?: QPayBankUrl[] };
    return Array.isArray(data.urls) ? data.urls : null;
  }

  /**
   * Invoice-ийн бүх гүйлгээг татаж, `expectedAmount`-той тулгана.
   *   - `paid`: PAID мөр байгаа БА (expectedAmount өгөгдөөгүй, эсвэл) нийт
   *     төлсөн дүн (`paidAmount`) >= expected.
   *   - `underpaidAmount`: 0 < paidAmount < expected үед л утгатай (дутуу
   *     төлбөр — дуудагч тал "дутуу" гэж тэмдэглэнэ).
   *   - `paymentType`: PAID мөрийн P2P/CARD төрөл — буцаалт (refund) зөвхөн
   *     CARD-д л QPay API-аар боломжтой тул дуудагч тал үүгээр шийднэ.
   */
  async function checkPayment(
    id: Id,
    invoiceId: string,
    expectedAmount?: number,
  ): Promise<QPayCheckResult> {
    const result = await checkPaymentExact(id, invoiceId, expectedAmount === undefined ? undefined : String(expectedAmount));
    if ("error" in result) return result;
    return {
      ...result,
      paidAmount: Number(result.paidAmount),
      underpaidAmount: result.underpaidAmount === null ? null : Number(result.underpaidAmount),
    };
  }

  async function checkPaymentExact(
    id: Id,
    invoiceId: string,
    expectedAmount?: string,
  ): Promise<QPayExactCheckResult> {
    if (!invoiceId) return { error: "invoice_id шаардлагатай." };
    const tokenResult = await getAccessToken(id);
    if ("error" in tokenResult) return { error: tokenResult.error };

    const res = await fetch(`${QPAY_URL}payment/check`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        object_type: "INVOICE",
        object_id: invoiceId,
        offset: { page_number: 1, page_limit: 100 },
      }),
    });
    if (!res.ok) return { error: `QPay шалгалт алдаа: ${res.status}` };

    const data = (await res.json()) as QPayCheckResponse;
    const paidRow = data.rows?.find((r) => r.payment_status === "PAID") ?? null;
    const paidAmountText = String(data.paid_amount ?? "0").trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(paidAmountText)) {
      return { error: "QPay буруу төлөгдсөн дүн буцаалаа." };
    }
    let paidAmount: Prisma.Decimal;
    try {
      paidAmount = new Prisma.Decimal(paidAmountText);
    } catch {
      return { error: "QPay буруу төлөгдсөн дүн буцаалаа." };
    }
    if (!paidAmount.isFinite() || paidAmount.lt(0)) {
      return { error: "QPay буруу төлөгдсөн дүн буцаалаа." };
    }
    let expected: Prisma.Decimal | undefined;
    if (expectedAmount !== undefined) {
      if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(expectedAmount)) {
        return { error: "QPay хүлээгдэж буй дүн буруу байна." };
      }
      try {
        expected = new Prisma.Decimal(expectedAmount);
      } catch {
        return { error: "QPay хүлээгдэж буй дүн буруу байна." };
      }
      if (!expected.isFinite() || expected.lt(0)) {
        return { error: "QPay хүлээгдэж буй дүн буруу байна." };
      }
    }

    // Бүтэн эсэхийг ЭНД (core түвшинд) дуудагч талд БҮГД өөрсдөө давхар
    // шалгах шаардлагагүй болгож нэгтгэсэн — expectedAmount өгөгдсөн бол
    // ашиглана.
    const fullyPaid =
      Boolean(paidRow) &&
      (expected === undefined || paidAmount.gte(expected));
    const underpaidAmount =
      !fullyPaid && expected !== undefined && paidAmount.gt(0)
        ? paidAmount.toString()
        : null;

    return {
      paid: fullyPaid,
      paymentId: paidRow?.payment_id ?? null,
      paidAt: paidRow?.payment_date ? new Date(paidRow.payment_date) : null,
      paidAmount: paidAmount.toString(),
      underpaidAmount,
      paymentType: paidRow?.payment_type ?? paidRow?.transaction_type ?? null,
    };
  }

  /**
   * `cancel`/`refund` хоёул ижил хэлбэртэй: `DELETE /v2/payment/{action}/{id}`,
   * body `{ callback_url, note }`. QPay-ийн нийтэд нээлттэй баримт бичигт
   * зөвхөн cancel-ийн жишээ URL/body баталгаажсан (2026-09-02 судалгаагаар) —
   * refund ижил хэлбэртэй гэж таамаглаж хэрэгжүүлсэн тул PROD дээр эхлээд
   * sandbox-д туршиж баталгаажуулах шаардлагатай.
   *
   * ⚠️ QPay-ийн баримт бичигт зөвхөн КАРТЫН гүйлгээнд ажилладаг гэж
   * тодорхойлогдсон (P2P/банкны шилжүүлгээр төлсөн invoice-д ажиллахгүй
   * байж болзошгүй) — дуудахаасаа өмнө `checkPayment`-ийн
   * `paymentType === "CARD"` эсэхийг шалгасан байх ёстой.
   */
  async function deletePayment(
    id: Id,
    action: "cancel" | "refund",
    paymentId: string,
    note?: string,
  ): Promise<{ ok: true } | { error: string }> {
    if (!paymentId) return { error: "payment_id шаардлагатай." };
    const tokenResult = await getAccessToken(id);
    if ("error" in tokenResult) return { error: tokenResult.error };
    const settings = await store.getSettings(id);

    const res = await fetch(`${QPAY_URL}payment/${action}/${paymentId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        callback_url: settings?.callbackUrl ?? undefined,
        note: note ?? undefined,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        error: `QPay ${action === "cancel" ? "цуцлахад" : "буцаахад"} алдаа: ${res.status} ${text}`,
      };
    }
    return { ok: true };
  }

  /**
   * Invoice-ийг QPay дээр цуцална: `DELETE /v2/invoice/{invoice_id}`.
   * HTTP алдааг ХЭЗЭЭ Ч throw хийхгүй — төрөлжсөн үр дүн буцаана:
   *   - `ok: true`                       — цуцлагдлаа
   *   - `reason: "not_found"`            — QPay-д аль хэдийн байхгүй/цуцлагдсан (дуудагчид OK)
   *   - `reason: "already_paid"`         — invoice төлөгдсөн тул цуцлах боломжгүй
   *   - `reason: "not_configured"`       — tenant-ийн QPay тохиргоо байхгүй/идэвхгүй/дутуу
   *   - `reason: "http_error"`           — бусад бүх алдаа (сүлжээ, 5xx, token гэх мэт)
   */
  async function cancelInvoice(id: Id, invoiceId: string): Promise<QPayCancelInvoiceResult> {
    if (!invoiceId) return { ok: false, reason: "not_found" };
    try {
      const settings = await store.getSettings(id);
      if (
        !settings ||
        store.checkAvailable?.(settings) ||
        !settings.username ||
        !settings.password ||
        !settings.invoiceCode
      ) {
        return { ok: false, reason: "not_configured" };
      }
      const tokenResult = await getAccessToken(id);
      if ("error" in tokenResult) {
        return { ok: false, reason: "http_error", message: tokenResult.error };
      }
      const res = await fetch(`${QPAY_URL}invoice/${encodeURIComponent(invoiceId)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${tokenResult.accessToken}`,
          "Content-Type": "application/json",
        },
      });
      if (res.ok) return { ok: true };
      const text = await res.text().catch(() => "");
      return classifyCancelInvoiceFailure(res.status, text);
    } catch (error) {
      return {
        ok: false,
        reason: "http_error",
        message: error instanceof Error ? error.name : "UnknownError",
      };
    }
  }

  return {
    getAccessToken,
    createInvoice,
    cancelInvoice,
    getInvoiceUrls,
    checkPayment,
    checkPaymentExact,
    cancelPayment: (id: Id, paymentId: string, note?: string) =>
      deletePayment(id, "cancel", paymentId, note),
    refundPayment: (id: Id, paymentId: string, note?: string) =>
      deletePayment(id, "refund", paymentId, note),
  };
}
