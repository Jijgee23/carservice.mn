"use server";


import { isForeignKeyViolation } from "@/lib/prisma-errors";
import type { ConfirmActionResult } from "@/lib/confirm-action";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/system";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { activateTenant, suspendTenant } from "@/lib/system/tenants";

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function suspendTenantAction(formData: FormData): Promise<ConfirmActionResult> {
  await requireSuperAdmin();
  const id = s(formData, "id");
  if (!id) return;
  // Логик нь lib/system/tenants.ts-д (мобайл POST /api/v1/system/tenants/[id]/suspend-тэй нэг).
  const res = await suspendTenant(id);
  if (!res.ok) return { error: "Байгууллага олдсонгүй." };
  revalidatePath("/system/tenants");
  revalidatePath(`/system/tenants/${id}`);
  revalidatePath("/system");
}

export async function activateTenantAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const id = s(formData, "id");
  if (!id) return;
  // Credit-ээр зогсоосон байгууллагыг гараар сэргээвэл админы шийдвэр давуу (creditExempt) — lib/system/tenants.ts.
  const res = await activateTenant(id);
  if (!res.ok) return; // энгийн form action (void) — олдохгүй бол чимээгүй буцна
  revalidatePath("/system/tenants");
  revalidatePath(`/system/tenants/${id}`);
  revalidatePath("/system");
}

/**
 * Тест/демо тенант (isTest) асаах/унтраах — зөвхөн super admin. Тест тенант
 * олон нийтэд харагдахгүй, онлайн захиалга авахгүй, системийн статистикаас
 * хасагдана (lib/tenant-visibility.ts). Ажилтны тал хэвийн ажиллана.
 */
export async function setTenantTestAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const id = s(formData, "id");
  if (!id) return;
  const isTest = s(formData, "isTest") === "on";
  const before = await prisma.tenant.findUnique({ where: { id }, select: { isTest: true } });
  if (!before || before.isTest === isTest) return;
  await prisma.tenant.update({ where: { id }, data: { isTest } });
  await logAudit({
    tenantId: id,
    entity: "Tenant",
    entityId: id,
    action: "UPDATE",
    summary: isTest ? "Тест тенант болгов (super admin)" : "Тест тенант тэмдгийг арилгав (super admin)",
    before: { isTest: before.isTest },
    after: { isTest },
  });
  revalidatePath("/system/tenants");
  revalidatePath(`/system/tenants/${id}`);
  revalidatePath("/system");
  revalidatePath("/discover");
}

export async function changeTenantPlanAction(formData: FormData): Promise<ConfirmActionResult> {
  await requireSuperAdmin();
  const id = s(formData, "id");
  const plan = s(formData, "plan");
  if (!id) return;
  if (!["FREE", "BUSINESS", "ENTERPRISE"].includes(plan)) {
    return { error: "Багц буруу." };
  }
  const res = await prisma.tenant.updateMany({
    where: { id },
    data: { plan: plan as "FREE" | "BUSINESS" | "ENTERPRISE" },
  });
  if (res.count === 0) return { error: "Байгууллага олдсонгүй." };
  revalidatePath("/system/tenants");
  revalidatePath(`/system/tenants/${id}`);
  revalidatePath("/system");
}

export async function deleteTenantAction(formData: FormData): Promise<ConfirmActionResult> {
  await requireSuperAdmin();
  const id = s(formData, "id");
  const confirm = s(formData, "confirmName");
  if (!id) return;

  const tenant = await prisma.tenant.findUnique({
    where: { id },
    select: { name: true },
  });
  if (!tenant) return { error: "Байгууллага олдсонгүй." };
  if (confirm !== tenant.name) {
    return { error: "Баталгаажуулалт буруу. Байгууллагын нэрийг яг адил бичнэ үү." };
  }

  try {
    await prisma.tenant.delete({ where: { id } });
  } catch (e) {
    if (isForeignKeyViolation(e)) {
      return { error: "Энэ байгууллага санхүү/аудитын түүхтэй (төлбөр, лог) тул устгах боломжгүй. Оронд нь идэвхгүй болгоно уу." };
    }
    throw e;
  }
  revalidatePath("/system/tenants");
  revalidatePath("/system");
  redirect("/system/tenants");
}
