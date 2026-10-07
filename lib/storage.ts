import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
// SVG зориуд хасагдсан: <script> агуулж болох бөгөөд /uploads нь апптай нэг
// origin-оос үйлчлэгддэг тул stored XSS болно. Өмнө нь хадгалсан SVG хэвээр.

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
};

/** Browser-ийн зарласан MIME-д биш, файлын эхний байтад итгэнэ. */
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const PUBLIC_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), "public");

// Прод дээр persistent диск дээрх тусдаа замд (жнь: /var/www/carcare-uploads)
// бичихийн тулд UPLOAD_DIR-г тохируулна. Тохируулаагүй бол dev-ийн адил
// public/uploads-д бичнэ. Symlink-аар public/uploads-г project root-оос
// гадагш чиглүүлэх шаардлагагүй болгоно (Turbopack ийм symlink-г зөвшөөрдөггүй).
const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR)
  : path.join(PUBLIC_DIR, "uploads");

/**
 * `saveUpload`-аас буцсан "/uploads/..." URL замыг диск дээрх бодит
 * файлын замд хөрвүүлнэ (устгах зэрэгт хэрэглэнэ).
 */
export function resolveUploadPath(urlPath: string): string {
  const prefix = "/uploads/";
  if (!urlPath.startsWith(prefix)) {
    throw new Error("Invalid upload path.");
  }

  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.slice(prefix.length));
  } catch {
    throw new Error("Invalid upload path.");
  }
  if (!rel || rel.includes("\0")) throw new Error("Invalid upload path.");

  const segments = rel.split(/[\\/]/);
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Invalid upload path.");
  }

  const resolved = path.resolve(UPLOAD_ROOT, rel);
  const root = path.resolve(UPLOAD_ROOT);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid upload path.");
  }
  return resolved;
}

export type SavedFile = {
  path: string; // /uploads/.../filename.png — энэ нь browser-аас хандах URL
  size: number;
  mime: string;
};

/** Validate an upload without creating a directory or writing a file. */
/** Safe, user-facing file-validation failure (type/size/empty/content); server actions may show its message. */
export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export function validateUpload(file: File): void {
  if (!ALLOWED_MIME.has(file.type)) {
    throw new UploadValidationError("Зөвхөн PNG, JPG, WEBP зураг зөвшөөрөгдөнө.");
  }
  if (file.size > MAX_BYTES) {
    throw new UploadValidationError("Файлын хэмжээ 2MB-аас хэтэрсэн байна.");
  }
  if (file.size === 0) {
    throw new UploadValidationError("Хоосон файл оруулсан байна.");
  }
}

function resolveUploadSubdir(subdir: string): string {
  const segments = subdir.split(/[\\/]/);
  if (
    !subdir ||
    path.isAbsolute(subdir) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("Invalid upload directory.");
  }
  const resolved = path.resolve(UPLOAD_ROOT, subdir);
  const root = path.resolve(UPLOAD_ROOT);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid upload directory.");
  }
  return resolved;
}

/** Delete a previously-created upload URL, restricted to the upload root. */
export async function deleteUpload(urlPath: string): Promise<void> {
  await unlink(resolveUploadPath(urlPath));
}

/**
 * FormData дотроос ирсэн File-г /public/uploads/<subdir>/ дотор хадгална.
 * Validation: mime, хэмжээ.
 */
export async function saveUpload(
  file: File,
  subdir = "logos",
): Promise<SavedFile> {
  validateUpload(file);

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffImageMime(buf);
  if (!mime) {
    throw new UploadValidationError("Зөвхөн PNG, JPG, WEBP зураг зөвшөөрөгдөнө.");
  }
  // Өргөтгөлийг агуулгаас тогтооно (зарласан MIME-ээс биш).
  const name = `${randomBytes(12).toString("hex")}.${EXT_BY_MIME[mime]}`;

  const targetDir = resolveUploadSubdir(subdir);
  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, name), buf);

  return {
    path: `/uploads/${subdir}/${name}`,
    size: file.size,
    mime,
  };
}
