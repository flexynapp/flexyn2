// src/components/bounties/SoloChallengesSection.jsx
//
// Solo Challenges board — rendered above the existing targeted
// Bounty Board on the Bounties page. These are non-targeted ("lift
// 5,000 lbs this week") so anyone can claim independently.
//
// Each card shows: title, description, target/progress, difficulty
// chip, reward (coins). Tapping "Claim" pulls the user's claim
// into existence; subsequent renders show progress + a "Complete"
// CTA once the target is met.

import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Zap, Check, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import {
  listActiveSoloChallenges,
  listMyClaims,
  claimSoloChallenge,
  completeSoloChallenge,
  SOLO_DIFFICULTY,
} from '@/lib/data/soloChallenges';
import { formatDistanceToNowStrict } from 'date-fns';

function ProgressBar({ value, max, color }) {
  // Always show the bar so an at-zero claim still visually exists.
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className={`h-full ${color || 'bg-primary'} rounded-full`}
      />
    </div>
  );
}

export default function SoloChallengesSection() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const qc = useQueryClient();

  const { data: challenges = [], isLoading: chLoading } = useQuery({
    queryKey: ['soloChallenges'],
    queryFn:  listActiveSoloChallenges,
    staleTime: 60_000,
  });

  const { data: claims = [] } = useQuery({
    queryKey: ['soloChallengeClaims', user?.id],
    queryFn:  listMyClaims,
    enabled:  !!user?.id,
    staleTime: 30_000,
  });

  const claimByChallenge = React.useMemo(() => {
    const map = new Map();
    for (const c of claims) map.set(c.challenge_id, c);
    return map;
  }, [claims]);

  const claimMut = useMutation({
    mutationFn: (challengeId) => claimSoloChallenge(challengeId),
    onSuccess: (res, challengeId) => {
      if (!res.ok) {
        toast.error(res.reason === 'rpc_missing'
          ? tFallback('soloChallenges.notDeployed', 'Solo challenges aren’t live yet on this server. Run migration 171.')
          : tFallback('soloChallenges.claimFailed', 'Could not claim. Try again.'),
        );
        return;
      }
      qc.invalidateQueries({ queryKey: ['soloChallengeClaims', user?.id] });
      toast.success(tFallback('soloChallenges.claimed', 'Claimed! Log a workout to make progress.'));
    },
  });

  const completeMut = useMutation({
    mutationFn: (claimId) => completeSoloChallenge(claimId),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(tFallback('soloChallenges.completeFailed', 'Could not finish. Try again.'));
        return;
      }
      if (res.already_completed) {
        toast.message(tFallback('soloChallenges.already', 'Already collected.'));
      } else {
        toast.success(tFallback('notice.challengeCoins', 'Challenge complete! +{coins} coins', { coins: res.coins_awarded }));
      }
      qc.invalidateQueries({ queryKey: ['soloChallengeClaims', user?.id] });
      qc.invalidateQueries({ queryKey: ['userProfile', user?.email] });
    },
  });

  if (chLoading) {
    return (
      <div className="mb-5 space-y-2 animate-pulse">
        <div className="h-3 w-32 rounded bg-secondary" />
        <div className="h-20 rounded-xl bg-secondary" />
        <div className="h-20 rounded-xl bg-secondary" />
      </div>
    );
  }

  if (challenges.length === 0) return null;

  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-heading font-bold text-sm uppercase tracking-[0.18em] text-muted-foreground">
          {tFallback('soloChallenges.title', 'Solo Challenges')}
        </h2>
        <p className="text-micro text-muted-foreground/70">
          {tFallback('soloChallenges.subtitle', 'No target, just hit the number')}
        </p>
      </div>

      <div className="space-y-2">
        {challenges.map((ch) => {
          const claim = claimByChallenge.get(ch.id);
          const diff = SOLO_DIFFICULTY[ch.difficulty] || SOLO_DIFFICULTY.medium;
          const status = claim?.status; // 'active' | 'completed' | undefined
          const progress = Number(claim?.progress ?? 0);
          const target   = Number(ch.target_value ?? 0);
          const isReadyToComplete = status === 'active' && progress >= target && target > 0;
          const expiresSoon = ch.expires_at && formatDistanceToNowStrict(new Date(ch.expires_at), { addSuffix: false });

          return (
            <motion.div
              key={ch.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-xl border ${diff.border} ${diff.bg} p-3`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg ${diff.bg} ${diff.color} flex items-center justify-center shrink-0`}>
                  <Zap className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <p className="font-heading font-bold text-sm leading-tight">{ch.title}</p>
                    <span className={`text-micro font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${diff.bg} ${diff.color}`}>
                      {tFallback(`bounty.difficulty.${ch.difficulty}`, diff.label)}
                    </span>
                  </div>
                  {ch.description && (
                    <p className="text-micro text-muted-foreground leading-snug mb-2">{ch.description}</p>
                  )}
                  <div className="flex items-center gap-2 text-micro text-muted-foreground mb-1.5">
                    <span className="tabular-nums">
                      {fmt(Math.round(progress))} / {fmt(target)} {ch.target_unit || ''}
                    </span>
                    <span>·</span>
                    <span className={diff.color + ' font-bold'}>
                      🪙 {fmt(ch.reward_coins)}
                    </span>
                    {expiresSoon && (
                      <>
                        <span>·</span>
                        <span>{expiresSoon} left</span>
                      </>
                    )}
                  </div>
                  <ProgressBar value={progress} max={target} color={diff.color.replace('text-', 'bg-')} />
                </div>
              </div>
              <div className="mt-3">
                {status === 'completed' ? (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-500">
                    <Check className="w-3.5 h-3.5" /> {tFallback('soloChallenges.completed', 'Completed')}
                  </span>
                ) : isReadyToComplete ? (
                  <button
                    type="button"
                    onClick={() => completeMut.mutate(claim.id)}
                    disabled={completeMut.isPending}
                    className={`w-full py-2 rounded-lg text-xs font-bold text-white ${diff.color.replace('text-', 'bg-')} hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center justify-center gap-1.5`}
                  >
                    {completeMut.isPending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Check className="w-3.5 h-3.5" />}
                    {tFallback('soloChallenges.collect', 'Collect reward')}
                  </button>
                ) : status === 'active' ? (
                  <span className="text-micro text-muted-foreground italic">
                    {tFallback('soloChallenges.inProgress', 'Active. Keep logging workouts')}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => claimMut.mutate(ch.id)}
                    disabled={claimMut.isPending}
                    className="w-full py-2 rounded-lg text-xs font-bold border border-border bg-background/60 hover:bg-secondary active:bg-secondary text-foreground transition-colors disabled:opacity-60"
                  >
                    {claimMut.isPending ? '…' : tFallback('soloChallenges.claim', 'Claim challenge')}
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
