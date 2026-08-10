// src/lib/data/injuries.js
// Data-access layer for the injury_logs table.

import { supabase } from '@/api/supabaseClient';
import { differenceInCalendarDays, parseISO, format, addDays } from 'date-fns';

// ── The way out ──────────────────────────────────────────────────────────────
//
// Reporting an injury removes a muscle group from every session the app
// generates. Until now the only thing that ever offered it BACK was a clearance
// prompt gated on `estimated_recovery_date` — an optional field, filled in on
// **0 of the 6 injuries in production**. So nothing had ever asked a single
// user whether they had healed, and the live table shows what that costs:
// three active injuries open 26, 59 and 75 days, none cleared, none with a
// date. A user who tapped "mild" on a sore knee in May is still being denied
// leg work in August.
//
// So the check-in now runs off the injury's AGE when no date was set. The date
// stays authoritative when it exists — someone who told us "six weeks" should
// not be nagged at two.
//
// Intervals are deliberately generous. This prompt is the app asking a question
// it cannot answer itself, and asking too early trains people to dismiss it;
// asking late costs a few days of conservative programming, which is the safe
// direction to be wrong in.
export const CHECK_IN_DAYS = { mild: 7, moderate: 14, serious: 28 };

/** Days before we first ask about an injury of this severity. */
export function checkInIntervalDays(severity) {
  return CHECK_IN_DAYS[severity] ?? CHECK_IN_DAYS.moderate;
}

/**
 * Read a bare YYYY-MM-DD as a LOCAL calendar day. `new Date('2026-08-07')` is
 * UTC midnight, i.e. the previous local day for everyone west of Greenwich —
 * the same trap the coach digest hit, where it ran every "days ago" one high.
 */
function asLocalDay(value) {
  if (!value) return null;
  const d = typeof value === 'string' ? parseISO(value) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Is this injury due a "are you cleared?" check-in?
 *
 * An explicit recovery date wins when one is set. Otherwise it falls back to
 * the injury's age against its severity's interval, so an injury logged
 * without a date is still asked about instead of sitting active forever.
 */
export function isCheckInDue(injury, today = new Date()) {
  if (!injury || injury.status === 'cleared') return false;

  const eta = asLocalDay(injury.estimated_recovery_date);
  if (eta) return differenceInCalendarDays(eta, today) <= 0;

  const logged = asLocalDay(injury.injured_at);
  if (!logged) return false;
  return differenceInCalendarDays(today, logged) >= checkInIntervalDays(injury.severity);
}

/**
 * "Not yet" — push the next check-in out by this injury's own interval.
 *
 * Writes the date rather than tracking a snooze separately: `estimated_recovery
 * _date` already means "when to look at this again", and reusing it means the
 * countdown and the 3-day warning start working for a user who never typed a
 * date. That is the whole point — those have never run for anybody.
 */
export function snoozeCheckIn(id, severity, from = new Date()) {
  const next = format(addDays(from, checkInIntervalDays(severity)), 'yyyy-MM-dd');
  return extendRecovery(id, next);
}

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
