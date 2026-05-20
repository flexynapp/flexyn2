// src/pages/Gauntlet.jsx
// The Gauntlet screen: community weekly challenge at top, personal 10-challenge
// path below. Completion triggers the stats modal with share.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Trophy, Swords, ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ErrorBoundary from '@/components/ErrorBoundary';
import {
  getGauntletChallenges,
  getMyProgress,
  getMyCompletions,
  getActiveCommunityGauntlet,
  getCommunityGauntletAttempt,
  startCommunityGauntletAttempt,
  getGauntletStats,
  getWeeklyGauntletStats,
} from '@/lib/data/gauntlet';
import GauntletPath from '@/components/gauntlet/GauntletPath';
import WeeklyGauntletCard from '@/components/gauntlet/WeeklyGauntletCard';
import GauntletStatsModal from '@/components/gauntlet/GauntletStatsModal';

export default function Gauntlet() {
  const navigate   = useNavigate();
  const qc         = useQueryClient();
  const [statsModal, setStatsModal] = useState(null); // { type, challengeTitle, xpAwarded, coinsAwarded, stats, pathCompleted }

  // ── Data ────────────────────────────────────────────────────────────────────
  const { data: challenges = [] } = useQuery({
    queryKey: ['gauntlet-challenges'],
    queryFn: getGauntletChallenges,
    staleTime: Infinity,
  });

  const { data: progress } = useQuery({
    queryKey: ['gauntlet-progress'],
    queryFn: getMyProgress,
    staleTime: 60_000,
  });

  const { data: completions = [] } = useQuery({
    queryKey: ['gauntlet-completions'],
    queryFn: getMyCompletions,
    staleTime: 60_000,
  });

  const { data: weeklyGauntlet } = useQuery({
    queryKey: ['weekly-gauntlet-active'],
    queryFn: getActiveCommunityGauntlet,
    staleTime: 5 * 60_000,
  });

  const { data: weeklyAttempt } = useQuery({
    queryKey: ['weekly-gauntlet-attempt', weeklyGauntlet?.id],
    queryFn: () => getCommunityGauntletAttempt(weeklyGauntlet.id),
    enabled: !!weeklyGauntlet?.id,
    staleTime: 60_000,
  });

  // ── Derived ─────────────────────────────────────────────────────────────────
  const currentSeq    = progress?.current_challenge_sequence ?? 1;
  const completedSeqs = new Set(completions.map(c => c.sequence_number));
  const pathCompleted = progress?.path_completed ?? false;

  // ── Start weekly gauntlet ───────────────────────────────────────────────────
  const startWeeklyMut = useMutation({
    mutationFn: () => startCommunityGauntletAttempt(weeklyGauntlet.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weekly-gauntlet-attempt', weeklyGauntlet?.id] });
      qc.invalidateQueries({ queryKey: ['weekly-gauntlet-active'] });
    },
  });

  // ── Tap a path node ─────────────────────────────────────────────────────────
  async function handleChallengeClick(challenge) {
    if (completedSeqs.has(challenge.sequence_number)) {
      // Show stats for completed challenge
      try {
        const stats = await getGauntletStats(challenge.sequence_number);
        const comp  = completions.find(c => c.sequence_number === challenge.sequence_number);
        setStatsModal({
          type: 'path',
          challengeTitle: challenge.title,
          xpAwarded: challenge.xp_reward,
          coinsAwarded: challenge.coin_reward,
          stats,
          pathCompleted: pathCompleted && challenge.sequence_number === 10,
        });
      } catch { /* silent */ }
    }
    // If active: we just scroll them to info, actual completion happens via Workout
  }

  return (
    <div className="px-4 md:px-6 pt-[120px] pb-10 max-w-3xl mx-auto">
      {/* Fixed sub-header */}
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
          {pathCompleted && (
            <span className="ml-auto text-xs font-bold text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded-full">
              Path Complete ✓
            </span>
          )}
        </div>
      </div>

      <ErrorBoundary label="WeeklyGauntlet">
        {/* Community Gauntlet card */}
        <WeeklyGauntletCard
          gauntlet={weeklyGauntlet}
          attempt={weeklyAttempt}
          onStart={() => startWeeklyMut.mutate()}
        />
      </ErrorBoundary>

      {/* Path section */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Swords className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            The Path
          </h2>
          <span className="ml-auto text-xs text-muted-foreground">
            {completedSeqs.size} / {challenges.length}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-secondary rounded-full mb-4 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-purple-500 to-amber-400"
            initial={{ width: 0 }}
            animate={{ width: `${challenges.length > 0 ? (completedSeqs.size / challenges.length) * 100 : 0}%` }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
        </div>

        <ErrorBoundary label="GauntletPath">
          <GauntletPath
            challenges={challenges}
            currentSequence={currentSeq}
            completedSeqs={completedSeqs}
            onChallengeClick={handleChallengeClick}
          />
        </ErrorBoundary>
      </div>

      {/* Stats modal */}
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
