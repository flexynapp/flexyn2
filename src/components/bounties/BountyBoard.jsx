// src/components/bounties/BountyBoard.jsx
// Full bounty board — Active tab (claimable bounties) + My Bounties tab (history).

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, History, Loader2, RefreshCw, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import {
  listActiveBounties,
  getMyActiveClaim,
  getMyClaims,
  generateDemoBounties,
  bountyDescription,
  DIFFICULTY_CONFIG,
} from '@/lib/data/bounties';
import BountyCard from './BountyCard';
import { toast } from '@/lib/toast';
import { formatRelativeTime } from '@/lib/intl';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';

// ── Claim history row ─────────────────────────────────────────────────────────

function ClaimRow({ claim }) {
  const { language, tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const bounty = claim.bounties;
  if (!bounty) return null;
  const cfg = DIFFICULTY_CONFIG[bounty.difficulty] || DIFFICULTY_CONFIG.medium;

  // Four single-word statuses, and all four already exist translated under
  // four different namespaces. Taking them from where they are beats minting
  // bountyBoard.status.* synonyms that start life untranslated in every
  // locale — a translator gains nothing by rendering "Expired" twice.
  const statusConfig = {
    completed: { icon: CheckCircle, color: 'text-emerald-500', label: tFallback('hub.activity.completed', 'Completed'), bg: 'bg-emerald-500/10' },
    failed:    { icon: XCircle,     color: 'text-rose-500',    label: tFallback('weeklyGauntletCard.failed', 'Failed'),  bg: 'bg-rose-500/10'    },
    expired:   { icon: Clock,       color: 'text-muted-foreground', label: tFallback('duels.status.expired', 'Expired'), bg: 'bg-secondary'    },
    active:    { icon: Zap,         color: 'text-amber-500',   label: tFallback('duels.status.active', 'Active'),        bg: 'bg-amber-500/10'   },
  };
  const sc = statusConfig[claim.status] || statusConfig.active;
  const Icon = sc.icon;

  const coins = claim.status === 'completed'
    ? `+${bounty.reward} 🪙`
    : claim.status === 'failed' || claim.status === 'expired'
    ? `-${bounty.entry_fee} 🪙`
    : null;

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card">
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${sc.bg}`}>
        <Icon className={`w-4 h-4 ${sc.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground leading-snug">
          {bountyDescription(bounty, language, weightUnit)}
        </p>
        <p className="text-micro text-muted-foreground mt-0.5">
          @{bounty.target_username} · {tFallback(`bounty.difficulty.${bounty.difficulty}`, cfg.label)}
        </p>
        <p className="text-micro text-muted-foreground">
          {formatRelativeTime(claim.claimed_at, language)}
        </p>
      </div>
      {coins && (
        <span className={`text-xs font-bold shrink-0 ${claim.status === 'completed' ? 'text-emerald-500' : 'text-rose-500'}`}>
          {coins}
        </span>
      )}
    </div>
  );
}

// ── Main board ────────────────────────────────────────────────────────────────

export default function BountyBoard() {
  const { user } = useAuth();
  const { language, tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const qc = useQueryClient();
  const [tab, setTab] = useState('active'); // 'active' | 'mine'

  const { data: bounties = [], isLoading: bountiesLoading } = useQuery({
    queryKey:  ['activeBounties'],
    queryFn:   listActiveBounties,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const { data: activeClaim } = useQuery({
    queryKey:  ['myActiveBountyClaim'],
    queryFn:   getMyActiveClaim,
    enabled:   !!user?.id,
    staleTime: 60_000,
  });

  const { data: myHistory = [], isLoading: historyLoading } = useQuery({
    queryKey:  ['myBountyClaims'],
    queryFn:   () => getMyClaims(20),
    enabled:   tab === 'mine' && !!user?.id,
    staleTime: 60_000,
  });

  const generateMut = useMutation({
    mutationFn: generateDemoBounties,
    onSuccess: (data) => {
      toast.success(tFallback('notice.bountiesGenerated', '{n} bounties generated', { n: data.length }));
      qc.invalidateQueries({ queryKey: ['activeBounties'] });
    },
    onError: (err) => toast.error(tFallback("bountyBoard.couldNotGenerateBounties", "Could not generate bounties"), { description: err.message }),
  });

  const hasActiveClaim = !!activeClaim;

  return (
    <div className="space-y-4">
      {/* Active claim notice */}
      {activeClaim && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-amber-500/30 bg-amber-500/5"
        >
          <Zap className="w-4 h-4 text-amber-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-amber-600">{tFallback("bountyBoard.activeBounty", "Active Bounty")}</p>
            <p className="text-xs text-muted-foreground truncate">
              {bountyDescription(activeClaim.bounties, language, weightUnit)}
              {' · '}
              {tFallback('bountyBoard.rewardCoins', 'Reward: {n} 🪙', { n: DIFFICULTY_CONFIG[activeClaim.bounties?.difficulty]?.reward })}
            </p>
          </div>
        </motion.div>
      )}

      {/* Tab strip */}
      <div className="flex gap-1 p-1 bg-secondary rounded-xl border border-border">
        <button
          onClick={() => setTab('active')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold rounded-lg transition-colors ${
            tab === 'active'
              ? 'bg-amber-500 text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground active:text-foreground'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          {tFallback("bountyBoard.board", "Board")}
        </button>
        <button
          onClick={() => setTab('mine')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold rounded-lg transition-colors ${
            tab === 'mine'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground active:text-foreground'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          {tFallback("bountyBoard.myBounties", "My Bounties")}
        </button>
      </div>

      <AnimatePresence mode="wait">
        {tab === 'active' ? (
          <motion.div
            key="active"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.15 }}
            className="space-y-3"
          >
            {bountiesLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : bounties.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center py-16 px-6 text-center"
              >
                <div className="w-16 h-16 rounded-3xl bg-amber-500/10 flex items-center justify-center mb-4">
                  <Zap className="w-8 h-8 text-amber-500" />
                </div>
                <p className="font-heading font-bold text-lg mb-2">{tFallback("bountyBoard.noActiveBounties", "No Active Bounties")}</p>
                <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                  Bounties are generated daily based on your social graph. Come back tomorrow — or generate sample bounties to test the feature.
                </p>
                <button
                  onClick={() => generateMut.mutate()}
                  disabled={generateMut.isPending}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 active:bg-amber-600 disabled:opacity-50 transition-colors"
                >
                  {generateMut.isPending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <RefreshCw className="w-4 h-4" />
                  }
                  {generateMut.isPending ? 'Generating…' : 'Generate Bounties (Beta)'}
                </button>
              </motion.div>
            ) : (
              <>
                {bounties.map(b => (
                  <BountyCard
                    key={b.id}
                    bounty={b}
                    hasActiveClaim={hasActiveClaim}
                  />
                ))}
                {/* Refresh / generate more */}
                <div className="flex justify-center pt-2">
                  <button
                    onClick={() => generateMut.mutate()}
                    disabled={generateMut.isPending}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground active:text-foreground transition-colors disabled:opacity-50"
                  >
                    {generateMut.isPending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <RefreshCw className="w-3.5 h-3.5" />
                    }
                    {generateMut.isPending ? 'Generating…' : 'Generate more'}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="mine"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.15 }}
            className="space-y-2"
          >
            {historyLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : myHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <History className="w-10 h-10 text-muted-foreground/40 mb-4" />
                <p className="text-sm font-semibold text-muted-foreground">{tFallback("bountyBoard.noClaimsYet", "No claims yet")}</p>
                <p className="text-xs text-muted-foreground mt-1">{tFallback("bountyBoard.claimToGetStarted", "Claim a bounty from the board to get started.")}</p>
              </div>
            ) : (
              myHistory.map(claim => (
                <ClaimRow key={claim.id} claim={claim} />
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
