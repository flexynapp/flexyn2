// src/components/LeaderboardsContent.jsx
//
// Shared body of the leaderboards UI. Used by:
//   • LeaderboardsModal — wraps this in a Dialog
//   • Hub /leaderboards tab — renders this inline
//
// The component owns its own data fetch, board selection, and rendering.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sparkles, Dumbbell, Footprints, Award, Zap,
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
import { useGlobalRank } from '@/hooks/useGlobalRank';
import TapToCopy from '@/components/TapToCopy';
import AnimatedNumber from '@/components/AnimatedNumber';
import LeaderboardPodium from '@/components/leaderboard/LeaderboardPodium';

// Four boards on one row at 375px. `shortKey` exists because the full labels
// ("Volume Lifted", "Distance Logged") are what forced the selector to wrap
// onto a third row — the segmented control needs ~70px per segment and those
// need ~110. The long form still shows in the header as the active board's
// name, so nothing is lost.
//
// `hasPeriod` marks the boards with a time-scoped definition. The other two
// have no per-window aggregate, and the old UI rendered the period pills for
// them anyway in a disabled state — 4 of 12 board×period combinations were
// dead controls occupying the top of the screen. Now the control is absent
// on those boards rather than greyed.
const BOARDS = [
  { id: 'level',        icon: Zap,        labelKey: 'leaderboards.level',        shortKey: 'leaderboards.short.level',        shortFallback: 'Level',    accent: 'text-amber-400',   hasPeriod: true  },
  { id: 'achievements', icon: Award,      labelKey: 'leaderboards.achievements', shortKey: 'leaderboards.short.achievements', shortFallback: 'Awards',   accent: 'text-fuchsia-400', hasPeriod: false },
  { id: 'volume',       icon: Dumbbell,   labelKey: 'leaderboards.volume',       shortKey: 'leaderboards.short.volume',       shortFallback: 'Volume',   accent: 'text-emerald-400', hasPeriod: true  },
  { id: 'distance',     icon: Footprints, labelKey: 'leaderboards.distance',     shortKey: 'leaderboards.short.distance',     shortFallback: 'Distance', accent: 'text-sky-400',     hasPeriod: false },
];

const PERIODS = [
  { id: 'alltime', key: 'leaderboards.period.alltime', fallback: 'All-time' },
  { id: 'monthly', key: 'leaderboards.period.monthly', fallback: 'Month' },
  { id: 'weekly',  key: 'leaderboards.period.weekly',  fallback: 'Week' },
];

// UI board id → the `p_board` value the RPC understands.
const SERVER_BOARD = {
  level:        'xp',
  volume:       'volume',
  achievements: 'achievements',
  distance:     'distance',
};

// PODIUM_STYLE removed — the top three now render in LeaderboardPodium above
// the list, so the rows no longer carry a ring + glow + medal icon for the
// same three people. Styling them twice was the reason first place read as
// "a row with a yellow border" instead of first place.

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

  useEffect(() => {
    if (active && user?.email) backfillLeaderboardStatsOnce(user.email);
  }, [active, user?.email]);

  // Map the UI's board id onto the RPC's board param. The cache is keyed by
  // the SERVER name, not the UI name — the previous shape keyed by 'level'
  // while sending board:'xp', so a sibling surface reading
  // ['periodLeaderboard', 'xp', period] missed this cache and refetched.
  const serverBoard = SERVER_BOARD[activeBoard] || 'volume';

  // Every board, every period, now comes from the server (migration 257
  // widened the RPC past volume/xp/sessions). Ranking used to happen in the
  // browser for the all-time boards, which meant pulling the entire user
  // table down to every viewer on every open.
  const {
    data: rpcResult, isLoading: isLoadingRpcRaw, isFetching: isFetchingRpc,
  } = useQuery({
    queryKey: ['periodLeaderboard', serverBoard, period],
    queryFn:  () => getPeriodLeaderboard({ board: serverBoard, period, limit: 100 }),
    enabled:  active,
    staleTime: 60_000,
    // Board and period are both in the key, so every segment tap and every
    // period change was a DIFFERENT query with no cache: the whole list was
    // replaced by five skeletons and then rebuilt. That teardown is most of
    // what makes switching boards feel choppy, and it fires on the control
    // people press most on this screen. Keep the current board on screen and
    // swap it when the next one lands. useDelayedLoading's 250ms gate hid
    // this for a warm cache but could not help a cold one.
    placeholderData: keepPreviousData,
  });
  const rpcRows = rpcResult?.rows ?? [];
  // A pre-257 host can't serve the all-time boards. The frontend deploys
  // ahead of the database (Netlify auto-deploys main; migrations are applied
  // by hand), so the legacy client-side path stays wired until the migration
  // lands and only runs when the RPC says it can't help.
  const needsLegacyFallback = active && rpcResult != null && !rpcResult.supported;

  const { data: allUsers = [], isLoading: isLoadingLegacyRaw } = useQuery({
    queryKey: ['allUsersLeaderboards'],
    queryFn: () => db.entities.User.list(),
    enabled: needsLegacyFallback,
  });

  // 250ms gate so a cached re-open of leaderboards doesn't flash
  // a loading spinner that disappears the same frame.
  const isLoading = useDelayedLoading(
    isLoadingRpcRaw || (needsLegacyFallback && isLoadingLegacyRaw)
  );

  const board = BOARDS.find(b => b.id === activeBoard);

  // Hoisted out of the `ranked` memo so the out-of-top-100 row below can
  // format the caller's own value identically. It reads from a different
  // source (get_leaderboard_around_me rather than the top-N query), and
  // formatting it a second way would show the same athlete two different
  // numbers on the same screen.
  const formatValue = useMemo(() => {
    const periodSuffix = period === 'weekly' ? '/wk' : period === 'monthly' ? '/mo' : '';
    switch (activeBoard) {
      case 'volume':
        return v => `${formatCompact(fromLbs(v, weightUnit))} ${weightUnit}${periodSuffix}`;
      case 'distance':
        return v => formatDistance(v, distanceUnit, 1);
      case 'achievements':
        return v => `${formatNum(v)} ${t('leaderboards.unlocked')}`;
      case 'level':
      default:
        // All-time level board shows the level the XP buys; the scoped
        // windows show XP earned in that window, which has no level.
        return v => period === 'alltime'
          ? `Lv ${calculateLevelFromXp(v).level} · ${formatCompact(v)} XP`
          : `${formatCompact(v)} XP${periodSuffix}`;
    }
  }, [activeBoard, period, weightUnit, distanceUnit, t]);

  const ranked = useMemo(() => {
    // Server path — the RPC ranks, so the client only formats.
    if (!needsLegacyFallback) {
      return rpcRows
        .filter(r => Number(r.value) > 0)
        .map((r, idx) => {
          const val = Number(r.value) || 0;
          return {
            id:        r.user_id,
            full_name: r.full_name || r.username || t('progress.anonymous'),
            // Prefer the server's rank — it accounts for the whole table and
            // breaks ties deterministically. Pre-257 rows have no `rank`.
            rank:      Number(r.rank) || idx + 1,
            _val:      val,
            _display:  formatValue(val),
          };
        });
    }

    // Legacy path — in-memory ranking against denormalized columns. Only
    // reached on a host that hasn't had migration 257 applied yet.
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

    // Named legacyFormat rather than formatValue so it doesn't shadow the
    // hoisted memo above — this branch needs the whole user row (for `level`)
    // where the server branch only has a scalar.
    let valueOf, legacyFormat;
    switch (activeBoard) {
      case 'achievements':
        valueOf = u => u.achievements_unlocked_count;
        legacyFormat = v => `${formatNum(v)} ${t('leaderboards.unlocked')}`;
        break;
      case 'volume':
        valueOf = u => u.total_volume_lbs;
        legacyFormat = v => `${formatCompact(fromLbs(v, weightUnit))} ${weightUnit}`;
        break;
      case 'distance':
        valueOf = u => u.total_distance_meters;
        legacyFormat = v => formatDistance(v, distanceUnit, 1);
        break;
      case 'level':
      default:
        valueOf = u => u.total_xp;
        legacyFormat = (_v, u) => `Lv ${u.level} · ${formatCompact(u.total_xp)} XP`;
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
      .map((u, idx) => ({ ...u, rank: idx + 1, _val: valueOf(u), _display: legacyFormat(valueOf(u), u) }));
  }, [allUsers, activeBoard, period, needsLegacyFallback, rpcRows, weightUnit, distanceUnit, t, formatValue]);

  const myIndex = ranked.findIndex(r => r.id === user?.id);
  const myRow = myIndex >= 0 ? ranked[myIndex] : undefined;

  // The board only carries the top 100. Anyone below that had no rank on this
  // screen at all — the surface simply didn't mention them, which is the least
  // useful thing a leaderboard can do to the majority of its users. This pulls
  // their true global position from get_leaderboard_around_me (migrations
  // 257/259), which ranks the whole table.
  //
  // Only fetched when they're actually off the board, and only for all-time —
  // the RPC has no per-window aggregate to rank against, and rejects anything
  // else. On weekly/monthly the extra row is simply absent.
  const outOfTop = myIndex < 0;
  const { rank: globalRank, value: globalValue } = useGlobalRank({
    board: serverBoard,
    enabled: active && outOfTop && period === 'alltime',
  });

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
    const deltas = {};
    if (previous) {
      for (const [id, rank] of Object.entries(current)) {
        // Positive = moved up the board (a numerically smaller rank).
        if (previous[id] != null && previous[id] !== rank) deltas[id] = previous[id] - rank;
      }
    }
    prevRanksRef.current[key] = current;

    // Only touch state when the map actually changed.
    //
    // `ranked` is a useMemo whose deps include `t` from LanguageContext,
    // which is not referentially stable — so `ranked` gets a fresh identity
    // on most renders and this effect re-runs. Unconditionally calling
    // setRankDeltas({}) then handed React a brand-new object every time,
    // which re-rendered, which re-ran the effect: "Maximum update depth
    // exceeded", spamming the console and pinning the main thread whenever
    // the leaderboard was open. Comparing before setting breaks the cycle
    // without needing to stabilise `t` across the whole app.
    setRankDeltas(prev => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(deltas);
      if (prevKeys.length === nextKeys.length &&
          nextKeys.every(k => prev[k] === deltas[k])) {
        return prev;
      }
      return deltas;
    });
  }, [ranked, activeBoard, period]);

  // Windowed by default; "show all" opens the full top 100. Reset the
  // expansion whenever the board or period changes so a deep list doesn't
  // carry over into a board the user just switched to.
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setShowAll(false); }, [activeBoard, period]);

  // The top three render in the podium above, so the list starts at rank 4.
  // Feeding the full list to windowRanked would show them twice.
  const podium = ranked.slice(0, 3);
  const tail = useMemo(() => ranked.slice(3), [ranked]);
  const myTailIndex = myIndex >= 3 ? myIndex - 3 : -1;

  const rows = useMemo(
    () => (showAll ? tail.map(row => ({ type: 'row', row })) : windowRanked(tail, myTailIndex)),
    [tail, myTailIndex, showAll]
  );
  const hiddenCount = tail.length - rows.filter(r => r.type === 'row').length;

  return (
    <>
      {/* Header — title, active board name, and ONE row of controls.
          Was 213px (30% of the dialog) for a title, a subtitle, a "Top 100"
          badge, an animated gradient, and seven filter pills stacked three
          rows deep. The references spend ~60px: title, one line of context,
          the selector. osu-web puts eight ranking types in header links and
          its long-tail filter in a dropdown; trophyso/ui's leaderboard-card
          is a title, a date range and a single select. Neither stacks axes. */}
      {/* min-w-0 is load-bearing. Radix's DialogContent is a CSS grid, so its
          single implicit column is sized by the min-content of its widest
          child. `truncate` sets white-space: nowrap, which makes the title's
          min-content the full un-wrapped string — that pushed the column to
          384px inside a 343px dialog and clipped every row on the right.
          min-content of a grid item is only ignored once its min-width is 0. */}
      <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-border min-w-0">
        {/* pe-8 reserves the corner for Radix's own close button, which
            DialogContent renders absolutely at `end-4 top-4`. Without it the
            period dropdown sat underneath the X — 16px of overlap, both
            tappable, and the X winning. */}
        <div className="flex items-center justify-between gap-3 min-w-0 pe-8">
          {/* No decorative icon here. At 375px the title and the period
              control share ~309px of content width; the Sparkles glyph plus
              its gap cost ~22px, which was the difference between the full
              title and "Global Lead…". The empty state still uses it. */}
          <h2 className="font-heading font-bold text-base truncate min-w-0">
            {t('leaderboards.title')}
          </h2>
          {/* Period is the SECONDARY axis, so it's a dropdown, not pills.
              This is the rule the references agree on: one small set of
              mutually exclusive options gets a segmented control (the board
              selector below); a second axis becomes a select. osu-web puts
              eight ranking types in header links and its country filter in a
              `select-options` dropdown; trophyso/ui's leaderboard-card is a
              title plus one <select>. Neither stacks two rows of pills.
              As three pills this cost ~140px on the title's row and clipped
              it to "Global Lead…".

              It renders ONLY for boards with a time-scoped definition.
              Achievements and Distance have no per-window aggregate, so the
              control is absent rather than greyed — a disabled control still
              costs the user a read. */}
          {board.hasPeriod && (
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              aria-label={tFallback('leaderboards.periodLabel', 'Time period')}
              className="shrink-0 rounded-lg bg-secondary border border-border/60 px-2 py-1 text-micro font-bold text-foreground"
            >
              {PERIODS.map(p => (
                <option key={p.id} value={p.id}>{tFallback(p.key, p.fallback)}</option>
              ))}
            </select>
          )}
        </div>

        {/* Board selector — one row, four segments, short labels. The long
            names ("Volume Lifted") are what forced a third row; the active
            board's full name renders as the subtitle below instead. */}
        <div className="mt-2.5 grid grid-cols-4 gap-1 rounded-xl bg-secondary p-1">
          {BOARDS.map(b => {
            const Icon = b.icon;
            const isActive = b.id === activeBoard;
            return (
              <button
                key={b.id}
                onClick={() => setActiveBoard(b.id)}
                aria-pressed={isActive}
                className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-lg text-micro font-bold transition-colors min-w-0 ${
                  isActive
                    ? 'bg-card shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground active:text-foreground'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? b.accent : ''}`} aria-hidden="true" />
                <span className="truncate w-full text-center">{tFallback(b.shortKey, b.shortFallback)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Body — min-w-0 for the same grid-column reason as the header above. */}
      <div className="p-4 sm:p-5 md:p-6 min-w-0">
        {myRow && (
          // Fades with the board below it, on the same 0.1s, so a segment tap
          // is ONE change of state rather than two things moving separately.
          // `layout` is gone — this is a single block with no siblings to
          // reflow against, so it was a projection node measuring itself for
          // nothing — and so is the y:-8 slide, which re-ran on every tap.
          <motion.div
            key={`me-${activeBoard}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.1 }}
            className="mb-5"
          >
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
                  <TapToCopy value={`Rank #${myRow.rank} · ${myRow._display}`} label={tFallback('copy.noun.rank', 'rank')}>
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
          // mode="wait" is right for a full content swap — two boards must
          // never overlap — but it SERIALISES the two halves: the outgoing
          // board had to finish 0.25s of exit before the incoming one was
          // allowed to mount, then spent another 0.25s entering. Half a
          // second of a control feeling unresponsive, before the per-row
          // stagger below even started. 0.1s each way reads as a crisp swap;
          // the y-offset is gone because a board switch is a change of
          // content, not a movement of it, and translating 100 rows was the
          // most expensive part of the least useful gesture.
          <AnimatePresence mode="wait">
            <motion.div
              key={`${activeBoard}:${period}`}
              className="space-y-2"
              initial={{ opacity: 0 }}
              // The refetch dim is an animation TARGET, not an `opacity-60`
              // class. framer writes opacity inline on this element and
              // inline beats a class, so the class would never apply and its
              // `transition-opacity` would fight every frame framer wrote.
              animate={{ opacity: isFetchingRpc ? 0.6 : 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
            >
              {/* Podium — the top three, with graduated blocks and the
                  crown/trophy/flame badges. Previously ranks 1-3 were
                  ordinary rows carrying a coloured ring, which made first
                  place read as "a row with a yellow border". */}
              {podium.length > 0 && (
                <div className="mb-3">
                  <LeaderboardPodium rankings={podium} currentUserId={user?.id} />
                </div>
              )}

              {/* Windowed list from rank 4 down: the next few, a collapsed
                  gap, then the user's immediate neighbours. Replaces a flat
                  100-row list that needed a sticky "Your rank" pill plus
                  row-suppression logic to stop the user appearing twice —
                  and which never showed who they were actually chasing. */}
              {rows.map((entry) => {
                if (entry.type === 'ellipsis') {
                  return (
                    <button
                      key={entry.key}
                      onClick={() => setShowAll(true)}
                      className="w-full flex items-center justify-center gap-2 py-2 text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
                      aria-label={tFallback('leaderboards.showHidden', 'Show {n} hidden athletes', { n: entry.count })}
                    >
                      <Ellipsis className="w-5 h-5" aria-hidden="true" />
                      <span className="text-micro font-medium tabular-nums">{entry.count}</span>
                    </button>
                  );
                }

                const row = entry.row;
                const isMe = row.id === user?.id;
                const delta = rankDeltas[row.id];

                return (
                  // A plain div. Every row used to slide in from x:-16 with
                  // `delay: min(idx, 10) * 0.04` — up to 400ms of rows
                  // cascading in one after another, re-run on EVERY board and
                  // period change. That is a first-paint flourish being used
                  // as the response to a button press: the board you asked
                  // for arrives in pieces over half a second, which reads as
                  // the app struggling rather than as polish. The keyed
                  // parent above already fades the whole board in as one
                  // unit, so these animations were redundant as well as
                  // slow — and dropping them takes ~15 motion components and
                  // their projection work out of every switch.
                  // FriendLeaderboardPanel hit this exact bug and its comment
                  // says the same thing.
                  <div key={row.id}>
                    {/* No podium ring here any more — ranks 1-3 don't reach
                        this list, they render in LeaderboardPodium above. */}
                    <Card className={`p-3 border-none shadow-sm transition-all ${
                      isMe ? 'bg-primary/10 border-2 border-primary/30' : ''
                    }`}>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg bg-secondary">
                          <span className="font-heading font-bold text-xs">#{row.rank}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-heading font-bold text-sm truncate">
                            {isMe ? t('progress.you') : row.full_name}
                          </p>
                          {isMe && (
                            <p className="text-micro text-muted-foreground truncate">{row.full_name}</p>
                          )}
                        </div>
                        {/* Movement since the last refresh. Trend arrows are
                            what make a board worth reopening. */}
                        {delta ? (
                          <span
                            className={`flex items-center gap-0.5 text-micro font-bold tabular-nums ${
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
                  </div>
                );
              })}

              {/* Explicit way into the full board. The ellipsis in the middle
                  of the list already expands it, but that's a glyph the user
                  has to guess at — this names the action and the count. The
                  dialog scrolls (max-h-[88vh] overflow-y-auto), so all 100
                  rows are reachable once expanded. */}
              {!showAll && hiddenCount > 0 && (
                <button
                  onClick={() => setShowAll(true)}
                  className="w-full py-2.5 rounded-xl border border-border/60 text-xs font-bold text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary/50 active:bg-secondary/50 transition-colors"
                >
                  {tFallback('leaderboards.showAll', 'Show all {n}', { n: ranked.length })}
                </button>
              )}
              {showAll && hiddenCount === 0 && ranked.length > PODIUM_SIZE + NEIGHBOUR_RADIUS * 2 + 1 && (
                <button
                  onClick={() => setShowAll(false)}
                  className="w-full py-2 text-xs font-medium text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
                >
                  {tFallback('leaderboards.collapse', 'Collapse')}
                </button>
              )}

              {/* Off the board entirely — pinned below the top 100 with the
                  caller's true global rank. Previously these users saw a list
                  of 100 strangers and no mention of themselves. */}
              {outOfTop && globalRank != null && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="sticky bottom-0 pt-2"
                >
                  <Card className="p-3 bg-primary/10 border-2 border-primary/30 shadow-lg">
                    <div className="flex items-center gap-3">
                      <div className="min-w-9 h-9 px-1.5 flex-shrink-0 flex items-center justify-center rounded-lg bg-primary/20">
                        <span className="font-heading font-bold text-xs text-primary tabular-nums">
                          #{formatNum(globalRank)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-heading font-bold text-sm truncate">{t('progress.you')}</p>
                        <p className="text-micro text-muted-foreground truncate">
                          {tFallback('leaderboards.outsideTop', 'Outside the top {n}', { n: ranked.length })}
                        </p>
                      </div>
                      <div className="flex-shrink-0 text-end">
                        <p className="font-heading font-bold text-sm text-primary">
                          {globalValue != null ? formatValue(globalValue) : ''}
                        </p>
                      </div>
                    </div>
                  </Card>
                </motion.div>
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
