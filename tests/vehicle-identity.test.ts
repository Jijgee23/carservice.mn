/* eslint-disable @typescript-eslint/no-explicit-any -- fake prisma client */
import assert from "node:assert/strict";
import { before, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

let v: typeof import("../lib/vehicles");
before(async () => {
  v = await import("../lib/vehicles");
});

type Row = { id: string; plate: string; vin: string | null };
const base = {
  year: null, fuelType: null, wheelPosition: null, colorName: null,
  capacity: null, purpose: null, ownerRegnum: null, mileage: null,
};

/** Fake tx: findFirst returns the first programmed row whose `match` accepts the where. */
function fakeClient(rows: Array<Row & { match: (where: any) => boolean }>) {
  const calls = { finds: [] as any[], updates: [] as any[], creates: [] as any[], locks: [] as string[] };
  const client: any = {
    $executeRaw: async (_s: TemplateStringsArray, key: string) => { calls.locks.push(key); },
    vehicle: {
      findFirst: async ({ where }: any) => {
        calls.finds.push(where);
        const r = rows.find((x) => x.match(where));
        return r ? { ...base, ...r } : null;
      },
      update: async (a: any) => { calls.updates.push(a); },
      create: async (a: any) => { calls.creates.push(a); return { id: "new" }; },
    },
  };
  return { client, calls };
}
const attrs = { make: "Toyota", model: "Prius" };
const VIN = "JT2BF22K1W0123456";
const person = { tenantId: "t", customerId: "c1", phone: "99112233" };
const org = { tenantId: "t", customerId: "c2", phone: "88000000", orgRegnum: "1234567" };

test("same plate + same owner reuses the row, no plate update", async () => {
  const { client, calls } = fakeClient([{ id: "a", plate: "1234УБА", vin: null, match: (w) => w.plate === "1234УБА" }]);
  const r = await v.resolveVehicleForOwner(client, { plate: "1234УБА", owner: person, ...attrs });
  assert.deepEqual(r, { id: "a", created: false });
  assert.equal("plate" in calls.updates[0].data, false);
});

test("same plate + different owner (no owner match) creates a new row", async () => {
  const { client, calls } = fakeClient([]);
  const r = await v.resolveVehicleForOwner(client, { plate: "1234УБА", owner: person, ...attrs });
  assert.equal(r.created, true);
  assert.equal(calls.creates.length, 1);
});

test("org owner key is orgRegnum, not phone; other contact of same org is excluded from NOT", async () => {
  const { client, calls } = fakeClient([{ id: "o", plate: "1234УБА", vin: null, match: () => true }]);
  const r = await v.resolveVehicleForOwner(client, { plate: "1234УБА", owner: org, ...attrs });
  assert.equal(r.id, "o");
  const w = calls.finds[0];
  const s = JSON.stringify(w);
  assert.match(s, /"isOrganization":true,"orgRegnum":"1234567"/);
  assert.doesNotMatch(s, /88000000/);
  assert.match(JSON.stringify(w.NOT), /"NOT":\{"customer":\{"isOrganization":true,"orgRegnum":"1234567"\}\}/);
});

test("VIN + same owner + different plate reuses AND updates plate; audit info returned", async () => {
  const { client, calls } = fakeClient([{ id: "a", plate: "1111УБА", vin: VIN, match: (w) => w.vin === VIN && !("plate" in w) }]);
  const r = await v.resolveVehicleForOwner(client, { plate: "2222УБА", vin: VIN, owner: person, ...attrs });
  assert.equal(r.created, false);
  assert.deepEqual(r.plateChanged, { from: "1111УБА", to: "2222УБА" });
  assert.equal(calls.updates[0].data.plate, "2222УБА");
  // lock order: vin first, then plate
  assert.deepEqual(calls.locks, [`vehicle-vin:${VIN}`, "vehicle-plate:2222УБА"]);
});

test("VIN match with the same plate does not touch plate", async () => {
  const { client, calls } = fakeClient([{ id: "a", plate: "2222УБА", vin: VIN, match: (w) => w.vin === VIN }]);
  const r = await v.resolveVehicleForOwner(client, { plate: "2222УБА", vin: VIN, owner: person, ...attrs });
  assert.equal(r.plateChanged, undefined);
  assert.equal("plate" in calls.updates[0].data, false);
});

test("VIN + different owner -> no owner-matching row -> new row (no steal)", async () => {
  const { client, calls } = fakeClient([]);
  const r = await v.resolveVehicleForOwner(client, { plate: "2222УБА", vin: VIN, owner: person, ...attrs });
  assert.equal(r.created, true);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.creates[0].data.vin, VIN);
});

test("no VIN: falls back to plate match only (one lookup, no vin lock)", async () => {
  const { client, calls } = fakeClient([]);
  await v.resolveVehicleForOwner(client, { plate: "2222УБА", owner: person, ...attrs });
  assert.equal(calls.finds.length, 1);
  assert.deepEqual(calls.locks, ["vehicle-plate:2222УБА"]);
});

test("no-plate + no VIN never matches; no-plate + VIN matches by VIN and keeps NO_PLATE out of plate update", async () => {
  const { NO_PLATE } = await import("../lib/vehicle-plate");
  const a = fakeClient([{ id: "x", plate: NO_PLATE, vin: null, match: () => true }]);
  const r1 = await v.resolveVehicleForOwner(a.client, { plate: NO_PLATE, owner: person, ...attrs });
  assert.equal(r1.created, true);
  assert.equal(a.calls.finds.length, 0);

  const b = fakeClient([{ id: "y", plate: "1111УБА", vin: VIN, match: (w) => w.vin === VIN }]);
  const r2 = await v.resolveVehicleForOwner(b.client, { plate: NO_PLATE, vin: VIN, owner: person, ...attrs });
  assert.equal(r2.id, "y");
  assert.equal(r2.plateChanged, undefined);
  assert.equal("plate" in b.calls.updates[0].data, false);
});

test("ownerFromCustomer carries orgRegnum only for organization customers", async () => {
  const mk = (c: any): any => ({ customer: { findFirst: async () => c } });
  const o = await v.ownerFromCustomer(mk({ id: "c", accountId: null, phone: "1", isOrganization: true, orgRegnum: "1234567" }), "t", "c");
  assert.equal(o?.orgRegnum, "1234567");
  const p = await v.ownerFromCustomer(mk({ id: "c", accountId: null, phone: "1", isOrganization: false, orgRegnum: "1234567" }), "t", "c");
  assert.equal(p?.orgRegnum, null);
});

test("C1: tenant path VIN lookup requires every tenant link to be the acting tenant's; other-tenant link -> new row", async () => {
  // Fake models the DB: the row has a link from another tenant, so an `every:{tenantId}` clause rejects it.
  const rowLinks = ["otherTenant"];
  const { client, calls } = fakeClient([
    {
      id: "a", plate: "1111УБА", vin: VIN,
      match: (w) => {
        const every = w.AND?.find((c: any) => c.tenantLinks?.every)?.tenantLinks.every;
        return w.vin === VIN && !!every && rowLinks.every((t) => t === every.tenantId);
      },
    },
  ]);
  const r = await v.resolveVehicleForOwner(client, { plate: "2222УБА", vin: VIN, owner: person, ...attrs });
  assert.equal(r.created, true);
  assert.equal(calls.updates.length, 0);
  assert.equal(r.plateChanged, undefined);
});

test("C1: org owner match is scoped to the acting tenant's links", async () => {
  const { client, calls } = fakeClient([]);
  await v.resolveVehicleForOwner(client, { plate: "1234УБА", vin: VIN, owner: org, ...attrs });
  for (const w of calls.finds) {
    assert.match(JSON.stringify(w.OR), /"tenantId":"t","customer":\{"isOrganization":true,"orgRegnum":"1234567"\}/);
  }
});

test("C1: account path requires every tenant link's customer to belong to the account", async () => {
  const { client, calls } = fakeClient([]);
  const r = await v.resolveVehicleForOwner(client, { plate: "2222УБА", vin: VIN, owner: { accountId: "acc", phone: "99112233" }, ...attrs });
  assert.equal(r.created, true);
  const vinQuery = calls.finds.find((w) => w.vin === VIN);
  const s = JSON.stringify(vinQuery.AND);
  assert.match(s, /"tenantLinks":\{"every":\{"customer":\{"accountId":"acc"\}\}\}/);
  assert.match(s, /"accountLinks":\{"some":\{"accountId":"acc"\}\}/);
});

test("I3: an existing plate+owner row is reused; VIN rename is not attempted", async () => {
  const { client, calls } = fakeClient([{ id: "p", plate: "2222УБА", vin: null, match: (w) => w.plate === "2222УБА" }]);
  const r = await v.resolveVehicleForOwner(client, { plate: "2222УБА", vin: VIN, owner: person, ...attrs });
  assert.equal(r.id, "p");
  assert.equal(r.plateChanged, undefined);
  assert.equal(calls.finds.some((w) => !("plate" in w)), false);
});

test("I2/I1: plate-change audit is written inside the transaction; account paths log it", async () => {
  const { readFileSync } = await import("node:fs");
  const rd = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const cmd = rd("lib/vehicles/vehicle-commands.ts");
  assert.match(cmd, /plateChanged\) \{[\s\S]*?logAudit\(\s*\{[\s\S]*?\},\s*tx,\s*\)/);
  assert.match(rd("app/api/v1/app/vehicles/route.ts"), /plateChanged[\s\S]*console\.info/);
  assert.match(rd("app/_actions/account-vehicles.ts"), /plateChanged[\s\S]*console\.info/);
});

test("C1b: tenant-path VIN scope also needs a tenant link and no account links (zero-link row cannot be renamed)", async () => {
  // DB model: row with zero tenant links and one account link.
  const row = { tenantLinks: [] as string[], accountLinks: ["acc"] };
  const { client, calls } = fakeClient([
    {
      id: "a", plate: "1111УБА", vin: VIN,
      match: (w) => {
        const and: any[] = w.AND ?? [];
        const every = and.find((c) => c.tenantLinks?.every)?.tenantLinks.every;
        const some = and.find((c) => c.tenantLinks?.some)?.tenantLinks.some;
        const none = and.find((c) => c.accountLinks?.none);
        return w.vin === VIN && !!every && !!some && !!none &&
          row.tenantLinks.every((t) => t === every.tenantId) &&
          row.tenantLinks.some((t) => t === some.tenantId) &&
          row.accountLinks.length === 0;
      },
    },
  ]);
  const r = await v.resolveVehicleForOwner(client, { plate: "2222УБА", vin: VIN, owner: person, ...attrs });
  assert.equal(r.created, true);
  assert.equal(calls.updates.length, 0);
});

test("C1b: account-path VIN scope adds accountLinks every{accountId}", async () => {
  const { client, calls } = fakeClient([]);
  await v.resolveVehicleForOwner(client, { plate: "2222УБА", vin: VIN, owner: { accountId: "acc", phone: "99112233" }, ...attrs });
  const q = calls.finds.find((w) => w.vin === VIN);
  assert.match(JSON.stringify(q.AND), /"accountLinks":\{"every":\{"accountId":"acc"\}\}/);
  assert.match(JSON.stringify(q.AND), /"tenantLinks":\{"every":\{"customer":\{"accountId":"acc"\}\}\}/);
});
