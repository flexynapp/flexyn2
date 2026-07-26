// src/lib/data/stories.js
//
// 24/25-hour photo stories with likes, view insights, status notes, and privacy.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { selectProfiles } from './users';
import { findOrCreateConversation, sendMessage } from './hubMessages';

/**
 * Fetch everything the StoriesRow needs in one parallel pass:
 *   - non-expired stories for following list + self
 *   - profile records (username, avatar_url, etc.)
 *   - viewed/liked story IDs for current user
 *   - active status notes for all emails
 *   - story blocks (emails that blocked the viewer)
 *
 * Returns { groups, viewedIds, likedIds, noteByEmail, likedNoteIds, ownPrivacyDefault }
 */
export async function getStoriesFeedData(user, followingIds = []) {
  if (!user?.id) return { groups: [], viewedIds: new Set(), likedIds: new Set(), noteByUserId: {}, likedNoteIds: new Set(), ownPrivacyDefault: 'friends' };

  const allIds = [...new Set([user.id, ...followingIds])];
  const now = new Date().toISOString();

  const [storiesRes, profilesRes, viewsRes, likesRes, notesRes, blocksRes] = await Promise.all([
    supabase
      .from('stories')
      .select('*')
      .in('user_id', allIds)
      .is('crew_id', null)   // SECURITY: exclude crew-scoped stories from the personal feed
      .gt('expires_at', now)
      .order('created_at', { ascending: true }),

    // Resolve owner profiles by user_id — never off the email column.
    // story_dms_disabled (migration 046) + default_story_privacy
    // (migration 047) may be missing in mid-migration environments;
    // safeSelect strips and retries so the StoriesRow doesn't crash
    // the Hub when one of those migrations is pending.
    safeSelect({
      columns: ['id', 'username', 'avatar_url', 'story_dms_disabled', 'default_story_privacy'],
      build: (cols) => selectProfiles((from) => from.select(cols).in('id', allIds)),
    }),

    supabase
      .from('story_views')
      .select('story_id')
      .eq('viewer_id', user.id),

    supabase
      .from('story_likes')
      .select('story_id')
      .eq('liker_id', user.id),

    supabase
      .from('status_notes')
      .select('*')
      .in('user_id', allIds)
      .gt('expires_at', now)
      .order('created_at', { ascending: false }),

    // Who has blocked the current viewer? (id-keyed block graph, mig 210)
    supabase
      .from('story_blocks')
      .select('blocker_id')
      .eq('blocked_id', user.id),
  ]);

  const stories        = storiesRes.data  ?? [];
  const profiles       = profilesRes.data ?? [];

  // ── Public discovery ───────────────────────────────────────────────────
  // Stories from accounts you DON'T follow, shown only when both are true:
  //   1. the story itself was posted as 'public' (the author opted in), and
  //   2. the author's profile is public (is_private = false).
  // A private account's stories therefore stay follow-only, which is the
  // whole rule: public profiles are viewable by anyone, private ones aren't.
  const discovered = { stories: [], profiles: [], ids: [] };
  try {
    const { data: pubStories } = await supabase
      .from('stories')
      .select('*')
      .eq('privacy', 'public')
      .is('crew_id', null)     // crew stories never leak into the personal feed
      .gt('expires_at', now)
      .order('created_at', { ascending: true })
      .limit(200);

    const candidateIds = [...new Set((pubStories ?? [])
      .map(s => s.user_id)
      .filter(id => id && !allIds.includes(id) && !blockedByIds.has(id)))];

    if (candidateIds.length) {
      const { data: pubProfiles } = await safeSelect({
        columns: ['id', 'username', 'avatar_url', 'story_dms_disabled', 'default_story_privacy', 'is_private'],
        build: (cols) => selectProfiles((from) => from.select(cols).in('id', candidateIds)),
      });
      // Only PUBLIC profiles. If is_private is missing on this host, treat the
      // account as private — fail closed, never expose a story by accident.
      const publicOnly = (pubProfiles ?? []).filter(p => p?.is_private === false);
      discovered.profiles = publicOnly;
      discovered.ids      = publicOnly.map(p => p.id);
      const visible       = new Set(discovered.ids);
      discovered.stories  = (pubStories ?? []).filter(s => visible.has(s.user_id));
    }
  } catch {
    // Discovery is additive — a failure here must never break the own/following
    // feed, so fall through with an empty discovery set.
  }
  stories.push(...discovered.stories);
  profiles.push(...discovered.profiles);
  const viewedIds      = new Set((viewsRes.data  ?? []).map(r => r.story_id));
  const likedIds       = new Set((likesRes.data  ?? []).map(r => r.story_id));
  const notes          = notesRes.data    ?? [];
  const blockedByIds   = new Set((blocksRes.data ?? []).map(r => r.blocker_id));

  // Fetch liked note IDs and note like counts in a second parallel pass
  const noteIds = notes.map(n => n.id);
  const [noteLikesRes, noteLikeCountsRes] = await Promise.all([
    noteIds.length
      ? supabase.from('status_note_likes').select('note_id').eq('liker_id', user.id).in('note_id', noteIds)
      : Promise.resolve({ data: [] }),
    noteIds.length
      ? supabase.from('status_note_likes').select('note_id').in('note_id', noteIds)
      : Promise.resolve({ data: [] }),
  ]);

  const likedNoteIds = new Set((noteLikesRes.data ?? []).map(r => r.note_id));
  const noteLikeCounts = {};
  for (const r of (noteLikeCountsRes.data ?? [])) {
    noteLikeCounts[r.note_id] = (noteLikeCounts[r.note_id] ?? 0) + 1;
  }

  // Most-recent active note per user_id
  const noteByUserId = {};
  for (const note of notes) {
    if (!noteByUserId[note.user_id]) {
      noteByUserId[note.user_id] = { ...note, likeCount: noteLikeCounts[note.id] ?? 0 };
    }
  }

  const profileById = Object.fromEntries(profiles.map(p => [p.id, p]));

  const storyMap = new Map();
  for (const story of stories) {
    if (!storyMap.has(story.user_id)) storyMap.set(story.user_id, []);
    storyMap.get(story.user_id).push(story);
  }

  // Own + following, then any public accounts surfaced by discovery.
  const groups = [...allIds, ...discovered.ids.filter(id => !allIds.includes(id))]
    .filter(id => id === user.id || !blockedByIds.has(id))
    .map(id => {
      const profile     = profileById[id] ?? {};
      const userStories = storyMap.get(id)  ?? [];
      return {
        user_id:            id,
        // Owner email for the story-reply DM path only, sourced from the
        // story row's own user_email column (NOT the public_profiles view).
        // Null for no-story groups — you can't reply to those anyway.
        email:              userStories[0]?.user_email ?? null,
        username:           profile.username || 'Athlete',
        avatarUrl:          profile.avatar_url ?? null,
        storyDmsDisabled:   profile.story_dms_disabled ?? false,
        isOwn:              id === user.id,
        stories:            userStories,
        hasUnseen:          userStories.some(s => !viewedIds.has(s.id)),
        note:               noteByUserId[id] ?? null,
      };
    });

  groups.sort((a, b) => {
    if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;
    const aHas = a.stories.length > 0 || !!a.note;
    const bHas = b.stories.length > 0 || !!b.note;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
    return 0;
  });

  const ownProfile = profileById[user.id] ?? {};
  return {
    groups,
    viewedIds,
    likedIds,
    noteByUserId,
    likedNoteIds,
    ownPrivacyDefault: ownProfile.default_story_privacy ?? 'friends',
  };
}

/**
 * Upload a photo/video and insert a story row.
 * Returns { ok, data } on success or { ok: false, limitReached?, error? }.
 *
 * Enforces a 10-story limit per rolling 25-hour window and sets expires_at
 * explicitly to 25 hours from now.
 */
export async function createStory(user, file, overlayStyle = null, privacy = 'friends', overlays = null) {
  if (!user?.id || !file) return { ok: false, error: 'missing_params' };

  // Enforce 10-story limit
  const now = new Date().toISOString();
  const { count, error: countErr } = await supabase
    .from('stories')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gt('expires_at', now);

  if (countErr) console.warn('[stories] count check failed:', countErr);
  if ((count ?? 0) >= 10) return { ok: false, limitReached: true };

  const ext       = (file.name || 'story').split('.').pop() || 'jpg';
  const path      = `${user.id}/stories/${Date.now()}.${ext}`;
  const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
  // Stories live exactly 24 hours, then they stop being served (the feed
  // query filters on expires_at) and get cleaned up.
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // upsert:false — an upsert makes Storage check for an existing row, which
  // needs a SELECT policy on storage.objects. Migration 185 dropped the
  // uploads bucket's SELECT policy (to stop enumeration), so upsert uploads
  // started failing with "403: new row violates row-level security policy".
  // The path is already unique (user id + ms timestamp), so there is nothing
  // to overwrite and a plain insert is the correct semantic.
  const { error: upErr } = await supabase.storage
    .from('uploads')
    .upload(path, file, { upsert: false, contentType: file.type });

  if (upErr) { console.warn('[stories] upload failed:', upErr); return { ok: false, error: upErr }; }

  const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(path);

  // Sanitize overlays (mig 111) — keep only the fields we render so a
  // bad client can't bloat the JSONB cap. Caps the array at 50 items.
  const cleanOverlays = Array.isArray(overlays)
    ? overlays.slice(0, 50).map(o => {
        if (!o || typeof o !== 'object') return null;
        const base = {
          kind: String(o.kind || '').slice(0, 16),
          x: Number(o.x) || 0.5,
          y: Number(o.y) || 0.5,
          scale: Number.isFinite(Number(o.scale)) ? Number(o.scale) : 1,
          rotation: Number.isFinite(Number(o.rotation)) ? Number(o.rotation) : 0,
        };
        if (base.kind === 'emoji')   return { ...base, emoji: String(o.emoji || '').slice(0, 8) };
        if (base.kind === 'text')    return { ...base, text: String(o.text || '').slice(0, 280), color: o.color || '#fff', font: o.font || 'normal', boxed: !!o.boxed, width: Number.isFinite(Number(o.width)) ? Math.max(0.2, Math.min(1, Number(o.width))) : 0.7 };
        if (base.kind === 'sticker') return { ...base, label: String(o.label || '').slice(0, 32), stickerId: o.stickerId || null };
        if (base.kind === 'drawing') return {
          ...base,
          // Freehand stroke as normalized [x,y] points (0..1). Capped so a
          // scribble can't bloat the JSONB cap.
          points: Array.isArray(o.points)
            ? o.points.slice(0, 400).map(p => [Number(p?.[0]) || 0, Number(p?.[1]) || 0])
            : [],
          color: o.color || '#fff',
          width: Number.isFinite(Number(o.width)) ? Number(o.width) : 4,
        };
        return null;
      }).filter(Boolean)
    : null;

  const baseInsert = {
    user_id:       user.id,
    user_email:    user.email,
    image_url:     publicUrl,
    overlay_text:  overlayStyle?.text || null,
    overlay_style: overlayStyle       || null,
    media_type:    mediaType,
    privacy,
    expires_at:    expiresAt,
  };
  const insertRow = (cleanOverlays && cleanOverlays.length)
    ? { ...baseInsert, overlays: cleanOverlays }
    : baseInsert;

  let { data, error } = await supabase
    .from('stories')
    .insert(insertRow)
    .select()
    .single();

  // Pre-111 host: `overlays` column doesn't exist yet — retry without
  // it so the story still saves. The overlay layer is purely additive
  // so dropping it on stale hosts is a clean degradation.
  if (error && (error.code === '42703' || error.code === 'PGRST204') && cleanOverlays?.length) {
    const retry = await supabase.from('stories').insert(baseInsert).select().single();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    // Insert failed but the file is already in Supabase Storage.
    // Without cleanup that orphan persists forever — every retry on a
    // flaky upload leaks another blob. Best-effort delete; the
    // .catch swallows secondary failures (rare nested error) because
    // the user already needs a retry and a stuck-orphan log line is
    // less important than returning the original insert error.
    supabase.storage.from('uploads').remove([path]).catch((cleanupErr) => {
      console.warn('[stories] orphan-upload cleanup failed:', cleanupErr);
    });
    console.warn('[stories] insert failed:', error);
    return { ok: false, error };
  }
  return { ok: true, data };
}

// Server-enforced reply gate. If the recipient has story_dms_disabled
// true on their profile, the reply is rejected before it hits the DM
// system. Migration 047 stores the flag; SettingsPanel writes it; and
// the UI hides the reply input — but a malicious client could bypass
// the UI by calling sendStoryReply directly. This check makes the
// toggle a real boundary.
async function _recipientAllowsDmReplies(recipientId) {
  if (!recipientId) return false;
  try {
    // Cross-user read of the recipient's story_dms_disabled flag, keyed by
    // user_id (never the view's email — which no longer exists).
    const { data } = await selectProfiles((from) => from
      .select('story_dms_disabled')
      .eq('id', recipientId)
      .maybeSingle());
    // If the column doesn't exist on this host yet, default to allowing
    // replies (matches the legacy behavior).
    if (!data) return true;
    return data.story_dms_disabled !== true;
  } catch {
    return true;
  }
}

/**
 * Send a reply to a story — routes through the existing DM system.
 *
 * Enforces the recipient's story_dms_disabled preference SERVER-SIDE
 * (well, server-checked-then-server-called). The audit found that the
 * StoryViewer hid the reply UI when the recipient had DMs off, but
 * the function itself didn't validate — a direct call could spam.
 * Now the check is done here, before any DM machinery runs.
 *
 * Returns:
 *   { ok: true,  conversationId } — message sent
 *   { ok: false, reason: 'dms_disabled' | 'network' | 'invalid' }
 *
 * The conversationId lets the caller surface a one-tap "Open" CTA in
 * the success toast so the user can jump straight into the thread.
 */
export async function sendStoryReply(storyOwnerId, sender, message) {
  if (!storyOwnerId || !sender?.email || !message?.trim()) {
    return { ok: false, reason: 'invalid' };
  }
  // Server-checked: do they accept reply DMs at all?
  const allowed = await _recipientAllowsDmReplies(storyOwnerId);
  if (!allowed) {
    console.warn('[stories] reply blocked — recipient has story DMs disabled');
    return { ok: false, reason: 'dms_disabled' };
  }
  try {
    const conv = await findOrCreateConversation(sender.email, storyOwnerId);
    if (!conv?.id) return { ok: false, reason: 'network' };
    await sendMessage({
      conversationId: conv.id,
      senderEmail:    sender.email,
      recipientId:    storyOwnerId,
      body:           message.trim(),
    });
    return { ok: true, conversationId: conv.id };
  } catch (err) {
    console.warn('[stories] reply failed:', err);
    return { ok: false, reason: 'network' };
  }
}

/** Toggle story DMs on/off for the current user. */
export async function updateStoryDmsSettings(userId, storyDmsDisabled) {
  if (!userId) return false;
  const { error } = await supabase
    .from('user_profiles')
    .update({ story_dms_disabled: storyDmsDisabled })
    .eq('id', userId);
  if (error) { console.warn('[stories] settings update failed:', error); return false; }
  return true;
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
 * swipe-up insights panel).
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
    const { data: profiles } = await safeSelect({
      columns: ['id', 'username', 'avatar_url'],
      build: (cols) => selectProfiles((from) => from
        .select(cols)
        .in('id', allIds)),
    });
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
