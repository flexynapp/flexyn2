// src/components/capsules/parts.jsx
//
// Small drawn pieces the capsule and market screens share: the set bar,
// the notched plate corner, and the drop-rate bar.

import { useEffect, useState } from 'react';
import { rarityTint } from '@/components/loot/RarityVisuals';

/**
 * The set as one thin bar of rarity segments, each as wide as its share of
 * the set and filled to how much of that rarity is owned. `tiers` comes from
 * setTiers(). It replaced a strip of one box per sticker, which at 55 boxes
 * read as a form to fill in rather than a collection. Decorative; the count
 * beside it is the accessible reading.
 */
export function SetBar({ tiers, grow = null, growDelay = 0 }) {
  // `grow` names the rarity that just gained a sticker: its segment starts
  // one short and fills to the new count, so the set visibly ticks up.
  const [grown, setGrown] = useState(!grow);
  useEffect(() => {
    if (!grow) return undefined;
    const t = setTimeout(() => setGrown(true), growDelay);
    return () => clearTimeout(t);
  }, [grow, growDelay]);
  return (
    <div className="flex gap-0.5 h-1.5" aria-hidden="true" data-testid="set-bar">
      {tiers.map(t => {
        const owned = t.rarity === grow && !grown ? Math.max(0, t.owned - 1) : t.owned;
        return (
          <span
            key={t.rarity}
            data-rarity={t.rarity}
            className="block h-full rounded-full overflow-hidden bg-border min-w-[6px]"
            style={{ flexGrow: t.total, flexBasis: 0 }}
          >
            <span
              className="block h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500 motion-safe:ease-out"
              style={{ width: `${t.total ? (owned / t.total) * 100 : 0}%`, background: rarityTint(t.rarity).color }}
            />
          </span>
        );
      })}
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
