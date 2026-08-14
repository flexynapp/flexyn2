// src/components/bounties/BountyCard.jsx
// Single bounty card — shown on the board and Dashboard preview.

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Zap, Clock, Loader2, Lock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { claimBounty, DIFFICULTY_CONFIG, bountyDescription } from '@/lib/data/bounties';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { triggerHaptic } from '@/lib/haptic';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';

export default function BountyCard({ bounty, hasActiveClaim = false, compact = false }) {
  const qc = useQueryClient();
  const { language, tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState(false);

  if (!bounty) return null;

  const cfg = DIFFICULTY_CONFIG[bounty.difficulty] || DIFFICULTY_CONFIG.medium;
  const isTaken = !!bounty.claimed_by_id;
  const isExpired = new Date(bounty.expires_at) < new Date();
  const canClaim = !isTaken && !isExpired && !hasActiveClaim && !claimed;

  const timeLeft = !isExpired
    ? formatDistanceToNow(new Date(bounty.expires_at), { addSuffix: false })
    : 'Expired';

  // Pass weightUnit so weight-based bounties render their target in
  // the user's preferred unit. The helper signature gained the param
  // in wave 27 but BountyCard hadn't been wired up to provide it, so
  // kg users still saw "beat 315 lbs" everywhere.
  const description = bountyDescription(bounty, language, weightUnit);

  const handleClaim = async () => {
    if (!canClaim || busy) return;
    triggerHaptic('primary');
    setBusy(true);
    try {
      await claimBounty(bounty.id);
      setClaimed(true);
      toast.success(`Bounty claimed! You have ${cfg.hours}h. Entry fee: ${cfg.entry_fee} 🪙`);
      qc.invalidateQueries({ queryKey: ['activeBounties'] });
      qc.invalidateQueries({ queryKey: ['myActiveBountyClaim'] });
      qc.invalidateQueries({ queryKey: ['userProfile'] });
    } catch (err) {
      const msg = err?.message || '';
      if (/insufficient_coins/.test(msg))       toast.error('Not enough Flex Coins.');
      else if (/already_have_active_claim/.test(msg)) toast.error('Complete your current bounty first.');
      else if (/bounty_already_claimed/.test(msg))    toast.error('Someone else already claimed this bounty.');
      else if (/bounty_expired/.test(msg))            toast.error('This bounty has expired.');
      else if (/cannot_claim_own_bounty/.test(msg))   toast.error("You can't claim a bounty on yourself.");
      else toast.error(tFallback("bountyCard.couldNotClaimBounty", "Could not claim bounty"), { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const dimmed = isTaken || isExpired || claimed;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border border-border bg-card overflow-hidden transition-opacity ${dimmed ? 'opacity-60' : ''}`}
    >
      {/* Amber accent line */}
      <div className={`h-0.5 w-full ${
        bounty.difficulty === 'hard'   ? 'bg-rose-500' :
        bounty.difficulty === 'medium' ? 'bg-amber-500' :
        'bg-emerald-500'
      }`} />

      <div className={`p-4 ${compact ? 'space-y-2' : 'space-y-3'}`}>
        {/* Header row: avatar + name + difficulty badge */}
        <div className="flex items-center gap-2.5">
          {bounty.target_avatar_url ? (
            <img loading="lazy" src={bounty.target_avatar_url} className="w-9 h-9 rounded-full object-cover shrink-0" alt={bounty.target_username} />
          ) : (
            <div className="w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
              <span className="text-sm font-black text-amber-600">{bounty.target_username?.[0]?.toUpperCase()}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-micro text-muted-foreground">{tFallback("hub.activity.target", "Target")}</p>
            <p className="text-sm font-bold truncate">@{bounty.target_username}</p>
          </div>
          <span className={`text-micro font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
            {cfg.label}
          </span>
        </div>

        {/* Description */}
        <p className="text-xs text-foreground leading-relaxed">{description}</p>

        {/* Economy row */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>{tFallback("bountyCard.entry", "Entry")}</span>
            <span className="font-bold text-foreground">{cfg.entry_fee} 🪙</span>
          </div>
          <div className="w-px h-3 bg-border" />
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>{tFallback("bountyCard.reward", "Reward")}</span>
            <span className="font-bold text-amber-500">{cfg.reward} 🪙</span>
          </div>
          <div className="w-px h-3 bg-border" />
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Zap className="w-3 h-3 text-emerald-500" />
            <span className="font-bold text-emerald-500">+{cfg.net}</span>
          </div>
        </div>

        {/* Footer: time + CTA */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-micro text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>{isExpired ? 'Expired' : `${timeLeft} left`}</span>
          </div>

          {(isTaken || claimed) ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-secondary text-xs font-semibold text-muted-foreground">
              <Lock className="w-3 h-3" />
              {tFallback("marketplace.dailyChest.claimed", "Claimed")}
            </div>
          ) : hasActiveClaim ? (
            <div className="px-3 py-1.5 rounded-xl bg-secondary text-xs font-semibold text-muted-foreground">
              {tFallback("bountyCard.finishActiveBountyFirst", "Finish active bounty first")}
            </div>
          ) : isExpired ? (
            <div className="px-3 py-1.5 rounded-xl bg-secondary text-xs font-semibold text-muted-foreground">
              {tFallback("duels.status.expired", "Expired")}
            </div>
          ) : (
            <button
              onClick={handleClaim}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 active:bg-amber-600 active:scale-[0.97] transition-all disabled:opacity-50"
            >
              {busy
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Zap className="w-3 h-3" />
              }
              Claim · {cfg.entry_fee} 🪙
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
