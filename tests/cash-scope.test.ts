import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let scope: typeof import("../lib/cash/scope");
before(async () => {
  scope = await import("../lib/cash/scope");
});

const owner = { isOwner: true, branchId: null };
const bound = { isOwner: false, branchId: "b1", assignableBranchIds: ["b2"] };
const floating = { isOwner: false, branchId: null, assignableBranchIds: ["b2", "b3"] };

test("explicit scope is returned unchanged", () => {
  assert.equal(scope.effectiveBranchScope({ ...bound, workingBranchId: "b2" }, "bx"), "bx");
  assert.equal(scope.effectiveBranchScope(bound, null), null);
  assert.equal(scope.effectiveBranchScope(owner, "b9"), "b9");
});

test("owner: working branch pins, undefined/ALL means all branches", () => {
  assert.equal(scope.effectiveBranchScope({ ...owner, workingBranchId: "b5" }, undefined), "b5");
  assert.equal(scope.effectiveBranchScope(owner, undefined), null);
  assert.equal(scope.effectiveBranchScope({ ...owner, workingBranchId: "ALL" }, undefined), null);
});

test("branch-bound user: valid working branch is honoured", () => {
  assert.equal(scope.effectiveBranchScope({ ...bound, workingBranchId: "b2" }, undefined), "b2");
  assert.equal(scope.effectiveBranchScope({ ...bound, workingBranchId: "b1" }, undefined), "b1");
});

test("branch-bound user fails closed on undefined, ALL, or stale working branch", () => {
  assert.equal(scope.effectiveBranchScope(bound, undefined), "b1");
  assert.equal(scope.effectiveBranchScope({ ...bound, workingBranchId: null }, undefined), "b1");
  assert.equal(scope.effectiveBranchScope({ ...bound, workingBranchId: "ALL" }, undefined), "b1");
  assert.equal(scope.effectiveBranchScope({ ...bound, workingBranchId: "stale" }, undefined), "b1");
});

test("floating staff unchanged (B9 owner decision): working branch pins, none/ALL is all branches", () => {
  assert.equal(scope.effectiveBranchScope({ ...floating, workingBranchId: "b2" }, undefined), "b2");
  assert.equal(scope.effectiveBranchScope(floating, undefined), null);
});

test("branch-bound user who switched to an assignable branch keeps it (full auth-user shape)", () => {
  const user = { id: "u", tenantId: "t", isOwner: false, branchId: "b1", assignableBranchIds: ["b2", "b3"], workingBranchId: "b3" };
  assert.equal(scope.effectiveBranchScope(user, undefined), "b3");
  // an assignable id the user does not hold is stale -> own branch
  assert.equal(scope.effectiveBranchScope({ ...user, workingBranchId: "b4" }, undefined), "b1");
});

test("dashboard callers omit scope: branch-bound user with undefined/ALL working branch is never all-branch", () => {
  // Regression: an explicit null (from workingBranchScopeId) would bypass the fail-closed path.
  assert.equal(scope.effectiveBranchScope({ ...bound, workingBranchId: undefined }, undefined), "b1");
  assert.equal(scope.effectiveBranchScope({ ...bound, workingBranchId: "ALL" }, undefined), "b1");
  assert.equal(scope.effectiveBranchScope({ ...owner, workingBranchId: "ALL" }, undefined), null);
});
