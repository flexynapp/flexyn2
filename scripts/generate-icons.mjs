#!/usr/bin/env node
// scripts/generate-icons.mjs
//
// Regenerates the install-icon PNGs from a single SVG source:
//   • public/apple-touch-icon.png  — 180×180, iOS PWA install
//   • public/icon-192.png          — 192×192, Android PWA install (manifest)
//   • public/icon-512.png          — 512×512, Android splash + Play Store
//
// Run:  node scripts/generate-icons.mjs
//
// Single source of truth is the gradient + 'F' wordmark below. Keep
// the gradient in sync with public/favicon.svg (the tab favicon) so
// the home-screen install icon matches the in-browser favicon.

import sharp from 'sharp';
import { writeFileSync } from 'fs';

const ORANGE_LIGHT = '#fb923c';
const ORANGE_DARK  = '#f97316';

function makeSvg(size, fontSize, cornerRadius) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${ORANGE_LIGHT}"/>
        <stop offset="100%" stop-color="${ORANGE_DARK}"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" rx="${cornerRadius}" fill="url(#g)"/>
    <text x="50%" y="58%" font-family="system-ui, -apple-system, sans-serif" font-weight="900"
          font-size="${fontSize}" fill="#fff" text-anchor="middle" dominant-baseline="middle">F</text>
  </svg>`;
}

const variants = [
  { out: 'public/apple-touch-icon.png', size: 180, fontSize: 120, radius: 40  },
  { out: 'public/icon-192.png',         size: 192, fontSize: 128, radius: 43  },
  { out: 'public/icon-512.png',         size: 512, fontSize: 340, radius: 112 },
];

for (const v of variants) {
  const svg = makeSvg(v.size, v.fontSize, v.radius);
  await sharp(Buffer.from(svg)).resize(v.size, v.size).png().toFile(v.out);
  console.log(`✓ ${v.out}`);
}
