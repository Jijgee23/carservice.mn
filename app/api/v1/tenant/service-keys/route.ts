// Contract — GET/PUT /api/v1/tenant/service-keys (байгууллагын үзүүлдэг үйлчилгээ)
//
// Вэбийн dashboard-ын «Танайх ямар үйлчилгээ үзүүлдэг вэ?» dialog / Тохиргоо →
// «Үзүүлдэг үйлчилгээ»-тэй ижил (lib/tenant-service-keys.ts). Жолооч нар
// /book, газрын зураг дээр ажлаараа хайхад байгууллага эдгээрээр гарна.
//
// GET
//   Эрх: нэвтэрсэн бүх ажилтан. `canEdit` = isOwner.
//   200: { keys: [{ id, name, description }], selectedIds: string[],
//          confirmed: boolean, canEdit: boolean }
//   confirmed=false ба isOwner бол апп сонголтыг ЗААВАЛ хийлгэнэ (вэбийн
//   хааж болохгүй dialog-тэй адил).
//
// PUT
//   Зөвхөн эзэмшигч. Body: { serviceKeyIds: string[] } (дор хаяж 1 идэвхтэй id;
//   идэвхгүй/хуурамч id-г алгасна). Сонголтыг бүхэлд нь солино, confirmed=true.
//   200: GET-тэй ижил. Алдаа: 400 VALIDATION, 401, 403.

import { jsonError, jsonForbidden, jsonOk, requireApiUser } from "@/lib/api";
import { loadServiceKeyChoices, saveTenantServiceKeys } from "@/lib/tenant-service-keys";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const choices = await loadServiceKeyChoices(auth.user.tenantId);
  return jsonOk({ ...choices, canEdit: auth.user.isOwner });
}

export async function PUT(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!auth.user.isOwner) return jsonForbidden("Зөвхөн байгууллагын эзэн өөрчилнө.");

  const body = await req.json().catch(() => null);
  const ids = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).serviceKeyIds
    : undefined;
  if (!Array.isArray(ids)) {
    return jsonError(400, "serviceKeyIds (string[]) шаардлагатай.", {
      code: "VALIDATION",
      fieldErrors: { serviceKeyIds: "serviceKeyIds (string[]) шаардлагатай." },
    });
  }
  const result = await saveTenantServiceKeys({ tenantId: auth.user.tenantId, userId: auth.user.id }, ids);
  if (!result.ok) {
    return jsonError(400, result.message, { code: "VALIDATION", fieldErrors: { serviceKeyIds: result.message } });
  }
  const choices = await loadServiceKeyChoices(auth.user.tenantId);
  return jsonOk({ ...choices, canEdit: true });
}
