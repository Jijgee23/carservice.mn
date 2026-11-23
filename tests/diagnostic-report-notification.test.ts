import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Оношилгооны тайлан үүсэхэд үйлчлүүлэгчийн апп руу мэдэгдэл (source-pattern тест).
function src(rel: string): string {
  const text = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), "utf8");
  return text.replace(/\r\n/g, "\n");
}

const notifications = src("../lib/notifications.ts");
const notify = src("../lib/diagnostic-report-notify.ts");
const apiRoute = src("../app/api/v1/diagnostics/reports/route.ts");
const action = src("../app/_actions/diagnostic-reports.ts");

test("diagnostic_report_created is a registered account-realm type with a dedupeKey", () => {
  assert.match(notifications, /"diagnostic_report_created",/);
  const start = notifications.indexOf("  diagnostic_report_created: {\n    realm");
  assert.ok(start >= 0);
  const block = notifications.slice(start, notifications.indexOf("\n  },", start));
  assert.match(block, /realm: "account"/);
  assert.match(block, /dedupeKey:.*reportId/);
  assert.match(block, /\/account\/diagnostics\//);
});

test("notifier skips walk-ins, test tenants and internal orders; never throws", () => {
  assert.match(notify, /customer\?\.accountId/);
  assert.match(notify, /tenant\.isTest/);
  assert.match(notify, /order\?\.isInternal/);
  assert.match(notify, /catch \(error\)/);
});

test("both the mobile API and the web action notify only after a successful commit", () => {
  for (const [name, code] of [["api", apiRoute], ["action", action]] as const) {
    const okIdx = code.indexOf("if (!committed.ok)");
    const notifyIdx = code.indexOf("await notifyDiagnosticReportCreated(committed.report.id)");
    assert.ok(okIdx >= 0 && notifyIdx > okIdx, `${name}: notify must follow the failure guard`);
  }
});

test("client + service worker deep links know the new type", () => {
  assert.match(src("../lib/notification-client-href.ts"), /diagnostic_report_created/);
  assert.match(src("../public/firebase-messaging-sw.js"), /diagnostic_report_created/);
});
