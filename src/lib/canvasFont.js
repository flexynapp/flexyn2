// src/lib/canvasFont.js
//
// Brand type for <canvas>. Canvas cannot read CSS variables, so the four
// share cards drew in the system stack for as long as the app had a brand
// face (53 literal ctx.font strings, baselined in the ui-ratchet). This reads
// the same --font-* token the page uses, so a card moves with the brand font
// instead of being edited by hand when it changes.
//
// A canvas also draws with whatever the browser has at that instant: a face
// that has not loaded yet is silently replaced by the fallback and the card
// is rasterised that way for good. canvasFontsReady() waits for the weights
// the cards use, capped so a slow or blocked font can never hold the card up.

const FALLBACK = 'system-ui, -apple-system, sans-serif';

function token(face) {
  if (typeof document === 'undefined') return FALLBACK;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(`--font-${face}`).trim();
    return v || FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/** `canvasFont('bold 24px')` → `'bold 24px "Sofia Sans", …'`, from --font-heading. */
export function canvasFont(weightAndSize, face = 'heading') {
  return `${weightAndSize} ${token(face)}`;
}

/** Resolves once the card weights are loaded, or after `timeoutMs`, whichever is first. Never rejects. */
export function canvasFontsReady(timeoutMs = 1500) {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  const family = token('heading');
  const loads = Promise.all([
    document.fonts.load(`400 24px ${family}`),
    document.fonts.load(`700 24px ${family}`),
  ]).catch(() => {});
  return Promise.race([loads, new Promise((r) => setTimeout(r, timeoutMs))]).then(() => {});
}
