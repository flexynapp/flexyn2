// src/lib/data/onboardingCardioGoal.js
//
// Turns the onboarding "sharpen your plan" cardio answers into a real,
// trackable Goal (goals table) so a runner who says "training for a marathon"
// sees that goal in the Cardio tab + dashboard — not just a plan. Any recent
// time they entered is kept in the goal notes as a baseline. Fire-and-forget:
// the caller wraps this in .catch(); it must never block onboarding.

import * as goalsData from '@/lib/data/goals';

const EVENT_DISTANCE_M = { '5k': 5000, '10k': 10000, half: 21097, marathon: 42195 };
const EVENT_TITLE = {
  '5k': 'Run a 5K',
  '10k': 'Run a 10K',
  half: 'Run a Half Marathon',
  marathon: 'Run a Marathon',
  general: 'Run 3× a week',
};

function fmtTime(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export async function ensureOnboardingCardioGoal({ user, goals, sharpen } = {}) {
  if (!user?.id) return null;
  const goalList = Array.isArray(goals) ? goals : [];
  const isCardio = goalList.some((g) => g === 'speed' || g === 'endurance');
  const event = sharpen?.cardioEvent;
  if (!isCardio || !event) return null;

  // Idempotency: don't stack a second running goal on account-reset re-onboarding.
  try {
    // goals.list filters on user_id, a uuid. It was handed the email, so
    // the read always failed into the catch below and every re-onboarding
    // stacked another running goal.
    const existing = await goalsData.list(user.id);
    if (Array.isArray(existing) && existing.some(
      (g) => String(g.goal_type || '').startsWith('cardio') && g.cardio_activity === 'running' && g.status !== 'completed',
    )) {
      return null;
    }
  } catch { /* read hiccup → fall through and create */ }

  const current = sharpen?.cardioCurrent;
  const noteBits = [];
  if (current?.distance && current?.timeSec) {
    noteBits.push(`Current ${String(current.distance).toUpperCase()}: ${fmtTime(current.timeSec)}`);
  }
  noteBits.push('Set from onboarding');

  const base = {
    title: EVENT_TITLE[event] || 'Run more',
    cardio_activity: 'running',
    status: 'active',
    notes: noteBits.join(' · '),
  };

  const payload = event === 'general'
    ? { ...base, goal_type: 'cardio_sessions', target_sessions: 3, period: 'week' }
    : { ...base, goal_type: 'cardio_distance', target_distance_meters: EVENT_DISTANCE_M[event] || 5000, period: 'lifetime' };

  return goalsData.create(payload);
}
