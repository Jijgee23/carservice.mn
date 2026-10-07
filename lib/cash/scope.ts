import { ALL_BRANCHES } from "@/lib/auth/session";
import { branchScopeId, eligibleBranchIds } from "@/lib/auth/roles";

/** Branch scope: string = pinned branch, null = all branches, undefined = derive from the actor's working branch. */
export type BranchScope = string | null | undefined;

export type ScopeActor = {
  isOwner: boolean;
  branchId?: string | null;
  assignableBranchIds?: string[];
  workingBranchId?: string | null;
};

/**
 * Single source of truth for cash/order-command branch scope (audit B9). An explicit scope (API routes) is
 * returned unchanged. Otherwise it derives from the working branch, FAILING CLOSED for branch-bound non-owners:
 * an undefined, ALL or stale (not one of their eligible branches) working branch falls back to their own branch,
 * never "all branches". Owners keep: specific working branch -> that branch, ALL/undefined -> null.
 */
export function effectiveBranchScope(actor: ScopeActor, scope: BranchScope): string | null {
  if (scope !== undefined) return scope;
  const own = branchScopeId({ isOwner: actor.isOwner, branchId: actor.branchId ?? null });
  const wb = actor.workingBranchId && actor.workingBranchId !== ALL_BRANCHES ? actor.workingBranchId : null;
  if (own != null) {
    // Branch-bound non-owner: the working branch must be one of their eligible branches.
    const eligible = eligibleBranchIds({ branchId: actor.branchId ?? null, assignableBranchIds: actor.assignableBranchIds ?? [] });
    return wb != null && eligible.includes(wb) ? wb : own;
  }
  // TODO(B9): floating staff (no branchId, only assignableBranchIds) with no/ALL working branch still resolves to
  // null (all branches). Owner decision pending; intentionally unchanged.
  return wb;
}
