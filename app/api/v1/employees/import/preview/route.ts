// Contract — POST /api/v1/employees/import/preview  (multipart/form-data)
//
// «Excel-ээс ажилтан оруулах»-ын 1–3-р алхмыг НЭГ дуудлагаар: файл → гарчиг → баганыг автоматаар таах →
// үүрэг/салбарыг нэрээр таних → мөр бүрийн шалгалт, файл доторх болон бүртгэлтэй давхцал.
// Вэбийн wizard-тай ИЖИЛ логик (lib/employees/import-service.ts). Юу ч үүсгэхгүй.
//
// Form: file (.xlsx, ≤ 2MB, ≤ 500 мөр, шаардлагатай), mapping (заавал биш JSON: { lastName: 0, firstName: 1,
//       phone: 2, email: 3, role: 4, branch: null, activeUntil: null } — баганын индекс, null = байхгүй;
//       өгөөгүй бол гарчгаар автоматаар таана).
// Эрх: employees.create. Идэвхтэй захиалга шаардана. Rate limit: 20 / 10 мин (хэрэглэгчээр).
// 200: { preview: { headers, mapping, fields, rows, rowErrors, inFileDuplicates, taken, roles, branches, readyCount },
//        fileName }
//      rows нь POST /api/v1/employees/import-д шууд (засаад) илгээх мөрүүд.
// Errors: 400 (файл/mapping), 401, 403, 413, 415 (.xlsx биш), 422 (хоосон/хэт олон мөр, уншигдсангүй), 429.

import { enforceRateLimit, jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { EMPLOYEE_IMPORT_FIELD_KEYS, previewEmployeeImport } from "@/lib/employees/import-service";
import { ImportParseError, parseEmployeeWorkbook } from "@/lib/employees/import-server";
import { checkUploadedWorkbook, parseMappingInput, rejectOversizedRequest } from "@/lib/import/upload";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "employees.create");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const limited = enforceRateLimit(req, "employees-import-preview", { limit: 20, windowMs: 10 * 60_000 }, auth.user.id);
  if (limited) return limited;

  const tooBig = rejectOversizedRequest(req.headers.get("content-length"));
  if (tooBig) return jsonError(tooBig.status, tooBig.message);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "multipart/form-data хүсэлт шаардлагатай.");
  }
  const upload = checkUploadedWorkbook(form.get("file"));
  if (!upload.ok) return jsonError(upload.status, upload.message);

  let sheet;
  try {
    sheet = await parseEmployeeWorkbook(await upload.file.arrayBuffer());
  } catch (e) {
    if (e instanceof ImportParseError) return jsonError(422, e.message, { code: "IMPORT_PARSE" });
    console.error("[employees/import/preview] parse failed:", e instanceof Error ? e.name : e);
    return jsonError(422, "Файлыг уншиж чадсангүй.", { code: "IMPORT_PARSE" });
  }

  const mapping = parseMappingInput(form.get("mapping"), EMPLOYEE_IMPORT_FIELD_KEYS, sheet.headers.length);
  if (!mapping.ok) return jsonError(400, mapping.message, { code: "VALIDATION", fieldErrors: { mapping: mapping.message } });

  const preview = await previewEmployeeImport({ tenantId: auth.user.tenantId, sheet, mapping: mapping.mapping });
  return jsonOk({ fileName: upload.file.name, preview });
}
