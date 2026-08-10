// src/lib/data/logMoodAction.js
//
// Logging a mood, once, for every surface that offers it.
//
// There are three: MoodLogCard (inside the Readiness sheet), the My
// Journal day screen, and the dashboard journal widget. Writing a mood is
// not one call — it is FIVE things, and only MoodLogCard was doing all of
// them:
//
//   1. mood_logs                      the row Readiness reads
//   2. invalidate ['moodLogToday', uid]  a TWO-element prefix, see below
//   3. journal_entries.mood_score     so the journal shows it
//   4. invalidate ['journalEntry', uid]  so the widget shows it
//   5. the MOOD_LOGGED quest action   so the tap counts for something
//
// The day screen's setter did 1 and 3 only, which shipped in e5c798d8:
// logging a mood from the journal did not move the Readiness score, left
// the dashboard widget stale, and — worst — did not credit the daily
// quest, so the same action paid out from one surface and not another.
//
// The invalidation key is the subtle one and it already has a regression
// test (`src/components/__tests__/logCardInvalidationKeys.test.js`).
// React Query prefix-matches DOWNWARDS only, so the 2-element
// ['moodLogToday', uid] reaches both MoodLogCard's 3-element key and
// useReadiness's 2-element one. The longer form reaches NEITHER, which is
// how a logged mood once failed to reach Readiness at all.

import { toast } from '@/lib/toast';
import { upsertMoodLog } from '@/lib/data/moodLogs';
import { tagMood } from '@/lib/data/journal';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';

/**
 * @param {object}  o
 * @param {object}  o.user     the auth user ({ id, email })
 * @param {number}  o.mood     1-5
 * @param {string}  o.date     YYYY-MM-DD (local)
 * @param {object}  o.qc       react-query client
 * @param {function} [o.t]     tFallback, for the failure toast
 * @returns {Promise<{ ok: boolean }>}
 */
export async function logMoodAction({ user, mood, date, qc, t }) {
  if (!user?.id || !mood || !date) return { ok: false };

  const res = await upsertMoodLog({ mood, date }).catch(() => ({ ok: false }));
  if (!res?.ok) {
    if (t) toast.error(t('mood.saveFailed', 'Could not save mood — try again.'));
    return { ok: false };
  }

  // Two-element PREFIX. Do not lengthen it — see the head of this file.
  qc?.invalidateQueries({ queryKey: ['moodLogToday', user.id] });

  // Tagging the journal row is fire-and-forget: the mood is already saved
  // where Readiness reads it, and failing to mirror it into the journal
  // should not present as "could not save mood".
  tagMood(user.id, user.email, mood, date).catch(() => {});
  qc?.invalidateQueries({ queryKey: ['journalEntry', user.id] });

  // Quest credit. Safe on every tap: the target is 1 and recordAction
  // skips rows already at target, so changing your mind three times still
  // counts once.
  quests.recordAction(user, ACTION_TYPES.MOOD_LOGGED, 1)
    .then(() => qc?.invalidateQueries({ queryKey: ['dailyQuests'] }))
    .catch(() => {});

  return { ok: true };
}
