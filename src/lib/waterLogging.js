// src/lib/waterLogging.js
//
// What happens after a glass of water is saved: the league points check,
// the daily quest tick and the profile refresh. The Nutrition page and the + sheet
// both log water (navigation redesign, phase 4), and a second copy of
// these side effects is how one path ends up paying XP and the other not.
//
// No toast here on purpose. The Nutrition page's hydration ring is its own
// confirmation there; the + sheet shows the new total.

import * as quests from '@/lib/data/quests';
import { syncMyLoggingPoints } from '@/lib/data/leaguePoints';
import { ACTION_TYPES } from '@/lib/questCatalog';
import { track, EVENTS } from '@/lib/analytics';

// The most water one day can hold. Above this a tap is refused with a
// toast rather than saved, on both surfaces.
export const WATER_DAILY_CAP_OZ = 200;

export function rewardWaterLog({ user, queryClient, via = 'nutrition' }) {
  track(EVENTS.WATER_LOGGED, { via });
  // A glass earns nothing by itself (Kegan, 2026-10-01). The server pays
  // league points once, on the save that takes the day to the water goal.
  syncMyLoggingPoints().then((res) => {
    if (res?.xp > 0) {
      queryClient?.invalidateQueries({ queryKey: ['myLeague', user?.id] });
      queryClient?.invalidateQueries({ queryKey: ['myLeagueQuests', user?.id] });
    }
  });
  queryClient?.invalidateQueries({ queryKey: ['userProfile', user?.email] });
  quests.recordAction(user, ACTION_TYPES.WATER_LOGGED, 1)
    .then(() => queryClient?.invalidateQueries({ queryKey: ['dailyQuests'] }))
    .catch(() => {});
}
