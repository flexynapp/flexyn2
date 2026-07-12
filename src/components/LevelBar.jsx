import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Map } from 'lucide-react';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import { getTier } from '@/lib/xpTier';
import Particles from '@/components/Particles';
import { useLanguage } from '@/lib/LanguageContext';
import LeaderboardsModal from '@/components/LeaderboardsModal';
import RegionalLeaderboardsModal from '@/components/RegionalLeaderboardsModal';
import StatsHubModal from '@/components/StatsHubModal';

// Regional Leaderboards are hidden: they filter on user_profiles
// country_code / state_code, which nothing collects (onboarding's
// LocationStep was removed — see CLAUDE.md "out of scope"), so the boards
// always come back empty. The modal + RPCs stay in the tree; flip this to
// true once location capture ships. Until then, don't surface a dead entry.
const REGIONAL_LEADERBOARDS_ENABLED = false;

export default function LevelBar({ totalXp = 0, compact = false }) {
  const { t } = useLanguage();
  const levelData = calculateLevelFromXp(totalXp);
  const { level, xpInLevel, xpNeeded, progressPercent } = levelData;
  const tier = getTier(level, t);
  const [showTooltip, setShowTooltip] = useState(false);
  const [leaderboardsOpen, setLeaderboardsOpen] = useState(false);
  const [regionalLeaderboardsOpen, setRegionalLeaderboardsOpen] = useState(false);
  const [statsHubOpen, setStatsHubOpen] = useState(false);
  const tooltipRef = useRef(null);

  useEffect(() => {
    if (!showTooltip) return;
    const handler = (e) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target)) {
        setShowTooltip(false);
      }
    };
    // Escape closes the tooltip — keyboard-only users had no way to
    // dismiss it before; only mouse/touch outside-click was wired up.
    const keyHandler = (e) => {
      if (e.key === 'Escape') setShowTooltip(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [showTooltip]);

  if (compact) {
    return (
      <>
      <div className="relative" ref={tooltipRef}>
        <motion.button
          onClick={() => setStatsHubOpen(true)}
          aria-label="Open Stats Hub"
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
        </motion.button>

        {/* Tooltip — portaled to document.body so it always escapes any parent
            stacking context (e.g. the Hub page wrapper). Without this, transformed
            ancestors trap z-index even at z-[200]. */}
        {typeof document !== 'undefined' && createPortal(
          <AnimatePresence>
            {showTooltip && (
              <>
                <div data-portal-ignore-outside-click className="fixed inset-0 z-[199]" aria-hidden="true" onClick={() => setShowTooltip(false)} />
                <motion.div
                  data-portal-ignore-outside-click
                  initial={{ opacity: 0, y: -12, scale: 0.93 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -12, scale: 0.93 }}
                  transition={{ type: 'spring', stiffness: 350, damping: 28 }}
                  className="fixed inset-x-4 top-20 z-[200] mx-auto max-w-sm bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
                >
                  {/* Header */}
                  <div className={`px-5 py-4 bg-gradient-to-r ${tier.badge} relative overflow-hidden`}>
                    <Particles type={tier.particles} />
                    <div className="relative flex items-center gap-3">
                      <motion.div
                        className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center shadow"
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.05 }}
                      >
                        <span className="font-heading font-bold text-lg text-white drop-shadow">{t('levelBar.level').replace('{n}', level)}</span>
                      </motion.div>
                      <div>
                        <motion.p
                          className="font-heading font-bold text-white text-base leading-tight"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.1, duration: 0.25 }}
                        >
                          {tier.name}
                        </motion.p>
                        <motion.p
                          className="text-white/70 text-xs"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.15, duration: 0.25 }}
                        >
                          {t('levelBar.tierOf').replace('{tier}', Math.floor((level - 1) / 10) + 1).replace('{max}', 10)}
                        </motion.p>
                      </div>
                    </div>
                  </div>

                  {/* XP Progress */}
                  <div className="px-5 py-4 border-b border-border">
                    <div className="flex justify-between text-xs text-muted-foreground mb-2">
                      <span>{t('levelBar.xpProgress')}</span>
                      <motion.span
                        className="font-medium text-foreground"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                      >
                        {Math.round(xpInLevel)} / {xpNeeded} XP
                      </motion.span>
                    </div>
                    <div className="w-full h-2.5 bg-border rounded-full overflow-hidden mb-2 relative">
                      <motion.div
                        className={`h-full bg-gradient-to-r ${tier.bar} rounded-full relative`}
                        initial={{ width: 0 }}
                        animate={{ width: `${progressPercent}%` }}
                        transition={{ duration: 0.7, ease: 'easeOut', delay: 0.15 }}
                      >
                        {/* Shimmer */}
                        <motion.div
                          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent rounded-full"
                          animate={{ x: ['-100%', '200%'] }}
                          transition={{ duration: 1.5, delay: 0.85, ease: 'easeInOut' }}
                        />
                      </motion.div>
                    </div>
                    <motion.p
                      className="text-xs text-muted-foreground"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                    >
                      {t('levelBar.xpUntilNext').replace('{n}', xpNeeded - Math.round(xpInLevel))}
                    </motion.p>
                  </div>

                  {/* Leaderboards */}
                  <div className="px-5 pt-3 pb-2 border-t border-border">
                    <motion.button
                      onClick={() => { setShowTooltip(false); setLeaderboardsOpen(true); }}
                      className="w-full flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-amber-500/10 via-fuchsia-500/10 to-cyan-500/10 level-card-aurora hover:from-amber-500/15 hover:via-fuchsia-500/15 hover:to-cyan-500/15 border border-border/60 transition-all"
                      whileHover={{ y: -1 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                    >
                      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 via-fuchsia-500 to-cyan-500 level-card-aurora flex items-center justify-center shrink-0 shadow-md">
                        <Trophy className="w-4 h-4 text-white drop-shadow" />
                      </div>
                      <div className="flex-1 text-start">
                        <p className="text-sm font-heading font-bold leading-tight">{t('leaderboards.title')}</p>
                        <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{t('leaderboards.subtitle')}</p>
                      </div>
                      <motion.div
                        animate={{ x: [0, 3, 0] }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                        className="text-muted-foreground"
                      >
                        →
                      </motion.div>
                    </motion.button>
                  </div>

                  {/* Regional Leaderboards — hidden until location capture
                      exists (REGIONAL_LEADERBOARDS_ENABLED). */}
                  {REGIONAL_LEADERBOARDS_ENABLED && (
                  <div className="px-5 pb-3">
                    <motion.button
                      onClick={() => { setShowTooltip(false); setRegionalLeaderboardsOpen(true); }}
                      className="w-full flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-sky-500/10 via-blue-500/10 to-indigo-500/10 hover:from-sky-500/15 hover:via-blue-500/15 hover:to-indigo-500/15 border border-border/60 transition-all"
                      whileHover={{ y: -1 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                    >
                      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-md">
                        <Map className="w-4 h-4 text-white drop-shadow" />
                      </div>
                      <div className="flex-1 text-start">
                        <p className="text-sm font-heading font-bold leading-tight">{t('leaderboards.regional.title')}</p>
                        <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{t('leaderboards.regional.subtitle')}</p>
                      </div>
                      <motion.div
                        animate={{ x: [0, 3, 0] }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                        className="text-muted-foreground"
                      >
                        →
                      </motion.div>
                    </motion.button>
                  </div>
                  )}

                  {/* Ranks — Coming Soon */}
                  <div className="px-5 py-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-heading font-bold">{t('levelBar.ranks')}</p>
                      <motion.span
                        className="text-[10px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full"
                        animate={{ opacity: [0.6, 1, 0.6] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                      >
                        {t('levelBar.comingSoon')}
                      </motion.span>
                    </div>
                    <div className="space-y-2">
                      {[t('levelBar.competitiveRanking'), t('levelBar.seasonLeaderboards'), t('levelBar.rankRewards')].map((item, i) => (
                        <motion.div
                          key={item}
                          className="flex items-center gap-3 p-2.5 rounded-lg bg-secondary/50 opacity-50"
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 0.5, x: 0 }}
                          transition={{ delay: 0.25 + i * 0.07, duration: 0.25 }}
                        >
                          <div className="w-6 h-6 rounded-md bg-border flex items-center justify-center shrink-0">
                            <span className="text-xs">🔒</span>
                          </div>
                          <p className="text-xs font-medium text-muted-foreground">{item}</p>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}
        <LeaderboardsModal open={leaderboardsOpen} onClose={() => setLeaderboardsOpen(false)} />
        <RegionalLeaderboardsModal open={regionalLeaderboardsOpen} onClose={() => setRegionalLeaderboardsOpen(false)} />
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