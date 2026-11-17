// Contract — GET/PATCH /api/v1/tenant/order-settings (засварын хуудасны тохиргоо)
//
// GET
//   Эрх: нэвтэрсэн бүх ажилтан — апп засварын хуудас нээх формд (заавал
//   талбар, шалгах жагсаалт) болон хэвлэлтэд хэрэглэнэ. `canEdit` = isOwner.
//   200: { settings: OrderSettings, canEdit }
//
// PATCH
//   Зөвхөн эзэмшигч (вэбийн /dashboard/settings/orders-тэй адил). Хэсэгчилсэн
//   шинэчлэл: ирсэн талбарыг одоогийн утгатай нэгтгээд бүтнээр шалгана
//   (lib/orders/order-settings.ts validateOrderSettings). Шалгах жагсаалтын
//   шинэ мөрөнд `id` өгөхгүй байж болно (сервер үүсгэнэ); хуучин мөрийн id-г
//   хадгалж илгээнэ.
//   200: GET-тэй ижил. Алдаа: 400 VALIDATION {fieldErrors}, 401, 403.

import { jsonError, jsonForbidden, jsonOk, requireApiUser } from "@/lib/api";
import { ORDER_SETTINGS_DEFAULTS } from "@/lib/orders/order-settings";
import { getOrderSettings, updateOrderSettings } from "@/lib/orders/order-settings-server";
import { prisma } from "@/lib/prisma";

const ALLOWED_FIELDS = new Set(Object.keys(ORDER_SETTINGS_DEFAULTS));

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const settings = await getOrderSettings(prisma, auth.user.tenantId);
  return jsonOk({ settings, canEdit: auth.user.isOwner });
}

export async function PATCH(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!auth.user.isOwner) return jsonForbidden("Зөвхөн админ тохиргоог өөрчилнө.");

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "Буруу өгөгдөл", { code: "VALIDATION" });
  }
  const input = body as Record<string, unknown>;
  const unknown = Object.keys(input).filter((k) => !ALLOWED_FIELDS.has(k));
  if (unknown.length > 0) {
    return jsonError(400, "Тодорхойгүй талбар.", {
      code: "VALIDATION",
      fieldErrors: Object.fromEntries(unknown.map((k) => [k, "Тодорхойгүй талбар."])),
    });
  }
  if (Object.keys(input).length === 0) {
    return jsonError(400, "Шинэчлэх талбар илгээнэ үү.", { code: "VALIDATION", fieldErrors: {} });
  }

  const result = await updateOrderSettings({ tenantId: auth.user.tenantId, userId: auth.user.id }, input);
  if (!result.ok) {
    return jsonError(400, Object.values(result.fieldErrors)[0] ?? "Оруулсан мэдээлэл буруу.", {
      code: "VALIDATION",
      fieldErrors: result.fieldErrors,
    });
  }
  return jsonOk({ settings: result.value, canEdit: true });
}
