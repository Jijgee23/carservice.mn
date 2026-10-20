// Flutter аппуудын (staff: ../carcare_service_app, customer: ../carservice_customer)
// launcher icon-ы ЭХ зургуудыг брэнд тэмдгээс (public/brand/mark.svg) үүсгэнэ.
// Дараа нь апп бүрт `dart run flutter_launcher_icons` ажиллуулж iOS AppIcon болон
// Android mipmap (adaptive icon-той) бүх хэмжээг гаргана.
// Хэмжээ/padding нь өмнөх эх зургуудтай ижил (content-ийн эзлэх хувь):
//   staff  app_icon.png            1024, цагаан дэвсгэр (iOS alpha-гүй), тэмдэг 80%
//   staff  app_icon_foreground.png 1024, тунгалаг, тэмдэг 62% (adaptive safe zone)
//   staff  icon.png / logo.png     512 / 1024, тунгалаг тэмдэг (апп доторх лого)
//   cust.  mark-padded.png         1651, тунгалаг, тэмдэг 59% (launcher + Android 12 splash)
//   cust.  mark.png                1024, тунгалаг, тэмдэг 95%
// Ажиллуулах: node scripts/make-app-icons.mjs
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const github = path.resolve(root, "..");
const SVG = path.join(root, "public", "brand", "mark.svg");

async function icon(size, contentRatio, background) {
  const content = Math.round(size * contentRatio);
  const mark = await sharp(SVG, { density: 2400 }).resize(content, content, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const pad = Math.floor((size - content) / 2);
  return sharp({
    create: { width: size, height: size, channels: 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: mark, left: pad, top: pad }])
    .png();
}

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const targets = [
  ["carcare_service_app/asset/icons/app_icon.png", 1024, 0.8, WHITE, true],
  ["carcare_service_app/asset/icons/app_icon_foreground.png", 1024, 0.62],
  ["carcare_service_app/asset/icons/icon.png", 512, 1],
  ["carcare_service_app/asset/icons/logo.png", 1024, 1],
  ["carservice_customer/assets/brand/mark-padded.png", 1651, 0.59],
  ["carservice_customer/assets/brand/mark.png", 1024, 0.95],
];

for (const [rel, size, ratio, bg, opaque] of targets) {
  let img = await icon(size, ratio, bg);
  if (opaque) img = img.flatten({ background: "#FFFFFF" }).removeAlpha();
  await img.toFile(path.join(github, rel));
  console.log(`✓ ../${rel} (${size}px, ${Math.round(ratio * 100)}%)`);
}
