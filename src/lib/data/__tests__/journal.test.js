// src/lib/data/__tests__/journal.test.js
//
// The journal data layer had no direct coverage at all, and the two
// defects these tests pin were both silent data loss found by reading
// production rows rather than by anything failing:
//
//   • `upsertEntry` DELETED the row whenever title + body + attachments
//     were all empty. `tagMood` creates rows that are exactly that shape
//     — mood_score and nothing else — and six of production's twelve
//     journal rows were mood-only, so clearing the text on any of those
//     days threw the mood away. Verified live against a seeded row
//     before the fix: mood_score 4 in, row gone out.
//   • JournalWidget has no title or attachment UI, yet called
//     `upsertEntry` with `title: null` / `attachments: []`. Verified
//     live: one widget save turned the title "Push day — felt strong"
//     into NULL. `saveBody` exists so a surface that cannot edit a field
//     never sends that field.
//
// The mock records the SEQUENCE of statements, because in both cases the
// bug was which statement ran, not what one statement contained.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const calls = [];
let queue = [];

function stage(...responses) {
  queue = responses.map(r => ({ data: r?.data ?? null, error: r?.error ?? null }));
}

function makeChain(table) {
  const rec = { table, op: 'select', payload: null, cols: null, filters: [] };
  calls.push(rec);
  const settle = () => queue.shift() ?? { data: null, error: null };
  const chain = {
    select: (cols) => { rec.cols = cols; return chain; },
    insert: (row) => { rec.op = 'insert'; rec.payload = row; return chain; },
    update: (patch) => { rec.op = 'update'; rec.payload = patch; return chain; },
    upsert: (row, opts) => { rec.op = 'upsert'; rec.payload = row; rec.opts = opts; return chain; },
    delete: () => { rec.op = 'delete'; return chain; },
    eq: (c, v) => { rec.filters.push(['eq', c, v]); return chain; },
    is: (c, v) => { rec.filters.push(['is', c, v]); return chain; },
    not: (c, o, v) => { rec.filters.push(['not', c, o, v]); return chain; },
    order: (c, o) => { rec.filters.push(['order', c, o]); return chain; },
    limit: (n) => { rec.filters.push(['limit', n]); return chain; },
    single: async () => settle(),
    maybeSingle: async () => settle(),
    then: (res, rej) => Promise.resolve(settle()).then(res, rej),
  };
  return chain;
}

const uploaded = [];
const removed = [];
// Default: the object existed and was removed. Tests override it to assert
// the 200-with-nothing case, which Storage answers when a SELECT cannot see
// the target.
let removeResult = { data: [{ name: 'ok' }], error: null };
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (table) => makeChain(table),
    storage: {
      from: () => ({
        upload: async (path, file, opts) => {
          uploaded.push({ path, name: file.name, contentType: opts?.contentType });
          return { error: null };
        },
        remove: async (paths) => { removed.push(paths); return removeResult; },
        getPublicUrl: (p) => ({ data: { publicUrl: `https://cdn.test/${p}` } }),
      }),
    },
  },
}));

// safeSelect is exercised for real elsewhere; here it only has to hand the
// column list to the builder so `listEntries` stays readable.
vi.mock('@/api/safeSelect', () => ({
  safeSelect: async ({ columns, build }) => build(columns.join(', ')),
}));

const journal = await import('../journal');

const USER = 'user-1';
const EMAIL = 'a@b.test';
const DAY = '2026-08-05';

beforeEach(() => {
  calls.length = 0;
  uploaded.length = 0;
  removed.length = 0;
  removeResult = { data: [{ name: 'ok' }], error: null };
  queue = [];
});

describe('upsertEntry — the empty-content branch', () => {
  it('clears the written fields but KEEPS a row that carries a mood', async () => {
    stage({ data: [{ id: 'row-1' }] });        // the guarded UPDATE matches
    const res = await journal.upsertEntry(USER, EMAIL, {
      entryDate: DAY, title: '', body: '   ', attachments: [],
    });

    expect(res).toEqual({ ok: true, cleared: true });
    expect(calls.map(c => c.op)).toEqual(['update']);
    expect(calls.some(c => c.op === 'delete')).toBe(false);

    const upd = calls[0];
    expect(upd.payload.title).toBeNull();
    expect(upd.payload.body).toBeNull();
    expect(upd.payload.attachments).toEqual([]);
    // mood_score must not appear in the patch at all — clearing text is not
    // a statement about the mood.
    expect(upd.payload).not.toHaveProperty('mood_score');
    // ...and the update must be scoped to rows that HAVE a mood, or it
    // silently becomes "blank every empty day" instead of "spare the moods".
    expect(upd.filters).toContainEqual(['not', 'mood_score', 'is', null]);
  });

  it('deletes only when the guarded update matched nothing (no mood on the row)', async () => {
    stage({ data: [] });                        // no mood-bearing row
    const res = await journal.upsertEntry(USER, EMAIL, {
      entryDate: DAY, title: null, body: '', attachments: [],
    });

    expect(res).toEqual({ ok: true, deleted: true });
    expect(calls.map(c => c.op)).toEqual(['update', 'delete']);
    expect(calls[1].filters).toContainEqual(['eq', 'entry_date', DAY]);
  });

  it('still upserts normally when there is content', async () => {
    stage({ data: null });
    const res = await journal.upsertEntry(USER, EMAIL, {
      entryDate: DAY, title: 'Push day', body: 'Bench 3x5', attachments: [],
    });

    expect(res).toEqual({ ok: true });
    expect(calls.map(c => c.op)).toEqual(['upsert']);
    expect(calls[0].opts).toEqual({ onConflict: 'user_id,entry_date' });
    expect(calls[0].payload.title).toBe('Push day');
  });
});

describe('saveBody — the dashboard widget path', () => {
  it('writes the body and NOTHING else', async () => {
    stage({ data: [{ id: 'r', title: 'Push day', attachments: [], mood_score: null }] });
    const res = await journal.saveBody(USER, EMAIL, DAY, 'quick note');

    expect(res).toEqual({ ok: true });
    expect(calls.map(c => c.op)).toEqual(['update']);
    // The whole point: a title the widget cannot see is a title it cannot
    // destroy. This is the assertion that would have caught the live bug.
    expect(Object.keys(calls[0].payload).sort()).toEqual(['body', 'updated_at']);
  });

  it('leaves the row alone when clearing the body but a mood is attached', async () => {
    stage({ data: [{ id: 'r', title: null, attachments: [], mood_score: 4 }] });
    const res = await journal.saveBody(USER, EMAIL, DAY, '');

    expect(res).toEqual({ ok: true });
    expect(calls.some(c => c.op === 'delete')).toBe(false);
  });

  it('deletes the row when clearing the body leaves it genuinely bare', async () => {
    stage({ data: [{ id: 'r', title: null, attachments: [], mood_score: null }] });
    const res = await journal.saveBody(USER, EMAIL, DAY, '   ');

    expect(res).toEqual({ ok: true, deleted: true });
    expect(calls.map(c => c.op)).toEqual(['update', 'delete']);
  });

  it('does not create a row for an empty body', async () => {
    stage({ data: [] });                        // no existing row
    const res = await journal.saveBody(USER, EMAIL, DAY, '');

    expect(res).toEqual({ ok: true, noop: true });
    expect(calls.map(c => c.op)).toEqual(['update']);
  });

  it('inserts a skeleton row when there is no row and a real body', async () => {
    stage({ data: [] }, { data: null });
    const res = await journal.saveBody(USER, EMAIL, DAY, 'first words');

    expect(res).toEqual({ ok: true });
    expect(calls.map(c => c.op)).toEqual(['update', 'insert']);
    expect(calls[1].payload).toMatchObject({
      user_id: USER, user_email: EMAIL, entry_date: DAY, body: 'first words',
    });
    expect(calls[1].payload).not.toHaveProperty('title');
  });
});

describe('uploadAttachment — the extension gate', () => {
  it('accepts the image types the uploads bucket actually allows', async () => {
    const att = await journal.uploadAttachment(USER, { name: 'shot.PNG', size: 10 });
    expect(att).toMatchObject({ type: 'image/png', name: 'shot.PNG' });
    // contentType is pinned from the extension, never from file.type —
    // the reason evil.svg cannot land in a public bucket as image/svg+xml.
    expect(uploaded[0].contentType).toBe('image/png');
    expect(uploaded[0].path.startsWith(`${USER}/journal/`)).toBe(true);
  });

  it('refuses the types the file picker used to advertise', async () => {
    // The input's accept= listed .pdf and .txt; both die here, so the user
    // got a chooser that took the file and a toast that said it failed.
    // The picker was narrowed to match — this pins the gate it matches.
    expect(await journal.uploadAttachment(USER, { name: 'plan.pdf', size: 10 })).toBeNull();
    expect(await journal.uploadAttachment(USER, { name: 'notes.txt', size: 10 })).toBeNull();
    expect(await journal.uploadAttachment(USER, { name: 'evil.svg', size: 10 })).toBeNull();
    expect(uploaded).toHaveLength(0);
  });
});

describe('deleteAttachment — the orphaned-blob fix', () => {
  it('derives the storage path from the public URL and removes it', async () => {
    const res = await journal.deleteAttachment(
      `https://x.supabase.co/storage/v1/object/public/uploads/${USER}/journal/1786-abc.png`);
    expect(res).toEqual({ ok: true, path: `${USER}/journal/1786-abc.png` });
    expect(removed).toEqual([[`${USER}/journal/1786-abc.png`]]);
  });

  it('strips a query string and decodes the path', async () => {
    await journal.deleteAttachment(
      'https://x.supabase.co/storage/v1/object/public/uploads/u1/journal/my%20shot.png?t=123');
    expect(removed[0]).toEqual(['u1/journal/my shot.png']);
  });

  it('treats 200-with-an-empty-array as FAILURE, not success', async () => {
    // Storage resolves a delete's targets with a SELECT first, so a caller
    // that cannot see the object gets 200 and an empty list. Reading the
    // error here would report success while orphaning the blob — which is
    // the exact bug this function was written to end.
    removeResult = { data: [], error: null };
    const res = await journal.deleteAttachment(
      'https://x.supabase.co/storage/v1/object/public/uploads/u1/journal/a.png');
    expect(res).toEqual({ ok: false, reason: 'removed_nothing' });
  });

  it('refuses anything that is not an uploads URL rather than guessing a path', async () => {
    for (const bad of [null, undefined, 42, '', 'https://evil.test/a.png',
                       'https://x.supabase.co/storage/v1/object/public/avatars/u1/a.png']) {
      const res = await journal.deleteAttachment(bad);
      expect(res.ok).toBe(false);
    }
    expect(removed).toHaveLength(0);
  });
});

describe('listEntries', () => {
  it('reads through safeSelect and derives a snippet without shipping bodies', async () => {
    stage({ data: [
      { id: '1', entry_date: DAY, title: 'Push day', body: '- **PR** on incline', attachments: [{ url: 'u' }],
        mood_score: 4, created_at: '2026-08-05T20:00:00Z', updated_at: '2026-08-08T09:00:00Z' },
    ] });
    const { ok, rows } = await journal.listEntries(USER, 365);

    expect(ok).toBe(true);
    expect(rows[0]).toEqual({
      id: '1', entry_date: DAY, title: 'Push day',
      snippet: 'PR on incline', attachmentCount: 1, mood_score: 4,
      // Passed through RAW, not resolved here: the edit marker has to read
      // these in the VIEWER's timezone, and the data layer does not know it.
      created_at: '2026-08-05T20:00:00Z', updated_at: '2026-08-08T09:00:00Z',
    });
    expect(rows[0]).not.toHaveProperty('body');
    expect(calls[0].cols).toContain('mood_score');
    expect(calls[0].cols).toContain('created_at');
  });

  it('distinguishes a FAILED read from an empty log', async () => {
    // These returned the same `[]` before, so the Log rendered "No entries
    // yet" at someone whose journal was merely unreachable — a claim about
    // the user made from a fact about us.
    stage({ error: { code: '42P01' } });
    expect(await journal.listEntries(USER, 365)).toEqual({ ok: false, rows: [] });

    stage({ data: [] });
    expect(await journal.listEntries(USER, 365)).toEqual({ ok: true, rows: [] });
  });

  it('is not ok without a user — absence of an answer, not an empty one', async () => {
    expect(await journal.listEntries(null)).toEqual({ ok: false, rows: [] });
    expect(calls).toHaveLength(0);
  });
});

/**
 * deleteEntry — the explicit "remove this entry", as opposed to upsertEntry's
 * empty-content branch, which keeps a mood-only row alive.
 *
 * The sequence is what matters here, same as the suites above: attachments
 * are read and their blobs removed BEFORE the row goes, because once the row
 * is gone nothing knows where the files were. And the row delete carries a
 * `.select('id')`, without which a delete matching nothing — wrong id,
 * someone else's entry, RLS — resolves with no error and reports success over
 * a row that is still there.
 */
describe('deleteEntry', () => {
  it('removes the blobs first, then the row, and reports ok', async () => {
    stage(
      { data: { attachments: [{ url: 'https://x/storage/v1/object/public/uploads/u/journal/a.jpg' }] } },
      { data: [{ id: 'row-1' }] },
    );
    const res = await journal.deleteEntry(USER, 'row-1');
    expect(res).toEqual({ ok: true });

    // Blob cleanup happened, and it happened before the row delete.
    expect(removed).toHaveLength(1);
    expect(removed[0][0]).toBe('u/journal/a.jpg');

    const del = calls.find(c => c.op === 'delete');
    expect(del.table).toBe('journal_entries');
    // Scoped to the owner as well as the id: RLS enforces this, and so does
    // the statement, so a bug in either one alone cannot delete someone
    // else's entry.
    expect(del.filters).toEqual(
      expect.arrayContaining([['eq', 'id', 'row-1'], ['eq', 'user_id', USER]]),
    );
  });

  it('asks for the id back, so "deleted nothing" is distinguishable', async () => {
    stage({ data: { attachments: [] } }, { data: [{ id: 'row-1' }] });
    await journal.deleteEntry(USER, 'row-1');
    expect(calls.find(c => c.op === 'delete').cols).toBe('id');
  });

  it('reports failure when the delete matched no rows', async () => {
    // The 200-with-an-empty-array shape. Without the check this returns ok
    // and the UI drops a row the database still has.
    stage({ data: { attachments: [] } }, { data: [] });
    const res = await journal.deleteEntry(USER, 'row-1');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('removed_nothing');
  });

  it('reports failure on a database error', async () => {
    stage({ data: { attachments: [] } }, { error: { message: 'boom' } });
    const res = await journal.deleteEntry(USER, 'row-1');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('boom');
  });

  it('still deletes the row when a blob cleanup fails', async () => {
    // An orphaned file is a storage cost. Refusing the row delete because one
    // object would not go would make the entry permanently undeletable, which
    // is a broken promise rather than a cost.
    removeResult = { data: [], error: null };
    stage(
      { data: { attachments: [{ url: 'https://x/storage/v1/object/public/uploads/u/journal/a.jpg' }] } },
      { data: [{ id: 'row-1' }] },
    );
    const res = await journal.deleteEntry(USER, 'row-1');
    expect(res).toEqual({ ok: true });
  });

  it('refuses without both a user and an entry id rather than deleting broadly', async () => {
    expect(await journal.deleteEntry(null, 'row-1')).toEqual({ ok: false, reason: 'missing_args' });
    expect(await journal.deleteEntry(USER, null)).toEqual({ ok: false, reason: 'missing_args' });
    expect(calls).toHaveLength(0);
  });
});
