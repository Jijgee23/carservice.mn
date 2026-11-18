// Contract — POST /api/v1/employees/import
//
// Ажилтныг олноор үүсгэнэ — preview-ийн `rows`-ыг (шаардлагатай бол засаад) илгээнэ. Мөр бүр ТУСАД нь
// (all-or-nothing БИШ): алдаатай мөр алгасагдаж, үлдсэн нь бүртгэгдэнэ; амжилттай бүр аудитад бичигдэнэ.
// Вэбийн importEmployeesAction-тай ИЖИЛ логик (lib/employees/import-service.ts runEmployeeImport).
//
// Body: { rows: ImportRow[] } — 1–500 мөр; ImportRow = { key, excelRow, lastName, firstName, phone, email,
//       roleId, branchId, activeUntil, roleRaw, branchRaw } (preview.rows-той ижил).
// Эрх: employees.create. Идэвхтэй захиалга шаардана. Rate limit: 10 / 10 мин (хэрэглэгчээр).
// 200: { succeeded, failed, results: [{ key, ok, error?, fieldErrors? }] } — хэсэг нь амжилтгүй байсан ч 200.
// Errors: 400 (JSON), 401, 403, 422 (мөр хоосон / 500-аас олон / буруу хэлбэр), 429.

import { enforceRateLimit, jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { parseImportRowsPayload } from "@/lib/employees/import";
import { runEmployeeImport } from "@/lib/employees/import-service";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "employees.create");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const limited = enforceRateLimit(req, "employees-import", { limit: 10, windowMs: 10 * 60_000 }, auth.user.id);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  const rows = parseImportRowsPayload(body && typeof body === "object" ? (body as { rows?: unknown }).rows : null);
  if (!rows) {
    return jsonError(422, "Оруулах мөр алга эсвэл хүсэлт буруу (1–500 мөр).", { code: "VALIDATION", fieldErrors: { rows: "1–500 мөр шаардлагатай." } });
  }

  const result = await runEmployeeImport(auth.user, rows);
  return jsonOk({ succeeded: result.succeeded, failed: result.failed, results: result.results });
}
