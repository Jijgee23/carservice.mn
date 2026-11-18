import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// lib/overview.ts нь DB-тэй (tenant context) тул бүтцийн (source-pattern) гэрээг хамгаална;
// бодит DB дээрх зан төлөвийг гараар шалгасан (own-scope механик, алгассан query-нууд).

function src(rel: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), "utf8");
}

const overview = src("../lib/overview.ts");
const loaderBody = overview.slice(overview.indexOf("export async function loadOverviewData"));

test("every serviceOrder query in the loader is limited by the caller's order read scope", () => {
  const parts = loaderBody.split("prisma.serviceOrder.").slice(1);
  assert.ok(parts.length >= 7, "expected the order queries to be present");
  for (const part of parts) {
    // up to the next top-level query: this query's own arguments
    const own = part.slice(0, part.indexOf("prisma.", 10) === -1 ? part.length : part.indexOf("prisma.", 10));
    assert.ok(
      /\.\.\.orderRead\b/.test(own) || /orderReadWhere\(user\.orderAccess\)/.test(own),
      `serviceOrder query without read scope: ${own.slice(0, 120).replace(/\s+/g, " ")}`,
    );
  }
});

test("the recent-orders panel no longer leaks other people's orders to own-scope staff", () => {
  assert.match(
    loaderBody,
    /where: \{ tenantId: user\.tenantId, \.\.\.orderBranchFilter, \.\.\.orderRead \},\s+orderBy: \{ updatedAt: "desc" \}/,
  );
  assert.match(loaderBody, /const orderRead = user\.orderAccess \? orderReadWhere\(user\.orderAccess\) : \{\};/);
});

test("income and base queries run only when the caller wants them (default: all, API unchanged)", () => {
  assert.match(loaderBody, /const withIncome = include\.income !== false;/);
  assert.match(loaderBody, /const withBase = include\.base !== false;/);
  // 2 income queries, 9 base queries are gated; skipped values are cheap constants
  assert.equal((loaderBody.match(/withIncome \?/g) ?? []).length, 2);
  assert.equal((loaderBody.match(/withBase \?/g) ?? []).length, 9);
  assert.equal((loaderBody.match(/: Promise\.resolve\(/g) ?? []).length, 11);
});

test("dashboard page passes the persona's income/base flags; the API route keeps the full default", () => {
  const page = src("../app/dashboard/page.tsx");
  assert.match(page, /loadOverviewData\(\{ \.\.\.user, orderAccess: user \}, params, \{ income: layout\.income, base: layout\.base \}\)/);
  assert.ok(page.indexOf("resolveHomeLayout(user)") < page.indexOf("loadOverviewData("), "layout is resolved before the loader");
  assert.doesNotMatch(src("../app/api/v1/overview/route.ts"), /income: false|base: false/);
});
