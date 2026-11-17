"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export type ServiceKeysState = { ok: boolean; message?: string } | null;

const MAX_KEYS = 100;

/**
 * Эзэн байгууллагын үзүүлдэг үйлчилгээний төрлүүдийг хадгална (Tenant.serviceKeys)
 * ба serviceKeysConfirmedAt тавина — dashboard-ын заавал сонгох dialog хаагдана.
 */
export async function saveTenantServiceKeysAction(
  _prev: ServiceKeysState,
  formData: FormData,
): Promise<ServiceKeysState> {
  const user = await requireUser();
  if (!user.isOwner) return { ok: false, message: "Зөвхөн байгууллагын эзэн өөрчилнө." };

  const requested = [
    ...new Set(
      formData
        .getAll("serviceKeyIds")
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  ].slice(0, MAX_KEYS);
  if (requested.length === 0) {
    return { ok: false, message: "Дор хаяж нэг үйлчилгээ сонгоно уу." };
  }
  // Зөвхөн идэвхтэй системийн төрөл (хуурамч/идэвхгүй id-г алгасна).
  const valid = await prisma.systemServiceKey.findMany({
    where: { id: { in: requested }, isActive: true },
    select: { id: true, name: true },
  });
  if (valid.length === 0) {
    return { ok: false, message: "Дор хаяж нэг үйлчилгээ сонгоно уу." };
  }

  await prisma.tenant.update({
    where: { id: user.tenantId },
    data: {
      serviceKeys: { set: valid.map((k) => ({ id: k.id })) },
      serviceKeysConfirmedAt: new Date(),
    },
  });
  await logAudit({
    tenantId: user.tenantId,
    userId: user.id,
    entity: "Tenant",
    entityId: user.tenantId,
    action: "UPDATE",
    summary: `Үзүүлдэг үйлчилгээ: ${valid.map((k) => k.name).join(", ")}`,
  });

  revalidatePath("/dashboard", "layout");
  revalidatePath("/book");
  revalidatePath("/discover");
  return { ok: true, message: "Хадгалагдлаа." };
}
