"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/account";
import {
  type NotificationItem,
  toNotificationItem,
} from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { setBypassContext } from "@/lib/tenant-context";

// Үйлчлүүлэгчийн (Account) мэдэгдэлийн server action-ууд. Бүгд нэвтэрсэн Account-ийн
// өөрийн мөрөнд л хандана.
//
// `requireAccount()` нь React `cache()`-тэй тул тухайн request-д зөвхөн нэг л удаа
// бодитоор ажиллана (дараагийн дуудлагууд cache хийгдсэн үр дүнг шууд буцаана) —
// түүний дотор орсон `setBypassContext()` тул зөвхөн эхний дуудлагын async
// continuation-д л context тавигдана. Иймд Account-ийн бусад query-тэй action бүр
// context-оо өөрөө дахин (`requireAccount()`-аас хамааралгүйгээр) тавьж байх ёстой.

export async function getAccountUnreadCount(): Promise<number> {
  const account = await requireAccount();
  setBypassContext();
  return await prisma.notification.count({
    where: { accountId: account.id, readAt: null },
  });
}

export async function getRecentAccountNotifications(): Promise<NotificationItem[]> {
  const account = await requireAccount();
  setBypassContext();
  const rows = await prisma.notification.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return rows.map(toNotificationItem);
}

/** Нэг мэдэгдлийг уншсан болгож, шинэ уншаагүй тоог буцаана. */
export async function markAccountNotificationRead(id: string): Promise<number> {
  const account = await requireAccount();
  setBypassContext();
  await prisma.notification.updateMany({
    where: { id, accountId: account.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/account/notifications");
  return await prisma.notification.count({
    where: { accountId: account.id, readAt: null },
  });
}

export async function markAllAccountNotificationsRead(): Promise<number> {
  const account = await requireAccount();
  setBypassContext();
  await prisma.notification.updateMany({
    where: { accountId: account.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/account/notifications");
  return 0;
}
