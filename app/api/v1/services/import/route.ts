// Contract — POST /api/v1/services/import
//
// Ажил/сэлбэгийг олноор үүсгэнэ — preview-ийн `rows`-ыг (шаардлагатай бол засаад) илгээнэ. Мөр бүр ТУСАД нь
// (all-or-nothing БИШ); системд бүртгэлтэй кодтой мөрийг алгасна. Вэбийн importServicesAction-тай ИЖИЛ логик
// (lib/services/import-service.ts runServiceImportForActor).
//
// Body: { type: "LABOR" | "GOODS", rows: ServiceImportRow[] } — 1–500 мөр (preview.rows-той ижил хэлбэр).
// Эрх: services.create. Идэвхтэй захиалга шаардана. Rate limit: 10 / 10 мин.
// 200: { succeeded, failed, results: [{ key, ok, error?, fieldErrors? }] } — хэсэг нь амжилтгүй байсан ч 200.
// Errors: 400, 401, 403, 422 (type/мөр), 429.

import { enforceRateLimit, jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { parseServiceImportPayload } from "@/lib/services/import";
import { isImportServiceKind, runServiceImportForActor } from "@/lib/services/import-service";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "services.create");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;
  const limited = enforceRateLimit(req, "services-import", { limit: 10, windowMs: 10 * 60_000 }, auth.user.id);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  const rec = body && typeof body === "object" ? (body as { type?: unknown; rows?: unknown }) : {};
  if (!isImportServiceKind(rec.type)) {
    return jsonError(422, "type нь LABOR эсвэл GOODS байх ёстой.", { code: "VALIDATION", fieldErrors: { type: "LABOR | GOODS" } });
  }
  const rows = parseServiceImportPayload(rec.rows);
  if (!rows) {
    return jsonError(422, "Оруулах мөр алга эсвэл хүсэлт буруу (1–500 мөр).", { code: "VALIDATION", fieldErrors: { rows: "1–500 мөр шаардлагатай." } });
  }

  const result = await runServiceImportForActor(auth.user, rec.type, rows);
  return jsonOk({ succeeded: result.succeeded, failed: result.failed, results: result.results });
}
