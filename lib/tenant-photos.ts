import "server-only";

// Байгууллага / салбарын зургийн сан. Вэбийн server action (app/_actions/tenant-photos.ts) болон мобайл API
// (app/api/v1/tenant/photos/**) хоёул энд дуудна. branchId = null → байгууллагын нийтлэг зураг.
// Файлын шалгалт lib/storage.ts (PNG/JPG/WEBP, 2MB, агуулгаар). RLS: async helper дотор `return await prisma…`.

import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { deleteUpload, saveUpload, UploadValidationError } from "@/lib/storage";

/** Нэг «орон зай» (байгууллага эсвэл нэг салбар) дахь зургийн дээд тоо. */
export const MAX_PHOTOS_PER_SCOPE = 12;
/** Нэг хүсэлтээр оруулах файлын дээд тоо. */
export const MAX_FILES_PER_UPLOAD = 6;

export type PhotoActor = { tenantId: string; userId: string };

export type PhotoDto = { id: string; url: string; branchId: string | null };

export type PhotoFailure = {
  ok: false;
  kind: "VALIDATION" | "NOT_FOUND" | "LIMIT" | "ERROR";
  message: string;
};

const SELECT = { id: true, url: true, branchId: true } as const;

/** Нэг орон зайн зургууд (эрэмбээр). Дуудагч tenant-аа өөрөө баталгаажуулсан байх ёстой. */
export async function listTenantPhotos(tenantId: string, branchId: string | null): Promise<PhotoDto[]> {
  return await prisma.tenantPhoto.findMany({
    where: { tenantId, branchId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: SELECT,
  });
}

/**
 * Файлуудыг хадгалж зургийн санд нэмнэ. Бүгд шалгагдсаны дараа л бичнэ (нэг нь буруу бол юу ч хадгалахгүй);
 * DB бичилт унавал хадгалсан файлуудыг буцааж устгана.
 */
export async function addTenantPhotos(
  actor: PhotoActor,
  branchId: string | null,
  files: File[],
): Promise<{ ok: true; photos: PhotoDto[] } | PhotoFailure> {
  const valid = files.filter((f) => f instanceof File && f.size > 0);
  if (valid.length === 0) return { ok: false, kind: "VALIDATION", message: "Зураг сонгоно уу." };
  if (valid.length > MAX_FILES_PER_UPLOAD) {
    return { ok: false, kind: "VALIDATION", message: `Нэг удаад хамгийн ихдээ ${MAX_FILES_PER_UPLOAD} зураг оруулна.` };
  }

  let branchName: string | null = null;
  if (branchId) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, tenantId: actor.tenantId }, select: { name: true } });
    if (!branch) return { ok: false, kind: "NOT_FOUND", message: "Салбар олдсонгүй." };
    branchName = branch.name;
  }

  const existing = await prisma.tenantPhoto.aggregate({
    where: { tenantId: actor.tenantId, branchId },
    _count: { _all: true },
    _max: { sortOrder: true },
  });
  if (existing._count._all + valid.length > MAX_PHOTOS_PER_SCOPE) {
    return {
      ok: false,
      kind: "LIMIT",
      message: `Хамгийн ихдээ ${MAX_PHOTOS_PER_SCOPE} зураг. Одоо ${existing._count._all} байна.`,
    };
  }

  const savedPaths: string[] = [];
  try {
    for (const file of valid) {
      const saved = await saveUpload(file, "gallery");
      savedPaths.push(saved.path);
    }
    const base = (existing._max.sortOrder ?? -1) + 1;
    const photos: PhotoDto[] = [];
    for (const [i, url] of savedPaths.entries()) {
      photos.push(
        await prisma.tenantPhoto.create({
          data: { tenantId: actor.tenantId, branchId, url, sortOrder: base + i },
          select: SELECT,
        }),
      );
    }
    await logAudit({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entity: branchId ? "Branch" : "Tenant",
      entityId: branchId ?? actor.tenantId,
      action: "UPDATE",
      summary: `${branchName ? `Салбарын (${branchName})` : "Байгууллагын"} зураг нэмэв: ${photos.length}`,
      after: { photoIds: photos.map((p) => p.id) },
    });
    return { ok: true, photos };
  } catch (e) {
    // Хэсэгчлэн хадгалагдсан файл, мөрийг цэвэрлэнэ.
    await prisma.tenantPhoto.deleteMany({ where: { tenantId: actor.tenantId, url: { in: savedPaths } } });
    await Promise.all(savedPaths.map((p) => deleteUpload(p).catch(() => undefined)));
    if (e instanceof UploadValidationError) return { ok: false, kind: "VALIDATION", message: e.message };
    console.warn("[tenant-photos] add failed:", e instanceof Error ? e.name : e);
    return { ok: false, kind: "ERROR", message: "Зураг хадгалахад алдаа гарлаа." };
  }
}

/** Зураг устгана (мөр + файл). Өөр tenant-ийн зураг олдохгүй. */
export async function removeTenantPhoto(
  actor: PhotoActor,
  photoId: string,
  scope?: { branchId: string | null },
): Promise<{ ok: true } | PhotoFailure> {
  const photo = await prisma.tenantPhoto.findFirst({
    where: { id: photoId, tenantId: actor.tenantId, ...(scope ? { branchId: scope.branchId } : {}) },
    select: { id: true, url: true, branchId: true },
  });
  if (!photo) return { ok: false, kind: "NOT_FOUND", message: "Зураг олдсонгүй." };

  await prisma.tenantPhoto.deleteMany({ where: { id: photo.id, tenantId: actor.tenantId } });
  try {
    await deleteUpload(photo.url);
  } catch {
    // файл байхгүй ч асуудалгүй
  }
  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.userId,
    entity: photo.branchId ? "Branch" : "Tenant",
    entityId: photo.branchId ?? actor.tenantId,
    action: "UPDATE",
    summary: `${photo.branchId ? "Салбарын" : "Байгууллагын"} зураг устгав`,
    after: { photoId: photo.id },
  });
  return { ok: true };
}
