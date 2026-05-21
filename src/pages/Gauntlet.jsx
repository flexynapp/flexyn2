// src/pages/Gauntlet.jsx
// The Gauntlet screen: community weekly challenge at top, personal 10-challenge
// winding path below. Tap any node to see its detail card. Completion triggers
// the stats modal with share.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Swords, ChevronLeft, X, Zap, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ErrorBoundary from '@/components/ErrorBoundary';
import {
  getGauntletChallenges,
  getMyProgress,
  getMyCompletions,
  getActiveCommunityGauntlet,
  getCommunityGauntletAttempt,
  startCommunityGauntletAttempt,
} from '@/lib/data/gauntlet';
import GauntletPath from '@/components/gauntlet/GauntletPath';
import WeeklyGauntletCard from '@/components/gauntlet/WeeklyGauntletCard';
import GauntletStatsModal from '@/components/gauntlet/GauntletStatsModal';

// Challenge-type readable label
const TYPE_LABEL = {
  single_session: 'Single Session',
  weekly_volume:  'Weekly Volume',
  streak:         'Streak',
  nutrition:      'Nutrition',
  pr:             'Personal Record',
  final:          'Final Boss',
};

// Metric readable description
function metricHint(challenge) {
  const { metric, target_value: tv } = challenge;
  if (!metric) return null;
  const fmtLbs = (v) => v >= 1000 ? `${Math.round(v / 1000)}K` : String(v);
  if (metric === 'session_volume')         return `${fmtLbs(tv)} lbs in one session`;
  if (metric === 'weekly_lbs')             return `${fmtLbs(tv)} lbs in one week`;
  if (metric === 'sessions_in_7_days')     return `${tv} sessions within any 7-day window`;
  if (metric === 'sessions_in_5_days')     return `${tv} sessions within any 5-day window`;
  if (metric === 'consecutive_days')       return `${tv}-day consecutive streak`;
  if (metric === 'min_exercises_no_skip')  return `${tv}+ exercises, zero skipped sets`;
  if (metric === 'any_compound_pr')        return 'New PR on any compound lift';
  return null;
}

// ── Challenge detail card (shown when node is tapped) ────────────────────────
function ChallengeDetail({ challenge, status, completedAt, onClose }) {
  const hint = metricHint(challenge);
  const isLocked = status === 'locked';

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className="mx-4 rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
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
          {status === 'next'      && <span className="text-muted-foreground text-sm font-medium">Up Next</span>}
          {status === 'locked'    && (
            <span className="text-muted-foreground/50 text-sm flex items-center gap-1.5">
              <Lock className="w-3 h-3" /> Locked
            </span>
          )}
          {completedAt && status === 'completed' && (
            <span className="text-xs text-muted-foreground">
              · {new Date(completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
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
            <span className={`text-[10px] font-bold uppercase tracking-widest block mb-0.5 ${
              isLocked ? 'text-muted-foreground/30' : 'text-muted-foreground'
            }`}>
              {TYPE_LABEL[challenge.type] ?? challenge.type}
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
                <span className="text-xs font-bold text-foreground">Goal:</span>
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
            Complete the challenges before this one to unlock.
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
          {status === 'active' && (
            <span className="ml-auto text-xs text-muted-foreground">
              Complete in your next workout →
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Gauntlet() {
  const navigate = useNavigate();
  const qc       = useQueryClient();
  const [selectedChallenge, setSelectedChallenge] = useState(null);
  const [statsModal, setStatsModal]               = useState(null);

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

  return (
    <div className="px-0 pt-[120px] pb-24 max-w-3xl mx-auto">
      {/* ── Fixed sub-header ─────────────────────────────────────────────── */}
      <div className="fixed left-0 right-0 z-20 bg-background/95 backdrop-blur-md border-b border-border top-[calc(56px+env(safe-area-inset-top))] lg:top-[env(safe-area-inset-top)] lg:left-64">
        <div className="max-w-3xl mx-auto px-4 md:px-6 pt-3 pb-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg text-muted-foreground hover:bg-secondary transition-colors lg:hidden"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" />
            <h1 className="font-heading text-xl font-bold tracking-tight">Gauntlet</h1>
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
          />
        </ErrorBoundary>
      </div>

      {/* ── Path header ──────────────────────────────────────────────────── */}
      <div className="px-4 md:px-6 mb-1">
        <div className="flex items-center gap-2 mb-3">
          <Swords className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            The Path
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
        />
      </ErrorBoundary>

      {/* ── Challenge detail card — slides in below the path on tap ──────── */}
      <AnimatePresence>
        {selectedChallenge && (
          <div className="pb-4">
            <ChallengeDetail
              key={selectedChallenge.id}
              challenge={selectedChallenge}
              status={getStatus(selectedChallenge.sequence_number)}
              completedAt={
                completions.find(c => c.challenge_id === selectedChallenge.id)?.completed_at
              }
              onClose={() => setSelectedChallenge(null)}
            />
          </div>
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
