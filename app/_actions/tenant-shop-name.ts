"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export type ShopNameState = { ok: boolean; message?: string } | null;

const NAME_MIN = 2;
const NAME_MAX = 100;

/**
 * Эзэн засварын (харагдах) нэрээ оруулна — хувь хүний регистрээр бүртгүүлсэн
 * байгууллагын нэр нь эзний овог нэр байдаг (app/dashboard/_components/shop-name-gate.tsx).
 * Нэр солигдоход slug (URL) хэвээр — хуучин холбоос эвдрэхгүй.
 */
export async function saveShopNameAction(
  _prev: ShopNameState,
  formData: FormData,
): Promise<ShopNameState> {
  const user = await requireUser();
  if (!user.isOwner) return { ok: false, message: "Зөвхөн байгууллагын эзэн өөрчилнө." };

  const raw = formData.get("shopName");
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (name.length < NAME_MIN) return { ok: false, message: "Засварын нэрээ оруулна уу." };
  if (name.length > NAME_MAX) return { ok: false, message: `Нэр ${NAME_MAX} тэмдэгтээс хэтрэхгүй.` };

  // Тохиргооны маягттай ижил давхцлын шалгалт (lib/tenant-settings.ts).
  const taken = await prisma.tenant.findFirst({
    where: { name, id: { not: user.tenantId } },
    select: { id: true },
  });
  if (taken) {
    return { ok: false, message: "Энэ нэртэй байгууллага аль хэдийн бүртгэлтэй байна. Өөр нэр сонгоно уу." };
  }

  const before = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true } });
  await prisma.tenant.update({
    where: { id: user.tenantId },
    data: { name, shopNameConfirmedAt: new Date() },
  });
  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "Tenant",
    entityId: user.tenantId,
    action: "UPDATE",
    summary: `Засварын нэр: ${name}`,
    before: { name: before?.name ?? null },
    after: { name },
  });

  revalidatePath("/dashboard", "layout");
  revalidatePath("/discover");
  revalidatePath("/book");
  return { ok: true };
}
