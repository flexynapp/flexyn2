// src/components/LeaderboardsContent.jsx
//
// Shared body of the leaderboards UI. Used by:
//   • LeaderboardsModal — wraps this in a Dialog
//   • Hub /leaderboards tab — renders this inline
//
// The component owns its own data fetch, board selection, and rendering.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Crown, Trophy, Flame, Sparkles, Dumbbell, Footprints, Award, Zap,
  Ellipsis, TrendingUp, TrendingDown,
} from 'lucide-react';
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

// How many rows either side of the user stay visible when the list is
// windowed. 3 is enough to see who you're chasing and who's chasing you.
const NEIGHBOUR_RADIUS = 3;
// Rows always pinned to the top of a windowed list (the podium).
const PODIUM_SIZE = 3;

/**
 * Fold a ranked list down to podium + the user's neighbourhood, collapsing
 * everything else into ellipsis markers.
 *
 * A 100-row flat list forced two workarounds: a sticky "Your rank" pill and
 * logic to suppress the user's real row so they didn't appear twice. Both
 * told the user their number while hiding the only thing that makes a rank
 * actionable — who is immediately ahead of them.
 *
 * Pattern follows trophyso/ui's leaderboard-rankings (MIT), which marks rows
 * `displayed: false` and folds each hidden run into one ellipsis.
 *
 * @returns {Array<{type:'row',row:object}|{type:'ellipsis',key:string,count:number}>}
 */
export function windowRanked(ranked, myIndex) {
  const visible = new Set();
  for (let i = 0; i < Math.min(PODIUM_SIZE, ranked.length); i++) visible.add(i);
  if (myIndex >= 0) {
    for (let i = myIndex - NEIGHBOUR_RADIUS; i <= myIndex + NEIGHBOUR_RADIUS; i++) {
      if (i >= 0 && i < ranked.length) visible.add(i);
    }
  } else {
    // Not on the board — show a deeper head so there's something to read.
    for (let i = 0; i < Math.min(10, ranked.length); i++) visible.add(i);
  }

  const out = [];
  let hidden = 0;
  ranked.forEach((row, i) => {
    if (!visible.has(i)) { hidden += 1; return; }
    if (hidden > 0) {
      out.push({ type: 'ellipsis', key: `gap-${i}`, count: hidden });
      hidden = 0;
    }
    out.push({ type: 'row', row });
  });
  if (hidden > 0) out.push({ type: 'ellipsis', key: 'gap-tail', count: hidden });
  return out;
}

/**
 * @param {Object} props
 * @param {boolean} [props.active=true] — when false, suppresses the user-list
 *   query (e.g. while a containing modal is closed).
 */
export default function LeaderboardsContent({ active = true }) {
  const { t, tFallback } = useLanguage();
  const fmtNum = useNumberFormatter();
  const formatNum = (n) => fmtNum(Math.round(n));
  // Compact notation for leaderboard values — a row has to fit a rank, an
  // avatar-sized badge, a name and a value on a phone, and the volume board
  // renders seven-figure numbers. Intl's `compact` notation is locale-aware
  // ("1.2M" in en, "120万" in ja), which the hand-rolled k/m suffixes used by
  // most reference implementations are not.
  const formatCompact = (n) =>
    fmtNum(Math.round(n), { notation: 'compact', maximumFractionDigits: 1 });
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
        ? v => `${formatCompact(fromLbs(v, weightUnit))} ${weightUnit}${periodSuffix}`
        : v => `${formatCompact(v)} XP${periodSuffix}`;
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
        formatValue = v => `${formatCompact(fromLbs(v, weightUnit))} ${weightUnit}`;
        break;
      case 'distance':
        valueOf = u => u.total_distance_meters;
        formatValue = v => formatDistance(v, distanceUnit, 1);
        break;
      case 'level':
      default:
        valueOf = u => u.total_xp;
        formatValue = (_v, u) => `Lv ${u.level} · ${formatCompact(u.total_xp)} XP`;
        break;
    }

    return filteredEnriched
      .filter(u => valueOf(u) > 0)
      // Deterministic total ordering. Sorting on the value alone leaves tied
      // users in whatever order Array.prototype.sort happened to produce, so
      // two athletes on equal XP visibly swap places on a refetch with
      // nothing having happened. Nakama's leaderboards (Apache-2.0) always
      // order on a full key — `score DESC, subscore DESC, owner_id DESC` —
      // for exactly this reason. `id` is our tie-break of last resort.
      .sort((a, b) => (valueOf(b) - valueOf(a)) || String(a.id).localeCompare(String(b.id)))
      .slice(0, 100)
      .map((u, idx) => ({ ...u, rank: idx + 1, _val: valueOf(u), _display: formatValue(valueOf(u), u) }));
  }, [allUsers, activeBoard, period, periodScoped, periodRows, weightUnit, distanceUnit, t]);

  const myIndex = ranked.findIndex(r => r.id === user?.id);
  const myRow = myIndex >= 0 ? ranked[myIndex] : undefined;

  // Rank movement since the last time this board was rendered with data.
  // Mirrors the prevRankRef pattern already used by LeagueCard on the
  // Dashboard — movement is the reason anyone reopens a leaderboard, and
  // the main board showed none of it.
  const prevRanksRef = useRef({});
  const [rankDeltas, setRankDeltas] = useState({});
  useEffect(() => {
    if (!ranked.length) return;
    const key = `${activeBoard}:${period}`;
    const current = Object.fromEntries(ranked.map(r => [r.id, r.rank]));
    const previous = prevRanksRef.current[key];
    if (previous) {
      const deltas = {};
      for (const [id, rank] of Object.entries(current)) {
        // Positive = moved up the board (a numerically smaller rank).
        if (previous[id] != null && previous[id] !== rank) deltas[id] = previous[id] - rank;
      }
      setRankDeltas(deltas);
    } else {
      setRankDeltas({});
    }
    prevRanksRef.current[key] = current;
  }, [ranked, activeBoard, period]);

  // Windowed by default; "show all" opens the full top 100. Reset the
  // expansion whenever the board or period changes so a deep list doesn't
  // carry over into a board the user just switched to.
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setShowAll(false); }, [activeBoard, period]);

  const rows = useMemo(
    () => (showAll ? ranked.map(row => ({ type: 'row', row })) : windowRanked(ranked, myIndex)),
    [ranked, myIndex, showAll]
  );
  const hiddenCount = ranked.length - rows.filter(r => r.type === 'row').length;

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
                  {/* The gap to the athlete directly above is the one number
                      that makes a rank actionable. Showing only "#14" tells
                      you where you are but not what to do about it. */}
                  {myIndex > 0 ? (
                    <p className="text-xs text-muted-foreground truncate">
                      {tFallback('leaderboards.gapToNext', '{n} behind {name}', {
                        n: formatCompact(Math.max(0, ranked[myIndex - 1]._val - myRow._val)),
                        name: ranked[myIndex - 1].full_name,
                      })}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground truncate">
                      {tFallback('leaderboards.leading', 'Leading the board')}
                    </p>
                  )}
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
              {/* Windowed list: podium, then a collapsed gap, then the
                  user's immediate neighbours. Replaces a flat 100-row list
                  that needed a sticky "Your rank" pill plus row-suppression
                  logic to stop the user appearing twice — and which never
                  showed them who they were actually chasing. */}
              {rows.map((entry, idx) => {
                if (entry.type === 'ellipsis') {
                  return (
                    <button
                      key={entry.key}
                      onClick={() => setShowAll(true)}
                      className="w-full flex items-center justify-center gap-2 py-2 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={tFallback('leaderboards.showHidden', 'Show {n} hidden athletes', { n: entry.count })}
                    >
                      <Ellipsis className="w-5 h-5" aria-hidden="true" />
                      <span className="text-[11px] font-medium tabular-nums">{entry.count}</span>
                    </button>
                  );
                }

                const row = entry.row;
                const podium = PODIUM_STYLE[row.rank - 1];
                const isMe = row.id === user?.id;
                const delta = rankDeltas[row.id];

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
                          <p className="font-heading font-bold text-sm truncate">
                            {isMe ? t('progress.you') : row.full_name}
                          </p>
                          {isMe && (
                            <p className="text-[11px] text-muted-foreground truncate">{row.full_name}</p>
                          )}
                        </div>
                        {/* Movement since the last refresh. Trend arrows are
                            what make a board worth reopening. */}
                        {delta ? (
                          <span
                            className={`flex items-center gap-0.5 text-[11px] font-bold tabular-nums ${
                              delta > 0 ? 'text-emerald-500' : 'text-rose-500'
                            }`}
                            aria-label={tFallback(
                              delta > 0 ? 'leaderboards.movedUp' : 'leaderboards.movedDown',
                              delta > 0 ? 'Up {n} places' : 'Down {n} places',
                              { n: Math.abs(delta) }
                            )}
                          >
                            {delta > 0
                              ? <TrendingUp className="w-3 h-3" aria-hidden="true" />
                              : <TrendingDown className="w-3 h-3" aria-hidden="true" />}
                            {Math.abs(delta)}
                          </span>
                        ) : null}
                        <div className="flex-shrink-0 text-end">
                          <p className="font-heading font-bold text-sm">{row._display}</p>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                );
              })}

              {showAll && hiddenCount === 0 && ranked.length > PODIUM_SIZE + NEIGHBOUR_RADIUS * 2 + 1 && (
                <button
                  onClick={() => setShowAll(false)}
                  className="w-full py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {tFallback('leaderboards.collapse', 'Collapse')}
                </button>
              )}
              {ranked.length >= 100 ? (
                <p className="text-xs text-center text-muted-foreground mt-4">
                  {t('leaderboards.top100Footer')}
                </p>
              ) : ranked.length > 5 && hiddenCount === 0 && (
                <p className="text-xs text-center text-muted-foreground mt-4">
                  {/* tFallback with vars handles both the missing-key case
                      (raw key showing as text) and the substitution-name
                      mismatch (translator picks a different placeholder).
                      The prior `t().replace('{n}', N)` failed both.
                      Only claim "all shown" when the list isn't windowed —
                      otherwise it contradicts the ellipsis right above it. */}
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
