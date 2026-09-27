// src/lib/data/goals.js
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';
import { track, EVENTS } from '@/lib/analytics';

// Newest first. Dashboard, Workout and GoalsModal share the
// ['goals', email] cache, so every reader has to ask for the same order.
export const list = (userId, limit) =>
  db.entities.Goal.filter({ user_id: userId }, '-created_date', limit);

export const get = (id) => db.entities.Goal.get(id);

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

export const create = (data) => {
  assertNoTextProfanity({
    exercise_name: data.exercise_name,
    exercise: data.exercise,
    notes: data.notes,
  });
  return Promise.resolve(db.entities.Goal.create(data)).then((row) => {
    track(EVENTS.GOAL_CREATED, { type: data.goal_type || data.type || null });
    return row;
  });
};
export const update = (id, data) => {
  const textFields = {};
  if (data.exercise_name !== undefined) textFields.exercise_name = data.exercise_name;
  if (data.exercise      !== undefined) textFields.exercise      = data.exercise;
  if (data.notes         !== undefined) textFields.notes         = data.notes;
  if (Object.keys(textFields).length) assertNoTextProfanity(textFields);
  return db.entities.Goal.update(id, data);
};
export const remove = (id) => db.entities.Goal.delete(id);

// Completes a goal and pays its XP, both on the server. complete_goal checks
// the goal against the caller's own logs, so a goal that is not met comes
// back { completed: false, reason: 'not_met' } and nothing changes. Returns
// { completed, xp } on the first completion and { already: true } after it.
export async function complete(id) {
  const { data, error } = await supabase.rpc('complete_goal', { p_goal_id: id });
  if (error) throw error;
  return data || { completed: false };
}
