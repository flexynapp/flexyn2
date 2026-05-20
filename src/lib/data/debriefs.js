// src/lib/data/debriefs.js
// Data-access layer for the weekly_debriefs table.
// All reads use the logged-in user's session (RLS enforces user_id ownership).

import { supabase } from '@/api/supabaseClient';

/**
 * Fetch all debriefs for the current user, newest first.
 * @returns {Promise<Array>}
 */
export async function listDebriefs() {
  const { data, error } = await supabase
    .from('weekly_debriefs')
    .select('id, week_number, year, week_label, epoch_id, epoch_name, data, created_at')
    .order('year',        { ascending: false })
    .order('week_number', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Fetch the most recent debrief for the current user.
 * @returns {Promise<Object|null>}
 */
export async function latestDebrief() {
  const { data, error } = await supabase
    .from('weekly_debriefs')
    .select('id, week_number, year, week_label, epoch_id, epoch_name, data, created_at')
    .order('year',        { ascending: false })
    .order('week_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Fetch a single debrief by id.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getDebrief(id) {
  const { data, error } = await supabase
    .from('weekly_debriefs')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}
