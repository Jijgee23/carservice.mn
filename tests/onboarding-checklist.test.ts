import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let build: typeof import("../lib/onboarding-checklist").buildOnboardingChecklist;

before(async () => {
  ({ buildOnboardingChecklist: build } = await import("../lib/onboarding-checklist"));
});

function src(rel: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), "utf8");
}

test("fresh tenant: nothing done, three steps in guided order, not complete", () => {
  const c = build({ otherEmployees: 0, services: 0, orders: 0 });
  assert.deepEqual(c.steps.map((s) => s.key), ["service", "employee", "order"]);
  assert.deepEqual(c.steps.map((s) => s.done), [false, false, false]);
  assert.equal(c.doneCount, 0);
  assert.equal(c.total, 3);
  assert.equal(c.complete, false);
});

test("each step completes independently from its own count", () => {
  assert.deepEqual(build({ otherEmployees: 2, services: 0, orders: 0 }).steps.map((s) => s.done), [false, true, false]);
  assert.deepEqual(build({ otherEmployees: 0, services: 5, orders: 0 }).steps.map((s) => s.done), [true, false, false]);
  assert.deepEqual(build({ otherEmployees: 0, services: 0, orders: 1 }).steps.map((s) => s.done), [false, false, true]);
});

test("all done → complete (the card disappears)", () => {
  const c = build({ otherEmployees: 1, services: 1, orders: 1 });
  assert.equal(c.complete, true);
  assert.equal(c.doneCount, c.total);
});

test("every step links into the dashboard and has a label and hint", () => {
  for (const s of build({ otherEmployees: 0, services: 0, orders: 0 }).steps) {
    assert.match(s.href, /^\/dashboard\//);
    assert.ok(s.label.length > 0 && s.hint.length > 0);
  }
});

test("dashboard shows the checklist only to owners and only while incomplete; loader is tenant-scoped", () => {
  const page = src("../app/dashboard/page.tsx");
  assert.match(page, /user\.isOwner \? loadOnboardingChecklist\(user\.tenantId\) : Promise\.resolve\(null\)/);
  assert.match(page, /checklist && !checklist\.complete \? <GettingStarted checklist=\{checklist\} \/> : null/);
  const lib = src("../lib/onboarding-checklist.ts");
  for (const q of ["prisma.user.count", "prisma.service.count", "prisma.serviceOrder.findFirst"]) {
    const at = lib.indexOf(q);
    assert.ok(at !== -1, q);
    assert.match(lib.slice(at, at + 140), /tenantId/, `${q} must be tenant scoped`);
  }
  // progress bar is accessible
  assert.match(src("../app/dashboard/_components/getting-started.tsx"), /role="progressbar"/);
});
