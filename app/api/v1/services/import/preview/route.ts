// Contract — POST /api/v1/services/import/preview  (multipart/form-data)
//
// «Excel-ээс ажил / сэлбэг оруулах»-ын 1–3-р алхмыг НЭГ дуудлагаар: файл → гарчиг → баганыг автоматаар таах →
// ангилал/нэгжийг нэрээр таних → мөр бүрийн шалгалт, давхардсан/бүртгэлтэй код. Юу ч үүсгэхгүй.
// Вэбийн wizard-тай ИЖИЛ логик (lib/services/import-service.ts).
//
// Form: file (.xlsx, ≤ 2MB, ≤ 500 мөр), type = LABOR | GOODS (заавал), mapping (заавал биш JSON — талбар → баганын индекс | null).
// Эрх: services.create. Идэвхтэй захиалга шаардана. Rate limit: 20 / 10 мин.
// 200: { fileName, preview: { type, headers, mapping, fields, rows, rowErrors, inFileDuplicates, takenKeys, categories, units, readyCount } }
// Errors: 400, 401, 403, 413, 415, 422 (type/файл), 429.

import { enforceRateLimit, jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { ImportParseError, parseImportWorkbook } from "@/lib/import/xlsx-server";
import { checkUploadedWorkbook, parseMappingInput, rejectOversizedRequest } from "@/lib/import/upload";
import { isImportServiceKind, previewServiceImport, SERVICE_IMPORT_ALL_FIELDS } from "@/lib/services/import-service";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "services.create");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const limited = enforceRateLimit(req, "services-import-preview", { limit: 20, windowMs: 10 * 60_000 }, auth.user.id);
  if (limited) return limited;

  const tooBig = rejectOversizedRequest(req.headers.get("content-length"));
  if (tooBig) return jsonError(tooBig.status, tooBig.message);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "multipart/form-data хүсэлт шаардлагатай.");
  }
  const type = form.get("type");
  if (!isImportServiceKind(type)) {
    return jsonError(422, "type нь LABOR (ажил) эсвэл GOODS (сэлбэг) байх ёстой.", { code: "VALIDATION", fieldErrors: { type: "LABOR | GOODS" } });
  }
  const upload = checkUploadedWorkbook(form.get("file"));
  if (!upload.ok) return jsonError(upload.status, upload.message);

  let sheet;
  try {
    sheet = await parseImportWorkbook(await upload.file.arrayBuffer());
  } catch (e) {
    if (e instanceof ImportParseError) return jsonError(422, e.message, { code: "IMPORT_PARSE" });
    console.error("[services/import/preview] parse failed:", e instanceof Error ? e.name : e);
    return jsonError(422, "Файлыг уншиж чадсангүй.", { code: "IMPORT_PARSE" });
  }

  const mapping = parseMappingInput(form.get("mapping"), SERVICE_IMPORT_ALL_FIELDS, sheet.headers.length);
  if (!mapping.ok) return jsonError(400, mapping.message, { code: "VALIDATION", fieldErrors: { mapping: mapping.message } });

  const preview = await previewServiceImport({ tenantId: auth.user.tenantId, type, sheet, mapping: mapping.mapping });
  return jsonOk({ fileName: upload.file.name, preview });
}
