// src/lib/data/progressPhotos.js
//
// Progress photos data layer — PRIVATE Supabase Storage bucket
// `progress-photos` (migration 174). Replaces the old base64-in-
// localStorage scheme that silently lost data on iOS quota
// (QuotaExceededError swallowed at ~8-14 photos), leaked across
// accounts on shared devices, and never synced / exported.
//
// Bucket contract (mig 174):
//   • private bucket, owner-only RLS on storage.objects
//   • path convention: `<auth.uid()>/<filename>` — every policy gates
//     on (storage.foldername(name))[1] = auth.uid()::text
//   • read is via short-lived SIGNED URLs only (no public policy)
//
// Filenames encode the capture time: `<takenAtMs>.jpg`. We parse
// takenAt back out of the filename on list. (The legacy localStorage
// scheme also stored a free-text workoutName; that does not survive
// the move to storage — there is nowhere on a Storage object to put
// it without a side table, and the UI degrades gracefully when it's
// absent.)
//
// All helpers THROW on error — no silent catches. Callers surface a
// toast / error state.

import { supabase } from '@/api/supabaseClient';

const BUCKET = 'progress-photos';
const SIGNED_URL_TTL = 3600; // 1 hour

/**
 * Upload a captured progress photo blob to the owner's folder.
 * @param {string} userId   - auth.uid() of the owner (folder name).
 * @param {Blob}   blob     - JPEG blob (image/jpeg).
 * @param {number} [takenAtMs] - capture time in ms; defaults to now.
 * @returns {Promise<{ path: string, takenAt: string }>}
 */
export async function uploadProgressPhoto(userId, blob, takenAtMs) {
  if (!userId) throw new Error('uploadProgressPhoto: userId is required');
  if (!blob) throw new Error('uploadProgressPhoto: blob is required');

  const ts = takenAtMs || Date.now();
  const path = `${userId}/${ts}.jpg`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });

  if (error) throw error;

  return { path, takenAt: new Date(ts).toISOString() };
}

/**
 * List the owner's progress photos, newest-first, each with a fresh
 * short-lived signed URL ready to drop into an <img src>.
 * @param {string} userId - auth.uid() of the owner (folder name).
 * @returns {Promise<Array<{ name: string, path: string, url: string, takenAt: string }>>}
 */
export async function listProgressPhotos(userId) {
  if (!userId) throw new Error('listProgressPhotos: userId is required');

  const { data: objects, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list(userId, { sortBy: { column: 'name', order: 'desc' } });

  if (listErr) throw listErr;

  // `.list` can return a placeholder row for an empty folder; keep only
  // real `.jpg` objects we wrote.
  const files = (objects || []).filter(o => o?.name && o.name.endsWith('.jpg'));
  if (files.length === 0) return [];

  const paths = files.map(o => `${userId}/${o.name}`);

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL);

  if (signErr) throw signErr;

  // createSignedUrls preserves order; map each back to its file. Parse
  // takenAt from the `<ms>.jpg` filename, falling back to the object's
  // created_at if a filename is ever non-numeric.
  return files.map((file, i) => {
    const path = paths[i];
    const ms = Number(file.name.replace(/\.jpg$/, ''));
    const takenAt = Number.isFinite(ms) && ms > 0
      ? new Date(ms).toISOString()
      : (file.created_at || new Date().toISOString());
    return {
      name: file.name,
      path,
      url: signed?.[i]?.signedUrl || null,
      takenAt,
    };
  });
}

/**
 * Delete a single progress photo by its full storage path
 * (`<uid>/<file>.jpg`).
 * @param {string} path
 * @returns {Promise<void>}
 */
export async function deleteProgressPhoto(path) {
  if (!path) throw new Error('deleteProgressPhoto: path is required');

  const { error } = await supabase.storage.from(BUCKET).remove([path]);

  if (error) throw error;
}

// ── one-time localStorage → Storage migration ────────────────────────────────
//
// The old scheme kept photos as base64 JPEG dataURLs in localStorage.
// Both the per-user namespaced key and the legacy un-namespaced key the
// old code read are migrated. Runs once per user (guarded by a
// localStorage flag), uploads each photo preserving its capture time in
// the filename, and only clears the source key after EVERY photo in it
// uploaded successfully — partial failures keep the remaining (failed)
// entries so a later run can retry.

const LS_KEY = (userId) => `flexyn.progressPhotos.${userId || 'anon'}`;
const LS_LEGACY_KEY = 'flexyn_progress_photos';
const MIGRATED_FLAG = (userId) => `flexyn.progressPhotos.migrated.${userId}`;

function dataUrlToBlob(dataUrl) {
  const [header, b64] = String(dataUrl).split(',');
  if (!b64) throw new Error('progress-photo migration: malformed dataURL');
  const mimeMatch = /data:([^;]+)/.exec(header);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function readLocalPhotos(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

/**
 * Migrate any localStorage-resident progress photos for `userId` into
 * the private Storage bucket. Idempotent / once-per-user. Returns a
 * summary so the caller can decide whether to surface a partial-failure
 * toast.
 *
 * @param {string} userId
 * @returns {Promise<{ migrated: number, failed: number, ran: boolean }>}
 */
export async function migrateLocalProgressPhotos(userId) {
  if (!userId) return { migrated: 0, failed: 0, ran: false };

  // Once-per-user guard.
  try {
    if (localStorage.getItem(MIGRATED_FLAG(userId))) {
      return { migrated: 0, failed: 0, ran: false };
    }
  } catch {
    return { migrated: 0, failed: 0, ran: false };
  }

  let migrated = 0;
  let failed = 0;

  // Migrate the per-user key first, then the legacy un-namespaced key.
  for (const key of [LS_KEY(userId), LS_LEGACY_KEY]) {
    const photos = readLocalPhotos(key);
    if (!photos || photos.length === 0) continue;

    const remaining = [];
    for (const photo of photos) {
      const dataUrl = photo?.dataUrl;
      if (!dataUrl) continue; // skip malformed entries (don't retain)
      const takenAtMs = photo?.takenAt ? Date.parse(photo.takenAt) : Date.now();
      try {
        const blob = dataUrlToBlob(dataUrl);
        await uploadProgressPhoto(
          userId,
          blob,
          Number.isFinite(takenAtMs) ? takenAtMs : Date.now()
        );
        migrated += 1;
      } catch (err) {
        // `Duplicate` (object already uploaded by a prior partial run)
        // is effectively success — don't retain it.
        const msg = String(err?.message || err || '').toLowerCase();
        if (msg.includes('exists') || msg.includes('duplicate')) {
          migrated += 1;
        } else {
          failed += 1;
          remaining.push(photo);
        }
      }
    }

    try {
      if (remaining.length === 0) {
        localStorage.removeItem(key);
      } else {
        // Keep only the entries that failed so a future run retries them.
        localStorage.setItem(key, JSON.stringify(remaining));
      }
    } catch { /* storage write best-effort */ }
  }

  // Mark migrated only when nothing is left to retry.
  if (failed === 0) {
    try { localStorage.setItem(MIGRATED_FLAG(userId), '1'); } catch { /* ignore */ }
  }

  return { migrated, failed, ran: migrated > 0 || failed > 0 };
}
