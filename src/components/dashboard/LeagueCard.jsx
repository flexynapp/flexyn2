// src/components/dashboard/LeagueCard.jsx
//
// Compact league card on the Dashboard. Shows the user's current tier, rank,
// XP this week, days remaining, and a peek at the rivals around them.
// Tap → full league standings (handled via onClick prop).

import React, { useRef, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { ChevronRight, Globe } from 'lucide-react';
import { LeagueTierBadge } from '@/components/leagues/LeagueTierIcon';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import * as leagues from '@/lib/data/leagues';
import { leagueTierName } from '@/lib/leagueTiers';
import { useGlobalRank } from '@/hooks/useGlobalRank';
import { differenceInCalendarDays, parseISO } from 'date-fns';

/**
 * @param {object}   props
 * @param {Function} props.onClick
 * @param {boolean}  [props.stretch=false] — fill the parent's height.
 *   Only correct inside a bounded row. On the Dashboard the card shares a
 *   grid row with the Readiness square and has to match it, so that caller
 *   opts in. The card used to hardcode `h-full`, which is fine there but
 *   catastrophic in StatsHubModal: the modal body is a fixed-height block,
 *   so `height: 100%` resolved against it and rendered the card as a 704px
 *   slab of gradient with the content stranded at the bottom.
 */
export default function LeagueCard({ onClick, stretch = false }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();

  const { data, isLoading } = useQuery({
    queryKey: ['myLeague', user?.id],
    queryFn: () => leagues.getMyLeague(user),
    enabled: !!user?.id,
    staleTime: 30_000,
    refetchInterval: 90_000, // gentle poll so the rank refreshes after others log XP
  });

  // Global all-time standing for the footer strip. Same query the level
  // badge reads, so React Query serves both from one round trip. Declared
  // up here with the other hooks for the same reason the ones below are —
  // this component early-returns while loading.
  const { rank: globalRank, ahead, gap } = useGlobalRank();

  // Rank-change animation state — hooks MUST be declared before any
  // early return so the hook order stays stable across renders where
  // data is loading vs ready. The effect's no-op guard handles the
  // case where myRank isn't known yet.
  const myRank = data?.myRank ?? null;
  const prevRankRef = useRef(myRank);
  const [rankDelta, setRankDelta] = useState(null);
  useEffect(() => {
    if (!myRank || !prevRankRef.current || prevRankRef.current === myRank) {
      prevRankRef.current = myRank;
      return;
    }
    const delta = myRank - prevRankRef.current;
    setRankDelta(delta);
    prevRankRef.current = myRank;
    const t = setTimeout(() => setRankDelta(null), 2800);
    return () => clearTimeout(t);
  }, [myRank]);

  if (!user?.id) return null;

  if (isLoading) {
    return <Skeleton className="h-28 rounded-lg" />;
  }

  // Defensive: bail if data is missing or any required field is absent.
  // A migration that hasn't run yet, a DB error, or stale cached data shouldn't
  // crash the whole Dashboard.
  if (!data || !data.league || !data.tier || !Array.isArray(data.members)) {
    return null;
  }

  const { league, tier, members } = data;
  // Default totalMembers to the loaded members.length so the "rank / N"
  // line never renders "/undefined" or "/0" when the RPC omits the count.
  const totalMembers = Number(data.totalMembers) || members.length || 0;
  // user?.id (optional-chained) — the line `members.find` runs after
  // the early-return guard for `!user?.id` above, but a future
  // refactor that moves this code OR introduces a null-user render
  // path would crash on bare user.id access. Defensive belt.
  const me = members.find(m => m && m.user_id === user?.id);
  const myXp = me?.weekly_xp || 0;

  // Days left in the week. Guard against missing week_end — without
  // this the card rendered "NaN days left" if the data was malformed
  // (e.g. a partially-applied migration). (Audit 08 #17.)
  // Append local end-of-day time so a 'YYYY-MM-DD' string is treated
  // as "end of that local day" rather than UTC midnight — which would
  // render "0 days left" prematurely in negative-offset zones on the
  // last day of the week.
  const endDate = league.week_end ? parseISO(`${league.week_end}T23:59:59`) : null;
  const daysLeft = endDate && !isNaN(endDate.getTime())
    ? Math.max(0, differenceInCalendarDays(endDate, new Date()) + 1)
    : 0;

  // Status strip. The zone indicators were computed here and never read for
  // months; they render now, because with migration 310 they mean something.
  //
  // Ordering is deliberate — qualification outranks position. Someone who has
  // not trained is not in a zone at all, and telling them "#3, promotion zone"
  // when they will finish Unranked is the single most misleading thing this
  // card could say.
  const qualified = data.myQualified;
  const promoteN = Number(data.promoteN) || 0;
  const demoteN = Number(data.demoteN) || 0;
  const qualifiedCount = Number(data.qualifiedCount) || 0;

  let strip = null;
  if (!qualified) {
    strip = {
      tone: 'text-primary',
      dot: 'bg-primary',
      text: tFallback('league.gate.qualifyCta', 'Log a workout to qualify'),
    };
  } else if (data.bracketTooSmall) {
    strip = {
      tone: 'text-muted-foreground',
      dot: 'bg-muted-foreground',
      text: tFallback('league.gate.bracketHeldShort', 'Bracket held this week'),
    };
  } else if (myRank && promoteN > 0 && myRank <= promoteN) {
    strip = {
      tone: 'text-success',
      dot: 'bg-success',
      text: tFallback('league.gate.inPromoteZone', 'Promotion zone · top {n}', { n: promoteN }),
    };
  } else if (myRank && demoteN > 0 && myRank > qualifiedCount - demoteN) {
    strip = {
      tone: 'text-destructive',
      dot: 'bg-destructive',
      text: tFallback('league.gate.inDemoteZone', 'Demotion zone · bottom {n}', { n: demoteN }),
    };
  } else if (myRank) {
    strip = {
      tone: 'text-muted-foreground',
      dot: 'bg-muted-foreground',
      text: tFallback('league.gate.holding', 'Holding position'),
    };
  }

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 380, damping: 22 }}
      className={`block w-full text-start ${stretch ? 'h-full' : ''}`}
    >
      {/* This was a full-bleed tier gradient with a gold ring around the
          whole card, sitting immediately below the orange "Start a
          workout" CTA — two saturated orange blocks stacked, with the
          league shouting louder than the primary action on the screen.
          It's a normal card now. Tier identity moved onto the 32px medal
          badge, which is the smallest surface that still says "bronze";
          confining it there also keeps the Master/Legend tiers' pink and
          violet down to a chip instead of a full-width banner.

          When stretching, flex-1 + items-center absorbs the spare height
          so the card matches its row neighbour (the Readiness square).
          When not stretching it must size to its content instead —
          otherwise it grows to whatever height the parent happens to
          have. */}
      <Card className={`overflow-hidden border-border/60 theme-card-accent flex flex-col ${stretch ? 'h-full' : ''}`}>
        <div className={`relative ${stretch ? 'flex-1' : ''} px-3 py-2.5 flex items-center`}>
          {/* cq-stack: [medal][tier + rank][days left][chevron] is four
              items with only one flexible, so a paired half (~171px)
              truncated the tier to "B.." and dropped the days-left block
              on top of the rank. Stacked, the title gets the full width.
              See the .dash-slot / cq-* block in index.css. */}
          <div className="flex items-center gap-2.5 w-full cq-stack">
            <LeagueTierBadge tier={tier.id} size={32} />
            <div className="flex-1 min-w-0">
              {/* Was 11px all-caps at 0.05em tracking on a gradient. It's
                  the card's title, so it gets the title treatment. */}
              <p className="font-heading font-bold text-sm leading-tight truncate">
                {/* leagueTierName translates the tier and lets the
                    translator own the word order (es: Liga Bronce). */}
                {leagueTierName(tier, tFallback)}
              </p>
              <div className="flex items-baseline gap-1">
                <motion.span
                  // Stable key — `key={myRank}` caused a full remount +
                  // re-animation on every poll even when the rank
                  // hadn't changed (myRank toggles between number and
                  // null during refetch). The delta animation is
                  // already gated by rankDelta below.
                  key="rank"
                  className="text-caption font-semibold leading-none tabular-nums text-muted-foreground"
                  initial={{ y: rankDelta != null ? (rankDelta < 0 ? 8 : -8) : 0, opacity: 0.4 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                >
                  {myRank
                    ? `#${myRank}`
                    : tFallback('league.gate.unranked', 'Unranked')}
                  {myRank && qualifiedCount > 0 && (
                    <span className="text-micro font-normal opacity-75 ms-0.5">/{qualifiedCount}</span>
                  )}
                </motion.span>

                {/* Delta badge — fades in, slides, fades out */}
                <AnimatePresence>
                  {rankDelta != null && rankDelta !== 0 && (
                    <motion.span
                      key="delta"
                      initial={{ opacity: 0, y: rankDelta < 0 ? 6 : -6, scale: 0.8 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: rankDelta < 0 ? -6 : 6, scale: 0.8 }}
                      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                      className={`text-micro font-bold leading-none px-1 py-0.5 rounded-full ${
                        rankDelta < 0
                          ? 'bg-success/30 text-success'
                          : 'bg-destructive/30 text-destructive'
                      }`}
                    >
                      {rankDelta < 0 ? `▲${Math.abs(rankDelta)}` : `▼${rankDelta}`}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </div>
            {/* Was an all-caps "LEFT" stacked above the number, which put
                a shouting label on the least important thing in the row.
                Number first, quiet word under it. */}
            <div className="text-end shrink-0 cq-start">
              <p className="font-heading font-bold text-sm leading-none tabular-nums">
                {daysLeft}{tFallback('league.daySuffix', 'd')}
              </p>
              <p className="text-micro text-muted-foreground leading-none mt-0.5">
                {tFallback('league.daysLeft', 'Days left')}
              </p>
            </div>
            {/* The whole card is the tap target; at half width the chevron
                is the first thing that can go. */}
            <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0 rtl:scale-x-[-1] cq-hide" />
          </div>
        </div>

        {/* Status strip — qualification first, then zone. Hairline above it,
            no fill: this is state, not a surface of its own. */}
        {strip && (
          <div className="shrink-0 px-2.5 py-1 border-t border-border/50 flex items-center gap-1.5 min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${strip.dot}`} aria-hidden="true" />
            <span className={`text-micro font-semibold truncate ${strip.tone}`}>
              {strip.text}
            </span>
          </div>
        )}

        {/* Global standing.
            The league is a weekly bracket of up to 30 people; this is the
            whole app. Putting it here means the global board's payload
            reaches the home screen without adding another destination —
            the full leaderboard stays one tap away behind the level badge.
            Hidden entirely when rank is unknown (loading, no activity yet,
            hide_from_search set, or a host without the RPC) so the card
            never shows a placeholder row. */}
        {globalRank != null && (
          <div className="shrink-0 px-2.5 py-1 border-t border-border/50 flex items-center gap-1.5 min-w-0">
            <Globe className="w-2.5 h-2.5 text-muted-foreground shrink-0" aria-hidden="true" />
            <span className="text-micro font-bold tabular-nums shrink-0">
              #{fmt(globalRank)}
            </span>
            <span className="text-micro text-muted-foreground truncate">
              {gap != null && ahead
                ? tFallback('league.globalGap', 'globally · {n} XP behind {name}', {
                    n: fmt(gap),
                    name: ahead.username || ahead.full_name || tFallback('progress.anonymous', 'Anonymous'),
                  })
                : tFallback('league.globalLeading', 'globally · leading the board')}
            </span>
          </div>
        )}
      </Card>
    </motion.button>
  );
}
