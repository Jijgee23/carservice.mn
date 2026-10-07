import { prisma } from "@/lib/prisma";

/** Ids of the given branches that currently have an open cash session (for the non-blocking CASH warnings). */
export async function openSessionBranchIds(tenantId: string, branchIds: string[]): Promise<string[]> {
  if (branchIds.length === 0) return [];
  const rows = await prisma.cashSession.findMany({
    where: { tenantId, branchId: { in: branchIds }, closedAt: null },
    select: { branchId: true },
  });
  return [...new Set(rows.map((r) => r.branchId))];
}
