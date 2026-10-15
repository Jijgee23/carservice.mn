/**
 * QPay merchant integration. Платформ-level singleton credentials
 * (`QPaySettings` row id=1) ашиглана. Super admin тохиргоог удирдана.
 *
 *   - getAccessToken(): merchant token-ыг кэш + refresh-той хослуулан
 *   - createInvoice(): payment-н үнийн дүн, дугаараар QR + invoice id буцаана
 *   - checkPayment(invoice_id): тухайн invoice PAID болсон эсэх + payment_id
 *
 * HTTP/token логик нь `lib/qpay-core.ts`-д нийтлэг — энд зөвхөн платформын
 * (`QPaySettings`) эх сурвалж рүү холбоно. Tenant-level хувилбар: `lib/qpay-tenant.ts`.
 */

import { prisma } from "@/lib/prisma";
import { createQPayClient, type QPayStore } from "@/lib/qpay-core";

export type {
  QPayBankUrl,
  QPayInvoiceCreated,
  QPayPaymentStatus,
  QPayCheckResponse,
} from "@/lib/qpay-core";

const store: QPayStore<void> = {
  async getSettings() {
    return await prisma.qPaySettings.findUnique({ where: { id: 1 } });
  },
  async saveTokens(_id, tokens) {
    await prisma.qPaySettings.update({ where: { id: 1 }, data: tokens });
  },
  messages: {
    notConfigured:
      "QPay тохиргоо олдсонгүй. Super admin талд QPay-ийн мэдээлэл оруулна уу.",
    incomplete:
      "QPay тохиргоо бүрэн биш. Username, Password болон Invoice Code хэрэгтэй.",
  },
};

const client = createQPayClient(store);

export const QPayService = {
  getAccessToken: () => client.getAccessToken(undefined),

  createInvoice: (args: {
    senderInvoiceNo: string;
    invoiceReceiverCode: string;
    invoiceDescription: string;
    amount: number;
    callbackUrl?: string;
  }) => client.createInvoice({ id: undefined, ...args }),

  checkPayment: (invoiceId: string, expectedAmount?: number) =>
    client.checkPayment(undefined, invoiceId, expectedAmount),

  /** Төлөгдөөгүй invoice-ийг QPay дээр цуцлах (DELETE invoice/{id}); хэзээ ч throw хийхгүй. */
  cancelInvoice: (invoiceId: string) => client.cancelInvoice(undefined, invoiceId),

  /** Гүйлгээ цуцлах ("card reversal" — ихэвчлэн тухайн өдөрт нь, capture-аас өмнө). */
  cancelPayment: (paymentId: string, note?: string) =>
    client.cancelPayment(undefined, paymentId, note),

  /**
   * Төлбөр буцаах. P2P (банкны шилжүүлэг/QR)-ээр төлсөн гүйлгээг ЭНЭ API-аар
   * буцаах боломжгүй; тэдгээрийг гараар буцааж, зөвхөн DB-д тэмдэглэнэ
   * (app/_actions/booking-revenue.ts-ийн refundAppointmentPaymentAction).
   */
  refundPayment: (paymentId: string, note?: string) =>
    client.refundPayment(undefined, paymentId, note),
};
