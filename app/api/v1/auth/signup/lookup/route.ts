import { enforceRateLimit, jsonError, jsonOk, upstreamErrorResponse } from "@/lib/api";
import { lookupOrgByRegno } from "@/lib/ebarimt";
import { normalizeRegno, regnoKind, TENANT_REGNO_MESSAGE } from "@/lib/tenant-regno";

/**
 * GET /api/v1/auth/signup/lookup?regno=1234567 (эсвэл ҮҮ99993333) — мобайл
 * бүртгэлийн 1-р алхам: регистрээр нэрийг eBarimt-аас автоматаар бөглөх.
 * Веб бүртгэлийн нийтийн /api/ebarimt/lookup-тэй ижил эх үүсвэр.
 *
 * Хариу: `{ regno, kind: "org" | "person", found, name }`. Нэвтрэлт
 * шаардахгүй; IP-ээр throttle. Олдоогүй нь алдаа биш — нэрийг гараар бичнэ.
 */
export async function GET(req: Request) {
  const limited = enforceRateLimit(req, "api-signup-lookup", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const regno = normalizeRegno(new URL(req.url).searchParams.get("regno") ?? "");
  const kind = regnoKind(regno);
  if (!kind) {
    return jsonError(400, TENANT_REGNO_MESSAGE, {
      code: "VALIDATION",
      fieldErrors: { registerNumber: TENANT_REGNO_MESSAGE },
    });
  }

  try {
    const org = await lookupOrgByRegno(regno);
    return jsonOk({
      regno,
      kind,
      found: Boolean(org.found && org.name),
      name: org.found ? org.name : null,
    });
  } catch (e) {
    return upstreamErrorResponse("api-signup-lookup", e, "Регистр шалгаж чадсангүй.");
  }
}
