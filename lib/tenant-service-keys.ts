import "server-only";

import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

// Байгууллагын «танайх ямар үйлчилгээ үзүүлдэг вэ?» сонголт (Tenant.serviceKeys,
// системийн SystemServiceKey). /book, /discover-ийн ажлаар хайлтад ашиглана.

export type ServiceKeyChoice = { id: string; name: string; description: string | null };

export async function loadServiceKeyChoices(tenantId: string): Promise<{
  keys: ServiceKeyChoice[];
  selectedIds: string[];
  confirmed: boolean;
}> {
  const [keys, tenant] = await Promise.all([
    prisma.systemServiceKey.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true },
    }),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { serviceKeysConfirmedAt: true, serviceKeys: { select: { id: true } } },
    }),
  ]);
  return {
    keys,
    selectedIds: tenant?.serviceKeys.map((k) => k.id) ?? [],
    confirmed: tenant?.serviceKeysConfirmedAt != null,
  };
}

/** Эзэн сонголтоо баталгаажуулаагүй бол dashboard-д заавал сонгуулна. */
export async function tenantNeedsServiceKeys(tenantId: string): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { serviceKeysConfirmedAt: true },
  });
  return tenant != null && tenant.serviceKeysConfirmedAt == null;
}

const MAX_KEYS = 100;

/**
 * Байгууллагын үзүүлдэг үйлчилгээг хадгалж serviceKeysConfirmedAt тавина —
 * вэб action (app/_actions/tenant-service-keys.ts) ба PUT /api/v1/tenant/service-keys.
 * Эзэн эсэхийг дуудагч шалгана.
 */
export async function saveTenantServiceKeys(
  actor: { tenantId: string; userId: string },
  rawIds: unknown,
): Promise<{ ok: true; selectedIds: string[] } | { ok: false; message: string }> {
  const requested = Array.isArray(rawIds)
    ? [...new Set(rawIds.filter((v): v is string => typeof v === "string" && v.length > 0))].slice(0, MAX_KEYS)
    : [];
  if (requested.length === 0) return { ok: false, message: "Дор хаяж нэг үйлчилгээ сонгоно уу." };
  // Зөвхөн идэвхтэй системийн төрөл (хуурамч/идэвхгүй id-г алгасна).
  const valid = await prisma.systemServiceKey.findMany({
    where: { id: { in: requested }, isActive: true },
    select: { id: true, name: true },
  });
  if (valid.length === 0) return { ok: false, message: "Дор хаяж нэг үйлчилгээ сонгоно уу." };

  await prisma.tenant.update({
    where: { id: actor.tenantId },
    data: {
      serviceKeys: { set: valid.map((k) => ({ id: k.id })) },
      serviceKeysConfirmedAt: new Date(),
    },
  });
  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.userId,
    entity: "Tenant",
    entityId: actor.tenantId,
    action: "UPDATE",
    summary: `Үзүүлдэг үйлчилгээ: ${valid.map((k) => k.name).join(", ")}`,
  });
  return { ok: true, selectedIds: valid.map((k) => k.id) };
}
