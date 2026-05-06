// src/components/dashboard/LeagueCard.jsx
//
// Compact league card on the Dashboard. Shows the user's current tier, rank,
// XP this week, days remaining, and a peek at the rivals around them.
// Tap → full league standings (handled via onClick prop).

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Trophy, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as leagues from '@/lib/data/leagues';
import { TIERS } from '@/lib/leagueTiers';
import { differenceInCalendarDays, parseISO } from 'date-fns';

export default function LeagueCard({ onClick }) {
  const { user } = useAuth();
  const { t } = useLanguage();

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

  if (!data || !data.league) {
    return null;
  }

  const { league, tier, members, myRank, totalMembers } = data;
  const me = members.find(m => m.user_id === user.id);
  const myXp = me?.weekly_xp || 0;

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
      className="block w-full text-left"
    >
      <Card className="overflow-hidden border-border/60">
        {/* Top stripe — gradient by tier */}
        <div className={`relative bg-gradient-to-r ${tier.gradient} px-4 pt-3 pb-4 text-white`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl drop-shadow" aria-hidden="true">{tier.icon}</span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider opacity-90">
                  {t('league.weekly') === 'league.weekly' ? 'Weekly League' : t('league.weekly')}
                </p>
                <p className="font-heading font-bold text-base leading-tight drop-shadow">
                  {tier.label}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 opacity-80" />
          </div>

          {/* Rank + days */}
          <div className="mt-3 flex items-end justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider opacity-80">
                {t('league.yourRank') === 'league.yourRank' ? 'Your rank' : t('league.yourRank')}
              </p>
              <p className="font-heading font-bold text-2xl leading-none mt-0.5 tabular-nums">
                {myRank ? `#${myRank}` : '—'}
                <span className="text-sm font-normal opacity-75 ml-1">
                  / {totalMembers}
                </span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider opacity-80">
                {t('league.daysLeft') === 'league.daysLeft' ? 'Days left' : t('league.daysLeft')}
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
              {t('league.promoteZone') === 'league.promoteZone' ? 'Promotion zone' : t('league.promoteZone')}
            </span>
          ) : inDemoteZone ? (
            <span className="flex items-center gap-1 text-xs font-bold text-destructive">
              <ArrowDown className="w-3.5 h-3.5" />
              {t('league.demoteZone') === 'league.demoteZone' ? 'Demotion zone' : t('league.demoteZone')}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Trophy className="w-3.5 h-3.5" />
              {t('league.holdingPosition') === 'league.holdingPosition' ? 'Holding position' : t('league.holdingPosition')}
            </span>
          )}
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {myXp.toLocaleString()} XP {t('league.thisWeek') === 'league.thisWeek' ? 'this week' : t('league.thisWeek')}
          </span>
        </div>
      </Card>
    </motion.button>
  );
}
