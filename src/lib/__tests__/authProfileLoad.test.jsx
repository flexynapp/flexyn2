// A failed user_profiles read must not look like a brand-new user.
// fetchProfile ignored the error and returned { id, email } alone, which has
// no onboarding flag, so App.jsx sent an onboarded user into Onboarding.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const maybeSingle = vi.fn();
let authCallback = null;

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    rpc: vi.fn(() => Promise.resolve({ error: null })),
    auth: {
      getSession: () => Promise.resolve({
        data: { session: { user: { id: 'u1', email: 'a@b.c' } } },
      }),
      onAuthStateChange: (cb) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  },
}));
vi.mock('@/lib/firstLaunch', () => ({ markReturningUser: vi.fn() }));
vi.mock('@/lib/pushCleanup', () => ({ unsubscribePushOnLogout: vi.fn() }));
vi.mock('@/lib/analytics', () => ({
  identify: vi.fn(), resetAnalytics: vi.fn(), track: vi.fn(), EVENTS: {},
}));
vi.mock('@/lib/native', () => ({ isNative: () => false }));
vi.mock('@/lib/i18n', () => ({ getTranslation: (_l, k) => k }));
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }));

import { AuthProvider, useAuth } from '../AuthContext';

function Probe() {
  const { user, isLoadingAuth } = useAuth();
  if (isLoadingAuth) return <p>loading</p>;
  return (
    <p data-testid="user">
      {user?.profileLoadFailed ? 'failed' : (user?.username || 'no-username')}
    </p>
  );
}

const show = async () => {
  render(<AuthProvider><Probe /></AuthProvider>);
  return screen.findByTestId('user');
};

describe('AuthProvider profile load', () => {
  beforeEach(() => {
    maybeSingle.mockReset();
    authCallback = null;
  });

  it('merges the profile when the read succeeds', async () => {
    maybeSingle.mockResolvedValue({ data: { username: 'kegan' }, error: null });
    expect((await show()).textContent).toBe('kegan');
  });

  it('treats a missing row as a new user, not a failure', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await show()).textContent).toBe('no-username');
  });

  it('retries once, then flags the failure instead of a bare user', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'network' } });
    expect((await show()).textContent).toBe('failed');
    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });

  it('recovers on the retry', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: { message: 'blip' } })
      .mockResolvedValue({ data: { username: 'kegan' }, error: null });
    expect((await show()).textContent).toBe('kegan');
  });

  it('keeps an already loaded profile when a later refresh fails', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { username: 'kegan' }, error: null });
    expect((await show()).textContent).toBe('kegan');
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'network' } });
    await act(async () => {
      authCallback('TOKEN_REFRESHED', { user: { id: 'u1', email: 'a@b.c' } });
      await new Promise(r => setTimeout(r, 20));
    });
    await waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(3));
    expect(screen.getByTestId('user').textContent).toBe('kegan');
  });
});
