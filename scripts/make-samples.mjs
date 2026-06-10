// Generates sample label images into sample-labels/ using sharp (SVG -> PNG).
//
// Two purposes:
//  1. Give reviewers real images to test the live (API-key) path.
//  2. The "imperfect" variant (rotated, darkened, blurred, glare overlay) lets
//     you see Claude vision recover a poorly-shot photo — the brief's bonus ask.
//
// Filenames embed scenario keywords ("missing-warning", "altered", "glare",
// "import-wine") so they ALSO drive the keyless mock path coherently.
//
// Run: node scripts/make-samples.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "sample-labels");
mkdirSync(OUT, { recursive: true });

const GOV_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not " +
  "drink alcoholic beverages during pregnancy because of the risk of birth " +
  "defects. (2) Consumption of alcoholic beverages impairs your ability to " +
  "drive a car or operate machinery, and may cause health problems.";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function wrap(text, perLine) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > perLine) {
      lines.push(cur.trim());
      cur = w;
    } else cur += " " + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

function labelSVG({ brand, type, alcohol, net, bottler, country, warning, bg = "#f4f1ea", accent = "#7c2d12" }) {
  const warnLines = warning ? wrap(warning, 64) : [];
  const warnTspans = warnLines
    .map((l, i) => `<tspan x="400" dy="${i === 0 ? 0 : 16}">${esc(l)}</tspan>`)
    .join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <rect width="800" height="600" fill="${bg}"/>
  <rect x="20" y="20" width="760" height="560" fill="none" stroke="${accent}" stroke-width="3"/>
  <rect x="32" y="32" width="736" height="536" fill="none" stroke="${accent}" stroke-width="1"/>
  <text x="400" y="120" text-anchor="middle" font-family="Georgia, serif" font-size="44" font-weight="bold" fill="${accent}" letter-spacing="2">${esc(brand)}</text>
  <line x1="200" y1="150" x2="600" y2="150" stroke="${accent}" stroke-width="1"/>
  <text x="400" y="200" text-anchor="middle" font-family="Georgia, serif" font-size="24" fill="#1c1917">${esc(type)}</text>
  ${alcohol ? `<text x="400" y="250" text-anchor="middle" font-family="Georgia, serif" font-size="20" fill="#1c1917">${esc(alcohol)}</text>` : ""}
  ${net ? `<text x="400" y="285" text-anchor="middle" font-family="Georgia, serif" font-size="20" fill="#1c1917">${esc(net)}</text>` : ""}
  ${country ? `<text x="400" y="320" text-anchor="middle" font-family="Georgia, serif" font-size="16" font-style="italic" fill="#1c1917">${esc(country)}</text>` : ""}
  ${bottler ? `<text x="400" y="370" text-anchor="middle" font-family="Georgia, serif" font-size="13" fill="#44403c">${esc(bottler)}</text>` : ""}
  ${warning ? `<text x="400" y="450" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#1c1917">${warnTspans}</text>` : ""}
</svg>`);
}

const SPIRITS = {
  brand: "OLD TOM DISTILLERY",
  type: "Kentucky Straight Bourbon Whiskey",
  alcohol: "45% Alc./Vol. (90 Proof)",
  net: "750 mL",
  bottler: "Distilled & Bottled by Old Tom Distillery, Bardstown, KY",
  warning: GOV_WARNING,
};

async function png(svgConfig, name) {
  await sharp(labelSVG(svgConfig)).png().toFile(join(OUT, name));
  console.log("wrote", name);
}

async function degraded(svgConfig, name) {
  // Simulate a poorly-shot phone photo: rotate, darken, blur, add glare streak.
  const base = await sharp(labelSVG(svgConfig)).resize(800, 600).png().toBuffer();
  const glare = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
       <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0.45" stop-color="white" stop-opacity="0"/>
         <stop offset="0.62" stop-color="white" stop-opacity="0.78"/>
         <stop offset="0.78" stop-color="white" stop-opacity="0"/>
       </linearGradient></defs>
       <rect width="800" height="600" fill="url(#g)"/>
     </svg>`,
  );
  await sharp(base)
    .composite([{ input: glare, blend: "screen" }])
    .modulate({ brightness: 0.72 })
    .blur(1.6)
    .rotate(8, { background: { r: 18, g: 18, b: 18, alpha: 1 } })
    .jpeg({ quality: 70 })
    .toFile(join(OUT, name));
  console.log("wrote", name);
}

await png(SPIRITS, "old-tom-bourbon_compliant.png");
await png({ ...SPIRITS, warning: null }, "old-tom-bourbon_missing-warning.png");
await png(
  { ...SPIRITS, warning: GOV_WARNING.replace("may cause health problems", "is perfectly safe") },
  "old-tom-bourbon_altered-warning.png",
);
await degraded(SPIRITS, "old-tom-bourbon_glare-angle.jpg");
await png(
  {
    brand: "CHÂTEAU EXEMPLE",
    type: "Bordeaux Red Wine",
    alcohol: "13.5% Alc./Vol.",
    net: "750 mL",
    bottler: "Imported by Fine Wines Co., New York, NY",
    country: "Product of France",
    warning: GOV_WARNING,
    bg: "#f7f3ec",
    accent: "#581c47",
  },
  "chateau-exemple_import-wine_compliant.png",
);

console.log("\nDone. Sample labels in", OUT);
