// src/lib/waterGoal.js
//
// The daily water goal in ounces. It lived inline in WaterTracker, and the
// Today screen's fuel glance needs the same number: two surfaces showing
// "5 / 8" against different goals would read as one of them being broken.

import { parseLocalDate } from '@/lib/dateUtils';

export function dailyWaterGoalOz(userProfile = {}) {
  const weight = userProfile?.weight_lbs;
  const gender = userProfile?.gender || 'male';
  let age = 30;
  if (userProfile?.birthday) {
    const birth = parseLocalDate(userProfile.birthday) || new Date(userProfile.birthday);
    const now = new Date();
    age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  } else if (userProfile?.age) {
    age = userProfile.age;
  }
  let baseOz = gender === 'female' ? 73 : 100;
  if (weight) {
    const ref = gender === 'female' ? 125 : 154;
    baseOz = Math.round(baseOz * Math.min(Math.max(weight / ref, 0.7), 1.3));
  }
  if (age < 18) baseOz = Math.round(baseOz * 0.9);
  else if (age > 55) baseOz = Math.round(baseOz * 0.95);
  return Math.round(baseOz / 8) * 8;
}
