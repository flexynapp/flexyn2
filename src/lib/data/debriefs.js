// src/lib/data/debriefs.js
// Data-access layer for the weekly_debriefs table.
// All reads use the logged-in user's session (RLS enforces user_id ownership).
//
// Both list reads name columns explicitly (vs SELECT *), so they're
// wrapped in safeSelect — when the team adds a column to weekly_debriefs
// in a future migration that hasn't propagated to the PostgREST schema
// cache yet, the calls strip the missing column and retry rather than
// crashing the DebriefVault component.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';

const DEBRIEF_COLUMNS = [
  'id', 'week_number', 'year', 'week_label',
  'epoch_id', 'epoch_name', 'data', 'created_at',
];

/**
 * Fetch all debriefs for the current user, newest first.
 * @returns {Promise<Array>}
 */
export async function listDebriefs() {
  const { data, error } = await safeSelect({
    columns: DEBRIEF_COLUMNS,
    build: (cols) => supabase
      .from('weekly_debriefs')
      .select(cols)
      .order('year',        { ascending: false })
      .order('week_number', { ascending: false }),
  });

  if (error) throw error;
  return data || [];
}

/**
 * Fetch the most recent debrief for the current user.
 * @returns {Promise<Object|null>}
 */
export async function latestDebrief() {
  const { data, error } = await safeSelect({
    columns: DEBRIEF_COLUMNS,
    build: (cols) => supabase
      .from('weekly_debriefs')
      .select(cols)
      .order('year',        { ascending: false })
      .order('week_number', { ascending: false })
      .limit(1)
      .maybeSingle(),
  });

  if (error) throw error;
  return data;
}

/**
 * Fetch a single debrief by id.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getDebrief(id) {
  // SELECT * is column-agnostic; no safeSelect needed.
  const { data, error } = await supabase
    .from('weekly_debriefs')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Generate (or refresh) the weekly debrief for the given week.
 * Calls the SECURITY DEFINER RPC which computes stats from workout_logs +
 * nutrition_logs and upserts the row into weekly_debriefs.
 *
 * @param {Date|string|null} weekStart  Monday of the target week; defaults to
 *                                      the current ISO week if omitted.
 * @returns {Promise<Object>}  The upserted debrief object (id will be fetched
 *                              via a follow-up listDebriefs call).
 */
export async function generateWeeklyDebrief(weekStart = null) {
  // Format as YYYY-MM-DD for the RPC, or omit for current week default
  const param = weekStart
    ? { p_week_start: typeof weekStart === 'string'
          ? weekStart
          : weekStart.toISOString().slice(0, 10) }
    : {};

  const { data, error } = await supabase.rpc('generate_my_weekly_debrief', param);
  if (error) throw error;
  return data;
}

/**
 * ISO Monday of the week containing `date` (defaults to today).
 * Handy for passing to generateWeeklyDebrief.
 * @param {Date} [date]
 * @returns {string}  YYYY-MM-DD
 */
export function currentWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Previous week's Monday (YYYY-MM-DD).
 */
export function prevWeekStart(date = new Date()) {
  const d = new Date(currentWeekStart(date));
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}
