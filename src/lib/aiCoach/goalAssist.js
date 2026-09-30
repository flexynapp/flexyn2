// src/lib/aiCoach/goalAssist.js
//
// "Assist me" on a goal: the message the Coach is sent for one goal.
//
// The text is ENGLISH on purpose, the same contract as the Coach's prompt
// chips (see promptLabel in CoachChat.jsx). The language model answers in the
// app language whatever the question's language, and the rules engine that
// answers when the model is unavailable (offline, or a guest past the daily
// limit) matches English phrasing only. The transcript shows a translated
// line instead, passed alongside as `display`.
//
// It opens "I want to train for my goal", which the rules engine reads as a
// build-me-a-plan request (intents.js, `train for`). So a capped guest still
// gets a session aimed at the goal rather than the generic help menu.
//
// Numbers come from the same progress functions the Goals list draws, so the
// Coach is told exactly what the row shows.

import { differenceInDays, format, startOfToday } from 'date-fns';
import { parseLocalDate } from '@/lib/dateUtils';
import { computeStrengthGoalProgress, computeCardioGoalProgress, isCardioGoal } from '@/lib/goalProgress';
import { formatWeight, formatWeightNumber } from '@/lib/weightUnit';
import { formatDistance } from '@/lib/distanceUnit';

const ACTIVITY_EN = { running: 'running', biking: 'cycling', walking: 'walking' };

function minutes(seconds) {
  const m = Math.round((Number(seconds) || 0) / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

function describeStrength(goal, logs, weightUnit) {
  const r = computeStrengthGoalProgress(goal, logs);
  const lift = goal.exercise_name || 'my lift';
  const tw = Number(goal.target_weight) > 0 ? Number(goal.target_weight) : 0;
  const tr = Number(goal.target_reps) > 0 ? Number(goal.target_reps) : 0;

  let target;
  let current = null;
  if (tw && tr) {
    target = `${lift}, one set of ${formatWeight(tw, weightUnit)} x ${tr}`;
    if (r.bestSet) current = `My closest set so far is ${formatWeightNumber(r.bestSet.weight, weightUnit)} x ${r.bestSet.reps}.`;
  } else if (tw) {
    target = `${lift} at ${formatWeight(tw, weightUnit)}`;
    if (r.maxWeight > 0) current = `My heaviest so far is ${formatWeight(r.maxWeight, weightUnit)}.`;
  } else {
    target = `${lift}, ${tr} reps in one set`;
    if (r.maxReps > 0) current = `My best so far is ${r.maxReps} reps.`;
  }
  return { target, current: current || `I have not logged a set of ${lift} since setting it.` };
}

function describeCardio(goal, cardioLogs, distanceUnit) {
  const r = computeCardioGoalProgress(goal, cardioLogs);
  const activity = ACTIVITY_EN[goal.cardio_activity] || 'cardio';
  const period = goal.period === 'week' ? ' each week' : goal.period === 'month' ? ' each month' : '';
  const soFar = goal.period === 'week' ? 'So far this week' : goal.period === 'month' ? 'So far this month' : 'So far';

  let target;
  let done;
  if (goal.goal_type === 'cardio_distance') {
    const single = goal.single_session === true;
    target = `${formatDistance(r.target, distanceUnit, 1)} of ${activity}${single ? ' in one session' : ''}${period}`;
    done = r.currentValue > 0
      ? `${single ? 'My longest session is' : `${soFar} I have done`} ${formatDistance(r.currentValue, distanceUnit, 1)}.`
      : null;
  } else if (goal.goal_type === 'cardio_duration') {
    target = `${minutes(r.target)} of ${activity}${period}`;
    done = r.currentValue > 0 ? `${soFar} I have done ${minutes(r.currentValue)}.` : null;
  } else {
    target = `${r.target} ${activity} session${r.target === 1 ? '' : 's'}${period}`;
    done = r.currentValue > 0 ? `${soFar} I have done ${r.currentValue}.` : null;
  }
  return { target, current: done || 'I have not logged any toward it yet.' };
}

/**
 * The English message sent to the Coach for one goal.
 *
 * @param {object} goal
 * @param {object} data
 * @param {Array}  data.logs          workout logs, as the Goals list gets them
 * @param {Array}  data.cardioLogs
 * @param {string} data.weightUnit
 * @param {string} data.distanceUnit
 * @param {Date}   [data.today]       for tests
 */
export function buildGoalAssistMessage(goal, { logs = [], cardioLogs = [], weightUnit = 'lbs', distanceUnit = 'mi', today } = {}) {
  if (!goal) return '';
  const { target, current } = isCardioGoal(goal)
    ? describeCardio(goal, cardioLogs, distanceUnit)
    : describeStrength(goal, logs, weightUnit);

  const parts = [`I want to train for my goal: ${target}.`, current];

  const deadline = goal.deadline ? parseLocalDate(goal.deadline) : null;
  if (deadline && !Number.isNaN(deadline.getTime())) {
    const days = differenceInDays(deadline, today || startOfToday());
    const date = format(deadline, 'MMMM d, yyyy');
    if (days > 0) parts.push(`My target date is ${date}, ${days} day${days === 1 ? '' : 's'} from now.`);
    else if (days === 0) parts.push('My target date is today.');
    else parts.push(`My target date was ${date}, so I need a new realistic date.`);
  }

  parts.push('Help me make a plan to get there: how often to train for it, how to progress week to week, and what to watch out for.');
  return parts.join(' ');
}
