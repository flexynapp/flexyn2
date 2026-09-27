// src/components/market/TodayRail.jsx
//
// The Market's "today" band, from the round 2 design: the daily capsule with
// its Claim, and a row into the capsules shelf saying what is waiting there
// and what a new one costs. One band with a hairline between the rows, not
// two cards: the page is for listings, and this is the chrome above them.

import { ChevronRight } from 'lucide-react';
import DailyChestBlock from './DailyChestBlock';
import CapsuleCanister from '@/components/capsules/CapsuleCanister';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import { tierShopItem } from '@/lib/capsuleShelf';
import { useNumberFormatter } from '@/lib/intl';
import { useLanguage } from '@/lib/LanguageContext';

export default function TodayRail({ user, onClaimed, onClaimedState, capsuleCount = 0, onOpenCapsules }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  // The cheapest capsule's published price, so "new from" is the shop's own
  // number rather than one typed here.
  const from = tierShopItem('standard')?.price;

  return (
    <section className="-mx-4 md:mx-0 md:rounded-2xl border-y md:border bg-card">
      {user && <DailyChestBlock user={user} onClaimed={onClaimed} onClaimedState={onClaimedState} />}
      <button
        type="button"
        onClick={onOpenCapsules}
        className={`w-[calc(100%-2.5rem)] mx-5 h-16 flex items-center gap-3 text-start ${user ? 'border-t' : ''}`}
      >
        <span className="relative w-9 h-11 shrink-0" aria-hidden="true">
          <CapsuleCanister tier="premium" height={30} className="absolute start-0 bottom-0.5" />
          <CapsuleCanister tier="elite" height={30} className="absolute start-[18px] bottom-0.5" />
          <CapsuleCanister tier="standard" height={34} className="absolute start-[7px] bottom-0" />
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-body font-semibold">{tFallback('todayRail.capsules', 'Capsules')}</span>
          <span className="inline-flex items-center gap-1 text-caption text-muted-foreground tabular-nums">
            {capsuleCount > 0
              ? tFallback('todayRail.onShelfFrom', '{n} on your shelf. New from', { n: capsuleCount })
              : tFallback('todayRail.newFrom', 'New from')}
            {from != null && <><FlexCoinIcon size={12} />{fmt(from)}</>}
          </span>
        </span>
        <ChevronRight className="w-5 h-5 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />
      </button>
    </section>
  );
}
