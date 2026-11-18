"use server";


import type { ConfirmActionResult } from "@/lib/confirm-action";
import { revalidatePath } from "next/cache";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllSystemRefreshTokens } from "@/lib/auth/system-refresh-token";
import { requireSuperAdmin } from "@/lib/auth/system";
import { prisma } from "@/lib/prisma";

export type SuperAdminActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  values?: { email?: string; firstName?: string; lastName?: string; kind?: string };
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
  // ROOT = бүрэн админ (вэб + мобайл); STAFF = «System ажилтан» — зөвхөн мобайл апп-аар харилцагч бүртгэх/засах.
  const kind = s(formData, "kind") === "STAFF" ? "STAFF" : "ROOT";
  const values = { email, firstName, lastName, kind };

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
    data: { email, firstName, lastName, passwordHash, kind, createdById: actor.id },
  });

  revalidatePath("/system/admins");
  return {
    ok: true,
    message: kind === "STAFF" ? "Шинэ System ажилтан нэмэгдлээ. Мобайл апп-аар нэвтэрнэ." : "Шинэ admin амжилттай нэмэгдлээ.",
  };
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
    // Вэбийн удирдлагыг зөвхөн ROOT хийдэг тул «сүлжээнд үлдэх ROOT» тоолно: STAFF-ийг тоолбол сүүлийн ROOT-ыг
    // идэвхгүй болгоод платформыг удирдах хүнгүй болно. STAFF-ийг идэвхгүй болгоход энэ хязгаар хамаарахгүй.
    const target = await prisma.superAdmin.findUnique({ where: { id }, select: { kind: true } });
    if (target?.kind === "ROOT") {
      const activeRoots = await prisma.superAdmin.count({ where: { isActive: true, kind: "ROOT" } });
      if (activeRoots <= 1) {
        return { error: "Хамгийн сүүлийн идэвхтэй admin-ыг идэвхгүй болгож болохгүй." };
      }
    }
  }

  const res = await prisma.superAdmin.updateMany({
    where: { id },
    data: { isActive: active },
  });
  if (res.count === 0) return { error: "Admin олдсонгүй." };
  // Идэвхгүй болгосон админы мобайл refresh token-ууд шууд хүчингүй (access token нь DB-ээс isActive шалгадаг).
  if (!active) await revokeAllSystemRefreshTokens(id);
  revalidatePath("/system/admins");
}

/**
 * Root «System ажилтан»-ы нууц үгийг шинээр тохируулна (мартсан/түгжигдсэн үед). Зөвхөн STAFF: ROOT-ийн нууц үгийг
 * өөр ROOT солихыг энд зөвшөөрөхгүй (эрх шилжүүлэлтээс сэргийлнэ). Ажилтны бүх мобайл төхөөрөмж гарч (refresh token
 * revoke, access token-ы `pv` өөрчлөгдөнө), түгжээ цэвэрлэгдэнэ.
 */
export async function resetStaffPasswordAction(
  _prev: SuperAdminActionState,
  formData: FormData,
): Promise<SuperAdminActionState> {
  await requireSuperAdmin();
  const id = s(formData, "id");
  const password = s(formData, "password");
  if (!id) return { ok: false, message: "Ажилтан олдсонгүй." };
  if (password.length < 8) return { ok: false, fieldErrors: { password: "Хамгийн багадаа 8 тэмдэгт." } };

  const target = await prisma.superAdmin.findUnique({ where: { id }, select: { id: true, kind: true } });
  if (!target) return { ok: false, message: "Ажилтан олдсонгүй." };
  if (target.kind !== "STAFF") {
    return { ok: false, message: "Зөвхөн System ажилтны нууц үгийг энд сэргээнэ." };
  }

  await prisma.superAdmin.update({
    where: { id },
    data: { passwordHash: await hashPassword(password), failedLoginAttempts: 0, lockedUntil: null },
  });
  await revokeAllSystemRefreshTokens(id);
  revalidatePath("/system/admins");
  return { ok: true, message: "Нууц үг шинэчлэгдлээ. Ажилтан бүх төхөөрөмжөөс гарсан." };
}
