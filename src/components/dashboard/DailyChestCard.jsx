// src/components/dashboard/DailyChestCard.jsx
//
// Dashboard nudge that surfaces the daily chest the moment it's claimable
// and lets the user claim + open it on the spot — no digging through the
// Marketplace. Claiming is the same server-gated claim_daily_chest RPC
// (mig 068) the Marketplace block uses, so a double-tap across surfaces is
// a safe no-op. After a successful claim we pop the Bag open so the fresh
// capsule is one tap from opening ("instant open").

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Gift, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { requestOpenBag } from '@/lib/inventoryFlow';

// Ready when never claimed, or last claim was on a prior UTC day — mirrors
// the server gate in claim_daily_chest (compares UTC date).
function isChestReady(userId) {
  if (!userId) return false;
  try {
    const v = localStorage.getItem(`daily_chest_claimed_${userId}`);
    if (!v) return true;
    const last = new Date(v);
    const now = new Date();
    const sameUtcDay =
      last.getUTCFullYear() === now.getUTCFullYear() &&
      last.getUTCMonth() === now.getUTCMonth() &&
      last.getUTCDate() === now.getUTCDate();
    return !sameUtcDay;
  } catch {
    return true;
  }
}

export default function DailyChestCard() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const [ready, setReady] = useState(() => isChestReady(user?.id));
  const [loading, setLoading] = useState(false);

  if (!user?.id || !ready) return null;

  const claim = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { error } = await supabase.rpc('claim_daily_chest');
      if (error) throw error;
      try { localStorage.setItem(`daily_chest_claimed_${user.id}`, new Date().toISOString()); } catch { /* ignore */ }
      qc.invalidateQueries({ queryKey: ['userCapsules', user.email] });
      qc.invalidateQueries({ queryKey: ['userCapsulesCount', user.email] });
      qc.invalidateQueries({ queryKey: ['userProfile', user.email] });
      setReady(false);
      try { navigator.vibrate?.(20); } catch { /* ignore */ }
      toast.success(tFallback('marketplace.dailyChest.claimSuccess', '🎁 Daily chest claimed! Check your capsules.'));
      requestOpenBag(); // instant-open: jump straight to the Bag
    } catch {
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
      className="w-full mb-3 flex items-center gap-3 rounded-2xl p-3.5 text-left border border-amber-500/30 bg-gradient-to-br from-amber-500/15 to-amber-500/5 hover:from-amber-500/20 transition-colors touch-manipulation disabled:opacity-60"
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
