import type { Prisma } from "@/app/generated/prisma/client";
import { orderAssignableWhere } from "@/lib/auth/roles";

export type AssignableUserEligibilityInput = {
  isActive: boolean;
  deactivatedAt?: Date | null;
  activeUntil?: Date | null;
  verified?: boolean;
  tenantId: string;
  isOwner: boolean;
  branchId: string | null;
  assignableBranchIds: string[];
  role?: { permissions: string[]; isActive?: boolean } | null;
};

export type AssignableUserDto = {
  id: string;
  firstName: string;
  lastName: string;
};

/** A requested branch may not escape an already-resolved working branch. */
export function branchFilterConflicts(
  workingBranchId: string | null,
  requestedBranchId: string | undefined,
): boolean {
  return Boolean(
    workingBranchId && requestedBranchId && workingBranchId !== requestedBranchId,
  );
}

/**
 * Keep the roster predicate aligned with order assignment. An owner is
 * assignable without a role; every other user needs the dedicated
 * `orders.assignable` role permission and an active role.
 */
export function isAssignableUserEligible(
  user: AssignableUserEligibilityInput,
  tenantId: string,
  branchId?: string | null,
  now: Date = new Date(),
): boolean {
  if (!user.isActive || user.deactivatedAt || user.tenantId !== tenantId) return false;
  if (user.activeUntil && user.activeUntil.getTime() <= now.getTime()) return false;
  if (user.verified === false) return false;
  if (user.role?.isActive === false) return false;

  const isAssignable =
    user.isOwner || Boolean(user.role?.permissions.includes("orders.assignable"));
  if (!isAssignable) return false;

  if (!branchId) return true;
  return (
    user.branchId == null ||
    user.branchId === branchId ||
    user.assignableBranchIds.includes(branchId)
  );
}

/** Build the tenant/active/role/branch predicate used by the roster query. */
export function buildAssignableUserWhere(options: {
  tenantId: string;
  branchId?: string | null;
  now?: Date;
}): Prisma.UserWhereInput {
  const predicates: Prisma.UserWhereInput[] = [
    orderAssignableWhere(options.now),
    // orderAssignableWhere predates role deactivation. Keep its owner path,
    // but do not expose users whose role has since been disabled.
    { OR: [{ isOwner: true }, { role: { isActive: true } }] },
  ];

  if (options.branchId) {
    predicates.push({
      OR: [
        { branchId: null },
        { branchId: options.branchId },
        { assignableBranchIds: { has: options.branchId } },
      ],
    });
  }

  return {
    tenantId: options.tenantId,
    isActive: true,
    AND: predicates,
  };
}

/** Preserve the API contract as a minimal identity/display DTO. */
export function toAssignableUserDto(
  user: Pick<AssignableUserDto, "id" | "firstName" | "lastName">,
): AssignableUserDto {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
  };
}
