// src/components/notifications/NotificationNowCard.jsx
//
// What is live right now, at the top of the notifications panel: quests
// left before the daily reset, a workout streak that ends at midnight, a
// session scheduled for today. Kegan picked this in the panel audit
// (2026-09-30, option C).
//
// It replaces the reminder ROWS those same facts used to arrive as. A row
// is written once and is wrong an hour later ("4 quests left today" from a
// week ago still said "today"); this reads each fact from its source every
// time the panel opens, counts down while it is open, and a line disappears
// on its own the moment it stops being true. When nothing is live the card
// renders nothing at all.
//
// The query keys are the ones the Dashboard already uses for the same data,
// with the same query functions, so opening the panel on Today costs
// nothing and a quest finished anywhere shows here straight away.

import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { differenceInCalendarDays } from 'date-fns';
import { CalendarClock, ChevronRight, Flame, Hourglass } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { parseLocalDate } from '@/lib/dateUtils';
import * as quests from '@/lib/data/quests';
import { listUpcomingWorkouts, localDateKey, formatHour } from '@/lib/data/scheduledWorkouts';

/** Whole minutes from `now` to the next local midnight. */
export function minutesToMidnight(now = new Date()) {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(0, Math.ceil((midnight - now) / 60_000));
}

/** The live items, in the order they are shown. Pure, for tests. */
export function liveItems({ questRows = [], streakProfile = null, schedules = [], now = new Date() }) {
  const items = [];

  const streak = streakProfile?.workout_streak ?? 0;
  const last = parseLocalDate(streakProfile?.last_workout_date);
  // Trained yesterday and not yet today: the streak ends at midnight. The
  // same rule as WorkoutStreakBanner and the server's streak reminder.
  if (streak >= 2 && last && differenceInCalendarDays(now, last) === 1) {
    items.push({ kind: 'streak', streak });
  }

  const today = localDateKey(now);
  const session = schedules.find(s => s.scheduled_date === today
    && (s.status === 'pending' || s.status === 'notified'));
  if (session) items.push({ kind: 'scheduled', session });

  const total = questRows.length;
  const done = questRows.filter(q => q.completed_at || q.progress >= q.target).length;
  if (total > 0 && done < total) items.push({ kind: 'quests', done, total });

  return items;
}

// Minutes are the finest unit shown, so a tick every 20s keeps the number
// honest without re-rendering every second.
function useNow(active) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return undefined;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export default function NotificationNowCard({ user, open, onGo, tFallback, language }) {
  const now = useNow(open);
  const enabled = !!user?.id && open;

  const { data: questRows = [] } = useQuery({
    queryKey: ['dailyQuests', user?.id, quests.todayDateString()],
    queryFn: async () => quests.sortQuestRows(await quests.ensureTodaysQuests(user)),
    enabled,
  });

  const { data: streakProfile = null } = useQuery({
    queryKey: ['workoutStreakProfile', user?.id],
    queryFn: async () => {
      const { data } = await safeSelect({
        columns: ['workout_streak', 'last_workout_date', 'longest_workout_streak'],
        build: (cols) => supabase.from('user_profiles').select(cols).eq('id', user.id).maybeSingle(),
      });
      return data;
    },
    enabled,
    staleTime: 30_000,
  });

  const { data: schedules = [] } = useQuery({
    queryKey: ['notificationNowSchedules', user?.id],
    queryFn: () => listUpcomingWorkouts(10),
    enabled,
    staleTime: 60_000,
  });

  const items = liveItems({ questRows, streakProfile, schedules, now });
  if (items.length === 0) return null;

  const mins = minutesToMidnight(now);
  const resetsIn = mins >= 60
    ? tFallback('notifications.now.resetsIn', 'Resets in {h}h {m}m', { h: Math.floor(mins / 60), m: mins % 60 })
    : tFallback('notifications.now.resetsInMinutes', 'Resets in {m}m', { m: mins });

  const render = (item) => {
    if (item.kind === 'streak') {
      return {
        key: 'streak', Icon: Flame, to: '/workout',
        title: tFallback('notifications.now.streak', '{n} day streak ends at midnight', { n: item.streak }),
        sub: tFallback('notifications.now.streakHint', 'Log a workout today to keep it.'),
      };
    }
    if (item.kind === 'scheduled') {
      const s = item.session;
      return {
        key: `scheduled-${s.id}`, Icon: CalendarClock, to: `/workout?scheduled=${s.id}`,
        title: s.title || tFallback('notifications.now.scheduled', 'Scheduled workout'),
        sub: tFallback('notifications.now.scheduledAt', 'Today at {time}', { time: formatHour(s.scheduled_hour, language) }),
      };
    }
    return {
      key: 'quests', Icon: Hourglass, to: '/dashboard',
      title: tFallback('notifications.now.quests', '{done} of {total} quests done', { done: item.done, total: item.total }),
      sub: resetsIn,
      progress: item.done / item.total,
    };
  };

  return (
    <section
      aria-label={tFallback('notifications.now.label', 'Right now')}
      className="mx-4 mt-3 mb-1 rounded-lg border border-border overflow-hidden shrink-0"
    >
      {items.map(render).map((it, i) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onGo(it.to)}
          className={`w-full flex items-center gap-3 px-3 py-3 text-start transition-colors hover:bg-secondary/40 active:bg-secondary/40 ${
            i > 0 ? 'border-t border-border' : ''
          }`}
        >
          <span className="w-10 h-10 rounded-lg bg-primary/[0.14] text-primary flex items-center justify-center shrink-0">
            <it.Icon className="w-5 h-5" aria-hidden="true" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-body font-semibold leading-tight">{it.title}</span>
            <span className="block text-label text-muted-foreground mt-1 tabular-nums">{it.sub}</span>
            {it.progress != null && (
              <span className="block h-1 rounded-full bg-secondary mt-2 overflow-hidden" aria-hidden="true">
                <span
                  className="block h-full bg-primary rounded-full transition-[width] duration-500"
                  style={{ width: `${Math.round(it.progress * 100)}%` }}
                />
              </span>
            )}
          </span>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 rtl:scale-x-[-1]" aria-hidden="true" />
        </button>
      ))}
    </section>
  );
}
