import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";

// Web hardening S3. Foreign-key checks ignore RLS, so mobile service creation
// must verify unit/category ids belong to the tenant. Numeric fields reject
// Infinity/negatives and keep 0. Upstream (HUR/ebarimt) errors only surface
// our own messages. Feedback reply 404 comes from an error code, not a string.

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

let api: typeof import("../lib/api");
let errors: typeof import("../lib/action-errors");

before(async () => {
  [api, errors] = await Promise.all([import("../lib/api"), import("../lib/action-errors")]);
});

test("services POST checks tenant ownership of refs before creating", () => {
  const src = read("../app/api/v1/services/route.ts");
  const post = src.slice(src.indexOf("export async function POST"));
  const check = post.indexOf("serviceRefFieldErrors(auth.user.tenantId, refs, ");
  const create = post.indexOf("prisma.service.create");
  assert.ok(check > 0 && create > check);
  assert.doesNotMatch(post, /Number\([a-zA-Z]+\) \|\| null/);
  assert.match(post, /Number\.isFinite\(priceNum\)/);
});

test("updateServiceCommand uses the same shared ref check", () => {
  const src = read("../lib/services/service-commands.ts");
  assert.match(src, /export async function serviceRefFieldErrors/);
  const update = src.slice(src.indexOf("export async function updateServiceCommand"));
  // Ангиллын төрөл (Category.kind) үйлчилгээний төрөлтэй таарахыг ч шалгана.
  assert.match(update, /serviceRefFieldErrors\(actor\.tenantId, refs, data\?\.type \?\? null\)/);
});

test("diagnostic mileage rejects Infinity on web and API", () => {
  for (const p of ["../app/_actions/diagnostic-reports.ts", "../app/api/v1/diagnostics/reports/route.ts"]) {
    assert.match(read(p), /Number\.isFinite\(mileage\) && mileage >= 0/, p);
  }
});

test("upstreamErrorResponse shows PublicUpstreamError text and hides the rest", async () => {
  const shown = api.upstreamErrorResponse("t", new errors.PublicUpstreamError("HUR: олдсонгүй"), "fallback");
  assert.equal(shown.status, 502);
  assert.equal((await shown.json()).error, "HUR: олдсонгүй");

  const originalError = console.error;
  console.error = () => {};
  try {
    const hidden = api.upstreamErrorResponse("t", new Error("getaddrinfo ENOTFOUND internal.host"), "fallback");
    assert.equal((await hidden.json()).error, "fallback");
  } finally {
    console.error = originalError;
  }
});

test("HUR/ebarimt routes no longer return raw error messages", () => {
  for (const p of [
    "../app/api/ebarimt/lookup/route.ts",
    "../app/api/hur/lookup/route.ts",
    "../app/api/account/hur/lookup/route.ts",
    "../app/api/v1/app/hur/lookup/route.ts",
    "../app/api/v1/hur/vehicle/route.ts",
  ]) {
    const src = read(p);
    assert.doesNotMatch(src, /e instanceof Error \? e\.message/, p);
    assert.match(src, /upstreamErrorResponse\(/, p);
  }
});

test("feedback reply maps 404 from an error code, not message text", () => {
  const route = read("../app/api/v1/feedback/[id]/replies/route.ts");
  assert.doesNotMatch(route, /result\.message === /);
  assert.match(read("../lib/feedback-staff.ts"), /code: "NOT_FOUND"/);
});
