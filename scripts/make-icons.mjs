// Generates PWA icons (original mark: an auction paddle) from inline SVG with sharp.
// Usage: node scripts/make-icons.mjs
import sharp from "sharp";
import fs from "node:fs";

const mark = (pad) => `
<g transform="translate(${pad} ${pad}) scale(${(512 - 2 * pad) / 512})">
  <rect x="236" y="300" width="40" height="150" rx="18" fill="#faf9f5"/>
  <circle cx="256" cy="190" r="112" fill="#c15f3c"/>
  <circle cx="256" cy="190" r="112" fill="none" stroke="#faf9f5" stroke-width="12"/>
  <rect x="226" y="160" width="60" height="60" rx="8" transform="rotate(45 256 190)" fill="#faf9f5"/>
</g>`;
const svg = (pad, round) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" ${round ? 'rx="104"' : ""} fill="#141413"/>${mark(pad)}</svg>`;

fs.mkdirSync("public/icons", { recursive: true });
fs.writeFileSync("public/icons/icon.svg", svg(40, true));
const out = async (name, size, pad, round) => sharp(Buffer.from(svg(pad, round))).resize(size, size).png().toFile(`public/icons/${name}`);
await out("icon-192.png", 192, 40, true);
await out("icon-512.png", 512, 40, true);
await out("maskable-512.png", 512, 100, false); // full-bleed, mark inside the safe zone
await out("apple-touch-icon.png", 180, 50, false);
console.log("icons written");
