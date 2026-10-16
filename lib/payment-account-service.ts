import { logAudit } from "@/lib/audit";
import { hasPermission, type RoleCheckUser } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import {
  CREATABLE_PAYMENT_ACCOUNT_TYPES,
  PaymentAccountError,
  maskAccountNumber,
  methodForType,
  normalizeAccountNumber,
  type PaymentAccountTypeValue,
} from "@/lib/payment-accounts";

export type PaymentAccountActor = RoleCheckUser & { id: string; tenantId: string };

const ID_RE = /^[A-Za-z0-9]{1,32}$/;
const invalid = (field: string, message: string) =>
  new PaymentAccountError(message, "PAYMENT_ACCOUNT_INVALID", 422, { [field]: message });

function optionalId(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw invalid(field, "Буруу утга.");
  const v = value.trim();
  if (!v) return null;
  if (!ID_RE.test(v)) throw invalid(field, "Зөвхөн үсэг, тоо (32 хүртэл тэмдэгт).");
  return v;
}

type Validated = {
  type?: PaymentAccountTypeValue;
  name?: string;
  accountNumber?: string;
  terminalId?: string | null;
  merchantId?: string | null;
  isTest?: boolean;
  isActive?: boolean;
};

/**
 * Pure shape validation. create: BANK_ACCOUNT / POS only (CASH is created automatically, one per tenant), with
 * type/name/accountNumber required. update: type is immutable; CASH rules are checked against the stored type.
 */
export function validatePaymentAccountInput(input: unknown, mode: "create" | "update"): Validated {
  if (input == null || typeof input !== "object" || Array.isArray(input)) throw invalid("body", "Буруу хүсэлт.");
  const o = input as Record<string, unknown>;
  const out: Validated = {};

  if (mode === "update" && o.type !== undefined) throw invalid("type", "Төрлийг өөрчлөх боломжгүй.");
  if (mode === "create") {
    if (o.type === "CASH") throw invalid("type", "«Бэлэн» автоматаар бий — шинээр нэмэх шаардлагагүй.");
    if (typeof o.type !== "string" || !(CREATABLE_PAYMENT_ACCOUNT_TYPES as readonly string[]).includes(o.type)) {
      throw invalid("type", "Төрөл сонгоно уу (Данс эсвэл POS).");
    }
    out.type = o.type as PaymentAccountTypeValue;
  }

  if (mode === "create" || o.name !== undefined) {
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (name.length < 2 || name.length > 80) throw invalid("name", "Нэр 2–80 тэмдэгт байна.");
    out.name = name;
  }

  if (mode === "create" || o.accountNumber !== undefined) {
    const digits = normalizeAccountNumber(o.accountNumber);
    if (!digits || digits.length < 6 || digits.length > 20) throw invalid("accountNumber", "Дансны дугаар 6–20 орон байна.");
    out.accountNumber = digits;
  }

  const hasTerminal = o.terminalId !== undefined && o.terminalId !== null && o.terminalId !== "";
  const hasMerchant = o.merchantId !== undefined && o.merchantId !== null && o.merchantId !== "";
  const hasTest = o.isTest !== undefined && o.isTest !== false;
  if (mode === "create") {
    if (out.type !== "POS" && (hasTerminal || hasMerchant || hasTest)) {
      throw invalid("type", "Терминал, Туршилт зөвхөн POS-д хамаарна.");
    }
    out.terminalId = optionalId(o.terminalId, "terminalId");
    out.merchantId = optionalId(o.merchantId, "merchantId");
    out.isTest = out.type === "POS" ? o.isTest === true : false;
  } else {
    // Update: POS-only fields are checked against the stored type in updatePaymentAccount.
    if (o.terminalId !== undefined) out.terminalId = optionalId(o.terminalId, "terminalId");
    if (o.merchantId !== undefined) out.merchantId = optionalId(o.merchantId, "merchantId");
    if (o.isTest !== undefined) {
      if (typeof o.isTest !== "boolean") throw invalid("isTest", "Буруу утга.");
      out.isTest = o.isTest;
    }
  }

  if (o.isActive !== undefined) {
    if (typeof o.isActive !== "boolean") throw invalid("isActive", "Буруу утга.");
    out.isActive = o.isActive;
  }
  return out;
}

const SELECT = {
  id: true, type: true, name: true, accountNumber: true, terminalId: true, merchantId: true, isTest: true, isActive: true,
} as const;
type Row = { id: string; type: string; name: string; accountNumber: string | null; terminalId: string | null; merchantId: string | null; isTest: boolean; isActive: boolean };

export type PaymentAccountDto = {
  id: string;
  type: PaymentAccountTypeValue;
  method: "CASH" | "BANK_TRANSFER" | "CARD";
  name: string;
  /** Full number (null for CASH). */
  accountNumber: string | null;
  /** Kept for older API clients; the UI shows the full number. */
  accountNumberMasked: string;
  terminalId: string | null;
  merchantId: string | null;
  isTest: boolean;
  isActive: boolean;
};

function toDto(row: Row): PaymentAccountDto {
  const type = row.type as PaymentAccountTypeValue;
  return {
    id: row.id,
    type,
    method: methodForType(type),
    name: row.name,
    accountNumber: row.accountNumber,
    accountNumberMasked: maskAccountNumber(row.accountNumber),
    terminalId: row.terminalId,
    merchantId: row.merchantId,
    isTest: row.isTest,
    isActive: row.isActive,
  };
}

function assertManage(actor: PaymentAccountActor) {
  if (!hasPermission(actor, "cash.manage")) {
    throw new PaymentAccountError("Танд кассыг удирдах эрх байхгүй.", "CASH_MANAGE_FORBIDDEN", 403);
  }
}

const auditView = (r: Row) => ({
  type: r.type, name: r.name, accountNumber: r.accountNumber, terminalId: r.terminalId,
  merchantId: r.merchantId, isTest: r.isTest, isActive: r.isActive,
});

export async function listPaymentAccounts(input: { actor: PaymentAccountActor; includeInactive?: boolean }): Promise<PaymentAccountDto[]> {
  const rows = (await prisma.paymentAccount.findMany({
    where: { tenantId: input.actor.tenantId, ...(input.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ type: "asc" }, { name: "asc" }, { id: "asc" }],
    select: SELECT,
  })) as Row[];
  return rows.map(toDto);
}

export async function createPaymentAccount(input: { actor: PaymentAccountActor; data: unknown }): Promise<PaymentAccountDto> {
  assertManage(input.actor);
  const v = validatePaymentAccountInput(input.data, "create");
  const tenantId = input.actor.tenantId;
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = (await tx.paymentAccount.create({
        data: {
          tenantId,
          type: v.type!,
          name: v.name!,
          accountNumber: v.accountNumber!,
          terminalId: v.terminalId ?? null,
          merchantId: v.merchantId ?? null,
          isTest: v.isTest ?? false,
        },
        select: SELECT,
      })) as Row;
      await logAudit({
        tenantId, userId: input.actor.id, entity: "PaymentAccount", entityId: created.id, action: "CREATE",
        summary: `Төлбөрийн арга нэмэв: ${created.name}`, after: auditView(created),
      }, tx);
      return created;
    });
    return toDto(row);
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "P2002") {
      throw new PaymentAccountError("Энэ дансны дугаар аль хэдийн бүртгэгдсэн байна.", "PAYMENT_ACCOUNT_DUPLICATE", 409, { accountNumber: "Давхардсан дугаар." });
    }
    throw error;
  }
}

export async function updatePaymentAccount(input: { actor: PaymentAccountActor; id: string; data: unknown }): Promise<PaymentAccountDto> {
  assertManage(input.actor);
  const v = validatePaymentAccountInput(input.data, "update");
  const tenantId = input.actor.tenantId;
  try {
    const row = await prisma.$transaction(async (tx) => {
      const before = (await tx.paymentAccount.findFirst({ where: { id: input.id, tenantId }, select: SELECT })) as Row | null;
      if (!before) throw new PaymentAccountError("Төлбөрийн арга олдсонгүй.", "PAYMENT_ACCOUNT_NOT_FOUND", 404);
      if (before.type === "CASH" && v.accountNumber !== undefined) {
        throw invalid("accountNumber", "Бэлэн төрөлд дансны дугаар хэрэггүй.");
      }
      if (before.type === "CASH" && v.isActive === false) {
        throw invalid("isActive", "«Бэлэн» үргэлж идэвхтэй — унтраах боломжгүй.");
      }
      if (before.type !== "POS" && (v.terminalId || v.merchantId || v.isTest)) {
        throw invalid("type", "Терминал, Туршилт зөвхөн POS-д хамаарна.");
      }
      const updated = (await tx.paymentAccount.update({ where: { id: before.id }, data: v, select: SELECT })) as Row;
      await logAudit({
        tenantId, userId: input.actor.id, entity: "PaymentAccount", entityId: updated.id, action: "UPDATE",
        summary: `Төлбөрийн арга засав: ${updated.name}`, before: auditView(before), after: auditView(updated),
      }, tx);
      return updated;
    });
    return toDto(row);
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "P2002") {
      throw new PaymentAccountError("Энэ дансны дугаар аль хэдийн бүртгэгдсэн байна.", "PAYMENT_ACCOUNT_DUPLICATE", 409, { accountNumber: "Давхардсан дугаар." });
    }
    throw error;
  }
}

// --- bulk ------------------------------------------------------------------

export const PAYMENT_ACCOUNT_BULK_MAX = 200;

export type PaymentAccountBulkItem = {
  id: string;
  name: string | null;
  /** deleted / updated / unchanged = done; the rest are skipped with `message`. */
  status: "deleted" | "updated" | "unchanged" | "in_use" | "cash" | "not_found" | "invalid";
  /** in_use: payments + cash entries + settlements that reference the account. */
  usage?: number;
  message?: string;
};

function bulkIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) throw invalid("ids", "ids массив шаардлагатай.");
  const unique = [...new Set(ids.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim()))];
  if (unique.length === 0) throw invalid("ids", "Нэг ч төлбөрийн арга сонгоогүй байна.");
  if (unique.length > PAYMENT_ACCOUNT_BULK_MAX) throw invalid("ids", `Нэг удаад ${PAYMENT_ACCOUNT_BULK_MAX} хүртэл.`);
  return unique;
}

/**
 * Deletes payment methods that nothing references. An account any payment, cash entry or postpaid settlement points
 * at stays (those rows keep their account via a Restrict FK and history must keep its label) — it is reported as
 * `in_use` so the caller can deactivate it instead. «Бэлэн» is automatic and never deleted. One transaction per id.
 */
export async function deletePaymentAccounts(input: { actor: PaymentAccountActor; ids: unknown }): Promise<PaymentAccountBulkItem[]> {
  assertManage(input.actor);
  const tenantId = input.actor.tenantId;
  const results: PaymentAccountBulkItem[] = [];
  for (const id of bulkIds(input.ids)) {
    try {
      results.push(
        await prisma.$transaction(async (tx) => {
          const row = (await tx.paymentAccount.findFirst({ where: { id, tenantId }, select: SELECT })) as Row | null;
          if (!row) return { id, name: null, status: "not_found" as const, message: "Олдсонгүй." };
          if (row.type === "CASH") return { id, name: row.name, status: "cash" as const, message: "«Бэлэн» автоматаар бий — устгахгүй." };
          const [payments, entries, settlements] = await Promise.all([
            tx.orderPayment.count({ where: { tenantId, bankId: id } }),
            tx.cashTransaction.count({ where: { tenantId, bankId: id } }),
            tx.postpaidSettlement.count({ where: { tenantId, bankId: id } }),
          ]);
          const usage = payments + entries + settlements;
          if (usage > 0) {
            return { id, name: row.name, status: "in_use" as const, usage, message: `${usage} гүйлгээнд ашиглагдсан — идэвхгүй болгоно уу.` };
          }
          await tx.paymentAccount.delete({ where: { id } });
          await logAudit({
            tenantId, userId: input.actor.id, entity: "PaymentAccount", entityId: id, action: "DELETE",
            summary: `Төлбөрийн арга устгав: ${row.name}`, before: auditView(row),
          }, tx);
          return { id, name: row.name, status: "deleted" as const };
        }),
      );
    } catch (error) {
      // A payment recorded between the count and the delete: the Restrict FK refuses it.
      if ((error as { code?: string } | null)?.code === "P2003") {
        results.push({ id, name: null, status: "in_use", message: "Гүйлгээнд ашиглагдсан — идэвхгүй болгоно уу." });
      } else {
        throw error;
      }
    }
  }
  return results;
}

/** Activates / deactivates many accounts (same rules as a single update: «Бэлэн» cannot be switched off). */
export async function setPaymentAccountsActive(input: { actor: PaymentAccountActor; ids: unknown; isActive: boolean }): Promise<PaymentAccountBulkItem[]> {
  assertManage(input.actor);
  const results: PaymentAccountBulkItem[] = [];
  for (const id of bulkIds(input.ids)) {
    const before = await prisma.paymentAccount.findFirst({ where: { id, tenantId: input.actor.tenantId }, select: { name: true, isActive: true } });
    if (!before) {
      results.push({ id, name: null, status: "not_found", message: "Олдсонгүй." });
      continue;
    }
    if (before.isActive === input.isActive) {
      results.push({ id, name: before.name, status: "unchanged" });
      continue;
    }
    try {
      await updatePaymentAccount({ actor: input.actor, id, data: { isActive: input.isActive } });
      results.push({ id, name: before.name, status: "updated" });
    } catch (error) {
      if (!(error instanceof PaymentAccountError)) throw error;
      results.push({ id, name: before.name, status: error.code === "PAYMENT_ACCOUNT_NOT_FOUND" ? "not_found" : "invalid", message: error.message });
    }
  }
  return results;
}

export function toPickerAccount(dto: PaymentAccountDto) {
  return {
    id: dto.id, type: dto.type, method: dto.method, name: dto.name, accountNumber: dto.accountNumber, accountNumberMasked: dto.accountNumberMasked,
    terminalId: dto.terminalId, merchantId: dto.merchantId, isTest: dto.isTest,
  };
}

/** Active accounts for payment pickers: any authenticated staff. */
export async function listPickerAccounts(tenantId: string) {
  const rows = (await prisma.paymentAccount.findMany({
    where: { tenantId, isActive: true },
    orderBy: [{ type: "asc" }, { name: "asc" }, { id: "asc" }],
    select: SELECT,
  })) as Row[];
  return rows.map((r) => toPickerAccount(toDto(r)));
}
