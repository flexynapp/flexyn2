// src/lib/data/dayContext.js
//
// "What the app already knows about this day" — the facts behind My
// Journal's empty state. The journal sits directly on top of
// workout_logs and sleep_logs and, until now, read neither: it offered a
// blank page to someone whose session it had just recorded.
//
// EVERY FIELD IS OPTIONAL AND EVERY ONE COMES FROM A ROW. That is not
// defensiveness for its own sake — production's workout_logs carry
// `title` NULL and `duration_min` NULL on 100% of rows, and
// `total_volume` is 0 on the ones that exist. A chip set built from the
// columns a workout "should" have would have rendered "· min" and
// "0 lb volume" at every user. So each fact is emitted only when its own
// value is real, `sets` and `minutes` are recomputed from the
// `exercises` JSONB when the denormalised columns are empty, and a day
// with nothing to say returns nulls rather than padding.
//
// No formatting and no copy here — the caller owns i18n (CLAUDE.md).

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';

/** Sum every set across an exercises JSONB array. Shape, verified against
 *  production: [{ name, displayName, sets: [{ reps, weight }],
 *  duration_minutes, ... }]. */
function summarise(rows) {
  let sets = 0, minutes = 0, volume = 0, exercises = 0;
  const names = [];
  rows.forEach((row) => {
    const list = Array.isArray(row.exercises) ? row.exercises : [];
    list.forEach((ex) => {
      exercises += 1;
      const label = ex?.displayName || ex?.name;
      if (label && names.length < 3 && !names.includes(label)) names.push(label);
      const exSets = Array.isArray(ex?.sets) ? ex.sets : [];
      sets += exSets.length;
      exSets.forEach((st) => {
        const reps = Number(st?.reps) || 0;
        const weight = Number(st?.weight) || 0;
        volume += reps * weight;
      });
      minutes += Number(ex?.duration_minutes) || 0;
    });
    // Prefer the denormalised columns when they actually carry a value.
    const dur = Number(row.duration_min) || 0;
    if (dur > 0) minutes = Math.max(minutes, dur);
    const vol = Number(row.total_volume) || 0;
    if (vol > 0) volume = Math.max(volume, vol);
  });
  return { sets, minutes, volume, exercises, names };
}

/**
 * Facts about one day, or nulls. Never throws and never guesses.
 *
 * @returns {Promise<{
 *   workout: null | { title: string|null, names: string[], exercises: number,
 *                     sets: number, minutes: number, volume: number },
 *   sleepHours: number|null,
 * }>}
 */
export async function getDayContext(userId, dateStr) {
  const empty = { workout: null, sleepHours: null };
  if (!userId || !dateStr) return empty;

  // user_id, not created_by: it is the documented key and it is populated
  // on 100% of production rows. safeSelect because `tags` and
  // `volume_credited_at` postdate the original table.
  const [logs, sleep] = await Promise.all([
    safeSelect({
      columns: ['title', 'exercises', 'duration_min', 'total_volume'],
      build: (cols) => supabase
        .from('workout_logs')
        .select(cols)
        .eq('user_id', userId)
        .eq('date', dateStr),
    }).catch(() => ({ data: null })),
    safeSelect({
      columns: ['hours'],
      build: (cols) => supabase
        .from('sleep_logs')
        .select(cols)
        .eq('user_id', userId)
        .eq('date', dateStr)
        .maybeSingle(),
    }).catch(() => ({ data: null })),
  ]);

  const rows = Array.isArray(logs?.data) ? logs.data : [];
  const hours = Number(sleep?.data?.hours);

  return {
    workout: rows.length
      ? { ...summarise(rows), title: rows.find(r => r.title)?.title || null }
      : null,
    sleepHours: Number.isFinite(hours) && hours > 0 ? hours : null,
  };
}

/**
 * Turn a context into the chips the empty state offers, given a formatter
 * for copy. Kept here (not in the component) so the "only emit a fact that
 * exists" rule is testable on its own — it is the whole point of the
 * module and it is one `if` away from silently offering "0 lb volume" to
 * everybody.
 *
 * @param ctx     the getDayContext result
 * @param mood    { score, emoji, label } or null
 * @param t       (key, englishFallback, vars) => string
 */
export function contextChips(ctx, mood, t) {
  const out = [];
  const w = ctx?.workout;
  if (w) {
    const name = w.title || w.names[0];
    if (name) out.push({ key: 'workout', label: name, line: name });
    else if (w.exercises > 0) {
      const l = t('journal.ctx.exercises', `${w.exercises} exercises`, { n: w.exercises });
      out.push({ key: 'workout', label: l, line: l });
    }
    if (w.sets > 0) {
      const l = t('journal.ctx.sets', `${w.sets} sets`, { n: w.sets });
      out.push({ key: 'sets', label: l, line: l });
    }
    if (w.minutes > 0) {
      const l = t('journal.ctx.minutes', `${w.minutes} min`, { n: w.minutes });
      out.push({ key: 'minutes', label: l, line: l });
    }
    if (w.volume > 0) {
      const l = t('journal.ctx.volume', `${Math.round(w.volume).toLocaleString()} lb volume`, { n: Math.round(w.volume) });
      out.push({ key: 'volume', label: l, line: l });
    }
  }
  if (ctx?.sleepHours) {
    const l = t('journal.ctx.sleep', `Slept ${ctx.sleepHours} h`, { n: ctx.sleepHours });
    out.push({ key: 'sleep', label: l, line: l });
  }
  if (mood?.emoji) {
    const l = t('journal.ctx.mood', `Felt ${mood.emoji} ${mood.label}`, { emoji: mood.emoji, label: mood.label });
    out.push({ key: 'mood', label: l, line: l });
  }
  return out;
}
