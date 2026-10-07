import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError, requireApiUser } from "@/lib/api";
import { hasPermission } from "@/lib/auth/roles";
import { isValidOrgRegnum } from "@/lib/customers/org-regnum";
import { lookupOrgByRegno } from "@/lib/ebarimt";
import {
  mapOrgLookupResult,
  orgLookupFailedBody,
  orgRegnoInvalidBody,
  type OrgLookupBody,
} from "@/lib/ebarimt-org-response";

// Phase 4a — ажилтны eBarimt лавлагаа (байгууллагын нэр автоматаар бөглөх).
// Auth: requireApiUser + customers.create ЭСВЭЛ customers.edit. Rate limit:
// хэрэглэгч тутамд 20/мин (нийтийн /api/ebarimt/lookup-ийн IP лимиттэй ижил хэмжээ).
// Хайлт амжилтгүй болсон нь хадгалахыг хэзээ ч блоклохгүй (нэрийг гараар бичнэ).
//
// GET /api/v1/ebarimt/org?regno=1234567

function respond(r: OrgLookupBody) {
  return NextResponse.json(r.body, { status: r.status });
}

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const user = auth.user;
  if (!hasPermission(user, "customers.create") && !hasPermission(user, "customers.edit")) {
    return jsonError(403, "Танд энэ үйлдэл хийх эрх байхгүй.");
  }

  const limited = enforceRateLimit(
    req,
    "ebarimt-org",
    { limit: 20, windowMs: 60_000 },
    user.id,
  );
  if (limited) return limited;

  const regno = new URL(req.url).searchParams.get("regno")?.trim() ?? "";
  if (!isValidOrgRegnum(regno)) return respond(orgRegnoInvalidBody());

  try {
    return respond(mapOrgLookupResult(regno, await lookupOrgByRegno(regno)));
  } catch (e) {
    console.error("[ebarimt-org]", e);
    return respond(orgLookupFailedBody());
  }
}
