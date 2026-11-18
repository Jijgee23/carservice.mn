import assert from "node:assert/strict";
import { test } from "node:test";
import { checkUploadedWorkbook, parseMappingInput, rejectOversizedRequest } from "../lib/import/upload";
import { MAX_IMPORT_BYTES } from "../lib/import/mapping";

const FIELDS = ["lastName", "firstName", "phone", "email", "role"] as const;
const file = (name: string, size: number) => new File([new Uint8Array(size).fill(1)], name);

test("rejectOversizedRequest: refuses a huge Content-Length before the body is read; tolerates missing/odd headers", () => {
  assert.equal(rejectOversizedRequest(null), null);
  assert.equal(rejectOversizedRequest("abc"), null);
  assert.equal(rejectOversizedRequest(String(1024)), null);
  assert.equal(rejectOversizedRequest(String(MAX_IMPORT_BYTES + 10_000)), null, "multipart overhead is allowed");
  const r = rejectOversizedRequest(String(MAX_IMPORT_BYTES * 10));
  assert.equal(r?.status, 413);
});

test("checkUploadedWorkbook: missing / empty / wrong type / too large / ok", () => {
  assert.equal(checkUploadedWorkbook(null).ok, false);
  assert.equal(checkUploadedWorkbook("file.xlsx").ok, false);
  assert.equal(checkUploadedWorkbook(file("a.xlsx", 0)).ok, false);
  const wrong = checkUploadedWorkbook(file("a.csv", 10));
  assert.deepEqual([wrong.ok, !wrong.ok && wrong.status], [false, 415]);
  const big = checkUploadedWorkbook(file("a.xlsx", MAX_IMPORT_BYTES + 1));
  assert.deepEqual([big.ok, !big.ok && big.status], [false, 413]);
  const ok = checkUploadedWorkbook(file("Ажилтнууд.XLSX", 100));
  assert.equal(ok.ok, true);
});

test("parseMappingInput: absent → null (auto guess); valid JSON string or object accepted", () => {
  assert.deepEqual(parseMappingInput(undefined, FIELDS, 5), { ok: true, mapping: null });
  assert.deepEqual(parseMappingInput("", FIELDS, 5), { ok: true, mapping: null });
  assert.deepEqual(parseMappingInput(null, FIELDS, 5), { ok: true, mapping: null });
  const full = parseMappingInput('{"lastName":0,"firstName":1,"phone":2,"email":3,"role":null}', FIELDS, 5);
  assert.deepEqual(full, { ok: true, mapping: { lastName: 0, firstName: 1, phone: 2, email: 3, role: null } });
  // partial mapping: unspecified fields are explicit nulls
  const partial = parseMappingInput({ phone: 4 }, FIELDS, 5);
  assert.deepEqual(partial, { ok: true, mapping: { lastName: null, firstName: null, phone: 4, email: null, role: null } });
});

test("parseMappingInput: rejects bad JSON, non-objects, unknown fields, out-of-range, non-integers, shared columns", () => {
  for (const bad of ["{not json", "[]", "5", '"x"']) {
    assert.equal(parseMappingInput(bad, FIELDS, 5).ok, false, String(bad));
  }
  assert.equal(parseMappingInput({ bogus: 1 }, FIELDS, 5).ok, false);
  assert.equal(parseMappingInput({ phone: 5 }, FIELDS, 5).ok, false, "index == headerCount is out of range");
  assert.equal(parseMappingInput({ phone: -1 }, FIELDS, 5).ok, false);
  assert.equal(parseMappingInput({ phone: 1.5 }, FIELDS, 5).ok, false);
  assert.equal(parseMappingInput({ phone: "2" }, FIELDS, 5).ok, false);
  const shared = parseMappingInput({ phone: 2, email: 2 }, FIELDS, 5);
  assert.equal(shared.ok, false);
  assert.equal(parseMappingInput({ phone: 0 }, FIELDS, 0).ok, false, "an empty sheet has no valid columns");
});
