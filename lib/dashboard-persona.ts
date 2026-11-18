// Нүүр дэлгэцийн «дүр» (persona) — хэрэглэгчийн ЭРХЭЭС (role-ийн нэрээс биш: тенант бүр
// өөрийн role үүсгэдэг) тодорхойлж, вэб dashboard болон мобайл GET /api/v1/home-д
// ижил layout өгнө. PURE — DB/Request хамааралгүй тул unit тестлэгдэнэ.

import { hasPermission, type RoleCheckUser } from "@/lib/auth/roles";
import { orderViewScope } from "@/lib/auth/order-access";

export type HomePersona = "manager" | "mechanic" | "frontdesk" | "cashier";

/** Гол үзүүлэлтийн картууд. */
export type HomeKpi = "openOrders" | "createdToday" | "monthCompleted" | "paymentsToday" | "receivable" | "reviews";

/** «Өнөөдөр» хэсгийн widget-ууд (өгөгдөл нь dashboard-focus-аас). */
export type HomeWidget = "appointments" | "work" | "cash" | "payments" | "receivable";

/** Толгойн үндсэн үйлдлүүд — хуудас шалгах эрхийг дуудагч (canCreate) хийнэ. */
export type HomeAction = "new-order" | "new-appointment" | "collect-payment" | "my-orders";

export type HomeLayout = {
  persona: HomePersona;
  /** Мэндчилгээний доорх тайлбар. */
  headline: string;
  attention: boolean;
  kpis: HomeKpi[];
  /** Өргөн (2/3) багана ба нарийн (1/3) багана — дарааллаараа. */
  main: HomeWidget[];
  side: HomeWidget[];
  income: boolean;
  recent: boolean;
  base: boolean;
  actions: HomeAction[];
};

/**
 * Дүрийн дүрэм (эхнийх нь давамгайлна):
 *  1. Админ → manager (бүгдийг харна).
 *  2. Зөвхөн ӨӨРИЙН хуудас харна (orders.viewOwn) → mechanic.
 *  3. Мөнгө (cash.manage / payments.view) авдаг, цаг захиалга харахгүй → cashier.
 *  4. Цаг захиалга харна, мөнгө авдаггүй → frontdesk.
 *  5. Бусад (хоёулаа, эсвэл аль нь ч биш) → manager.
 * Харагдах өгөгдлийг эрх нь дангаараа тасалдаг (loadDashboardFocus access) тул
 * дүр буруу таарсан ч эрхгүй зүйл хэзээ ч ил гарахгүй — зөвхөн байрлал өөрчлөгдөнө.
 */
export function resolveHomePersona(user: RoleCheckUser): HomePersona {
  if (user.isOwner) return "manager";
  if (orderViewScope(user) === "own") return "mechanic";
  const money = hasPermission(user, "cash.manage") || hasPermission(user, "payments.view");
  const desk = hasPermission(user, "appointments.view");
  if (money && !desk) return "cashier";
  if (desk && !money) return "frontdesk";
  return "manager";
}

const LAYOUTS: Record<HomePersona, Omit<HomeLayout, "persona">> = {
  manager: {
    headline: "Өнөөдрийн байдал",
    attention: true,
    kpis: ["openOrders", "createdToday", "monthCompleted", "paymentsToday", "receivable", "reviews"],
    main: ["appointments", "work"],
    side: ["cash", "payments", "receivable"],
    income: true,
    recent: true,
    base: true,
    actions: ["new-appointment", "new-order"],
  },
  mechanic: {
    headline: "Миний ажил",
    attention: true,
    kpis: ["openOrders", "monthCompleted"],
    main: ["work"],
    side: [],
    income: false,
    recent: true,
    base: false,
    actions: ["my-orders"],
  },
  frontdesk: {
    headline: "Өнөөдрийн цаг захиалга, хүлээн авалт",
    attention: true,
    kpis: ["openOrders", "createdToday"],
    main: ["appointments", "work"],
    side: [],
    income: false,
    recent: true,
    base: false,
    actions: ["new-order", "new-appointment"],
  },
  cashier: {
    headline: "Төлбөр, авлага",
    attention: true,
    kpis: ["paymentsToday", "receivable", "openOrders"],
    main: ["receivable", "payments"],
    side: ["cash"],
    income: false,
    recent: true,
    base: false,
    actions: ["collect-payment"],
  },
};

export function homeLayoutFor(persona: HomePersona): HomeLayout {
  const l = LAYOUTS[persona];
  return { persona, ...l, kpis: [...l.kpis], main: [...l.main], side: [...l.side], actions: [...l.actions] };
}

export function resolveHomeLayout(user: RoleCheckUser): HomeLayout {
  return homeLayoutFor(resolveHomePersona(user));
}
