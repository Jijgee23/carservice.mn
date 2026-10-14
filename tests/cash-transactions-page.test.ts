import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const src = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8").then((s) => s.replace(/\r\n/g, "\n"));

test("income and expense live on one page; ?direction narrows it", async () => {
  const page = await src("app/dashboard/cash/transactions/page.tsx");
  assert.match(page, /<CashListPage searchParams=\{searchParams\} \/>/);
  const list = await src("app/dashboard/cash/cash-list.tsx");
  assert.match(list, /sp\.direction === "INCOME" \|\| sp\.direction === "EXPENSE"/);
  assert.match(list, /direction="INCOME"/);
  assert.match(list, /direction="EXPENSE"/);
  // Types belong to one direction: switching sides drops the type filter and the page.
  assert.match(list, /k !== "direction" && k !== "typeId" && k !== "page"/);
});

test("old income / expense URLs redirect with their direction; the cash index lands on the combined page", async () => {
  for (const [file, direction] of [["income", "INCOME"], ["expense", "EXPENSE"]]) {
    const s = await src(`app/dashboard/cash/${file}/page.tsx`);
    assert.ok(s.includes(`qs.set("direction", "${direction}")`), file);
    assert.match(s, /redirect\(`\$\{CASH_TRANSACTIONS_PATH\}\?/);
  }
  assert.match(await src("app/dashboard/cash/page.tsx"), /redirect\("\/dashboard\/cash\/transactions"\)/);
});

test("sidebar: one «Орлого, зарлага» entry, no separate income / expense links", async () => {
  const s = await src("app/_components/admin-sidebar.tsx");
  assert.match(s, /\{ href: "\/dashboard\/cash\/transactions", label: "Орлого, зарлага" \}/);
  assert.doesNotMatch(s, /\/dashboard\/cash\/(income|expense)/);
});
