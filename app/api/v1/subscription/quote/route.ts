// Contract — POST /api/v1/subscription/quote (Энтерпрайз багцын үнийн санал авах)
//
// Эрх: зөвхөн эзэмшигч. Багц дууссан/түгжигдсэн үед ч нээлттэй. Модулийн хаалтгүй.
// Вэбийн submitQuoteRequestAction (source=dashboard)-тэй нэг логик:
// lib/quote-requests.ts parseQuoteRequestInput (шалгалт) +
// lib/quote-requests-server.ts saveQuoteRequest (хадгалах + систем админд
// мэдэгдэл). Хүсэлт тенанттай холбогдоно. Rate limit вэбтэй ижил bucket
// (IP тутам 10 минутад 5).
//
// Body: { orgName: string, contactName: string, phone: string,
//         email?: string, branchCount?: number|string, modules: string[],
//         message?: string }
//   modules — GET /api/v1/subscription → moduleCatalog[].code; дор хаяж 1.
// 201: { ok: true, id }
// Алдаа: 400 VALIDATION { fieldErrors }, 401, 403, 429.

import { enforceRateLimit, jsonError, jsonForbidden, jsonOk, requireApiUser } from "@/lib/api";
import { parseQuoteRequestInput } from "@/lib/quote-requests";
import {
  QUOTE_REQUEST_RATE_BUCKET,
  QUOTE_REQUEST_RATE_LIMIT,
  saveQuoteRequest,
} from "@/lib/quote-requests-server";

function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  if (!auth.user.isOwner) return jsonForbidden("Зөвхөн админ үнийн санал илгээнэ.");

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "JSON body шаардлагатай.", { code: "VALIDATION" });
  }
  const input = body as Record<string, unknown>;

  const limited = enforceRateLimit(req, QUOTE_REQUEST_RATE_BUCKET, QUOTE_REQUEST_RATE_LIMIT);
  if (limited) return limited;

  const parsed = parseQuoteRequestInput({
    orgName: str(input.orgName),
    contactName: str(input.contactName),
    phone: str(input.phone),
    email: str(input.email),
    branchCount: str(input.branchCount),
    modules: Array.isArray(input.modules)
      ? input.modules.filter((v): v is string => typeof v === "string")
      : [],
    message: str(input.message),
  });
  if (!parsed.ok) {
    const first = Object.values(parsed.fieldErrors)[0] ?? "Өгөгдөл буруу.";
    return jsonError(400, first, { code: "VALIDATION", fieldErrors: parsed.fieldErrors });
  }

  const created = await saveQuoteRequest(parsed.data, auth.user.tenantId);
  return jsonOk({ ok: true, id: created.id }, { status: 201 });
}
