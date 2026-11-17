import "server-only";

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
