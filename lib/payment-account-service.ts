import { logAudit } from "@/lib/audit";
import { hasPermission, type RoleCheckUser } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import {
  PAYMENT_ACCOUNT_TYPES,
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

/** Pure shape validation. create: type/name/accountNumber required. update: type is immutable. */
export function validatePaymentAccountInput(input: unknown, mode: "create" | "update"): Validated {
  if (input == null || typeof input !== "object" || Array.isArray(input)) throw invalid("body", "Буруу хүсэлт.");
  const o = input as Record<string, unknown>;
  const out: Validated = {};

  if (mode === "update" && o.type !== undefined) throw invalid("type", "Төрлийг өөрчлөх боломжгүй.");
  if (mode === "create") {
    if (typeof o.type !== "string" || !(PAYMENT_ACCOUNT_TYPES as readonly string[]).includes(o.type)) {
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
  method: "BANK_TRANSFER" | "CARD";
  name: string;
  /** Full number — only for cash.manage callers; null otherwise. */
  accountNumber: string | null;
  accountNumberMasked: string;
  terminalId: string | null;
  merchantId: string | null;
  isTest: boolean;
  isActive: boolean;
};

function toDto(row: Row, revealNumber: boolean): PaymentAccountDto {
  const type = row.type as PaymentAccountTypeValue;
  return {
    id: row.id,
    type,
    method: methodForType(type),
    name: row.name,
    accountNumber: revealNumber ? row.accountNumber : null,
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
  type: r.type, name: r.name, accountNumber: maskAccountNumber(r.accountNumber), terminalId: r.terminalId,
  merchantId: r.merchantId, isTest: r.isTest, isActive: r.isActive,
});

export async function listPaymentAccounts(input: { actor: PaymentAccountActor; includeInactive?: boolean }): Promise<PaymentAccountDto[]> {
  const reveal = hasPermission(input.actor, "cash.manage");
  const rows = (await prisma.paymentAccount.findMany({
    where: { tenantId: input.actor.tenantId, ...(input.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ type: "asc" }, { name: "asc" }, { id: "asc" }],
    select: SELECT,
  })) as Row[];
  return rows.map((r) => toDto(r, reveal));
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
        summary: `Төлбөрийн сонголт нэмэв: ${created.name}`, after: auditView(created),
      }, tx);
      return created;
    });
    return toDto(row, true);
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
      if (!before) throw new PaymentAccountError("Төлбөрийн сонголт олдсонгүй.", "PAYMENT_ACCOUNT_NOT_FOUND", 404);
      if (before.type !== "POS" && (v.terminalId || v.merchantId || v.isTest)) {
        throw invalid("type", "Терминал, Туршилт зөвхөн POS-д хамаарна.");
      }
      const updated = (await tx.paymentAccount.update({ where: { id: before.id }, data: v, select: SELECT })) as Row;
      await logAudit({
        tenantId, userId: input.actor.id, entity: "PaymentAccount", entityId: updated.id, action: "UPDATE",
        summary: `Төлбөрийн сонголт засав: ${updated.name}`, before: auditView(before), after: auditView(updated),
      }, tx);
      return updated;
    });
    return toDto(row, true);
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "P2002") {
      throw new PaymentAccountError("Энэ дансны дугаар аль хэдийн бүртгэгдсэн байна.", "PAYMENT_ACCOUNT_DUPLICATE", 409, { accountNumber: "Давхардсан дугаар." });
    }
    throw error;
  }
}

export function toPickerAccount(dto: PaymentAccountDto) {
  return {
    id: dto.id, type: dto.type, method: dto.method, name: dto.name, accountNumberMasked: dto.accountNumberMasked,
    terminalId: dto.terminalId, merchantId: dto.merchantId, isTest: dto.isTest,
  };
}

/** Active accounts for payment pickers: any authenticated staff, never the full number. */
export async function listPickerAccounts(tenantId: string) {
  const rows = (await prisma.paymentAccount.findMany({
    where: { tenantId, isActive: true },
    orderBy: [{ type: "asc" }, { name: "asc" }, { id: "asc" }],
    select: SELECT,
  })) as Row[];
  return rows.map((r) => toPickerAccount(toDto(r, false)));
}
