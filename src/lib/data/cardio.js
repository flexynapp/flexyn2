// src/lib/data/cardio.js
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { containsProfanity } from '@/lib/profanityFilter';

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
 * Every cardio save ran `CardioLog.filter({created_by}, '-date', 1000)` to
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
export async function listForPRs(email, limit = 1000) {
  if (!email) return [];
  const { data } = await safeSelect({
    columns: PR_COLUMNS,
    build: (cols) => supabase
      .from('cardio_logs')
      .select(cols)
      .eq('created_by', email)
      .order('date', { ascending: false })
      .limit(limit),
  });
  return data ?? [];
}

// Columns the SAVED LIST renders, and nothing more. `gps_track` is the one
// that matters: it is the bulk of a row and the list never draws it.
const SUMMARY_COLUMNS = ['id', 'type', 'date', 'distance_meters', 'duration_seconds'];

/** The saved-workouts list. Five columns × 500 rows instead of everything. */
export async function listSummaries(email, limit = 500) {
  if (!email) return [];
  const { data } = await safeSelect({
    columns: SUMMARY_COLUMNS,
    build: (cols) => supabase
      .from('cardio_logs')
      .select(cols)
      .eq('created_by', email)
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

export const list = (email, limit = 50) =>
  db.entities.CardioLog.filter({ created_by: email }, '-date', limit);

export const listByDate = (email, date) =>
  db.entities.CardioLog.filter({ created_by: email, date }, '-created_date', 50);

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

export const create = (data) => {
  assertNoTextProfanity({ notes: data.notes });
  return db.entities.CardioLog.create(data);
};
export const update = (id, data) => {
  if (data.notes !== undefined) assertNoTextProfanity({ notes: data.notes });
  return db.entities.CardioLog.update(id, data);
};
export const remove = (id) => db.entities.CardioLog.delete(id);

export const purgeForUser = async (email) => {
  if (!email) return;
  const PAGE = 100;
  let total = 0;
  while (true) {
    const batch = await db.entities.CardioLog
      .filter({ created_by: email }, '-created_date', PAGE).catch(() => []);
    if (!batch || batch.length === 0) break;
    await Promise.all(batch.map(r =>
      db.entities.CardioLog.delete(r.id).catch(() => {})
    ));
    total += batch.length;
    if (batch.length < PAGE || total > 5000) break;
  }
};