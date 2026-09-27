// src/lib/data/referrals.js
//
// Client wrapper around the referral RPCs (migration 089). Three
// public functions:
//   • getMyReferralCode() — issues + returns the user's stable code
//   • claimReferral(code) — called once for newly-signed-up users
//   • getMyReferralStats() — { code, total_referrals, total_coins_earned }
//
// Plus URL-capture helpers for the acquisition flow:
//   • capturePendingReferralCode() — reads ?ref=… from the URL on
//     landing and stashes it in localStorage so it survives the
//     redirect through the auth provider.
//   • consumePendingReferralCode() — read-and-clear, used after the
//     user finishes signup.

import { supabase } from '@/api/supabaseClient';
import { track, EVENTS } from '@/lib/analytics';

const PENDING_KEY = 'flexyn.pendingReferralCode';

/** Issue or fetch the user's referral code. Returns null on failure. */
export async function getMyReferralCode() {
  try {
    const { data, error } = await supabase.rpc('get_my_referral_code');
    if (error) {
      if (error.code === '42883' || error.code === '42P01') return null;
      console.warn('[referrals] get_my_referral_code failed:', error);
      return null;
    }
    return data || null;
  } catch (err) {
    console.warn('[referrals] getMyReferralCode threw:', err?.message || err);
    return null;
  }
}

/**
 * Claim a referral code. Returns:
 *   { ok: true,  referrer_name, reward_coins, reward_capsule }
 *   { ok: false, reason }
 *
 * Reasons (when ok=false):
 *   • 'invalid_code'      — code wasn't 6 chars or was missing
 *   • 'already_claimed'   — referee already used a code
 *   • 'code_not_found'    — no user has that code
 *   • 'self_referral'     — caller's own code
 *   • 'rpc_error'         — anything else
 */
export async function claimReferral(code) {
  if (!code) return { ok: false, reason: 'invalid_code' };
  try {
    const { data, error } = await supabase.rpc('claim_referral', { p_code: code });
    if (error) {
      if (error.code === '42883' || error.code === '42P01') return null;
      console.warn('[referrals] claim_referral failed:', error);
      return { ok: false, reason: 'rpc_error' };
    }
    if (data?.ok) track(EVENTS.REFERRAL_CLAIMED);
    return data ?? { ok: false, reason: 'unknown' };
  } catch (err) {
    console.warn('[referrals] claimReferral threw:', err?.message || err);
    return { ok: false, reason: 'network' };
  }
}

/** Stats for the ReferralCard UI. */
export async function getMyReferralStats() {
  try {
    const { data, error } = await supabase.rpc('my_referral_stats');
    if (error) {
      if (error.code === '42883' || error.code === '42P01') return null;
      console.warn('[referrals] my_referral_stats failed:', error);
      return null;
    }
    return data || null;
  } catch (err) {
    console.warn('[referrals] getMyReferralStats threw:', err?.message || err);
    return null;
  }
}

// ── URL-capture helpers ─────────────────────────────────────────────────
//
// The acquisition flow is:
//   1. User A taps Share → opens https://flexyn.app/?ref=ABC123
//   2. User B lands on the app. capturePendingReferralCode() reads
//      ?ref= and writes it to localStorage. The query param is then
//      cleaned from the URL so a refresh doesn't re-trigger.
//   3. User B signs up. AuthContext (or the onboarding flow) calls
//      consumePendingReferralCode() and passes the value to
//      claimReferral().
//
// localStorage (not sessionStorage) because the signup flow may
// redirect through an OAuth provider that loses tab-level state.

/**
 * Read ?ref= from the URL, stash it in localStorage, and clean the
 * query string so a page refresh doesn't redundantly re-process it.
 * No-op when there's no ref param.
 */
/** True for a string shaped like a referral code: six characters from
 *  generate_referral_code()'s alphabet, ABCDEFGHJKLMNPQRSTUVWXYZ23456789
 *  (no I, O, 0 or 1). Case-insensitive.
 *
 *  This used to be /^[A-Z2-9]{6}$/, which excludes 0 and 1 but NOT I and O,
 *  so marketing tags like ?ref=reddit, ?ref=tiktok and ?ref=shorts were
 *  stashed as referral codes. */
export const REFERRAL_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
export function isReferralCodeShape(value) {
  return REFERRAL_CODE_RE.test(String(value || '').trim().toUpperCase());
}

export function capturePendingReferralCode() {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    const ref = url.searchParams.get('ref');
    if (!ref) return;
    // Exactly six characters, never a truncation. Marketing links reuse
    // ?ref= as a channel tag (?ref=alternativeto, ?ref=saashub), and slicing
    // those to six gave "ALTERN" and "SAASHU", which pass the alphabet check
    // and got stashed as referral codes nobody owns.
    const cleanedCode = ref.trim().toUpperCase();
    if (!isReferralCodeShape(cleanedCode)) return;
    localStorage.setItem(PENDING_KEY, cleanedCode);
    // Clean the URL so a refresh doesn't keep capturing.
    url.searchParams.delete('ref');
    const newPath = url.pathname + (url.search || '') + (url.hash || '');
    window.history.replaceState({}, '', newPath);
  } catch { /* best-effort */ }
}

/** Read-and-clear the stashed code. Returns null if none pending. */
export function consumePendingReferralCode() {
  try {
    const code = localStorage.getItem(PENDING_KEY);
    if (code) localStorage.removeItem(PENDING_KEY);
    return code || null;
  } catch { return null; }
}

/** Peek without consuming. Used by UIs that want to show "you came in via X". */
export function peekPendingReferralCode() {
  try { return localStorage.getItem(PENDING_KEY) || null; }
  catch { return null; }
}
