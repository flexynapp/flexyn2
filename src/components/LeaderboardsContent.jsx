// src/components/LeaderboardsContent.jsx
//
// Shared body of the leaderboards UI. Used by:
//   • LeaderboardsModal — wraps this in a Dialog
//   • Hub /leaderboards tab — renders this inline
//
// The component owns its own data fetch, board selection, and rendering.

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Crown, Trophy, Flame, Sparkles, Dumbbell, Footprints, Award, Zap } from 'lucide-react';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { useDelayedLoading } from '@/hooks/useDelayedLoading';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { formatDistance } from '@/lib/distanceUnit';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import { backfillLeaderboardStatsOnce } from '@/lib/leaderboardStats';
import { getPeriodLeaderboard } from '@/lib/data/periodLeaderboard';
import TapToCopy from '@/components/TapToCopy';
import AnimatedNumber from '@/components/AnimatedNumber';

const BOARDS = [
  { id: 'level',        icon: Zap,        labelKey: 'leaderboards.level',        gradient: 'from-amber-400 via-orange-400 to-rose-500' },
  { id: 'achievements', icon: Award,      labelKey: 'leaderboards.achievements', gradient: 'from-violet-400 via-fuchsia-500 to-pink-500' },
  { id: 'volume',       icon: Dumbbell,   labelKey: 'leaderboards.volume',       gradient: 'from-emerald-400 via-teal-500 to-cyan-500' },
  { id: 'distance',     icon: Footprints, labelKey: 'leaderboards.distance',     gradient: 'from-sky-400 via-blue-500 to-indigo-500' },
];

const PODIUM_STYLE = {
  0: { ring: 'ring-yellow-400/60',  glow: 'shadow-yellow-400/40',  Icon: Crown,  iconColor: 'text-yellow-400'  },
  1: { ring: 'ring-slate-300/60',   glow: 'shadow-slate-300/30',   Icon: Trophy, iconColor: 'text-slate-300'   },
  2: { ring: 'ring-orange-400/60',  glow: 'shadow-orange-400/40',  Icon: Flame,  iconColor: 'text-orange-400'  },
};

// formatNum moved inside the component so it can use the active app
// locale (was rendering with the browser locale, which defeated i18n
// for users whose browser locale didn't match their app language).

/**
 * @param {Object} props
 * @param {boolean} [props.active=true] — when false, suppresses the user-list
 *   query (e.g. while a containing modal is closed).
 */
export default function LeaderboardsContent({ active = true }) {
  const { t, tFallback } = useLanguage();
  const fmtNum = useNumberFormatter();
  const formatNum = (n) => fmtNum(Math.round(n));
  const { user } = useAuth();
  const { weightUnit } = useWeightUnit();
  const { distanceUnit } = useDistanceUnit();
  const [activeBoard, setActiveBoard] = useState('level');
  // Time-window toggle. Weekly + monthly hit the
  // `get_period_leaderboard` RPC (migration 125) which aggregates
  // workout_logs over the ISO week / calendar month. All-time keeps
  // using the in-memory User.list() path against denormalized
  // total_* columns. Boards that don't have a time-scoped definition
  // (achievements, distance) are pinned to all-time regardless.
  const [period, setPeriod] = useState('alltime');
  // Force period back to all-time when switching to a board that
  // doesn't have a periodic definition (achievements, distance).
  // Previously the period stayed at weekly/monthly under the hood,
  // and switching back to a period-scoped board re-applied the last
  // selection without a visible signal that the user had chosen it
  // for a different board.
  useEffect(() => {
    const supportsPeriod = activeBoard === 'volume' || activeBoard === 'level';
    if (!supportsPeriod && period !== 'alltime') setPeriod('alltime');
  }, [activeBoard, period]);
  const periodScoped = period !== 'alltime' &&
    (activeBoard === 'volume' || activeBoard === 'level');

  useEffect(() => {
    if (active && user?.email) backfillLeaderboardStatsOnce(user.email);
  }, [active, user?.email]);

  const { data: allUsers = [], isLoading: isLoadingRaw } = useQuery({
    queryKey: ['allUsersLeaderboards'],
    queryFn: () => db.entities.User.list(),
    enabled: active,
  });
  // Period-scoped feed from the RPC. Only fired when period is
  // weekly/monthly AND the active board has a period-scoped definition.
  // Match the cache key to the SERVER board param ('xp' / 'volume'),
  // not the UI's activeBoard name — the previous shape keyed the
  // cache by 'level' while sending board:'xp' to the RPC, so a sibling
  // surface that also reads ['periodLeaderboard', 'xp', period] would
  // miss this cache and trigger a duplicate fetch.
  const serverBoard = activeBoard === 'level' ? 'xp' : 'volume';
  const { data: periodRows = [], isLoading: isLoadingPeriodRaw } = useQuery({
    queryKey: ['periodLeaderboard', serverBoard, period],
    queryFn:  () => getPeriodLeaderboard({
      board:  serverBoard,
      period,
      limit:  100,
    }),
    enabled: active && periodScoped,
    staleTime: 60_000,
  });
  // 250ms gate so a cached re-open of leaderboards doesn't flash
  // a loading spinner that disappears the same frame.
  const isLoading = useDelayedLoading(isLoadingRaw || (periodScoped && isLoadingPeriodRaw));

  const board = BOARDS.find(b => b.id === activeBoard);

  const ranked = useMemo(() => {
    // Period-scoped path — server-side aggregation via the RPC.
    if (periodScoped) {
      const periodSuffix = period === 'weekly' ? '/wk' : '/mo';
      const formatValue = activeBoard === 'volume'
        ? v => `${formatNum(fromLbs(v, weightUnit))} ${weightUnit}${periodSuffix}`
        : v => `${formatNum(v)} XP${periodSuffix}`;
      return periodRows
        .filter(r => Number(r.value) > 0)
        .map((r, idx) => {
          const val = Number(r.value) || 0;
          return {
            id:     r.user_id,
            full_name: r.full_name || r.username || t('progress.anonymous'),
            rank:   idx + 1,
            _val:   val,
            _display: formatValue(val),
          };
        });
    }

    // All-time path — in-memory ranking against denormalized columns.
    const enriched = allUsers.map(u => {
      const xp = Number(u.total_xp) || 0;
      const lvl = calculateLevelFromXp(xp);
      return {
        id: u.id,
        full_name: u.full_name || t('progress.anonymous'),
        total_xp: xp,
        level: lvl.level,
        achievements_unlocked_count: Number(u.achievements_unlocked_count) || 0,
        total_volume_lbs: Number(u.total_volume_lbs) || 0,
        total_distance_meters: Number(u.total_distance_meters) || 0,
      };
    });

    const filteredEnriched = enriched.filter(u =>
      (Number(u.total_xp) || 0) > 0
      || (Number(u.achievements_unlocked_count) || 0) > 0
      || (Number(u.total_volume_lbs) || 0) > 0
      || (Number(u.total_distance_meters) || 0) > 0
    );

    let valueOf, formatValue;
    switch (activeBoard) {
      case 'achievements':
        valueOf = u => u.achievements_unlocked_count;
        formatValue = v => `${formatNum(v)} ${t('leaderboards.unlocked')}`;
        break;
      case 'volume':
        valueOf = u => u.total_volume_lbs;
        formatValue = v => `${formatNum(fromLbs(v, weightUnit))} ${weightUnit}`;
        break;
      case 'distance':
        valueOf = u => u.total_distance_meters;
        formatValue = v => formatDistance(v, distanceUnit, 1);
        break;
      case 'level':
      default:
        valueOf = u => u.total_xp;
        formatValue = (_v, u) => `Lv ${u.level} · ${formatNum(u.total_xp)} XP`;
        break;
    }

    return filteredEnriched
      .filter(u => valueOf(u) > 0)
      .sort((a, b) => valueOf(b) - valueOf(a))
      .slice(0, 100)
      .map((u, idx) => ({ ...u, rank: idx + 1, _val: valueOf(u), _display: formatValue(valueOf(u), u) }));
  }, [allUsers, activeBoard, period, periodScoped, periodRows, weightUnit, distanceUnit, t]);

  const myRow = ranked.find(r => r.id === user?.id);

  return (
    <>
      {/* Hero — gradient strip with metric pills */}
      <div className={`relative overflow-hidden bg-gradient-to-br ${board.gradient} px-5 sm:px-6 pt-6 pb-7 sm:pb-8 text-white rounded-t-2xl`}>
        <motion.div
          className="absolute inset-0 opacity-30"
          style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(255,255,255,0.4) 0%, transparent 60%), radial-gradient(circle at 80% 30%, rgba(255,255,255,0.3) 0%, transparent 50%)' }}
          animate={{ opacity: [0.2, 0.4, 0.2] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="relative z-10">
          <h2 className="font-heading text-xl sm:text-2xl md:text-3xl flex items-center gap-2 text-white drop-shadow font-bold">
            <Sparkles className="w-6 h-6" />
            {t('leaderboards.title')}
          </h2>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <p className="text-sm text-white/85">{t('leaderboards.subtitle')}</p>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-md text-[10px] font-bold tracking-wider text-white">
              ✨ {t('leaderboards.top100')}
            </span>
          </div>
        </div>

        {/* Period toggle — All-time / This month / This week. Server
            aggregation via the get_period_leaderboard RPC handles the
            two scoped windows. Achievements + Distance boards always
            render all-time because we don't track period aggregates
            for them; the toggle disables itself for those. */}
        <div className="relative z-10 mt-3 flex items-center gap-1">
          {[
            { id: 'alltime', label: 'All-time' },
            { id: 'monthly', label: 'This month' },
            { id: 'weekly',  label: 'This week' },
          ].map(p => {
            const disabled = p.id !== 'alltime' &&
              (activeBoard === 'achievements' || activeBoard === 'distance');
            return (
              <button
                key={p.id}
                onClick={() => !disabled && setPeriod(p.id)}
                aria-pressed={period === p.id}
                disabled={disabled}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  period === p.id
                    ? 'bg-white text-foreground'
                    : disabled
                      ? 'bg-white/10 text-white/40 cursor-not-allowed'
                      : 'bg-white/15 text-white hover:bg-white/25'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="relative z-10 mt-3 flex flex-wrap gap-1.5 sm:gap-2">
          {BOARDS.map(b => {
            const Icon = b.icon;
            const isActive = b.id === activeBoard;
            return (
              <motion.button
                key={b.id}
                onClick={() => setActiveBoard(b.id)}
                aria-pressed={isActive}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur-md transition-colors ${
                  isActive ? 'bg-white text-foreground shadow-lg' : 'bg-white/15 text-white hover:bg-white/25'
                }`}
                whileTap={{ scale: 0.94 }}
                layout
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                {t(b.labelKey)}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 sm:p-5 md:p-6">
        {myRow && (
          <motion.div key={`me-${activeBoard}`} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
            <Card className="p-4 bg-primary/5 border-2 border-primary/30">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-primary/20 flex items-center justify-center shrink-0 font-heading font-bold text-primary">
                  #<AnimatedNumber value={myRow.rank} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-heading font-bold text-sm">{t('progress.you')}</p>
                  <p className="text-xs text-muted-foreground truncate">{myRow.full_name}</p>
                </div>
                <div className="text-end">
                  <TapToCopy value={`Rank #${myRow.rank} · ${myRow._display}`} label="rank">
                    <p className="font-heading font-bold text-base text-primary">{myRow._display}</p>
                  </TapToCopy>
                </div>
              </div>
            </Card>
          </motion.div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        ) : ranked.length === 0 ? (
          <div className="text-center py-12">
            <Sparkles className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-heading font-semibold">{t('leaderboards.empty')}</p>
            <p className="text-sm text-muted-foreground mt-1">{t('leaderboards.emptyDesc')}</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeBoard}
              className="space-y-2"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
            >
              {/* "Your rank: #N" sticky pill — shown when the user is
                  on this board but below the top 3 (podium). Gives
                  them a quick read of where they stand without
                  scrolling to find their row in a 100-deep list. */}
              {(() => {
                const myRowIdx = ranked.findIndex(r => r.id === user?.id);
                if (myRowIdx < 0) return null;
                const myRow = ranked[myRowIdx];
                if (myRowIdx < 3) return null; // already visible on podium
                return (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="sticky top-0 z-10 -mx-1 mb-1"
                  >
                    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-primary text-primary-foreground shadow-md">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-80">
                          Your rank
                        </span>
                        <span className="font-heading font-black text-base tabular-nums">
                          #{myRow.rank}
                        </span>
                      </div>
                      <span className="font-heading font-bold text-sm tabular-nums">
                        {myRow._display}
                      </span>
                    </div>
                  </motion.div>
                );
              })()}
              {(() => {
                // Suppress the user's row from the list when the
                // sticky "Your rank" pill is rendered above — otherwise
                // they appear twice (once in the pill, once at their
                // actual position deep in the list). The user's row
                // stays visible in podium positions (idx < 3) because
                // the pill explicitly skips that range.
                const myIdx = ranked.findIndex(r => r.id === user?.id);
                const suppressMyRow = myIdx >= 3;
                return ranked.map((row, idx) => {
                  if (suppressMyRow && idx === myIdx) return null;
                  const podium = PODIUM_STYLE[idx];
                  const isMe = row.id === user?.id;
                  return (
                  <motion.div
                    key={row.id}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(idx, 10) * 0.04 }}
                  >
                    <Card className={`p-3 border-none shadow-sm transition-all ${
                      podium ? `ring-2 ${podium.ring} shadow-md ${podium.glow}` : ''
                    } ${isMe ? 'bg-primary/10 border-2 border-primary/30' : ''}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg bg-secondary">
                          {podium ? (
                            <podium.Icon className={`w-4 h-4 ${podium.iconColor}`} />
                          ) : (
                            <span className="font-heading font-bold text-xs">#{row.rank}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-heading font-bold text-sm truncate">{row.full_name}</p>
                        </div>
                        <div className="flex-shrink-0 text-end">
                          <p className="font-heading font-bold text-sm">{row._display}</p>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                );
                });
              })()}
              {ranked.length >= 100 ? (
                <p className="text-xs text-center text-muted-foreground mt-4">
                  {t('leaderboards.top100Footer')}
                </p>
              ) : ranked.length > 5 && (
                <p className="text-xs text-center text-muted-foreground mt-4">
                  {/* tFallback with vars handles both the missing-key case
                      (raw key showing as text) and the substitution-name
                      mismatch (translator picks a different placeholder).
                      The prior `t().replace('{n}', N)` failed both. */}
                  {tFallback('leaderboards.allShownFooter', 'All {n} athletes shown.', { n: ranked.length })}
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </>
  );
}
