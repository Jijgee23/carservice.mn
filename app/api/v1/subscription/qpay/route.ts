// Contract — /api/v1/subscription/qpay (багцын QPay төлбөр: үүсгэх / цуцлах)
//
// Эрх: зөвхөн эзэмшигч (`auth.user.isOwner`) — вэбийн «Багц» хуудсанд
// төлбөрийн хэсэг зөвхөн эзэмшигчид харагддаг, createSubscriptionPaymentAction
// isOwner шаарддагтай адил. Багц дууссан/түгжигдсэн үед ч нээлттэй
// (requireActiveSubscriptionApi дууддаггүй — сунгах боломжтой байх ёстой).
// Модулийн хаалтгүй. Логик: lib/subscription-payments.ts (вэбтэй нэг).
//
// POST /api/v1/subscription/qpay
//   Body: { planPriceId: string }  (GET /api/v1/subscription → prices[].id)
//   201: { payment: { id, plan, period, amount: string, currency, qrImage,
//          qrText, urls: QPayBankUrl[], createdAt } }
//     — qrImage нь base64 PNG, qrText нь QR текст, urls нь банкны апп-ын
//       deeplink-ууд (/orders/[id]/qpay-тай ижил хэлбэр).
//   Алдаа: 400 VALIDATION (planPriceId алга), 401, 403 (эзэмшигч биш),
//     404 NOT_FOUND (үнэ олдсонгүй/идэвхгүй), 422 NOT_SELF_SERVE (FREE/ENTERPRISE),
//     502 QPAY_ERROR (QPay нэхэмжлэх үүсгэж чадсангүй).
//
// DELETE /api/v1/subscription/qpay
//   Body: { paymentId: string } — PENDING төлбөрийг CANCELLED болгоно (QR хаах).
//   200: { ok: true, paymentId, cancelled: boolean }  (PENDING биш/олдоогүй бол cancelled=false)
//   Алдаа: 400 VALIDATION, 401, 403.

import { jsonError, jsonForbidden, jsonOk, requireApiUser } from "@/lib/api";
import {
  cancelTenantSubscriptionPayment,
  createSubscriptionQPayPayment,
} from "@/lib/subscription-payments";

const OWNER_ONLY = "Зөвхөн админ багц авна.";

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!auth.user.isOwner) return jsonForbidden(OWNER_ONLY);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "JSON body шаардлагатай.", { code: "VALIDATION" });
  }
  const raw = (body as Record<string, unknown>).planPriceId;
  const planPriceId = typeof raw === "string" ? raw.trim() : "";

  const result = await createSubscriptionQPayPayment(auth.user, planPriceId);
  if (!result.ok) {
    switch (result.code) {
      case "VALIDATION":
        return jsonError(400, result.message, { code: "VALIDATION", fieldErrors: { planPriceId: result.message } });
      case "NOT_FOUND":
        return jsonError(404, result.message, { code: "NOT_FOUND" });
      case "NOT_SELF_SERVE":
        return jsonError(422, result.message, { code: "NOT_SELF_SERVE" });
      default:
        return jsonError(502, result.message, { code: "QPAY_ERROR" });
    }
  }
  return jsonOk({ payment: result.payment }, { status: 201 });
}

export async function DELETE(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!auth.user.isOwner) return jsonForbidden(OWNER_ONLY);

  const body = await req.json().catch(() => null);
  const raw = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).paymentId
    : undefined;
  const paymentId = typeof raw === "string" ? raw.trim() : "";
  if (!paymentId) {
    return jsonError(400, "paymentId шаардлагатай.", { code: "VALIDATION" });
  }
  const { cancelled } = await cancelTenantSubscriptionPayment(auth.user, paymentId);
  return jsonOk({ ok: true, paymentId, cancelled });
}
