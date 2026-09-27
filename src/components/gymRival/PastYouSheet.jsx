// src/components/gymRival/PastYouSheet.jsx
//
// The Past You race: the lifter against a ghost built from their own logs
// (migration 20260927130000). Same frame as GymRivalMenu so the two read as
// one feature.
//
// The ghost's number on screen is its PACE: where it would be now if it
// trained evenly across the week. That is the number to beat today, and it
// reaches the week's target at the finish. Every figure comes from the
// server, which scores both sides with the scorer the human match uses.

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Ghost, Dumbbell, Footprints, Trophy, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { getPastYouState, abandonPastYou, ghostBoostPct, pastYouBasis } from '@/lib/data/pastYou';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { formatDistance } from '@/lib/distanceUnit';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { formatWeight } from '@/lib/weightUnit';
import { useNumberFormatter, useDateFormatter, formatDuration } from '@/lib/intl';
import { useLanguage } from '@/lib/LanguageContext';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

export const PAST_YOU_REWARD = { xp: 1000, coins: 100, capsules: 1 };

function Row({ label, children, valueClass = '' }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-border last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-bold text-end ${valueClass}`}>{children}</span>
    </div>
  );
}

export default function PastYouSheet({ open, onClose, match }) {
  const { tFallback, language } = useLanguage();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { weightUnit } = useWeightUnit();
  const { distanceUnit } = useDistanceUnit();
  const fmt = useNumberFormatter();
  const fmtDate = useDateFormatter();
  const [confirmQuit, setConfirmQuit] = useState(false);
  useBodyScrollLock(open);

  const { data: state } = useQuery({
    queryKey: ['pastYouState', match?.id],
    queryFn: () => getPastYouState(match.id),
    enabled: open && !!match?.id,
    staleTime: 60_000,
  });

  const quitMut = useMutation({
    mutationFn: () => abandonPastYou(match.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['myPastYou'] });
      setConfirmQuit(false);
      onClose?.();
    },
    onError: () => toast.error(tFallback('pastYou.quitFailed', 'Could not end the race. Try again.')),
  });

  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [open]);
  useEffect(() => { if (!open) setConfirmQuit(false); }, [open]);

  const left = useMemo(
    () => (state?.endsAt ? state.endsAt.getTime() - Date.now() : null),
    [state?.endsAt, tick],
  );

  if (!open || !match) return null;

  const isCardio = match.rival_type === 'cardio';
  const settled = match.status === 'completed';
  const metricText = (v) => (isCardio ? formatDistance(v || 0, distanceUnit, v >= 1000 ? 1 : 2) : formatWeight(v || 0, weightUnit));

  const you = settled ? Number(match.final_score) || 0 : (state?.you ?? null);
  const target = Number(state?.target ?? match.target) || 0;
  const pace = settled ? target : (state?.ghostPace ?? null);
  const level = state?.level ?? match.level;
  const weeks = state?.baselineWeeks ?? match.baseline_weeks;
  const boost = ghostBoostPct(level);

  const gap = you != null && pace != null ? you - pace : null;
  const gapText = gap == null
    ? tFallback('pastYou.loading', 'Loading the race')
    : gap > 0
      ? tFallback('pastYou.ahead', "You're {v} ahead of Past You", { v: metricText(gap) })
      : gap < 0
        ? tFallback('pastYou.behind', 'Past You is {v} ahead', { v: metricText(-gap) })
        : tFallback('pastYou.level', 'Dead level with Past You');
  const gapTone = gap > 0 ? 'text-success' : gap < 0 ? 'text-primary' : 'text-foreground';

  // The bar is the week's target. Your fill and the ghost's marker sit on it.
  const pctOf = (v) => (target > 0 ? Math.min(100, Math.max(0, (v / target) * 100)) : 0);

  const basisKind = pastYouBasis(match.rival_type, state?.baseline ?? match.baseline, weeks);
  const basis = basisKind === 'weeks'
    ? tFallback('pastYou.basisWeeks', 'Your average over the last {n} training weeks', { n: String(weeks) })
    : basisKind === 'floor'
      ? tFallback('pastYou.basisFloor', 'The minimum target. Your recent weeks were lighter than this')
      : tFallback('pastYou.basisStarter', 'A starter target, until you have some history');

  return createPortal(
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] bg-background overflow-y-auto safe-page">
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 h-14 bg-background border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <Ghost className="w-4 h-4 text-primary shrink-0" />
            <h2 className="font-heading font-black text-base truncate">{tFallback('pastYou.title', 'Past You')}</h2>
          </div>
          <button onClick={onClose} aria-label={tFallback('common.close', 'Close')}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-secondary active:bg-secondary transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="max-w-lg mx-auto px-4 pt-6 pb-24">
          {settled ? (
            <div className="text-center mb-6">
              <div className={`w-16 h-16 rounded-full mx-auto mb-2 flex items-center justify-center ${match.won ? 'bg-success/10' : 'bg-secondary'}`}>
                {match.won ? <Trophy className="w-8 h-8 text-success" /> : <Ghost className="w-8 h-8 text-muted-foreground" />}
              </div>
              <p className="font-heading font-black text-2xl">
                {match.won ? tFallback('pastYou.youWon', 'You beat Past You') : tFallback('pastYou.youLost', 'Past You held on')}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {tFallback('pastYou.finalLine', '{you} against a target of {target}', { you: metricText(you), target: metricText(target) })}
              </p>
              <p className="text-sm font-bold mt-2">
                {tFallback('pastYou.nextLevel', 'Past You is level {n} next week', { n: String(match.next_level ?? level) })}
              </p>
            </div>
          ) : (
            <div className="mb-6">
              <p className="text-micro font-black uppercase tracking-wider text-muted-foreground">
                {isCardio ? tFallback('gymRivalMenu.metricDistance', 'Total distance this week') : tFallback('gymRivalMenu.metricVolume', 'Total volume this week')}
              </p>
              <div className="flex items-end justify-between gap-2 mt-2">
                <span className="text-micro font-black uppercase tracking-wider text-success">{tFallback('friendLeaderboard.you', 'You')}</span>
                <span className="text-micro font-black uppercase tracking-wider text-primary">{tFallback('pastYou.title', 'Past You')}</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-heading font-black text-3xl tabular-nums text-success">{you == null ? '—' : metricText(you)}</span>
                <span className="font-heading font-black text-3xl tabular-nums">{pace == null ? '—' : metricText(pace)}</span>
              </div>
              <div className="relative mt-2 h-2.5 rounded-full bg-secondary" aria-hidden="true">
                <span className="absolute inset-y-0 start-0 bg-success rounded-full" style={{ width: `${pctOf(you || 0)}%` }} />
                {pace != null && (
                  <span className="absolute -top-1 -bottom-1 w-0.5 bg-primary rounded-full" style={{ insetInlineStart: `${pctOf(pace)}%` }} />
                )}
              </div>
              <p className={`text-sm font-black mt-2 ${gapTone}`}>{gapText}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {tFallback('pastYou.paceExplainer', 'Past You trains evenly all week and finishes on {target}.', { target: metricText(target) })}
              </p>
            </div>
          )}

          <div className="mb-6">
            <Row label={tFallback('pastYou.targetRow', 'Target')}>{metricText(target)}</Row>
            <Row label={tFallback('pastYou.levelRow', 'Past You level')}>
              {boost > 0
                ? tFallback('pastYou.levelValue', 'Level {n}, {p}% stronger', { n: String(level), p: String(boost) })
                : tFallback('pastYou.levelOne', 'Level 1')}
            </Row>
            <Row label={tFallback('pastYou.basisRow', 'Built from')} valueClass="max-w-[60%]">{basis}</Row>
            <Row label={tFallback('pastYou.prsRow', 'PRs this week')}>{fmt(settled ? (match.prs ?? 0) : (state?.prs ?? 0))}</Row>
            {!settled && state?.endsAt && (
              <>
                <Row label={tFallback('gymRivalMenu.ends', 'Ends')}>{fmtDate(state.endsAt, { dateStyle: 'medium' })}</Row>
                <Row label={tFallback('gymRivalMenu.remaining', 'Remaining')}>
                  {left > 0 ? formatDuration(left, language) : tFallback('gymRivalMenu.settlingNow', 'settling now')}
                </Row>
              </>
            )}
          </div>

          <p className="text-xs text-muted-foreground mb-6">
            {tFallback('pastYou.howItGrows', 'Beat Past You and it gets 4% stronger. Every PR you set makes it stronger too, because you are. Fall short and it eases off.')}
          </p>

          {!settled && (
            <>
              <div className="mb-6">
                <p className="text-micro font-black uppercase tracking-wider text-primary">{tFallback('gymRivalMenu.winnerTakes', 'Winner takes')}</p>
                <p className="font-heading font-black text-base mt-1 tabular-nums">
                  {tFallback('pastYou.prizeLine', '{xp} XP · {coins} coins · {caps} capsule', {
                    xp: fmt(PAST_YOU_REWARD.xp), coins: fmt(PAST_YOU_REWARD.coins), caps: String(PAST_YOU_REWARD.capsules),
                  })}
                </p>
              </div>

              <button onClick={() => { onClose?.(); navigate(isCardio ? '/workout?openCardio=1' : '/workout?freestyle=1'); }}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-white font-black text-sm active:scale-[0.98] transition-all">
                {isCardio ? <Footprints className="w-4 h-4" /> : <Dumbbell className="w-4 h-4" />}
                {isCardio ? tFallback('gymRivalMenu.startCardio', 'Start a cardio session') : tFallback('gymRivalMenu.logWorkout', 'Log a workout')}
              </button>

              {confirmQuit ? (
                <div className="mt-2 rounded-xl border border-border p-3">
                  <p className="text-xs text-muted-foreground mb-2">
                    {tFallback('pastYou.quitConfirm', 'End this race? You get no reward, and Past You stays at level {n}.', { n: String(level) })}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => setConfirmQuit(false)}
                      className="flex-1 py-2.5 rounded-lg border border-border text-sm font-bold">
                      {tFallback('pastYou.keepRacing', 'Keep racing')}
                    </button>
                    <button onClick={() => quitMut.mutate()} disabled={quitMut.isPending}
                      className="flex-1 py-2.5 rounded-lg bg-destructive text-white text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50">
                      {quitMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                      {tFallback('pastYou.endRace', 'End race')}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setConfirmQuit(true)}
                  className="mt-2 w-full py-3 rounded-xl border border-border text-sm font-bold hover:bg-secondary/60 active:bg-secondary/60 transition-colors">
                  {tFallback('pastYou.endRace', 'End race')}
                </button>
              )}
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
