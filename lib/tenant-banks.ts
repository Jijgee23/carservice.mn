import { logAudit } from "@/lib/audit";
import { BANKS, enabledBanksFor, normalizeEnabledBanks } from "@/lib/banks";
import { hasPermission, type RoleCheckUser } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";

export class TenantBanksError extends Error {
  constructor(message: string, readonly status = 422, readonly code = "BANKS_REJECTED") {
    super(message);
    this.name = "TenantBanksError";
  }
}

export type TenantBanksPayload = {
  banks: Array<{ code: string; label: string }>;
  /** Идэвхтэй кодууд (хоосон тохиргоо → бүх банк). */
  enabledBanks: string[];
  /** Тенант өөрөө сонголт хийсэн эсэх (false = анхдагч, бүгд идэвхтэй). */
  configured: boolean;
};

export async function getTenantBanks(tenantId: string): Promise<TenantBanksPayload> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { enabledBanks: true } });
  const stored = tenant?.enabledBanks ?? [];
  return {
    banks: BANKS.map((b) => ({ code: b.code, label: b.label })),
    enabledBanks: enabledBanksFor(stored),
    configured: stored.length > 0,
  };
}

/** Идэвхтэй банкуудыг шинэчилнэ (cash.manage). Хоосон жагсаалт = бүх банк идэвхтэй. */
export async function setTenantEnabledBanks(input: {
  actor: RoleCheckUser & { id: string; tenantId: string };
  enabledBanks: unknown;
}): Promise<TenantBanksPayload> {
  if (!hasPermission(input.actor, "cash.manage")) {
    throw new TenantBanksError("Танд кассыг удирдах эрх байхгүй.", 403, "CASH_MANAGE_FORBIDDEN");
  }
  const codes = normalizeEnabledBanks(input.enabledBanks);
  if (!codes) throw new TenantBanksError("Банкны код буруу байна.", 422, "BANK_CODE_INVALID");
  const tenantId = input.actor.tenantId;
  await prisma.$transaction(async (tx) => {
    const before = await tx.tenant.findUnique({ where: { id: tenantId }, select: { enabledBanks: true } });
    await tx.tenant.update({ where: { id: tenantId }, data: { enabledBanks: codes } });
    await logAudit({
      tenantId,
      userId: input.actor.id,
      entity: "Tenant",
      entityId: tenantId,
      action: "UPDATE",
      summary: codes.length > 0 ? `Идэвхтэй банк: ${codes.join(", ")}` : "Идэвхтэй банк: бүгд",
      before: { enabledBanks: before?.enabledBanks ?? [] },
      after: { enabledBanks: codes },
    }, tx);
  });
  return getTenantBanks(tenantId);
}
