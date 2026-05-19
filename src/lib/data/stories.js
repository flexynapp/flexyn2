// src/lib/data/stories.js
//
// 24-hour photo stories with likes and view insights.

import { supabase } from '@/api/supabaseClient';

/**
 * Fetch everything the StoriesRow needs in one parallel pass:
 *   • non-expired stories for following list + self
 *   • profile records (username, avatar_url) for each person
 *   • Set of story IDs the current user has already viewed
 *   • Set of story IDs the current user has already liked
 *
 * Returns { groups, viewedIds, likedIds }
 *
 * StoryGroup = {
 *   email, username, avatarUrl, isOwn,
 *   stories: Story[],   // non-expired, newest first
 *   hasUnseen: boolean,
 * }
 */
export async function getStoriesFeedData(user, followingEmails = []) {
  if (!user?.id) return { groups: [], viewedIds: new Set(), likedIds: new Set() };

  const allEmails = [...new Set([user.email, ...followingEmails])];
  const now = new Date().toISOString();

  const [storiesRes, profilesRes, viewsRes, likesRes] = await Promise.all([
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

    supabase
      .from('story_likes')
      .select('story_id')
      .eq('liker_id', user.id),
  ]);

  const stories   = storiesRes.data  ?? [];
  const profiles  = profilesRes.data ?? [];
  const viewedIds = new Set((viewsRes.data  ?? []).map(r => r.story_id));
  const likedIds  = new Set((likesRes.data  ?? []).map(r => r.story_id));

  const profileByEmail = Object.fromEntries(profiles.map(p => [p.email, p]));

  const storyMap = new Map();
  for (const story of stories) {
    if (!storyMap.has(story.user_email)) storyMap.set(story.user_email, []);
    storyMap.get(story.user_email).push(story);
  }

  const groups = allEmails.map(email => {
    const profile     = profileByEmail[email] ?? {};
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

  return { groups, viewedIds, likedIds };
}

/**
 * Upload a photo and insert a story row. Returns the new story or null.
 * Path is <uid>/stories/<timestamp>.<ext> so the existing storage RLS
 * policy "(storage.foldername(name))[1] = auth.uid()" passes.
 */
export async function createStory(user, file) {
  if (!user?.id || !file) return null;

  const ext  = (file.name || 'story').split('.').pop() || 'jpg';
  const path = `${user.id}/stories/${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('uploads')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (upErr) { console.warn('[stories] upload failed:', upErr); return null; }

  const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(path);

  const { data, error } = await supabase
    .from('stories')
    .insert({ user_id: user.id, user_email: user.email, image_url: publicUrl })
    .select()
    .single();

  if (error) { console.warn('[stories] insert failed:', error); return null; }
  return data;
}

/** Mark a story viewed. Upsert is idempotent on the unique constraint. */
export async function markStoryViewed(storyId, userId) {
  if (!storyId || !userId) return;
  await supabase
    .from('story_views')
    .upsert({ story_id: storyId, viewer_id: userId }, { onConflict: 'story_id,viewer_id' });
}

/** Like a story. Upsert — calling twice is safe. */
export async function likeStory(storyId, user) {
  if (!storyId || !user?.id) return false;
  const { error } = await supabase
    .from('story_likes')
    .upsert(
      { story_id: storyId, liker_id: user.id, liker_email: user.email },
      { onConflict: 'story_id,liker_id' }
    );
  if (error) { console.warn('[stories] like failed:', error); return false; }
  return true;
}

/** Unlike a story. */
export async function unlikeStory(storyId, userId) {
  if (!storyId || !userId) return false;
  const { error } = await supabase
    .from('story_likes')
    .delete()
    .eq('story_id', storyId)
    .eq('liker_id', userId);
  if (error) { console.warn('[stories] unlike failed:', error); return false; }
  return true;
}

/**
 * Fetch viewer + liker lists for a single story (shown in the owner's
 * swipe-up insights panel). Batches profile lookups in one extra query.
 *
 * Returns {
 *   viewers: Array<{ viewer_id, viewed_at, profile: { username, avatar_url } }>,
 *   likers:  Array<{ liker_id,  created_at, profile: { username, avatar_url } }>,
 * }
 */
export async function getStoryInsights(storyId) {
  if (!storyId) return { viewers: [], likers: [] };

  const [viewsRes, likesRes] = await Promise.all([
    supabase
      .from('story_views')
      .select('viewer_id, viewed_at')
      .eq('story_id', storyId)
      .order('viewed_at', { ascending: false }),

    supabase
      .from('story_likes')
      .select('liker_id, liker_email, created_at')
      .eq('story_id', storyId)
      .order('created_at', { ascending: false }),
  ]);

  const views = viewsRes.data ?? [];
  const likes = likesRes.data ?? [];

  const allIds = [...new Set([
    ...views.map(v => v.viewer_id),
    ...likes.map(l => l.liker_id),
  ])];

  let profileMap = {};
  if (allIds.length > 0) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, username, avatar_url')
      .in('id', allIds);
    profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]));
  }

  return {
    viewers: views.map(v => ({ ...v, profile: profileMap[v.viewer_id] ?? {} })),
    likers:  likes.map(l => ({ ...l, profile: profileMap[l.liker_id]  ?? {} })),
  };
}

/** Delete a story (owner only — enforced by RLS). */
export async function deleteStory(storyId) {
  if (!storyId) return { ok: false };
  const { error } = await supabase.from('stories').delete().eq('id', storyId);
  if (error) { console.warn('[stories] delete failed:', error); return { ok: false, error }; }
  return { ok: true };
}
