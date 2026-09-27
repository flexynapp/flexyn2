// src/components/gymRival/RivalMonthStrip.jsx
//
// One line under the Rival card: this month's weeks won against the monthly
// goal. It is the reason a single week's result is not the end of the story,
// so it shows in every card state, including between races.
//
// Read-only data, not a widget, so a hairline row rather than a card.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMyRivalMonth, RIVAL_MONTH_BONUS } from '@/lib/data/rivalMonth';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter, useDateFormatter } from '@/lib/intl';

export default function RivalMonthStrip({ currentUserId }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const fmtDate = useDateFormatter();
  const { data } = useQuery({
    queryKey: ['rivalMonth', currentUserId],
    queryFn: getMyRivalMonth,
    enabled: !!currentUserId,
    staleTime: 5 * 60_000,
  });
  if (!data) return null;

  const { wins, goal } = data;
  const earned = wins >= goal;
  const month = fmtDate(data.month, { month: 'long' });

  return (
    <div className="-mt-2 mb-4 px-4 py-2.5 rounded-xl border border-border">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold truncate">
          {tFallback('rivalMonth.progress', '{month}: {n} of {goal} weeks won', {
            month, n: fmt(Math.min(wins, goal)), goal: fmt(goal),
          })}
        </p>
        <span className="flex gap-1 shrink-0" aria-hidden="true">
          {Array.from({ length: goal }, (_, i) => (
            <span key={i} className={`w-2 h-2 rounded-full ${i < wins ? 'bg-success' : 'bg-secondary'}`} />
          ))}
        </span>
      </div>
      <p className="text-micro text-muted-foreground pt-1">
        {earned
          ? tFallback('rivalMonth.earned', 'Monthly bonus earned. It is paid when the month ends.')
          : tFallback('rivalMonth.bonus', 'Win {goal} weeks this month for {xp} XP, {coins} coins and {caps} capsules.', {
            goal: fmt(goal), xp: fmt(RIVAL_MONTH_BONUS.xp), coins: fmt(RIVAL_MONTH_BONUS.coins), caps: fmt(RIVAL_MONTH_BONUS.capsules),
          })}
      </p>
    </div>
  );
}
