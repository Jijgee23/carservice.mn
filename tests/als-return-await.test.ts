import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Prod runs Node 22: an async function that `return`s a lazy Prisma query (a thenable) without `await` loses the
// AsyncLocalStorage tenant context, and the RLS guard in lib/prisma.ts throws «Tenant context тохируулагдаагүй»
// (prod 2026-10-14/15: the staff notification bell's actions, ~185 failed POSTs). Node 24 hides it locally.
// Always `return await prisma.…` in async code. Only plain (non-async) functions may return the query itself.
const ALLOWED_BARE_RETURN = new Set(["lib/branch-schedule-loader.ts"]);
const BARE = /^\s*return (prisma|tx|db|client)\.[a-zA-Z]+\.(count|find[A-Za-z]*|aggregate|groupBy|update[A-Za-z]*|create[A-Za-z]*|delete[A-Za-z]*|upsert)\(/m;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "generated" || name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

test("no async code returns a Prisma query without await (Node 22 drops the RLS context)", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const offenders = [...walk(join(root, "app")), ...walk(join(root, "lib"))]
    .map((p) => relative(root, p).split("\\").join("/"))
    .filter((rel) => !ALLOWED_BARE_RETURN.has(rel) && BARE.test(readFileSync(join(root, rel), "utf8")));
  assert.deepEqual(offenders, [], `use \`return await\`:\n${offenders.join("\n")}`);
});
