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
