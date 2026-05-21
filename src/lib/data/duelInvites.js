// src/lib/data/duelInvites.js
// External duel invites — shareable links that let an existing user
// challenge anyone (including non-Flexyn users) via URL. Backed by
// migration 072's pending_duel_invites table + three RPCs.

import { supabase } from '@/api/supabaseClient';

/**
 * Create a shareable duel-invite token. Returns { token, expires_at, ... }
 * for the caller to build a URL like `/duel-invite/<token>` and share.
 *
 * @param {object} opts
 * @param {'open'|'mirror'|'exercise'} [opts.duelType='open']
 * @param {object|null} [opts.sessionTemplate]  mirror-duel exercise list
 * @param {string|null} [opts.targetExerciseId] exercise-duel focus
 * @param {number} [opts.windowHours=24]        duration after accept
 */
export async function createInviteLink({
  duelType = 'open',
  sessionTemplate = null,
  targetExerciseId = null,
  windowHours = 24,
} = {}) {
  const { data, error } = await supabase.rpc('create_pending_duel_invite', {
    p_duel_type:          duelType,
    p_session_template:   sessionTemplate,
    p_target_exercise_id: targetExerciseId,
    p_window_hours:       windowHours,
  });
  if (error) throw error;
  return data; // { id, token, expires_at, duel_type, window_hours }
}

/**
 * Anon-safe lookup. The landing page calls this BEFORE the recipient
 * signs in to show challenger name/avatar/type. Returns null when the
 * token doesn't resolve (invalid, deleted) — the caller surfaces the
 * "invite not found" UI in that case.
 */
export async function getInvitePublic(token) {
  if (!token) return null;
  const { data, error } = await supabase.rpc('get_pending_duel_invite_public', {
    p_token: token,
  });
  if (error) {
    console.warn('[duelInvites] public lookup failed:', error);
    return null;
  }
  return data; // { id, challenger_username, challenger_avatar_url, duel_type,
                //   window_hours, expires_at, is_claimed, is_expired } or null
}

/**
 * Accept the invite. Caller must be authenticated and NOT the
 * challenger. The RPC atomically creates the real duel + marks the
 * invite claimed. Returns { duel_id, already_claimed_by_you }.
 */
export async function claimInvite(token) {
  const { data, error } = await supabase.rpc('claim_pending_duel_invite', {
    p_token: token,
  });
  if (error) throw error;
  return data;
}

/**
 * Compose the shareable URL for a given token. Uses window.location.origin
 * so it works in dev, staging, and production without env config.
 */
export function buildInviteUrl(token) {
  if (!token) return '';
  if (typeof window === 'undefined') return `/duel-invite/${token}`;
  return `${window.location.origin}/duel-invite/${token}`;
}

// localStorage key used to stash a token across the sign-in flow.
// The landing page sets it when an anonymous visitor lands; after
// they complete onboarding, the App reads it and routes them back
// to the landing page so they can accept with their new account.
//
// The value is now a JSON envelope { token, stashedAt } instead of
// the bare token string. stashedAt gates a 24-hour TTL on read so
// a stuck-onboarding flow (user lands, bounces, never signs up) can't
// inherit the token forever on a shared browser. If the persisted
// value is the legacy bare-string form (from before this change),
// readPendingToken returns it as-is and lets it expire next session
// when the user re-lands.
export const PENDING_INVITE_LS_KEY = 'fn-pending-duel-invite-token';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function stashPendingToken(token) {
  if (!token) return;
  try {
    const envelope = { token, stashedAt: Date.now() };
    localStorage.setItem(PENDING_INVITE_LS_KEY, JSON.stringify(envelope));
  } catch {}
}

export function readPendingToken() {
  try {
    const raw = localStorage.getItem(PENDING_INVITE_LS_KEY);
    if (!raw) return null;
    // Modern envelope form. Verify shape + TTL.
    if (raw.startsWith('{')) {
      const env = JSON.parse(raw);
      if (!env?.token) return null;
      if (Number.isFinite(env.stashedAt) && (Date.now() - env.stashedAt) > TOKEN_TTL_MS) {
        clearPendingToken();
        return null;
      }
      return env.token;
    }
    // Legacy bare-string form — no timestamp. Treat as still valid
    // for this session; next stash will upgrade it to the envelope.
    return raw;
  } catch {
    return null;
  }
}

export function clearPendingToken() {
  try { localStorage.removeItem(PENDING_INVITE_LS_KEY); } catch {}
}
