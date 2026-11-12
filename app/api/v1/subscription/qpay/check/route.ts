// Contract — POST /api/v1/subscription/qpay/check
//
// Эрх: зөвхөн эзэмшигч. Багц дууссан/түгжигдсэн үед ч нээлттэй. Модулийн хаалтгүй.
// Вэбийн checkSubscriptionPaymentAction-тэй нэг логик
// (lib/subscription-payments.ts checkTenantSubscriptionPayment →
// confirmSubscriptionPayment): QPay-аас бие даан шалгаж, бүрэн төлөгдсөн бол
// subscription идэвхжүүлнэ. Дахин дуудсан ч idempotent — апп polling хийнэ.
//
// Body: { paymentId: string }
// 200: { paid: boolean, message?: string }
//   (paid=false + message — дутуу төлөгдсөн гэх мэт; message-гүй бол хүлээгдэж буй)
// Алдаа: 400 VALIDATION, 401, 403, 404 NOT_FOUND (энэ тенантын төлбөр биш),
//   502 QPAY_ERROR (QPay шалгалт/идэвхжүүлэлт амжилтгүй — дахин оролдоно).

import { jsonError, jsonForbidden, jsonOk, requireApiUser } from "@/lib/api";
import { checkTenantSubscriptionPayment } from "@/lib/subscription-payments";

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!auth.user.isOwner) return jsonForbidden("Зөвхөн админ багц авна.");

  const body = await req.json().catch(() => null);
  const raw = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).paymentId
    : undefined;
  const paymentId = typeof raw === "string" ? raw.trim() : "";
  if (!paymentId) return jsonError(400, "paymentId шаардлагатай.", { code: "VALIDATION" });

  const result = await checkTenantSubscriptionPayment(auth.user.tenantId, paymentId);
  if (result.notFound) return jsonError(404, "Төлбөр олдсонгүй.", { code: "NOT_FOUND" });
  if (!result.ok) {
    return jsonError(502, result.message ?? "Төлбөр шалгахад алдаа гарлаа.", { code: "QPAY_ERROR" });
  }
  return jsonOk(result.message ? { paid: result.paid, message: result.message } : { paid: result.paid });
}
