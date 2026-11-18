// Contract — GET /api/v1/system/tenants/[id]
//
// Харилцагчийн дэлгэрэнгүй (мэдээллийн хэсэг). Эрх: tenants.view.
// 200: { tenant: { id, slug, name, registerNumber, email, phone1, phone2, logoUrl, plan, suspended, isTest,
//        acceptsOnlineBooking, createdAt, owners: [{ id, firstName, lastName, phone, email, activated }],
//        primaryBranch: { id, name, phone, city, district, khoroo, address, latitude, longitude } | null,
//        branchCount, employeeCount } }
// Орлого, зээл, багц/төлбөр, захиалга ОРОХГҮЙ. 401, 403, 404 { code: "NOT_FOUND" }.

import { jsonError, jsonOk } from "@/lib/api";
import { requireSystemApiUser } from "@/lib/auth/system-api";
import { getTenantDetail } from "@/lib/system/tenants";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSystemApiUser(req, "tenants.view");
  if (auth.response) return auth.response;
  const { id } = await ctx.params;
  const tenant = await getTenantDetail(id);
  if (!tenant) return jsonError(404, "Байгууллага олдсонгүй.", { code: "NOT_FOUND" });
  return jsonOk({ tenant });
}
