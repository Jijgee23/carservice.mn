import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Prisma } from "../app/generated/prisma/client";
import {
  ORDER_SETTINGS_DEFAULTS,
  buildChecklistSnapshot,
  formatOrderNumber,
  normalizeOrderSettings,
  orderNumberYear,
  parseChecklistSnapshot,
  validateOrderSettings,
} from "../lib/orders/order-settings";
import { orderCompleteBlockedReason } from "../lib/orders/order-complete-guard";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

// --- defaults = the historical hard-coded rules ----------------------------

test("defaults keep the previous hard-coded behaviour", () => {
  assert.deepEqual(normalizeOrderSettings(null), ORDER_SETTINGS_DEFAULTS);
  assert.equal(ORDER_SETTINGS_DEFAULTS.requireAssignee, true);
  assert.equal(ORDER_SETTINGS_DEFAULTS.requireDiagnosticsFilled, true);
  assert.equal(ORDER_SETTINGS_DEFAULTS.requireItemsCompleted, true);
  assert.equal(ORDER_SETTINGS_DEFAULTS.allowCloseUnpaid, false);
  assert.equal(formatOrderNumber(ORDER_SETTINGS_DEFAULTS, 1, 2026), "00001");
});

test("normalizeOrderSettings tolerates junk values", () => {
  const s = normalizeOrderSettings({ printFormat: "letter", intakeChecklist: [{ id: "a", label: " Тос " }, { label: "x" }, 3] } as never);
  assert.equal(s.printFormat, "a4");
  assert.deepEqual(s.intakeChecklist, [{ id: "a", label: "Тос" }]);
});

// --- validateOrderSettings --------------------------------------------------

test("validate: prefix charset/length and padding range", () => {
  const bad = validateOrderSettings({ numberPrefix: "ZS <x>", numberPadding: 9 });
  assert.equal(bad.ok, false);
  if (bad.ok) return;
  assert.ok(bad.fieldErrors.numberPrefix);
  assert.ok(bad.fieldErrors.numberPadding);
  assert.equal(validateOrderSettings({ numberPrefix: "ЗС-" , numberPadding: 3 }).ok, true);
  assert.equal(validateOrderSettings({ numberPrefix: "ABCDEFGHIJK" }).ok, false);
});

test("validate: partial input merges with current; checklist cleaned, ids kept/assigned", () => {
  const r = validateOrderSettings(
    { intakeChecklist: [{ id: "keep1", label: " Тосны  түвшин " }, { label: "" }, { label: "Гэмтэл" }] },
    { ...ORDER_SETTINGS_DEFAULTS, numberPrefix: "ZS-" },
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.numberPrefix, "ZS-");
  assert.equal(r.value.intakeChecklist.length, 2);
  assert.deepEqual(r.value.intakeChecklist[0], { id: "keep1", label: "Тосны түвшин" });
  assert.match(r.value.intakeChecklist[1].id, /^c[a-z0-9]+$/);
});

test("validate: duplicate checklist label, >50 rows, required checklist without rows", () => {
  assert.equal(validateOrderSettings({ intakeChecklist: [{ label: "A" }, { label: "a" }] }).ok, false);
  assert.equal(validateOrderSettings({ intakeChecklist: Array.from({ length: 51 }, (_, i) => ({ label: `r${i}` })) }).ok, false);
  const r = validateOrderSettings({ requireChecklist: true, intakeChecklist: [] });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.fieldErrors.requireChecklist);
});

test("validate: wrong types are rejected", () => {
  const r = validateOrderSettings({ requireMileage: "yes", minIntakePhotos: 30, printFormat: "letter" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.fieldErrors.requireMileage && r.fieldErrors.minIntakePhotos && r.fieldErrors.printFormat);
});

// --- order number formatting -------------------------------------------------

test("formatOrderNumber: prefix + year + padded sequence", () => {
  assert.equal(formatOrderNumber({ numberPrefix: "ZS-", numberPadding: 4, numberIncludeYear: true }, 1, 2026), "ZS-2026-0001");
  assert.equal(formatOrderNumber({ numberPrefix: "ZS-", numberPadding: 3, numberIncludeYear: false }, 12345, 2026), "ZS-12345");
});

test("orderNumberYear uses Ulaanbaatar time", () => {
  // 2026-12-31 17:30Z = 2027-01-01 01:30 UB.
  assert.equal(orderNumberYear(new Date("2026-12-31T17:30:00Z")), 2027);
});

type FakeSettingsRow = Record<string, unknown> | null;

function fakeTx(opts: { row: FakeSettingsRow; numbers: string[] }) {
  let row = opts.row;
  const numbers = new Set(opts.numbers);
  const tx = {
    async $queryRaw() {
      return [{ id: "t1" }];
    },
    tenantOrderSettings: {
      async findUnique() {
        return row;
      },
      async upsert({ update, create }: { update: Record<string, unknown>; create: Record<string, unknown> }) {
        row = row ? { ...row, ...update } : { ...create };
        return row;
      },
    },
    serviceOrder: {
      async findFirst({ where }: { where: { number: string } }) {
        return numbers.has(where.number) ? { id: "x" } : null;
      },
      async findMany() {
        return [...numbers].map((number) => ({ number }));
      },
    },
  };
  return { tx: tx as never, getRow: () => row, add: (n: string) => numbers.add(n) };
}

test("nextOrderNumber: no settings row = historical numbering from max suffix", async () => {
  const { nextOrderNumber } = await import("../lib/order-number");
  const f = fakeTx({ row: null, numbers: ["00001", "D1-1001", "00007"] });
  assert.equal(await nextOrderNumber(f.tx, "t1"), "01002");
  assert.equal(f.getRow()?.numberNextSeq, 1003);
});

test("nextOrderNumber: prefix + year, restarts each year, skips taken numbers", async () => {
  const { nextOrderNumber } = await import("../lib/order-number");
  const base = { ...ORDER_SETTINGS_DEFAULTS, numberPrefix: "ZS-", numberPadding: 4, numberIncludeYear: true };
  const f = fakeTx({ row: { ...base, numberNextSeq: 41, numberSeqYear: 2026 }, numbers: ["ZS-2026-0041"] });
  const jun2026 = new Date("2026-06-01T00:00:00Z");
  assert.equal(await nextOrderNumber(f.tx, "t1", jun2026), "ZS-2026-0042");
  f.add("ZS-2026-0042");
  assert.equal(await nextOrderNumber(f.tx, "t1", jun2026), "ZS-2026-0043");
  // Шинэ он → 1-ээс.
  assert.equal(await nextOrderNumber(f.tx, "t1", new Date("2027-01-02T00:00:00Z")), "ZS-2027-0001");
  assert.equal(f.getRow()?.numberSeqYear, 2027);
});

test("nextOrderNumber: year mode with null sequence starts at 1", async () => {
  const { nextOrderNumber } = await import("../lib/order-number");
  const f = fakeTx({ row: { ...ORDER_SETTINGS_DEFAULTS, numberIncludeYear: true, numberNextSeq: null, numberSeqYear: null }, numbers: ["00099"] });
  assert.equal(await nextOrderNumber(f.tx, "t1", new Date("2026-06-01T00:00:00Z")), "2026-00001");
});

// --- intake checklist snapshot ----------------------------------------------

const DEFS = [
  { id: "a", label: "Тосны түвшин" },
  { id: "b", label: "Гэмтэл" },
];

test("checklist snapshot: keeps definition order, labels and notes", () => {
  const r = buildChecklistSnapshot(DEFS, [
    { id: "b", status: "ISSUE", note: " урд хаалга " },
    { id: "a", status: "OK" },
  ], true);
  assert.deepEqual(r, {
    ok: true,
    value: [
      { label: "Тосны түвшин", status: "OK" },
      { label: "Гэмтэл", status: "ISSUE", note: "урд хаалга" },
    ],
  });
});

test("checklist snapshot: unknown id / bad status / missing required rows are errors", () => {
  assert.equal(buildChecklistSnapshot(DEFS, [{ id: "zzz", status: "OK" }], false).ok, false);
  assert.equal(buildChecklistSnapshot(DEFS, [{ id: "a", status: "MAYBE" }], false).ok, false);
  assert.equal(buildChecklistSnapshot(DEFS, [{ id: "a", status: "OK" }], true).ok, false);
  assert.deepEqual(buildChecklistSnapshot(DEFS, null, false), { ok: true, value: null });
  assert.equal(buildChecklistSnapshot(DEFS, "x", false).ok, false);
});

test("parseChecklistSnapshot skips malformed rows", () => {
  assert.deepEqual(parseChecklistSnapshot([{ label: "A", status: "NA" }, { label: "B" }, null]), [{ label: "A", status: "NA", note: null }]);
  assert.deepEqual(parseChecklistSnapshot(null), []);
});

// --- closing rules -----------------------------------------------------------

const dec = (v: number) => new Prisma.Decimal(v);
const OWNER = { isOwner: true, role: null };
const STAFF = { isOwner: false, role: { permissions: ["orders.edit"] } };

test("assertCompletionPaymentAllowed: allowCloseUnpaid lets permitted users close a regular unpaid order", async () => {
  const { assertCompletionPaymentAllowed } = await import("../lib/orders/order-commands");
  const base = { isPostpaid: false, totalAmount: dec(100), paid: dec(40) };
  assert.throws(() => assertCompletionPaymentAllowed({ ...base, actor: OWNER }), /Төлбөр бүрэн/);
  assert.doesNotThrow(() => assertCompletionPaymentAllowed({ ...base, actor: OWNER, allowCloseUnpaid: true }));
  assert.throws(() => assertCompletionPaymentAllowed({ ...base, actor: STAFF, allowCloseUnpaid: true }), (e: { code?: string }) => e.code === "POSTPAID_CLOSE_FORBIDDEN");
  // Бүрэн төлсөн бол тохиргооноос үл хамаарна.
  assert.doesNotThrow(() => assertCompletionPaymentAllowed({ ...base, paid: dec(100), actor: STAFF }));
});

test("orderCompleteBlockedReason mirrors the tenant settings", () => {
  const base = { unfilledDiagnostics: 1, unfinishedItems: 2, isInternal: false, isPostpaid: false, remaining: dec(50), canCloseUnpaidPostpaid: true };
  assert.equal(orderCompleteBlockedReason(base), "Бөглөгдөөгүй оношилгоо байна.");
  const relaxed = { requireDiagnosticsFilled: false, requireItemsCompleted: false, allowCloseUnpaid: true };
  assert.equal(orderCompleteBlockedReason({ ...base, settings: relaxed }), null);
  assert.match(
    orderCompleteBlockedReason({ ...base, settings: { ...relaxed, allowCloseUnpaid: false } }) ?? "",
    /Төлбөр бүрэн/,
  );
  assert.ok(orderCompleteBlockedReason({ ...base, canCloseUnpaidPostpaid: false, settings: relaxed }));
});

test("completion command reads settings and turns an unpaid regular close into a receivable", () => {
  const src = readFileSync("lib/orders/order-commands.ts", "utf8");
  assert.match(src, /const orderSettings = await getOrderSettings\(tx, actor\.tenantId\);/);
  assert.match(src, /!orderSettings\.requireDiagnosticsFilled \? 0 :/);
  assert.match(src, /allowCloseUnpaid: orderSettings\.allowCloseUnpaid,/);
  assert.match(src, /if \(closeAsReceivable\) updates\.isPostpaid = true;/);
  // Бөглөгдөөгүй оношилгоог автоматаар дуусгахгүй.
  assert.match(src, /item\.kind !== "DIAGNOSTIC" \|\| item\.diagnosticReportId/);
});

test("create command enforces intake requirements inside the transaction", () => {
  const src = readFileSync("lib/orders/order-create-command.ts", "utf8");
  for (const code of ["MILEAGE_REQUIRED", "SIGNATURE_REQUIRED", "INTAKE_PHOTOS_REQUIRED", "CHECKLIST_REQUIRED"]) {
    assert.match(src, new RegExp(`"${code}"`));
  }
  assert.match(src, /const intakeChecklist = assertIntakeRequirements\(settings, input\.intake \?\? null, input\.intakeChecklist\);/);
});
