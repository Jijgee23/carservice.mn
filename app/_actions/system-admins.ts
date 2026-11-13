"use server";


import type { ConfirmActionResult } from "@/lib/confirm-action";
import { revalidatePath } from "next/cache";
import { hashPassword } from "@/lib/auth/password";
import { requireSuperAdmin } from "@/lib/auth/system";
import { prisma } from "@/lib/prisma";

export type SuperAdminActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  values?: { email?: string; firstName?: string; lastName?: string };
} | null;

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function createSuperAdminAction(
  _prev: SuperAdminActionState,
  formData: FormData,
): Promise<SuperAdminActionState> {
  const actor = await requireSuperAdmin();

  const email = s(formData, "email");
  const password = s(formData, "password");
  const firstName = s(formData, "firstName");
  const lastName = s(formData, "lastName");
  const values = { email, firstName, lastName };

  const fieldErrors: Record<string, string> = {};
  if (!isEmail(email)) fieldErrors.email = "Имэйл буруу.";
  if (password.length < 8) fieldErrors.password = "Хамгийн багадаа 8 тэмдэгт.";
  if (!firstName) fieldErrors.firstName = "Нэрээ оруулна уу.";
  if (!lastName) fieldErrors.lastName = "Овгоо оруулна уу.";
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors, values };
  }

  const existing = await prisma.superAdmin.findUnique({ where: { email } });
  if (existing) {
    return {
      ok: false,
      fieldErrors: { email: "Энэ имэйлтэй admin бүртгэлтэй байна." },
      values,
    };
  }

  const passwordHash = await hashPassword(password);
  await prisma.superAdmin.create({
    data: { email, firstName, lastName, passwordHash, createdById: actor.id },
  });

  revalidatePath("/system/admins");
  return { ok: true, message: "Шинэ admin амжилттай нэмэгдлээ." };
}

/**
 * Идэвхтэй/идэвхгүй сэлгэнэ (устгахгүй — субьект нь subscriptionsCreated /
 * refundedAppointmentPayments зэрэг түүхэн бичлэгтэй холбогдсон байж болно).
 * Хамгаалалт: өөрийгөө болон хамгийн сүүлийн идэвхтэй admin-ыг идэвхгүй
 * болгож болохгүй (бүрэн түгжигдэхээс сэргийлнэ) — UI дээр товч
 * disabled/нуугдсан байх ёстой ч, серверт давхар шалгана.
 */
export async function setSuperAdminActiveAction(
  formData: FormData,
): Promise<ConfirmActionResult> {
  const actor = await requireSuperAdmin();
  const id = s(formData, "id");
  const active = s(formData, "active") === "1";
  if (!id) return;

  if (!active) {
    if (id === actor.id) {
      return { error: "Өөрийгөө идэвхгүй болгож болохгүй." };
    }
    const activeCount = await prisma.superAdmin.count({
      where: { isActive: true },
    });
    if (activeCount <= 1) {
      return { error: "Хамгийн сүүлийн идэвхтэй admin-ыг идэвхгүй болгож болохгүй." };
    }
  }

  const res = await prisma.superAdmin.updateMany({
    where: { id },
    data: { isActive: active },
  });
  if (res.count === 0) return { error: "Admin олдсонгүй." };
  revalidatePath("/system/admins");
}
