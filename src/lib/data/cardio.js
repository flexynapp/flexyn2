// src/lib/data/cardio.js
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { containsProfanity } from '@/lib/profanityFilter';
import { ownedRows } from './ownedRows';

const rows = ownedRows('cardio_logs');

// Re-exported so callers already importing this module keep working.
// It is DEFINED in cardioKeys.js, which imports nothing — see the note
// there about @/api/db's module-scope auth listener.
export { cardioLogsKey } from '@/lib/data/cardioKeys';

// Columns `detectNewPRs` actually reads, plus the two the callers filter on.
// Nothing else — and emphatically not `gps_track`.
const PR_COLUMNS = ['id', 'type', 'distance_meters', 'duration_seconds', 'date', 'created_date'];

/**
 * The user's prior cardio logs, for PR detection.
 *
 * Every cardio save ran `CardioLog.filter({user_id}, '-date', 1000)` to
 * find previous bests, and `makeEntity().filter` issues `select('*')` — so
 * each save downloaded up to a thousand FULL rows, `gps_track` JSONB
 * included, to read four numbers off each.
 *
 * Measured on production: a 4-minute walk stores 60 GPS points in 2,887
 * bytes. A points-when-you-move-5m tracker on an hour's run is roughly two
 * thousand points, so ~100 KB a row. Two hundred logged runs is ~20 MB
 * fetched per save, on a phone, three times over — the manual form and both
 * live trackers all do this — plus once more every time the detail modal
 * opens. The six columns below are about 1% of that.
 *
 * safeSelect per the resilience rule in CLAUDE.md: an explicit column list
 * is exactly what strips-and-retries when a host is missing one.
 */
export async function listForPRs(userId, limit = 1000) {
  if (!userId) return [];
  const { data } = await safeSelect({
    columns: PR_COLUMNS,
    build: (cols) => supabase
      .from('cardio_logs')
      .select(cols)
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(limit),
  });
  return data ?? [];
}

// Columns the SAVED LIST renders, and nothing more. `gps_track` is the one
// that matters: it is the bulk of a row and the list never draws it.
const SUMMARY_COLUMNS = ['id', 'type', 'date', 'distance_meters', 'duration_seconds'];

/** The saved-workouts list. Five columns × 500 rows instead of everything. */
export async function listSummaries(userId, limit = 500) {
  if (!userId) return [];
  const { data } = await safeSelect({
    columns: SUMMARY_COLUMNS,
    build: (cols) => supabase
      .from('cardio_logs')
      .select(cols)
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(limit),
  });
  return data ?? [];
}

/**
 * One cardio log, whole.
 *
 * `select('*')` is CORRECT here and wrong in a list: the detail modal
 * renders twenty-two fields including the GPS track for the route map, and
 * this is one row fetched when a row is actually opened. It exists so the
 * LIST can stop carrying all of that for 500 rows on the chance that one
 * gets tapped.
 *
 * Returns null rather than throwing — the caller already has the summary
 * row to fall back on, so a failed detail fetch should degrade to the
 * fields the list had, not blank the modal.
 */
export async function getById(id) {
  if (!id) return null;
  try {
    const { data, error } = await supabase
      .from('cardio_logs').select('*').eq('id', id).maybeSingle();
    return error ? null : (data ?? null);
  } catch {
    return null;
  }
}

export const list = (userId, limit = 50) =>
  rows.filter({ user_id: userId }, '-date', limit);

/** Fetch a cardio log by id, or null. */
export const get = (id) => rows.get(id);

export const listForDate = (userId, date, limit = 50) =>
  rows.filter({ user_id: userId, date }, '-date', limit);

/**
 * Just the `date` of each log on or after `since` (yyyy-MM-dd). For callers
 * that count sessions rather than show them: the nutrition target only needs
 * how many days had training in the last 30, and used to fetch up to 1,000
 * full rows (exercises JSONB included) to learn it.
 */
export async function listDatesSince(userId, since) {
  const { data, error } = await supabase
    .from('cardio_logs')
    .select('date')
    .eq('user_id', userId)
    .gte('date', since)
    .order('date', { ascending: false })
    .limit(1000);
  if (error) throw error;
  return data ?? [];
}

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

export const create = (data) => {
  assertNoTextProfanity({ notes: data.notes });
  return rows.create(data);
};
export const update = (id, data) => {
  if (data.notes !== undefined) assertNoTextProfanity({ notes: data.notes });
  return rows.update(id, data);
};
export const remove = (id) => rows.remove(id);
