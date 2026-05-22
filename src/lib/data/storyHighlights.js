// src/lib/data/storyHighlights.js
//
// CRUD wrapper around story_highlights + story_highlight_items
// (migration 099). Pinned "best of" story albums that live on the
// user's profile beyond the normal 24-hour story TTL.

import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';

/** List a user's highlight albums, sorted by sort_order then newest. */
export async function listHighlightsForUser(userEmail) {
  if (!userEmail) return [];
  const { data, error } = await supabase
    .from('story_highlights')
    .select('id, title, cover_url, sort_order, created_at')
    .eq('user_email', userEmail)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) return [];
  return data ?? [];
}

/** List the stories inside a highlight album, newest first. */
export async function listItemsForHighlight(highlightId) {
  if (!highlightId) return [];
  const { data, error } = await supabase
    .from('story_highlight_items')
    .select('id, story_id, added_at, stories(id, image_url, video_url, created_at)')
    .eq('highlight_id', highlightId)
    .order('added_at', { ascending: false });
  if (error) return [];
  return data ?? [];
}

/** Create a new album. */
export async function createHighlight({ title, coverUrl } = {}) {
  const t = (title || '').trim();
  if (!t) return { ok: false, reason: 'no_title' };
  if (t.length > 40) return { ok: false, reason: 'title_too_long' };
  // Profanity gate — album titles are visible to followers + anyone
  // viewing the profile. Mirrors the username + crew-name policy.
  if (containsProfanity(t)) return { ok: false, reason: 'profanity' };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id || !user?.email) return { ok: false, reason: 'unauthenticated' };

  const { data, error } = await supabase
    .from('story_highlights')
    .insert({
      user_id:    user.id,
      user_email: user.email,
      title:      t,
      cover_url:  coverUrl || null,
    })
    .select('id')
    .single();
  if (error) return { ok: false, reason: 'db_error' };
  return { ok: true, id: data?.id };
}

/** Add a story to a highlight album. Idempotent via UNIQUE. */
export async function addStoryToHighlight(highlightId, storyId) {
  if (!highlightId || !storyId) return { ok: false, reason: 'missing' };
  const { error } = await supabase
    .from('story_highlight_items')
    .insert({ highlight_id: highlightId, story_id: storyId });
  if (error) {
    // 23505 = unique_violation = already in this album, treat as ok.
    if (error.code === '23505') return { ok: true, already: true };
    return { ok: false, reason: 'db_error' };
  }
  return { ok: true };
}

/** Remove a story from a highlight (doesn't delete the story itself). */
export async function removeStoryFromHighlight(highlightId, storyId) {
  if (!highlightId || !storyId) return { ok: false, reason: 'missing' };
  const { error } = await supabase
    .from('story_highlight_items')
    .delete()
    .eq('highlight_id', highlightId)
    .eq('story_id', storyId);
  if (error) return { ok: false, reason: 'db_error' };
  return { ok: true };
}

/** Delete an entire album. story_highlight_items rows CASCADE. */
export async function deleteHighlight(highlightId) {
  if (!highlightId) return { ok: false, reason: 'no_id' };
  const { error } = await supabase
    .from('story_highlights')
    .delete()
    .eq('id', highlightId);
  if (error) return { ok: false, reason: 'db_error' };
  return { ok: true };
}
