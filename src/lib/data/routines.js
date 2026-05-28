// src/lib/data/routines.js
//
// "My Routine" data layer (migration 163). A routine is a named weekly
// calendar: 7 day-slots (index 0 = Monday … 6 = Sunday), each:
//   { label, focus, isRest, exercises: [{ name, muscles }] }
// One routine per user can be active — it drives "today's plan" on Workout.

import { supabase } from '@/api/supabaseClient';

export const MAX_ROUTINES = 50;
export const MAX_EXERCISES_PER_DAY = 30;

// Monday-first day labels. JS getDay() is Sunday-first, so todayIndex()
// rotates it to match this array.
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_NAMES_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Focus options mirror the workout generator's FOCUS_TO_GROUPS keys so the
// "Up for a challenge" add-on can build a matching session.
export const FOCUS_OPTIONS = [
  { id: 'push',      label: 'Push' },
  { id: 'pull',      label: 'Pull' },
  { id: 'legs',      label: 'Legs' },
  { id: 'upper',     label: 'Upper' },
  { id: 'lower',     label: 'Lower' },
  { id: 'full_body', label: 'Full Body' },
  { id: 'core',      label: 'Core' },
];

export function todayIndex() {
  // getDay(): 0 = Sunday … 6 = Saturday → rotate to 0 = Monday.
  return (new Date().getDay() + 6) % 7;
}

export function emptyDay() {
  return { label: '', focus: null, isRest: false, exercises: [] };
}

export function emptyWeek() {
  return Array.from({ length: 7 }, emptyDay);
}

// Labeled split skeletons — give the user the structure; they fill in the
// lifts they actually like (the whole point of the feature).
export const TEMPLATES = [
  {
    name: 'Push / Pull / Legs',
    days: buildWeek([
      ['Push', 'push'], ['Pull', 'pull'], ['Legs', 'legs'],
      ['Push', 'push'], ['Pull', 'pull'], ['Legs', 'legs'], ['Rest', null],
    ]),
  },
  {
    name: 'Upper / Lower',
    days: buildWeek([
      ['Upper', 'upper'], ['Lower', 'lower'], ['Rest', null],
      ['Upper', 'upper'], ['Lower', 'lower'], ['Rest', null], ['Rest', null],
    ]),
  },
  {
    name: 'Full Body 3×',
    days: buildWeek([
      ['Full Body', 'full_body'], ['Rest', null], ['Full Body', 'full_body'],
      ['Rest', null], ['Full Body', 'full_body'], ['Rest', null], ['Rest', null],
    ]),
  },
  {
    name: 'Bro Split',
    days: buildWeek([
      ['Chest', 'push'], ['Back', 'pull'], ['Legs', 'legs'],
      ['Shoulders', 'push'], ['Arms', 'pull'], ['Rest', null], ['Rest', null],
    ]),
  },
];

function buildWeek(pairs) {
  return pairs.map(([label, focus]) => ({
    label,
    focus,
    isRest: label === 'Rest',
    exercises: [],
  }));
}

// ── sanitize ────────────────────────────────────────────────────────────────
function cleanDays(days) {
  const week = emptyWeek();
  if (!Array.isArray(days)) return week;
  for (let i = 0; i < 7; i++) {
    const d = days[i] || {};
    week[i] = {
      label:  String(d.label || '').slice(0, 40),
      focus:  FOCUS_OPTIONS.some(f => f.id === d.focus) ? d.focus : null,
      isRest: !!d.isRest,
      exercises: Array.isArray(d.exercises)
        ? d.exercises
            .slice(0, MAX_EXERCISES_PER_DAY)
            .map(e => ({
              name: String(e?.name || '').slice(0, 80),
              muscles: Array.isArray(e?.muscles) ? e.muscles.slice(0, 6) : [],
            }))
            .filter(e => e.name)
        : [],
    };
  }
  return week;
}

// ── reads ─────────────────────────────────────────────────────────────────
export async function listMyRoutines() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return [];
  const { data, error } = await supabase
    .from('routines')
    .select('id, name, days, is_active, created_at, updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });
  if (error) return [];
  return data ?? [];
}

export async function getActiveRoutine() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return null;
  const { data, error } = await supabase
    .from('routines')
    .select('id, name, days, is_active')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}

// ── writes ──────────────────────────────────────────────────────────────────
export async function createRoutine({ name, days, activate = false }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id || !user?.email) return { ok: false, reason: 'unauthenticated' };

  const { count } = await supabase
    .from('routines')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);
  if ((count ?? 0) >= MAX_ROUTINES) {
    return { ok: false, reason: 'limit' };
  }

  if (activate) await deactivateAll(user.id);

  const { data, error } = await supabase
    .from('routines')
    .insert({
      user_id: user.id,
      user_email: user.email,
      name: String(name || 'My Routine').slice(0, 60),
      days: cleanDays(days),
      is_active: !!activate,
    })
    .select('id, name, days, is_active')
    .single();
  if (error) {
    console.warn('[routines] create failed:', error);
    return { ok: false, reason: 'db_error' };
  }
  return { ok: true, routine: data };
}

export async function updateRoutine(id, { name, days }) {
  const patch = { updated_at: new Date().toISOString() };
  if (typeof name === 'string') patch.name = name.slice(0, 60);
  if (days != null) patch.days = cleanDays(days);
  const { error } = await supabase.from('routines').update(patch).eq('id', id);
  if (error) {
    console.warn('[routines] update failed:', error);
    return { ok: false, reason: 'db_error' };
  }
  return { ok: true };
}

export async function deleteRoutine(id) {
  const { error } = await supabase.from('routines').delete().eq('id', id);
  return { ok: !error };
}

async function deactivateAll(userId) {
  await supabase
    .from('routines')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('is_active', true);
}

// Makes one routine active (deactivating any other) so it drives "today".
export async function setActiveRoutine(id) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false, reason: 'unauthenticated' };
  // Deactivate the current active row first so the partial-unique index
  // (one active per user) never trips.
  await deactivateAll(user.id);
  const { error } = await supabase.from('routines').update({ is_active: true }).eq('id', id);
  if (error) {
    console.warn('[routines] setActive failed:', error);
    return { ok: false, reason: 'db_error' };
  }
  return { ok: true };
}
