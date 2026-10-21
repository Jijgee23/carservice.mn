"use server";

// Системийн (бүх тенантад нийтлэг, тенант засахгүй) сэлбэгийн ангилал —
// Category мөр, tenantId NULL, kind GOODS. RLS-ээр зөвхөн bypass (super admin)
// бичнэ; requireSuperAdmin() bypass context тавьдаг.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/app/generated/prisma/client";
import { requireSuperAdmin } from "@/lib/auth/system";
import { prisma } from "@/lib/prisma";

export type SystemCategoryActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

const SYSTEM_GOODS = { tenantId: null, kind: "GOODS" as const };
const DUPLICATE = "Энэ нэртэй системийн ангилал аль хэдийн бүртгэлтэй байна.";

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
}

function parse(fd: FormData): {
  name: string;
  description: string | null;
  isActive: boolean;
  errors: Record<string, string>;
} {
  const name = s(fd, "name");
  const description = s(fd, "description");
  const isActive = fd.get("isActive") === "on";
  const errors: Record<string, string> = {};

  if (!name) errors.name = "Нэрээ оруулна уу.";
  else if (name.length > 80) errors.name = "Нэр 80 тэмдэгтээс хэтрэхгүй.";
  if (description && description.length > 200)
    errors.description = "Тайлбар 200 тэмдэгтээс хэтрэхгүй.";

  return { name, description: description || null, isActive, errors };
}

// Partial unique index (Category_system_name_key) нь том/жижиг үсэг ялгадаг тул
// урьдчилж case-insensitive шалгана.
async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  const clash = await prisma.category.findFirst({
    where: {
      tenantId: null,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(clash);
}

function revalidate(id?: string) {
  revalidatePath("/system/system-categories");
  if (id) revalidatePath(`/system/system-categories/${id}`);
  revalidatePath("/dashboard/services", "layout");
}

export async function createSystemCategoryAction(
  _prev: SystemCategoryActionState,
  formData: FormData,
): Promise<SystemCategoryActionState> {
  await requireSuperAdmin();

  const { name, description, isActive, errors } = parse(formData);
  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  if (await nameTaken(name)) return { ok: false, fieldErrors: { name: DUPLICATE } };

  try {
    await prisma.category.create({
      data: { name, description, isActive, kind: "GOODS", tenantId: null, systemServiceKeyId: null },
      select: { id: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, fieldErrors: { name: DUPLICATE } };
    }
    return { ok: false, message: e instanceof Error ? e.message : "Үүсгэхэд алдаа гарлаа." };
  }

  revalidate();
  return { ok: true, message: "Үүсгэлээ." };
}

export async function updateSystemCategoryAction(
  id: string,
  _prev: SystemCategoryActionState,
  formData: FormData,
): Promise<SystemCategoryActionState> {
  await requireSuperAdmin();

  const { name, description, isActive, errors } = parse(formData);
  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  if (await nameTaken(name, id)) return { ok: false, fieldErrors: { name: DUPLICATE } };

  try {
    // tenantId: null + kind GOODS — тенантын мөрийг хэзээ ч өөрчлөхгүй.
    const res = await prisma.category.updateMany({
      where: { id, ...SYSTEM_GOODS },
      data: { name, description, isActive },
    });
    if (res.count === 0) return { ok: false, message: "Ангилал олдсонгүй." };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, fieldErrors: { name: DUPLICATE } };
    }
    return { ok: false, message: e instanceof Error ? e.message : "Шинэчлэхэд алдаа гарлаа." };
  }

  revalidate(id);
  return { ok: true, message: "Хадгалагдлаа." };
}

async function systemCategoryUsage(id: string): Promise<number> {
  const c = await prisma.category.findFirst({
    where: { id, ...SYSTEM_GOODS },
    select: {
      _count: {
        select: { services: true, diagnosticTemplates: true, appointments: true, appointmentLinks: true, orderLinks: true },
      },
    },
  });
  if (!c) return 0;
  const n = c._count;
  return n.services + n.diagnosticTemplates + n.appointments + n.appointmentLinks + n.orderLinks;
}

export async function deleteSystemCategoryAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const id = s(formData, "id");
  if (!id) return;

  if ((await systemCategoryUsage(id)) > 0) {
    // Бараа холбогдсон тул устгахгүй — идэвхгүй болгож шинэ сонголтоос нууна.
    await prisma.category.updateMany({ where: { id, ...SYSTEM_GOODS }, data: { isActive: false } });
  } else {
    await prisma.category.deleteMany({ where: { id, ...SYSTEM_GOODS } });
    revalidate();
    redirect("/system/system-categories");
  }

  revalidate(id);
}
