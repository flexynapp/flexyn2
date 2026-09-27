// src/components/capsules/parts.jsx
//
// Small drawn pieces the capsule and market screens share: the set punch
// strip, the notched plate corner, and the drop-rate bar.

import { punchSlots } from '@/lib/capsuleShelf';
import { rarityTint } from '@/components/loot/RarityVisuals';

/**
 * One slot per sticker in the set, filled for each one owned. With `fresh`,
 * the last owned slot is drawn in `freshColor`: the sticker that just landed.
 * Decorative; the count beside it is the accessible reading.
 */
export function PunchStrip({ owned, total, fresh = false, freshColor }) {
  const slots = punchSlots(owned, total, fresh);
  return (
    <div className="flex flex-wrap gap-[3px]" aria-hidden="true" data-testid="punch-strip">
      {slots.map((s, i) => (
        <span
          key={i}
          data-slot={s}
          className="block w-1.5 h-3 box-border border"
          style={{
            borderRadius: 2,
            background: s === 'owned' ? 'hsl(var(--foreground))' : s === 'fresh' ? freshColor : 'transparent',
            borderColor: s === 'owned' ? 'hsl(var(--foreground))' : s === 'fresh' ? freshColor : 'hsl(var(--border))',
          }}
        />
      ))}
    </div>
  );
}

/**
 * The notched corner on a sticker plate: the bottom right corner cut away and
 * folded, as if the plate were a stamped tag. Place inside a `relative` plate.
 */
export function NotchedCorner() {
  return (
    <svg
      width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"
      className="absolute -end-px -bottom-px rtl:scale-x-[-1]"
    >
      <path d="M28 0V14A14 14 0 0 1 14 28H0Z" fill="hsl(var(--background))" />
      <path d="M28 0L0 28H13A15 15 0 0 0 28 13Z" fill="hsl(var(--border))" />
      <path d="M28 0L0 28" stroke="hsl(var(--muted-foreground) / 0.35)" strokeWidth="1" />
    </svg>
  );
}

/**
 * Drop rates as one bar of rarity segments plus a legend. `segments` comes
 * from oddsSegments(); `fmtPct` formats a number like 1.8 for the locale.
 */
export function OddsBar({ segments, fmtPct, rarityLabel }) {
  return (
    <>
      <div className="flex h-2 rounded-full overflow-hidden gap-0.5" aria-hidden="true">
        {segments.map(s => (
          <span key={s.rarity} className="block min-w-[3px]" style={{ width: `${s.pct}%`, background: s.color }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-2 gap-y-1">
        {segments.map(s => (
          <li key={s.rarity} className="flex items-center gap-1 text-caption text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: rarityTint(s.rarity).color }} aria-hidden="true" />
            {rarityLabel(s.rarity)}
            <span className="tabular-nums text-foreground font-semibold">{fmtPct(s.pct)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
