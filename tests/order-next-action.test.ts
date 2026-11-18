import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let nextOrderAction: typeof import("../lib/orders/next-action").nextOrderAction;
type Input = import("../lib/orders/next-action").NextActionInput;
let guard: typeof import("../lib/orders/order-complete-guard");
let Prisma: typeof import("../app/generated/prisma/client").Prisma;

before(async () => {
  ({ nextOrderAction } = await import("../lib/orders/next-action"));
  guard = await import("../lib/orders/order-complete-guard");
  ({ Prisma } = await import("../app/generated/prisma/client"));
});

const base = (over: Partial<Input> = {}): Input => ({
  status: "IN_PROGRESS",
  canEdit: true,
  canTakePayment: true,
  cashSessionOpen: true,
  isInternal: false,
  hasRemaining: false,
  activeItems: 2,
  unfilledDiagnostics: 0,
  unfinishedItems: 0,
  blocker: null,
  ...over,
});

test("cancelled order has no next step", () => {
  assert.equal(nextOrderAction(base({ status: "CANCELLED" })), null);
});

test("scheduled: editor is told to start; others just wait", () => {
  const a = nextOrderAction(base({ status: "SCHEDULED" }))!;
  assert.deepEqual([a.tone, a.title, a.anchor], ["action", "Ажлыг эхлүүлэх", "order-status"]);
  const w = nextOrderAction(base({ status: "SCHEDULED", canEdit: false }))!;
  assert.equal(w.tone, "waiting");
  assert.equal(w.anchor, undefined);
});

test("in progress: someone who cannot edit only waits", () => {
  assert.equal(nextOrderAction(base({ canEdit: false, blocker: { kind: "items", message: "x" } }))!.tone, "waiting");
});

test("in progress with no work lines: add work first (before any blocker)", () => {
  const a = nextOrderAction(base({ activeItems: 0, blocker: { kind: "payment", message: "x" } }))!;
  assert.deepEqual([a.tone, a.anchor], ["action", "order-items"]);
  assert.match(a.title, /Ажил, үйлчилгээ нэмэх/);
});

test("in progress: blockers map to the right instruction with counts", () => {
  const diag = nextOrderAction(base({ unfilledDiagnostics: 3, blocker: { kind: "diagnostics", message: "m" } }))!;
  assert.equal(diag.title, "Оношилгоо бөглөх (3)");
  assert.equal(diag.anchor, "order-items");
  const items = nextOrderAction(base({ unfinishedItems: 2, blocker: { kind: "items", message: "m" } }))!;
  assert.equal(items.title, "Үлдсэн 2 ажлыг дуусгах");
  const pay = nextOrderAction(base({ blocker: { kind: "payment", message: "m" } }))!;
  assert.deepEqual([pay.tone, pay.title, pay.anchor], ["action", "Төлбөр авах", "order-payments"]);
});

test("in progress, nothing blocking: ready to finish", () => {
  const a = nextOrderAction(base())!;
  assert.deepEqual([a.tone, a.title, a.anchor], ["ready", "Хуудсыг дуусгах", "order-status"]);
});

test("payment step respects the cashier's ability and the open cash session", () => {
  const blocked = { blocker: { kind: "payment" as const, message: "m" } };
  assert.equal(nextOrderAction(base({ ...blocked, canTakePayment: false }))!.tone, "waiting");
  const closed = nextOrderAction(base({ ...blocked, cashSessionOpen: false }))!;
  assert.equal(closed.title, "Кассын ээлж нээж төлбөр авах");
  assert.equal(closed.anchor, "order-payments");
});

test("postpaid close needs a permission: waiting, carries the guard message", () => {
  const a = nextOrderAction(base({ blocker: { kind: "postpaid", message: "Эрх хэрэгтэй" } }))!;
  assert.deepEqual([a.tone, a.detail], ["waiting", "Эрх хэрэгтэй"]);
});

test("completed: unpaid balance asks for payment; paid / internal is done", () => {
  const unpaid = nextOrderAction(base({ status: "COMPLETED", hasRemaining: true }))!;
  assert.deepEqual([unpaid.tone, unpaid.title], ["action", "Төлбөр авах"]);
  assert.equal(nextOrderAction(base({ status: "COMPLETED", hasRemaining: true, canTakePayment: false }))!.tone, "waiting");
  assert.equal(nextOrderAction(base({ status: "COMPLETED", hasRemaining: false }))!.tone, "done");
  // internal repairs never ask for money even if a stale balance exists
  const internal = nextOrderAction(base({ status: "COMPLETED", isInternal: true, hasRemaining: true }))!;
  assert.deepEqual([internal.tone, internal.title], ["done", "Дотоод засвар дууссан"]);
});

test("guard refactor: blocker kinds follow the same order and messages as the old string guard", () => {
  const D = (n: number) => new Prisma.Decimal(n);
  const input = (o: Partial<Parameters<typeof guard.orderCompleteBlocker>[0]> = {}) => ({
    unfilledDiagnostics: 0, unfinishedItems: 0, isInternal: false, isPostpaid: false, remaining: D(0), canCloseUnpaidPostpaid: false, ...o,
  });
  assert.equal(guard.orderCompleteBlocker(input())?.kind, undefined);
  assert.equal(guard.orderCompleteBlocker(input({ unfilledDiagnostics: 1, unfinishedItems: 1, remaining: D(5) }))!.kind, "diagnostics");
  assert.equal(guard.orderCompleteBlocker(input({ unfinishedItems: 1, remaining: D(5) }))!.kind, "items");
  assert.equal(guard.orderCompleteBlocker(input({ remaining: D(5) }))!.kind, "payment");
  assert.equal(guard.orderCompleteBlocker(input({ remaining: D(5), isPostpaid: true }))!.kind, "postpaid");
  assert.equal(guard.orderCompleteBlocker(input({ remaining: D(5), isInternal: true })), null);
  // string wrapper unchanged
  assert.equal(guard.orderCompleteBlockedReason(input({ unfinishedItems: 2 })), "Дуусаагүй 2 ажил байна.");
  assert.equal(guard.orderCompleteBlockedReason(input()), null);
  // settings can relax a requirement; then the next blocker surfaces
  assert.equal(
    guard.orderCompleteBlocker(input({ unfinishedItems: 1, settings: { requireDiagnosticsFilled: true, requireItemsCompleted: false, allowCloseUnpaid: false } })),
    null,
  );
});

test("order detail page wires the banner from the shared guard and exposes the jump anchors", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(resolve(here, "../app/dashboard/orders/[id]/page.tsx"), "utf8");
  assert.match(page, /nextOrderAction\(\{/);
  assert.match(page, /blocker: completeBlocker,/);
  assert.match(page, /\{nextAction \? <NextActionBanner action=\{nextAction\} \/> : null\}/);
  // every anchor the pure function can emit exists on the page
  for (const id of ["order-items", "order-status", "order-payments"]) assert.ok(page.includes(`id="${id}"`), id);
  const banner = readFileSync(resolve(here, "../app/dashboard/orders/[id]/next-action-banner.tsx"), "utf8");
  assert.match(banner, /role="status"/);
  assert.match(banner, /href=\{`#\$\{action\.anchor\}`\}/);
});
