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
export const PENDING_INVITE_LS_KEY = 'fn-pending-duel-invite-token';

export function stashPendingToken(token) {
  if (!token) return;
  try { localStorage.setItem(PENDING_INVITE_LS_KEY, token); } catch {}
}

export function readPendingToken() {
  try { return localStorage.getItem(PENDING_INVITE_LS_KEY) || null; } catch { return null; }
}

export function clearPendingToken() {
  try { localStorage.removeItem(PENDING_INVITE_LS_KEY); } catch {}
}
