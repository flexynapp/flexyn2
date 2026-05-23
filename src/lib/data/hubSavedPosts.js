// src/lib/data/hubSavedPosts.js
// Bookmarks for any hub post. One row per (user, post).
// Distinct from savedMeals (localStorage-based) — this is server-persisted.

import { supabase } from '@/api/supabaseClient';

/** Returns true if userEmail has saved postId. */
export const isSaved = async (userEmail, postId) => {
  if (!userEmail || !postId) return false;
  const { data } = await supabase
    .from('hub_saved_posts')
    .select('id')
    .eq('user_email', userEmail)
    .eq('post_id', postId)
    .maybeSingle();
  return !!data;
};

/** Save a post. Ignores unique-violation (already saved = no-op). */
export const save = async (userEmail, postId) => {
  const { error } = await supabase
    .from('hub_saved_posts')
    .insert({ user_email: userEmail, post_id: postId });
  if (error && error.code !== '23505') throw error;
};

/** Remove a saved post. */
export const unsave = async (userEmail, postId) => {
  const { error } = await supabase
    .from('hub_saved_posts')
    .delete()
    .eq('user_email', userEmail)
    .eq('post_id', postId);
  if (error) throw error;
};

/**
 * Returns saved post IDs for the user, newest-first.
 * Used to pre-populate the "Saved" view in HubFeed.
 */
export const listSavedPostIds = async (userEmail, limit = 50) => {
  if (!userEmail) return [];
  const { data, error } = await supabase
    .from('hub_saved_posts')
    .select('post_id')
    .eq('user_email', userEmail)
    .order('saved_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data || []).map(r => r.post_id);
};

/**
 * Returns a Set of postIds the user has saved.
 * Efficient for rendering many cards — one query, O(1) lookups.
 */
export const getSavedSet = async (userEmail, postIds) => {
  if (!userEmail || !postIds?.length) return new Set();
  const { data } = await supabase
    .from('hub_saved_posts')
    .select('post_id')
    .eq('user_email', userEmail)
    .in('post_id', postIds);
  return new Set((data || []).map(r => r.post_id));
};
