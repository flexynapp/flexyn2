import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import { getTier } from '@/lib/xpTier';
import Particles from '@/components/Particles';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { useGlobalRank } from '@/hooks/useGlobalRank';
import StatsHubModal from '@/components/StatsHubModal';

// The compact badge used to render a ~170-line portal tooltip beneath it —
// XP progress, a Leaderboards CTA, a Regional Leaderboards CTA, and a
// "Ranks: coming soon" list. It was unreachable: `setShowTooltip(true)` was
// never called anywhere, so the state initialised false and was only ever
// set back to false. StatsHubModal had superseded it — the badge opens that
// instead, and it carries the same destinations plus streaks, league and
// quests. The dead branch is gone; Leaderboards is now the first thing in
// StatsHubModal rather than the fourth.
//
// Regional Leaderboards went with it. They filter on user_profiles
// country_code / state_code, which nothing collects (onboarding's
// LocationStep was removed — see CLAUDE.md "out of scope"), so the boards
// always came back empty. RegionalLeaderboardsModal and its RPCs stay in
// the tree; re-surface them from StatsHubModal once location capture ships.

export default function LevelBar({ totalXp = 0, compact = false }) {
  const { t } = useLanguage();
  const fmt = useNumberFormatter();
  const levelData = calculateLevelFromXp(totalXp);
  const { level, xpInLevel, xpNeeded, progressPercent } = levelData;
  const tier = getTier(level, t);
  const [statsHubOpen, setStatsHubOpen] = useState(false);
  // Global rank rides along on the badge. "Lv 4" is a fact about you;
  // "Lv 4 · #12" is a reason to tap. The query is shared with the Dashboard
  // league card via React Query, so surfacing it twice costs one round trip.
  // Only fetched for the compact badge — the full-size bar already sits on
  // pages that show rank in their own right.
  const { rank } = useGlobalRank({ enabled: compact });

  if (compact) {
    return (
      <>
      <div className="relative">
        <motion.button
          onClick={() => setStatsHubOpen(true)}
          aria-label={rank != null
            ? `Open Stats Hub — level ${level}, ranked ${rank} globally`
            : `Open Stats Hub — level ${level}`}
          className={`relative flex items-center gap-2 px-3 py-2 rounded-xl overflow-hidden ${tier.bg} shadow-md ${tier.glow} cursor-pointer`}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.93 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        >
          <Particles type={tier.particles} />

          {/* Level Badge */}
          <motion.div
            key={level}
            className={`relative flex-shrink-0 flex items-center justify-center px-2 py-0.5 rounded-md bg-gradient-to-r ${tier.badge} shadow-sm`}
            animate={tier.particles !== 'none' ? { boxShadow: ['0 0 0px rgba(255,255,255,0)', '0 0 8px rgba(255,255,255,0.4)', '0 0 0px rgba(255,255,255,0)'], scale: [1, 1.15, 1] } : { scale: [1, 1.15, 1] }}
            transition={tier.particles !== 'none' ? { duration: 2, repeat: Infinity, ease: 'easeInOut', scale: { duration: 0.6, ease: 'easeOut' } } : { duration: 0.6, ease: 'easeOut' }}
          >
            <span className="font-heading font-bold text-xs text-white drop-shadow">{t('levelBar.level').replace('{n}', level)}</span>
          </motion.div>

          {/* Global rank — omitted entirely when unknown (still loading, no
              activity yet, opted out of discovery, or a host without the
              RPC) rather than rendering a placeholder. A badge that
              sometimes says "#—" is worse than one that just says "Lv 4". */}
          {rank != null && (
            <motion.span
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
              className={`relative font-heading font-bold text-xs tabular-nums ${tier.text}`}
            >
              #{fmt(rank)}
            </motion.span>
          )}
        </motion.button>

      </div>
      <StatsHubModal open={statsHubOpen} onClose={() => setStatsHubOpen(false)} />
      </>
    );
  }

  return (
    <div className={`relative flex items-center gap-3 px-5 py-3 rounded-xl overflow-hidden ${tier.bg} shadow-md ${tier.glow}`}>
      <Particles type={tier.particles} />

      {/* Level Badge */}
      <div className={`relative flex-shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br ${tier.badge} flex items-center justify-center shadow`}>
        <span className="font-heading font-bold text-sm text-white drop-shadow">{t('levelBar.level').replace('{n}', level)}</span>
      </div>

      {/* XP Progress */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className={`text-xs font-semibold ${tier.text}`}>{tier.name}</span>
          <span className="text-xs text-muted-foreground">{Math.round(xpInLevel)} / {xpNeeded} XP</span>
        </div>
        <div className="w-full h-2 bg-black/10 rounded-full overflow-hidden">
          <motion.div
            className={`h-full bg-gradient-to-r ${tier.bar} rounded-full`}
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
      </div>

      {level === 100 && (
        <div className="flex-shrink-0 text-xs font-bold text-yellow-500 ms-1">MAX</div>
      )}
    </div>
  );
}