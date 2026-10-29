import { NextResponse } from "next/server";
import { enforceRateLimit, upstreamErrorResponse } from "@/lib/api";
import { lookupOrgByRegno } from "@/lib/ebarimt";
import { normalizeRegno, regnoKind, TENANT_REGNO_MESSAGE } from "@/lib/tenant-regno";

/**
 * Нийтийн endpoint — бүртгүүлэх хуудсанд регистрийн нэрийг автоматаар татахад
 * ашиглана. Auth шаардахгүй (зөвхөн нийтийн мэдээлэл).
 *
 * GET /api/ebarimt/lookup?regno=1234567  (байгууллага)
 * GET /api/ebarimt/lookup?regno=ҮҮ99993333 (хувь хүн)
 */
export async function GET(req: Request) {
  // Нийтийн proxy тул IP-ээр throttle (upstream ban / DoS-аас сэргийлнэ).
  const limited = enforceRateLimit(req, "ebarimt", {
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const url = new URL(req.url);
  const regno = normalizeRegno(url.searchParams.get("regno") ?? "");
  if (!regnoKind(regno)) {
    return NextResponse.json(
      { error: TENANT_REGNO_MESSAGE },
      { status: 400 },
    );
  }

  try {
    const org = await lookupOrgByRegno(regno);
    return NextResponse.json({ org });
  } catch (e) {
    return upstreamErrorResponse("ebarimt-lookup", e, "ebarimt алдаа гарлаа.");
  }
}
