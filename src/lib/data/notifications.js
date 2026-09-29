// src/lib/data/notifications.js
//
// In-app notification feed. Use the helper notify*() functions for each
// event type — they encapsulate the schema and keep call sites tidy.
//
// Event taxonomy (see NOTIFICATION_TYPES below):
//   quest_claimed         — user claimed a quest reward
//   streak_milestone      — workout or login streak hit a milestone day
//   league_promoted       — user promoted from previous league tier
//   league_demoted        — user demoted from previous league tier
//   league_held           — user held position with a top-3 finish in legend
//   friend_post           — followed user published a hub post
//   friend_follow         — someone followed you
//   pr_set                — you set a personal record
//   capsule_earned        — you earned a capsule (level-up, milestone, etc.)
//   coin_milestone        — flex coins crossed a threshold (10k, 25k, etc.)
//   streak_break_warning  — cron-fired: streak about to end (also fireable from JS)
//   welcome_back          — cron-fired: returning after N idle days
//   quest_expiry_warning  — cron-fired: incomplete quests at end of day
//
// ── i18n NOTE ────────────────────────────────────────────────────────────
// The migration 017 schema stores already-rendered title/body strings.
// That means a notification is locked into the language the user had at
// WRITE time — switching languages later won't retroactively translate
// old rows. For SELF-TARGETED helpers we use the caller's `t` so users
// see their own notifications in their own language. For CROSS-USER
// helpers (notifyFriendFollow, notifyFriendPost) the SENDER's `t` is
// what we have; for true recipient-language rendering of those, route
// through a server-side text helper like streak_break_text() in
// migration 035 — out of scope for this layer.

import { supabase } from '@/api/supabaseClient';
import { CAPSULE_GLYPH } from '@/lib/lootCatalog';
import { isFromPeople } from '@/lib/notificationCatalog';


export const NOTIFICATION_TYPES = {
  QUEST_CLAIMED:        'quest_claimed',
  STREAK_MILESTONE:     'streak_milestone',
  LEAGUE_PROMOTED:      'league_promoted',
  LEAGUE_DEMOTED:       'league_demoted',
  LEAGUE_HELD:          'league_held',
  FRIEND_POST:          'friend_post',
  FRIEND_FOLLOW:        'friend_follow',
  PR_SET:               'pr_set',
  CAPSULE_EARNED:       'capsule_earned',
  COIN_MILESTONE:       'coin_milestone',
  STREAK_BREAK_WARNING: 'streak_break_warning',
  WELCOME_BACK:         'welcome_back',
  QUEST_EXPIRY_WARNING: 'quest_expiry_warning',
  REPORT_RESOLVED:      'report_resolved',
};

// ── Push-only types ──────────────────────────────────────────────────────
// Rows the server inserts SOLELY so the migration 034 trigger fans out a
// push. A different surface already owns the thing in-app, so counting
// them here reports the same event twice.
//
// `dm_received` (migration 181) is the case that forced this: every DM
// inserts a notifications row AND increments the Messages unread count,
// so one message lit both header badges, and NotificationBell's
// `count + dmUnread` handed the PWA Badging API a 2 for it. The row still
// has to exist — it is what delivers the DM push — it just must not be
// counted or listed by the surface that doesn't own it.
//
// The panel never knew about the type either: it is absent from
// ALL_KNOWN_TYPES in NotificationPanel.jsx, so each row also reported an
// "Unmapped notification types" error to Sentry. Filtering at the data
// layer fixes the count, the list and that report in one place.
//
// Add a type here ONLY when another surface is the canonical one. If a
// type belongs in the bell, teach NotificationPanel about it instead.
export const PUSH_ONLY_TYPES = ['dm_received'];

const PUSH_ONLY_FILTER = `(${PUSH_ONLY_TYPES.join(',')})`;

// ── Same-day reminders ───────────────────────────────────────────────────
// These say "today" or "at midnight" in their own text: "3 quests left
// today", "your streak ends at midnight". Once the user's day has rolled
// over they describe a deadline that has already passed, and nothing can be
// done about them. They used to keep the bell lit indefinitely anyway, so
// someone who never opened the panel carried yesterday's "quests left" into
// every following day (88 of 126 quest_expiry_warning rows in production
// were still unread on 2026-09-28).
//
// They are excluded from the COUNT only. The panel still lists them, and
// the exit flush still marks them read, because they are true history.
export const SAME_DAY_TYPES = ['quest_expiry_warning', 'streak_break_warning'];

/** Start of the viewer's local day, as an ISO instant. */
export function startOfLocalDayIso(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const DEFAULT_LIMIT = 50;

// This module deliberately does NOT use safeSelect, and it used to carry
// an unused import of it that made the absence look like an oversight.
// It has nothing to strip: the read below is `select('*')`, unreadCount
// asks for the primary key only, and the third select returns an
// inserted row. safeSelect protects an explicit column LIST from a
// pending migration; none of these name one.

/** List the user's recent notifications, newest first. */
export async function listForUser(user, limit = DEFAULT_LIMIT) {
  if (!user?.id) return [];
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .not('type', 'in', PUSH_ONLY_FILTER)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[notifications] list failed:', error);
    return [];
  }
  return data ?? [];
}

// The bell reads at most this many unread rows to classify them. Past it
// the badge would read "9+" anyway; `total` still comes from an exact count.
const SUMMARY_SCAN = 200;


/**
 * Name and picture for the people behind notification rows, keyed the way
 * `actorKey()` in `@/lib/notificationActor` keys them. Reads
 * `public_profiles` by user id (and by username for the two legacy types
 * that store only a name), never by email. A failure returns an empty map:
 * the rows fall back to their type icon rather than failing to render.
 */
export async function listActorProfiles({ ids = [], usernames = [] } = {}) {
  const out = {};
  const put = (p) => {
    if (!p) return;
    if (p.id) out[`id:${p.id}`] = p;
    if (p.username) out[`u:${p.username}`] = p;
  };
  const reads = [];
  if (ids.length) {
    reads.push(supabase.from('public_profiles')
      .select('id, username, avatar_url').in('id', ids));
  }
  if (usernames.length) {
    reads.push(supabase.from('public_profiles')
      .select('id, username, avatar_url').in('username', usernames));
  }
  const results = await Promise.all(reads);
  for (const { data, error } of results) {
    if (error) { console.warn('[notifications] actor lookup failed:', error); continue; }
    (data || []).forEach(put);
  }
  return out;
}

/**
 * What the bell shows. `total` is every unread row the bell owns; `people`
 * is the subset another person caused (a follow, a gift, a duel), which is
 * the only thing the badge puts a NUMBER on. When `people` is 0 and `total`
 * is not, the bell shows a plain dot: the app reminding you of something is
 * worth a mark, not a count (Kegan, 2026-09-28, option C).
 */
export async function unreadSummary(user) {
  const none = { total: 0, people: 0 };
  if (!user?.id) return none;
  const { data, count, error } = await supabase
    .from('notifications')
    .select('type', { count: 'exact' })
    .eq('user_id', user.id)
    .eq('is_read', false)
    .not('type', 'in', PUSH_ONLY_FILTER)
    // A same-day reminder counts only while its day is still running.
    .or(`type.not.in.(${SAME_DAY_TYPES.join(',')}),created_at.gte.${startOfLocalDayIso()}`)
    .limit(SUMMARY_SCAN);
  if (error) return none;
  const rows = data ?? [];
  return {
    total: count ?? rows.length,
    people: rows.filter(r => isFromPeople(r.type)).length,
  };
}

/** Mark a single notification read. Returns `{ ok }` so the caller can
 * distinguish success from silent failure if needed. (Audit 17 #F35.) */
export async function markRead(notificationId) {
  if (!notificationId) return { ok: false };
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId);
  if (error) {
    // Don't throw — callers fire-and-forget. Report so we notice
    // RLS denies or schema drift instead of seeing stale unread badges.
    import('@/lib/reportError').then(({ reportError }) => {
      reportError(error, { feature: 'notifications.markRead', level: 'warning' });
    }).catch(() => { /* reporter unavailable — best-effort */ });
    return { ok: false, error };
  }
  return { ok: true };
}

/** Mark all of the user's notifications as read. */
export async function markAllRead(user) {
  if (!user?.id) return;
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', user.id)
    .eq('is_read', false);
  if (error) {
    import('@/lib/reportError').then(({ reportError }) => {
      reportError(error, { feature: 'notifications.markAllRead', level: 'warning', userEmail: user.email });
    }).catch(() => { /* reporter unavailable — best-effort */ });
  }
}

/**
 * Delete a single notification. RLS policy "notifications: delete own"
 * (migration 039) restricts this to the recipient's own rows, so a
 * forged id from another user is silently no-op'd by the server.
 */
export async function deleteNotification(notificationId) {
  if (!notificationId) return { ok: false, reason: 'no_id' };
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', notificationId);
  if (error) {
    console.warn('[notifications] delete failed:', error);
    return { ok: false, error };
  }
  return { ok: true };
}

/** Delete every notification for the given user. Used by the "Clear all" action. */
export async function deleteAllForUser(user) {
  if (!user?.id) return { ok: false, reason: 'no_user' };
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('user_id', user.id);
  if (error) {
    console.warn('[notifications] delete-all failed:', error);
    return { ok: false, error };
  }
  return { ok: true };
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
    // Server-side validated cross-user dispatch ONLY. Mig 026 is in
    // production; the old "fall through to a direct INSERT on RPC
    // missing" branch was a latent phishing surface — any client
    // could write a notification row attributed to themselves on
    // arbitrary recipients on a pre-026 host. With 026 universally
    // deployed the fallback is dead-weight + attack surface. Refuse
    // cross-user without the RPC. (Audit 17 #T4.)
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
      console.warn('[notifications] cross-user RPC failed:', error);
    } catch (err) {
      console.warn('[notifications] cross-user RPC threw:', err);
    }
    return null;
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

// ── i18n helpers ──────────────────────────────────────────────────────────────
//
// `tr(t, key, fallback, vars?)` mirrors tFallback semantics:
//   - if `t` isn't provided OR the key resolves to itself (missing
//     translation), substitute `{name}` placeholders in the English
//     fallback string and return it
//   - otherwise return the localized result from `t(key, vars)`
//
// Call sites pass `t` from useLanguage. Background callers that don't
// have access to a React context can omit `t` and accept English
// strings.

function formatFallback(template, vars) {
  if (!vars) return template;
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return out;
}

function tr(t, key, fallback, vars) {
  if (!t) return formatFallback(fallback, vars);
  try {
    const result = t(key, vars);
    if (result === key) return formatFallback(fallback, vars);
    return result;
  } catch {
    return formatFallback(fallback, vars);
  }
}

// ── Helpers per event type ────────────────────────────────────────────────────
// All helpers accept an optional `t` from useLanguage; if missing,
// strings fall back to English. The translation lookup is read-time;
// the result is stored at write-time, so changing language later won't
// retranslate existing rows (see file-level i18n NOTE).

export async function notifyQuestClaimed({ user, questLabel, coinsAwarded, t }) {
  return _create({
    userId:    user.id,
    userEmail: user.email,
    type:      NOTIFICATION_TYPES.QUEST_CLAIMED,
    title:     tr(t, 'notifications.row.quest_claimed.title',
                  '🪙 +{coins} coins · {quest}',
                  { coins: coinsAwarded, quest: questLabel }),
    body:      tr(t, 'notifications.row.quest_claimed.body',
                  'Quest reward claimed.'),
    icon:      '🎯',
    linkUrl:   '/dashboard',
    metadata:  { questLabel, coinsAwarded },
  });
}

export async function notifyStreakMilestone({ user, kind, day, coinsAwarded, eliteCapsuleAwarded, t }) {
  // kind: 'login' | 'workout'
  const titleKey = kind === 'workout'
    ? 'notifications.row.streak_milestone.workout.title'
    : 'notifications.row.streak_milestone.login.title';
  const titleFallback = kind === 'workout'
    ? '🔥 Workout streak: Day {day}!'
    : '🔥 Login streak: Day {day}!';
  const bodyKey = eliteCapsuleAwarded
    ? 'notifications.row.streak_milestone.body_with_capsule'
    : 'notifications.row.streak_milestone.body';
  const bodyFallback = eliteCapsuleAwarded
    ? '+{coins} coins + Elite Capsule'
    : '+{coins} coins';
  return _create({
    userId:    user.id,
    userEmail: user.email,
    type:      NOTIFICATION_TYPES.STREAK_MILESTONE,
    title:     tr(t, titleKey, titleFallback, { day }),
    body:      tr(t, bodyKey, bodyFallback, { coins: coinsAwarded }),
    icon:      kind === 'workout' ? '💪' : '🔥',
    linkUrl:   '/dashboard',
    metadata:  { kind, day, coinsAwarded, eliteCapsuleAwarded: !!eliteCapsuleAwarded },
  });
}

export async function notifyLeagueResolution({ user, outcome, fromTier, toTier, coinsAwarded, capsuleAwarded, t }) {
  // outcome: 'promote' | 'demote' | 'stay'
  let type, title, body, icon;
  if (outcome === 'promote') {
    type  = NOTIFICATION_TYPES.LEAGUE_PROMOTED;
    title = tr(t, 'notifications.row.league_promoted.title',
              '⬆️ Promoted to {tier}!', { tier: toTier });
    body  = capsuleAwarded
      ? tr(t, 'notifications.row.league_promoted.body_with_capsule',
            '+{coins} coins + {capsule} capsule',
            { coins: coinsAwarded, capsule: capsuleAwarded })
      : tr(t, 'notifications.row.league_promoted.body',
            '+{coins} coins', { coins: coinsAwarded });
    icon  = '🏆';
  } else if (outcome === 'demote') {
    type  = NOTIFICATION_TYPES.LEAGUE_DEMOTED;
    title = tr(t, 'notifications.row.league_demoted.title',
              '⬇️ Demoted to {tier}', { tier: toTier });
    body  = tr(t, 'notifications.row.league_demoted.body',
              'Climb back next week!');
    icon  = '📉';
  } else {
    type  = NOTIFICATION_TYPES.LEAGUE_HELD;
    title = tr(t, 'notifications.row.league_held.title',
              'Held position in {tier}', { tier: fromTier });
    body  = coinsAwarded > 0
      ? tr(t, 'notifications.row.league_held.body_coins',
            '+{coins} coins', { coins: coinsAwarded })
      : tr(t, 'notifications.row.league_held.body_default',
            'Push for promotion next week.');
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

export async function notifyFriendPost({ recipient, posterName, postPreview, t }) {
  // crossUser=true routes through create_notification_for RPC — the RLS
  // policy on direct INSERT only allows user_id = auth.uid(). NOTE: the
  // RENDERED text uses the SENDER's t, not the recipient's; recipient-
  // language rendering would require a server-side text function.
  return _create({
    userId:    recipient.id || recipient.user_id,
    userEmail: recipient.email || recipient.user_email,
    type:      NOTIFICATION_TYPES.FRIEND_POST,
    title:     tr(t, 'notifications.row.friend_post.title',
                  '{name} posted', { name: posterName }),
    body:      postPreview?.slice(0, 100) || '',
    icon:      '✨',
    linkUrl:   '/hub',
    metadata:  { posterName },
    crossUser: true,
  });
}

export async function notifyFriendFollow({ recipientUserId, recipientEmail, followerName, t }) {
  return _create({
    userId:    recipientUserId,
    userEmail: recipientEmail,
    type:      NOTIFICATION_TYPES.FRIEND_FOLLOW,
    title:     tr(t, 'notifications.row.friend_follow.title',
                  '{name} followed you', { name: followerName }),
    body:      tr(t, 'notifications.row.friend_follow.body',
                  'Tap to view their profile.'),
    icon:      '👋',
    linkUrl:   '/hub',
    metadata:  { followerName },
    crossUser: true,
  });
}

export async function notifyPrSet({ user, prLabel, value, unit, t }) {
  return _create({
    userId:    user.id,
    userEmail: user.email,
    type:      NOTIFICATION_TYPES.PR_SET,
    title:     tr(t, 'notifications.row.pr_set.title',
                  '🏆 New {label} PR!', { label: prLabel }),
    body:      `${value}${unit ? ' ' + unit : ''}`,
    icon:      '⚡',
    linkUrl:   '/progress',
    metadata:  { prLabel, value, unit },
  });
}

export async function notifyCapsuleEarned({ user, capsuleType, reason, t }) {
  // Per-rarity localized label. The fallback table here mirrors the
  // English-only behavior of the previous implementation.
  const labelKeys = {
    standard: 'notifications.row.capsule.label.standard',
    premium:  'notifications.row.capsule.label.premium',
    elite:    'notifications.row.capsule.label.elite',
  };
  const labelFallbacks = {
    standard: 'Standard',
    premium:  'Premium',
    elite:    'Elite',
  };
  const labelKey      = labelKeys[capsuleType]      || 'notifications.row.capsule.label.mystery';
  const labelFallback = labelFallbacks[capsuleType] || 'Mystery';
  const label = tr(t, labelKey, labelFallback);
  return _create({
    userId:    user.id,
    userEmail: user.email,
    type:      NOTIFICATION_TYPES.CAPSULE_EARNED,
    title:     tr(t, 'notifications.row.capsule_earned.title',
                  `${CAPSULE_GLYPH.standard} {label} Capsule earned`, { label }),
    body:      reason || tr(t, 'notifications.row.capsule_earned.body_default',
                            'Open it from your bag.'),
    icon:      CAPSULE_GLYPH[capsuleType] || CAPSULE_GLYPH.standard,
    linkUrl:   '/hub',
    metadata:  { capsuleType, reason },
  });
}

// ── Cron-mirror helpers (rare manual fires) ───────────────────────────────────
// The three reminder types below are normally inserted by SQL cron jobs
// (migrations 035 + 037) with server-rendered text in the user's
// preferred_language. These JS helpers exist for ad-hoc/test fires from
// client code — e.g. an admin tool, or a "test push" button. They use
// the same key namespace, so passing `t` produces parity with the cron.

export async function notifyStreakBreakWarning({ user, workoutStreak, t }) {
  return _create({
    userId:    user.id,
    userEmail: user.email,
    type:      NOTIFICATION_TYPES.STREAK_BREAK_WARNING,
    title:     tr(t, 'notifications.row.streak_break_warning.title',
                  '🔥 {streak}-day streak at risk', { streak: workoutStreak }),
    body:      tr(t, 'notifications.row.streak_break_warning.body',
                  'Your streak ends at midnight. A quick workout keeps it alive.'),
    icon:      '🔥',
    linkUrl:   '/workout', // singular — `/workouts` is a 404 (audit 16 F34)
    metadata:  { workout_streak: workoutStreak },
  });
}

export async function notifyWelcomeBack({ user, t }) {
  return _create({
    userId:    user.id,
    userEmail: user.email,
    type:      NOTIFICATION_TYPES.WELCOME_BACK,
    title:     tr(t, 'notifications.row.welcome_back.title',
                  '👋 We miss you'),
    body:      tr(t, 'notifications.row.welcome_back.body',
                  'Your progress is waiting. Quick session today?'),
    icon:      '👋',
    linkUrl:   '/dashboard',
    metadata:  {},
  });
}

export async function notifyQuestExpiry({ user, remaining, t }) {
  return _create({
    userId:    user.id,
    userEmail: user.email,
    type:      NOTIFICATION_TYPES.QUEST_EXPIRY_WARNING,
    title:     tr(t, 'notifications.row.quest_expiry_warning.title',
                  '⏳ {remaining} quests left today', { remaining }),
    body:      tr(t, 'notifications.row.quest_expiry_warning.body',
                  "Quests reset at midnight. Don't miss the coins!"),
    icon:      '⏳',
    linkUrl:   '/dashboard',
    metadata:  { remaining },
  });
}
