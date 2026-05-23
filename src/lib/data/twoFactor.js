// src/lib/data/twoFactor.js
//
// Thin wrappers around supabase.auth.mfa.* for the 2FA Settings panel.
// Supabase ships MFA as a first-class feature; we just need a small
// surface to enroll a TOTP factor, verify the QR code, and disable it
// later. No DB migration needed — Supabase manages factors internally.
//
// Each wrapper returns a normalized envelope so the UI can branch on
// shape ({ ok, ...payload } / { ok: false, reason, message }) instead
// of switching on raw error codes.

import { supabase } from '@/api/supabaseClient';

/**
 * List the user's currently-enrolled MFA factors. Returns { totp: [...] }
 * shape on success.
 */
export async function listFactors() {
  try {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) return { ok: false, reason: 'rpc_error', message: error.message };
    return { ok: true, totp: data?.totp || [], all: data?.all || [] };
  } catch (err) {
    return { ok: false, reason: 'network', message: err?.message };
  }
}

/**
 * Begin enrollment for a TOTP factor. Returns the QR-code URI + the
 * factor id (needed by verifyEnrollment below).
 */
export async function enrollTotp(friendlyName = 'Flexyn') {
  try {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType:    'totp',
      friendlyName,
    });
    if (error) return { ok: false, reason: 'rpc_error', message: error.message };
    return {
      ok: true,
      factorId: data?.id,
      qr:       data?.totp?.qr_code || null,
      secret:   data?.totp?.secret  || null,
      uri:      data?.totp?.uri     || null,
    };
  } catch (err) {
    return { ok: false, reason: 'network', message: err?.message };
  }
}

/**
 * Verify the 6-digit code the user read from their authenticator app.
 * On success the factor becomes active and is counted by listFactors.
 */
export async function verifyEnrollment({ factorId, code }) {
  if (!factorId || !code) return { ok: false, reason: 'invalid_args' };
  try {
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error) return { ok: false, reason: 'rpc_error', message: challenge.error.message };
    const verify = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data?.id,
      code,
    });
    if (verify.error) {
      const msg = verify.error.message || '';
      const reason = /invalid|incorrect/i.test(msg) ? 'invalid_code' : 'rpc_error';
      return { ok: false, reason, message: msg };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'network', message: err?.message };
  }
}

/** Disable / remove a previously-enrolled TOTP factor. */
export async function unenroll(factorId) {
  if (!factorId) return { ok: false, reason: 'invalid_args' };
  try {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) return { ok: false, reason: 'rpc_error', message: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'network', message: err?.message };
  }
}
