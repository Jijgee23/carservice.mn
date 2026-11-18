"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import { addTenantPhotos, removeTenantPhoto } from "@/lib/tenant-photos";

// Шалгалт + DB логик lib/tenant-photos.ts-д (мобайл API app/api/v1/tenant/photos/** мөн адил кодыг дууддаг).
// Эрх: байгууллагын зураг → зөвхөн эзэн (лого-той адил); салбарын зураг → branches.edit.

export type PhotoActionState = { ok: boolean; message?: string } | null;

const OWNER_ONLY = "Зөвхөн админ байгууллагын зургийг өөрчилнө.";
const NO_BRANCH_PERMISSION = "Салбарын зургийг өөрчлөх эрх байхгүй.";

type Authorized = { tenantId: string; userId: string };

async function authorize(branchId: string | null): Promise<Authorized> {
  const user = await requireUser();
  if (branchId === null) {
    if (!user.isOwner) throw new Error(OWNER_ONLY);
  } else if (!canEdit(user, "branches")) {
    throw new Error(NO_BRANCH_PERMISSION);
  }
  return { tenantId: user.tenantId, userId: user.id };
}

function revalidate(branchId: string | null) {
  revalidatePath(branchId ? `/dashboard/branches/${branchId}` : "/dashboard/settings");
}

export async function addTenantPhotosAction(_prev: PhotoActionState, formData: FormData): Promise<PhotoActionState> {
  const rawBranch = formData.get("branchId");
  const branchId = typeof rawBranch === "string" && rawBranch ? rawBranch : null;

  let actor: Authorized;
  try {
    actor = await authorize(branchId);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const result = await addTenantPhotos(actor, branchId, files);
  if (!result.ok) return { ok: false, message: result.message };

  revalidate(branchId);
  return { ok: true, message: `${result.photos.length} зураг нэмэгдлээ.` };
}

export async function removeTenantPhotoAction(formData: FormData): Promise<void> {
  const photoId = formData.get("photoId");
  if (typeof photoId !== "string" || !photoId) return;

  // Зургийн хамрах хүрээг (байгууллага/салбар) DB-ээс тогтоож, түүнд тохирсон эрхийг шалгана.
  const user = await requireUser();
  const photo = await prisma.tenantPhoto.findFirst({
    where: { id: photoId, tenantId: user.tenantId },
    select: { branchId: true },
  });
  if (!photo) return;
  const actor = await authorize(photo.branchId);
  await removeTenantPhoto(actor, photoId);
  revalidate(photo.branchId);
}
