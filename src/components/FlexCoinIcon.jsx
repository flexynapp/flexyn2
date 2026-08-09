// src/components/FlexCoinIcon.jsx
//
// Flex Coins, drawn as a Flex Coin.
//
// Every coin in the app was lucide's `Coins` — two overlapping discs, one
// seen edge-on, in whatever colour the surrounding text happened to be. It
// is a fine glyph for "money" in the abstract, and that is the problem:
// Flex Coins are a specific currency with a mint ceiling, a grant ledger
// and a shop behind them, and they were rendering as the same grey outline
// any app uses for any money. A currency people earn should look minted.
//
// So: a struck disc, face-on, with the Flexyn flame on it. Face-on rather
// than lucide's stacked pair because this renders as small as 10px in
// TradeOfferCard — at that size two overlapping outlines are a smudge and
// a filled disc still reads as a coin.
//
// The palette is the brand fire gradient from public/favicon.svg
// (#ffd27a → #fb9d38 → #f2700d → #c2410c), which is also what FlexynLogo's
// flame uses — so the currency is visibly the app's own, not generic gold.
//
// It is deliberately NOT currentColor. A currency mark that changes colour
// per surface is back to being a generic glyph; this one is gold on the
// dark hero, gold in the shop, gold in a trade offer.

import { useId } from 'react';

/**
 * @param {number} [size]    px, square
 * @param {string} [label]   when set the icon is exposed to screen readers
 *                           instead of being hidden from them
 */
export default function FlexCoinIcon({ size = 16, label, className = '', style }) {
  // Gradient ids must be unique per instance — CoinShopModal renders a
  // dozen of these at once, and duplicate ids make every coin take the
  // first one's fill. Same trap CapsuleIcon and FlexynLogo document.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const face = `fc-face-${uid}`;
  const fire = `fc-fire-${uid}`;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    >
      <defs>
        <linearGradient id={face} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="55%" stopColor="#f9b53d" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <linearGradient id={fire} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#c2410c" />
          <stop offset="45%" stopColor="#f2700d" />
          <stop offset="100%" stopColor="#fb9d38" />
        </linearGradient>
      </defs>

      {/* Edge, then face. The rim is a separate darker disc rather than a
          stroke so it survives at 10px, where a sub-pixel stroke on a
          scaled viewBox disappears on some devices. */}
      <circle cx="12" cy="12" r="11" fill="#b45309" />
      <circle cx="12" cy="12" r="9.6" fill={`url(#${face})`} />

      {/* The flame, struck into the face. Simplified to two shapes — the
          traced brand path in favicon.svg is thousands of points and
          renders as a blob below ~32px. Sized to fill most of the face
          rather than sit politely inside it: at 10px, which is where
          TradeOfferCard renders this, a smaller mark is a smudge and the
          coin loses the only thing distinguishing it from a gold dot.

          A milled edge was tried here and removed. Four ticks at the
          cardinal points measured invisible at every size the app
          actually uses — detail you can't see is weight you can't spend. */}
      <path
        d="M12 4.4c2.35 2.45 3.75 4.4 3.75 6.65a3.75 3.75 0 1 1-7.5 0c0-2.25 1.4-4.2 3.75-6.65z"
        fill={`url(#${fire})`}
      />
      <path
        d="M12 9.7c1.05 1.1 1.65 1.92 1.65 2.85a1.65 1.65 0 1 1-3.3 0c0-.93.6-1.75 1.65-2.85z"
        fill="#fef3c7"
        opacity="0.9"
      />
    </svg>
  );
}
