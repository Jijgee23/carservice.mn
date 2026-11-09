import "server-only";

import { cache } from "react";
import type { Plan } from "@/app/generated/prisma/enums";
import { getEnabledModules } from "@/lib/plan-modules-server";
import { prisma } from "@/lib/prisma";

/**
 * Энгийн (FREE) багцад «салбар» гэсэн ойлголтыг dashboard-аас бүрэн нууна.
 *
 * Нуух нөхцөл: багцад `enable_multi_branch` модуль байхгүй БӨГӨӨД тенант яг
 * нэг идэвхтэй салбартай. Төлбөртэй багцаас FREE рүү буусан ч олон салбартай
 * тенантад салбарыг харуулсаар байна (өгөгдөл нь холилдохгүйн тулд).
 *
 * Нуусан үед салбар сонгох талбарын оронд `singleBranchId`-г hidden input-аар
 * илгээнэ; салбарын засах хуудас «Байршил, ажлын цаг» нэрээр үлдэнэ (хаяг,
 * цаг, захиалгын алхмыг зөвхөн тэндээс засдаг).
 */
export type BranchVisibility =
  | { hideBranches: false; singleBranchId: null }
  | { hideBranches: true; singleBranchId: string };

const SHOW: BranchVisibility = { hideBranches: false, singleBranchId: null };

const getBranchVisibilityCached = cache(
  async (tenantId: string, plan: Plan): Promise<BranchVisibility> => {
    if ((await getEnabledModules(plan)).has("enable_multi_branch")) return SHOW;
    const branches = await prisma.branch.findMany({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
      take: 2,
    });
    if (branches.length !== 1) return SHOW;
    return { hideBranches: true, singleBranchId: branches[0].id };
  },
);

/** `requireUser()`-ийн дараа дуудна (tenant context тохируулагдсан байх ёстой). */
export function getBranchVisibility(user: {
  tenantId: string;
  tenant: { plan: Plan };
}): Promise<BranchVisibility> {
  return getBranchVisibilityCached(user.tenantId, user.tenant.plan);
}

/** Салбарыг нуусан үед цэс/товчинд харуулах нэр. */
export const SINGLE_BRANCH_LABEL = "Байршил, ажлын цаг";
