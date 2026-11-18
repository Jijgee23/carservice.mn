// Contract — GET /api/v1/system/tenants?q=&status=active|suspended&page=&pageSize=
//
// Харилцагч (байгууллага)-ын жагсаалт. Эрх: tenants.view (STAFF, ROOT). Хайлт: нэр, регистр, имэйл, утас.
// 200: { tenants: [{ id, name, registerNumber, phone1, email, plan, suspended, isTest, createdAt,
//                    owner: { id, firstName, lastName, phone, email, activated } | null }], pagination }
//      owner.activated = false бол эзэн SMS кодоор нууц үгээ тохируулаагүй (activation-code дахин илгээнэ).
// Орлого, зээл, багц/төлбөр, захиалгын мэдээлэл ОРОХГҮЙ. 400 (status буруу), 401, 403.

import { jsonError, jsonOk } from "@/lib/api";
import { requireSystemApiUser } from "@/lib/auth/system-api";
import { buildMeta, getApiPageInfo } from "@/lib/pagination";
import { listTenants, parseTenantStatusFilter } from "@/lib/system/tenants";

export async function GET(req: Request) {
  const auth = await requireSystemApiUser(req, "tenants.view");
  if (auth.response) return auth.response;

  const params = new URL(req.url).searchParams;
  const status = parseTenantStatusFilter(params.get("status"));
  if (status === "invalid") {
    return jsonError(400, "status нь active эсвэл suspended байх ёстой.", { code: "VALIDATION", fieldErrors: { status: "active | suspended" } });
  }
  const { page, pageSize, skip, take } = getApiPageInfo(params);
  const { items, total } = await listTenants({ q: params.get("q"), status, skip, take });
  return jsonOk({ tenants: items, pagination: buildMeta(total, page, pageSize) });
}
