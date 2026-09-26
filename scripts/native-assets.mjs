#!/usr/bin/env node
// scripts/native-assets.mjs
//
// Builds the SOURCE images @capacitor/assets needs, from public/favicon.svg,
// so the store icons and splash screens are the same mark as the PWA icon
// rather than a second, hand-exported copy that drifts.
//
//   assets/icon-only.png        1024  full tile with embers (iOS icon, legacy Android)
//   assets/icon-foreground.png  1024  mark only, transparent, inside the adaptive safe zone
//   assets/icon-background.png  1024  flat card grey
//   assets/splash.png           2732  mark on the light background
//   assets/splash-dark.png      2732  mark on the dark background
//
// Run:  npm run cap:assets
// It writes those sources, calls @capacitor/assets through npx to generate
// every iOS and Android size into ios/ and android/, then deletes the PWA
// files that tool also writes (icons/ and public/manifest.webmanifest): the
// PWA icons and manifest belong to vite-plugin-pwa, and a second manifest in
// public/ would shadow the generated one. It is deliberately NOT a
// devDependency: it pins an old @capacitor/cli with a vulnerable `tar`, and
// CLAUDE.md holds npm audit at zero. The generated icons are committed, so
// this only needs re-running when the artwork changes.

import sharp from 'sharp';
import { mkdirSync, readFileSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';

const SVG = readFileSync('public/favicon.svg', 'utf8');
const TILE = '#191F24';        // the favicon's own tile colour (card surface)
const SPLASH_LIGHT = '#F8FAFC'; // manifest background_color
const SPLASH_DARK = '#13171B';  // --background in dark mode

// The mark alone: drop the full-bleed tile and the four ember polygons.
function markOnlySvg() {
  const svg = SVG
    .replace(/<rect x="0" y="0" width="491" height="491" fill="#191F24"\/>/, '')
    .replace(/<polygon [^>]*\/>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  if (svg.includes('fill="#191F24"')) throw new Error('tile rect not removed; favicon.svg changed shape');
  return Buffer.from(svg);
}

async function render(svgBuf, size) {
  return sharp(svgBuf, { density: 72 * (size / 491) * 1.02 }).resize(size, size).png().toBuffer();
}

mkdirSync('assets', { recursive: true });

// iOS rejects an icon with an alpha channel, so flatten onto the tile colour.
await sharp(await render(Buffer.from(SVG), 1024)).flatten({ background: TILE }).removeAlpha()
  .toFile('assets/icon-only.png');

// Android adaptive icon. @capacitor/assets insets this layer by 16.7% on
// every side, so the whole image lands inside the 66dp safe zone and a
// launcher mask of any shape cannot reach it. The mark already sits within
// 0.341 of the centre at favicon scale, so it goes in unscaled and reads at
// about the same size as the iOS icon.
await sharp(await render(markOnlySvg(), 1024)).toFile('assets/icon-foreground.png');
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: TILE } }).png()
  .toFile('assets/icon-background.png');

// Splash: the mark at ~15% of the square, which is ~30% of a phone's width once cropped, centred.
async function splash(bg, out) {
  const mark = await render(markOnlySvg(), 800);
  await sharp({ create: { width: 2732, height: 2732, channels: 3, background: bg } })
    .composite([{ input: mark, gravity: 'center' }]).png().toFile(out);
}
await splash(SPLASH_LIGHT, 'assets/splash.png');
await splash(SPLASH_DARK, 'assets/splash-dark.png');

console.log('assets/ sources written.');

const gen = spawnSync('npx', [
  '--yes', '@capacitor/assets@3.0.5', 'generate', '--ios', '--android',
  '--iconBackgroundColor', TILE, '--iconBackgroundColorDark', TILE,
  '--splashBackgroundColor', SPLASH_LIGHT, '--splashBackgroundColorDark', SPLASH_DARK,
], { stdio: 'inherit', shell: process.platform === 'win32' });

for (const stray of ['icons', 'public/manifest.webmanifest']) {
  rmSync(stray, { recursive: true, force: true });
}
process.exit(gen.status ?? 1);
