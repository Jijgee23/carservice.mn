// Цэвэр lockup лого (тэмдэг + «carservice» бичвэр) — бичвэр нь IBM Plex Sans
// Bold-оос PATH болгон хувиргагдсан тул ямар ч төхөөрөмж, фонтгүй орчинд
// (имэйл, баримт, Figma, хэвлэл) яг ижил харагдана.
//   public/brand/carservice_mn_logo.svg       — цайвар дэвсгэрт («car» бараан)
//   public/brand/carservice_mn_logo_dark.svg  — бараан дэвсгэрт («car» цагаан)
// Ажиллуулах: node scripts/make-logo-svg.mjs <IBMPlexSans variable .woff2/.ttf>
// (фонтыг өгөхгүй бол .next/ дотроос автоматаар хайна)
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as fontkit from "fontkit";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "public", "brand");

function findPlexSans() {
  for (const dir of [".next/dev/static/media", ".next/static/media"].map((d) => path.join(root, d))) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".woff2"))) {
      try {
        const font = fontkit.openSync(path.join(dir, f));
        if (font.familyName === "IBM Plex Sans" && font.variationAxes?.wght && font.hasGlyphForCodePoint(0x63)) {
          return path.join(dir, f);
        }
      } catch {}
    }
  }
  throw new Error("IBM Plex Sans фонт олдсонгүй — замыг аргументаар өгнө үү.");
}

const fontPath = process.argv[2] ?? findPlexSans();
const base = fontkit.openSync(fontPath);
// Static Bold файл (IBMPlexSans-Bold.ttf) өгөх нь найдвартай — fontkit WOFF2
// variable фонтоос жин гаргаж чаддаггүй.
const font = base;
if (base.variationAxes?.wght) console.warn("! variable фонт — Regular жингээр гарна; IBMPlexSans-Bold.ttf өгнө үү.");

// Тэмдэг (38×38) — public/brand/mark.svg-ийн path-ууд.
const markSvg = readFileSync(path.join(OUT, "mark.svg"), "utf8");
const markPaths = [...markSvg.matchAll(/<path[^>]*\/>/g)].map((m) => m[0]);

const MARK = 38;
const FONT_SIZE = 22; // sidebar-ын харьцаа: 32px тэмдэг ↔ 18px bold бичвэр
const GAP = 9;
const scale = FONT_SIZE / font.unitsPerEm;

function runPath(text, x0) {
  const run = font.layout(text);
  let x = x0;
  const parts = [];
  for (let i = 0; i < run.glyphs.length; i++) {
    const g = run.glyphs[i];
    const pos = run.positions[i];
    const d = g.path
      .scale(scale, -scale)
      .translate(x + pos.xOffset * scale, -pos.yOffset * scale)
      .toSVG();
    if (d) parts.push(d);
    x += pos.xAdvance * scale;
  }
  return { d: parts.join(" "), end: x, bbox: run.bbox };
}

const car = runPath("car", MARK + GAP);
const service = runPath("service", car.end);
// Бичвэрийн бэх (ink)-ийг тэмдгийн босоо голд тэгшилнэ (baseline = 0 → доош шилжүүлнэ).
const top = Math.max(car.bbox.maxY, service.bbox.maxY) * scale;
const bottom = Math.min(car.bbox.minY, service.bbox.minY) * scale;
const baseline = MARK / 2 + (top + bottom) / 2;
const width = Math.ceil(service.end + 1);

function svg({ carColor, serviceColor }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * 4}" height="${MARK * 4}" viewBox="0 0 ${width} ${MARK}" fill="none" role="img" aria-label="carservice">
  <title>carservice</title>
  <g>
    ${markPaths.join("\n    ")}
  </g>
  <g transform="translate(0 ${baseline.toFixed(3)})">
    <path fill="${carColor}" d="${car.d}"/>
    <path fill="${serviceColor}" d="${service.d}"/>
  </g>
</svg>
`;
}

const CYAN = "#22D3EE";
writeFileSync(path.join(OUT, "carservice_mn_logo.svg"), svg({ carColor: "#16171B", serviceColor: CYAN }));
writeFileSync(path.join(OUT, "carservice_mn_logo_dark.svg"), svg({ carColor: "#FFFFFF", serviceColor: CYAN }));
console.log(`✓ public/brand/carservice_mn_logo.svg (+ _dark) — ${width}×${MARK}, font ${font.fullName}`);
