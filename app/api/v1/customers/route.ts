import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import { buildMeta } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import {
  CustomerCommandError,
  createCustomerCommand,
  orgInputFromBody,
} from "@/lib/customers/customer-commands";
import {
  buildCustomerListWhere,
  parseCustomerListQuery,
} from "@/lib/customers/customer-list-query";

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "customers.view");
  if (denied) return denied;

  const url = new URL(req.url);
  const parsed = parseCustomerListQuery(url.searchParams);
  if (!parsed.ok) return jsonError(400, parsed.message, { field: parsed.field });
  const query = parsed.value;
  const { page, pageSize, skip, take } = query;

  // P3-B6: канон where-builder — `lib/customers/customer-list-query.ts`.
  // Order нь энэ route-ийн хуучин зан төлөв (fullName asc) хэвээр — query
  // contract-ийн нэг хэсэг биш, дуудагч тус бүр өөрийн order-ийг тогтооно.
  const where = buildCustomerListWhere(query, { tenantId: auth.user.tenantId });

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { fullName: "asc" },
      skip,
      take,
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        note: true,
        isOrganization: true,
        orgRegnum: true,
        orgName: true,
        orgEmail: true,
        createdAt: true,
      },
    }),
    prisma.customer.count({ where }),
  ]);

  return jsonOk({ customers, pagination: buildMeta(total, page, pageSize) });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "customers.create");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "JSON body шаардлагатай.");
  }
  if (!body || typeof body !== "object") {
    return jsonError(400, "Body буруу.");
  }
  const { fullName, phone, email, note } = body as Record<string, unknown>;

  // P3-B1: канон command — validate/normalise, MAX_CUSTOMERS quota болон
  // Account-claim (Account утсаар олдвол холбогдох/нэхэмжлэх) бүгд
  // `lib/customers/customer-commands.ts`-д нэгдсэн. Энэ route урьд нь
  // Account-claim алгасдаг байсан (веб dashboard action-аас өөр зан) — энэ
  // нь тайлбарласан, зориудаар нэгтгэсэн зан төлөв өөрчлөлт.
  let result;
  try {
    result = await createCustomerCommand({
      actor: auth.user,
      // Энэ route урьд нь MAX_CUSTOMERS шалгадаггүй байсан. Хязгаарыг хаана
      // хэрэгжүүлэх нь нээлттэй шийдвэр тул хуучин зан төлөв хэвээр
      // (2026-09-22) — `COWORK.md` Inbox.
      data: {
        fullName: typeof fullName === "string" ? fullName : "",
        phone: typeof phone === "string" ? phone : "",
        email: typeof email === "string" ? email : null,
        note: typeof note === "string" ? note : null,
        ...orgInputFromBody(body as Record<string, unknown>),
      },
    });
  } catch (e) {
    if (e instanceof CustomerCommandError) {
      if (e.fieldErrors) return jsonError(e.status, e.message, { fieldErrors: e.fieldErrors });
      return jsonError(e.status, e.message);
    }
    throw e;
  }

  // Шинээр үүсгэсэн бол 201; Account-claim-аар олдсон/нэхэмжилсэн бол 200 —
  // энэ route урьд нь claim хийдэггүй байсан тул "created бус" гарц шинэ.
  return jsonOk({ customer: result.customer }, { status: result.outcome === "created" ? 201 : 200 });
}
