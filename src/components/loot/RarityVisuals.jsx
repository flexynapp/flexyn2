// src/components/loot/RarityVisuals.jsx
//
// Shared visual primitives for every loot surface (Marketplace, Bag,
// Capsule Opener, Item Index, Loot Catalog, Daily Drop).
//
// Why this exists: the rarity chip / rarity-tinted card / coin amount
// were reimplemented six times, and THREE of those sites carried their
// own hand-maintained rarity→colour map that had already drifted apart:
//
//   lootCatalog.RARITY      slate  green    blue  purple violet amber rose pink
//   ItemIndexModal          zinc   emerald  sky   violet        amber rose fuchsia
//   DailyFlexynDrop         zinc   emerald  sky   violet        amber rose  —
//   CapsuleOpener           slate  green    blue  purple        amber rose pink
//
// So "Rare" was sky-blue in one modal and blue-500 in another, and a
// new tier had to be added by hand in four places. Everything here
// derives from the ONE colour in `RARITY`, so adding a tier to
// lootCatalog.js is now the only edit required.
//
// Colours stay literal (they're catalog data, not chrome) — the
// surrounding chrome uses the app's semantic tokens so loot themes and
// light/dark mode apply.

import { RARITY } from '@/lib/lootCatalog';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import FlexCoinIcon from '@/components/FlexCoinIcon';

// The one true coin glyph. The Item Index and Daily Drop used to render
// prices with ⚡ while the Bag and Marketplace used 🪙 — same currency,
// two symbols, on screens one tap apart.
//
// This is now the STRING form only, for the places a component can't go:
// toast titles, template literals, plain-string catalog rows. Anywhere the
// coin occupies an icon slot in JSX, use `FlexCoinIcon` — same split as
// CAPSULE_GLYPH vs CapsuleIcon, and for the same reason (emoji art is
// per-vendor, so the currency looked like a different object per device).
export const COIN = '🪙';

/** Catalog metadata for a rarity, falling back to `common`. */
export function rarityMeta(rarity) {
  return RARITY[rarity] ?? RARITY.common;
}

/**
 * Derive every tint a loot surface needs from the single catalog colour.
 * Returned values are raw CSS colour strings for inline styles — that's
 * deliberate: Tailwind can't generate arbitrary per-rarity classes at
 * build time, and the hand-written class maps are exactly what drifted.
 */
export function rarityTint(rarity) {
  const { color, label } = rarityMeta(rarity);
  return {
    color,
    label,
    border:  color,
    ring:    `${color}66`,
    surface: `${color}14`,
    wash:    `${color}0d`,
    glow:    `0 0 24px ${color}55`,
  };
}

// ─── Rarity chip ──────────────────────────────────────────────────────────────
const BADGE_SIZE = {
  sm: 'text-micro px-1.5 py-0.5',
  md: 'text-micro px-2 py-0.5',
  lg: 'text-sm px-3 py-1',
};

export function RarityBadge({ rarity, size = 'md', className = '' }) {
  const { tFallback } = useLanguage();
  const t = rarityTint(rarity);
  return (
    <span
      className={`inline-block font-bold rounded-full border whitespace-nowrap ${BADGE_SIZE[size] ?? BADGE_SIZE.md} ${className}`}
      style={{ color: t.color, borderColor: t.color, background: t.surface }}
    >
      {tFallback(`loot.rarity.${rarity}`, t.label)}
    </span>
  );
}

// ─── Rarity dot ───────────────────────────────────────────────────────────────
export function RarityDot({ rarity, size = 8, className = '' }) {
  const t = rarityTint(rarity);
  return (
    <span
      className={`inline-block rounded-full shrink-0 ${className}`}
      style={{ width: size, height: size, backgroundColor: t.color }}
      aria-hidden="true"
    />
  );
}

// ─── Rarity-tinted card shell ─────────────────────────────────────────────────
/**
 * The bordered, faintly-glowing container every loot card sits in.
 *
 * `as` lets a caller swap in `motion.div` (all extra props pass through),
 * so the existing layout/enter animations keep working unchanged.
 *
 * `glow` adds the rarity-coloured drop shadow — on by default for reveal
 * moments, off for dense grids where 12 glows at once is just noise.
 */
export function RarityFrame({
  rarity,
  as: Tag = 'div',
  glow = false,
  active = false,
  className = '',
  style = {},
  children,
  ...rest
}) {
  const t = rarityTint(rarity);
  return (
    <Tag
      className={`relative rounded-xl border-2 bg-card ${className}`}
      style={{
        borderColor: active ? 'hsl(var(--primary))' : t.border,
        boxShadow: glow ? t.glow : undefined,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * The soft radial rarity wash used behind listing/reveal cards. Rendered
 * as an absolutely-positioned sibling so it never affects layout.
 */
export function RarityGlow({ rarity, className = '' }) {
  const t = rarityTint(rarity);
  return (
    <div
      className={`absolute inset-0 pointer-events-none rounded-xl ${className}`}
      style={{ background: `radial-gradient(ellipse 80% 50% at 50% 0%, ${t.surface}, transparent)` }}
      aria-hidden="true"
    />
  );
}

// ─── Coin amount ──────────────────────────────────────────────────────────────
/**
 * Locale-formatted Flex Coin amount with the canonical glyph. Use this
 * anywhere a price is rendered so the symbol and the thousands separator
 * can never diverge between two screens again.
 */
export function CoinAmount({ value, className = '' }) {
  const fmt = useNumberFormatter();
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap tabular-nums ${className}`}>
      {/* 1em so the mark tracks whatever type size the price is set in —
          this renders inside everything from a 11px badge to a 20px
          confirm-dialog total. */}
      <FlexCoinIcon size="1em" className="shrink-0" />
      {fmt(Number(value) || 0)}
    </span>
  );
}
