// src/components/loot/CapsuleIcon.jsx
//
// The capsule as an icon: the machined canister from the capsule shelf
// (CapsuleCanister), fitted into a square box.
//
// This used to draw its own gachapon sphere, a coloured dome over a clear
// half. The capsule redesign replaced that object with the canister on the
// shelf, the spin and the open, but this file kept the sphere, so My Bag and
// the coin shop still showed a capsule the rest of the app no longer has.
// It now renders the canister, so every capsule on screen is the same
// object. The tier reads as material (steel, champagne, black anodised) and
// grade bars, exactly as on the shelf.
//
// The square box is kept on purpose: callers lay this out as a size x size
// glyph (the Bag card, the batch-open bar, the coin shop rows). The canister
// is taller than it is wide, so it takes the full height and sits centred.
//
// Emoji-only surfaces (toast titles, push notification icons, catalog rows
// that are plain strings) use CAPSULE_GLYPH from lootCatalog.js.

import CapsuleCanister from '@/components/capsules/CapsuleCanister';

/**
 * @param {'standard'|'premium'|'elite'} [type]
 * @param {number} [size]   px, square
 * @param {string} [label]  when set the icon is exposed to screen readers
 */
export default function CapsuleIcon({ type = 'standard', size = 48, label, className = '', style }) {
  return (
    <span
      className={`inline-flex items-end justify-center ${className}`}
      style={{ width: size, height: size, ...style }}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : 'true'}
    >
      <CapsuleCanister tier={type} height={size} />
    </span>
  );
}
