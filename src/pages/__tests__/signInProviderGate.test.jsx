// The sign-in screen must not offer a provider the project has not enabled.
//
// Production, 2026-08-30: `apple` was false on the project and the button was
// rendered anyway. supabase-js does not validate the provider — it sets
// window.location.href to /auth/v1/authorize — so the tap navigated the user
// out of the app onto a raw JSON error page, on the first screen a new user
// sees. The try/catch in handleProvider could never have caught it: the page
// leaves before the promise settles.
//
// So these assert the RENDER, not the click. A button that is not there
// cannot dead-end, and no amount of error handling on the click can fix a
// provider the backend refuses.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});
vi.mock('@/api/db', () => ({
  db: { auth: { signInWithMagicLink: vi.fn(), signInAsGuest: vi.fn(), signInWithProvider: vi.fn() } },
}));
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const fetchEnabledProviders = vi.fn();
const cachedProviders = vi.fn();
vi.mock('@/lib/authProviders', () => ({
  RENDERABLE_PROVIDERS: ['google', 'apple'],
  fetchEnabledProviders: (...a) => fetchEnabledProviders(...a),
  cachedProviders: (...a) => cachedProviders(...a),
}));

const { default: SignInToContinue } = await import('../SignInToContinue');

const google = () => screen.queryByRole('button', { name: /continue with google/i });
const apple = () => screen.queryByRole('button', { name: /continue with apple/i });

describe('SignInToContinue — provider gate', () => {
  beforeEach(() => {
    fetchEnabledProviders.mockReset();
    cachedProviders.mockReset().mockReturnValue(null);
  });

  it('renders only the providers the project reports — the production case', async () => {
    // Exactly what /auth/v1/settings returns for this project: google on,
    // apple off. This is the assertion the shipped bug would have failed.
    fetchEnabledProviders.mockResolvedValue(['google']);

    render(<SignInToContinue />);

    expect(await screen.findByRole('button', { name: /continue with google/i })).toBeTruthy();
    expect(apple()).toBeNull();
  });

  it('renders both when both are enabled', async () => {
    fetchEnabledProviders.mockResolvedValue(['google', 'apple']);

    render(<SignInToContinue />);

    expect(await screen.findByRole('button', { name: /continue with apple/i })).toBeTruthy();
    expect(google()).toBeTruthy();
  });

  it('FAILS CLOSED: an unanswerable probe shows no provider, and magic link still works', async () => {
    // Widening the button set on a failed probe is how the dead end comes
    // back. Email and anonymous are always enabled on this project, so
    // dropping to them is a sign-in path that works.
    fetchEnabledProviders.mockRejectedValue(new Error('offline'));

    render(<SignInToContinue />);
    await screen.findByPlaceholderText('you@example.com');

    expect(google()).toBeNull();
    expect(apple()).toBeNull();
    expect(screen.getByRole('button', { name: /send magic link/i })).toBeTruthy();
  });

  it('paints the cached answer first, so the buttons do not pop in', async () => {
    cachedProviders.mockReturnValue(['google']);
    fetchEnabledProviders.mockResolvedValue(['google']);

    render(<SignInToContinue />);

    // Present on the FIRST paint, before the probe resolves.
    expect(google()).toBeTruthy();
    expect(apple()).toBeNull();
  });

  it('a stale cache cannot keep a disabled provider on screen', async () => {
    // Apple was cached while it was on; the project has since turned it off.
    // The probe is authoritative and has to win, or the cache becomes a
    // second place the dead button can live.
    cachedProviders.mockReturnValue(['google', 'apple']);
    fetchEnabledProviders.mockResolvedValue(['google']);

    render(<SignInToContinue />);

    expect(apple()).toBeTruthy();          // first paint, from cache
    await vi.waitFor(() => expect(apple()).toBeNull());  // probe corrects it
    expect(google()).toBeTruthy();
  });
});
