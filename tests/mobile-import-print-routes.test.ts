import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Route нь requireApiUser-аар tenant context тавьдаг тул DB-гүй unit-д бүтнээр ажиллуулахгүй. Энд зөв хаалт,
// зөв дараалал (эрх → захиалга → хязгаар → бие унших → бичих), зөв delegate-ийг бүтцээр хамгаална. Логикийн
// тест: print-pdf, import-upload, order-assignable…; бодит DB дээрх шалгалтыг гараар хийсэн.

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(here, rel), "utf8");
const before = (s: string, a: string, b: string) => {
  const ia = s.indexOf(a);
  const ib = s.indexOf(b);
  assert.ok(ia !== -1, `missing: ${a}`);
  assert.ok(ib !== -1, `missing: ${b}`);
  assert.ok(ia < ib, `${a} must come before ${b}`);
};

test("order PDF route: auth → orders permission → format validation → scope → loader → render", () => {
  const s = src("../app/api/v1/orders/[id]/pdf/route.ts");
  assert.match(s, /requireApiUser\(req\)/);
  assert.match(s, /canView\(user, "orders"\)/);
  assert.match(s, /PRINT_FORMATS as readonly string\[\]\)\.includes\(rawFormat\)/);
  assert.match(s, /fieldErrors: \{ format: "a4 \| 80mm" \}/);
  before(s, "requireApiUser(req)", 'canView(user, "orders")');
  before(s, 'canView(user, "orders")', "loadOrderDocument(");
  before(s, "resolveWorkingBranch(req, user)", "loadOrderDocument(");
  before(s, "422", "loadOrderDocument(");
  before(s, "loadOrderDocument(", "renderPrintPdf(");
  // exposes nothing about whether a forbidden order exists: both → the same 404
  assert.match(s, /if \(!loaded\.ok\) return jsonError\(404,/);
  assert.match(s, /scopeBranchId: scope\.branchId/);
  assert.match(s, /"Content-Type": "application\/pdf"/);
  assert.match(s, /"Cache-Control": "private, no-store"/);
  // the filename cannot be used for header injection
  assert.match(s, /replace\(\/\[\^\\w\.-\]\+\/g, "_"\)/);
});

test("settlement PDF route: cash.manage gate, scope, same loader and 404 for a missing/out-of-scope settlement", () => {
  const s = src("../app/api/v1/cash/settlements/[id]/pdf/route.ts");
  assert.match(s, /requireCashApiUser\(req\)/);
  before(s, "requireCashApiUser(req)", "loadSettlementDocument(");
  before(s, "resolveWorkingBranch(req, auth.user)", "loadSettlementDocument(");
  assert.match(s, /scope: scope\.branchId/);
  assert.match(s, /if \(!loaded\.ok\) return jsonError\(404,/);
  assert.match(s, /cashErrorResponse\("settlements\.pdf", error\)/);
  assert.match(s, /"Cache-Control": "private, no-store"/);
});

test("web print pages use the SAME loaders as the mobile PDF routes (no drifting copies of the query)", () => {
  const order = src("../app/dashboard/orders/[id]/print/page.tsx");
  assert.match(order, /loadOrderDocument\(\{/);
  assert.doesNotMatch(order, /prisma\.serviceOrder\.findFirst/, "the order query lives only in the loader");
  assert.match(order, /loaded\.reason === "forbidden"\) redirect\("\/dashboard\/orders"\)/);
  const settlement = src("../app/dashboard/cash/settlements/[id]/print/page.tsx");
  assert.match(settlement, /loadSettlementDocument\(\{ actor: user, settlementId: id \}\)/);
  assert.doesNotMatch(settlement, /prisma\./);
  const loaders = src("../lib/print/document-loaders.ts");
  assert.match(loaders, /canViewOrder\(user, order\)/);
  assert.match(loaders, /\.\.\.\(scopeBranchId \? \{ branchId: scopeBranchId \} : \{\}\)/);
  assert.match(loaders, /tenantId: user\.tenantId/);
  assert.match(loaders, /tenantId: actor\.tenantId/);
});

const IMPORT_ROUTES: Array<{ file: string; permission: string; preview: boolean; limitBucket: string }> = [
  { file: "../app/api/v1/employees/import/preview/route.ts", permission: "employees.create", preview: true, limitBucket: "employees-import-preview" },
  { file: "../app/api/v1/employees/import/route.ts", permission: "employees.create", preview: false, limitBucket: "employees-import" },
  { file: "../app/api/v1/services/import/preview/route.ts", permission: "services.create", preview: true, limitBucket: "services-import-preview" },
  { file: "../app/api/v1/services/import/route.ts", permission: "services.create", preview: false, limitBucket: "services-import" },
];

test("import routes: permission, active subscription and rate limit all come BEFORE the body is read", () => {
  for (const r of IMPORT_ROUTES) {
    const s = src(r.file);
    const post = s.slice(s.indexOf("export async function POST"));
    assert.match(post, new RegExp(`requirePermission\\(auth\\.user, "${r.permission.replace(".", "\\.")}"\\)`), r.file);
    assert.match(post, /requireActiveSubscriptionApi\(auth\.user\)/, r.file);
    assert.match(post, new RegExp(`enforceRateLimit\\(req, "${r.limitBucket}"`), r.file);
    assert.match(post, /auth\.user\.id\)/, `${r.file}: rate limit keyed by user, not just IP`);
    const bodyRead = r.preview ? "req.formData()" : "req.json()";
    for (const gate of ["requireApiUser(req)", "requirePermission(", "requireActiveSubscriptionApi(", "enforceRateLimit("]) {
      before(post, gate, bodyRead);
    }
  }
});

test("preview routes: oversize requests are refused before formData(); only .xlsx; mapping validated against the real headers", () => {
  for (const file of ["../app/api/v1/employees/import/preview/route.ts", "../app/api/v1/services/import/preview/route.ts"]) {
    const s = src(file);
    before(s, "rejectOversizedRequest(", "req.formData()");
    assert.match(s, /checkUploadedWorkbook\(form\.get\("file"\)\)/, file);
    // the mapping is validated against the headers of the parsed file (employees re-export the same parser)
    const parseAt = s.search(/parse(?:Employee|Import)Workbook\(await/);
    assert.ok(parseAt !== -1, `${file}: workbook must be parsed`);
    assert.ok(parseAt < s.indexOf("parseMappingInput("), `${file}: parse before validating the mapping`);
    assert.match(s, /parseMappingInput\(form\.get\("mapping"\), [A-Z_]+, sheet\.headers\.length\)/, file);
    // read-only: a preview never writes
    assert.doesNotMatch(s, /\.create\(|\.update\(|importEmployees\(|runEmployeeImport|runServiceImportForActor/, `${file} must not write`);
  }
  assert.match(src("../app/api/v1/services/import/preview/route.ts"), /isImportServiceKind\(type\)/);
});

test("import routes delegate to the same services as the web actions", () => {
  assert.match(src("../app/api/v1/employees/import/route.ts"), /runEmployeeImport\(auth\.user, rows\)/);
  assert.match(src("../app/api/v1/employees/import/route.ts"), /parseImportRowsPayload\(/);
  assert.match(src("../app/api/v1/services/import/route.ts"), /runServiceImportForActor\(auth\.user, rec\.type, rows\)/);
  assert.match(src("../app/api/v1/services/import/route.ts"), /parseServiceImportPayload\(rec\.rows\)/);
  assert.match(src("../app/_actions/employee-import.ts"), /runEmployeeImport\(user, rows\)/);
  assert.match(src("../app/_actions/employee-import.ts"), /checkEmployeeImportTaken\(user\.tenantId, rows\)/);
  assert.match(src("../app/_actions/service-import.ts"), /runServiceImportForActor\(user, type, rows\)/);
  // the audit tag for imported rows is written once, in the shared services
  assert.match(src("../lib/employees/import-service.ts"), /summary: `\$\{created\.summary\} · Excel-ээс`/);
  assert.match(src("../lib/services/import-service.ts"), /auditSuffix: " · Excel-ээс"/);
});

test("import services are tenant scoped: every lookup carries the caller's tenantId", () => {
  const emp = src("../lib/employees/import-service.ts");
  for (const q of ["prisma.user.findMany", "prisma.branch.findMany"]) {
    const at = emp.indexOf(q);
    assert.ok(at !== -1, q);
    assert.match(emp.slice(at, at + 160), /tenantId/, `${q} must be tenant scoped`);
  }
  const svc = src("../lib/services/import-service.ts");
  for (const q of ["prisma.service.findMany", "prisma.unit.findMany"]) {
    const at = svc.indexOf(q);
    assert.ok(at !== -1, q);
    assert.match(svc.slice(at, at + 160), /tenantId/, `${q} must be tenant scoped`);
  }
  assert.match(svc, /categoriesForKindWhere\(tenantId, kind\)/);
});
