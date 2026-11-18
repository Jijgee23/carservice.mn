import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCOUNT_NAME_MAX, validateAccountProfileInput } from "../lib/auth/account-profile";

test("name is trimmed and whitespace collapsed", () => {
  const r = validateAccountProfileInput({ name: "  Бат   Эрдэнэ " });
  assert.deepEqual(r, { ok: true, data: { name: "Бат Эрдэнэ" } });
});

test("empty / null name clears it", () => {
  assert.deepEqual(validateAccountProfileInput({ name: "  " }), { ok: true, data: { name: null } });
  assert.deepEqual(validateAccountProfileInput({ name: null }), { ok: true, data: { name: null } });
});

test("too long name and non-string rejected", () => {
  const long = validateAccountProfileInput({ name: "а".repeat(ACCOUNT_NAME_MAX + 1) });
  assert.equal(long.ok, false);
  const num = validateAccountProfileInput({ name: 5 });
  assert.equal(num.ok, false);
});

test("email normalised, invalid rejected", () => {
  assert.deepEqual(validateAccountProfileInput({ email: " Bat@Mail.MN " }), { ok: true, data: { email: "bat@mail.mn" } });
  const bad = validateAccountProfileInput({ email: "nope" });
  assert.equal(bad.ok, false);
});

test("only provided fields, unknown keys ignored, phone never patched", () => {
  const r = validateAccountProfileInput({ name: "А", phone: "99112233" });
  assert.deepEqual(r, { ok: true, data: { name: "А" } });
});

test("empty body or non-object rejected", () => {
  assert.equal(validateAccountProfileInput({}).ok, false);
  assert.equal(validateAccountProfileInput(null).ok, false);
  assert.equal(validateAccountProfileInput([]).ok, false);
});
