// The web sign-in path must be byte-for-byte what it was before the native
// app existed, and the native path must never fall through to it. These pin
// both halves at the three places auth is started from db.js, plus the
// Supabase client options that decide the flow type.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const native = vi.hoisted(() => ({ value: false }));
vi.mock('@/lib/native', () => ({
  isNative: () => native.value,
  NATIVE_AUTH_CALLBACK: 'app.flexyn://auth-callback',
}));

const nativeSignIn = vi.hoisted(() => vi.fn(async () => ({ status: 'browser_opened' })));
vi.mock('@/lib/nativeAuth', () => ({ nativeSignIn }));

const auth = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
  signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
  onAuthStateChange: vi.fn(),
  getSession: vi.fn(async () => ({ data: { session: null } })),
  getUser: vi.fn(async () => ({ data: { user: null } })),
}));
vi.mock('@/api/supabaseClient', () => ({ supabase: { auth } }));
vi.mock('@/lib/pushCleanup', () => ({ unsubscribePushOnLogout: vi.fn() }));
vi.mock('@/lib/data/users', () => ({ selectProfiles: vi.fn() }));

const { db } = await import('../db');

beforeEach(() => {
  vi.clearAllMocks();
  native.value = false;
});

describe('signInWithProvider', () => {
  it('web: redirects the page through Supabase exactly as before', async () => {
    await db.auth.signInWithProvider('google', '/');
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` },
    });
    expect(nativeSignIn).not.toHaveBeenCalled();
  });

  it('web: Apple is the same redirect', async () => {
    await db.auth.signInWithProvider('apple');
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'apple',
      options: { redirectTo: window.location.origin },
    });
  });

  it('native: hands off to the system-browser / Apple-sheet flow', async () => {
    native.value = true;
    const res = await db.auth.signInWithProvider('google', '/');
    expect(nativeSignIn).toHaveBeenCalledWith('google');
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
    expect(res).toEqual({ status: 'browser_opened' });
  });

  it('native: redirectToLogin (legacy call sites) takes the same route', async () => {
    native.value = true;
    await db.auth.redirectToLogin();
    expect(nativeSignIn).toHaveBeenCalledWith('google');
  });
});

describe('signInWithMagicLink redirect target', () => {
  it('web: the page origin', async () => {
    await db.auth.signInWithMagicLink('a@example.com', '/');
    expect(auth.signInWithOtp.mock.calls[0][0].options.emailRedirectTo).toBe(`${window.location.origin}/`);
  });

  it('native: the app deep link, never capacitor://localhost', async () => {
    native.value = true;
    await db.auth.signInWithMagicLink('a@example.com', '/');
    expect(auth.signInWithOtp.mock.calls[0][0].options.emailRedirectTo).toBe('app.flexyn://auth-callback');
  });
});
