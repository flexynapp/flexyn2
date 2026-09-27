// src/components/capsules/Sticker.jsx
//
// An item drawn as a die-cut vinyl sticker, from the round 2 capsule design.
//
// The cut is the layered <use> trick: the same glyph symbol is drawn three
// times, fattest first. A bone layer at stroke 11 is the white vinyl border,
// a background-coloured layer at 6.4 is the gap between border and art, and
// the glyph itself sits on top with its accent fill in the item's RARITY
// colour. One symbol, three strokes, and the outline follows whatever shape
// the glyph has. `shadow` adds a fourth layer offset under the rest, for the
// big reveal plate.
//
// The accent is always the rarity, taken from lootCatalog's RARITY through
// rarityTint — the one colour source every loot surface already shares. That
// is also the only place purple enters: epic is a rarity tier.
//
// Items the design did not draw a glyph for render their catalog emoji on a
// die-cut disc with a rarity ring, so every item still reads as coming off
// the same sheet.
//
// The sticker colours are the object's own (bone vinyl on a dark cut), not
// theme chrome, so they are literal on purpose, the same way CapsuleIcon and
// FlexCoinIcon are.

import { GLYPH_SYMBOLS, glyphFor } from './stickerGlyphs';
import { rarityTint } from '@/components/loot/RarityVisuals';

const BONE = '#F5F2F0';
const CUT = '#13171B';
const SHADOW = '#0B0E10';
const SPRITE_ID = 'flexyn-sticker-sprite';

export const symbolId = (key) => `fxs-${key}`;

/**
 * Put the glyph symbols in the document once. Every sticker then references
 * them by id, rather than each of the forty on a sheet carrying its own copy
 * of every path. Idempotent, and a no-op without a DOM.
 */
export function ensureStickerSprite() {
  if (typeof document === 'undefined' || !document.body) return;
  if (document.getElementById(SPRITE_ID)) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('id', SPRITE_ID);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.style.width = '0';
  svg.style.height = '0';
  svg.style.overflow = 'hidden';
  svg.innerHTML = `<defs>${Object.entries(GLYPH_SYMBOLS).map(([k, body]) =>
    `<symbol id="${symbolId(k)}" viewBox="0 0 48 48" overflow="visible">${body}</symbol>`).join('')}</defs>`;
  document.body.appendChild(svg);
}

const solid = (c, w) => ({
  '--acc': c, '--ln': c, '--body': c, '--sil': c, '--ko': c, '--kos': c, '--lw': w, '--klw': w,
});

/**
 * @param {string}  [itemId]  catalog id; picks the glyph
 * @param {string}  [emoji]   fallback art when the item has no glyph
 * @param {string}  [rarity]  drives the accent colour
 * @param {number}  [size]    px, square
 * @param {boolean} [shadow]  drop a flat shadow under the cut
 * @param {boolean} [dim]     an unowned slot on the set sheet
 * @param {string}  [label]   exposes the sticker to screen readers
 */
export default function Sticker({
  itemId, emoji, rarity, size = 58, shadow = false, dim = false, label, className = '', style,
}) {
  ensureStickerSprite();
  const glyph = glyphFor(itemId);
  const accent = dim ? '#3A444E' : rarityTint(rarity).color;
  const a11y = label
    ? { role: 'img', 'aria-label': label }
    : { 'aria-hidden': 'true' };

  return (
    <svg
      viewBox="-7 -7 62 62"
      width={size}
      height={size}
      className={className}
      style={{ overflow: 'visible', flexShrink: 0, opacity: dim ? 0.45 : 1, ...style }}
      focusable="false"
      data-glyph={glyph ?? 'emoji'}
      {...a11y}
    >
      {glyph ? (
        <>
          {shadow && (
            <use href={`#${symbolId(glyph)}`} transform="translate(1.6 2.4)" style={solid(SHADOW, 11)} />
          )}
          <use href={`#${symbolId(glyph)}`} style={solid(BONE, 11)} />
          <use href={`#${symbolId(glyph)}`} style={solid(CUT, 6.4)} />
          <use href={`#${symbolId(glyph)}`} style={{ '--acc': accent, ...(dim ? { '--ln': '#89949F' } : null) }} />
        </>
      ) : (
        <>
          {shadow && <circle cx="25.6" cy="26.4" r="24" fill={SHADOW} />}
          <circle cx="24" cy="24" r="24" fill={BONE} />
          <circle cx="24" cy="24" r="20.8" fill={CUT} />
          <circle cx="24" cy="24" r="18.6" fill="none" stroke={accent} strokeWidth="2.4" />
          <text
            x="24" y="25.5" textAnchor="middle" dominantBaseline="middle"
            fontSize="20" style={{ filter: dim ? 'grayscale(1)' : undefined }}
          >
            {emoji || '?'}
          </text>
        </>
      )}
    </svg>
  );
}
