// src/components/market/MarketplaceHeader.jsx
// Marketplace banner: title, balance, bag shortcut, list CTA, sort
// controls, and the ambient drift particles.
// Split out of MarketplaceFeed.jsx.

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ShoppingBag, RefreshCw, ArrowUpDown, Package } from 'lucide-react';
import { requestOpenBag } from '@/lib/inventoryFlow';
import { useNumberFormatter } from '@/lib/intl';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import { useLanguage } from '@/lib/LanguageContext';

// Ambient drift particles. `tone` resolves against the live theme rather
// than the old hardcoded violet hexes, which were invisible against a
// light background and ignored whichever loot theme the user equipped.
const MKT_PARTICLES = [
  { x: 8,  size: 3, dur: 5.2, delay: 0,   travel: 38, tone: 'primary' },
  { x: 20, size: 2, dur: 6.8, delay: 1.4, travel: 28, tone: 'primary' },
  { x: 38, size: 4, dur: 4.5, delay: 0.7, travel: 44, tone: 'primary' },
  { x: 55, size: 2, dur: 7.1, delay: 2.1, travel: 32, tone: 'accent'  },
  { x: 68, size: 3, dur: 5.6, delay: 0.3, travel: 40, tone: 'primary' },
  { x: 80, size: 2, dur: 6.2, delay: 1.9, travel: 26, tone: 'accent'  },
  { x: 90, size: 3, dur: 4.9, delay: 1.1, travel: 36, tone: 'primary' },
  { x: 45, size: 2, dur: 7.4, delay: 3.0, travel: 24, tone: 'accent'  },
];

const TONE = {
  primary: 'hsl(var(--primary))',
  accent:  '#fbbf24',
};

const prefersReducedMotion = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
};

export function DriftParticles({ particles }) {
  if (prefersReducedMotion()) return null;
  return particles.map((p, i) => (
    <motion.div
      key={i}
      className="absolute pointer-events-none rounded-full"
      style={{
        width: p.size, height: p.size,
        left: `${p.x}%`, bottom: 0,
        background: TONE[p.tone] ?? TONE.primary,
        opacity: 0,
        filter: 'blur(0.5px)',
      }}
      animate={{ y: [0, -p.travel], opacity: [0, 0.55, 0] }}
      transition={{ duration: p.dur, delay: p.delay, repeat: Infinity, ease: 'easeOut' }}
      aria-hidden="true"
    />
  ));
}

// Sort used to live here as two toggle buttons in a second row. It moved
// to MarketFilterBar, next to the type/rarity/affordability controls it
// belongs with — which also lets this banner shrink to a single row.
export default function MarketplaceHeader({
  flexCoins, onRefresh, refreshing = false, onList, listableCount = 0, onOpenTradeHistory,
}) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const bannerRef = useRef(null);

  // Slowly rotate the banner's gradient.
  //
  // The previous implementation called setState on EVERY animation frame,
  // re-rendering the whole header (and its eight framer-motion particles)
  // ~60×/second for a purely decorative effect. Writing the angle straight
  // onto the node through a ref keeps the identical visual with zero React
  // renders. Skipped entirely under reduced-motion.
  useEffect(() => {
    const el = bannerRef.current;
    if (!el || prefersReducedMotion()) return;

    let angle = 0;
    let prevTime = null;
    let rafId = null;

    const tick = (time) => {
      if (prevTime !== null) {
        angle = (angle + (time - prevTime) * 0.018) % 360;
        el.style.setProperty('--mkt-angle', `${Math.round(angle)}deg`);
      }
      prevTime = time;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => { if (rafId) cancelAnimationFrame(rafId); };
  }, []);

  return (
    <div
      ref={bannerRef}
      className="rounded-2xl p-4 flex flex-col gap-3 relative overflow-hidden border border-primary/30 bg-card"
      style={{
        // Theme-derived rather than the old literal #1a0538 → #2d0a5e
        // purple, so equipped loot themes and light mode both apply.
        backgroundImage:
          'linear-gradient(var(--mkt-angle, 0deg), hsl(var(--primary) / 0.30) 0%, hsl(var(--primary) / 0.10) 40%, hsl(var(--primary) / 0.24) 70%, hsl(var(--primary) / 0.12) 100%)',
      }}
    >
      <DriftParticles particles={MKT_PARTICLES} />

      {/* Row 1: title + balance + bag + list CTA */}
      <div className="flex items-center justify-between flex-wrap gap-2 relative z-10">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-5 h-5 text-primary" />
          {/* This is the page's only <h1> — Market.jsx deliberately doesn't
              render one (see the comment there). */}
          <h1 className="font-heading font-bold text-lg">{tFallback("layout.marketplace", "Marketplace")}</h1>
          {/* The icon SPINS while the refetch is in flight, and the button
              disables itself. Without that this control was unfalsifiable:
              the common case is that nothing has changed since the last
              load, so the grid re-renders identically and a working refresh
              was pixel-identical to a dead button — the same shape of bug
              as the suppressed toasts (see the toast-policy section of
              CLAUDE.md). The spin is what says "I checked". */}
          <button
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={tFallback("marketplaceHeader.refreshListings", "Refresh listings")}
            aria-busy={refreshing}
            title={tFallback("marketplaceHeader.refreshListings", "Refresh listings")}
            className="text-muted-foreground hover:text-foreground active:text-foreground transition-colors p-1 rounded-lg hover:bg-secondary active:bg-secondary disabled:opacity-100"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          {/* Trade history — the consolidated timeline of every trade offer
              the viewer sent or received (reads the existing hub_messages
              markers, no migration). */}
          <a
            href="/market/trades"
            onClick={(e) => { e.preventDefault(); onOpenTradeHistory?.(); }}
            className="text-muted-foreground hover:text-foreground active:text-foreground transition-colors p-1 rounded-lg hover:bg-secondary active:bg-secondary"
            aria-label={tFallback("marketplaceHeader.tradeHistory", "Trade history")}
            title={tFallback("marketplaceHeader.tradeHistory", "Trade history")}
          >
            <ArrowUpDown className="w-4 h-4" />
          </a>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-amber-400 rounded-full px-3 py-1.5">
            <FlexCoinIcon size={18} />
            <span className="text-amber-950 font-bold text-sm tabular-nums">{fmt(flexCoins)}</span>
          </div>
          {/* My Bag — opens the bag drawer through the global OPEN_BAG_EVENT
              so the user doesn't have to navigate back to ProfileMenu. Also
              drives the capsule-open flow (see inventoryFlow.js). */}
          <button
            onClick={requestOpenBag}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-secondary border border-border font-bold text-sm hover:bg-secondary/70 active:bg-secondary/70 transition-colors shrink-0"
            aria-label={tFallback("marketplaceHeader.openMyBag", "Open My Bag")}
          >
            <Package className="w-4 h-4 shrink-0" />
            {/* Once the listable count reaches two digits the List Item
                button grows and squeezes this one until "My Bag" wraps to
                two lines. Seen at 20 items. */}
            <span className="whitespace-nowrap">{tFallback("profile.myBag", "My Bag")}</span>
          </button>
          <button
            onClick={onList}
            // Live count of listable items (stickers you own that aren't
            // already listed). Removes the tap-and-discover cycle for users
            // with nothing to sell; doubles as a satisfying tick-up when a
            // capsule opens and inventory grows.
            className={`px-4 py-2 rounded-full bg-primary text-primary-foreground font-bold text-sm shadow-lg hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 ${listableCount === 0 ? 'opacity-60' : ''}`}
          >
            List Item
            {listableCount > 0 && (
              <span className="ms-1 font-semibold tabular-nums opacity-80">
                · {listableCount > 99 ? '99+' : listableCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
