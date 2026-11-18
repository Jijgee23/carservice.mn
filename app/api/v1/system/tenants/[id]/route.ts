// Contract — GET /api/v1/system/tenants/[id]
//
// Харилцагчийн дэлгэрэнгүй (мэдээллийн хэсэг). Эрх: tenants.view.
// 200: { tenant: { id, slug, name, registerNumber, email, phone1, phone2, logoUrl, plan, suspended, isTest,
//        acceptsOnlineBooking, createdAt, owners: [{ id, firstName, lastName, phone, email, activated }],
//        primaryBranch: { id, name, phone, city, district, khoroo, address, latitude, longitude } | null,
//        branchCount, employeeCount } }
// Орлого, зээл, багц/төлбөр, захиалга ОРОХГҮЙ. 401, 403, 404 { code: "NOT_FOUND" }.

import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { requireSystemApiUser } from "@/lib/auth/system-api";
import { updateTenantBySystem } from "@/lib/system/tenant-admin";
import { getTenantDetail } from "@/lib/system/tenants";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSystemApiUser(req, "tenants.view");
  if (auth.response) return auth.response;
  const { id } = await ctx.params;
  const tenant = await getTenantDetail(id);
  if (!tenant) return jsonError(404, "Байгууллага олдсонгүй.", { code: "NOT_FOUND" });
  return jsonOk({ tenant });
}

// Contract — PATCH /api/v1/system/tenants/[id]  (харилцагчийн МЭДЭЭЛЭЛ засах)
//
// Эрх: tenants.edit. Rate limit: 60 / 10 мин (админаар). PATCH семантик: ирээгүй талбар өөрчлөгдөхгүй.
// Body (бүгд заавал биш, дор хаяж нэг): { name, registerNumber, email (""/null = цэвэрлэх), phone1 (эсвэл phone),
//   phone2 (""/null = цэвэрлэх), acceptsOnlineBooking,
//   branch: { phone, city, district, khoroo, address, latitude + longitude (хамт, эсвэл хоёул null) } }
//   — branch нь Үндсэн салбар. Эзний нэвтрэх утас/имэйл, багц, зээл, төлбөр ЗАСАГДАХГҮЙ.
// 200: { tenant: TenantDetail, changed: boolean } (өөрчлөлт байхгүй бол changed=false, аудит бичигдэхгүй)
// 403 { code: "PLAN" } (онлайн цаг захиалгыг дэмжихгүй багц) | 404 | 409 { code: "CONFLICT", fieldErrors } | 422 { code: "VALIDATION", fieldErrors } | 429 | 401
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSystemApiUser(req, "tenants.edit");
  if (auth.response) return auth.response;
  const limited = enforceRateLimit(req, "system-api-tenant-edit", { limit: 60, windowMs: 10 * 60_000 }, auth.admin.id);
  if (limited) return limited;
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "Body буруу.");

  const result = await updateTenantBySystem({ tenantId: id, adminId: auth.admin.id, body, req });
  if (!result.ok) {
    return jsonError(result.status, result.message, { code: result.code, ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}) });
  }
  const tenant = await getTenantDetail(id);
  return jsonOk({ tenant, changed: result.changed });
}
