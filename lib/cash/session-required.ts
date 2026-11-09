import { prisma } from "@/lib/prisma";

/**
 * Тенант төлбөр бүртгэхийн өмнө касс (ээлж) заавал нээлгэдэг эсэх (Tenant.requireCashSession,
 * анхдагч true). Server-ийн эцсийн шалгалт assertCashSessionOpen дотор (lib/cash/session-attach.ts);
 * энэ нь UI-ийн сануулга болон түгжээгүй эрт шалгалтад.
 */
export async function isCashSessionRequired(tenantId: string): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { requireCashSession: true } });
  return tenant?.requireCashSession ?? true;
}
