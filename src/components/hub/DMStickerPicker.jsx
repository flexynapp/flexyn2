// src/components/hub/DMStickerPicker.jsx
//
// Sticker picker drawer for DMs. Shows the user's owned stickers (from
// inventory) as a tappable grid. Picking one fires `onPick(stickerId)`
// which the parent uses to send a sticker-type message.
//
// Backed by the existing inventory data layer. Free users still see
// any common stickers they own; the picker just renders whatever's in
// their bag rather than the full catalog.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import * as inventory from '@/lib/data/inventory';
import { ITEMS } from '@/lib/lootCatalog';
import { useLanguage } from '@/lib/LanguageContext';

const STICKERS_BY_ID = Object.fromEntries(
  ITEMS.filter(i => i.type === 'sticker').map(s => [s.id, s])
);

export default function DMStickerPicker({ open, userId, userEmail, onPick, onClose }) {
  const { tFallback } = useLanguage();
  const { data: ownedRows = [] } = useQuery({
    queryKey: ['dmStickerInventory', userEmail || userId],
    // inventory.listItems(userEmail) is the real export — the old call
    // `inventory.listMine(userId)` referenced a never-defined property.
    // Vite's static analyzer flagged this at build time
    // ("listMine is not exported by inventory.js"); at runtime the
    // .catch() swallowed the TypeError so the picker just rendered
    // empty. Pass userEmail when available, fall back to listItems
    // returning [] when missing (the function expects an email).
    queryFn:  () => userEmail ? inventory.listItems(userEmail).catch(() => []) : Promise.resolve([]),
    enabled:  !!(userEmail || userId) && open,
    staleTime: 60_000,
  });

  // Group by item_id so duplicates collapse to a single tile with a
  // quantity badge — same shape UserBag uses.
  const groups = React.useMemo(() => {
    const m = new Map();
    for (const row of ownedRows) {
      if (!row?.item_id) continue;
      const meta = STICKERS_BY_ID[row.item_id];
      if (!meta) continue;
      const list = m.get(row.item_id) || [];
      list.push(row);
      m.set(row.item_id, list);
    }
    return Array.from(m.entries()).map(([itemId, rows]) => ({
      itemId,
      meta: STICKERS_BY_ID[itemId],
      count: rows.length,
    }));
  }, [ownedRows]);

  if (!open) return null;

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 280 }}
      className="absolute bottom-0 start-0 end-0 z-30 bg-card border-t border-border rounded-t-2xl shadow-lg"
      style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="kicker">{tFallback("dMStickerPicker.stickers", "Stickers")}</span>
        <button onClick={onClose} className="relative before:absolute before:content-[''] before:-inset-2.5 w-7 h-7 rounded-full bg-secondary text-muted-foreground flex items-center justify-center" aria-label={tFallback("common.close", "Close")}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {groups.length === 0 ? (
        <div className="px-4 pb-6 text-center">
          <p className="text-sm font-bold">{tFallback("dMStickerPicker.noStickersYet", "No stickers yet")}</p>
          <p className="text-xs text-muted-foreground mt-1">{tFallback('dmStickerPicker.emptyHint', 'Open capsules in the Market to collect stickers.')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-2 px-4 pb-4 max-h-56 overflow-y-auto">
          {groups.map(g => (
            <button
              key={g.itemId}
              onClick={() => { onPick(g.itemId); onClose?.(); }}
              className="relative aspect-square rounded-xl bg-secondary/50 hover:bg-secondary active:bg-secondary text-3xl flex items-center justify-center"
              aria-label={`Send ${g.meta?.name} sticker`}
            >
              {g.meta?.emoji || '✨'}
              {g.count > 1 && (
                <span className="absolute bottom-0.5 end-0.5 text-micro font-bold px-1 rounded-full bg-background/80 border border-border">
                  ×{g.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
