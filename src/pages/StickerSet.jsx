// src/pages/StickerSet.jsx
//
// The sticker set as one die-cut sheet, from the round 2 "Item set" design:
// every sticker in the catalog in sheet order (common to rarest), numbered,
// with the ones the user has not pulled yet dimmed. Chips filter by rarity.
//
// Read only. Ownership is the user's inventory rows; the set is the catalog
// (collection.js 'stickers'). Dropped from the design: its "Capsules, three
// finishes" spec strip, which documents the canisters rather than being a
// screen, and the 9px sheet numbers, which sit under the app's 11px floor.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as inventory from '@/lib/data/inventory';
import { ownershipFrom, RARITY_ORDER } from '@/lib/collection';
import { stickerSet, formatSetNo } from '@/lib/capsuleShelf';
import { tileRow } from '@/lib/tileRows';
import { rarityTint } from '@/components/loot/RarityVisuals';
import Sticker from '@/components/capsules/Sticker';
import { PunchStrip } from '@/components/capsules/parts';
import { rarityName } from '@/components/capsules/words';

const SHEET = tileRow({ gap: 2, cols: 4, smCols: 6 });

export default function StickerSet() {
  const { tFallback } = useLanguage();
  const { user } = useAuth();
  const { data: inv } = useQuery({
    queryKey: ['userInventory', user?.email],
    queryFn: () => inventory.listItems(user.email),
    enabled: !!user?.email,
    staleTime: 30_000,
  });

  const set = useMemo(() => stickerSet().map((s, i) => ({ ...s, no: i + 1 })), []);
  const owned = useMemo(() => ownershipFrom(inv ?? []).owned, [inv]);
  const ownedCount = set.filter(s => owned.has(s.id)).length;

  // Only the rarities the set actually has, each with its count.
  const tiers = useMemo(
    () => RARITY_ORDER
      .map(r => ({ rarity: r, count: set.filter(s => s.rarity === r).length }))
      .filter(t => t.count > 0),
    [set],
  );
  const [filter, setFilter] = useState('all');
  const shown = filter === 'all' ? set : set.filter(s => s.rarity === filter);

  return (
    <div className="px-4 pt-4 md:px-8 md:pt-8 max-w-3xl mx-auto flex flex-col">
      <h1 className="sr-only lg:not-sr-only lg:font-display lg:text-display lg:pb-2">
        {tFallback('stickerSet.title', 'Sticker set')}
      </h1>
      <div className="flex flex-col gap-2">
        <span className="stamp">
          {inv
            ? tFallback('capsules.set.stickersOf', '{owned} of {total} stickers', { owned: ownedCount, total: set.length })
            : tFallback('stickerSet.count', '{n} stickers', { n: set.length })}
        </span>
        {inv && <PunchStrip owned={ownedCount} total={set.length} />}
        <p className="text-label text-muted-foreground">
          {tFallback('stickerSet.lead', 'Every sticker a capsule can drop, cut from one sheet. The colour is always the rarity.')}
        </p>
      </div>

      <div className="pt-4 flex flex-wrap gap-1.5" role="group" aria-label={tFallback('stickerSet.filter', 'Filter by rarity')}>
        <Chip on={filter === 'all'} onClick={() => setFilter('all')} label={tFallback('stickerSet.all', 'All')} count={set.length} />
        {tiers.map(t => (
          <Chip
            key={t.rarity}
            on={filter === t.rarity}
            onClick={() => setFilter(t.rarity)}
            dot={rarityTint(t.rarity).color}
            label={rarityName(tFallback, t.rarity)}
            count={t.count}
          />
        ))}
      </div>

      <section className="-mx-1 mt-4 rounded-2xl bg-card border pt-4 pb-2 px-1">
        <ul className={SHEET.row}>
          {shown.map(s => {
            const have = owned.has(s.id);
            const tint = rarityTint(s.rarity);
            return (
              <li key={s.id} className={`${SHEET.item} relative h-32 flex flex-col items-center gap-2`}>
                <span className="stamp absolute start-1.5 -top-1" aria-hidden="true">{formatSetNo(s.no)}</span>
                <Sticker
                  itemId={s.id}
                  emoji={s.emoji}
                  rarity={s.rarity}
                  size={58}
                  dim={!have}
                  className="mt-2"
                />
                <span className={`text-caption font-semibold text-center leading-tight max-w-[84px] ${have ? '' : 'text-muted-foreground'}`}>
                  {s.name}
                </span>
                <span className="text-micro -mt-1" style={{ color: tint.color, opacity: have ? 1 : 0.7 }}>
                  {rarityName(tFallback, s.rarity)}
                  {!have && <span className="sr-only">. {tFallback('stickerSet.missing', 'Not collected yet')}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <Link
        to="/market/capsules"
        className="mt-6 mb-6 h-11 inline-flex items-center justify-center rounded-full border text-label font-semibold"
      >
        {tFallback('stickerSet.toCapsules', 'Open capsules')}
      </Link>
    </div>
  );
}

function Chip({ on, onClick, dot, label, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`h-11 px-3 rounded-full border inline-flex items-center gap-1.5 text-label font-semibold ${on ? 'bg-foreground text-background border-foreground' : 'text-foreground'}`}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} aria-hidden="true" />}
      {label}
      <span className={`font-medium tabular-nums ${on ? 'opacity-70' : 'text-muted-foreground'}`}>{count}</span>
    </button>
  );
}
