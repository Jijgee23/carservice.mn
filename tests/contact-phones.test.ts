// Холбоо барих утас — super admin тохируулна (PlatformSetting.contactPhones),
// хоосон бол CONTACT.phones; бүх харагдах газар нэг эх сурвалжаас.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://unused/unused";
process.env.SESSION_SECRET ??= "unit-test-placeholder-secret-value-not-real-00";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("parseContactPhones splits, trims, dedupes and validates", async () => {
  const { parseContactPhones } = await import("../lib/contact");
  assert.deepEqual(parseContactPhones(""), { ok: true, phones: [] });
  assert.deepEqual(parseContactPhones(" 7011-6543 , 99112233;\n+976 8811 2233, 99112233 "), {
    ok: true,
    phones: ["7011-6543", "99112233", "+976 8811 2233"],
  });
  assert.equal(parseContactPhones("12345").ok, false);
  assert.equal(parseContactPhones("9911abc22").ok, false);
  assert.equal(parseContactPhones("1234567890123456").ok, false);
  assert.equal(parseContactPhones("99112233,99112234,99112235,99112236,99112237,99112238,99112239").ok, false);
});

test("empty setting falls back to the code default", async () => {
  const { contactPhonesOrDefault } = await import("../lib/platform-settings");
  const { CONTACT } = await import("../lib/contact");
  assert.deepEqual(contactPhonesOrDefault([]), [...CONTACT.phones]);
  assert.deepEqual(contactPhonesOrDefault(null), [...CONTACT.phones]);
  assert.deepEqual(contactPhonesOrDefault(["70110000"]), ["70110000"]);
});

test("every display site reads the configured phones, none hardcode CONTACT.phones", () => {
  for (const f of ["app/contact/page.tsx", "app/privacy/page.tsx", "app/terms/page.tsx", "app/page.tsx"]) {
    assert.match(read(f), /await getContactPhones\(\)/, f);
  }
  assert.match(read("app/_components/footer.tsx"), /contactPhonesOrDefault\(contactPhones\)/);
  assert.match(read("app/page.tsx"), /<Faq phones=\{phones\} \/>/);
  for (const f of ["app/contact/page.tsx", "app/privacy/page.tsx", "app/terms/page.tsx", "app/_components/footer.tsx", "app/_components/faq.tsx"]) {
    assert.doesNotMatch(read(f), /CONTACT\.phones/, f);
  }
});

test("settings action validates and saves contactPhones; super admin only", () => {
  const src = read("app/_actions/system-settings.ts");
  assert.match(src, /parseContactPhones\(s\(formData, "contactPhones"\)\)/);
  assert.equal((src.match(/      contactPhones,\r?\n/g) ?? []).length, 2);
  assert.match(src, /await requireSuperAdmin\(\);/);
  assert.match(read("prisma/migrations/20261020150000_platform_contact_phones/migration.sql"), /ADD COLUMN "contactPhones" TEXT\[\]/);
});
