// src/lib/twemoji.js
//
// Bundled Twemoji artwork for emoji we RASTERIZE into images we distribute
// (share cards). Live UI text keeps using plain Unicode emoji — those render
// with the viewer's own OS font (Apple Color Emoji on iOS, Noto on Android),
// which is licensed to them, not redistributed by us.
//
// The risk we're closing: drawing an emoji with ctx.fillText() on an Apple
// device bakes Apple's proprietary glyph artwork into a PNG that we then save
// and share. Twemoji is the set commercial apps standardise on (Discord,
// WhatsApp Web, and many others) precisely because it's redistributable.
//
// LICENSE — Twemoji graphics © Twitter, Inc and other contributors,
// CC-BY 4.0: https://creativecommons.org/licenses/by/4.0/
// Attribution is required; see ATTRIBUTIONS.md (surface it in an About/Credits
// screen before shipping commercially).
//
// Only the emoji we actually rasterize are bundled — one SVG, inlined as a
// data URI so there's no network fetch and no extra asset request.

// U+1F525 FIRE — simplified from the Twemoji source SVG (viewBox 36x36).
const FIRE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="64" height="64">
<path fill="#F4900C" d="M34.9 24.4c0 8-6.5 10.6-14.5 10.6S5 32.4 5 24.4C5 12.4 15.6 1 20.4 1c-1.6 6 1.6 10 4.6 12.6 3.1 2.7 9.9 5.9 9.9 10.8z"/>
<path fill="#FFCC4D" d="M28.9 27.5c0 5-3.9 7.5-8.7 7.5s-9-2.5-9-7.5c0-7.5 6.9-14 9.4-14-1 3.6.7 6.4 2.5 8 1.9 1.6 5.8 3 5.8 6z"/>
<path fill="#FFF3B8" d="M23.6 30.4c0 2.6-1.8 3.6-4 3.6s-4.2-1-4.2-3.6c0-3.4 3.2-6.4 4.4-6.4-.5 1.7.3 3 1.2 3.7.9.7 2.6 1.4 2.6 2.7z"/>
</svg>`;

const FIRE_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(FIRE_SVG)}`;

export const TWEMOJI = { fire: FIRE_DATA_URI };

/**
 * Decode a bundled Twemoji asset into an <img> ready for ctx.drawImage().
 * Resolves to null on failure — callers MUST fall back to something other than
 * ctx.fillText(<emoji>), so we never rasterize the OS glyph.
 */
export function loadTwemoji(name = 'fire') {
  return new Promise((resolve) => {
    const src = TWEMOJI[name];
    if (!src || typeof Image === 'undefined') { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
