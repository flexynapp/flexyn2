// src/components/hub/RecentlyViewedRail.jsx
//
// Horizontal scrolling row of small thumbnails representing the last
// five marketplace listings this user tapped into but didn't buy.
// Lifted from the Instagram Shop / Amazon / eBay pattern — comparison
// shoppers tap-and-back constantly, then can't remember what they
// were considering.
//
// Renders nothing if the history is empty. Per-thumbnail "×" removes
// from history. "Clear all" link wipes the lot. Auto-refreshes on
// the flexyn:recently-viewed-changed custom event (dispatched from
// the recentlyViewedListings helper when add/remove/clear runs).

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { listRecentlyViewed, removeRecentlyViewed, clearRecentlyViewed } from '@/lib/recentlyViewedListings';
import { RARITY } from '@/lib/lootCatalog';
import { useNumberFormatter } from '@/lib/intl';

export default function RecentlyViewedRail({ userEmail, listings = [], onSelect }) {
  const fmt = useNumberFormatter();
  const [recents, setRecents] = useState(() => listRecentlyViewed(userEmail));

  // Stay in sync with the storage backing — re-read on the custom
  // event so add/remove from elsewhere reflects immediately.
  useEffect(() => {
    const refresh = () => setRecents(listRecentlyViewed(userEmail));
    refresh();
    window.addEventListener('flexyn:recently-viewed-changed', refresh);
    return () => window.removeEventListener('flexyn:recently-viewed-changed', refresh);
  }, [userEmail]);

  if (!recents || recents.length === 0) return null;

  // Cross-reference live listings to determine which recents are
  // still buyable. Sold/cancelled listings render dimmed with a
  // "Sold" overlay — keeps the comparison history without misleading
  // the user about availability.
  const liveById = new Map((listings || []).map(l => [l.id, l]));

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Recently viewed
        </h3>
        <button
          type="button"
          onClick={() => clearRecentlyViewed(userEmail)}
          className="text-[10px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
        >
          Clear
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
        <AnimatePresence initial={false}>
          {recents.map((entry) => {
            const live = liveById.get(entry.id);
            const isGone = !live || live.status !== 'active';
            const rc = RARITY[entry.item_rarity] ?? RARITY.common;
            return (
              <motion.div
                key={entry.id}
                layout
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.18 }}
                className="relative shrink-0 w-20 rounded-xl border-2 bg-[#0f0f2a] p-2 flex flex-col items-center gap-1 group"
                style={{ borderColor: `${rc.color}55` }}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (isGone || !onSelect) return;
                    onSelect(live);
                  }}
                  disabled={isGone}
                  className={`w-full flex flex-col items-center gap-1 ${isGone ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  aria-label={isGone ? `${entry.item_name} — no longer available` : `View ${entry.item_name}`}
                >
                  <span className="text-2xl leading-none">{entry.item_emoji || '🎁'}</span>
                  <span className="text-[10px] text-white font-medium text-center leading-tight line-clamp-2 min-h-[2em]">
                    {entry.item_name}
                  </span>
                  {entry.asking_price != null && (
                    <span className="text-[10px] text-amber-300 font-bold">
                      🪙 {fmt(Number(entry.asking_price))}
                    </span>
                  )}
                </button>
                {isGone && (
                  <span
                    className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[10px] font-bold uppercase tracking-wider text-rose-400 bg-black/50 py-0.5 pointer-events-none"
                    aria-hidden="true"
                  >
                    Sold
                  </span>
                )}
                {/* × removal — appears on hover (desktop) / always tappable
                    on touch. Positioned outside the main button so taps
                    don't open the listing. */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeRecentlyViewed(userEmail, entry.id);
                  }}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-900 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800 flex items-center justify-center transition-colors"
                  aria-label="Remove from recents"
                >
                  <X className="w-3 h-3" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
