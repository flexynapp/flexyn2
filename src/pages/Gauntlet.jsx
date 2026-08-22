// src/pages/Gauntlet.jsx
// The Gauntlet screen: community weekly challenge at top, personal 10-challenge
// winding path below. Tap any node to see its detail card. Completion triggers
// the stats modal with share.
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Swords, ChevronLeft, X, Zap, Lock, Dumbbell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/lib/LanguageContext';
import { useDateFormatter } from '@/lib/intl';
import { reportError } from '@/lib/reportError';
import { toast } from '@/lib/toast';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useAuth } from '@/lib/AuthContext';
import { db } from '@/api/db';
import { totalVolume } from '@/lib/workoutVolume';
import {
  getGauntletChallenges,
  getMyProgress,
  getMyCompletions,
  getActiveCommunityGauntlet,
  getCommunityGauntletAttempt,
  startCommunityGauntletAttempt,
  completeCommunityGauntletAttempt,
} from '@/lib/data/gauntlet';
import GauntletPath from '@/components/gauntlet/GauntletPath';
import WeeklyGauntletCard from '@/components/gauntlet/WeeklyGauntletCard';
import GauntletStatsModal from '@/components/gauntlet/GauntletStatsModal';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

// Challenge-type readable label — stored as i18n keys + fallbacks; resolved
// at render-time via t() so the same map works for every locale.
const TYPE_LABEL = {
  single_session: { i18nKey: 'gauntlet.type.singleSession', fallback: 'Single Session' },
  weekly_volume:  { i18nKey: 'gauntlet.type.weeklyVolume',  fallback: 'Weekly Volume' },
  streak:         { i18nKey: 'gauntlet.type.streak',        fallback: 'Streak' },
  nutrition:      { i18nKey: 'gauntlet.type.nutrition',     fallback: 'Nutrition' },
  pr:             { i18nKey: 'gauntlet.type.pr',            fallback: 'Personal Record' },
  final:          { i18nKey: 'gauntlet.type.finalBoss',     fallback: 'Final Boss' },
};

// Metric readable description. Takes `t` so the strings can localize;
// templates use {n} for the dynamic value (number formatting still done here).
function metricHint(challenge, t) {
  const { metric, target_value: tv } = challenge;
  if (!metric) return null;
  const fmtLbs = (v) => v >= 1000 ? `${Math.round(v / 1000)}K` : String(v);
  const fill = (key, fallback, value) => t?.(key, { n: String(value) }) || fallback.replace('{n}', String(value));
  if (metric === 'session_volume')         return fill('gauntlet.hint.sessionVolume',      '{n} lbs in one session',                  fmtLbs(tv));
  if (metric === 'weekly_lbs')             return fill('gauntlet.hint.weeklyLbs',          '{n} lbs in one week',                     fmtLbs(tv));
  if (metric === 'sessions_in_7_days')     return fill('gauntlet.hint.sessionsIn7Days',    '{n} sessions within any 7-day window',    tv);
  if (metric === 'sessions_in_5_days')     return fill('gauntlet.hint.sessionsIn5Days',    '{n} sessions within any 5-day window',    tv);
  if (metric === 'consecutive_days')       return fill('gauntlet.hint.consecutiveDays',    '{n}-day consecutive streak',              tv);
  if (metric === 'min_exercises_no_skip')  return fill('gauntlet.hint.minExercisesNoSkip', '{n}+ exercises, zero skipped sets',       tv);
  if (metric === 'any_compound_pr')        return t?.('gauntlet.hint.anyCompoundPr') || 'New PR on any compound lift';
  return null;
}

// ── Challenge detail card (shown when node is tapped) ────────────────────────
function ChallengeDetail({ challenge, status, completedAt, onClose, onStartWorkout }) {
  const { t, tFallback } = useLanguage();
  const fmtDate = useDateFormatter();
  const hint = metricHint(challenge, t);
  const isLocked = status === 'locked';

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className="rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
    >
      {/* Status strip at top */}
      <div className={`px-4 py-2.5 flex items-center justify-between ${
        status === 'completed' ? 'bg-emerald-500/15' :
        status === 'active'    ? 'bg-amber-500/15' :
        'bg-secondary/60'
      }`}>
        <div className="flex items-center gap-2">
          {status === 'completed' && <span className="text-emerald-400 text-sm font-bold">✓ Completed</span>}
          {status === 'active'    && <span className="text-amber-400 text-sm font-bold">⚡ Your Current Challenge</span>}
          {status === 'next'      && <span className="text-muted-foreground text-sm font-medium">{tFallback("gauntlet.upNext", "Up Next")}</span>}
          {status === 'locked'    && (
            <span className="text-muted-foreground/50 text-sm flex items-center gap-1.5">
              <Lock className="w-3 h-3" /> {tFallback("progress.locked", "Locked")}
            </span>
          )}
          {completedAt && status === 'completed' && (
            <span className="text-xs text-muted-foreground">
              · {fmtDate(completedAt, { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 py-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-lg ${
            status === 'completed' ? 'bg-emerald-500/15' :
            status === 'active'    ? 'bg-amber-500/15' :
            'bg-secondary'
          }`}>
            {challenge.sequence_number}
          </div>
          <div className="flex-1 min-w-0">
            <span className={`text-micro font-bold uppercase tracking-widest block mb-0.5 ${
              isLocked ? 'text-muted-foreground/30' : 'text-muted-foreground'
            }`}>
              {(() => {
                const cfg = TYPE_LABEL[challenge.type];
                return cfg ? (t(cfg.i18nKey) || cfg.fallback) : challenge.type;
              })()}
            </span>
            <h3 className={`font-heading font-bold text-base leading-tight ${
              isLocked ? 'text-muted-foreground/40' : 'text-foreground'
            }`}>
              {challenge.title}
            </h3>
          </div>
        </div>

        {/* Description */}
        {!isLocked && (
          <>
            <p className="text-sm text-muted-foreground leading-relaxed mb-2">
              {challenge.description}
            </p>
            {hint && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary/60 mb-3">
                <span className="text-xs font-bold text-foreground">{tFallback("gauntlet.goal", "Goal:")}</span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </div>
            )}
            <p className="text-xs italic text-muted-foreground/60 mb-4">
              "{challenge.flavor_text}"
            </p>
          </>
        )}

        {isLocked && (
          <p className="text-sm text-muted-foreground/40 italic mb-4">
            {tFallback('gauntlet.lockedHint', 'Complete the challenges before this one to unlock.')}
          </p>
        )}

        {/* Rewards row */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span className={`text-sm font-bold ${isLocked ? 'text-muted-foreground/30' : 'text-amber-400'}`}>
              {challenge.xp_reward} XP
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm">🪙</span>
            <span className={`text-sm font-bold ${isLocked ? 'text-muted-foreground/30' : 'text-yellow-400'}`}>
              {challenge.coin_reward} coins
            </span>
          </div>
        </div>

        {/* Go to Workout — gauntlet challenges complete passively when you
            log a qualifying workout, so the actionable step is to start
            one. Shown for the challenges you can actually attempt now. */}
        {!isLocked && status !== 'completed' && onStartWorkout && (
          <button
            type="button"
            onClick={onStartWorkout}
            className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-opacity"
          >
            <Dumbbell className="w-4 h-4" />
            {status === 'active' ? 'Start this challenge' : 'Go to Workout'}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Gauntlet() {
  const { tFallback } = useLanguage();
  const navigate = useNavigate();
  const qc       = useQueryClient();
  const { user } = useAuth();
  const [selectedChallenge, setSelectedChallenge] = useState(null);
  const [statsModal, setStatsModal]               = useState(null);
  // { seq: number, available: boolean } — set when user taps a chest
  const [chestModal,  setChestModal]              = useState(null);
  // Two modals over a page that scrolls — hold it for either. See
  // @/lib/scrollLock.
  useBodyScrollLock(!!selectedChallenge || !!chestModal);

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: challenges = [] } = useQuery({
    queryKey: ['gauntlet-challenges'],
    queryFn:  getGauntletChallenges,
    staleTime: Infinity,
  });

  const { data: progress } = useQuery({
    queryKey: ['gauntlet-progress'],
    queryFn:  getMyProgress,
    staleTime: 60_000,
  });

  const { data: completions = [] } = useQuery({
    queryKey: ['gauntlet-completions'],
    queryFn:  getMyCompletions,
    staleTime: 60_000,
  });

  const { data: weeklyGauntlet } = useQuery({
    queryKey: ['weekly-gauntlet-active'],
    queryFn:  getActiveCommunityGauntlet,
    staleTime: 5 * 60_000,
  });

  const { data: weeklyAttempt } = useQuery({
    queryKey: ['weekly-gauntlet-attempt', weeklyGauntlet?.id],
    queryFn:  () => getCommunityGauntletAttempt(weeklyGauntlet.id),
    enabled:  !!weeklyGauntlet?.id,
    staleTime: 60_000,
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentSeq    = progress?.current_challenge_sequence ?? 1;
  const completedSeqs = new Set(completions.map(c => c.sequence_number));
  const pathCompleted = progress?.path_completed ?? false;

  const getStatus = (seq) => {
    if (completedSeqs.has(seq)) return 'completed';
    if (seq === currentSeq)      return 'active';
    if (seq === currentSeq + 1)  return 'next';
    return 'locked';
  };

  // ── Start weekly gauntlet ─────────────────────────────────────────────────
  const startWeeklyMut = useMutation({
    mutationFn: () => startCommunityGauntletAttempt(weeklyGauntlet.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weekly-gauntlet-attempt', weeklyGauntlet?.id] });
      qc.invalidateQueries({ queryKey: ['weekly-gauntlet-active'] });
    },
    onError: (err) => {
      reportError(err, { feature: 'gauntlet.weekly-start', level: 'warning' });
      toast.error(tFallback('gauntlet.startFailed', 'Could not start the gauntlet. Try again.'));
    },
  });

  // ── Submit a weekly gauntlet score ────────────────────────────────────────
  // Only the seeded `total_volume` scoring is wired: the score is the user's
  // best SINGLE-SESSION volume among workouts logged inside the gauntlet week
  // (week_start..week_end, both bare YYYY-MM-DD so string compare is safe).
  // completeCommunityGauntletAttempt marks the attempt 'failed' below the
  // threshold, so we only expose Submit once the best session already clears
  // it — a sub-threshold submit would permanently fail the user for the week.
  const scoringSupported = weeklyGauntlet?.scoring_method === 'total_volume';
  const attemptOpen      = !!weeklyAttempt && weeklyAttempt.status === 'in_progress';

  const { data: weekLogs = [] } = useQuery({
    queryKey: ['gauntlet-weekly-logs', user?.email, weeklyGauntlet?.id],
    queryFn:  () => db.entities.WorkoutLog.filter({ created_by: user.email }, '-date', 50),
    enabled:  !!user?.email && !!weeklyGauntlet?.id && scoringSupported && attemptOpen,
    staleTime: 60_000,
  });

  const bestWeekSession = useMemo(() => {
    if (!weeklyGauntlet || !scoringSupported) return null;
    const start = weeklyGauntlet.week_start || '';
    const end   = weeklyGauntlet.week_end   || '';
    let best = null;
    for (const log of weekLogs) {
      const d = String(log?.date || '').slice(0, 10);
      if ((start && d < start) || (end && d > end)) continue;
      const vol = totalVolume(log?.exercises || []);
      if (!best || vol > best.volume) best = { volume: vol, id: log?.id ?? null };
    }
    return best;
  }, [weekLogs, weeklyGauntlet, scoringSupported]);

  const canSubmitWeekly =
    attemptOpen && scoringSupported && bestWeekSession != null &&
    bestWeekSession.volume >= (weeklyGauntlet?.passing_threshold ?? Infinity);

  const submitWeeklyMut = useMutation({
    mutationFn: () =>
      completeCommunityGauntletAttempt(weeklyGauntlet.id, bestWeekSession?.volume ?? 0, bestWeekSession?.id ?? null),
    onSuccess: (attempt) => {
      qc.invalidateQueries({ queryKey: ['weekly-gauntlet-attempt', weeklyGauntlet?.id] });
      qc.invalidateQueries({ queryKey: ['weekly-gauntlet-active'] });
      if (attempt?.status === 'completed') {
        toast.success(tFallback("gauntlet.youClearedThisWeekS", "🏆 You cleared this week's gauntlet!"));
      } else {
        toast('Score submitted. Keep pushing to clear it.');
      }
    },
    onError: (err) => {
      reportError(err, { feature: 'gauntlet.weekly-submit', level: 'warning' });
      toast.error(tFallback('gauntlet.submitFailed', 'Could not submit your score. Try again.'));
    },
  });

  // ── Tap a path node ───────────────────────────────────────────────────────
  async function handleSelectChallenge(ch) {
    // Deselect if tapping same
    if (selectedChallenge?.id === ch?.id) {
      setSelectedChallenge(null);
      return;
    }
    setSelectedChallenge(ch);

    // If completed, also fetch stats to show the modal on tap-again UX
    // (We just show the detail card; stats modal is reserved for when you first complete)
  }

  // pt-[73px] = the fixed sub-header below (61px measured) + 12px of
  // breathing room, and nothing else. It was 120px, which is 61 + 59 — the
  // Dynamic Island's safe-area inset baked in as a literal, because Layout's
  // <main> was not carrying it. Now that main pads 56px + inset, this only
  // has to clear the sub-header itself; leaving it at 120 would open a 59px
  // hole at the top of the page on exactly the phones it was tuned for. Hub
  // solves the same problem by measuring (see the comment on its
  // contentPadTop) because its sub-header changes height between sections;
  // this one doesn't.
  return (
    <div className="px-0 pt-[73px] pb-24 max-w-3xl mx-auto">
      {/* ── Fixed sub-header ─────────────────────────────────────────────── */}
      {/* Both edges track the capped shell — see the same note on Hub's
          sub-header and the shell comment in index.css. `lg:start-64` measured
          from the monitor, which past --shell-max is not where the sidebar is. */}
      <div className="fixed start-0 end-0 z-20 bg-background/95 backdrop-blur-md border-b border-border top-[calc(56px+env(safe-area-inset-top))] lg:top-[env(safe-area-inset-top)] lg:start-[var(--shell-content-start)] lg:end-[var(--shell-inset)]">
        <div className="max-w-3xl mx-auto px-4 md:px-6 pt-3 pb-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              // Deep-linked users (push notification, shared URL) have
              // empty history and would otherwise see a back button that
              // does nothing.
              if (window.history.length > 1) navigate(-1);
              else navigate('/dashboard');
            }}
            className="p-2 rounded-lg text-muted-foreground hover:bg-secondary active:bg-secondary transition-colors lg:hidden"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" />
            <h1 className="font-heading text-xl font-bold tracking-tight">{tFallback("workout.gauntlet", "Gauntlet")}</h1>
          </div>
          {!pathCompleted && challenges.length > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">
              {completedSeqs.size} / {challenges.length} cleared
            </span>
          )}
          {pathCompleted && (
            <span className="ml-auto text-xs font-bold text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded-full">
              Path Complete ✓
            </span>
          )}
        </div>
      </div>

      {/* ── Weekly community card ─────────────────────────────────────────── */}
      <div className="px-4 md:px-6">
        <ErrorBoundary label="WeeklyGauntlet">
          <WeeklyGauntletCard
            gauntlet={weeklyGauntlet}
            attempt={weeklyAttempt}
            onStart={() => startWeeklyMut.mutate()}
            onLogWorkout={() => navigate('/workout')}
            onSubmit={() => submitWeeklyMut.mutate()}
            submitting={submitWeeklyMut.isPending}
            canSubmit={canSubmitWeekly}
            bestScore={scoringSupported ? bestWeekSession?.volume ?? null : null}
          />
        </ErrorBoundary>
      </div>

      {/* ── Path header ──────────────────────────────────────────────────── */}
      <div className="px-4 md:px-6 mb-1">
        <div className="flex items-center gap-2 mb-3">
          <Swords className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            {tFallback("gauntlet.thePath", "The Path")}
          </h2>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden mb-1">
          <motion.div
            className="h-full rounded-full"
            style={{ background: 'linear-gradient(90deg, #7c3aed, #f59e0b)' }}
            initial={{ width: 0 }}
            animate={{ width: challenges.length > 0 ? `${(completedSeqs.size / challenges.length) * 100}%` : 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* ── Winding path ─────────────────────────────────────────────────── */}
      <ErrorBoundary label="GauntletPath">
        <GauntletPath
          challenges={challenges}
          currentSequence={currentSeq}
          completedSeqs={completedSeqs}
          selectedId={selectedChallenge?.id}
          onSelectChallenge={handleSelectChallenge}
          onChestTap={(seq, available) => setChestModal({ seq, available })}
        />
      </ErrorBoundary>

      {/* ── Challenge detail — centered overlay; tap the backdrop to dismiss ── */}
      <AnimatePresence>
        {selectedChallenge && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={() => setSelectedChallenge(null)}
          >
            <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
              <ChallengeDetail
                key={selectedChallenge.id}
                challenge={selectedChallenge}
                status={getStatus(selectedChallenge.sequence_number)}
                completedAt={
                  completions.find(c => c.challenge_id === selectedChallenge.id)?.completed_at
                }
                onClose={() => setSelectedChallenge(null)}
                onStartWorkout={() => navigate('/workout')}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Chest tap modal ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {chestModal && (
          <motion.div
            key="chest-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[130] flex items-end justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={() => setChestModal(null)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0,  opacity: 1 }}
              exit={{ y: 40,    opacity: 0 }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
              className="w-full max-w-sm bg-background rounded-2xl p-6 text-center shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-4xl mb-3">{chestModal.available ? '🎁' : '🔒'}</p>
              {chestModal.available ? (
                <>
                  <p className="font-heading font-bold text-lg mb-1">{tFallback("gauntlet.rewardUnlocked", "Reward Unlocked!")}</p>
                  <p className="text-sm text-muted-foreground">
                    You've cleared challenge {chestModal.seq}. Open the chest to claim your coins and XP bonus.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-heading font-bold text-lg mb-1">{tFallback("gauntlet.chestLocked", "Chest Locked")}</p>
                  <p className="text-sm text-muted-foreground">
                    Complete challenge {chestModal.seq} to unlock this reward.
                  </p>
                </>
              )}
              <button
                type="button"
                onClick={() => setChestModal(null)}
                className="mt-5 w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-opacity"
              >
                {tFallback("workout.tutorial.gotIt", "Got it")}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Completion stats modal ────────────────────────────────────────── */}
      {statsModal && (
        <GauntletStatsModal
          open={!!statsModal}
          onClose={() => setStatsModal(null)}
          type={statsModal.type}
          challengeTitle={statsModal.challengeTitle}
          xpAwarded={statsModal.xpAwarded}
          coinsAwarded={statsModal.coinsAwarded}
          stats={statsModal.stats}
          pathCompleted={statsModal.pathCompleted}
        />
      )}
    </div>
  );
}
