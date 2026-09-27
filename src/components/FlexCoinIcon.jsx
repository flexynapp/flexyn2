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
// So: a struck disc, face-on. Face-on rather than lucide's stacked pair
// because this renders as small as 10px in TradeOfferCard, where two
// overlapping outlines are a smudge and a filled disc still reads as a coin.
//
// Round 2 of the capsule and market design (2026-09-27) restruck it in
// PEWTER: a milled edge, a raised field and the Flexyn swoosh, all neutral.
// It was the brand fire gradient, which made every price on the market a
// second orange thing competing with the one orange control on the screen.
// Neutral on purpose, so orange stays the action. Flat, too: the app bans
// gradients as decoration, and a flat disc has no gradient ids to collide
// when a list renders sixty of them.
//
// It is deliberately NOT currentColor. A currency mark that changes colour
// per surface is back to being a generic glyph; this one is pewter on the
// dark stage, pewter in the shop, pewter in a trade offer.

/**
 * @param {number|string} [size]  px, square (or any css length)
 * @param {string} [label]        when set the icon is exposed to screen readers
 *                                instead of being hidden from them
 */
export default function FlexCoinIcon({ size = 16, label, className = '', style }) {
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
      {/* Edge, milling, then the raised field. The rim is a disc rather than
          a stroke so it survives at 10px. */}
      <circle cx="12" cy="12" r="11" fill="#6B747C" />
      <circle cx="12" cy="12" r="11" fill="none" stroke="#A3ACB4" strokeWidth="1.6" strokeDasharray="0.9 1.05" />
      <circle cx="12" cy="11.4" r="8.4" fill="#C9D0D6" />
      <path d="M12 3A8.4 8.4 0 0 0 4.1 14.4" fill="none" stroke="#E6EAED" strokeWidth="1.2" strokeLinecap="round" />
      {/* The swoosh, struck into the field. */}
      <path d="M6.6 14.2H11.6C14.2 14.2 15.9 12.9 17.1 9.8" fill="none" stroke="#3A434B" strokeWidth="2.3" strokeLinecap="round" />
    </svg>
  );
}
