// P3-B3 — Customer detail routes. Thin adapters over the P3-B1 canon commands
// (`lib/customers/customer-commands.ts`). No customer mutation logic is
// re-implemented here — see TENANT_MOBILE_SLICES.md's P3-B3 spec and the
// sibling `app/api/v1/customers/route.ts` for the house conventions this
// file mirrors.

import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import { prisma } from "@/lib/prisma";
import {
  CustomerCommandError,
  deleteCustomerCommand,
  orgInputFromBody,
  updateCustomerCommand,
} from "@/lib/customers/customer-commands";

const CUSTOMER_DETAIL_SELECT = {
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
  tenantVehicles: {
    where: { isActive: true },
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      isPostpaid: true,
      vehicle: {
        select: {
          id: true,
          plate: true,
          vin: true,
          make: true,
          model: true,
          year: true,
          mileage: true,
        },
      },
    },
  },
} as const;

// Another tenant's customer id must be indistinguishable from an id that does
// not exist at all — every method below returns 404, never 403, for a
// cross-tenant id. This is enforced by folding `tenantId: auth.user.tenantId`
// into every lookup rather than checking tenancy after the fact.
function customerNotFound() {
  return jsonError(404, "Үйлчлүүлэгч олдсонгүй.");
}

// GET /api/v1/customers/[id]
// Permission: customers.view
// Returns the customer with its tenant vehicles and each vehicle's
// tenant-scoped order count.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "customers.view");
  if (denied) return denied;

  const { id } = await ctx.params;

  const customer = await prisma.customer.findFirst({
    where: { id, tenantId: auth.user.tenantId },
    select: CUSTOMER_DETAIL_SELECT,
  });
  if (!customer) return customerNotFound();

  const vehicleIds = customer.tenantVehicles.map((tv) => tv.vehicle.id);
  const orderCounts = vehicleIds.length
    ? await prisma.serviceOrder.groupBy({
        by: ["vehicleId"],
        where: { tenantId: auth.user.tenantId, vehicleId: { in: vehicleIds } },
        _count: { _all: true },
      })
    : [];
  const orderCountByVehicleId = new Map(orderCounts.map((r) => [r.vehicleId, r._count._all]));

  const vehicles = customer.tenantVehicles.map((tv) => ({
    id: tv.id,
    isPostpaid: tv.isPostpaid,
    vehicle: tv.vehicle,
    orderCount: orderCountByVehicleId.get(tv.vehicle.id) ?? 0,
  }));

  return jsonOk({
    customer: {
      id: customer.id,
      fullName: customer.fullName,
      phone: customer.phone,
      email: customer.email,
      note: customer.note,
      isOrganization: customer.isOrganization,
      orgRegnum: customer.orgRegnum,
      orgName: customer.orgName,
      orgEmail: customer.orgEmail,
      createdAt: customer.createdAt,
    },
    vehicles,
  });
}

// PATCH /api/v1/customers/[id]
// Permission: customers.edit
// Delegates entirely to `updateCustomerCommand` — this route does not
// re-implement validation, normalisation or the phone-conflict mapping.
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "customers.edit");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const { id } = await ctx.params;

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

  try {
    const updated = await updateCustomerCommand({
      actor: auth.user,
      customerId: id,
      data: {
        fullName: typeof fullName === "string" ? fullName : "",
        phone: typeof phone === "string" ? phone : "",
        email: typeof email === "string" ? email : null,
        note: typeof note === "string" ? note : null,
        ...orgInputFromBody(body as Record<string, unknown>),
      },
    });
    return jsonOk({ customer: updated });
  } catch (e) {
    if (e instanceof CustomerCommandError) {
      // `updateCustomerCommand` raises CUSTOMER_NOT_FOUND (404) for a missing
      // row scoped by `tenantId`, which already covers the cross-tenant case
      // — the command's `updateMany({ where: { id, tenantId } })` predicate
      // makes another tenant's customer indistinguishable from a nonexistent
      // one, so no extra mapping is needed here.
      if (e.fieldErrors) return jsonError(e.status, e.message, { fieldErrors: e.fieldErrors });
      return jsonError(e.status, e.message, { code: e.code });
    }
    throw e;
  }
}

// DELETE /api/v1/customers/[id]
// Permission: customers.delete
// Surfaces the command's typed CUSTOMER_IN_USE conflict (P2003 — customer has
// orders) as its 409, never a 500.
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "customers.delete");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const { id } = await ctx.params;

  try {
    const result = await deleteCustomerCommand({
      actor: auth.user,
      customerId: id,
    });
    return jsonOk({ ok: true, id: result.id, fullName: result.fullName });
  } catch (e) {
    if (e instanceof CustomerCommandError) {
      // CUSTOMER_NOT_FOUND (404, tenant-scoped lookup) covers the cross-tenant
      // case the same way as PATCH above. CUSTOMER_IN_USE (409, P2003) is
      // forwarded with its status/code, never collapsed to a 500.
      return jsonError(e.status, e.message, { code: e.code });
    }
    throw e;
  }
}
