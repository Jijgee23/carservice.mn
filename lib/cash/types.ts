import { logAudit } from "@/lib/audit";
import { hasPermission, type RoleCheckUser } from "@/lib/auth/roles";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import {
  assertTypeEditable,
  CashError,
  cashForbidden,
  DEFAULT_TYPE_DEFS,
  isCashDirection,
  normalizeTypeName,
  SYSTEM_TYPE_DEFS,
  type CashDirectionValue,
  type SystemTypeKey,
} from "./rules";

export type CashActor = RoleCheckUser & {
  id: string;
  tenantId: string;
  branchId?: string | null;
  assignableBranchIds?: string[];
  workingBranchId?: string | null;
};

export const CASH_TYPE_SELECT = {
  id: true,
  direction: true,
  name: true,
  systemKey: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type CashTypeRow = {
  id: string;
  direction: string;
  name: string;
  systemKey: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** JSON shape of a type for the staff API. */
export function serializeCashType(type: CashTypeRow) {
  return {
    id: type.id,
    direction: type.direction as CashDirectionValue,
    name: type.name,
    systemKey: type.systemKey,
    isSystem: type.systemKey != null,
    isActive: type.isActive,
    createdAt: type.createdAt.toISOString(),
    updatedAt: type.updatedAt.toISOString(),
  };
}

type Client = PrismaTransactionClient | typeof prisma;

/**
 * Lazily seeds the three system types (always) and the editable defaults
 * (only when the tenant has no types at all, so a deliberate rename/deactivate
 * is never undone). Safe to call concurrently: createMany skips duplicates.
 */
export async function ensureSystemTypes(client: Client, tenantId: string): Promise<void> {
  const existing = await client.cashTransactionType.findMany({ where: { tenantId }, select: { id: true, systemKey: true, direction: true, name: true } });
  const have = new Set(existing.map((t) => t.systemKey).filter((k): k is string => k != null));
  const missingSystem = SYSTEM_TYPE_DEFS.filter((d) => !have.has(d.systemKey));
  const toCreate: typeof missingSystem = [];
  for (const d of missingSystem) {
    // A same-direction, same-name editable type already exists: adopt it as the system type
    // (otherwise the unique key silently blocks seeding and payments would fail).
    const adoptable = existing.find((t) => t.systemKey == null && t.direction === d.direction && t.name === d.name);
    if (adoptable) {
      await client.cashTransactionType.update({ where: { id: adoptable.id }, data: { systemKey: d.systemKey, isActive: true } });
    } else {
      toCreate.push(d);
    }
  }
  const data = [
    ...toCreate.map((d) => ({ tenantId, direction: d.direction, name: d.name, systemKey: d.systemKey })),
    ...(existing.length === 0 ? DEFAULT_TYPE_DEFS.map((d) => ({ tenantId, direction: d.direction, name: d.name })) : []),
  ];
  if (data.length === 0) return;
  await client.cashTransactionType.createMany({ data, skipDuplicates: true });
}

/** Id of a tenant's system type, seeding on first use. Used by the payment/order sync hooks. */
export async function getSystemTypeId(client: Client, tenantId: string, key: SystemTypeKey): Promise<string> {
  const found = await client.cashTransactionType.findFirst({ where: { tenantId, systemKey: key }, select: { id: true } });
  if (found) return found.id;
  await ensureSystemTypes(client, tenantId);
  const seeded = await client.cashTransactionType.findFirst({ where: { tenantId, systemKey: key }, select: { id: true } });
  if (!seeded) throw new CashError("Кассын системийн төрөл үүсгэж чадсангүй.", 500, "CASH_TYPE_INVALID");
  return seeded.id;
}

function assertCashManage(actor: RoleCheckUser) {
  if (!hasPermission(actor, "cash.manage")) throw cashForbidden();
}

export async function listCashTypes(input: {
  actor: CashActor;
  direction?: unknown;
  includeInactive?: boolean;
}) {
  assertCashManage(input.actor);
  if (input.direction !== undefined && input.direction !== null && input.direction !== "" && !isCashDirection(input.direction)) {
    throw new CashError("Төрлийн чиглэл буруу.", 422, "CASH_TYPE_INVALID", { direction: "Чиглэл буруу." });
  }
  await ensureSystemTypes(prisma, input.actor.tenantId);
  const rows = await prisma.cashTransactionType.findMany({
    where: {
      tenantId: input.actor.tenantId,
      ...(isCashDirection(input.direction) ? { direction: input.direction } : {}),
      ...(input.includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ direction: "asc" }, { systemKey: "asc" }, { name: "asc" }],
    select: CASH_TYPE_SELECT,
  });
  return rows;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export async function createCashType(input: { actor: CashActor; direction: unknown; name: unknown }) {
  assertCashManage(input.actor);
  if (!isCashDirection(input.direction)) {
    throw new CashError("Төрлийн чиглэл буруу.", 422, "CASH_TYPE_INVALID", { direction: "Чиглэл буруу." });
  }
  const direction = input.direction;
  const name = normalizeTypeName(input.name);
  const tenantId = input.actor.tenantId;
  try {
    return await prisma.$transaction(async (tx) => {
      await ensureSystemTypes(tx, tenantId);
      const dup = await tx.cashTransactionType.findFirst({ where: { tenantId, direction, name }, select: { id: true } });
      if (dup) throw new CashError("Ийм нэртэй төрөл байна.", 409, "CASH_TYPE_DUPLICATE", { name: "Ийм нэртэй төрөл байна." });
      const created = await tx.cashTransactionType.create({
        data: { tenantId, direction, name },
        select: CASH_TYPE_SELECT,
      });
      await logAudit({
        tenantId,
        userId: input.actor.id,
        entity: "CashTransactionType",
        entityId: created.id,
        action: "CREATE",
        summary: `${direction === "INCOME" ? "Орлогын" : "Зарлагын"} төрөл: ${name}`,
        after: { direction, name },
      }, tx);
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new CashError("Ийм нэртэй төрөл байна.", 409, "CASH_TYPE_DUPLICATE", { name: "Ийм нэртэй төрөл байна." });
    throw error;
  }
}

/** Rename and/or (de)activate an editable type. System types -> 422 CASH_TYPE_SYSTEM. */
export async function updateCashType(input: {
  actor: CashActor;
  typeId: string;
  name?: unknown;
  isActive?: unknown;
}) {
  assertCashManage(input.actor);
  if (input.name === undefined && input.isActive === undefined) {
    throw new CashError("Өөрчлөх талбар алга.", 422, "CASH_TYPE_NAME_INVALID");
  }
  if (input.isActive !== undefined && typeof input.isActive !== "boolean") {
    throw new CashError("isActive буруу.", 422, "CASH_TYPE_INVALID", { isActive: "isActive буруу." });
  }
  const name = input.name !== undefined ? normalizeTypeName(input.name) : undefined;
  const tenantId = input.actor.tenantId;
  try {
    return await prisma.$transaction(async (tx) => {
      const type = await tx.cashTransactionType.findFirst({ where: { id: input.typeId, tenantId }, select: CASH_TYPE_SELECT });
      if (!type) throw new CashError("Төрөл олдсонгүй.", 404, "CASH_TYPE_INVALID");
      assertTypeEditable(type);
      if (name !== undefined && name !== type.name) {
        const dup = await tx.cashTransactionType.findFirst({
          where: { tenantId, direction: type.direction, name, NOT: { id: type.id } },
          select: { id: true },
        });
        if (dup) throw new CashError("Ийм нэртэй төрөл байна.", 409, "CASH_TYPE_DUPLICATE", { name: "Ийм нэртэй төрөл байна." });
      }
      const data: { name?: string; isActive?: boolean } = {};
      if (name !== undefined && name !== type.name) data.name = name;
      if (typeof input.isActive === "boolean" && input.isActive !== type.isActive) data.isActive = input.isActive;
      if (Object.keys(data).length === 0) return type;
      const updated = await tx.cashTransactionType.update({ where: { id: type.id }, data, select: CASH_TYPE_SELECT });
      await logAudit({
        tenantId,
        userId: input.actor.id,
        entity: "CashTransactionType",
        entityId: type.id,
        action: "UPDATE",
        summary: data.name ? `Төрлийн нэр: ${type.name} → ${data.name}` : `${type.name} · ${data.isActive ? "идэвхжүүлсэн" : "идэвхгүй болгосон"}`,
        before: { name: type.name, isActive: type.isActive },
        after: { name: updated.name, isActive: updated.isActive },
      }, tx);
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new CashError("Ийм нэртэй төрөл байна.", 409, "CASH_TYPE_DUPLICATE", { name: "Ийм нэртэй төрөл байна." });
    throw error;
  }
}
