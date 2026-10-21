// P5-B1 — typed create/update/delete/duplicate command set for
// DiagnosticTemplate, mirroring `lib/services/service-commands.ts`'s shape
// (DM-05): typed inputs/outputs, no `FormData`/`NextResponse`/`redirect`/
// `revalidatePath` in here. Permission checks and the subscription gate stay
// with the caller (web action's `authorize()`, API route's
// `requirePermission`/`requireActiveSubscriptionApi`).
//
// Extracted from `app/_actions/diagnostic-templates.ts` (371 LOC, left
// untouched by this slice — see TENANT_MOBILE_SLICES.md P5-B1). Every
// business rule below is copied from that file's four exported actions:
//
//   - `isSystemDefault` templates reject BOTH edit and delete.
//   - Delete archives (`isActive:false`) when the template has any reports
//     (`_count.reports > 0`), else hard-deletes.
//   - A schema-changing update bumps `version` only when the schema
//     actually changed AND the template already has reports (so in-flight
//     reports keep referencing their original schema shape via
//     `DiagnosticReport.templateVersion`).
//   - `categoryId` must resolve to a category owned by the same tenant
//     (`assertCategory`) on both create and update.
//   - Duplicate may source from `tenantVisibleTemplateWhere` (the tenant's
//     own template OR a system-admin-granted shared template, tenantId
//     NULL) but always writes a tenant-owned copy with `version: 1`.
//
// One deliberate divergence from the reference action, per
// TENANT_MOBILE_SLICES.md P5-B1's explicit instruction: `duplicateTemplateAction`
// today enforces NEITHER `ENABLE_DIAGNOSTICS` NOR `MAX_DIAGNOSTIC_TEMPLATES`.
// `duplicateTemplateCommand` below enforces both, the same "mobile gets the
// check the web action missed" pattern `P5-B0` already applied to the
// standalone-report permission gap — duplicate creates a row exactly like
// create does, so it must be gated the same way.
//
// Per the P0-B1 idiom ("split the pure decision from the DB lookup so it is
// unit-testable without a Postgres connection" — this repo's Prisma client
// needs a live `adapter-pg` connection even for one query, and there is no
// prisma-mocking convention anywhere in this tree), the actual decisions are
// pure, exported helpers: `validateTemplateInput`, `decideTemplateDeleteOutcome`,
// `schemaEqual`, `decideVersionBump`.

import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import {
  DIAGNOSTIC_TYPES,
  type DiagnosticType,
  type TemplateSchema,
  tenantVisibleTemplateWhere,
  validateSchema,
} from "@/lib/diagnostics";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { enforceCountLimit, isFeatureEnabled } from "@/lib/plan-limits-server";
import { prisma } from "@/lib/prisma";

export type DiagnosticTemplateCommandActor = {
  id: string;
  tenantId: string;
};

export class DiagnosticTemplateCommandError extends Error {
  constructor(
    message: string,
    public readonly status = 422,
    public readonly code = "DIAGNOSTIC_TEMPLATE_COMMAND_REJECTED",
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "DiagnosticTemplateCommandError";
  }
}

/** A numeric field as it may arrive from a JSON body (number) or a form (string). */
type NumericInput = string | number | null | undefined;

function toTrimmedString(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function hasRawValue(raw: NumericInput): boolean {
  return typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "");
}

/** Mirrors `parseDecimal` in `app/_actions/diagnostic-templates.ts`. */
function parseDecimalField(raw: NumericInput): Prisma.Decimal | null {
  const str = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : "";
  const cleaned = str.replace(/[,\s]/g, "");
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return new Prisma.Decimal(cleaned);
}

// --- shared structural validation (create + update) -------------------------

export type TemplateInput = {
  name: string;
  description?: string | null;
  type: string;
  isActive?: boolean;
  /** Raw, untrusted schema — validated with `validateSchema` (throws on shape errors). */
  schema: unknown;
  price?: NumericInput;
  durationMin?: NumericInput;
  categoryId?: string | null;
};

export type NormalizedTemplateData = {
  name: string;
  description: string | null;
  type: DiagnosticType;
  isActive: boolean;
  schema: TemplateSchema;
  price: Prisma.Decimal | null;
  durationMin: number | null;
  categoryId: string | null;
};

/**
 * Pure structural validation — mirrors `parse()` in
 * `app/_actions/diagnostic-templates.ts`. Existence/ownership of
 * `categoryId` is NOT checked here (that needs a DB read) — see
 * `assertCategory` below, called separately by each command, exactly like
 * the web action does.
 */
export function validateTemplateInput(input: TemplateInput): {
  data: NormalizedTemplateData;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};

  const name = toTrimmedString(input.name);
  if (!name) fieldErrors.name = "Хуудасны нэрээ оруулна уу.";

  const typeRaw = toTrimmedString(input.type);
  if (!DIAGNOSTIC_TYPES.includes(typeRaw as DiagnosticType)) {
    fieldErrors.type = "Төрлөө сонгоно уу.";
  }

  const categoryId = toTrimmedString(input.categoryId) || null;
  if (!categoryId) fieldErrors.categoryId = "Ангилал сонгоно уу.";

  const description = toTrimmedString(input.description);
  const isActive = input.isActive ?? false;

  let schema: TemplateSchema;
  try {
    schema = validateSchema(input.schema);
  } catch (e) {
    fieldErrors.schema = e instanceof Error ? e.message : "Хуудасны бүтэц буруу.";
    schema = { sections: [] };
  }

  let price: Prisma.Decimal | null = null;
  if (hasRawValue(input.price)) {
    price = parseDecimalField(input.price);
    if (!price) fieldErrors.price = "Үнэ буруу.";
  }

  let durationMin: number | null = null;
  if (hasRawValue(input.durationMin)) {
    const n =
      typeof input.durationMin === "number"
        ? input.durationMin
        : Number.parseInt(String(input.durationMin), 10);
    if (!Number.isFinite(n) || n < 0) {
      fieldErrors.durationMin = "Хугацаа буруу.";
    } else {
      durationMin = n;
    }
  }

  return {
    data: {
      name,
      description: description || null,
      type: typeRaw as DiagnosticType,
      isActive,
      schema,
      price,
      durationMin,
      categoryId,
    },
    fieldErrors,
  };
}

/** Category must resolve to a category owned by the SAME tenant — mirrors `assertCategory` in the web action. */
async function assertCategory(tenantId: string, categoryId: string | null): Promise<boolean> {
  if (!categoryId) return false;
  const cat = await prisma.category.findFirst({
    // Оношилгооны загварт — «Оношилгоо» эсвэл «Бүх төрөлд» ангилал.
    where: { id: categoryId, tenantId, OR: [{ kind: "DIAGNOSTIC" as const }, { kind: null }] },
    select: { id: true },
  });
  return Boolean(cat);
}

const TEMPLATE_RECORD_SELECT = {
  id: true,
  name: true,
  description: true,
  type: true,
  version: true,
  isActive: true,
  price: true,
  durationMin: true,
  categoryId: true,
  schema: true,
  updatedAt: true,
} satisfies Prisma.DiagnosticTemplateSelect;

export type DiagnosticTemplateRecord = Prisma.DiagnosticTemplateGetPayload<{
  select: typeof TEMPLATE_RECORD_SELECT;
}>;

// --- create ------------------------------------------------------------

export async function createTemplateCommand(input: {
  actor: DiagnosticTemplateCommandActor;
  data: TemplateInput;
}): Promise<DiagnosticTemplateRecord> {
  const { actor } = input;
  const { data, fieldErrors } = validateTemplateInput(input.data);
  if (Object.keys(fieldErrors).length > 0) {
    throw new DiagnosticTemplateCommandError("Хүсэлт буруу.", 422, "VALIDATION_FAILED", fieldErrors);
  }
  if (!(await assertCategory(actor.tenantId, data.categoryId))) {
    throw new DiagnosticTemplateCommandError(
      "Сонгосон ангилал олдсонгүй.",
      422,
      "VALIDATION_FAILED",
      { categoryId: "Сонгосон ангилал олдсонгүй." },
    );
  }

  // Багц boolean: оношилгооны модуль нээгдсэн эсэх
  if (!(await isFeatureEnabled(actor.tenantId, PLAN_LIMIT_CODES.ENABLE_DIAGNOSTICS))) {
    throw new DiagnosticTemplateCommandError(
      "Таны багц дээр оношилгооны модуль нээгдээгүй байна.",
      403,
      "FEATURE_DISABLED",
    );
  }
  const limit = await enforceCountLimit(
    actor.tenantId,
    PLAN_LIMIT_CODES.MAX_DIAGNOSTIC_TEMPLATES,
    () => prisma.diagnosticTemplate.count({ where: { tenantId: actor.tenantId } }),
  );
  if (!limit.allowed) {
    throw new DiagnosticTemplateCommandError(
      limit.message ?? "Хязгаарт хүрсэн байна.",
      403,
      "PLAN_LIMIT_REACHED",
    );
  }

  const created = await prisma.diagnosticTemplate.create({
    data: {
      name: data.name,
      description: data.description,
      type: data.type,
      isActive: data.isActive,
      schema: data.schema,
      price: data.price,
      durationMin: data.durationMin,
      categoryId: data.categoryId,
      version: 1,
      tenantId: actor.tenantId,
      createdById: actor.id,
    },
    select: TEMPLATE_RECORD_SELECT,
  });

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "DiagnosticTemplate",
    entityId: created.id,
    action: "CREATE",
    summary: `[${data.type}] ${data.name}`,
    after: { name: data.name, type: data.type, isActive: data.isActive, price: data.price?.toString() ?? null },
  });

  return created;
}

// --- update ------------------------------------------------------------

/**
 * Pure decision, no DB — compares two schemas structurally, matching
 * `updateTemplateAction`'s `JSON.stringify(existing.schema) !==
 * JSON.stringify(schema)` check exactly.
 */
export function schemaEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Pure decision, no DB — a schema-changing update bumps `version` ONLY when
 * the schema actually changed AND the template already has at least one
 * report. Split out for its own runtime test (P0-B1 idiom), covering all
 * three cases: no schema change; schema change with zero reports; schema
 * change with reports present.
 */
export function decideVersionBump(schemaChanged: boolean, reportCount: number): boolean {
  return schemaChanged && reportCount > 0;
}

export type TemplateUpdateResult = DiagnosticTemplateRecord & { versionBumped: boolean };

export async function updateTemplateCommand(input: {
  actor: DiagnosticTemplateCommandActor;
  templateId: string;
  data: TemplateInput;
}): Promise<TemplateUpdateResult> {
  const { actor, templateId } = input;
  const { data, fieldErrors } = validateTemplateInput(input.data);
  if (Object.keys(fieldErrors).length > 0) {
    throw new DiagnosticTemplateCommandError("Хүсэлт буруу.", 422, "VALIDATION_FAILED", fieldErrors);
  }
  if (!(await assertCategory(actor.tenantId, data.categoryId))) {
    throw new DiagnosticTemplateCommandError(
      "Сонгосон ангилал олдсонгүй.",
      422,
      "VALIDATION_FAILED",
      { categoryId: "Сонгосон ангилал олдсонгүй." },
    );
  }

  // Бөглөгдсөн тайлантай бол schema өөрчилбөл version-г өсгөнө
  const existing = await prisma.diagnosticTemplate.findFirst({
    where: { id: templateId, tenantId: actor.tenantId },
    select: { schema: true, version: true, isSystemDefault: true, _count: { select: { reports: true } } },
  });
  if (!existing) {
    throw new DiagnosticTemplateCommandError("Загвар олдсонгүй.", 404, "TEMPLATE_NOT_FOUND");
  }
  if (existing.isSystemDefault) {
    throw new DiagnosticTemplateCommandError(
      "Системийн үндсэн загварыг засах боломжгүй.",
      403,
      "SYSTEM_DEFAULT_IMMUTABLE",
    );
  }

  const schemaChanged = !schemaEqual(existing.schema, data.schema);
  const versionBumped = decideVersionBump(schemaChanged, existing._count.reports);

  const updated = await prisma.diagnosticTemplate.update({
    where: { id: templateId },
    data: {
      name: data.name,
      description: data.description,
      type: data.type,
      isActive: data.isActive,
      schema: data.schema,
      price: data.price,
      durationMin: data.durationMin,
      categoryId: data.categoryId,
      version: versionBumped ? existing.version + 1 : existing.version,
    },
    select: TEMPLATE_RECORD_SELECT,
  });

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "DiagnosticTemplate",
    entityId: templateId,
    action: "UPDATE",
    summary: `[${data.type}] ${data.name}${versionBumped ? ` · v${updated.version}` : ""}`,
    after: {
      name: data.name,
      type: data.type,
      isActive: data.isActive,
      price: data.price?.toString() ?? null,
      schemaChanged,
    },
  });

  return { ...updated, versionBumped };
}

// --- delete --------------------------------------------------------------

export type TemplateDeleteOutcome = "archived" | "deleted";

/**
 * Pure decision, no DB — archive when the template has report history,
 * hard-delete otherwise. Split out purely so it has its own real runtime
 * test rather than only a source-pattern assertion (P0-B1 idiom).
 */
export function decideTemplateDeleteOutcome(reportCount: number): TemplateDeleteOutcome {
  return reportCount > 0 ? "archived" : "deleted";
}

export type TemplateDeleteResult = {
  id: string;
  name: string;
  outcome: TemplateDeleteOutcome;
};

export async function deleteTemplateCommand(input: {
  actor: DiagnosticTemplateCommandActor;
  templateId: string;
}): Promise<TemplateDeleteResult> {
  const { actor, templateId } = input;

  // Тайлантай бол устгахгүй, зөвхөн идэвхгүй болгоно
  const t = await prisma.diagnosticTemplate.findFirst({
    where: { id: templateId, tenantId: actor.tenantId },
    select: { name: true, isSystemDefault: true, _count: { select: { reports: true } } },
  });
  if (!t) {
    throw new DiagnosticTemplateCommandError("Загвар олдсонгүй.", 404, "TEMPLATE_NOT_FOUND");
  }
  if (t.isSystemDefault) {
    throw new DiagnosticTemplateCommandError(
      "Системийн үндсэн загварыг устгах боломжгүй.",
      403,
      "SYSTEM_DEFAULT_IMMUTABLE",
    );
  }

  const outcome = decideTemplateDeleteOutcome(t._count.reports);
  if (outcome === "archived") {
    await prisma.diagnosticTemplate.update({
      where: { id: templateId },
      data: { isActive: false },
    });
  } else {
    await prisma.diagnosticTemplate.delete({ where: { id: templateId } });
  }

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "DiagnosticTemplate",
    entityId: templateId,
    action: outcome === "archived" ? "UPDATE" : "DELETE",
    summary: `${t.name}${outcome === "archived" ? " (архивлав)" : ""}`,
  });

  return { id: templateId, name: t.name, outcome };
}

// --- duplicate -----------------------------------------------------------

/**
 * NOTE: unlike `duplicateTemplateAction` (which enforces no plan limit
 * today — see module doc comment), this command enforces the SAME
 * `ENABLE_DIAGNOSTICS`/`MAX_DIAGNOSTIC_TEMPLATES` gates as create.
 */
export async function duplicateTemplateCommand(input: {
  actor: DiagnosticTemplateCommandActor;
  templateId: string;
}): Promise<DiagnosticTemplateRecord> {
  const { actor, templateId } = input;

  if (!(await isFeatureEnabled(actor.tenantId, PLAN_LIMIT_CODES.ENABLE_DIAGNOSTICS))) {
    throw new DiagnosticTemplateCommandError(
      "Таны багц дээр оношилгооны модуль нээгдээгүй байна.",
      403,
      "FEATURE_DISABLED",
    );
  }
  const limit = await enforceCountLimit(
    actor.tenantId,
    PLAN_LIMIT_CODES.MAX_DIAGNOSTIC_TEMPLATES,
    () => prisma.diagnosticTemplate.count({ where: { tenantId: actor.tenantId } }),
  );
  if (!limit.allowed) {
    throw new DiagnosticTemplateCommandError(
      limit.message ?? "Хязгаарт хүрсэн байна.",
      403,
      "PLAN_LIMIT_REACHED",
    );
  }

  // Өөрийн загвар эсвэл систем admin-аас олгосон хуваалцсан загвар (tenantId
  // NULL) аль алиныг нь хуулж болно.
  const src = await prisma.diagnosticTemplate.findFirst({
    where: { id: templateId, ...tenantVisibleTemplateWhere(actor.tenantId) },
  });
  if (!src) {
    throw new DiagnosticTemplateCommandError("Загвар олдсонгүй.", 404, "TEMPLATE_NOT_FOUND");
  }

  // Системийн загварын ангилал өөр tenant-ынх байж болзошгүй — зөвхөн энэ
  // tenant-ын ангилал бол хадгална (веб duplicateTemplateAction-тай ижил).
  const categoryId = src.categoryId
    ? (await prisma.category.findFirst({
        where: { id: src.categoryId, tenantId: actor.tenantId, OR: [{ kind: "DIAGNOSTIC" as const }, { kind: null }] },
        select: { id: true },
      }))?.id ?? null
    : null;

  const copy = await prisma.diagnosticTemplate.create({
    data: {
      name: `${src.name} (хуулбар)`,
      description: src.description,
      type: src.type,
      isActive: src.isActive,
      schema: src.schema as object,
      categoryId,
      price: src.price,
      durationMin: src.durationMin,
      version: 1,
      tenantId: actor.tenantId,
      createdById: actor.id,
    },
    select: TEMPLATE_RECORD_SELECT,
  });

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "DiagnosticTemplate",
    entityId: copy.id,
    action: "CREATE",
    summary: `${copy.name} (${src.name}-ээс хуулбарлав)`,
  });

  return copy;
}
