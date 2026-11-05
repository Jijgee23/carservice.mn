// Client- ба server-аас хоёулангаас нь ашиглах ЦЭВЭР тогтмол/түр (no prisma).
// Runtime enforcement helper-уудыг `lib/plan-limits-server.ts` дотроос унш.

import type { Plan } from "@/app/generated/prisma/enums";

/**
 * Багцын модулиудын төвлөрсөн жагсаалт. Бүгд snake_case (DB-д PlanLimit.code-оор
 * хадгалагдана). Багцууд ЗӨВХӨН модулиар ялгардаг — тоон (ажилтан, салбар,
 * өдрийн захиалга г.м.) хязгаар байхгүй, бүх багцад хязгааргүй.
 * Шинэ модуль нэмэхдээ:
 *   1. `PLAN_LIMIT_CODES` болон `MODULE_LIMIT_CODES`-д код нэмнэ
 *   2. `PLAN_LIMIT_META`-д label/description нэмнэ
 *   3. `DEFAULT_PLAN_LIMITS`-д 3 plan бүрд асаалттай эсэхийг заана
 *   4. Хаалтын замыг lib/plan-modules.ts-д / action-д assertModuleEnabled
 */
export const PLAN_LIMIT_CODES = {
  ENABLE_APPOINTMENTS: "enable_appointments",
  ENABLE_DIAGNOSTICS: "enable_diagnostics",
  ONLINE_BOOKING: "online_booking",
  ENABLE_FINANCE: "enable_finance",
  ENABLE_INVENTORY: "enable_inventory",
  ENABLE_STAFF_SCHEDULE: "enable_staff_schedule",
  ENABLE_CUSTOMER_BROADCAST: "enable_customer_broadcast",
  ENABLE_REPORTS: "enable_reports",
  ENABLE_MULTI_BRANCH: "enable_multi_branch",
  ENABLE_AUDIT: "enable_audit",
  ENABLE_API: "enable_api",
} as const;

export type PlanLimitCode =
  (typeof PLAN_LIMIT_CODES)[keyof typeof PLAN_LIMIT_CODES];

export type PlanLimitKind = "BOOLEAN";

export const PLAN_LIMIT_META: Record<
  PlanLimitCode,
  {
    label: string;
    description: string;
    kind: PlanLimitKind;
    sortOrder: number;
  }
> = {
  enable_appointments: {
    label: "Цаг захиалга",
    description: "Цаг захиалгын календар, захиалга бүртгэх, баталгаажуулах",
    kind: "BOOLEAN",
    sortOrder: 100,
  },
  enable_diagnostics: {
    label: "Оношилгоо",
    description: "Оношилгооны загвар, үйлчилгээ, тайлан",
    kind: "BOOLEAN",
    sortOrder: 105,
  },
  online_booking: {
    label: "Онлайн цаг захиалга",
    description: "Хэрэглэгчийн вэб/апп каталогт харагдаж, онлайнаар цаг авах",
    kind: "BOOLEAN",
    sortOrder: 110,
  },
  enable_finance: {
    label: "Санхүү",
    description: "Орлого/зарлагын бүртгэл, ангилал, тооцоо нийлэлт, мөнгөн гүйлгээний тайлан (кассын ээлж үндсэн хэсэгт)",
    kind: "BOOLEAN",
    sortOrder: 115,
  },
  enable_inventory: {
    label: "Нөөц",
    description: "Сэлбэг барааны тооллого, үлдэгдлийн тайлан",
    kind: "BOOLEAN",
    sortOrder: 120,
  },
  enable_staff_schedule: {
    label: "Ажлын хувиар",
    description: "Ажилтны ажлын хувиар төлөвлөх, харах",
    kind: "BOOLEAN",
    sortOrder: 125,
  },
  enable_customer_broadcast: {
    label: "Үйлчлүүлэгчид зар илгээх",
    description: "Апп-аар бүртгэлтэй үйлчлүүлэгчиддээ push зар/мэдэгдэл илгээх",
    kind: "BOOLEAN",
    sortOrder: 130,
  },
  enable_reports: {
    label: "Тайлан",
    description: "Засварын хуудасны тайлан, экспорт",
    kind: "BOOLEAN",
    sortOrder: 135,
  },
  enable_multi_branch: {
    label: "Олон салбар",
    description: "Нэгээс олон салбар бүртгэх",
    kind: "BOOLEAN",
    sortOrder: 140,
  },
  enable_audit: {
    label: "Аудит лог",
    description: "Ажилтнуудын үйлдлийн түүх",
    kind: "BOOLEAN",
    sortOrder: 145,
  },
  enable_api: {
    label: "Гадаад API интеграц",
    description: "Гадаад системтэй API-аар холбогдох (ажилтны мобайл апп үүнээс үл хамааран ажиллана)",
    kind: "BOOLEAN",
    sortOrder: 150,
  },
};

export const ALL_LIMIT_CODES: PlanLimitCode[] = Object.values(PLAN_LIMIT_CODES);

type DefaultValue = { intValue: number | null; boolValue: boolean | null };

/** Багцын модулиуд (BOOLEAN код) — дэлгэцэнд энэ дарааллаар харуулна. */
export const MODULE_LIMIT_CODES = [
  "enable_appointments",
  "enable_diagnostics",
  "online_booking",
  "enable_finance",
  "enable_inventory",
  "enable_staff_schedule",
  "enable_customer_broadcast",
  "enable_reports",
  "enable_multi_branch",
  "enable_audit",
  "enable_api",
] as const satisfies readonly PlanLimitCode[];

export type PlanModuleCode = (typeof MODULE_LIMIT_CODES)[number];

/** Багцын модулиудын анхдагч утга (intValue ашиглагдахгүй — тоон хязгааргүй). */
function planDefaults(
  modules: Record<PlanModuleCode, boolean>,
): Record<PlanLimitCode, DefaultValue> {
  const out = {} as Record<PlanLimitCode, DefaultValue>;
  for (const code of MODULE_LIMIT_CODES) {
    out[code] = { intValue: null, boolValue: modules[code] };
  }
  return out;
}

/**
 * 3 plan тус бүрийн анхдагч утга. SuperAdmin-аас өөрчилнө.
 *   - boolValue: true/false → модуль (BOOLEAN) нээлттэй/хаалттай
 */
export const DEFAULT_PLAN_LIMITS: Record<
  Plan,
  Record<PlanLimitCode, DefaultValue>
> = {
  FREE: planDefaults({
    enable_appointments: true,
    enable_diagnostics: true,
    online_booking: false,
    enable_finance: false,
    enable_inventory: false,
    enable_staff_schedule: false,
    enable_customer_broadcast: false,
    enable_reports: false,
    enable_multi_branch: false,
    enable_audit: false,
    enable_api: false,
  }),
  BUSINESS: planDefaults({
    enable_appointments: true,
    enable_diagnostics: true,
    online_booking: true,
    enable_finance: true,
    enable_inventory: true,
    enable_staff_schedule: true,
    enable_customer_broadcast: true,
    enable_reports: true,
    enable_multi_branch: true,
    enable_audit: false,
    enable_api: false,
  }),
  ENTERPRISE: planDefaults({
    enable_appointments: true,
    enable_diagnostics: true,
    online_booking: true,
    enable_finance: true,
    enable_inventory: true,
    enable_staff_schedule: true,
    enable_customer_broadcast: true,
    enable_reports: true,
    enable_multi_branch: true,
    enable_audit: true,
    enable_api: true,
  }),
};
