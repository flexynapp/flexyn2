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
// `size` is still the WIDTH callers lay out against (the Bag card, the
// batch-open bar, the coin shop rows). The canister is a tall object, so
// fitted into a square it came out at about 40% of the slot's width and
// read as a sliver beside the shop's other icons. It stands taller than the
// slot instead (TALL x size), which keeps it legible at 26px.
//
// Emoji-only surfaces (toast titles, push notification icons, catalog rows
// that are plain strings) use CAPSULE_GLYPH from lootCatalog.js.

import CapsuleCanister from '@/components/capsules/CapsuleCanister';

const TALL = 1.3;

/**
 * @param {'standard'|'premium'|'elite'} [type]
 * @param {number} [size]   px, the slot's width; the canister stands TALL x size
 * @param {string} [label]  when set the icon is exposed to screen readers
 */
export default function CapsuleIcon({ type = 'standard', size = 48, label, className = '', style }) {
  return (
    <span
      className={`inline-flex items-end justify-center ${className}`}
      style={{ width: size, height: Math.round(size * TALL), ...style }}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : 'true'}
    >
      <CapsuleCanister tier={type} height={Math.round(size * TALL)} />
    </span>
  );
}
