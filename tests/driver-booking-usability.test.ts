// Жолоочийн онлайн захиалгын саадуудыг засав: захиалга авдаггүй газарт «Цаг авах»
// биш, нэвтрэхэд сонголт хадгалагдана, хураамж/хугацааг урьдчилан, /book-ийн
// ажлын төрөл зөвхөн захиалга авдаг газраар, захиалсны дараа баталгаажуулалт.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("discover list rows say «Цаг авах» only for bookable orgs", () => {
  const src = read("app/(app)/discover/discover-client.tsx");
  assert.match(src, /\{org\.bookable \? "Цаг авах" : "Дэлгэрэнгүй"\}/);
  assert.doesNotMatch(src, />\s*Цаг авах <span aria-hidden>→<\/span>/);
});

test("safeConsumerNext allows only consumer paths", async () => {
  const { safeConsumerNext } = await import("../lib/safe-redirect");
  assert.equal(safeConsumerNext("/org/abc?branch=b1"), "/org/abc?branch=b1");
  assert.equal(safeConsumerNext("/book/branch/b1?keys=k1,k2"), "/book/branch/b1?keys=k1,k2");
  assert.equal(safeConsumerNext("/account/appointments/x"), "/account/appointments/x");
  assert.equal(safeConsumerNext("/dashboard"), "/account");
  assert.equal(safeConsumerNext("/system/roles"), "/account");
  assert.equal(safeConsumerNext("//evil.example"), "/account");
  assert.equal(safeConsumerNext("https://evil.example/org"), "/account");
  assert.equal(safeConsumerNext("/organization"), "/account"); // prefix-ийн хуурамч таарц биш
  assert.equal(safeConsumerNext(""), "/account");
});

test("login keeps the booking context through the OTP/password flow", () => {
  const ui = read("app/(app)/_components/consumer-ui.tsx");
  assert.match(ui, /href=\{next \? `\/login\?next=\$\{encodeURIComponent\(next\)\}` : "\/login"\}/);
  assert.match(read("app/(app)/org/[slug]/page.tsx"), /<LoginPrompt\s+next=\{`\/org\/\$\{org\.slug\}/);
  assert.match(read("app/(app)/book/branch/[branchId]/page.tsx"), /<LoginPrompt\s+next=\{`\/book\/branch\//);
  const form = read("app/login/login-form.tsx");
  assert.match(form, /<input type="hidden" name="next" value=\{next\} \/>/);
  assert.match(form, /if \(next\) fd\.set\("next", next\);/);
  const action = read("app/_actions/account-auth.ts");
  assert.equal((action.match(/redirect\(safeConsumerNext\(s\(formData, "next"\)\)\);/g) ?? []).length, 2);
  assert.doesNotMatch(action, /redirect\("\/account"\);/);
});

test("booking fee and the payment window are shown before submitting", () => {
  const form = read("app/(app)/org/[slug]/booking-form.tsx");
  assert.match(form, /bookingFee\?: \{ amount: number; ttlMinutes: number \} \| null;/);
  assert.match(form, /Захиалгын хураамж: \{bookingFee\.amount\.toLocaleString\("mn-MN"\)\}₮/);
  for (const page of ["app/(app)/org/[slug]/page.tsx", "app/(app)/book/branch/[branchId]/page.tsx"]) {
    const src = read(page);
    assert.match(src, /getBookingFeeNotice\(\)/, page);
    assert.match(src, /bookingFee=\{bookingFee\}/, page);
  }
  const settings = read("lib/platform-settings.ts");
  assert.match(settings, /if \(!settings\.appointmentFeeEnabled \|\| settings\.appointmentFeeAmount <= 0\) return null;/);
  assert.match(read("app/(app)/account/appointments/[id]/pay/page.tsx"), /PENDING_APPOINTMENT_PAYMENT_TTL_MINUTES \* 60_000/);
});

test("/book work chips come only from shops that take online bookings", () => {
  const helper = read("lib/bookable-service-keys.ts");
  assert.match(helper, /acceptsOnlineBooking: true,\s*plan: \{ in: allowedPlans \}/);
  assert.match(helper, /\.\.\.PUBLIC_TENANT_WHERE/);
  assert.match(helper, /\.\.\.BOOKABLE_CATEGORY_WHERE/);
  for (const f of ["app/(app)/book/page.tsx", "app/api/v1/app/service-keys/route.ts"]) {
    assert.match(read(f), /where: await bookableServiceKeyWhere\(\),/, f);
  }
  assert.match(read("app/(app)/book/booking-flow.tsx"), /serviceKeys\.length === 0 \?/);
});

test("after booking (no fee) the driver lands on the new appointment with a confirmation", () => {
  assert.match(read("app/_actions/appointments.ts"), /redirect\(`\/account\/appointments\/\$\{created\.id\}\?created=1`\);/);
  const page = read("app/(app)/account/appointments/[id]/page.tsx");
  assert.match(page, /const justCreated = \(await searchParams\)\.created === "1";/);
  assert.match(page, /Цаг захиалга илгээгдлээ/);
});
