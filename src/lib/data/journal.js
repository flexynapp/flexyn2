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

const MISSING = (code) => code === '42883' || code === '42P01' || code === 'PGRST205' || code === '42703';

/** Fetch the entry for a given YYYY-MM-DD (or null if none). */
export async function getEntry(userId, dateStr) {
  if (!userId || !dateStr) return null;
  const { data, error } = await supabase
    .from('journal_entries')
    .select('id, entry_date, title, body, attachments, mood_score, updated_at')
    .eq('user_id', userId)
    .eq('entry_date', dateStr)
    .maybeSingle();
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
 * History log: every day with an entry, newest first. Returns a light
 * shape (no body) for the scrollable list; the day view fetches the
 * full entry on tap.
 */
export async function listEntries(userId, limit = 365) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('journal_entries')
    .select('id, entry_date, title, body, attachments, mood_score')
    .eq('user_id', userId)
    .order('entry_date', { ascending: false })
    .limit(limit);
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

/** Upload a journal attachment to the avatars bucket; returns public URL. */
export async function uploadAttachment(userId, file) {
  if (!userId || !file) return null;
  const ext = (file.name?.split('.').pop() || 'bin').toLowerCase();
  const path = `journal/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
  if (error) return null;
  const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
  return { url: publicUrl, type: file.type || '', name: file.name || 'attachment' };
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
