// src/components/dashboard/LeagueCard.jsx
//
// Compact league card on the Dashboard. Shows the user's current tier, rank,
// XP this week, days remaining, and a peek at the rivals around them.
// Tap → full league standings (handled via onClick prop).

import React, { useRef, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Trophy, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
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

  const { league, tier, members, myRank, totalMembers } = data;
  const me = members.find(m => m && m.user_id === user.id);
  const myXp = me?.weekly_xp || 0;

  // Track previous rank to animate climbing/falling when rank changes
  const prevRankRef = useRef(myRank);
  const [rankDelta, setRankDelta] = useState(null); // negative = climbed up, positive = fell
  useEffect(() => {
    if (!myRank || !prevRankRef.current || prevRankRef.current === myRank) {
      prevRankRef.current = myRank;
      return;
    }
    const delta = myRank - prevRankRef.current; // negative = better rank (climbed)
    setRankDelta(delta);
    prevRankRef.current = myRank;
    const t = setTimeout(() => setRankDelta(null), 2800);
    return () => clearTimeout(t);
  }, [myRank]);

  // Days left in the week (week_end is a YYYY-MM-DD string)
  const endDate = parseISO(league.week_end + 'T23:59:59');
  const daysLeft = Math.max(0, differenceInCalendarDays(endDate, new Date()) + 1);

  // Promotion / demotion zones
  const promoteRank = tier.promote;
  const demoteRank = tier.demote > 0 ? totalMembers - tier.demote + 1 : null;
  const inPromoteZone = myRank && myRank <= promoteRank && promoteRank > 0;
  const inDemoteZone  = myRank && demoteRank !== null && myRank >= demoteRank;

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 380, damping: 22 }}
      className="block w-full text-start"
    >
      <Card className="overflow-hidden border-border/60 theme-card-accent">
        {/* Top stripe — gradient by tier */}
        <div className={`relative bg-gradient-to-r ${tier.gradient} px-4 pt-3 pb-4 text-white`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl drop-shadow" aria-hidden="true">{tier.icon}</span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider opacity-90">
                  {tFallback('league.weekly', 'Weekly League')}
                </p>
                <p className="font-heading font-bold text-base leading-tight drop-shadow">
                  {tier.label}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 opacity-80 rtl:scale-x-[-1]" />
          </div>

          {/* Rank + days */}
          <div className="mt-3 flex items-end justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider opacity-80">
                {tFallback('league.yourRank', 'Your rank')}
              </p>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <motion.p
                  key={myRank}
                  className="font-heading font-bold text-2xl leading-none tabular-nums"
                  initial={{ y: rankDelta != null ? (rankDelta < 0 ? 12 : -12) : 0, opacity: 0.4 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                >
                  {myRank ? `#${myRank}` : '—'}
                  <span className="text-sm font-normal opacity-75 ms-1">
                    / {totalMembers}
                  </span>
                </motion.p>

                {/* Delta badge — fades in, slides, fades out */}
                <AnimatePresence>
                  {rankDelta != null && rankDelta !== 0 && (
                    <motion.span
                      key="delta"
                      initial={{ opacity: 0, y: rankDelta < 0 ? 6 : -6, scale: 0.8 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: rankDelta < 0 ? -6 : 6, scale: 0.8 }}
                      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                      className={`text-xs font-bold leading-none px-1.5 py-0.5 rounded-full ${
                        rankDelta < 0
                          ? 'bg-emerald-500/30 text-emerald-200'  // climbed
                          : 'bg-red-500/30 text-red-200'           // fell
                      }`}
                    >
                      {rankDelta < 0 ? `▲${Math.abs(rankDelta)}` : `▼${rankDelta}`}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </div>
            <div className="text-end">
              <p className="text-[10px] uppercase tracking-wider opacity-80">
                {tFallback('league.daysLeft', 'Days left')}
              </p>
              <p className="font-heading font-bold text-xl leading-none mt-0.5 tabular-nums">{daysLeft}</p>
            </div>
          </div>
        </div>

        {/* Footer — zone status + XP */}
        <div className="px-4 py-2.5 flex items-center justify-between bg-card">
          {inPromoteZone ? (
            <span className="flex items-center gap-1 text-xs font-bold text-emerald-600">
              <ArrowUp className="w-3.5 h-3.5" />
              {tFallback('league.promoteZone', 'Promotion zone')}
            </span>
          ) : inDemoteZone ? (
            <span className="flex items-center gap-1 text-xs font-bold text-destructive">
              <ArrowDown className="w-3.5 h-3.5" />
              {tFallback('league.demoteZone', 'Demotion zone')}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Trophy className="w-3.5 h-3.5" />
              {tFallback('league.holdingPosition', 'Holding position')}
            </span>
          )}
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {fmt(myXp)} XP {tFallback('league.thisWeek', 'this week')}
          </span>
        </div>
      </Card>
    </motion.button>
  );
}
