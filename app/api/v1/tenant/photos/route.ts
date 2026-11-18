// Contract — GET/POST /api/v1/tenant/photos (байгууллага / салбарын зургийн сан)
//
// Логикийг web action (app/_actions/tenant-photos.ts)-тай хуваалцана — lib/tenant-photos.ts. Файлын шалгалт
// lib/storage.ts: PNG/JPG/WEBP, зураг бүр 2MB хүртэл, агуулгаар (magic bytes). Нэг орон зайд (байгууллага эсвэл
// нэг салбар) 12 хүртэл зураг, нэг хүсэлтэд 6 хүртэл файл. Зураг олон нийтийн хуудас, хэрэглэгчийн апп-д харагдана.
//
// GET /api/v1/tenant/photos[?branchId=]
//   branchId байхгүй → байгууллагын нийтлэг зураг; байвал тухайн салбарын зураг. Нэвтэрсэн бүх ажилтан уншина.
//   200: { photos: [{ id, url, branchId }], limits: { maxPerScope, maxPerUpload } }
//
// POST /api/v1/tenant/photos
//   Body: multipart/form-data — `files` (олон) эсвэл `file` (ганц), заавал биш `branchId`.
//   Эрх: branchId байхгүй → зөвхөн эзэмшигч; branchId байвал `branches.edit`.
//   201: { photos: [{ id, url, branchId }] }
//   Алдаа: 400 VALIDATION (файл/төрөл/хэмжээ), 401, 403, 404 (салбар), 409 LIMIT (дээд тоо).

import { jsonError, jsonForbidden, jsonOk, requireApiUser, requirePermission } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { addTenantPhotos, listTenantPhotos, MAX_FILES_PER_UPLOAD, MAX_PHOTOS_PER_SCOPE } from "@/lib/tenant-photos";

const LIMITS = { maxPerScope: MAX_PHOTOS_PER_SCOPE, maxPerUpload: MAX_FILES_PER_UPLOAD };

export async function GET(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;

  const branchId = new URL(req.url).searchParams.get("branchId") || null;
  if (branchId) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, tenantId: auth.user.tenantId }, select: { id: true } });
    if (!branch) return jsonError(404, "Салбар олдсонгүй.", { code: "NOT_FOUND" });
  }
  const photos = await listTenantPhotos(auth.user.tenantId, branchId);
  return jsonOk({ photos, limits: LIMITS });
}

export async function POST(req: Request) {
  const auth = await requireApiUser(req);
  if (auth.response) return auth.response;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonError(400, "Multipart form-data илгээнэ үү.");
  }

  const rawBranch = formData.get("branchId");
  const branchId = typeof rawBranch === "string" && rawBranch ? rawBranch : null;
  if (branchId === null) {
    if (!auth.user.isOwner) return jsonForbidden("Зөвхөн админ байгууллагын зургийг өөрчилнө.");
  } else {
    const denied = requirePermission(auth.user, "branches.edit");
    if (denied) return denied;
  }

  const files = [...formData.getAll("files"), ...formData.getAll("file")].filter((f): f is File => f instanceof File && f.size > 0);
  const result = await addTenantPhotos({ tenantId: auth.user.tenantId, userId: auth.user.id }, branchId, files);
  if (!result.ok) {
    const status = result.kind === "NOT_FOUND" ? 404 : result.kind === "LIMIT" ? 409 : result.kind === "VALIDATION" ? 400 : 500;
    const code = result.kind === "ERROR" ? "SERVER_ERROR" : result.kind;
    return jsonError(status, result.message, { code, ...(status === 400 ? { fieldErrors: { files: result.message } } : {}) });
  }
  return jsonOk({ photos: result.photos }, { status: 201 });
}
