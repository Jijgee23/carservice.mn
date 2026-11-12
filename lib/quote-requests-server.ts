import "server-only";

// Энтерпрайз багцын үнийн саналын хүсэлтийг хадгалах + систем админд мэдэгдэх.
// Вэбийн submitQuoteRequestAction (app/_actions/quote-requests.ts) болон
// мобайл staff API (POST /api/v1/subscription/quote) хоёулаа ЭНД дуудна.
// Шалгалт нь lib/quote-requests.ts-ийн parseQuoteRequestInput.

import { notifySuperAdmins } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import type { QuoteRequestInput } from "@/lib/quote-requests";
import { setBypassContext } from "@/lib/tenant-context";

/** Rate limit bucket — вэб (IP) болон API хоёр ижил bucket хуваалцана. */
export const QUOTE_REQUEST_RATE_LIMIT = { limit: 5, windowMs: 10 * 60_000 } as const;
export const QUOTE_REQUEST_RATE_BUCKET = "quote-request-ip";

export async function saveQuoteRequest(
  data: QuoteRequestInput,
  tenantId: string | null,
): Promise<{ id: string }> {
  // Нүүр хуудаснаас ирсэн мөр tenantId-гүй тул RLS bypass (Feedback-тэй адил).
  setBypassContext();
  const created = await prisma.quoteRequest.create({
    data: { ...data, tenantId },
    select: { id: true },
  });

  try {
    await notifySuperAdmins({
      type: "quote_request_created",
      input: {
        quoteRequestId: created.id,
        orgName: data.orgName,
        moduleCount: String(data.modules.length),
      },
    });
  } catch (err) {
    console.warn("[notify] quote_request_created:", err);
  }

  return created;
}
