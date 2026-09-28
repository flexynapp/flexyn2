// src/pages/StickerSet.jsx
//
// The sticker set, yours first (Kegan's pick, option B, 2026-09-28). The
// stickers you own sit on a dark panel at slight angles, like a sheet you
// have been peeling from; tap one and its number, name and rarity show
// under it. Below that, one line per rarity with its count and a mini bar;
// tap a line to see that rarity's whole run, the missing ones dimmed.
//
// It replaced a grid of all 55 stickers with a chip filter on top, which put
// 55 boxes on the screen before the user saw a single thing they own.
//
// Read only. Ownership is the user's inventory rows; the set is the catalog
// (collection.js 'stickers').

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as inventory from '@/lib/data/inventory';
import { ownershipFrom } from '@/lib/collection';
import { stickerSet, setTiers, formatSetNo } from '@/lib/capsuleShelf';
import { tileRow } from '@/lib/tileRows';
import { rarityTint } from '@/components/loot/RarityVisuals';
import Sticker from '@/components/capsules/Sticker';
import { SetBar } from '@/components/capsules/parts';
import { rarityName } from '@/components/capsules/words';

const SHEET = tileRow({ gap: 2, cols: 4, smCols: 6 });

// A fixed tilt and nudge per sticker, from its id, so the collage looks
// placed by hand and still lands the same way on every visit.
function lay(id) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  h = Math.abs(h);
  return { rotate: (h % 15) - 7, y: ((h >> 4) % 9) - 4 };
}

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
  const tiers = useMemo(() => setTiers(owned), [owned]);
  // Rarest first, so the best thing you own is the first thing you see.
  const mine = useMemo(() => set.filter(s => owned.has(s.id)).reverse(), [set, owned]);

  const [picked, setPicked] = useState(null);
  const shown = mine.find(s => s.id === picked) ?? mine[0] ?? null;
  const [openTier, setOpenTier] = useState(null);

  return (
    <div className="px-4 pt-4 md:px-8 md:pt-8 max-w-3xl mx-auto flex flex-col">
      <h1 className="sr-only lg:not-sr-only lg:font-display lg:text-display lg:pb-2">
        {tFallback('stickerSet.title', 'Sticker set')}
      </h1>
      <div className="flex flex-col gap-2">
        <span className="stamp">
          {inv
            ? tFallback('capsules.set.stickersOf', '{owned} of {total} stickers', { owned: mine.length, total: set.length })
            : tFallback('stickerSet.count', '{n} stickers', { n: set.length })}
        </span>
        {inv && <SetBar tiers={tiers} />}
      </div>

      {inv && (
        <section className="pt-6 flex flex-col gap-2" aria-labelledby="set-yours">
          <span id="set-yours" className="stamp">
            {mine.length > 0
              ? tFallback('stickerSet.yours', 'Yours. Tap one to see it')
              : tFallback('stickerSet.yoursTitle', 'Yours')}
          </span>
          {/* The panel borrows the dark tokens so it reads as a dark sheet on the
              light page. On the dark page those tokens ARE the page, so it
              steps up to the card surface there, or it has no edge at all. */}
          <div className="dark -mx-1 rounded-2xl bg-background dark:bg-card text-foreground px-2 pt-4 pb-3 flex flex-col gap-2">
            {mine.length > 0 ? (
              <>
                <ul className="flex flex-wrap justify-center gap-1">
                  {mine.map(s => {
                    const { rotate, y } = lay(s.id);
                    const on = shown?.id === s.id;
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => setPicked(s.id)}
                          aria-pressed={on}
                          aria-label={s.name}
                          className="w-[68px] h-[76px] flex items-center justify-center rounded-lg"
                        >
                          <Sticker
                            itemId={s.id}
                            emoji={s.emoji}
                            rarity={s.rarity}
                            size={on ? 66 : 58}
                            shadow
                            className="transition-[width,height,transform] duration-200"
                            style={{ transform: `translateY(${y}px) rotate(${rotate}deg)` }}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {shown && (
                  <p className="min-h-11 flex flex-wrap items-baseline justify-center gap-x-2 text-center" aria-live="polite">
                    <span className="stamp">{tFallback('capsules.setNo', 'No. {no}', { no: formatSetNo(shown.no) })}</span>
                    <span className="text-body font-semibold">{shown.name}</span>
                    <span className="text-label" style={{ color: rarityTint(shown.rarity).color }}>
                      {rarityName(tFallback, shown.rarity)}
                    </span>
                  </p>
                )}
              </>
            ) : (
              <div className="py-6 flex flex-col items-center gap-2 text-center">
                <p className="text-label text-muted-foreground max-w-[260px]">
                  {tFallback('stickerSet.empty', 'No stickers yet. Every capsule drops one.')}
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="pt-6 flex flex-col gap-2" aria-labelledby="set-by-rarity">
        <span id="set-by-rarity" className="stamp">{tFallback('stickerSet.byRarity', 'By rarity')}</span>
        <ul className="rounded-2xl bg-card border divide-y overflow-hidden">
          {tiers.map(t => {
            const tint = rarityTint(t.rarity);
            const open = openTier === t.rarity;
            const run = set.filter(s => s.rarity === t.rarity);
            return (
              <li key={t.rarity}>
                <button
                  type="button"
                  onClick={() => setOpenTier(open ? null : t.rarity)}
                  aria-expanded={open}
                  aria-controls={`tier-${t.rarity}`}
                  className="w-full min-h-12 px-3 flex items-center gap-2 text-start"
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tint.color }} aria-hidden="true" />
                  <span className="flex-1 text-label font-semibold">{rarityName(tFallback, t.rarity)}</span>
                  {inv && (
                    <>
                      <span className="text-label tabular-nums text-muted-foreground">
                        {tFallback('capsules.set.of', '{owned} of {total}', { owned: t.owned, total: t.total })}
                      </span>
                      <span className="w-12 h-1.5 rounded-full bg-border overflow-hidden" aria-hidden="true">
                        <span className="block h-full rounded-full" style={{ width: `${(t.owned / t.total) * 100}%`, background: tint.color }} />
                      </span>
                    </>
                  )}
                  <ChevronDown
                    className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                </button>
                {open && (
                  <ul id={`tier-${t.rarity}`} className={`${SHEET.row} px-1 pt-2 pb-3`}>
                    {run.map(s => {
                      const have = owned.has(s.id);
                      return (
                        <li key={s.id} className={`${SHEET.item} relative h-28 flex flex-col items-center gap-1`}>
                          <span className="stamp absolute start-1.5 top-0" aria-hidden="true">{formatSetNo(s.no)}</span>
                          <Sticker itemId={s.id} emoji={s.emoji} rarity={s.rarity} size={54} dim={!have} className="mt-3" />
                          <span className={`text-caption font-semibold text-center leading-tight max-w-[84px] ${have ? '' : 'text-muted-foreground'}`}>
                            {s.name}
                            {!have && <span className="sr-only">. {tFallback('stickerSet.missing', 'Not collected yet')}</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-caption text-muted-foreground">
          {tFallback('stickerSet.lead', 'Every sticker a capsule can drop, cut from one sheet. The colour is always the rarity.')}
        </p>
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
