// Browser-only: утасны том зургийг серверт илгээхээс өмнө жижигрүүлнэ.
// Сервер файл бүрийг 2MB (lib/storage.ts), server action-ийн нийт хүсэлтийг
// 4MB (next.config.ts bodySizeLimit) хүртэл хүлээн авдаг — камерын 3–8MB зураг
// шахалгүйгээр унадаг. 1600px, JPEG 0.82 ≈ 200–400KB.

export const MAX_IMAGE_EDGE = 1600;
const JPEG_QUALITY = 0.82;
export const COMPRESS_FAILED = "compress failed";

// Үүнээс жижиг, хэмжээс нь хэтрээгүй зургийг хөндөхгүй (жижиг PNG гарын үсэг г.м.).
const SKIP_BELOW_BYTES = 400 * 1024;

const COMPRESSIBLE = /^image\/(jpeg|png|webp|heic|heif)$/i;

/** Зургийг MAX_IMAGE_EDGE хүртэл багасгаж JPEG болгоно. Тунгалаг хэсгийг цагаанаар дүүргэнэ. */
export async function compressImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(COMPRESS_FAILED);
  });
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  // PNG гарын үсэг тунгалаг байдаг — JPEG-д хар дэвсгэр болохоос сэргийлнэ.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new Error(COMPRESS_FAILED);
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

/**
 * FormData доторх бүх зургийн файлыг (шаардлагатай бол) шахсан хувилбараар
 * солино. Шахаж чадаагүй файлыг хэвээр үлдээнэ — сервер өөрөө тайлбартай
 * алдаа буцаана.
 */
export async function compressFormDataImages(fd: FormData): Promise<void> {
  const entries = Array.from(fd.entries());
  const replaced = await Promise.all(
    entries.map(async ([key, value]) => {
      if (!(value instanceof File) || value.size === 0 || !COMPRESSIBLE.test(value.type)) {
        return [key, value] as const;
      }
      if (value.size < SKIP_BELOW_BYTES && !/heic|heif/i.test(value.type)) return [key, value] as const;
      try {
        return [key, await compressImage(value)] as const;
      } catch {
        return [key, value] as const;
      }
    }),
  );
  for (const key of new Set(entries.map(([k]) => k))) fd.delete(key);
  for (const [key, value] of replaced) fd.append(key, value);
}
