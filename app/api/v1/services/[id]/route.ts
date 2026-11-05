import { Prisma } from "@/app/generated/prisma/client";
import { jsonError, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { requireActiveSubscriptionApi } from "@/lib/subscription-server";
import { prisma } from "@/lib/prisma";
import {
  ServiceCommandError,
  deleteServiceCommand,
  updateServiceCommand,
} from "@/lib/services/service-commands";

const SERVICE_DETAIL_SELECT = {
  id: true,
  type: true,
  name: true,
  code: true,
  barcode: true,
  price: true,
  costPrice: true,
  stock: true,
  description: true,
  isActive: true,
  durationValue: true,
  // PATCH replaces the whole record, so edit forms must read this back —
  // without it every mobile edit wiped the service reminder interval.
  reminderIntervalMonths: true,
  unit: { select: { id: true, name: true, code: true } },
  durationUnit: { select: { id: true, name: true, code: true } },
  category: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
  _count: { select: { items: true } },
} satisfies Prisma.ServiceSelect;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "services.view");
  if (denied) return denied;
  const { id } = await ctx.params;

  const service = await prisma.service.findFirst({
    where: { id, tenantId: auth.user.tenantId },
    select: SERVICE_DETAIL_SELECT,
  });

  if (!service) return jsonError(404, "Үйлчилгээ олдсонгүй.");
  return jsonOk({ service });
}

function commandErrorResponse(error: unknown) {
  if (error instanceof ServiceCommandError) {
    return jsonError(
      error.status,
      error.message,
      error.fieldErrors ? { code: error.code, fieldErrors: error.fieldErrors } : { code: error.code },
    );
  }
  throw error;
}

// PATCH /api/v1/services/[id] — permission: services.edit
// Whole-record replace (see `lib/services/service-commands.ts`'s doc comment
// for the decision and its reasoning): the client sends every editable
// field, matching `PATCH /api/v1/customers/[id]` and
// `PATCH /api/v1/vehicles/[id]`. `type` is accepted but immutable on update;
// `stock` is accepted (and validated) but never written here — it only ever
// changes through `POST /services/[id]/stock`. Delegates entirely to
// `updateServiceCommand` — this route does not re-implement validation.
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "services.edit");
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
  if (!body || typeof body !== "object") return jsonError(400, "Body буруу.");

  const {
    type, name, code, unitId, price, costPrice, stock,
    durationValue, durationUnitId, reminderIntervalMonths,
    description, isActive, categoryId, barcode,
  } = body as Record<string, unknown>;

  let updated;
  try {
    updated = await updateServiceCommand({
      actor: auth.user,
      serviceId: id,
      // Mobile widens the web action's LABOR/GOODS-only kind set to include
      // DIAGNOSTIC — see the command module's doc comment for why this is
      // safe (`type` is never persisted by this path).
      options: { allowedKinds: ["LABOR", "GOODS", "DIAGNOSTIC"] },
      data: {
        type: typeof type === "string" ? type : "",
        name: typeof name === "string" ? name : "",
        code: typeof code === "string" ? code : null,
        // Илгээгээгүй бол (хуучин апп) баркодыг хөндөхгүй.
        barcode: typeof barcode === "string" ? barcode : barcode === null ? null : undefined,
        unitId: typeof unitId === "string" ? unitId : null,
        price: typeof price === "string" || typeof price === "number" ? price : null,
        costPrice: typeof costPrice === "string" || typeof costPrice === "number" ? costPrice : null,
        stock: typeof stock === "string" || typeof stock === "number" ? stock : null,
        durationValue: typeof durationValue === "string" || typeof durationValue === "number" ? durationValue : null,
        durationUnitId: typeof durationUnitId === "string" ? durationUnitId : null,
        reminderIntervalMonths:
          typeof reminderIntervalMonths === "string" || typeof reminderIntervalMonths === "number"
            ? reminderIntervalMonths
            : null,
        description: typeof description === "string" ? description : null,
        isActive: typeof isActive === "boolean" ? isActive : false,
        categoryId: typeof categoryId === "string" ? categoryId : null,
      },
    });
  } catch (e) {
    return commandErrorResponse(e);
  }

  return jsonOk({ service: updated });
}

// DELETE /api/v1/services/[id] — permission: services.delete
// Delegates to `deleteServiceCommand`, which archives (`isActive:false`)
// rather than hard-deleting when the service has order-item history —
// preserving the web action's exact soft-delete-if-referenced behaviour.
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;
  const denied = requirePermission(auth.user, "services.delete");
  if (denied) return denied;
  const locked = await requireActiveSubscriptionApi(auth.user);
  if (locked) return locked;

  const { id } = await ctx.params;

  let result;
  try {
    result = await deleteServiceCommand({ actor: auth.user, serviceId: id });
  } catch (e) {
    return commandErrorResponse(e);
  }

  return jsonOk({ service: result });
}
