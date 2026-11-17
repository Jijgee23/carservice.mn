import { chromium } from "playwright";

const outDir = process.argv[2];
const token = process.argv[3];
const [customerId, vehicleId, serviceId, templateId, reportId, apptId, feedbackId] = process.argv.slice(4);
const browser = await chromium.launch();

async function shot(url, name, viewport = { width: 1920, height: 1400 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([
    { name: "carcare_session", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await ctx.newPage();
  page.on("console", (msg) => { if (msg.type() === "error") console.log(`CONSOLE ERROR [${name}]:`, msg.text()); });
  page.on("pageerror", (err) => console.log(`PAGE ERROR [${name}]:`, err.message));
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outDir}/${name}.png` });
  } catch (e) {
    console.log(`NAV ERROR [${name}] (${url}):`, e.message);
  }
  await ctx.close();
}

const pages = [
  ["http://localhost:4000/dashboard", "d-home"],
  ["http://localhost:4000/dashboard/reports", "d-reports"],
  ["http://localhost:4000/dashboard/customers", "d-customers-list"],
  [`http://localhost:4000/dashboard/customers/${customerId}`, "d-customers-detail"],
  ["http://localhost:4000/dashboard/customers/new", "d-customers-new"],
  ["http://localhost:4000/dashboard/vehicles", "d-vehicles-list"],
  [`http://localhost:4000/dashboard/vehicles/${vehicleId}`, "d-vehicles-detail"],
  ["http://localhost:4000/dashboard/vehicles/new", "d-vehicles-new"],
  ["http://localhost:4000/dashboard/services/labor", "d-services-labor"],
  [`http://localhost:4000/dashboard/services/${serviceId}`, "d-services-detail"],
  ["http://localhost:4000/dashboard/services/categories", "d-services-categories"],
  ["http://localhost:4000/dashboard/services/diagnostics", "d-diag-templates-list"],
  [`http://localhost:4000/dashboard/services/diagnostics/${templateId}`, "d-diag-template-editor"],
  ["http://localhost:4000/dashboard/appointments", "d-appointments-list"],
  ["http://localhost:4000/dashboard/appointments/calendar", "d-appointments-calendar"],
  ["http://localhost:4000/dashboard/appointments/new", "d-appointments-new"],
  ["http://localhost:4000/dashboard/diagnostics/reports", "d-diag-reports-list"],
  [`http://localhost:4000/dashboard/diagnostics/reports/${reportId}`, "d-diag-reports-detail"],
  ["http://localhost:4000/dashboard/settings", "d-settings"],
  ["http://localhost:4000/dashboard/settings/qpay", "d-settings-qpay"],
  ["http://localhost:4000/dashboard/settings/subscription", "d-settings-subscription"],
  ["http://localhost:4000/dashboard/profile", "d-profile"],
  ["http://localhost:4000/dashboard/notifications", "d-notifications"],
  ["http://localhost:4000/dashboard/audit", "d-audit"],
  ["http://localhost:4000/dashboard/feedback", "d-feedback-list"],
  ["http://localhost:4000/dashboard/orders/postpaid", "d-orders-postpaid"],
];

for (const [url, name] of pages) {
  await shot(url, name);
}

await browser.close();
