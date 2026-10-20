// Брэнд тэмдэг (public/brand/mark.svg — vector эх)-ээс raster asset-уудыг үүсгэнэ:
//   - public/brand/mark.png  (тэмдэг дангаараа, 512x512 — vector дэмждэггүй газарт)
//   - app/icon.png           (favicon-ы эх)
// Ажиллуулах: node scripts/make-brand-assets.mjs && node scripts/make-favicons.mjs
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "public", "brand");

/** Тунгалаг захыг тайрч, төвд нь байрлуулсан квадрат PNG буцаана. */
async function toSquare(buffer, size) {
  const trimmed = await sharp(buffer).trim().toBuffer({ resolveWithObject: true });
  const { width, height } = trimmed.info;
  const side = Math.max(width, height);
  return sharp(trimmed.data)
    .extend({
      top: Math.floor((side - height) / 2),
      bottom: Math.ceil((side - height) / 2),
      left: Math.floor((side - width) / 2),
      right: Math.ceil((side - width) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .resize(size, size)
    .png()
    .toBuffer();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // Vector тэмдгийг өндөр density-ээр raster болгож, тайрч/төвлөрүүлж 512x512.
  const svg = path.join(OUT, "mark.svg");
  const mark = await toSquare(await sharp(svg, { density: 1200 }).png().toBuffer(), 512);
  await sharp(mark).toFile(path.join(OUT, "mark.png"));
  console.log("✓ public/brand/mark.png");

  // Favicon-ы эх — тунгалаг дэвсгэртэй тэмдэг.
  await sharp(mark).toFile(path.join(root, "app", "icon.png"));
  console.log("✓ app/icon.png (favicon-ы эх)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
