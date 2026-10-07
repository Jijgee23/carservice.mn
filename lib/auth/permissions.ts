// Tenant-ийн Role-уудад олгох боломжтой бүх permission-ийн төв жагсаалт.
// Resource бүрд CRUD: view / create / edit / delete (тус тусдаа сонгоно).
// Зарим эрх standalone (audit.view, orders.assignable) — CRUD-д хуваагдаагүй.

export const RESOURCES = [
  { key: "employees", label: "Ажилтан", group: "Удирдлага" },
  { key: "branches", label: "Салбар", group: "Удирдлага" },
  { key: "customers", label: "Үйлчлүүлэгч", group: "Үндсэн" },
  { key: "vehicles", label: "Тээврийн хэрэгсэл", group: "Үндсэн" },
  { key: "services", label: "Үйлчилгээ/Бараа", group: "Үндсэн" },
  { key: "diagnostics", label: "Оношилгооны загвар", group: "Үндсэн" },
  { key: "orders", label: "Засварын хуудас", group: "Захиалга" },
  { key: "appointments", label: "Цаг захиалга", group: "Захиалга" },
  { key: "payments", label: "Төлбөр", group: "Захиалга" },
] as const;

export type ResourceKey = (typeof RESOURCES)[number]["key"];

export const ACTIONS = [
  { key: "view", label: "Харах", verb: "Харах" },
  { key: "create", label: "Үүсгэх", verb: "Үүсгэх" },
  { key: "edit", label: "Засах", verb: "Засах" },
  { key: "delete", label: "Устгах", verb: "Устгах" },
] as const;

export type ActionKey = (typeof ACTIONS)[number]["key"];

// CRUD permission code-уудыг үүсгэх (`employees.view`, `employees.create`, ...).
type CrudCode = `${ResourceKey}.${ActionKey}`;

// CRUD-д хуваагдаагүй тусгай permission-ууд.
// `orders.itemStatus` — засварын хуудасны ажил/оношилгоо/сэлбэг мөрийн явцыг
// (хүлээгдэж буй/эхэлсэн/дууссан) чөлөөтэй өөрчлөх эрх. `orders.edit`-ээс
// тусдаа: мастер зөвхөн ЭНЭ эрхтэйгээр мөрийн явцаа шинэчилж болно (захиалгын
// бусад мэдээлэл/мөр нэмэх-цуцлах зэрэг засварын эрхгүйгээр).
// `orders.itemPrice` — засварын хуудсанд АЛЬ ХЭДИЙН нэмэгдсэн үйлчилгээний
// мөрийн нэгж үнийг дараа нь засварлах эрх. Шинэ мөр гараар нэмэхэд (тэр
// үеийн анхны үнийг тохируулахад) хамаарахгүй — тэр endpoint-ыг (addOrderItemAction)
// ердийн `orders.edit` л зохицуулна, өөрчлөхгүй.
// `employees.schedule` — ажилтны "Ажлын хувиар" (аль салбарт, ямар цагаар
// ажилладаг)-ыг засах эрх. `employees.view`-той хэн ч хувиарыг ХАРНА;
// зөвхөн ЗАСАХ (өөрчлөх/дарж бичих) энэ эрх шаардана — `employees.edit`-ээс
// тусдаа, учир нь мастер/манагер ажилтны бусад мэдээлэл (нэр/утас/цалин г.м.)
// засах эрхгүйгээр ч зөвхөн хувиар зохицуулах шаардлагатай байж болно.
// `orders.itemHistory` — засварын хуудасны цуцлагдсан ажил/оношилгоо/сэлбэг
// мөрийн түүхийг (хэн, хэзээ цуцалсан) харах эрх. Энгийн харах (`orders.view`/
// `orders.viewOwn`)-аас тусдаа: цуцлагдсан мөр анхнаасаа жагсаалтад
// харагдахгүй тул зөвхөн ЭНЭ эрхтэй хэрэглэгч "Түүх" товчоор нээж үзнэ.
// `customers.notify` — тухайн тенантын (онлайн бүртгэлтэй) бүх үйлчлүүлэгчид
// push зар/мэдэгдэл (хямдрал, урамшуулал гэх мэт) илгээх эрх. `customers.view`/
// `customers.edit`-ээс тусдаа — мэдээлэл харах/засах боломжтой ч заавал бөөнөөр
// зар илгээх боломжтой байх албагүй тул шинэ Role-д анхдагчаар ОРОХГҮЙ (өмнө
// байгаагүй, мэдрэмтгий шинэ боломж).
type StandaloneCode =
  | "audit.view"
  | "orders.assignable"
  | "orders.assign"
  | "orders.closeUnpaidPostpaid"
  | "orders.viewOwn"
  | "orders.editOwn"
  | "orders.itemStatus"
  | "orders.itemPrice"
  | "orders.itemHistory"
  | "customers.notify"
  | "employees.schedule"
  | "cash.manage";

export type PermissionCode = CrudCode | StandaloneCode;

export type PermissionDef = {
  code: PermissionCode;
  label: string;
  description: string;
  group: string;
};

const CRUD_DESCRIPTIONS: Record<ActionKey, (resourceLabel: string) => string> = {
  view: (r) => `${r}-ийн жагсаалт, дэлгэрэнгүйг харах.`,
  create: (r) => `Шинэ ${r.toLowerCase()} нэмэх.`,
  edit: (r) => `${r}-ийн мэдээллийг засварлах.`,
  delete: (r) => `${r}-ийг устгах.`,
};

function buildCrudPermissions(): PermissionDef[] {
  const out: PermissionDef[] = [];
  for (const r of RESOURCES) {
    for (const a of ACTIONS) {
      out.push({
        code: `${r.key}.${a.key}` as CrudCode,
        label: `${r.label} — ${a.label}`,
        description: CRUD_DESCRIPTIONS[a.key](r.label),
        group: r.group,
      });
    }
  }
  return out;
}

export const PERMISSIONS: readonly PermissionDef[] = [
  ...buildCrudPermissions(),
  {
    code: "orders.assignable",
    label: "Засварын хуудсанд хариуцагч болох",
    description: "Засварын хуудасны хариуцагч болгож сонгох боломжтой ажилтан.",
    group: "Захиалга",
  },
  {
    code: "orders.assign",
    label: "Засварын хуудсанд хариуцагч оноох",
    description: "Засварын хуудсанд ажилтан хариуцагчаар оноох.",
    group: "Захиалга",
  },
  {
    code: "orders.closeUnpaidPostpaid",
    label: "Дараа тооцоо хаах, тооцоо нийлэх",
    description: "Дараа тооцоот засварын хуудсыг төлбөр дутуу байхад дуусгах, дууссаны дараа төлбөр бүртгэх/буцаах (нягтлан).",
    group: "Захиалга",
  },
  {
    code: "orders.viewOwn",
    label: "Засварын хуудсыг — Өөрийнхийг харах",
    description: "Өөрт хариуцуулсан засварын хуудсыг харах.",
    group: "Захиалга",
  },
  {
    code: "orders.editOwn",
    label: "Засварын хуудсыг — Өөрийнхийг засах",
    description: "Өөрт хариуцуулсан засварын хуудсыг засах.",
    group: "Захиалга",
  },
  {
    code: "audit.view",
    label: "Аудит лог үзэх",
    description: "Бүх ажилтны үйлдлийн түүхийг харах.",
    group: "Тайлан",
  },
  {
    code: "orders.itemStatus",
    label: "Үйлчилгээний мөрийн явц өөрчлөх",
    description:
      "Засварын хуудасны ажил/оношилгоо/сэлбэг мөр бүрийн явцыг (хүлээгдэж буй/эхэлсэн/дууссан) чөлөөтэй өөрчлөх. Захиалгын бусад мэдээлэл засах эрхээс тусдаа.",
    group: "Захиалга",
  },
  {
    code: "orders.itemPrice",
    label: "Үйлчилгээний мөрийн үнэ өөрчлөх",
    description:
      "Засварын хуудсанд аль хэдийн нэмэгдсэн үйлчилгээний мөрийн нэгж үнийг дараа нь засварлах. Шинэ мөр гараар бүртгэхэд (анхны үнэ тохируулахад) хамаарахгүй.",
    group: "Захиалга",
  },
  {
    code: "orders.itemHistory",
    label: "Үйлчилгээний мөрийн түүх харах",
    description:
      "Засварын хуудсанд цуцлагдсан ажил/оношилгоо/сэлбэг мөрийн түүхийг (хэн, хэзээ цуцалсан) харах.",
    group: "Захиалга",
  },
  {
    code: "customers.notify",
    label: "Үйлчлүүлэгчид зар илгээх",
    description:
      "Онлайн бүртгэлтэй бүх үйлчлүүлэгчид push зар/мэдэгдэл (хямдрал, урамшуулал гэх мэт) илгээх.",
    group: "Үндсэн",
  },
  {
    code: "employees.schedule",
    label: "Ажлын хувиар засах",
    description:
      "Ажилтны 'Ажлын хувиар' (аль салбарт, ямар цагаар ажилладаг)-ыг өөрчлөх. Харах эрх employees.view-тэй хамт олгогдоно.",
    group: "Удирдлага",
  },
  {
    code: "cash.manage",
    label: "Касс удирдах",
    description:
      "Касс бүхэлд нь: бүх салбарын орлого/зарлагын бүртгэл харах, гараар нэмэх/хүчингүй болгох, ээлж нээх/хаах, дараа тооцоо хаах, тайлан татах, банк тохируулах.",
    group: "Захиалга",
  },
] as const;

export const PERMISSION_CODES = PERMISSIONS.map((p) => p.code);

const PERMISSION_CODE_SET = new Set<string>(PERMISSION_CODES);

export function isValidPermissionCode(code: string): code is PermissionCode {
  return PERMISSION_CODE_SET.has(code);
}

export function permissionLabel(code: string): string {
  return PERMISSIONS.find((p) => p.code === code)?.label ?? code;
}

// Permission-уудыг group-аар нь бүлэглэж UI-д харуулахад зориулсан.
export function permissionsByGroup(): Array<{
  group: string;
  items: readonly PermissionDef[];
}> {
  const groups = new Map<string, PermissionDef[]>();
  for (const p of PERMISSIONS) {
    const arr = groups.get(p.group) ?? [];
    arr.push(p);
    groups.set(p.group, arr);
  }
  return Array.from(groups.entries()).map(([group, items]) => ({
    group,
    items,
  }));
}

// Standalone (CRUD-д ороогүй) permission-ууд (UI-д тусдаа жагсаалт болгоход).
export const STANDALONE_PERMISSIONS: ReadonlyArray<PermissionDef> = PERMISSIONS.filter(
  (p) =>
    p.code === "audit.view" ||
    p.code === "orders.assignable" ||
    p.code === "orders.assign" ||
    p.code === "orders.closeUnpaidPostpaid" ||
    p.code === "orders.itemStatus" ||
    p.code === "orders.itemPrice" ||
    p.code === "orders.itemHistory" ||
    p.code === "customers.notify" ||
    p.code === "employees.schedule" ||
    p.code === "cash.manage",
);
