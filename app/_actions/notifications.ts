"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  type NotificationItem,
  toNotificationItem,
} from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { setTenantContext } from "@/lib/tenant-context";

// Ажилтны (User) мэдэгдэлийн server action-ууд. Бүгд өөрийн (нэвтэрсэн) мөрөнд л
// хандана — тенант хоорондын тусгаарлал requireUser-ээр хангагдана.
//
// requireUser() нь cache()-тэй бөгөөд context-оо өөрийн async frame дотор тавьдаг тул энд (дуудагч талд) дахин
// тавина — үгүй бол прод дээр «Tenant context тохируулагдаагүй (Notification.count)» гарч, мэдэгдлийн хонхны
// POST хүсэлтүүд 500 өгч байсан (account-notifications.ts-тэй ижил засвар).

export async function getStaffUnreadCount(): Promise<number> {
  const user = await requireUser();
  setTenantContext(user.tenantId);
  return prisma.notification.count({
    where: { userId: user.id, readAt: null },
  });
}

export async function getRecentStaffNotifications(): Promise<NotificationItem[]> {
  const user = await requireUser();
  setTenantContext(user.tenantId);
  const rows = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return rows.map(toNotificationItem);
}

/** Нэг мэдэгдлийг уншсан болгож, шинэ уншаагүй тоог буцаана. */
export async function markStaffNotificationRead(id: string): Promise<number> {
  const user = await requireUser();
  setTenantContext(user.tenantId);
  await prisma.notification.updateMany({
    where: { id, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/dashboard/notifications");
  return prisma.notification.count({
    where: { userId: user.id, readAt: null },
  });
}

export async function markAllStaffNotificationsRead(): Promise<number> {
  const user = await requireUser();
  setTenantContext(user.tenantId);
  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/dashboard/notifications");
  return 0;
}
