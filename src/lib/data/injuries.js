// src/lib/data/injuries.js
// Data-access layer for the injury_logs table.

import { supabase } from '@/api/supabaseClient';

/** List all injuries for the current user, newest first. */
export async function listInjuries() {
  const { data, error } = await supabase
    .from('injury_logs')
    .select('*')
    .order('injured_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** List only active/recovering injuries for the current user. */
export async function listActiveInjuries() {
  const { data, error } = await supabase
    .from('injury_logs')
    .select('*')
    .in('status', ['active', 'recovering'])
    .order('injured_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Create a new injury log entry. */
export async function logInjury({
  userId,
  userEmail,
  muscleGroup,
  severity,
  notes,
  injuredAt,
  estimatedRecoveryDate,
}) {
  const { data, error } = await supabase
    .from('injury_logs')
    .insert({
      user_id: userId,
      user_email: userEmail,
      muscle_group: muscleGroup,
      severity,
      notes: notes || null,
      injured_at: injuredAt || new Date().toISOString().split('T')[0],
      estimated_recovery_date: estimatedRecoveryDate || null,
      status: 'active',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Mark an injury as cleared. */
export async function clearInjury(id) {
  const { data, error } = await supabase
    .from('injury_logs')
    .update({
      status: 'cleared',
      cleared_at: new Date().toISOString().split('T')[0],
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Extend an injury's estimated recovery date (user is "not yet" cleared). */
export async function extendRecovery(id, newDate) {
  const { data, error } = await supabase
    .from('injury_logs')
    .update({ estimated_recovery_date: newDate, status: 'recovering' })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Delete a single injury log entry. */
export async function deleteInjury(id) {
  const { error } = await supabase.from('injury_logs').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Returns the set of muscle groups that should be EXCLUDED from workout
 * generation based on active injuries.
 * For 'serious' severity, also excludes synergist groups.
 */
export function getExcludedMuscleGroups(activeInjuries = []) {
  const SYNERGISTS = {
    shoulders: ['chest', 'triceps'],
    chest:     ['shoulders', 'triceps'],
    back:      ['biceps'],
    legs:      ['glutes'],
    glutes:    ['legs'],
  };

  const excluded = new Set();
  for (const inj of activeInjuries) {
    const grp = inj.muscle_group?.toLowerCase();
    if (!grp) continue;
    excluded.add(grp);
    if (inj.severity === 'serious') {
      for (const syn of SYNERGISTS[grp] || []) excluded.add(syn);
    }
  }
  return excluded;
}
