import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let commands: typeof import("../lib/customers/customer-commands");
let regnum: typeof import("../lib/customers/org-regnum");
let listQuery: typeof import("../lib/customers/customer-list-query");
let vehicleQuery: typeof import("../lib/vehicles/vehicle-list-query");
let ownerKind: typeof import("../lib/vehicles/owner-kind");
let ebarimt: typeof import("../lib/ebarimt-org-response");
let customers: typeof import("../lib/customers");

before(async () => {
  [commands, regnum, listQuery, vehicleQuery, ownerKind, ebarimt, customers] = await Promise.all([
    import("../lib/customers/customer-commands"),
    import("../lib/customers/org-regnum"),
    import("../lib/customers/customer-list-query"),
    import("../lib/vehicles/vehicle-list-query"),
    import("../lib/vehicles/owner-kind"),
    import("../lib/ebarimt-org-response"),
    import("../lib/customers"),
  ]);
});

test("org regnum: exactly 7 digits", () => {
  assert.equal(regnum.isValidOrgRegnum("1234567"), true);
  assert.equal(regnum.isValidOrgRegnum(" 1234567 "), true);
  for (const bad of ["", "123456", "12345678", "УБ12345678", "12345a7", null, undefined]) {
    assert.equal(regnum.isValidOrgRegnum(bad), false, String(bad));
  }
  assert.equal(regnum.normalizeOrgRegnum(" 1234567"), "1234567");
  assert.equal(regnum.normalizeOrgRegnum("УБ12345678"), null);
  assert.equal(regnum.orgRegnumError("12"), "Байгууллагын регистр 7 оронтой тоо байна.");
  assert.equal(regnum.orgRegnumError("1234567"), null);
});

test("customer command: org fields are null when isOrganization is off", () => {
  const r = commands.validateCustomerInput({
    phone: "99112233",
    isOrganization: false,
    orgRegnum: "1234567",
    orgName: "X",
    orgEmail: "a@b.mn",
  });
  assert.deepEqual(r.fieldErrors, {});
  assert.equal(r.data.isOrganization, false);
  assert.equal(r.data.orgRegnum, null);
  assert.equal(r.data.orgName, null);
  assert.equal(r.data.orgEmail, null);
});

test("customer command: org on requires 7-digit regnum and name; email optional but formatted", () => {
  const bad = commands.validateCustomerInput({
    phone: "99112233",
    isOrganization: true,
    orgRegnum: "УБ12345678",
    orgName: " ",
    orgEmail: "nope",
  });
  assert.equal(bad.fieldErrors.orgRegnum, "Байгууллагын регистр 7 оронтой тоо байна.");
  assert.ok(bad.fieldErrors.orgName);
  assert.ok(bad.fieldErrors.orgEmail);

  const ok = commands.validateCustomerInput({
    phone: "99112233",
    isOrganization: true,
    orgRegnum: "1234567",
    orgName: " Монгол ХХК ",
  });
  assert.deepEqual(ok.fieldErrors, {});
  assert.equal(ok.data.isOrganization, true);
  assert.equal(ok.data.orgRegnum, "1234567");
  assert.equal(ok.data.orgName, "Монгол ХХК");
  assert.equal(ok.data.orgEmail, null);
});

test("orgInputFromBody only trusts typed values", () => {
  assert.deepEqual(commands.orgInputFromBody({ isOrganization: "true", orgRegnum: 1 }), {
    isOrganization: false,
    orgRegnum: null,
    orgName: null,
    orgEmail: null,
  });
});

test("customer list: kind filter where-shape and parse", () => {
  const base = { page: 1, pageSize: 20, skip: 0, take: 20 };
  assert.equal(listQuery.buildCustomerListWhere({ ...base, kind: "org" }, { tenantId: "t" }).isOrganization, true);
  assert.equal(listQuery.buildCustomerListWhere({ ...base, kind: "person" }, { tenantId: "t" }).isOrganization, false);
  assert.equal("isOrganization" in listQuery.buildCustomerListWhere(base, { tenantId: "t" }), false);
  const ok = listQuery.parseCustomerListQuery(new URLSearchParams("kind=org"));
  assert.ok(ok.ok && ok.value.kind === "org");
  const bad = listQuery.parseCustomerListQuery(new URLSearchParams("kind=x"));
  assert.ok(!bad.ok && bad.field === "kind");
});

test("vehicle list: ownerKind filter where-shape and parse", () => {
  const base = { page: 1, pageSize: 20, skip: 0, take: 20 };
  const org = vehicleQuery.buildVehicleListWhere({ ...base, ownerKind: "org" }, { tenantId: "t" });
  const json = JSON.stringify(org.AND);
  assert.ok(json.includes('"customer":{"isOrganization":true}'));
  assert.ok(json.includes('"customerId":null'));
  assert.ok(json.includes('"ownerRegnum":{"startsWith":"7"}'));
  const person = vehicleQuery.buildVehicleListWhere({ ...base, ownerKind: "person", q: "x" }, { tenantId: "t" });
  assert.ok(JSON.stringify(person.AND).includes('"customer":{"isOrganization":false}'));
  assert.ok(person.OR, "q search OR is preserved alongside the ownerKind AND");
  assert.equal("AND" in vehicleQuery.buildVehicleListWhere(base, { tenantId: "t" }), false);
  assert.ok(!vehicleQuery.parseVehicleListQuery(new URLSearchParams("ownerKind=zzz")).ok);
});

test("ownerIsOrganization derivation", () => {
  const f = ownerKind.vehicleOwnerIsOrganization;
  assert.equal(f({ isOrganization: true }, "УБ12345678"), true);
  assert.equal(f({ isOrganization: false }, "1234567"), false);
  assert.equal(f(null, "1234567"), true);
  assert.equal(f(null, "УБ12345678"), false);
  assert.equal(f(null, null), false);
});

test("customerDisplay: org name primary, contact secondary", () => {
  const d = customers.customerDisplay({ fullName: "Бат", phone: "99112233", isOrganization: true, orgName: "Монгол ХХК" });
  assert.deepEqual(d, { primary: "Монгол ХХК", secondary: "Бат", isOrganization: true });
  assert.equal(customers.customerDisplay({ fullName: "Бат", phone: "99112233" }).primary, "Бат");
});

test("ebarimt org mapper: status/code mapping", () => {
  const found = { found: true, tin: "1", name: "Монгол ХХК", vatPayer: true, cityPayer: null, isGovernment: false, vatpayerRegisteredDate: null };
  const ok = ebarimt.mapOrgLookupResult("1234567", found);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { regno: "1234567", name: "Монгол ХХК", vatPayer: true, isGovernment: false });
  const nf = ebarimt.mapOrgLookupResult("1234567", { ...found, found: false, name: null });
  assert.equal(nf.status, 404);
  assert.equal((nf.body as { code: string }).code, "ORG_NOT_FOUND");
  assert.equal(ebarimt.orgRegnoInvalidBody().status, 422);
  assert.equal((ebarimt.orgRegnoInvalidBody().body as { code: string }).code, "ORG_REGNO_INVALID");
  assert.equal(ebarimt.orgLookupFailedBody().status, 502);
  assert.equal((ebarimt.orgLookupFailedBody().body as { code: string }).code, "ORG_LOOKUP_FAILED");
});

test("org autofill decision: only empty or untouched-autofill names are overwritten", async () => {
  const { shouldAutofillOrgName } = await import("../lib/customers/org-autofill");
  assert.equal(shouldAutofillOrgName("", null), true);
  assert.equal(shouldAutofillOrgName("  ", null), true);
  assert.equal(shouldAutofillOrgName("Saved Name", null), false);
  assert.equal(shouldAutofillOrgName("Auto ХХК", "Auto ХХК"), true);
  assert.equal(shouldAutofillOrgName("Edited", "Auto ХХК"), false);
});
