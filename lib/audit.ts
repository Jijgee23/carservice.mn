import { Prisma } from "@/app/generated/prisma/client";
import { prisma, type PrismaTransactionClient } from "./prisma";

// P7-B1 — `ACTION_TYPES` mirrors `AuditAction` as a value (the type alone
// can't be iterated) so `GET /api/v1/audit` can return it as a vocab list
// for filter chips, same idea as `ENTITY_TYPES` below.
export const ACTION_TYPES = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "STATUS_CHANGE",
  "PAYMENT_CHANGE",
  "STOCK_CHANGE",
  "ITEM_ADDED",
  "ITEM_REMOVED",
  "ITEM_UPDATED",
  "ITEM_CANCELLED",
  "ITEM_STATUS_CHANGE",
  "LOGIN",
  "LOGOUT",
  "OTHER",
] as const;

export type AuditAction = (typeof ACTION_TYPES)[number];

// DB enum биш (уян хатан байлгах зорилготой) ч typo-г compile үед барихын тулд
// TypeScript const — шинэ entity нэмэхдээ энд нэмнэ (audit хуудасны ENTITY_LABEL
// `Record<EntityType, string>` тул мартвал typecheck алдаа өгнө).
export const ENTITY_TYPES = [
  "ServiceOrder",
  "Service",
  "Customer",
  "Vehicle",
  "User",
  "Branch",
  "Category",
  "Unit",
  "Tenant",
  "Role",
  "DiagnosticTemplate",
  "DiagnosticReport",
  "Appointment",
  "Notification",
  "CashTransaction",
  "CashTransactionType",
  "PostpaidSettlement",
  "CashSession",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export type AuditInput = {
  tenantId: string;
  entity: EntityType;
  entityId: string;
  action: AuditAction;
  summary?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  userId?: string | null;
  branchId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

// $transaction-н дотор зэрэг үүсгэх боломжтой болгох үүднээс client-ийг
// сонголтоор авдаг (default — глобал prisma).
type Client = PrismaTransactionClient;

/**
 * AuditLog бичлэг үүсгэнэ. Үндсэн үйлдлийн транзакцийн дотроос дуудах нь
 * хамгийн зөв — ингэснээр үндсэн өөрчлөлт rollback болсон үед лог үлдэхгүй.
 *
 * Алдаа гарвал шидэхгүй (warn хийгээд үргэлжлүүлнэ) — аудит лог нь үндсэн
 * үйлдлийн хариуцлагыг тасалдуулахгүй байх ёстой.
 */
export async function logAudit(
  input: AuditInput,
  client: Client = prisma,
): Promise<void> {
  try {
    await client.auditLog.create({
      data: {
        tenantId: input.tenantId,
        entity: input.entity,
        entityId: input.entityId,
        action: input.action,
        summary: input.summary ?? null,
        before: input.before ?? Prisma.DbNull,
        after: input.after ?? Prisma.DbNull,
        userId: input.userId ?? null,
        branchId: input.branchId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (err) {
    // Аудит лог унавал үндсэн үйлдлийг алдагдуулахгүй
    console.warn("[audit] log failed:", err);
  }
}
