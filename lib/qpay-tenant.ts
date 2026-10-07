/**
 * Tenant-level QPay merchant integration.
 *
 * Платформын QPay (`lib/qpay.ts`) нь subscription төлбөрт. Энэ нь захиалгын
 * төлбөрт — байгууллага бүр өөрийн merchant credentials-ээ ашиглана.
 *
 * HTTP/token логик нь `lib/qpay-core.ts`-д нийтлэг — энд зөвхөн tenant-ийн
 * (`TenantQPaySettings`, tenantId-аар түлхүүрлэгдсэн) эх сурвалж рүү холбоно.
 */

import { prisma } from "@/lib/prisma";
import { createQPayClient, type QPayStore, type QPayTokenFields } from "@/lib/qpay-core";

export type {
  QPayBankUrl,
  QPayInvoiceCreated,
  QPayPaymentStatus,
  QPayCheckResponse,
  QPayExactCheckResult,
  QPayCancelInvoiceResult,
} from "@/lib/qpay-core";

type TenantQPaySettingsFields = QPayTokenFields & { enabled: boolean };

const store: QPayStore<string, TenantQPaySettingsFields> = {
  async getSettings(tenantId) {
    return prisma.tenantQPaySettings.findUnique({ where: { tenantId } });
  },
  async saveTokens(tenantId, tokens) {
    await prisma.tenantQPaySettings.update({ where: { tenantId }, data: tokens });
  },
  checkAvailable(settings) {
    return settings.enabled ? null : "QPay тохиргоо идэвхгүй байна.";
  },
  messages: {
    notConfigured: "QPay тохиргоо хийгдээгүй байна. Тохиргооноос оруулна уу.",
    incomplete:
      "QPay тохиргоо бүрэн биш. Username, Password болон Invoice Code хэрэгтэй.",
  },
};

const client = createQPayClient(store);

export const TenantQPayService = {
  getAccessToken: (tenantId: string) => client.getAccessToken(tenantId),

  createInvoice: (args: {
    tenantId: string;
    senderInvoiceNo: string;
    invoiceReceiverCode: string;
    invoiceDescription: string;
    amount: number;
    callbackUrl?: string;
  }) => client.createInvoice({ id: args.tenantId, ...args }),

  getInvoiceUrls: (tenantId: string, invoiceId: string) =>
    client.getInvoiceUrls(tenantId, invoiceId),

  /** Provider-side invoice cancel (DELETE /invoice/{id}); never throws on HTTP errors. */
  cancelInvoice: (tenantId: string, invoiceId: string) => client.cancelInvoice(tenantId, invoiceId),

  /** Legacy number-shaped adapter for the pre-ledger order payment worker. */
  checkPayment: (tenantId: string, invoiceId: string, expectedAmount?: number) =>
    client.checkPayment(tenantId, invoiceId, expectedAmount),

  /** Exact decimal result for ledger-backed order payment confirmation. */
  checkPaymentExact: (tenantId: string, invoiceId: string, expectedAmount?: string) =>
    client.checkPaymentExact(tenantId, invoiceId, expectedAmount),
};
