// src/components/market/DailyChestBlock.jsx
// Once-per-UTC-day free capsule + coins. Split out of MarketplaceFeed.jsx.

import { useState } from 'react';
import { toast } from '@/lib/toast';
import { supabase } from '@/api/supabaseClient';
import { reportError } from '@/lib/reportError';
import { useLanguage } from '@/lib/LanguageContext';
import { requestOpenBag } from '@/lib/inventoryFlow';
import CapsuleCanister from '@/components/capsules/CapsuleCanister';
import { isDailyChestClaimedLocally, markDailyChestClaimedLocally } from './dailyChest';

export default function DailyChestBlock({ user, onClaimed, onClaimedState }) {
  const { tFallback } = useLanguage();
  // localStorage hint avoids the "available" flicker on cold loads, but the
  // server is the source of truth — the claim RPC enforces once-per-UTC-day
  // even if localStorage is wiped or this is a different browser / device.
  const [claimed, setClaimed] = useState(() => isDailyChestClaimedLocally(user?.id));
  const [loading, setLoading] = useState(false);

  const handleClaim = async () => {
    if (claimed || loading || !user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('claim_daily_chest');
      if (error) throw error;

      if (data?.already_claimed) {
        // Server says we already claimed today (probably from another
        // device). Quietly sync local state without celebrating again.
        markDailyChestClaimedLocally(user.id);
        setClaimed(true);
        onClaimedState?.();
        return;
      }

      // Real claim landed. The parent's onClaimed fires the refetch chain.
      markDailyChestClaimedLocally(user.id);
      setClaimed(true);
      onClaimedState?.();
      onClaimed?.();
      requestOpenBag();
    } catch (err) {
      // Pre-migration host (RPC missing) or network error. Do NOT mark
      // claimed locally — let the user retry. Earlier code marked
      // claimed-on-failure to avoid spam clicks; that defeated the very
      // safety check the RPC was added for.
      reportError(err, { feature: 'marketplace.daily-chest-claim', level: 'warning', userEmail: user?.email });
      toast.error(tFallback('marketplace.dailyChest.claimFailed', 'Could not claim. Try again in a moment.'));
    } finally {
      setLoading(false);
    }
  };

  // One row of the Market's "today" band, from the round 2 design. Claim is
  // the one orange control on the page while the capsule is waiting.
  return (
    <div className="h-[72px] px-5 flex items-center gap-3">
      <span className="w-9 flex justify-center shrink-0">
        <CapsuleCanister tier="standard" height={40} style={{ opacity: claimed ? 0.55 : 1 }} />
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-body font-semibold truncate">
          {claimed
            ? tFallback('marketplace.dailyChest.claimedTitle', 'Daily capsule claimed')
            : tFallback('marketplace.dailyChest.ready', 'Daily capsule is ready')}
        </span>
        <span className="text-caption text-muted-foreground truncate">
          {claimed
            ? tFallback('marketplace.dailyChest.comebackShort', 'Back tomorrow')
            : tFallback('marketplace.dailyChest.onceADay', 'A capsule and coins, once a day')}
        </span>
      </span>
      {!claimed && (
        <button
          type="button"
          onClick={handleClaim}
          disabled={loading}
          aria-busy={loading}
          className="h-11 px-5 rounded-full bg-primary text-primary-foreground font-display text-body shrink-0 disabled:opacity-60"
        >
          {tFallback('marketplace.dailyChest.claim', 'Claim')}
        </button>
      )}
    </div>
  );
}
