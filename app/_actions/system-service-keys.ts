"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";
import { requireSuperAdmin } from "@/lib/auth/system";
import { prisma } from "@/lib/prisma";
import { type AdminBulkResult, parseAdminBulkInput, runAdminBulk } from "@/lib/system-admin-bulk";

export type ServiceKeyActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
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

export async function createServiceKeyAction(
  _prev: ServiceKeyActionState,
  formData: FormData,
): Promise<ServiceKeyActionState> {
  const actor = await requireSuperAdmin();

  const { name, description, isActive, errors } = parse(formData);
  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };

  try {
    await prisma.systemServiceKey.create({
      data: { name, description, isActive, createdById: actor.id },
      select: { id: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return {
        ok: false,
        fieldErrors: { name: "Энэ нэртэй ажил аль хэдийн бүртгэлтэй байна." },
      };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Үүсгэхэд алдаа гарлаа.",
    };
  }

  revalidatePath("/system/service-keys");
  return { ok: true, message: "Үүсгэлээ." };
}

export async function updateServiceKeyAction(
  id: string,
  _prev: ServiceKeyActionState,
  formData: FormData,
): Promise<ServiceKeyActionState> {
  await requireSuperAdmin();

  const { name, description, isActive, errors } = parse(formData);
  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };

  try {
    await prisma.systemServiceKey.update({
      where: { id },
      data: { name, description, isActive },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return {
        ok: false,
        fieldErrors: { name: "Энэ нэртэй ажил аль хэдийн бүртгэлтэй байна." },
      };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Шинэчлэхэд алдаа гарлаа.",
    };
  }

  revalidatePath("/system/service-keys");
  revalidatePath(`/system/service-keys/${id}`);
  return { ok: true, message: "Хадгалагдлаа." };
}

/**
 * Жагсаалтаас олноор идэвхжүүлэх / идэвхгүй болгох / устгах. Тенантын
 * ангилал холбогдсон түлхүүрийг устгахгүй — идэвхгүй болгоно
 * (deleteServiceKeyAction-тэй ижил дүрэм; FK нь Restrict).
 */
export async function bulkServiceKeysAction(ids: unknown, op: unknown): Promise<AdminBulkResult> {
  await requireSuperAdmin();
  const input = parseAdminBulkInput(ids, op);
  if ("error" in input) return { ok: false, message: input.error };

  const result = await runAdminBulk(
    {
      existing: async (list) =>
        (await prisma.systemServiceKey.findMany({ where: { id: { in: list } }, select: { id: true } })).map((k) => k.id),
      inUse: async (list) => {
        const rows = await prisma.systemServiceKey.findMany({
          where: { id: { in: list } },
          select: { id: true, _count: { select: { categories: true } } },
        });
        return new Set(rows.filter((r) => r._count.categories > 0).map((r) => r.id));
      },
      setActive: async (list, isActive) =>
        (await prisma.systemServiceKey.updateMany({ where: { id: { in: list } }, data: { isActive } })).count,
      remove: async (list) => (await prisma.systemServiceKey.deleteMany({ where: { id: { in: list } } })).count,
    },
    input.ids,
    input.op,
  );
  revalidatePath("/system/service-keys");
  return result;
}

export async function deleteServiceKeyAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const id = s(formData, "id");
  if (!id) return;

  const usedCount = await prisma.category.count({
    where: { systemServiceKeyId: id },
  });

  if (usedCount > 0) {
    // Тенантын Category-нууд аль хэдийн ашиглаж байгаа бол устгахгүй,
    // зөвхөн идэвхгүй болгоно (шинэ Category холбогдохоос сэргийлнэ).
    await prisma.systemServiceKey.update({
      where: { id },
      data: { isActive: false },
    });
  } else {
    await prisma.systemServiceKey.delete({ where: { id } });
  }

  revalidatePath("/system/service-keys");
}
