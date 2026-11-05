import "server-only";

import { eligibleBranchIds, seedWorkingBranchId } from "@/lib/auth/roles";
import { resolveTodayLockedBranch } from "@/lib/employee-branch-lock";
import { prisma } from "@/lib/prisma";

/**
 * Нэвтрэх/бүртгүүлэх/идэвхжүүлэх үед JWT-д шигтгэх эхлэлийн `workingBranchId`.
 * Сонгох зүйл ганцхан бол /page/choose-branch-ийг алгасна:
 *   1. Өнөөдрийн ажлын хувиараар түгжигдсэн салбар (lib/employee-branch-lock.ts).
 *   2. Яг 1 eligible салбартай ажилтан (seedWorkingBranchId).
 *   3. Owner / тогтмол салбаргүй ажилтан — тенант (эсвэл ажилтны eligible
 *      жагсаалт) яг НЭГ идэвхтэй салбартай бол тэр. «Бүх салбар» сонголт нэг
 *      салбартай үед ялгаагүй тул сонгуулах шаардлагагүй.
 * Бусад үед undefined — proxy.ts /page/choose-branch руу чиглүүлнэ.
 * Tenant эсвэл bypass context-д дуудна.
 */
export async function resolveInitialWorkingBranchId(user: {
  id: string;
  tenantId: string;
  isOwner: boolean;
  branchId: string | null;
  assignableBranchIds: string[];
}): Promise<string | undefined> {
  const locked = await resolveTodayLockedBranch(user);
  if (locked) return locked.branchId;
  const seeded = seedWorkingBranchId(user);
  if (seeded) return seeded;

  const eligible = eligibleBranchIds(user);
  const restrictToEligible = !user.isOwner && eligible.length > 0;
  const branches = await prisma.branch.findMany({
    where: {
      tenantId: user.tenantId,
      isActive: true,
      ...(restrictToEligible ? { id: { in: eligible } } : {}),
    },
    select: { id: true },
    take: 2,
  });
  return branches.length === 1 ? branches[0].id : undefined;
}
