// src/components/market/DailyChestBlock.jsx
// Once-per-UTC-day free capsule + coins. Split out of MarketplaceFeed.jsx.

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Gift } from 'lucide-react';
import { toast } from '@/lib/toast';
import { supabase } from '@/api/supabaseClient';
import { reportError } from '@/lib/reportError';
import { useLanguage } from '@/lib/LanguageContext';
import { requestOpenBag } from '@/lib/inventoryFlow';
import { isDailyChestClaimedLocally, markDailyChestClaimedLocally } from './dailyChest';
import { DriftParticles } from './MarketplaceHeader';

// Golden drift particles for the chest.
const CHEST_PARTICLES = [
  { x: 12, size: 3, dur: 5.4, delay: 0,   travel: 34, tone: 'accent'  },
  { x: 28, size: 2, dur: 6.5, delay: 0.8, travel: 26, tone: 'accent'  },
  { x: 50, size: 4, dur: 4.8, delay: 1.6, travel: 42, tone: 'accent'  },
  { x: 70, size: 2, dur: 7.0, delay: 0.4, travel: 30, tone: 'primary' },
  { x: 85, size: 3, dur: 5.8, delay: 2.2, travel: 38, tone: 'accent'  },
  { x: 40, size: 2, dur: 6.8, delay: 3.5, travel: 22, tone: 'accent'  },
];

export default function DailyChestBlock({ user, onClaimed }) {
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
        return;
      }

      // Real claim landed. The parent's onClaimed fires the refetch chain.
      markDailyChestClaimedLocally(user.id);
      setClaimed(true);
      onClaimed?.();
      requestOpenBag();
    } catch (err) {
      // Pre-migration host (RPC missing) or network error. Do NOT mark
      // claimed locally — let the user retry. Earlier code marked
      // claimed-on-failure to avoid spam clicks; that defeated the very
      // safety check the RPC was added for.
      reportError(err, { feature: 'marketplace.daily-chest-claim', level: 'warning', userEmail: user?.email });
      toast.error(tFallback('marketplace.dailyChest.claimFailed', 'Could not claim — try again in a moment.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-4 flex items-center gap-4 relative overflow-hidden border border-primary/30 bg-card"
      style={{
        backgroundImage:
          'linear-gradient(135deg, hsl(var(--primary) / 0.22) 0%, hsl(var(--primary) / 0.06) 100%)',
      }}
    >
      <DriftParticles particles={CHEST_PARTICLES} />

      <div className="shrink-0 w-12 h-12 rounded-xl bg-secondary border border-border flex items-center justify-center relative z-10">
        <Gift className={`w-6 h-6 ${claimed ? 'text-amber-500/50' : 'text-amber-500'}`} />
      </div>
      <div className="flex-1 min-w-0 relative z-10">
        <p className="font-heading font-bold text-sm">
          {tFallback('marketplace.dailyChest.title', 'Daily Chest')}
        </p>
        <p className="text-muted-foreground font-medium text-xs mt-0.5">
          {claimed
            ? tFallback('marketplace.dailyChest.comeback', 'Come back tomorrow for another reward!')
            : tFallback('marketplace.dailyChest.cta', 'Claim your free daily capsule + coins')}
        </p>
      </div>
      <button
        onClick={handleClaim}
        disabled={claimed || loading}
        className={[
          'shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-all relative z-10',
          claimed
            ? 'bg-secondary text-muted-foreground cursor-not-allowed border border-border'
            : 'bg-primary text-primary-foreground hover:opacity-90 shadow-md',
        ].join(' ')}
      >
        {loading
          ? '…'
          : claimed
            ? tFallback('marketplace.dailyChest.claimed', 'Claimed')
            : tFallback('marketplace.dailyChest.claim', 'Claim')}
      </button>
    </motion.div>
  );
}
