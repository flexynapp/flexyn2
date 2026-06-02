// src/components/dashboard/DailyChestCard.jsx
//
// Dashboard nudge that surfaces the daily chest the moment it's claimable
// and lets the user claim + open it on the spot — no digging through the
// Marketplace. Claiming is the same server-gated claim_daily_chest RPC
// (mig 068) the Marketplace block uses, so a double-tap across surfaces is
// a safe no-op. After a successful claim we pop the Bag open so the fresh
// capsule is one tap from opening ("instant open").

import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Gift, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { requestOpenBag } from '@/lib/inventoryFlow';
import { isDailyChestReady } from '@/lib/dailyChest';
import { reportError } from '@/lib/reportError';

export default function DailyChestCard() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const [ready, setReady] = useState(() => isDailyChestReady(user?.id));
  const [loading, setLoading] = useState(false);

  // Re-check chest readiness on midnight rollover (and when the user
  // returns to the tab) so a PWA left open overnight surfaces the
  // fresh chest without requiring a manual refresh.
  useEffect(() => {
    if (!user?.id) return undefined;
    const recheck = () => setReady(isDailyChestReady(user.id));
    const id = setInterval(recheck, 60 * 1000);
    const onVis = () => { if (document.visibilityState === 'visible') recheck(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [user?.id]);

  if (!user?.id || !ready) return null;

  const claim = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('claim_daily_chest');
      if (error) throw error;
      try { localStorage.setItem(`daily_chest_claimed_${user.id}`, new Date().toISOString()); } catch { /* ignore */ }
      qc.invalidateQueries({ queryKey: ['userCapsules', user.email] });
      qc.invalidateQueries({ queryKey: ['userCapsulesCount', user.email] });
      qc.invalidateQueries({ queryKey: ['userProfile', user.email] });
      setReady(false);
      // Inspect the RPC response so the "already claimed" path no
      // longer fires the same success toast + auto-opens the bag —
      // which the user reported as "the daily chest icon has popped
      // up three times and it even says that it's claimed but when
      // you go to your bag, it's not there." The RPC returns
      // { already_claimed, coins_awarded, new_balance } so we can
      // branch on actual server state instead of trusting any
      // non-error response.
      if (data?.already_claimed === true) {
        toast.message(
          tFallback('marketplace.dailyChest.alreadyClaimed', 'Already claimed today.'),
          { description: tFallback('marketplace.dailyChest.comeBack', 'Come back tomorrow for another reward.') },
        );
      } else {
        try { navigator.vibrate?.(20); } catch { /* ignore */ }
        const coins = data?.coins_awarded ?? 75;
        toast.success(
          tFallback('marketplace.dailyChest.claimSuccess', '🎁 Daily chest claimed! Check your capsules.'),
          { description: `+${coins} coins · 1 standard capsule` },
        );
        requestOpenBag(); // instant-open: jump straight to the Bag
      }
    } catch (err) {
      // Report so a regression in the claim RPC isn't silent — the user
      // sees a toast, but observability needs the underlying error too.
      reportError(err, { feature: 'dashboard.dailyChest.claim', level: 'warning', userId: user?.id });
      toast.error(tFallback('marketplace.dailyChest.claimFailed', 'Could not claim — try again in a moment.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.button
      type="button"
      onClick={claim}
      disabled={loading}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="w-full mb-3 flex items-center gap-3 rounded-2xl p-3.5 text-start border border-amber-500/30 bg-gradient-to-br from-amber-500/15 to-amber-500/5 hover:from-amber-500/20 transition-colors touch-manipulation disabled:opacity-60"
    >
      <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
        <Gift className="w-5 h-5 text-amber-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-foreground">
          {tFallback('dashboard.dailyChest.title', 'Your daily chest is ready')}
        </p>
        <p className="text-xs text-muted-foreground">
          {tFallback('dashboard.dailyChest.subtitle', 'Free capsule + coins — tap to open')}
        </p>
      </div>
      <span className="shrink-0 px-3 py-1.5 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center gap-1">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (tFallback('dashboard.dailyChest.open', 'Open'))}
      </span>
    </motion.button>
  );
}
