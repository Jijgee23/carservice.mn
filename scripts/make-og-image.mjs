// Хуваалцах (OpenGraph/Twitter) анхдагч зураг: app/opengraph-image.png (1200×630).
// Лого (public/brand/carservice_mn_logo.svg) + уриа — уриаг IBM Plex Sans-аас
// PATH болгоно (фонт суугаагүй орчинд ч ижил). Next файлын конвенцоор бүх
// хуудсанд og:image болж автоматаар орно.
// Ажиллуулах: node scripts/make-og-image.mjs <IBMPlexSans-Regular.ttf>
// (IBM-ийн бүрэн TTF өгнө үү — .next доторх WOFF2 нь subset тул «ү», «,» дутуу.)
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as fontkit from "fontkit";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const W = 1200;
const H = 630;
const BG = "#F6F5F2";
const MUTED = "#5C6067";
const TAGLINE = "Авто засвар, үйлчилгээний цагийг онлайнаар захиалаарай";

function findPlexSans() {
  const dir = path.join(root, ".next/dev/static/media");
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".woff2"))) {
      try {
        const font = fontkit.openSync(path.join(dir, f));
        if (font.familyName === "IBM Plex Sans" && font.hasGlyphForCodePoint(0x0430)) return path.join(dir, f);
      } catch {}
    }
  }
  throw new Error("IBM Plex Sans (кирилл) фонт олдсонгүй — замыг аргументаар өгнө үү.");
}

const font = fontkit.openSync(process.argv[2] ?? findPlexSans());
const missing = [...new Set(TAGLINE)].filter((ch) => ch !== " " && !font.hasGlyphForCodePoint(ch.codePointAt(0)));
if (missing.length) throw new Error(`Фонтод тэмдэгт дутуу: ${missing.join(" ")} — бүрэн IBMPlexSans-Regular.ttf өгнө үү.`);

function textPath(text, size) {
  const scale = size / font.unitsPerEm;
  const run = font.layout(text);
  let x = 0;
  const parts = [];
  run.glyphs.forEach((g, i) => {
    const pos = run.positions[i];
    const d = g.path.scale(scale, -scale).translate(x + pos.xOffset * scale, 0).toSVG();
    if (d) parts.push(d);
    x += pos.xAdvance * scale;
  });
  return { d: parts.join(" "), width: x };
}

// Лого: viewBox-ийг уншиж, 760px өргөнтэй төвд байрлуулна.
const logo = readFileSync(path.join(root, "public/brand/carservice_mn_logo.svg"), "utf8");
const [, , , vbW, vbH] = logo.match(/viewBox="(\d+) (\d+) ([\d.]+) ([\d.]+)"/).map(Number);
const inner = logo.replace(/^[\s\S]*?<\/title>/, "").replace(/<\/svg>\s*$/, "");
const logoW = 760;
const k = logoW / vbW;
const logoH = vbH * k;
const tag = textPath(TAGLINE, 38);
const gap = 56;
const blockH = logoH + gap + 38;
const top = (H - blockH) / 2;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect x="0" y="${H - 10}" width="${W}" height="10" fill="#22D3EE"/>
  <g transform="translate(${(W - logoW) / 2} ${top}) scale(${k})">${inner}</g>
  <g transform="translate(${(W - tag.width) / 2} ${top + logoH + gap + 30})"><path fill="${MUTED}" d="${tag.d}"/></g>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(path.join(root, "app", "opengraph-image.png"));
writeFileSync(path.join(root, "app", "opengraph-image.alt.txt"), "carservice.mn — авто засвар, үйлчилгээний цагийг онлайнаар захиалах платформ");
console.log("✓ app/opengraph-image.png (1200×630) + alt");
