// src/hooks/useHeroGlance.js
//
// The data behind Today's hero carousel beyond the week and the trend
// lines: a running duel, the crew war, today's fuel and quests, the goal
// nearest done and the weekly training pattern. Fetches here, decides in
// src/lib/heroGlance.js, so the bench page can hand HeroCard the same shape
// with sample data.
//
// Every query reuses a key another Today surface already fills, or extends
// one by prefix, so opening Today fetches nothing twice and every invalidate
// those surfaces issue refreshes the hero too:
//   ['activeDuel', id, 'hero']   extends Workout's ['activeDuel', id]
//   ['heroCrewWar', id]          CrewWarGlance and the profile hero
//   ['dailyQuests', id, date]    DailyQuestsCard, same queryFn
// Each one fails to null on its own, so one broken lookup costs one slide.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useTodayFuel } from '@/hooks/useTodayFuel';
import { getActiveDuel } from '@/lib/data/duels';
import { selectProfiles } from '@/lib/data/users';
import { fetchHeroCrewWar } from '@/lib/data/heroCrewWar';
import * as quests from '@/lib/data/quests';
import { supabase } from '@/api/supabaseClient';
import { format, subDays } from 'date-fns';
import {
  duelGlance, warGlance, fuelGlance, questGlance, goalGlance, trainingPattern,
} from '@/lib/heroGlance';

async function fetchHeroDuel(uid) {
  const duel = await getActiveDuel();
  if (!duel) return null;
  try {
    const otherId = duel.challenger_id === uid ? duel.opponent_id : duel.challenger_id;
    if (!otherId) return duel;
    const { data } = await selectProfiles((from) => from.select('id, username').eq('id', otherId));
    return { ...duel, opponent_name: data?.[0]?.username ?? null };
  } catch {
    return duel;
  }
}

export function useHeroGlance({ userProfile, goals, logs, cardioLogs, now }) {
  const { user } = useAuth();
  const uid = user?.id;

  const { data: duel = null } = useQuery({
    queryKey: ['activeDuel', uid, 'hero'],
    queryFn: () => fetchHeroDuel(uid),
    enabled: !!uid,
    staleTime: 60_000,
  });

  const { data: war = null } = useQuery({
    queryKey: ['heroCrewWar', uid],
    queryFn: () => fetchHeroCrewWar(uid),
    enabled: !!uid,
    staleTime: 5 * 60_000,
  });

  const { data: questRows = [] } = useQuery({
    queryKey: ['dailyQuests', uid, quests.todayDateString()],
    queryFn: async () => quests.sortQuestRows(await quests.ensureTodaysQuests(user)),
    enabled: !!uid,
    staleTime: 60_000,
  });

  const fuel = useTodayFuel(userProfile);

  // Does this person track food? A meal in the last week says yes. Only
  // then does the fuel slide show before today's first meal; otherwise a
  // "2,000 kcal left" would greet someone who has never logged one.
  // nutrition_goal cannot answer this: it is set on 1 profile of 146.
  const since = format(subDays(now || new Date(), 7), 'yyyy-MM-dd');
  const { data: tracksFood = false } = useQuery({
    queryKey: ['nutritionLogs', 'heroTracksFood', uid, since],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nutrition_logs')
        .select('id')
        .eq('user_id', uid)
        .gte('date', since)
        .gt('calories', 0)
        .limit(1);
      return !error && (data?.length ?? 0) > 0;
    },
    enabled: !!uid,
    staleTime: 10 * 60_000,
  });

  // Time left is measured from the moment the data lands, not from `now`,
  // which on Today is the start of the day.
  return useMemo(() => ({
    duel: duelGlance(duel, uid, new Date()),
    war: warGlance(war, new Date()),
    fuel: fuelGlance({
      calories: fuel.calories,
      macros: fuel.macros,
      targets: fuel.targets,
      tracksFood,
    }),
    quests: questGlance(questRows),
    goal: goalGlance({ goals, logs, cardioLogs }),
    pattern: trainingPattern({ logs, cardioLogs, now }),
  }), [duel, uid, war, fuel.calories, fuel.macros, fuel.targets, tracksFood, questRows, goals, logs, cardioLogs, now]);
}
