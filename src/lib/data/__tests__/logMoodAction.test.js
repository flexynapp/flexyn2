// src/lib/data/__tests__/logMoodAction.test.js
//
// Logging a mood is FIVE things, and until now only one of the three
// surfaces that offer it did all five. The journal day screen wrote
// mood_logs and tagged the journal row and stopped — so a mood set from
// the journal did not move the Readiness score, left the dashboard widget
// stale, and never credited the MOOD_LOGGED quest. The same tap paid out
// from MoodLogCard and not from the journal.
//
// Verified here rather than against the database because the quest tables
// are deliberately immutable from the client ("quest reward/identity is
// immutable" — an anti-cheat trigger), so seeding a log_mood quest to
// watch it advance is not something a client test should be able to do.
// That refusal is the invariant doing its job; the mock is the honest way
// to pin the call.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const upsertMoodLog = vi.fn();
const tagMood = vi.fn();
const recordAction = vi.fn();
const toastError = vi.fn();

vi.mock('@/lib/data/moodLogs', () => ({ upsertMoodLog: (...a) => upsertMoodLog(...a) }));
vi.mock('@/lib/data/journal', () => ({ tagMood: (...a) => tagMood(...a) }));
vi.mock('@/lib/data/quests', () => ({ recordAction: (...a) => recordAction(...a) }));
vi.mock('@/lib/questCatalog', () => ({ ACTION_TYPES: { MOOD_LOGGED: 'mood_logged' } }));
vi.mock('@/lib/toast', () => ({ toast: { error: (...a) => toastError(...a) } }));

const { logMoodAction } = await import('../logMoodAction');

const USER = { id: 'u1', email: 'a@b.test' };
const DAY = '2026-08-09';
const t = (key, english) => english;

let invalidated;
const qc = { invalidateQueries: (arg) => invalidated.push(arg.queryKey) };

beforeEach(() => {
  invalidated = [];
  upsertMoodLog.mockReset().mockResolvedValue({ ok: true });
  tagMood.mockReset().mockResolvedValue({ ok: true });
  recordAction.mockReset().mockResolvedValue(undefined);
  toastError.mockReset();
});

describe('logMoodAction — all five, from every surface', () => {
  it('writes mood_logs for the given DAY, not always today', async () => {
    await logMoodAction({ user: USER, mood: 4, date: '2026-08-06', qc, t });
    expect(upsertMoodLog).toHaveBeenCalledWith({ mood: 4, date: '2026-08-06' });
  });

  it('tags the journal row so the journal and the Log show the mood', async () => {
    await logMoodAction({ user: USER, mood: 4, date: DAY, qc, t });
    expect(tagMood).toHaveBeenCalledWith('u1', 'a@b.test', 4, DAY);
  });

  it('credits the MOOD_LOGGED quest — the step the journal never did', async () => {
    await logMoodAction({ user: USER, mood: 4, date: DAY, qc, t });
    expect(recordAction).toHaveBeenCalledWith(USER, 'mood_logged', 1);
  });

  it('invalidates moodLogToday with a TWO-element prefix', async () => {
    await logMoodAction({ user: USER, mood: 4, date: DAY, qc, t });
    const key = invalidated.find(k => k[0] === 'moodLogToday');
    // React Query prefix-matches DOWNWARDS only. The 2-element form reaches
    // MoodLogCard's 3-element key AND useReadiness's 2-element one; the
    // longer form reaches NEITHER, which is how a logged mood once failed
    // to reach Readiness at all. Guarded separately by
    // components/__tests__/logCardInvalidationKeys.test.js.
    expect(key).toEqual(['moodLogToday', 'u1']);
    expect(key).toHaveLength(2);
  });

  it('invalidates journalEntry so the dashboard widget repaints', async () => {
    await logMoodAction({ user: USER, mood: 4, date: DAY, qc, t });
    expect(invalidated).toContainEqual(['journalEntry', 'u1']);
  });

  it('does none of the follow-through when the write itself fails', async () => {
    upsertMoodLog.mockResolvedValue({ ok: false });
    const res = await logMoodAction({ user: USER, mood: 4, date: DAY, qc, t });

    expect(res).toEqual({ ok: false });
    expect(tagMood).not.toHaveBeenCalled();
    expect(recordAction).not.toHaveBeenCalled();
    expect(invalidated).toEqual([]);
    expect(toastError).toHaveBeenCalled();
  });

  it('still reports success when only the journal TAG fails', async () => {
    // The mood is already saved where Readiness reads it. Failing to mirror
    // it into the journal must not present as "could not save mood".
    tagMood.mockRejectedValue(new Error('offline'));
    const res = await logMoodAction({ user: USER, mood: 4, date: DAY, qc, t });
    expect(res).toEqual({ ok: true });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('still reports success when the QUEST call fails', async () => {
    recordAction.mockRejectedValue(new Error('offline'));
    const res = await logMoodAction({ user: USER, mood: 4, date: DAY, qc, t });
    expect(res).toEqual({ ok: true });
  });

  it('is inert on missing input, and writes nothing', async () => {
    for (const bad of [
      { user: null, mood: 4, date: DAY },
      { user: USER, mood: 0, date: DAY },
      { user: USER, mood: 4, date: null },
    ]) {
      expect(await logMoodAction({ ...bad, qc, t })).toEqual({ ok: false });
    }
    expect(upsertMoodLog).not.toHaveBeenCalled();
  });

  it('survives being called without a query client', async () => {
    // JournalView passes one; a future caller might not, and a missing qc
    // must not cost the user the write that already succeeded.
    const res = await logMoodAction({ user: USER, mood: 4, date: DAY });
    expect(res).toEqual({ ok: true });
  });
});
