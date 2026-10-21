// P4-B1 — canon Service update/delete/stock-adjust/bulk-category command set.
// `app/_actions/services.ts`'s `updateServiceAction`/`deleteServiceAction`/
// `adjustServiceStockAction`/`bulkChangeServiceCategoryAction` previously
// re-implemented all four behaviours inline; this module is now the ONLY
// place that talks to `prisma.service` for these four operations. Shape
// mirrors `lib/customers/customer-commands.ts` (DM-05): typed input/output —
// no `FormData`, `NextResponse`, `redirect` or `revalidatePath` in here.
// Permission checks and the subscription gate stay with the caller (web
// action's `authorize()`, API route's `requirePermission`/
// `requireActiveSubscriptionApi`), same principle as order-commands.
//
// `createServiceAction` and `POST /api/v1/services` are OUT OF SCOPE for this
// slice (TENANT_MOBILE_SLICES.md P4-B1 lists only the four mutations above)
// and are untouched — the web action keeps its own local `validate()` for
// create, unmodified.
//
// --- Decision record (P4-B1's explicit call, per the slice's own prompt) ---
//
// `PATCH /api/v1/services/[id]` is WHOLE-RECORD REPLACE, matching
// `PATCH /api/v1/customers/[id]` and `PATCH /api/v1/vehicles/[id]` — the
// client always sends the complete set of editable fields; there is no
// partial-patch "only set what's provided" mode. This is the slice doc's own
// recommendation, chosen for consistency with every other resource in this
// mobile API. Concretely, "whole-record replace" here means the same thing
// it means for those two routes: `validateServiceUpdateInput` treats a
// missing/wrong-typed field as empty/absent and re-runs full validation
// (required fields fail exactly as they would on create), then the command
// writes every editable column unconditionally — never a partial spread of
// only the keys the caller happened to include.
//
// Two fields are explicit, preserved exceptions to "every field", both
// carried over unchanged from the web action this is extracted from:
//
//   1. `stock` is accepted and VALIDATED (so a malformed stock string on a
//      GOODS row still rejects the request with a field error, exactly as
//      today) but is NEVER written by the update path — stock only ever
//      changes through `adjustServiceStockCommand` / the dedicated stock
//      endpoint. This preserves the original code's own comment verbatim:
//      "Засах үед stock-ийг шууд бүү дарж бичиж бай — adjust action
//      ашиглана." Overwriting stock here would silently bypass the
//      directional/negative-balance rules `adjustServiceStockCommand`
//      enforces.
//   2. `type` is accepted in the body (and returned) but is IMMUTABLE on
//      update — never written to the row — matching the original
//      `updateServiceAction`, whose Prisma `update` payload never included
//      `type` at all. It still gates the same per-kind validation branches
//      (unit required for LABOR/GOODS, duration pairing for non-GOODS) that
//      it always has, and the web adapter still uses it to compute the
//      post-update redirect slug. This is the same "accepted but discarded"
//      shape `updateVehicleCommand` already uses for `plate`.
//
// `validateServiceUpdateInput`'s `allowedKinds` option is where this command
// deliberately DIVERGES from the web action's stricter default (LABOR/GOODS
// only, via `SERVICE_KINDS`): the mobile API route passes the full
// LABOR/GOODS/DIAGNOSTIC set, because Phase 4's mobile catalogue explicitly
// covers all three kinds (TENANT_MOBILE_SLICES.md Phase 4 entry state,
// D-164), and because `type` is never persisted by this path anyway — a
// wider caller-supplied kind set here cannot affect stored data. The web
// action's call site omits the option, so it keeps today's LABOR/GOODS-only
// behaviour unchanged. This mirrors the existing `ValidateVehicleOptions`
// per-caller-flag idiom in `lib/vehicles/vehicle-commands.ts` (e.g.
// `enforceYearUpperBound`).
//
// Delete, stock-adjust and bulk-category preserve the measured Phase 4
// semantics exactly (see the pure helpers below, each with its own real
// runtime test — no database required, following the P0-B1 "split the pure
// decision from the DB lookup" idiom since this codebase has no prisma
// mocking convention and no test database):
//
//   - `decideServiceDeleteOutcome`: archive (`isActive:false`) when the
//     service has order-item history, hard delete otherwise.
//   - `computeStockAdjustment`: directional (`in`/`out`) + positive amount,
//     rejects a resulting negative balance rather than clamping to zero.
//   - `planBulkCategoryChange`: per-item (NOT all-or-nothing) — a service id
//     with no matching row is a per-item failure; everything else succeeds
//     (including a no-op when the row already has the target category).
//     A missing/empty `categoryId` for the WHOLE request is a single 400/422
//     rejection, not a per-item failure — categories are mandatory on every
//     Service, so there is no such thing as a valid empty-category batch to
//     partially succeed. This matches the original action's early-return
//     shape exactly.

import { categoryAllowsKind, categoryKindLabel } from "@/lib/categories";
import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { SERVICE_KINDS, type ServiceKind } from "@/lib/services";
import { parseNonNegativeDecimal } from "@/lib/decimal-input";

export type ServiceCommandActor = {
  id: string;
  tenantId: string;
};

export class ServiceCommandError extends Error {
  constructor(
    message: string,
    public readonly status = 422,
    public readonly code = "SERVICE_COMMAND_REJECTED",
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "ServiceCommandError";
  }
}

/** A numeric field as it may arrive from FormData (string) or JSON (number). */
type DecimalInput = string | number | null | undefined;

function toTrimmedString(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function parseDecimalField(raw: DecimalInput): Prisma.Decimal | null {
  return parseNonNegativeDecimal(raw);
}

// --- update -----------------------------------------------------------------

export type ServiceUpdateInput = {
  type: string;
  name: string;
  code?: string | null;
  unitId?: string | null;
  price: DecimalInput;
  costPrice?: DecimalInput;
  /** Validated but never persisted — see module doc comment. */
  stock?: DecimalInput;
  durationValue?: DecimalInput;
  durationUnitId?: string | null;
  reminderIntervalMonths?: DecimalInput;
  description?: string | null;
  isActive?: boolean;
  categoryId?: string | null;
};

export type NormalizedServiceUpdateData = {
  type: ServiceKind;
  name: string;
  code: string | null;
  unitId: string | null;
  price: Prisma.Decimal;
  costPrice: Prisma.Decimal | null;
  durationValue: Prisma.Decimal | null;
  durationUnitId: string | null;
  reminderIntervalMonths: number | null;
  description: string | null;
  isActive: boolean;
  categoryId: string | null;
};

export type ServiceUpdateRecord = { id: string } & NormalizedServiceUpdateData;

export type ValidateServiceUpdateOptions = {
  /** Defaults to `SERVICE_KINDS` (LABOR/GOODS) — the web action's existing
   * behaviour. The mobile API route passes LABOR/GOODS/DIAGNOSTIC — see the
   * module doc comment for why this is safe to widen. */
  allowedKinds?: readonly ServiceKind[];
};

/**
 * Pure structural validation — mirrors the shared `validate()` in
 * `app/_actions/services.ts` for everything that does not require a DB read.
 * Existence checks for `unitId`/`durationUnitId`/`categoryId` are the
 * command's job (tenant-scoped Prisma lookups), same split as
 * `validateVehicleInput` vs. `updateVehicleCommand`.
 */
export function validateServiceUpdateInput(
  input: ServiceUpdateInput,
  options: ValidateServiceUpdateOptions = {},
): {
  data: NormalizedServiceUpdateData;
  fieldErrors: Record<string, string>;
  /** Raw ids still needing an existence check — undefined means "not supplied". */
  refs: { unitId?: string; durationUnitId?: string; categoryId?: string };
} {
  const allowedKinds = options.allowedKinds ?? SERVICE_KINDS;
  const fieldErrors: Record<string, string> = {};

  const typeRaw = toTrimmedString(input.type);
  const name = toTrimmedString(input.name);
  const code = toTrimmedString(input.code).toUpperCase();
  const unitIdRaw = toTrimmedString(input.unitId);
  const durationUnitIdRaw = toTrimmedString(input.durationUnitId);
  const categoryIdRaw = toTrimmedString(input.categoryId);
  const description = toTrimmedString(input.description);
  const isActive = input.isActive ?? false;

  if (!(allowedKinds as readonly string[]).includes(typeRaw)) {
    fieldErrors.type = "Төрлийг сонгоно уу.";
  }
  const type = typeRaw as ServiceKind;

  if (!name) fieldErrors.name = "Нэр оруулна уу.";

  const price = parseDecimalField(input.price);
  if (!price) fieldErrors.price = "Үнэ буруу.";

  let costPrice: Prisma.Decimal | null = null;
  let durationValue: Prisma.Decimal | null = null;

  const refs: { unitId?: string; durationUnitId?: string; categoryId?: string } = {};

  // Хэмжих нэгж: LABOR / GOODS-д заавал.
  if (type === "LABOR" || type === "GOODS") {
    if (!unitIdRaw) {
      fieldErrors.unitId = "Хэмжих нэгж сонгоно уу.";
    } else {
      refs.unitId = unitIdRaw;
    }
  }

  if (type === "GOODS") {
    const costRaw = input.costPrice;
    const hasCostRaw = typeof costRaw === "number" || (typeof costRaw === "string" && costRaw.trim());
    if (hasCostRaw) {
      costPrice = parseDecimalField(costRaw);
      if (!costPrice) fieldErrors.costPrice = "Өртөг үнэ буруу.";
    }
    // `stock` is validated (a malformed value on a GOODS row still rejects
    // the update, matching the original code) but is NEVER written — see
    // module doc comment.
    const stockRaw = input.stock;
    const hasStockRaw = typeof stockRaw === "number" || (typeof stockRaw === "string" && stockRaw.trim());
    const initialStock = hasStockRaw ? stockRaw! : "0";
    if (!parseDecimalField(initialStock)) fieldErrors.stock = "Үлдэгдэл буруу.";
  }

  // Хугацаа (LABOR/DIAGNOSTIC) — заавал биш, гэхдээ утга/нэгжийн аль нэг нь
  // байвал нөгөө нь ч байх ёстой.
  if (type !== "GOODS") {
    const durationValueRaw = input.durationValue;
    const hasValueRaw = typeof durationValueRaw === "number" || (typeof durationValueRaw === "string" && durationValueRaw.trim());
    const hasUnitRaw = Boolean(durationUnitIdRaw);
    if (hasValueRaw || hasUnitRaw) {
      if (!hasValueRaw) {
        fieldErrors.durationValue = "Хугацааны утгаа оруулна уу.";
      } else {
        const d = parseDecimalField(durationValueRaw);
        if (!d || d.lte(0)) fieldErrors.durationValue = "Хугацаа эерэг тоо байх ёстой.";
        else durationValue = d;
      }
      if (!hasUnitRaw) {
        fieldErrors.durationUnitId = "Хугацааны нэгжээ сонгоно уу.";
      } else {
        refs.durationUnitId = durationUnitIdRaw;
      }
    }
  }

  let reminderIntervalMonths: number | null = null;
  const reminderRaw = input.reminderIntervalMonths;
  const hasReminderRaw = typeof reminderRaw === "number" || (typeof reminderRaw === "string" && reminderRaw.trim());
  if (hasReminderRaw) {
    const n = typeof reminderRaw === "number" ? reminderRaw : Number.parseInt(reminderRaw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      fieldErrors.reminderIntervalMonths = "Сар эерэг бүхэл тоо байх ёстой.";
    } else {
      reminderIntervalMonths = n;
    }
  }

  // Бүх төрөлд ангилал заавал.
  if (!categoryIdRaw) {
    fieldErrors.categoryId = "Ангилал сонгоно уу.";
  } else {
    refs.categoryId = categoryIdRaw;
  }

  return {
    data: {
      type,
      name,
      code: code || null,
      unitId: unitIdRaw || null,
      price: price ?? new Prisma.Decimal(0),
      costPrice,
      durationValue,
      durationUnitId: durationUnitIdRaw || null,
      reminderIntervalMonths,
      description: description || null,
      isActive,
      categoryId: categoryIdRaw || null,
    },
    fieldErrors,
    refs,
  };
}

/**
 * Unit/category id-г тухайн tenant-д харьяалагдаж буйг шалгана. FK constraint
 * RLS-г үл тоодог тул шалгахгүй бол өөр tenant-ийн мөр рүү холбогдох боломжтой.
 */
export async function serviceRefFieldErrors(
  tenantId: string,
  refs: { unitId?: string | null; durationUnitId?: string | null; categoryId?: string | null },
  /** Өгвөл ангиллын төрөл (Category.kind) энэ үйлчилгээний төрөлтэй таарах ёстой. */
  serviceType?: ServiceKind | null,
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  if (refs.unitId) {
    const exists = await prisma.unit.findFirst({ where: { id: refs.unitId, tenantId }, select: { id: true } });
    if (!exists) errors.unitId = "Сонгосон нэгж олдсонгүй.";
  }
  if (refs.durationUnitId) {
    const exists = await prisma.unit.findFirst({ where: { id: refs.durationUnitId, tenantId }, select: { id: true } });
    if (!exists) errors.durationUnitId = "Сонгосон нэгж олдсонгүй.";
  }
  if (refs.categoryId) {
    // Өөрийн эсвэл системийн (бүх тенантад нийтлэг) ангилал.
    const cat = await prisma.category.findFirst({
      where: { id: refs.categoryId, OR: [{ tenantId }, { tenantId: null }] },
      select: { id: true, kind: true },
    });
    if (!cat) errors.categoryId = "Сонгосон ангилал олдсонгүй.";
    else if (serviceType && !categoryAllowsKind(cat.kind, serviceType)) {
      errors.categoryId = `Энэ ангилал зөвхөн «${categoryKindLabel(cat.kind)}»-д зориулагдсан.`;
    }
  }
  return errors;
}

export async function updateServiceCommand(input: {
  actor: ServiceCommandActor;
  serviceId: string;
  data: ServiceUpdateInput;
  options?: ValidateServiceUpdateOptions;
}): Promise<ServiceUpdateRecord> {
  const { actor, serviceId } = input;
  const { data, fieldErrors, refs } = validateServiceUpdateInput(input.data, input.options);

  Object.assign(fieldErrors, await serviceRefFieldErrors(actor.tenantId, refs, data?.type ?? null));

  if (Object.keys(fieldErrors).length > 0) {
    throw new ServiceCommandError("Хүсэлт буруу.", 422, "VALIDATION_FAILED", fieldErrors);
  }

  // `type` and `stock` are intentionally absent from this payload — see
  // module doc comment.
  const update: Prisma.ServiceUncheckedUpdateManyInput = {
    name: data.name,
    code: data.code,
    price: data.price,
    costPrice: data.costPrice,
    durationValue: data.durationValue,
    reminderIntervalMonths: data.reminderIntervalMonths,
    description: data.description,
    isActive: data.isActive,
    unitId: data.unitId,
    durationUnitId: data.durationUnitId,
    categoryId: data.categoryId,
  };

  let updatedCount: number;
  try {
    const result = await prisma.service.updateMany({
      where: { id: serviceId, tenantId: actor.tenantId },
      data: update,
    });
    updatedCount = result.count;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ServiceCommandError(
        "Энэ код өөр үйлчилгээнд ашиглагдсан байна.",
        409,
        "SERVICE_CODE_CONFLICT",
        { code: "Энэ код өөр үйлчилгээнд ашиглагдсан байна." },
      );
    }
    throw e;
  }
  if (updatedCount === 0) {
    throw new ServiceCommandError("Олдсонгүй.", 404, "SERVICE_NOT_FOUND");
  }

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Service",
    entityId: serviceId,
    action: "UPDATE",
    summary: `[${data.type}] ${data.name}${data.code ? ` · ${data.code}` : ""}`,
    after: {
      name: data.name,
      code: data.code,
      price: data.price.toString(),
      isActive: data.isActive,
    },
  });

  return { id: serviceId, ...data };
}

// --- delete -------------------------------------------------------------

export type ServiceDeleteOutcome = "archived" | "deleted";

/**
 * Pure decision, no DB — archive when the service has order-item history,
 * hard-delete otherwise. Split out purely so it has its own real runtime
 * test rather than only a source-pattern assertion (P0-B1 idiom).
 */
export function decideServiceDeleteOutcome(orderItemCount: number): ServiceDeleteOutcome {
  return orderItemCount > 0 ? "archived" : "deleted";
}

export type ServiceDeleteResult = {
  id: string;
  name: string;
  type: ServiceKind;
  outcome: ServiceDeleteOutcome;
};

export async function deleteServiceCommand(input: {
  actor: ServiceCommandActor;
  serviceId: string;
}): Promise<ServiceDeleteResult> {
  const { actor, serviceId } = input;

  const svc = await prisma.service.findFirst({
    where: { id: serviceId, tenantId: actor.tenantId },
    select: { name: true, type: true, _count: { select: { items: true } } },
  });
  if (!svc) {
    throw new ServiceCommandError("Олдсонгүй.", 404, "SERVICE_NOT_FOUND");
  }

  const outcome = decideServiceDeleteOutcome(svc._count.items);

  if (outcome === "archived") {
    // Захиалгад ашиглагдсан бол идэвхгүй болгоно.
    await prisma.service.update({
      where: { id: serviceId },
      data: { isActive: false },
    });
  } else {
    await prisma.service.delete({ where: { id: serviceId } });
  }

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Service",
    entityId: serviceId,
    action: outcome === "archived" ? "UPDATE" : "DELETE",
    summary: `[${svc.type}] ${svc.name}${outcome === "archived" ? " (архивлав)" : ""}`,
  });

  return { id: serviceId, name: svc.name, type: svc.type as ServiceKind, outcome };
}

// --- stock adjustment -----------------------------------------------------

export type StockDirection = "in" | "out";

export type StockAdjustmentResult =
  | { ok: true; next: Prisma.Decimal }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Pure decision, no DB — directional (`in` adds, `out` subtracts) and
 * rejects a resulting negative balance rather than clamping to zero.
 */
export function computeStockAdjustment(
  current: Prisma.Decimal,
  direction: StockDirection,
  amount: Prisma.Decimal,
): StockAdjustmentResult {
  const delta = direction === "in" ? amount : amount.negated();
  const next = current.plus(delta);
  if (next.lt(0)) {
    return {
      ok: false,
      fieldErrors: { amount: `Үлдэгдэл сөрөг болж байна. Одоо: ${current.toString()}` },
    };
  }
  return { ok: true, next };
}

export type StockAdjustmentInput = {
  direction: string;
  amount: DecimalInput;
};

/** Pure validation — amount must parse to a positive decimal, direction must be `in`/`out`. */
export function validateStockAdjustmentInput(input: StockAdjustmentInput): {
  data: { direction: StockDirection; amount: Prisma.Decimal } | null;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  const amount = parseDecimalField(input.amount);
  if (!amount || amount.lte(0)) fieldErrors.amount = "Эерэг тоо оруулна уу.";
  const direction = input.direction;
  if (direction !== "in" && direction !== "out") fieldErrors.direction = "Чиглэлийг сонгоно уу.";

  if (Object.keys(fieldErrors).length > 0) return { data: null, fieldErrors };
  return { data: { direction: direction as StockDirection, amount: amount! }, fieldErrors };
}

export type ServiceStockResult = { id: string; stock: Prisma.Decimal };

export async function adjustServiceStockCommand(input: {
  actor: ServiceCommandActor;
  serviceId: string;
  data: StockAdjustmentInput;
}): Promise<ServiceStockResult> {
  const { actor, serviceId } = input;
  const { data, fieldErrors } = validateStockAdjustmentInput(input.data);
  if (!data) {
    throw new ServiceCommandError("Хүсэлт буруу.", 422, "VALIDATION_FAILED", fieldErrors);
  }

  const svc = await prisma.service.findFirst({
    where: { id: serviceId, tenantId: actor.tenantId, type: "GOODS" },
    select: { id: true, stock: true },
  });
  if (!svc) {
    throw new ServiceCommandError("Бараа олдсонгүй.", 404, "SERVICE_NOT_FOUND");
  }

  const current = svc.stock ?? new Prisma.Decimal(0);
  const result = computeStockAdjustment(current, data.direction, data.amount);
  if (!result.ok) {
    throw new ServiceCommandError("Хүсэлт буруу.", 422, "VALIDATION_FAILED", result.fieldErrors);
  }

  await prisma.service.update({
    where: { id: svc.id },
    data: { stock: result.next },
  });

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Service",
    entityId: svc.id,
    action: "STOCK_CHANGE",
    summary: `${data.direction === "in" ? "+" : "−"}${data.amount.toString()} (гар тохируулга)`,
    before: { stock: current.toString() },
    after: { stock: result.next.toString(), reason: "MANUAL_ADJUST" },
  });

  return { id: svc.id, stock: result.next };
}

// --- bulk category re-assignment -------------------------------------------

export type BulkCategoryItemPlan =
  | { id: string; label: string; action: "update" }
  // Already has the target category — counted as a success, no write needed.
  | { id: string; label: string; action: "skip" }
  | { id: string; label: string; action: "fail"; message: string };

/**
 * Pure planning, no DB — given the already-fetched (tenant-scoped) services
 * for the requested ids, decides per REQUESTED id (duplicates included,
 * matching the original loop) whether it updates, is a no-op, or fails. A
 * requested id with no matching row is the only per-item failure; there is
 * no such thing as a per-item empty-category failure — see module doc
 * comment for why that stays a whole-request rejection.
 */
export function planBulkCategoryChange(
  ids: string[],
  services: Array<{ id: string; name: string; code: string | null; categoryId: string | null }>,
  categoryId: string,
): BulkCategoryItemPlan[] {
  const byId = new Map(services.map((svc) => [svc.id, svc]));
  return ids.map((id) => {
    const svc = byId.get(id);
    const label = svc ? (svc.code ? `${svc.code} · ${svc.name}` : svc.name) : id;
    if (!svc) return { id, label, action: "fail", message: "Олдсонгүй." };
    if (svc.categoryId === categoryId) return { id, label, action: "skip" };
    return { id, label, action: "update" };
  });
}

export type BulkCategoryChangeResult = {
  succeeded: number;
  failed: number;
  errors: string[];
};

export async function bulkChangeServiceCategoryCommand(input: {
  actor: ServiceCommandActor;
  categoryId: string;
  serviceIds: string[];
}): Promise<BulkCategoryChangeResult> {
  const { actor } = input;
  const categoryId = toTrimmedString(input.categoryId);
  if (!categoryId) {
    throw new ServiceCommandError("Ангилал сонгоно уу.", 400, "CATEGORY_REQUIRED");
  }

  const category = await prisma.category.findFirst({
    where: { id: categoryId, OR: [{ tenantId: actor.tenantId }, { tenantId: null }] },
    select: { id: true, name: true, kind: true },
  });
  if (!category) {
    throw new ServiceCommandError("Сонгосон ангилал олдсонгүй.", 404, "CATEGORY_NOT_FOUND");
  }

  const ids = (input.serviceIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0);
  if (ids.length === 0) {
    throw new ServiceCommandError("Дор хаяж нэг мөр сонгоно уу.", 400, "EMPTY_SELECTION");
  }

  const services = await prisma.service.findMany({
    where: { id: { in: ids }, tenantId: actor.tenantId },
    select: { id: true, name: true, code: true, categoryId: true, type: true },
  });

  // Төрөл таараагүй мөрийг (жиш: «Сэлбэг» ангилалд ажил) алгасаж алдаагаар мэдээлнэ.
  const mismatched = new Set(services.filter((svc) => !categoryAllowsKind(category.kind, svc.type)).map((svc) => svc.id));
  const plans = planBulkCategoryChange(ids, services, categoryId).map((plan) =>
    mismatched.has(plan.id) && plan.action !== "fail"
      ? { id: plan.id, label: plan.label, action: "fail" as const, message: `Ангилал зөвхөн «${categoryKindLabel(category.kind)}»-д зориулагдсан.` }
      : plan,
  );

  let succeeded = 0;
  const errors: string[] = [];
  for (const plan of plans) {
    if (plan.action === "fail") {
      errors.push(`${plan.label}: ${plan.message}`);
      continue;
    }
    if (plan.action === "update") {
      await prisma.service.update({
        where: { id: plan.id },
        data: { categoryId },
      });
      await logAudit({
        tenantId: actor.tenantId,
        userId: actor.id,
        entity: "Service",
        entityId: plan.id,
        action: "UPDATE",
        summary: `Ангилал: ${category.name}`,
        after: { categoryId },
      });
    }
    succeeded++;
  }

  return { succeeded, failed: errors.length, errors };
}
