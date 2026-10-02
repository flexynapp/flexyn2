// src/components/market/MarketplaceHeader.jsx
//
// The Market's top row, from the round 2 design: the title (visible from lg
// up; the phone header already shows it), the coin balance, refresh, the
// bag, and the capsules shelf with a count of what is waiting to be opened.
//
// Presentational. Every action is a prop, so the header renders without a
// router or a query client (see marketplaceRefresh.test.jsx).

import { RefreshCw } from 'lucide-react';
import { useNumberFormatter } from '@/lib/intl';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import AnimatedNumber from '@/components/AnimatedNumber';
import CapsuleCanister from '@/components/capsules/CapsuleCanister';
import { useLanguage } from '@/lib/LanguageContext';

// The bag glyph from the design: a tote with a handle.
function BagGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 8h14l-1 12H6z M9 8V6.5a3 3 0 0 1 6 0V8" />
    </svg>
  );
}

export default function MarketplaceHeader({
  flexCoins, onRefresh, refreshing = false, capsuleCount = 0, onOpenCapsules, onOpenBag,
}) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const iconBtn = 'relative w-11 h-11 inline-flex items-center justify-center rounded-full text-foreground hover:bg-secondary active:bg-secondary transition-colors';

  return (
    <div className="flex items-center gap-1 h-12">
      {/* The page's only <h1>. Below lg the fixed app header shows "Market"
          as the child-route title, so here it is sr-only there. */}
      <h1 className="sr-only lg:not-sr-only lg:font-display lg:text-display">
        {tFallback('hub.market.title', 'Market')}
      </h1>
      <span
        className="flex-1 inline-flex items-center gap-1.5 text-body font-semibold tabular-nums lg:flex-none lg:ms-auto lg:me-2"
        aria-label={tFallback('marketplaceHeader.balance', 'Your coins: {n}', { n: fmt(flexCoins) })}
      >
        <FlexCoinIcon size={18} />
        <span aria-hidden="true"><AnimatedNumber roll value={flexCoins} format={fmt} /></span>
      </span>
      {/* The icon spins while the refetch is in flight and the button
          disables itself: a refresh that returns identical data changes
          nothing else on screen, so the spin is the whole signal. */}
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label={tFallback('marketplaceHeader.refreshListings', 'Refresh listings')}
        aria-busy={refreshing}
        title={tFallback('marketplaceHeader.refreshListings', 'Refresh listings')}
        className={`${iconBtn} text-muted-foreground disabled:opacity-100`}
      >
        <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
      </button>
      {onOpenBag && (
        <button
          type="button"
          onClick={onOpenBag}
          aria-label={tFallback('marketplaceHeader.openMyBag', 'Open My Bag')}
          className={iconBtn}
        >
          <BagGlyph />
        </button>
      )}
      {onOpenCapsules && (
        <button
          type="button"
          onClick={onOpenCapsules}
          aria-label={capsuleCount > 0
            ? tFallback('marketplaceHeader.capsulesWaiting', 'Your capsules, {n} to open', { n: capsuleCount })
            : tFallback('marketplaceHeader.capsules', 'Your capsules')}
          className={`${iconBtn} -me-2`}
        >
          <CapsuleCanister tier="standard" height={28} />
          {capsuleCount > 0 && (
            <span className="absolute top-1 end-0.5 min-w-4 h-4 px-1 rounded-full bg-foreground text-background text-micro font-bold leading-4 text-center tabular-nums" aria-hidden="true">
              {capsuleCount > 99 ? '99+' : capsuleCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
