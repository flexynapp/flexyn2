// src/lib/data/statusNotes.js
// Status notes: short text blurbs shown on profile avatars in the stories tray.

import { supabase } from '@/api/supabaseClient';

/** Post (or replace) the current user's active status note. */
export async function postStatusNote(user, text) {
  if (!user?.id || !text?.trim()) return null;
  const now = new Date().toISOString();
  // Remove any existing active note first (one note at a time)
  await supabase.from('status_notes').delete().eq('user_id', user.id).gt('expires_at', now);
  const { data, error } = await supabase
    .from('status_notes')
    .insert({ user_id: user.id, user_email: user.email, text: text.trim().slice(0, 60) })
    .select()
    .single();
  if (error) { console.warn('[statusNotes] create failed:', error); return null; }
  return data;
}

/** Delete a status note by ID (own notes only — enforced by RLS). */
export async function deleteStatusNote(noteId) {
  if (!noteId) return false;
  const { error } = await supabase.from('status_notes').delete().eq('id', noteId);
  return !error;
}

/** Like a status note. Idempotent. */
export async function likeStatusNote(noteId, user) {
  if (!noteId || !user?.id) return false;
  const { error } = await supabase
    .from('status_note_likes')
    .upsert(
      { note_id: noteId, liker_id: user.id, liker_email: user.email },
      { onConflict: 'note_id,liker_id' },
    );
  return !error;
}

/** Unlike a status note. */
export async function unlikeStatusNote(noteId, userId) {
  if (!noteId || !userId) return false;
  const { error } = await supabase
    .from('status_note_likes')
    .delete()
    .eq('note_id', noteId)
    .eq('liker_id', userId);
  return !error;
}
