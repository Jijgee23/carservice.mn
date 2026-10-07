import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("close-dialog figures use the light helper, not getSessionDetail, with the same guards", async () => {
  const session = await readFile("lib/cash/session.ts", "utf8");
  const start = session.indexOf("export async function getSessionCloseFigures");
  const end = session.indexOf("const DETAIL_ENTRY_CAP");
  const body = session.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(body, /assertCashManage\(actor\)/);
  assert.match(body, /tenantId/);
  assert.match(body, /effectiveBranchScope\(actor, input\.scope\)/);
  assert.match(body, /CASH_SESSION_NOT_FOUND/);
  assert.doesNotMatch(body, /cashTransaction\.findMany/);
  const action = await readFile("app/_actions/cash.ts", "utf8");
  assert.match(action, /getSessionCloseFigures\(/);
  assert.doesNotMatch(action, /getSessionDetail/);
});
