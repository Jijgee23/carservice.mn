// Байгууллага ролиос нэмж/хасч болох эрхүүдийн АНХДАГЧ (нээлттэй) жагсаалт. Системийн
// ролиуд, шинэ роль үүсгэх форм, migration, fixture seed бүгд ЭНЭ нэг жагсаалтыг дагана.
//
// Зарчим: эрх өөрчлөх боломж анхнаасаа нээлттэй (жишээ нь засварын хуудсанд ажил, үйлчилгээ,
// сэлбэгийн үнийг засах `orders.itemPrice`). Систем админ роль бүр дээр аль эрхийг түгжихээ
// /system/roles-оос тохируулна. Доорх SENSITIVE нь анхнаасаа түгжигдсэн (мөнгө, ажилтан
// удирдах, аудит) — админ хүсвэл нээж болно.

import { PERMISSIONS } from "@/lib/auth/permissions";

export const SENSITIVE_PERMISSION_CODES: readonly string[] = [
  "employees.create",
  "employees.edit",
  "employees.delete",
  "audit.view",
  "cash.manage",
  "orders.closeUnpaidPostpaid",
  "payments.delete",
];

const SENSITIVE = new Set(SENSITIVE_PERMISSION_CODES);

/** Каталогийн эрхүүд − эмзэг эрхүүд (каталогийн дарааллаар). */
export const DEFAULT_TENANT_EDITABLE_PERMISSIONS: readonly string[] = PERMISSIONS.map((p) => p.code).filter(
  (c) => !SENSITIVE.has(c),
);
