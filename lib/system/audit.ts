// System талын өөрчлөлтийн аудит: хэн (SuperAdmin), юуг, өмнө/дараа. lib/audit.ts (tenant хэрэглэгчид, tenantId
// заавал)-аас тусдаа — SystemAuditLog (tenantId нь FK-гүй тул tenant устгагдахад түүх үлдэнэ).
// Аудит унавал үндсэн үйлдлийг унагаахгүй (lib/audit.ts logAudit-тай ижил зарчим), гэхдээ бичигдээгүйг warn-д үлдээнэ.

import type { Prisma } from "@/app/generated/prisma/client";
import { ipOrNull } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";

export type SystemAuditInput = {
  adminId: string;
  tenantId?: string | null;
  entity: string;
  entityId: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "STATUS_CHANGE" | "LOGIN";
  summary?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  req?: Request;
};

export async function logSystemAudit(input: SystemAuditInput, db: Pick<typeof prisma, "systemAuditLog"> = prisma): Promise<void> {
  try {
    await db.systemAuditLog.create({
      data: {
        adminId: input.adminId,
        tenantId: input.tenantId ?? null,
        entity: input.entity,
        entityId: input.entityId,
        action: input.action,
        summary: input.summary ?? null,
        before: input.before ?? undefined,
        after: input.after ?? undefined,
        ipAddress: input.req ? ipOrNull(input.req.headers) : null,
        userAgent: input.req?.headers.get("user-agent") ?? null,
      },
    });
  } catch (err) {
    console.warn("[system-audit] log failed:", err instanceof Error ? err.name : err);
  }
}
