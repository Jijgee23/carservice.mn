import { isCashSessionRequired } from "@/lib/cash/session-required";
import { prisma } from "@/lib/prisma";

/** Ids of the given branches that currently have an open cash session (for the non-blocking CASH warnings). */
export async function openSessionBranchIds(tenantId: string, branchIds: string[]): Promise<string[]> {
  if (branchIds.length === 0) return [];
  // Касс заавал нээх тохиргоо унтраалттай бол бүх салбарыг «нээлттэй» гэж үзнэ —
  // UI сануулга гаргахгүй, товч хаахгүй (server ч шаардахгүй).
  if (!(await isCashSessionRequired(tenantId))) return [...new Set(branchIds)];
  const rows = await prisma.cashSession.findMany({
    where: { tenantId, branchId: { in: branchIds }, closedAt: null },
    select: { branchId: true },
  });
  return [...new Set(rows.map((r) => r.branchId))];
}
