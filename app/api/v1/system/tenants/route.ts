// Contract — GET /api/v1/system/tenants?q=&status=active|suspended&page=&pageSize=
//
// Харилцагч (байгууллага)-ын жагсаалт. Эрх: tenants.view (STAFF, ROOT). Хайлт: нэр, регистр, имэйл, утас.
// 200: { tenants: [{ id, name, registerNumber, phone1, email, plan, suspended, isTest, createdAt,
//                    owner: { id, firstName, lastName, phone, email, activated } | null }], pagination }
//      owner.activated = false бол эзэн SMS кодоор нууц үгээ тохируулаагүй (activation-code дахин илгээнэ).
// Орлого, зээл, багц/төлбөр, захиалгын мэдээлэл ОРОХГҮЙ. 400 (status буруу), 401, 403.

import { enforceRateLimit, jsonError, jsonOk } from "@/lib/api";
import { requireSystemApiUser } from "@/lib/auth/system-api";
import { buildMeta, getApiPageInfo } from "@/lib/pagination";
import { registerTenantBySystem } from "@/lib/system/tenant-registration";
import { getTenantDetail, listTenants, parseTenantStatusFilter } from "@/lib/system/tenants";

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

// Contract — POST /api/v1/system/tenants  (харилцагч БҮРТГЭХ)
//
// Эрх: tenants.create. Rate limit: 30 / 10 мин (админаар).
// Body: { orgName, registerNumber, phone (эсвэл phone1), email?, ownerName (байгууллагад заавал; хувь хүн бол
//         регистрийн нэр), latitude, longitude, city?, district?, khoroo?, address? } — нууц үг ШААРДАХГҮЙ (илгээсэн ч
//         үл тооно). Регистр/нэр/утас нь өөрөө бүртгүүлэхтэй яг ижил дүрмээр шалгагдана.
// Үүсгэх: байгууллага (FREE багц), Үндсэн салбар (+7 хоногийн хуваарь), анхдагч нэгж/касс/оношилгооны загвар, ЭЗЭН
//   (нууц үггүй, идэвхжээгүй). Эзэн утсандаа ирсэн SMS кодоор /api/v1/auth/activate-аар нууц үгээ өөрөө тохируулна —
//   код илгээх: POST /api/v1/system/tenants/{id}/owner/activation-code. Ажилтан эзний нууц үгийг мэдэхгүй.
// 201: { tenant: TenantDetail, activation: { ownerId, phone, activated: false } }
// 409 { code: "CONFLICT", fieldErrors } (регистр/нэр/имэйл/утас бүртгэлтэй) | 422 { code: "VALIDATION", fieldErrors } | 429 | 401 | 403
export async function POST(req: Request) {
  const auth = await requireSystemApiUser(req, "tenants.create");
  if (auth.response) return auth.response;
  const limited = enforceRateLimit(req, "system-api-tenant-create", { limit: 30, windowMs: 10 * 60_000 }, auth.admin.id);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "Body буруу.");

  const result = await registerTenantBySystem({ body, adminId: auth.admin.id, req });
  if (!result.ok) {
    return jsonError(result.status, result.message, { code: result.code, ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}) });
  }
  const tenant = await getTenantDetail(result.created.tenantId);
  return jsonOk(
    { tenant, activation: { ownerId: result.created.userId, phone: result.data.phone, activated: false } },
    { status: 201 },
  );
}
