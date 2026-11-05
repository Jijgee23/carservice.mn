import { formatTugrik } from "@/lib/orders";
import { Prisma, prisma } from "@/lib/prisma";
import { sendPushToAccount, sendPushToSuperAdmin, sendPushToTokens, sendPushToUser } from "@/lib/push";
import { setBypassContext } from "@/lib/tenant-context";

// Мэдэгдэлийн төв — илгээгдсэн мэдэгдэл бүрийг DB-д хадгалж (Notification), дараа нь
// best-effort push илгээнэ. Ажилтан (User) ба Account хоёуланд нэг урсгалаар.
//
// Шинэ event нэмэхдээ: (1) NOTIFICATION_TYPES-д key нэмж, (2) NOTIFICATION_REGISTRY-д
// тохирох def бичнэ. TypeScript Record нь бүх key-г шаардах тул мартагдахгүй.

export const NOTIFICATION_TYPES = [
  "appointment_confirmed",
  "appointment_rejected",
  "appointment_reminder",
  "appointment_created",
  "appointment_booked_by_staff",
  "appointment_cancelled",
  "appointment_expired",
  "appointment_no_show",
  "appointment_fee_paid",
  "expected_finish_revised",
  "order_completed",
  "order_cancelled",
  "order_in_progress",
  "order_payment_received",
  "order_rescheduled",
  "service_reminder",
  "appointment_rescheduled",
  "appointment_rescheduled_by_account",
  "subscription_expiring",
  "credit_blocked",
  "credit_unblocked",
  "credit_blocked_admin",
  "review_received",
  "feedback_replied_staff",
  "feedback_replied_account",
  "tenant_created",
  "quote_request_created",
  "tenant_promo",
  "broadcast_staff",
  "broadcast_account",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationRealm = "staff" | "account" | "system";

// Түүх жагсаалтад харуулах төрлийн нэр (badge).
export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  appointment_confirmed: "Цаг баталгаажсан",
  appointment_rejected: "Цаг батлагдаагүй",
  appointment_reminder: "Цаг сануулга",
  appointment_created: "Шинэ цаг захиалга",
  appointment_booked_by_staff: "Шинэ цаг захиалга",
  appointment_cancelled: "Цаг цуцлагдсан",
  appointment_expired: "Цаг хугацаа хэтэрсэн",
  appointment_no_show: "Цагт ирээгүй",
  appointment_fee_paid: "Цаг захиалгын хураамж төлөгдсөн",
  expected_finish_revised: "Дуусах хугацаа шинэчлэгдсэн",
  order_completed: "Захиалга дууссан",
  order_cancelled: "Захиалга цуцлагдсан",
  order_in_progress: "Ажил эхэллээ",
  order_payment_received: "Төлбөр хүлээн авсан",
  order_rescheduled: "Товлосон огноо шилжсэн",
  service_reminder: "Үйлчилгээний сануулга",
  appointment_rescheduled: "Цаг шилжсэн",
  appointment_rescheduled_by_account: "Хэрэглэгч цагаа шилжүүлсэн",
  subscription_expiring: "Багц дуусах",
  credit_blocked: "Credit score — блоклогдсон",
  credit_unblocked: "Credit score — блок цуцлагдсан",
  credit_blocked_admin: "Credit score — блок",
  review_received: "Шинэ үнэлгээ",
  feedback_replied_staff: "Санал хүсэлтэд хариу ирсэн",
  feedback_replied_account: "Санал хүсэлтэд хариу ирсэн",
  tenant_created: "Шинэ байгууллага бүртгүүлсэн",
  quote_request_created: "Үнийн саналын хүсэлт",
  tenant_promo: "Байгууллагын зар",
  broadcast_staff: "Мэдэгдэл",
  broadcast_account: "Мэдэгдэл",
};

// Event тус бүрд дамжуулах түүхий утгууд (бүгд string — FCM data-д ч мөн).
export type NotificationInput = Record<string, string>;

type BuiltNotification = {
  title: string;
  body: string;
  data: Record<string, string>;
  // Идемпотент event-д давхар үүсэхээс сэргийлэх түлхүүр. Заавал биш.
  dedupeKey?: string;
};

type NotificationDef = {
  // Хүлээн авагчийн talбар: "staff" → User, "account" → Account.
  realm: NotificationRealm;
  build: (input: NotificationInput) => BuiltNotification;
  // Мэдэгдэл дээр дарахад шилжих холбоос (хадгалсан data-аас).
  href: (data: Record<string, string>) => string;
};

// Ажилтны цаг захиалгын жагсаалт (/dashboard/appointments) хуудасны хувьд
// хуудаслалт/шүүлт дундаас тухайн нэг мөрийг олоход хялбар байхын тулд
// `highlight` query param-аар шууд тухайн ID-г заана (харах: page.tsx).
function staffAppointmentHref(appointmentId: string | undefined): string {
  return appointmentId
    ? `/dashboard/appointments?highlight=${appointmentId}`
    : "/dashboard/appointments";
}

// Account-ийн "Миний захиалгууд" (/account) бүх мөрийг нэг хуудсанд хуудаслалтгүй
// харуулдаг тул энгийн URL fragment-ээр (#appt-<id>) шууд тухайн карт руу
// scroll хийж, :target CSS-ээр тодруулна (JS шаардлагагүй).
function accountAppointmentHref(appointmentId: string | undefined): string {
  return appointmentId ? `/account#appt-${appointmentId}` : "/account";
}

export const NOTIFICATION_REGISTRY: Record<NotificationType, NotificationDef> = {
  appointment_confirmed: {
    realm: "account",
    build: (i) => ({
      title: "Цаг баталгаажлаа",
      body: "Таны захиалсан цаг баталгаажлаа.",
      data: { type: "appointment_confirmed", appointmentId: i.appointmentId ?? "" },
    }),
    href: (d) => appointmentHref(d),
  },
  appointment_rejected: {
    realm: "account",
    build: (i) => ({
      title: "Цаг батлагдсангүй",
      body: "Таны захиалсан цагийг байгууллага батлаагүй байна.",
      data: { type: "appointment_rejected", appointmentId: i.appointmentId ?? "" },
    }),
    href: (d) => appointmentHref(d),
  },
  appointment_reminder: {
    realm: "account",
    build: (i) => ({
      title: "Цаг сануулга",
      body: i.body ?? "Таны товлосон цаг ойртож байна.",
      data: { type: "appointment_reminder", appointmentId: i.appointmentId ?? "" },
      // Cron давхар дуудагдсан ч нэг л мөр үүснэ.
      dedupeKey: i.appointmentId
        ? `appointment_reminder:${i.appointmentId}`
        : undefined,
    }),
    href: (d) => appointmentHref(d),
  },
  appointment_created: {
    realm: "staff",
    build: (i) => ({
      title: "Шинэ цаг захиалга",
      body: i.body ?? "Шинэ цаг захиалгын хүсэлт ирлээ.",
      data: { type: "appointment_created", appointmentId: i.appointmentId ?? "" },
    }),
    href: (d) => staffAppointmentHref(d.appointmentId),
  },
  // D-191: ажилтан үйлчлүүлэгчийн ӨМНӨӨС (утсаар) цаг бүртгэхэд account-д
  // очих мэдэгдэл. `appointment_created`-тай НЭР төстэй ч тэр нь
  // "онлайн хүсэлт ирлээ" гэсэн STAFF-realm мэдэгдэл (өөр утга, өөр
  // хүлээн авагч) — registry нэг key-д нэг realm-тай тул тусдаа key.
  // Body-г дуудагч тал (registerAppointmentByStaffCommand) салбарын нэр +
  // Asia/Ulaanbaatar цагаар угсарч `input.body`-оор дамжуулна.
  appointment_booked_by_staff: {
    realm: "account",
    build: (i) => ({
      title: "Шинэ цаг захиалга",
      body: i.body ?? "Танд шинэ цаг захиалга бүртгэгдлээ.",
      data: { type: "appointment_booked_by_staff", appointmentId: i.appointmentId ?? "" },
    }),
    href: (d) => appointmentHref(d),
  },
  appointment_cancelled: {
    realm: "staff",
    build: (i) => ({
      title: "Цаг цуцлагдсан",
      body: i.body ?? "Үйлчлүүлэгч захиалсан цагаа цуцаллаа.",
      data: { type: "appointment_cancelled", appointmentId: i.appointmentId ?? "" },
    }),
    href: (d) => staffAppointmentHref(d.appointmentId),
  },
  appointment_fee_paid: {
    realm: "staff",
    build: (i) => ({
      title: "Цаг захиалгын хураамж төлөгдсөн",
      body: i.body ?? "Цаг захиалгын хураамж төлөгдлөө.",
      data: { type: "appointment_fee_paid", appointmentId: i.appointmentId ?? "" },
    }),
    href: (d) => staffAppointmentHref(d.appointmentId),
  },
  appointment_expired: {
    realm: "account",
    build: (i) => ({
      title: "Цаг цуцлагдлаа",
      body: "Таны хүссэн цагт байгууллага хариу өгөөгүй тул захиалга автоматаар цуцлагдлаа.",
      data: { type: "appointment_expired", appointmentId: i.appointmentId ?? "" },
    }),
    href: (d) => appointmentHref(d),
  },
  appointment_no_show: {
    realm: "account",
    build: (i) => ({
      title: "Цагтаа ирээгүй тэмдэглэгдлээ",
      body: "Та товлосон цагтаа ирээгүй тул байгууллага тэмдэглэлээ.",
      data: { type: "appointment_no_show", appointmentId: i.appointmentId ?? "" },
    }),
    href: (d) => appointmentHref(d),
  },
  expected_finish_revised: {
    realm: "account",
    build: (i) => ({
      title: "Дуусах хугацаа шинэчлэгдлээ",
      body: i.body ?? "Таны засварын хуудасны дуусах хугацаа шинэчлэгдлээ.",
      data: { type: "expected_finish_revised", appointmentId: i.appointmentId ?? "" },
    }),
    href: (d) => appointmentHref(d),
  },
  order_completed: {
    realm: "account",
    build: (i) => ({
      title: "Захиалга дууслаа",
      body: "Таны засварын хуудас дууслаа.",
      data: {
        type: "order_completed",
        orderId: i.orderId ?? "",
        appointmentId: i.appointmentId ?? "",
      },
    }),
    href: (d) => orderHref(d),
  },
  order_cancelled: {
    realm: "account",
    build: (i) => ({
      title: "Захиалга цуцлагдлаа",
      body: "Таны засварын хуудас цуцлагдлаа.",
      data: {
        type: "order_cancelled",
        orderId: i.orderId ?? "",
        appointmentId: i.appointmentId ?? "",
      },
    }),
    href: (d) => orderHref(d),
  },
  order_in_progress: {
    realm: "account",
    build: (i) => ({
      title: "Ажил эхэллээ",
      body: "Таны засварын хуудасны ажил эхэллээ.",
      data: {
        type: "order_in_progress",
        orderId: i.orderId ?? "",
        appointmentId: i.appointmentId ?? "",
      },
    }),
    href: (d) => orderHref(d),
  },
  order_payment_received: {
    realm: "account",
    build: (i) => ({
      title: "Төлбөр хүлээн авлаа",
      body: i.amount
        ? `Таны ${formatTugrik(i.amount)} төлбөр амжилттай бүртгэгдлээ.`
        : "Таны төлбөр амжилттай бүртгэгдлээ.",
      data: {
        type: "order_payment_received",
        orderId: i.orderId ?? "",
        appointmentId: i.appointmentId ?? "",
      },
    }),
    href: (d) => orderHref(d),
  },
  order_rescheduled: {
    realm: "account",
    build: (i) => ({
      title: "Товлосон огноо шилжлээ",
      body: i.body ?? "Таны засварын хуудасны товлосон огноо өөрчлөгдлөө.",
      data: { type: "order_rescheduled", appointmentId: i.appointmentId ?? "" },
    }),
    href: (d) => appointmentHref(d),
  },
  // "Дараагийн үйлчилгээний сануулга" — `Service.reminderIntervalMonths`
  // тохируулсан үйлчилгээ COMPLETED болсноос хойш тэр олон сарын дараа,
  // cron-оор (app/api/cron/service-reminders) НЭГ л удаа илгээгдэнэ.
  service_reminder: {
    realm: "account",
    build: (i) => ({
      title: i.serviceName ? `${i.serviceName} — цаг боллоо` : "Үйлчилгээний цаг боллоо",
      body: i.vehiclePlate
        ? `${i.vehiclePlate} — «${i.serviceName ?? "үйлчилгээ"}» дахин хийлгэх цаг боллоо.`
        : `«${i.serviceName ?? "Үйлчилгээ"}» дахин хийлгэх цаг боллоо.`,
      data: {
        type: "service_reminder",
        serviceItemId: i.serviceItemId ?? "",
        serviceId: i.serviceId ?? "",
        vehicleId: i.vehicleId ?? "",
      },
      // Cron давхар дуудагдсан ч (эсвэл өдөр бүр дахин тааралдсан ч) нэг л
      // мөр үүснэ — `ServiceItem.reminderSentAt` guard-тай хамт давхар хамгаалалт.
      dedupeKey: i.serviceItemId ? `service_reminder:${i.serviceItemId}` : undefined,
    }),
    href: () => "/book",
  },
  appointment_rescheduled: {
    realm: "account",
    build: (i) => ({
      title: "Цаг шилжлээ",
      body: i.body ?? "Таны захиалсан цаг өөр хугацаанд шилжлээ.",
      data: { type: "appointment_rescheduled", appointmentId: i.appointmentId ?? "" },
    }),
    href: (d) => appointmentHref(d),
  },
  appointment_rescheduled_by_account: {
    realm: "staff",
    build: (i) => ({
      title: "Хэрэглэгч цагаа шилжүүлсэн",
      body: i.body ?? "Үйлчлүүлэгч захиалсан цагаа өөр хугацаанд шилжүүллээ.",
      data: { type: "appointment_rescheduled_by_account", appointmentId: i.appointmentId ?? "" },
    }),
    href: (d) => staffAppointmentHref(d.appointmentId),
  },
  // Credit score босгоос доош орж автоматаар блоклогдсон / нээгдсэн
  // (lib/credit-score-server.ts) — тенантын эзэд, мөн систем админд.
  credit_blocked: {
    realm: "staff",
    build: (i) => ({
      title: "Credit score бага тул блоклогдлоо",
      body: i.body ?? "Таны байгууллагын credit score босгоос доош орсон.",
      data: { type: "credit_blocked" },
    }),
    href: () => "/dashboard/settings",
  },
  credit_unblocked: {
    realm: "staff",
    build: (i) => ({
      title: "Блок цуцлагдлаа",
      body: i.body ?? "Таны байгууллагын credit score сэргэж, блок цуцлагдлаа.",
      data: { type: "credit_unblocked" },
    }),
    href: () => "/dashboard/settings",
  },
  credit_blocked_admin: {
    realm: "system",
    build: (i) => ({
      title: "Credit score — автомат блок",
      body: i.body ?? "Байгууллага credit score-оор блоклогдлоо.",
      data: { type: "credit_blocked_admin", tenantId: i.tenantId ?? "" },
    }),
    href: (d) => (d.tenantId ? `/system/tenants/${d.tenantId}` : "/system/tenants"),
  },
  // Үйлчлүүлэгч дууссан засварт үнэлгээ өгсөн (lib/reviews.ts).
  review_received: {
    realm: "staff",
    build: (i) => ({
      title: `Шинэ үнэлгээ: ${i.rating ?? ""} ★`,
      body: i.body ?? "Үйлчлүүлэгч үнэлгээ өглөө.",
      data: { type: "review_received", reviewId: i.reviewId ?? "" },
    }),
    href: () => "/dashboard/reviews",
  },
  subscription_expiring: {
    realm: "staff",
    build: (i) => ({
      title: "Багцын хугацаа дуусаж байна",
      body: i.body ?? "Таны багцын хугацаа удахгүй дуусна. Сунгана уу.",
      data: {
        type: "subscription_expiring",
        subscriptionId: i.subscriptionId ?? "",
      },
    }),
    href: () => "/dashboard/settings/subscription",
  },
  feedback_replied_staff: {
    realm: "staff",
    build: (i) => ({
      title: "Санал хүсэлтэд хариу ирлээ",
      body: i.message ?? "",
      data: { type: "feedback_replied_staff", feedbackId: i.feedbackId ?? "" },
    }),
    href: () => "/dashboard",
  },
  feedback_replied_account: {
    realm: "account",
    build: (i) => ({
      title: "Санал хүсэлтэд хариу ирлээ",
      body: i.message ?? "",
      data: { type: "feedback_replied_account", feedbackId: i.feedbackId ?? "" },
    }),
    // No customer-facing feedback detail page exists (mirrors the mobile
    // app's D-031 fallback) — land on the notifications list instead.
    href: () => "/account/notifications",
  },
  tenant_created: {
    realm: "system",
    build: (i) => ({
      title: "Шинэ байгууллага бүртгүүлсэн",
      body: i.tenantName ? `"${i.tenantName}" бүртгүүллээ.` : "Шинэ байгууллага бүртгүүллээ.",
      data: { type: "tenant_created", tenantId: i.tenantId ?? "" },
    }),
    href: (d) => (d.tenantId ? `/system/tenants/${d.tenantId}` : "/system/tenants"),
  },
  // Энтерпрайз багцын үнийн саналын хүсэлт (app/_actions/quote-requests.ts).
  quote_request_created: {
    realm: "system",
    build: (i) => ({
      title: "Энтерпрайз үнийн саналын хүсэлт",
      body: `"${i.orgName ?? ""}" · ${i.moduleCount ?? "0"} модуль сонгосон.`,
      data: { type: "quote_request_created", quoteRequestId: i.quoteRequestId ?? "" },
    }),
    href: (d) =>
      d.quoteRequestId ? `/system/quote-requests/${d.quoteRequestId}` : "/system/quote-requests",
  },
  // Тенант (байгууллага) өөрийн үйлчлүүлэгчиддээ гар аргаар илгээсэн зар/
  // урамшуулал (жишээ нь "20% хямдрал") — `customers.notify` эрхтэй ажилтан
  // л илгээнэ (харах: broadcastTenantPromo, app/_actions/customers.ts).
  // Систем админы broadcast_account-аас тусдаа: энэ зөвхөн ТУХАЙН тенантын
  // үйлчлүүлэгчид (өөр tenant-ийн үйлчлүүлэгч огт хамрагдахгүй) хүрнэ.
  tenant_promo: {
    realm: "account",
    build: (i) => ({
      title: i.title ?? "Мэдэгдэл",
      body: i.body ?? "",
      data: { type: "tenant_promo", tenantId: i.tenantId ?? "" },
    }),
    href: () => "/account/notifications",
  },
  // Систем админаас гар аргаар бичсэн мэдэгдэл — доорх 2 нь зөвхөн хүлээн
  // авагчийн realm-ээрээ ялгаатай, текст нь бүрэн admin-аас ирнэ (fixed
  // template биш) — broadcastNotification (lib/notifications.ts) л дуудна.
  broadcast_staff: {
    realm: "staff",
    build: (i) => ({
      title: i.title ?? "Мэдэгдэл",
      body: i.body ?? "",
      data: { type: "broadcast_staff" },
    }),
    href: () => "/dashboard",
  },
  broadcast_account: {
    realm: "account",
    build: (i) => ({
      title: i.title ?? "Мэдэгдэл",
      body: i.body ?? "",
      data: { type: "broadcast_account" },
    }),
    href: () => "/account/notifications",
  },
};

/** `appointmentId` байвал дэлгэрэнгүй хуудас руу, байхгүй бол "Миний захиалгууд" руу. */
function appointmentHref(data: Record<string, string>): string {
  return data.appointmentId
    ? `/account/appointments/${data.appointmentId}`
    : "/account";
}

/** `orderId` байвал дууссан захиалгын дэлгэрэнгүй хуудас руу, байхгүй бол "Миний захиалгууд" руу. */
function orderHref(data: Record<string, string>): string {
  return data.orderId ? `/account/orders/${data.orderId}` : "/account";
}

// Клиент рүү дамжуулах хялбаршуулсан хэлбэр (server action-ууд буцаана).
export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string;
  read: boolean;
  createdAt: string; // ISO
};

export function toNotificationItem(n: {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Prisma.JsonValue | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationItem {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    href: notificationHref(n.type, n.data),
    read: n.readAt != null,
    createdAt: n.createdAt.toISOString(),
  };
}

// Мобайл (Account) клиент рүү дамжуулах хэлбэр. Вэбийн `href` биш, түүхий
// `data`-г буцаана: апп нь `/account/...` гэсэн вэб замыг ашиглаж чадахгүй,
// deep-link-ээ `data.appointmentId`/`orderId`-аас өөрөө барьдаг (мобайлын
// `router.dart` → `_handleNotificationTap`, push data-тай яг ижил түлхүүр).
export type AccountNotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, string>;
  read: boolean;
  createdAt: string; // ISO
};

export function toAccountNotificationItem(n: {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Prisma.JsonValue | null;
  readAt: Date | null;
  createdAt: Date;
}): AccountNotificationItem {
  // Registry-ийн `data` үргэлж Record<string, string> боловч DB дэх хуучин мөр
  // өөр хэлбэртэй байж болох тул string биш утгыг чимээгүй хаяна — клиент
  // талын parse хатуу байх шаардлагагүй болно.
  const data =
    n.data && typeof n.data === "object" && !Array.isArray(n.data)
      ? Object.fromEntries(
          Object.entries(n.data as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data,
    read: n.readAt != null,
    createdAt: n.createdAt.toISOString(),
  };
}

/** Мэдэгдэл дээр дарахад шилжих холбоос — type болон хадгалсан data-аас. */
export function notificationHref(
  type: string,
  data: Prisma.JsonValue | null,
): string {
  const def = NOTIFICATION_REGISTRY[type as NotificationType];
  if (!def) return "#";
  const obj =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, string>)
      : {};
  return def.href(obj);
}

type Recipient =
  | { userId: string }
  | { accountId: string }
  | { superAdminId: string };

/**
 * Нэг хүлээн авагчид мэдэгдэл үүсгэнэ — эхлээд DB-д хадгална (заавал), дараа нь
 * push илгээнэ (best-effort, алдаа гарвал залгисан урсгалыг таслахгүй).
 * dedupeKey давхцвал чимээгүй алгасна (мэдэгдэл/push давхар үүсэхгүй).
 */
export async function createNotification(args: {
  type: NotificationType;
  recipient: Recipient;
  input: NotificationInput;
  tenantId?: string | null;
}): Promise<void> {
  const def = NOTIFICATION_REGISTRY[args.type];
  const built = def.build(args.input);

  try {
    await prisma.notification.create({
      data: {
        type: args.type,
        title: built.title,
        body: built.body,
        data: built.data,
        dedupeKey: built.dedupeKey ?? null,
        tenantId: args.tenantId ?? null,
        ...("userId" in args.recipient
          ? { userId: args.recipient.userId }
          : "accountId" in args.recipient
            ? { accountId: args.recipient.accountId }
            : { superAdminId: args.recipient.superAdminId }),
      },
    });
  } catch (e) {
    // dedupeKey давхцал — өмнө нь илгээгдсэн тул дахин push хийхгүй.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return;
    }
    throw e;
  }

  const payload = { title: built.title, body: built.body, data: built.data };
  try {
    if ("userId" in args.recipient) {
      await sendPushToUser(args.recipient.userId, payload);
    } else if ("accountId" in args.recipient) {
      await sendPushToAccount(args.recipient.accountId, payload);
    } else {
      await sendPushToSuperAdmin(args.recipient.superAdminId, payload);
    }
  } catch (err) {
    console.warn(`[notify] push (${args.type}):`, err);
  }
}

/**
 * Тенант/салбарт холбогдох ажилтны мэдэгдэл хүлээн авах хүрээ.
 * Эзэн (isOwner) + `appointments.view` эрхтэй идэвхтэй ажилтнууд. Салбарт
 * оноогдсон ажилтан зөвхөн өөрийн салбарын, оноогдоогүй (branchId=null) ба эзэн
 * бүх салбарын мэдэгдэл авна. (lib/auth/roles.ts orderAssignableWhere загвар.)
 */
export function staffRecipientWhere(
  tenantId: string,
  branchId: string,
): Prisma.UserWhereInput {
  return {
    tenantId,
    isActive: true,
    OR: [
      { isOwner: true },
      {
        role: { permissions: { has: "appointments.view" } },
        OR: [{ branchId: null }, { branchId }],
      },
    ],
  };
}

/**
 * Тенант/салбарын холбогдох ажилтнууд бүгдэд нэг мэдэгдэл fan-out хийнэ.
 * DB-д createMany-ээр бичээд, тус бүрд best-effort push илгээнэ.
 */
export async function notifyStaff(args: {
  type: NotificationType;
  tenantId: string;
  branchId: string;
  input: NotificationInput;
}): Promise<void> {
  const recipients = await prisma.user.findMany({
    where: staffRecipientWhere(args.tenantId, args.branchId),
    select: { id: true },
  });
  if (recipients.length === 0) return;

  const def = NOTIFICATION_REGISTRY[args.type];
  const built = def.build(args.input);

  await prisma.notification.createMany({
    data: recipients.map((r) => ({
      type: args.type,
      title: built.title,
      body: built.body,
      data: built.data,
      tenantId: args.tenantId,
      userId: r.id,
    })),
  });

  const payload = { title: built.title, body: built.body, data: built.data };
  await Promise.all(
    recipients.map((r) =>
      sendPushToUser(r.id, payload).catch((err) =>
        console.warn(`[notify] staff push (${args.type}):`, err),
      ),
    ),
  );
}

/**
 * Бүх систем админд (SuperAdmin) нэг мэдэгдэл fan-out хийнэ. `SuperAdmin`-д
 * тенант/эрх/идэвх зэрэг шүүх багана байхгүй тул `staffRecipientWhere`-ийн
 * адил шүүлт алга — бүх мөр хүлээн авна. Cross-tenant (bypass) query.
 */
export async function notifySuperAdmins(args: {
  type: NotificationType;
  input: NotificationInput;
}): Promise<void> {
  setBypassContext();
  const recipients = await prisma.superAdmin.findMany({ select: { id: true } });
  if (recipients.length === 0) return;

  const def = NOTIFICATION_REGISTRY[args.type];
  const built = def.build(args.input);

  await prisma.notification.createMany({
    data: recipients.map((r) => ({
      type: args.type,
      title: built.title,
      body: built.body,
      data: built.data,
      superAdminId: r.id,
    })),
  });

  const payload = { title: built.title, body: built.body, data: built.data };
  await Promise.all(
    recipients.map((r) =>
      sendPushToSuperAdmin(r.id, payload).catch((err) =>
        console.warn(`[notify] superadmin push (${args.type}):`, err),
      ),
    ),
  );
}

const BROADCAST_BATCH_SIZE = 500;

/**
 * Систем админаас бүх ажилтан (User) болон/эсвэл бүх хэрэглэгч (Account) руу
 * гар аргаар мэдэгдэл илгээнэ ("Мэдэгдэл илгээх" хуудас). Cross-tenant тул
 * bypass context — `id`-аар cursor-pagination хийж багц (500)-аар боловсруулна,
 * бүх мөрийг нэг дор санах ойд ачаалахгүй.
 */
export async function broadcastNotification(args: {
  title: string;
  body: string;
  targets: ("staff" | "account")[];
}): Promise<{ staffNotified: number; accountsNotified: number }> {
  setBypassContext();

  const built = { title: args.title, body: args.body, data: {} as Record<string, string> };
  let staffNotified = 0;
  let accountsNotified = 0;

  if (args.targets.includes("staff")) {
    staffNotified = await broadcastToRealm("staff", "broadcast_staff", {
      ...built,
      data: { type: "broadcast_staff" },
    });
  }
  if (args.targets.includes("account")) {
    accountsNotified = await broadcastToRealm("account", "broadcast_account", {
      ...built,
      data: { type: "broadcast_account" },
    });
  }

  return { staffNotified, accountsNotified };
}

async function broadcastToRealm(
  realm: "staff" | "account",
  type: "broadcast_staff" | "broadcast_account",
  built: BuiltNotification,
): Promise<number> {
  const ownerField = realm === "staff" ? "userId" : "accountId";
  let cursor: string | undefined;
  let total = 0;

  for (; ;) {
    const rows =
      realm === "staff"
        ? await prisma.user.findMany({
          select: { id: true },
          take: BROADCAST_BATCH_SIZE,
          orderBy: { id: "asc" },
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        })
        : await prisma.account.findMany({
          select: { id: true },
          take: BROADCAST_BATCH_SIZE,
          orderBy: { id: "asc" },
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
    if (rows.length === 0) break;

    await prisma.notification.createMany({
      data: rows.map((r) => ({
        type,
        title: built.title,
        body: built.body,
        data: built.data,
        [ownerField]: r.id,
      })),
    });

    const ids = rows.map((r) => r.id);
    const tokens = await prisma.device.findMany({
      where: { [ownerField]: { in: ids }, firebaseToken: { not: null } },
      select: { firebaseToken: true },
    });
    try {
      await sendPushToTokens(
        tokens.map((t) => t.firebaseToken).filter((t): t is string => Boolean(t)),
        { title: built.title, body: built.body, data: built.data },
      );
    } catch (err) {
      console.warn(`[notify] broadcast push (${type}):`, err);
    }

    total += rows.length;
    cursor = ids[ids.length - 1];
    if (rows.length < BROADCAST_BATCH_SIZE) break;
  }

  return total;
}

/**
 * Тенант ӨӨРИЙН (зөвхөн тухайн tenantId-тай) онлайн бүртгэлтэй
 * (`Customer.accountId != null`) үйлчлүүлэгчиддээ зар/урамслал илгээнэ —
 * системийн `broadcastNotification`-аас ялгаатай нь ЗӨВХӨН энэ тенантын
 * үйлчлүүлэгчид хүрнэ (бусад tenant-ийн `Customer` мөрөнд хамаарахгүй).
 * Тенант-ийн хэмжээнд ажилладаг тул RLS-г тойрох (`setBypassContext`)
 * шаардлагагүй — дуудагч аль хэдийн тухайн тенантын context-той.
 * `Customer.id`-аар cursor pagination хийж (ENTERPRISE багцын хязгааргүй
 * тенантад ч зохицуулах) 500-аар багцална (broadcastNotification-тэй адил).
 */
export async function broadcastTenantPromo(args: {
  tenantId: string;
  title: string;
  body: string;
}): Promise<number> {
  const built = {
    title: args.title,
    body: args.body,
    data: { type: "tenant_promo", tenantId: args.tenantId } as Record<string, string>,
  };

  let cursor: string | undefined;
  let total = 0;

  for (; ;) {
    const customers = await prisma.customer.findMany({
      where: { tenantId: args.tenantId, accountId: { not: null } },
      select: { id: true, accountId: true },
      take: BROADCAST_BATCH_SIZE,
      orderBy: { id: "asc" },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (customers.length === 0) break;

    const accountIds = customers
      .map((c) => c.accountId)
      .filter((id): id is string => Boolean(id));

    await prisma.notification.createMany({
      data: accountIds.map((accountId) => ({
        type: "tenant_promo",
        title: built.title,
        body: built.body,
        data: built.data,
        tenantId: args.tenantId,
        accountId,
      })),
    });

    const tokens = await prisma.device.findMany({
      where: { accountId: { in: accountIds }, firebaseToken: { not: null } },
      select: { firebaseToken: true },
    });
    try {
      await sendPushToTokens(
        tokens.map((t) => t.firebaseToken).filter((t): t is string => Boolean(t)),
        { title: built.title, body: built.body, data: built.data },
      );
    } catch (err) {
      console.warn("[notify] tenant_promo push:", err);
    }

    total += accountIds.length;
    cursor = customers[customers.length - 1].id;
    if (customers.length < BROADCAST_BATCH_SIZE) break;
  }

  return total;
}
