// Багцын модулиудын зам ↔ код зураглал. Client/server хоёуланд ашиглана (Prisma-гүй).
// Модулийн асаалттай эсэхийг `lib/plan-modules-server.ts` тооцоолно.
//
// Модулийн хаалт хаана хийгддэг:
//  - Dashboard хуудас: модулийн хавтас бүрийн layout.tsx → <ModuleGate>
//  - /api/v1: `requireApiUser` замаар нь (API_MODULE_PATHS) нэг дор шалгана
//  - Server action / shared command: `assertModuleEnabled` шууд дуудна
//  - Цэс: хаалттай модулийн мөрөнд түгжээ тэмдэг (DASHBOARD_MODULE_PATHS)
// «Үндсэн» хэсэг (засварын хуудас, үйлчлүүлэгч, машин, үйлчилгээ, ажилтан,
// төлбөр, кассын ээлж) модульд ороогүй — үргэлж нээлттэй.

import { MODULE_LIMIT_CODES, PLAN_LIMIT_META, type PlanModuleCode } from "./plan-limits";

export const MODULE_DISABLED_CODE = "MODULE_DISABLED";

export function moduleDisabledMessage(code: PlanModuleCode): string {
  return `«${PLAN_LIMIT_META[code].label}» модуль таны багцад ороогүй байна. Багцаа ахиулна уу.`;
}

/**
 * Хаалттай модулийн үйлдэл. Мессеж нь хэрэглэгчид харуулахад аюулгүй —
 * `knownAuthorizationMessage` танина (lib/action-errors.ts).
 */
export class ModuleDisabledError extends Error {
  readonly code = MODULE_DISABLED_CODE;
  constructor(readonly module: PlanModuleCode) {
    super(moduleDisabledMessage(module));
    this.name = "ModuleDisabledError";
  }
}

/** Dashboard-ийн замын угтвар → тухайн хуудсыг нээхэд шаардлагатай модуль. */
export const DASHBOARD_MODULE_PATHS: readonly (readonly [string, PlanModuleCode])[] = [
  ["/dashboard/appointments", "enable_appointments"],
  ["/dashboard/diagnostics", "enable_diagnostics"],
  ["/dashboard/services/diagnostics", "enable_diagnostics"],
  ["/dashboard/cash/transactions", "enable_finance"],
  ["/dashboard/cash/income", "enable_finance"],
  ["/dashboard/cash/expense", "enable_finance"],
  ["/dashboard/cash/settlements", "enable_finance"],
  ["/dashboard/cash/types", "enable_finance"],
  ["/dashboard/cash/report", "enable_finance"],
  ["/dashboard/services/stock-counts", "enable_inventory"],
  ["/dashboard/reports/stock", "enable_inventory"],
  ["/dashboard/employees/schedule", "enable_staff_schedule"],
  ["/dashboard/my-schedule", "enable_staff_schedule"],
  ["/dashboard/customers/notify", "enable_customer_broadcast"],
  ["/dashboard/reports", "enable_reports"],
  ["/dashboard/audit", "enable_audit"],
];

/**
 * /api/v1 замын угтвар → модуль. Ажилтны мобайл апп-ын үндсэн endpoint-ууд
 * (orders, customers, cash/sessions г.м.) энд ороогүй — үргэлж нээлттэй.
 * `/api/v1/app/*` (эцсийн хэрэглэгчийн апп) нь online_booking-оор тусад нь шүүгддэг.
 */
export const API_MODULE_PATHS: readonly (readonly [string, PlanModuleCode])[] = [
  ["/api/v1/appointments", "enable_appointments"],
  ["/api/v1/diagnostics", "enable_diagnostics"],
  ["/api/v1/cash/entries", "enable_finance"],
  ["/api/v1/cash/attachments", "enable_finance"],
  ["/api/v1/cash/settlements", "enable_finance"],
  ["/api/v1/cash/types", "enable_finance"],
  ["/api/v1/cash/report", "enable_finance"],
  ["/api/v1/employee-schedules", "enable_staff_schedule"],
  ["/api/v1/me/schedule", "enable_staff_schedule"],
  ["/api/v1/customers/notify", "enable_customer_broadcast"],
  ["/api/v1/reports/stock", "enable_inventory"],
  ["/api/v1/reports", "enable_reports"],
  ["/api/v1/audit", "enable_audit"],
  ["/api/v1/stock-counts", "enable_inventory"],
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Багцын «юу багтсан» жагсаалт (үнийн карт, «Багц» хуудас) — багцын
 * модулиудаас автоматаар. Тоон хязгаар бүх багцад байхгүй.
 */
export function planFeatureLines(
  enabled: ReadonlySet<PlanModuleCode>,
): string[] {
  return [
    "Ажилтан, үйлчлүүлэгч, машин, захиалга — хязгааргүй",
    "Засварын хуудас, үйлчилгээ, төлбөр, касс",
    ...MODULE_LIMIT_CODES.filter((c) => enabled.has(c)).map((c) => PLAN_LIMIT_META[c].label),
  ];
}

/** Тухайн замд шаардлагатай БҮХ модуль (ж: /dashboard/reports/stock → нөөц + тайлан). */
export function modulesForPath(
  pathname: string,
  table: readonly (readonly [string, PlanModuleCode])[],
): PlanModuleCode[] {
  const out: PlanModuleCode[] = [];
  for (const [prefix, code] of table) {
    if (matchesPrefix(pathname, prefix) && !out.includes(code)) out.push(code);
  }
  return out;
}

/** Замд шаардлагатай модулиудаас хаалттай эхнийхийг буцаана (бүгд нээлттэй бол null). */
export function firstDisabledModule(
  pathname: string,
  table: readonly (readonly [string, PlanModuleCode])[],
  enabled: ReadonlySet<PlanModuleCode> | readonly PlanModuleCode[],
): PlanModuleCode | null {
  const has = (c: PlanModuleCode) =>
    "has" in enabled ? enabled.has(c) : enabled.includes(c);
  return modulesForPath(pathname, table).find((c) => !has(c)) ?? null;
}
