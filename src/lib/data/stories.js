// src/lib/data/stories.js
//
// 24-hour photo stories.
//
// Data flow for the StoriesRow:
//   1. Caller provides the list of emails the current user follows.
//   2. getStoriesFeedData() fetches all non-expired stories for those emails
//      + the current user, their profiles, and the set of story IDs the
//      current user has already seen — all in one parallel round-trip.
//   3. Returns `groups`: one entry per person the user follows (including
//      themselves), sorted: own first → unseen stories → seen stories → no story.
//   4. `viewedIds` is a Set<storyId> for ring-state decisions in the UI.

import { supabase } from '@/api/supabaseClient';

/**
 * Fetch everything the StoriesRow needs in one pass.
 *
 * @param {{ id: string, email: string }} user  — currently signed-in user
 * @param {string[]} followingEmails            — emails the user follows
 * @returns {{ groups: StoryGroup[], viewedIds: Set<string> }}
 *
 * StoryGroup = {
 *   email: string,
 *   username: string,
 *   avatarUrl: string|null,
 *   isOwn: boolean,
 *   stories: Story[],      // non-expired, newest first
 *   hasUnseen: boolean,
 * }
 */
export async function getStoriesFeedData(user, followingEmails = []) {
  if (!user?.id) return { groups: [], viewedIds: new Set() };

  const allEmails = [...new Set([user.email, ...followingEmails])];
  const now = new Date().toISOString();

  const [storiesRes, profilesRes, viewsRes] = await Promise.all([
    supabase
      .from('stories')
      .select('*')
      .in('user_email', allEmails)
      .gt('expires_at', now)
      .order('created_at', { ascending: false }),

    supabase
      .from('user_profiles')
      .select('email, username, avatar_url')
      .in('email', allEmails),

    supabase
      .from('story_views')
      .select('story_id')
      .eq('viewer_id', user.id),
  ]);

  const stories   = storiesRes.data  ?? [];
  const profiles  = profilesRes.data ?? [];
  const viewedIds = new Set((viewsRes.data ?? []).map(r => r.story_id));

  const profileByEmail = Object.fromEntries(profiles.map(p => [p.email, p]));

  // Group stories by user_email
  const storyMap = new Map();
  for (const story of stories) {
    if (!storyMap.has(story.user_email)) storyMap.set(story.user_email, []);
    storyMap.get(story.user_email).push(story);
  }

  // Build one entry per person
  const groups = allEmails.map(email => {
    const profile    = profileByEmail[email] ?? {};
    const userStories = storyMap.get(email) ?? [];
    return {
      email,
      username:  profile.username || email.split('@')[0],
      avatarUrl: profile.avatar_url ?? null,
      isOwn:     email === user.email,
      stories:   userStories,
      hasUnseen: userStories.some(s => !viewedIds.has(s.id)),
    };
  });

  // Sort: own first → unseen-story friends → seen-story friends → no-story friends
  groups.sort((a, b) => {
    if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;
    const aHas = a.stories.length > 0;
    const bHas = b.stories.length > 0;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
    return 0;
  });

  return { groups, viewedIds };
}

/**
 * Upload a photo file to Supabase Storage under the stories/ prefix and
 * insert a new story row. Returns the new story object or null on failure.
 */
export async function createStory(user, file) {
  if (!user?.id || !file) return null;

  const ext  = (file.name || 'story').split('.').pop() || 'jpg';
  const path = `stories/${user.id}/${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('uploads')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (upErr) {
    console.warn('[stories] upload failed:', upErr);
    return null;
  }

  const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(path);

  const { data, error } = await supabase
    .from('stories')
    .insert({ user_id: user.id, user_email: user.email, image_url: publicUrl })
    .select()
    .single();

  if (error) {
    console.warn('[stories] insert failed:', error);
    return null;
  }
  return data;
}

/**
 * Mark a story as viewed. Uses upsert so duplicate calls are safe.
 */
export async function markStoryViewed(storyId, userId) {
  if (!storyId || !userId) return;
  await supabase
    .from('story_views')
    .upsert({ story_id: storyId, viewer_id: userId }, { onConflict: 'story_id,viewer_id' });
}

/**
 * Delete a story (owner only — enforced by RLS).
 */
export async function deleteStory(storyId) {
  if (!storyId) return { ok: false };
  const { error } = await supabase.from('stories').delete().eq('id', storyId);
  if (error) {
    console.warn('[stories] delete failed:', error);
    return { ok: false, error };
  }
  return { ok: true };
}
