// src/lib/data/notifications.js
//
// In-app notification feed. Use the helper notify*() functions for each
// event type — they encapsulate the schema and keep call sites tidy.
//
// Event taxonomy (see NOTIFICATION_TYPES below):
//   quest_claimed     — user claimed a quest reward
//   streak_milestone  — workout or login streak hit a milestone day
//   league_promoted   — user promoted from previous league tier
//   league_demoted    — user demoted from previous league tier
//   league_held       — user held position with a top-3 finish in legend
//   friend_post       — followed user published a hub post
//   friend_follow     — someone followed you
//   pr_set            — you set a personal record
//   capsule_earned    — you earned a capsule (level-up, milestone, etc.)
//   coin_milestone    — flex coins crossed a threshold (10k, 25k, etc.)

import { supabase } from '@/api/supabaseClient';

export const NOTIFICATION_TYPES = {
  QUEST_CLAIMED:     'quest_claimed',
  STREAK_MILESTONE:  'streak_milestone',
  LEAGUE_PROMOTED:   'league_promoted',
  LEAGUE_DEMOTED:    'league_demoted',
  LEAGUE_HELD:       'league_held',
  FRIEND_POST:       'friend_post',
  FRIEND_FOLLOW:     'friend_follow',
  PR_SET:            'pr_set',
  CAPSULE_EARNED:    'capsule_earned',
  COIN_MILESTONE:    'coin_milestone',
};

const DEFAULT_LIMIT = 50;

/** List the user's recent notifications, newest first. */
export async function listForUser(user, limit = DEFAULT_LIMIT) {
  if (!user?.id) return [];
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[notifications] list failed:', error);
    return [];
  }
  return data ?? [];
}

/** Count of unread notifications — drives the bell-icon badge. */
export async function unreadCount(user) {
  if (!user?.id) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('is_read', false);
  if (error) return 0;
  return count ?? 0;
}

/** Mark a single notification read. */
export async function markRead(notificationId) {
  if (!notificationId) return;
  await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId);
}

/** Mark all of the user's notifications as read. */
export async function markAllRead(user) {
  if (!user?.id) return;
  await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', user.id)
    .eq('is_read', false);
}

// ── Internal: low-level create ────────────────────────────────────────────────
//
// SELF-TARGETED writes: direct INSERT — RLS policy `user_id = auth.uid()`
// (migration 026) allows these.
//
// CROSS-USER writes (notifyFriendFollow, notifyFriendPost): route through
// the create_notification_for SECURITY DEFINER RPC. The RPC's whitelist
// constrains which `type` values can be dispatched cross-user, blocking
// the phishing/spam surface where any authenticated client could forge
// notifications into any other user's inbox.

async function _create({ userId, userEmail, type, title, body, icon, linkUrl, metadata, crossUser = false }) {
  if (!userId || !type || !title) return null;

  if (crossUser) {
    // Server-side validated cross-user dispatch.
    try {
      const { data: id, error } = await supabase.rpc('create_notification_for', {
        p_user_id:  userId,
        p_type:     type,
        p_title:    title,
        p_body:     body ?? null,
        p_icon:     icon ?? null,
        p_link_url: linkUrl ?? null,
        p_metadata: metadata ?? {},
      });
      if (!error) return id ? { id, user_id: userId, type, title } : null;
      // Pre-migration: function not found. Fall through to the legacy
      // direct-insert path, which will hit the new RLS check and fail
      // — but only on hosts that haven't applied migration 026 yet.
      if (error.code !== '42883' && error.code !== '42P01') {
        console.warn('[notifications] cross-user RPC failed:', error);
        return null;
      }
    } catch (err) {
      if (err?.code !== '42883' && err?.code !== '42P01') {
        console.warn('[notifications] cross-user RPC threw:', err);
        return null;
      }
    }
    // Fall through to legacy path for pre-migration hosts.
  }

  const { data, error } = await supabase
    .from('notifications')
    .insert({
      user_id:    userId,
      user_email: userEmail,
      type,
      title,
      body:       body ?? null,
      icon:       icon ?? null,
      link_url:   linkUrl ?? null,
      metadata:   metadata ?? {},
    })
    .select()
    .single();
  if (error) {
    console.warn('[notifications] create failed:', error);
    return null;
  }
  return data;
}

// ── Helpers per event type ────────────────────────────────────────────────────
// All helpers accept `t` from useLanguage so titles can be localized at write
// time. If `t` isn't available (e.g. background context), pass null and the
// caller-provided string defaults will be used.

export async function notifyQuestClaimed({ user, questLabel, coinsAwarded }) {
  return _create({
    userId:    user.id,
    userEmail: user.email,
    type:      NOTIFICATION_TYPES.QUEST_CLAIMED,
    title:     `🪙 +${coinsAwarded} coins · ${questLabel}`,
    body:      'Quest reward claimed.',
    icon:      '🎯',
    linkUrl:   '/dashboard',
    metadata:  { questLabel, coinsAwarded },
  });
}

export async function notifyStreakMilestone({ user, kind, day, coinsAwarded, eliteCapsuleAwarded }) {
  // kind: 'login' | 'workout'
  const verb = kind === 'workout' ? 'Workout streak' : 'Login streak';
  const capsule = eliteCapsuleAwarded ? ' + Elite Capsule' : '';
  return _create({
    userId:    user.id,
    userEmail: user.email,
    type:      NOTIFICATION_TYPES.STREAK_MILESTONE,
    title:     `🔥 ${verb}: Day ${day}!`,
    body:      `+${coinsAwarded} coins${capsule}`,
    icon:      kind === 'workout' ? '💪' : '🔥',
    linkUrl:   '/dashboard',
    metadata:  { kind, day, coinsAwarded, eliteCapsuleAwarded: !!eliteCapsuleAwarded },
  });
}

export async function notifyLeagueResolution({ user, outcome, fromTier, toTier, coinsAwarded, capsuleAwarded }) {
  // outcome: 'promote' | 'demote' | 'stay'
  let type, title, body, icon;
  if (outcome === 'promote') {
    type  = NOTIFICATION_TYPES.LEAGUE_PROMOTED;
    title = `⬆️ Promoted to ${toTier}!`;
    body  = `+${coinsAwarded} coins${capsuleAwarded ? ' + ' + capsuleAwarded + ' capsule' : ''}`;
    icon  = '🏆';
  } else if (outcome === 'demote') {
    type  = NOTIFICATION_TYPES.LEAGUE_DEMOTED;
    title = `⬇️ Demoted to ${toTier}`;
    body  = `Climb back next week!`;
    icon  = '📉';
  } else {
    type  = NOTIFICATION_TYPES.LEAGUE_HELD;
    title = `Held position in ${fromTier}`;
    body  = coinsAwarded > 0 ? `+${coinsAwarded} coins` : 'Push for promotion next week.';
    icon  = '🛡️';
  }
  return _create({
    userId:    user.id,
    userEmail: user.email,
    type,
    title,
    body,
    icon,
    linkUrl:   '/dashboard',
    metadata:  { outcome, fromTier, toTier, coinsAwarded, capsuleAwarded },
  });
}

export async function notifyFriendPost({ recipient, posterName, postPreview }) {
  // crossUser=true routes through create_notification_for RPC — the RLS
  // policy on direct INSERT only allows user_id = auth.uid().
  return _create({
    userId:    recipient.id || recipient.user_id,
    userEmail: recipient.email || recipient.user_email,
    type:      NOTIFICATION_TYPES.FRIEND_POST,
    title:     `${posterName} posted`,
    body:      postPreview?.slice(0, 100) || '',
    icon:      '✨',
    linkUrl:   '/hub',
    metadata:  { posterName },
    crossUser: true,
  });
}

export async function notifyFriendFollow({ recipientUserId, recipientEmail, followerName }) {
  return _create({
    userId:    recipientUserId,
    userEmail: recipientEmail,
    type:      NOTIFICATION_TYPES.FRIEND_FOLLOW,
    title:     `${followerName} followed you`,
    body:      'Tap to view their profile.',
    icon:      '👋',
    linkUrl:   '/hub',
    metadata:  { followerName },
    crossUser: true,
  });
}

export async function notifyPrSet({ user, prLabel, value, unit }) {
  return _create({
    userId:    user.id,
    userEmail: user.email,
    type:      NOTIFICATION_TYPES.PR_SET,
    title:     `🏆 New ${prLabel} PR!`,
    body:      `${value}${unit ? ' ' + unit : ''}`,
    icon:      '⚡',
    linkUrl:   '/progress',
    metadata:  { prLabel, value, unit },
  });
}

export async function notifyCapsuleEarned({ user, capsuleType, reason }) {
  const labels = { standard: 'Standard', premium: 'Premium', elite: 'Elite' };
  const label  = labels[capsuleType] || 'Mystery';
  return _create({
    userId:    user.id,
    userEmail: user.email,
    type:      NOTIFICATION_TYPES.CAPSULE_EARNED,
    title:     `🎁 ${label} Capsule earned`,
    body:      reason || 'Open it from your bag.',
    icon:      capsuleType === 'elite' ? '💎' : capsuleType === 'premium' ? '🎁' : '📦',
    linkUrl:   '/hub',
    metadata:  { capsuleType, reason },
  });
}
