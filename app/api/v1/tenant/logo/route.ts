// Contract — POST/DELETE /api/v1/tenant/logo (байгууллагын лого)
//
// Хоёулаа зөвхөн эзэмшигч (`auth.user.isOwner`) — app/_actions/tenant.ts-ийн
// `uploadTenantLogoAction` / `removeTenantLogoAction`-тэй адил логик
// (lib/tenant-settings.ts). Файлын шалгалт lib/storage.ts: PNG/JPG/WEBP,
// 2MB хүртэл, агуулгаар нь (magic bytes) шалгана.
//
// POST /api/v1/tenant/logo
//   Body: multipart/form-data, `file` талбарт зураг.
//   200: { logoUrl: string }
//   Алдаа: 400 VALIDATION { fieldErrors: { file } }, 401, 403.
//
// DELETE /api/v1/tenant/logo
//   200: { logoUrl: null }
//   Алдаа: 401, 403.

import { jsonError, jsonForbidden, jsonOk, requireApiUser } from "@/lib/api";
import { removeTenantLogo, replaceTenantLogo } from "@/lib/tenant-settings";

const OWNER_ONLY_MESSAGE = "Зөвхөн админ тохиргоог өөрчилнө.";

function fileError(message: string) {
  return jsonError(400, message, { code: "VALIDATION", fieldErrors: { file: message } });
}

/**
 * POST /api/v1/tenant/logo — шинэ лого байршуулж, хуучныг устгана.
 * Зөвхөн эзэмшигч.
 */
export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!auth.user.isOwner) return jsonForbidden(OWNER_ONLY_MESSAGE);

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonError(400, "Multipart form-data илгээнэ үү.");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fileError("Файл сонгоно уу.");
  }

  const result = await replaceTenantLogo(
    { tenantId: auth.user.tenantId, userId: auth.user.id },
    file,
  );
  if (!result.ok) return fileError(result.message ?? "Лого хадгалахад алдаа гарлаа.");

  return jsonOk({ logoUrl: result.logoUrl });
}

/**
 * DELETE /api/v1/tenant/logo — логог устгана (файл + DB). Зөвхөн эзэмшигч.
 */
export async function DELETE(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!auth.user.isOwner) return jsonForbidden(OWNER_ONLY_MESSAGE);

  await removeTenantLogo({ tenantId: auth.user.tenantId, userId: auth.user.id });
  return jsonOk({ logoUrl: null });
}
