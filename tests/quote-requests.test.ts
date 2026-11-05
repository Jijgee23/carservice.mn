import assert from "node:assert/strict";
import test from "node:test";
import { NOTIFICATION_REGISTRY } from "../lib/notifications";
import { defaultQuoteReplyMessage, parseQuoteRequestInput } from "../lib/quote-requests";

const base = {
  orgName: "  Авто Сүлжээ ХХК ",
  contactName: "Бат",
  phone: "+976 9911-2233",
  email: "Sales@Example.MN",
  branchCount: "5",
  modules: ["enable_finance", "bogus_module", "enable_audit"],
  message: "",
};

test("quote request input is normalised: phone canonical, email lowercased, unknown modules dropped", () => {
  const r = parseQuoteRequestInput(base);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.data.orgName, "Авто Сүлжээ ХХК");
  assert.equal(r.data.phone, "99112233");
  assert.equal(r.data.email, "sales@example.mn");
  assert.equal(r.data.branchCount, 5);
  // Canonical MODULE_LIMIT_CODES order, bogus code removed.
  assert.deepEqual(r.data.modules, ["enable_finance", "enable_audit"]);
  assert.equal(r.data.message, null);
});

test("quote request requires org, contact, valid phone and at least one module", () => {
  const r = parseQuoteRequestInput({ ...base, orgName: "", contactName: " ", phone: "123", modules: [], email: "x@", branchCount: "0" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.fieldErrors.orgName);
  assert.ok(r.fieldErrors.contactName);
  assert.ok(r.fieldErrors.phone);
  assert.ok(r.fieldErrors.modules);
  assert.ok(r.fieldErrors.email);
  assert.ok(r.fieldErrors.branchCount);
});

test("default reply fits in one SMS and names the contact", () => {
  const msg = defaultQuoteReplyMessage("Бат");
  assert.ok(msg.length <= 159, `${msg.length} chars`);
  assert.match(msg, /^Бат, /);
  assert.match(msg, /хүлээн авлаа/);
});

test("quote_request_created notifies the system realm and deep-links to the request", () => {
  const def = NOTIFICATION_REGISTRY.quote_request_created;
  assert.equal(def.realm, "system");
  const built = def.build({ quoteRequestId: "q1", orgName: "ACME", moduleCount: "3" });
  assert.match(built.body, /ACME/);
  assert.equal(def.href?.(built.data as Record<string, string>), "/system/quote-requests/q1");
});
