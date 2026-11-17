// Системийн (глобал) үндсэн ролиуд. Роль tenant бүрт тусдаа биш — бүх
// байгууллага эдгээрээс сонгож ажилтандаа онооно. Супер админ /system/roles-оос
// нэр, тайлбар, эрхийг нь засна; нэмэлт роль үүсгэж болох ч эдгээр үндсэн
// (key-тэй) ролийг устгахгүй.
//
// Энд байгаа эрхүүд нь зөвхөн АНХДАГЧ утга: migration
// (`20261113130000_global_system_roles`) болон fixture seed энэ жагсаалттай
// ижил байх ёстой. Прод дээрх бодит эрх нь DB-д (супер админы засвараар).
//
// Tenant-admin (`User.isOwner`) нь роль биш — бүх эрхтэй хэвээр.

import { RESOURCES, type PermissionCode } from "@/lib/auth/permissions";

export const SYSTEM_ROLE_KEYS = [
  "MECHANIC",
  "ENGINEER",
  "ACCOUNTANT",
  "CASHIER",
  "MANAGER",
] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export type SystemRoleDefault = {
  id: string;
  key: SystemRoleKey;
  name: string;
  description: string;
  sortOrder: number;
  permissions: PermissionCode[];
};

const ALL_VIEW = RESOURCES.map((r) => `${r.key}.view` as PermissionCode);

export const SYSTEM_ROLE_DEFAULTS: readonly SystemRoleDefault[] = [
  {
    id: "sysrole_mechanic",
    key: "MECHANIC",
    name: "Засварчин",
    description: "Өөрт оноогдсон засварыг гүйцэтгэж, оношилгоо хийнэ.",
    sortOrder: 10,
    permissions: [
      "orders.viewOwn",
      "orders.editOwn",
      "orders.assignable",
      "orders.itemStatus",
      "orders.itemHistory",
      "diagnostics.view",
      "diagnostics.create",
      "diagnostics.edit",
      "vehicles.view",
      "customers.view",
      "services.view",
    ],
  },
  {
    id: "sysrole_engineer",
    key: "ENGINEER",
    name: "Инженер",
    description: "Засвар хүлээн авч, хуваарилж, үнэ болон оношилгоог хариуцна.",
    sortOrder: 20,
    permissions: [
      "orders.view",
      "orders.create",
      "orders.edit",
      "orders.assign",
      "orders.assignable",
      "orders.itemStatus",
      "orders.itemPrice",
      "orders.itemHistory",
      "diagnostics.view",
      "diagnostics.create",
      "diagnostics.edit",
      "vehicles.view",
      "vehicles.create",
      "vehicles.edit",
      "customers.view",
      "customers.create",
      "customers.edit",
      "services.view",
      "appointments.view",
      "appointments.create",
      "appointments.edit",
      "employees.view",
    ],
  },
  {
    id: "sysrole_accountant",
    key: "ACCOUNTANT",
    name: "Нягтлан",
    description: "Төлбөр, касс, тооцоо болон санхүүгийн хяналт.",
    sortOrder: 30,
    permissions: [
      "payments.view",
      "payments.create",
      "payments.edit",
      "orders.view",
      "orders.itemHistory",
      "orders.closeUnpaidPostpaid",
      "cash.manage",
      "customers.view",
      "vehicles.view",
      "services.view",
      "audit.view",
    ],
  },
  {
    id: "sysrole_cashier",
    key: "CASHIER",
    name: "Кассын нярав",
    description: "Төлбөр хүлээн авч, кассын гүйлгээ хөтөлнө.",
    sortOrder: 40,
    permissions: [
      "payments.view",
      "payments.create",
      "cash.manage",
      "orders.view",
      "customers.view",
      "vehicles.view",
      "services.view",
    ],
  },
  {
    id: "sysrole_manager",
    key: "MANAGER",
    name: "Менежер",
    description: "Бүх мэдээллийг зөвхөн харна (засах эрхгүй).",
    sortOrder: 50,
    permissions: [...ALL_VIEW, "audit.view", "orders.itemHistory"],
  },
];

export function isSystemRoleKey(v: unknown): v is SystemRoleKey {
  return typeof v === "string" && (SYSTEM_ROLE_KEYS as readonly string[]).includes(v);
}
