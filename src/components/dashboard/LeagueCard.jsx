// src/components/dashboard/LeagueCard.jsx
//
// Compact league card on the Dashboard. Shows the user's current tier, rank,
// XP this week, days remaining, and a peek at the rivals around them.
// Tap → full league standings (handled via onClick prop).

import React, { useRef, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import * as leagues from '@/lib/data/leagues';
import { differenceInCalendarDays, parseISO } from 'date-fns';

export default function LeagueCard({ onClick }) {
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
    return <Skeleton className="h-28 rounded-xl" />;
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
  const me = members.find(m => m && m.user_id === user.id);
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

  // Note: promotion/demotion zone visual indicators were planned but
  // never wired into this compact card — the full standings modal
  // surfaces them instead. Removed the dead promoteRank / demoteRank /
  // inPromoteZone / inDemoteZone locals that were computed every render
  // and never read.

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 380, damping: 22 }}
      className="block w-full h-full text-start"
    >
      <Card className={`overflow-hidden border-border/60 theme-card-accent h-full flex ${tier.ringClass || ''}`}>
        {/* Top stripe — gradient by tier. flex-1 + items-center fills
            and vertically centers content so the card stretches to
            match its row neighbor (e.g. Readiness compact square). */}
        <div className={`relative flex-1 bg-gradient-to-r ${tier.gradient} px-2.5 py-1.5 text-white flex items-center`}>
          <div className="flex items-center gap-2 w-full">
            <span className="text-base drop-shadow shrink-0" aria-hidden="true">{tier.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[8px] font-bold uppercase tracking-wider opacity-90 leading-tight">
                {tier.label ? `${tier.label} ` : ''}{tFallback('league.leagueSuffix', 'League')}
              </p>
              <div className="flex items-baseline gap-1">
                <motion.span
                  // Stable key — `key={myRank}` caused a full remount +
                  // re-animation on every poll even when the rank
                  // hadn't changed (myRank toggles between number and
                  // null during refetch). The delta animation is
                  // already gated by rankDelta below.
                  key="rank"
                  className="font-heading font-bold text-sm leading-none tabular-nums"
                  initial={{ y: rankDelta != null ? (rankDelta < 0 ? 8 : -8) : 0, opacity: 0.4 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                >
                  #{myRank ?? tFallback('common.dash', '—')}
                  {totalMembers > 0 && (
                    <span className="text-[10px] font-normal opacity-75 ms-0.5">/{totalMembers}</span>
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
                      className={`text-[9px] font-bold leading-none px-1 py-0.5 rounded-full ${
                        rankDelta < 0
                          ? 'bg-emerald-500/30 text-emerald-200'
                          : 'bg-red-500/30 text-red-200'
                      }`}
                    >
                      {rankDelta < 0 ? `▲${Math.abs(rankDelta)}` : `▼${rankDelta}`}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </div>
            <div className="text-end shrink-0">
              <p className="text-[8px] uppercase tracking-wider opacity-80 leading-none">
                {tFallback('league.daysLeft', 'Left')}
              </p>
              <p className="font-heading font-bold text-sm leading-none mt-0.5 tabular-nums">{daysLeft}{tFallback('league.daySuffix', 'd')}</p>
            </div>
            <ChevronRight className="w-3 h-3 opacity-70 shrink-0 rtl:scale-x-[-1]" />
          </div>
        </div>
      </Card>
    </motion.button>
  );
}
