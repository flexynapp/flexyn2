// src/lib/data/journal.js
//
// Server-backed journal (migration 145). One row per (user, date).
// Replaces the old localStorage-only textarea. Entries hold a title,
// a markdown body, and an attachments array ({ url, type, name })
// stored in the `avatars` Storage bucket.
//
// All reads fail closed ([] / null) on pre-145 hosts so the UI shows
// an empty editor rather than crashing.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';


const MISSING = (code) => code === '42883' || code === '42P01' || code === 'PGRST205' || code === '42703';

/** Fetch the entry for a given YYYY-MM-DD (or null if none). */
export async function getEntry(userId, dateStr) {
  if (!userId || !dateStr) return null;
  const { data, error } = await safeSelect({
    columns: ['id', 'entry_date', 'title', 'body', 'attachments', 'mood_score', 'updated_at'],
    build: (cols) => supabase
    .from('journal_entries')
    .select(cols)
    .eq('user_id', userId)
    .eq('entry_date', dateStr)
    .maybeSingle(),
  });
  if (error) return null;
  return data;
}

/**
 * Upsert today's (or any day's) entry. Empty title+body+attachments
 * deletes the row instead of storing a blank — keeps the history log
 * clean.
 */
export async function upsertEntry(userId, userEmail, { entryDate, title, body, attachments }) {
  if (!userId || !entryDate) return { ok: false };
  const cleanTitle = (title || '').trim().slice(0, 120) || null;
  const cleanBody = (body || '').slice(0, 20000);
  const atts = Array.isArray(attachments) ? attachments.slice(0, 12) : [];

  const isEmpty = !cleanTitle && !cleanBody.trim() && atts.length === 0;
  if (isEmpty) {
    // Empty WRITTEN content does not mean the row is empty. `tagMood` (and
    // MoodLogCard behind it) creates a row carrying only a mood_score, and
    // this branch used to DELETE it — so tapping a mood on the dashboard and
    // then clearing the journal text threw the mood away with no warning and
    // no way to notice. Half of production's journal rows are mood-only, so
    // this was live on every one of them.
    //
    // Clear the written fields where a mood is attached; delete only when the
    // row would genuinely hold nothing. `.not('mood_score','is',null)` keeps
    // it to one statement per branch and stays paste-safe (single table, bare
    // columns).
    const { data: cleared } = await supabase
      .from('journal_entries')
      .update({ title: null, body: null, attachments: [], updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('entry_date', entryDate)
      .not('mood_score', 'is', null)
      .select('id');
    if (cleared && cleared.length > 0) return { ok: true, cleared: true };
    await supabase.from('journal_entries').delete()
      .eq('user_id', userId).eq('entry_date', entryDate);
    return { ok: true, deleted: true };
  }

  const { error } = await supabase
    .from('journal_entries')
    .upsert({
      user_id:     userId,
      user_email:  userEmail || null,
      entry_date:  entryDate,
      title:       cleanTitle,
      body:        cleanBody,
      attachments: atts,
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'user_id,entry_date' });
  if (error) {
    if (MISSING(error.code)) return { ok: false, error: 'PIPELINE_MISSING' };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Write ONLY the body for a day, leaving title / attachments / mood_score
 * alone. Same shape as `tagMood` below, and it exists for the same reason.
 *
 * JournalWidget (the dashboard quick-write) has no title or attachment UI,
 * so it used to call `upsertEntry` with whatever `title` / `attachments` it
 * happened to have cached from react-query — `null` and `[]` on its unmount
 * flush. That upsert then overwrote a real title with NULL: verified against
 * a seeded row, "Push day — felt strong" became NULL after one widget save.
 * A surface that cannot edit a field must not send that field.
 */
export async function saveBody(userId, userEmail, dateStr, body) {
  if (!userId || !dateStr) return { ok: false };
  const cleanBody = (body || '').slice(0, 20000);

  const { data: updated, error: updateErr } = await supabase
    .from('journal_entries')
    .update({ body: cleanBody, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('entry_date', dateStr)
    .select('id, title, attachments, mood_score');

  if (updateErr) {
    if (MISSING(updateErr.code)) return { ok: false, error: 'PIPELINE_MISSING' };
    return { ok: false, error: updateErr.message };
  }

  if (updated && updated.length > 0) {
    // The row survives unless clearing the body left nothing at all in it.
    const row = updated[0];
    const bare = !cleanBody.trim()
      && !row.title
      && !row.mood_score
      && !(Array.isArray(row.attachments) && row.attachments.length > 0);
    if (bare) {
      await supabase.from('journal_entries').delete()
        .eq('user_id', userId).eq('entry_date', dateStr);
      return { ok: true, deleted: true };
    }
    return { ok: true };
  }

  // No row yet. Don't create one for an empty body — that is what put bare
  // dates in the history log.
  if (!cleanBody.trim()) return { ok: true, noop: true };

  const { error: insertErr } = await supabase
    .from('journal_entries')
    .insert({
      user_id:     userId,
      user_email:  userEmail || null,
      entry_date:  dateStr,
      body:        cleanBody,
      attachments: [],
      updated_at:  new Date().toISOString(),
    });

  if (insertErr) {
    if (MISSING(insertErr.code)) return { ok: false, error: 'PIPELINE_MISSING' };
    return { ok: false, error: insertErr.message };
  }
  return { ok: true };
}

/**
 * History log: every day with an entry, newest first. Returns a light
 * shape (no body) for the scrollable list; the day view fetches the
 * full entry on tap.
 */
export async function listEntries(userId, limit = 365) {
  if (!userId) return [];
  // safeSelect, because `mood_score` only arrived in migration 165 and this
  // read is what BOTH the history log and JournalView's skip-empty day
  // navigation are built on. Unwrapped, a host missing that column answers
  // 42703 and the whole journal reads as "No entries yet" — an empty history
  // is indistinguishable from a broken one. `getEntry` was already wrapped.
  const { data, error } = await safeSelect({
    columns: ['id', 'entry_date', 'title', 'body', 'attachments', 'mood_score'],
    build: (cols) => supabase
      .from('journal_entries')
      .select(cols)
      .eq('user_id', userId)
      .order('entry_date', { ascending: false })
      .limit(limit),
  });
  if (error) return [];
  // Derive a one-line snippet for the list without shipping full bodies
  // around (body is already capped at 20k so this is fine).
  return (data || []).map(e => ({
    id: e.id,
    entry_date: e.entry_date,
    title: e.title,
    snippet: (e.body || '').replace(/[#*_>-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90),
    attachmentCount: Array.isArray(e.attachments) ? e.attachments.length : 0,
    mood_score: e.mood_score ?? null,
  }));
}

// Extension → pinned MIME. Mirrors SAFE_MIMES in src/api/db.js: the
// contentType must derive from the extension, never from the
// client-supplied file.type, or `evil.svg` lands in a PUBLIC bucket as
// image/svg+xml and executes script on the storage origin when the
// attachment chip opens it. SVG is refused for exactly that reason.
const ATTACHMENT_MIMES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
};

/** Upload a journal attachment to the uploads bucket; returns public URL. */
export async function uploadAttachment(userId, file) {
  if (!userId || !file) return null;
  const ext = (file.name?.split('.').pop() || '').toLowerCase();
  const contentType = ATTACHMENT_MIMES[ext];
  if (!contentType) {
    console.warn('[journal] attachment type not supported:', ext || '(none)');
    return null;
  }
  // The bucket is `uploads` — there has never been an `avatars` bucket.
  // Migration comments in 140/145 called it that and three call sites
  // copied the name, so every upload here 404'd on a missing bucket.
  //
  // The uid must be the FIRST path segment: the bucket's INSERT policy is
  // `foldername(name)[1] = auth.uid()`, so the old `journal/<uid>/...`
  // would still have been rejected by RLS even with the right bucket.
  const path = `${userId}/journal/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from('uploads')
    .upload(path, file, { upsert: false, contentType });
  if (error) {
    // Caller surfaces a generic "couldn't upload" toast; log the reason so
    // a bucket/RLS regression is diagnosable rather than just "returned null".
    console.warn('[journal] attachment upload failed:', error);
    return null;
  }
  const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(path);
  return { url: publicUrl, type: contentType, name: file.name || 'attachment' };
}

/**
 * One-time migration of legacy localStorage entries (`journal_<email>_<date>`)
 * into the server table. Best-effort and idempotent: guarded by a
 * per-user localStorage flag so it only runs once, and uses upsert so
 * re-runs don't duplicate. Returns the count migrated.
 */
export async function migrateLocalEntries(userId, userEmail) {
  if (!userId || !userEmail) return 0;
  const flagKey = `flexyn.journalMigrated.${userId}`;
  try { if (localStorage.getItem(flagKey)) return 0; } catch { return 0; }

  const prefix = `journal_${userEmail}_`;
  const toMigrate = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        const dateStr = k.slice(prefix.length);
        const body = localStorage.getItem(k);
        if (body && body.trim() && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          toMigrate.push({ entryDate: dateStr, body });
        }
      }
    }
  } catch { return 0; }

  let migrated = 0;
  for (const { entryDate, body } of toMigrate) {
    // Don't clobber a server entry that already exists for that day.
    const existing = await getEntry(userId, entryDate);
    if (existing) continue;
    const res = await upsertEntry(userId, userEmail, { entryDate, title: null, body, attachments: [] });
    if (res.ok) migrated += 1;
  }
  try { localStorage.setItem(flagKey, '1'); } catch { /* ignore */ }
  return migrated;
}

/**
 * Tag today's (or any day's) journal entry with a mood score without
 * touching the entry's title / body / attachments.
 *
 * • If a row already exists for that date → UPDATE mood_score only.
 * • If no row exists yet → INSERT a skeleton row so the mood is
 *   persisted even before the user writes anything.
 *
 * Used by MoodLogCard so every mood tap automatically labels that day's
 * journal entry.
 */
export async function tagMood(userId, userEmail, moodScore, dateStr) {
  if (!userId || !moodScore || !dateStr) return { ok: false };

  // Try to update an existing row first (avoids clobbering body/title
  // that a plain upsert would do if we only pass mood_score).
  const { data: updated, error: updateErr } = await supabase
    .from('journal_entries')
    .update({ mood_score: moodScore, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('entry_date', dateStr)
    .select('id');

  if (updateErr) {
    if (MISSING(updateErr.code)) return { ok: false, error: 'PIPELINE_MISSING' };
    return { ok: false, error: updateErr.message };
  }

  // Row existed → done.
  if (updated && updated.length > 0) return { ok: true };

  // No row yet → insert a skeleton so the mood is stored.
  const { error: insertErr } = await supabase
    .from('journal_entries')
    .insert({
      user_id:    userId,
      user_email: userEmail || null,
      entry_date: dateStr,
      mood_score: moodScore,
      attachments: [],
      updated_at: new Date().toISOString(),
    });

  if (insertErr) {
    if (MISSING(insertErr.code)) return { ok: false, error: 'PIPELINE_MISSING' };
    return { ok: false, error: insertErr.message };
  }
  return { ok: true };
}
