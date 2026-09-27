// src/lib/data/accountLink.js
//
// Turning a guest into a real account without losing anything.
//
// A guest is a Supabase anonymous user. Both paths below keep the SAME user
// id, so every workout, coin and trophy the guest earned stays theirs:
//
//   • a provider (Google, Apple when enabled) is LINKED to the account with
//     linkIdentity. That needs "Manual linking" switched on in the Supabase
//     Auth settings; without it GoTrue answers `manual_linking_disabled`, and
//     the caller says so rather than failing silently.
//   • an email is attached with updateUser. GoTrue sends a confirmation
//     link, and the account stops being anonymous once it is opened.
//
// Signing in to a provider instead would start a brand new account and strand
// the guest's history, which is why neither path uses signInWithOAuth.

import { supabase } from '@/api/supabaseClient';
import { isNative } from '@/lib/native';

/**
 * Link a provider to the signed-in guest. On the web the page leaves for the
 * provider; on native the system browser opens and the deep link finishes it.
 *
 * @param {'google'|'apple'} provider
 * @param {string} [returnPath] where the web redirect lands, e.g. '/workout'
 */
export async function linkGuestToProvider(provider, returnPath = '/') {
  if (isNative()) {
    const { startNativeLink } = await import('@/lib/nativeAuth');
    return startNativeLink(provider);
  }
  const path = returnPath.startsWith('/') ? returnPath : `/${returnPath}`;
  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: { redirectTo: `${window.location.origin}${path}` },
  });
  if (error) throw error;
  return data;
}

/**
 * Attach an email to the signed-in guest. Resolves once the confirmation
 * email is sent; the account upgrades when the link in it is opened.
 */
export async function linkGuestToEmail(email) {
  const { error } = await supabase.auth.updateUser({ email: email.trim() });
  if (error) throw error;
  return { status: 'confirmation_sent' };
}

/** True when an error means manual linking is off in the project settings. */
export function isLinkingDisabled(err) {
  const code = err?.code || err?.error_code || '';
  const msg = String(err?.message || '').toLowerCase();
  return code === 'manual_linking_disabled' || msg.includes('manual linking');
}

/** True when the provider identity already belongs to another account. */
export function isIdentityTaken(err) {
  const code = err?.code || err?.error_code || '';
  return code === 'identity_already_exists' || code === 'email_exists';
}
