// src/lib/waterLogging.js
//
// What happens after a glass of water is saved: the XP grant, the daily
// quest tick and the profile refresh. The Nutrition page and the + sheet
// both log water (navigation redesign, phase 4), and a second copy of
// these side effects is how one path ends up paying XP and the other not.
//
// No toast here on purpose. The Nutrition page's hydration ring is its own
// confirmation there; the + sheet shows the new total.

import { db } from '@/api/db';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';
import { XP_REWARDS } from '@/lib/xpSystem';

// The most water one day can hold. Above this a tap is refused with a
// toast rather than saved, on both surfaces.
export const WATER_DAILY_CAP_OZ = 200;

export function rewardWaterLog({ user, date, oz, queryClient }) {
  const xpForWater = (XP_REWARDS && XP_REWARDS.waterGlass) || 3;
  db.functions.invoke('updateUserXpAndAchievements', {
    xp_gained: xpForWater,
    action_type: 'water_logged',
    action_data: { date, oz },
  }).catch(() => {});
  queryClient?.invalidateQueries({ queryKey: ['userProfile', user?.email] });
  quests.recordAction(user, ACTION_TYPES.WATER_LOGGED, 1)
    .then(() => queryClient?.invalidateQueries({ queryKey: ['dailyQuests'] }))
    .catch(() => {});
}
