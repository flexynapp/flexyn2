// Native sign-in: system-browser OAuth, the deep-link return, and Sign in
// with Apple. Capacitor and Supabase are mocked; what is under test is the
// SEQUENCE — which URL goes to which API, and what happens when the OS
// delivers a callback twice or the user backs out.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const cap = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
  getPlatform: vi.fn(() => 'ios'),
  appleAuthorize: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: cap.isNativePlatform, getPlatform: cap.getPlatform },
  registerPlugin: vi.fn(() => ({ authorize: cap.appleAuthorize })),
}));

const browser = vi.hoisted(() => ({ open: vi.fn(async () => {}), close: vi.fn(async () => {}) }));
vi.mock('@capacitor/browser', () => ({ Browser: browser }));

const app = vi.hoisted(() => {
  const listeners = [];
  return {
    listeners,
    addListener: vi.fn(async (event, fn) => {
      listeners.push({ event, fn });
      return { remove: vi.fn() };
    }),
    getLaunchUrl: vi.fn(async () => undefined),
  };
});
vi.mock('@capacitor/app', () => ({ App: app }));

const auth = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  setSession: vi.fn(),
  signInWithIdToken: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock('@/api/supabaseClient', () => ({ supabase: { auth } }));

import {
  parseAuthCallback,
  completeAuthFromUrl,
  initNativeAuthListener,
  startNativeOAuth,
  signInWithAppleNative,
  nativeSignIn,
  sha256Hex,
  randomNonce,
  _resetHandledCodesForTest,
} from '@/lib/nativeAuth';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  app.listeners.length = 0;
  _resetHandledCodesForTest();
  cap.isNativePlatform.mockReturnValue(true);
  cap.getPlatform.mockReturnValue('ios');
  auth.signInWithOAuth.mockResolvedValue({ data: { url: 'https://x.supabase.co/auth/v1/authorize?provider=google' }, error: null });
  auth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  auth.setSession.mockResolvedValue({ data: {}, error: null });
  auth.signInWithIdToken.mockResolvedValue({ data: {}, error: null });
  auth.updateUser.mockResolvedValue({ data: {}, error: null });
  app.getLaunchUrl.mockResolvedValue(undefined);
});

describe('parseAuthCallback', () => {
  it('reads a PKCE code from the query', () => {
    expect(parseAuthCallback('app.flexyn://auth-callback?code=abc123')).toEqual({ code: 'abc123' });
  });

  it('reads implicit tokens from the fragment', () => {
    expect(parseAuthCallback('app.flexyn://auth-callback#access_token=AT&refresh_token=RT&type=magiclink'))
      .toEqual({ accessToken: 'AT', refreshToken: 'RT' });
  });

  it('reads a GoTrue error from either half', () => {
    expect(parseAuthCallback('app.flexyn://auth-callback?error=access_denied&error_description=User+denied'))
      .toEqual({ error: 'access_denied', errorDescription: 'User denied' });
    expect(parseAuthCallback('app.flexyn://auth-callback#error=server_error'))
      .toEqual({ error: 'server_error' });
  });

  it('ignores deep links that are not the auth callback', () => {
    expect(parseAuthCallback('app.flexyn://gym/123')).toBeNull();
    expect(parseAuthCallback('https://flexyn.netlify.app/?code=abc')).toBeNull();
    expect(parseAuthCallback('app.flexyn://auth-callbackish?code=abc')).toBeNull();
    expect(parseAuthCallback(undefined)).toBeNull();
  });
});

describe('completeAuthFromUrl', () => {
  it('exchanges a code for a session and closes the browser', async () => {
    const res = await completeAuthFromUrl('app.flexyn://auth-callback?code=c1');
    expect(res).toEqual({ handled: true, ok: true });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('c1');
    expect(browser.close).toHaveBeenCalled();
  });

  it('exchanges a code only once when the OS delivers the URL twice', async () => {
    await completeAuthFromUrl('app.flexyn://auth-callback?code=c2');
    const second = await completeAuthFromUrl('app.flexyn://auth-callback?code=c2');
    expect(second).toEqual({ handled: true, ok: true });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it('sets the session from implicit tokens', async () => {
    const res = await completeAuthFromUrl('app.flexyn://auth-callback#access_token=AT&refresh_token=RT');
    expect(res.ok).toBe(true);
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'AT', refresh_token: 'RT' });
  });

  it('reports a provider error without exchanging anything', async () => {
    const res = await completeAuthFromUrl('app.flexyn://auth-callback?error=access_denied&error_description=Nope');
    expect(res).toEqual({ handled: true, ok: false, error: 'Nope' });
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('reports a failed exchange', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: null, error: { message: 'invalid flow state' } });
    const res = await completeAuthFromUrl('app.flexyn://auth-callback?code=bad');
    expect(res).toEqual({ handled: true, ok: false, error: 'invalid flow state' });
  });

  it('leaves unrelated URLs alone, browser included', async () => {
    const res = await completeAuthFromUrl('app.flexyn://something-else');
    expect(res).toEqual({ handled: false });
    expect(browser.close).not.toHaveBeenCalled();
  });

  it('still succeeds when the browser cannot be closed (Android Custom Tabs)', async () => {
    browser.close.mockRejectedValueOnce(new Error('not implemented'));
    const res = await completeAuthFromUrl('app.flexyn://auth-callback?code=c3');
    expect(res.ok).toBe(true);
  });
});

describe('initNativeAuthListener', () => {
  it('handles a callback delivered while running', async () => {
    const onError = vi.fn();
    const stop = initNativeAuthListener({ onError });
    await flush(); await flush();
    const listener = app.listeners.find((l) => l.event === 'appUrlOpen');
    expect(listener).toBeTruthy();
    await listener.fn({ url: 'app.flexyn://auth-callback?code=live' });
    await flush();
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('live');
    expect(onError).not.toHaveBeenCalled();
    stop();
  });

  it('drains the launch URL after a cold start', async () => {
    app.getLaunchUrl.mockResolvedValue({ url: 'app.flexyn://auth-callback?code=cold' });
    const stop = initNativeAuthListener();
    await flush(); await flush(); await flush();
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('cold');
    stop();
  });

  it('surfaces a failed callback through onError', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: null, error: { message: 'expired' } });
    const onError = vi.fn();
    const stop = initNativeAuthListener({ onError });
    await flush(); await flush();
    await app.listeners[0].fn({ url: 'app.flexyn://auth-callback?code=old' });
    await flush();
    expect(onError).toHaveBeenCalledWith('expired');
    stop();
  });

  it('does not report unrelated deep links as errors', async () => {
    const onError = vi.fn();
    const stop = initNativeAuthListener({ onError });
    await flush(); await flush();
    await app.listeners[0].fn({ url: 'app.flexyn://gym/1' });
    await flush();
    expect(onError).not.toHaveBeenCalled();
    stop();
  });
});

describe('startNativeOAuth', () => {
  it('asks Supabase for the URL without redirecting, and opens it in the system browser', async () => {
    const res = await startNativeOAuth('google');
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'app.flexyn://auth-callback', skipBrowserRedirect: true },
    });
    expect(browser.open).toHaveBeenCalledWith({ url: 'https://x.supabase.co/auth/v1/authorize?provider=google' });
    expect(res).toEqual({ status: 'browser_opened' });
  });

  it('throws rather than opening a browser when Supabase refuses', async () => {
    auth.signInWithOAuth.mockResolvedValue({ data: null, error: new Error('provider is not enabled') });
    await expect(startNativeOAuth('apple')).rejects.toThrow('provider is not enabled');
    expect(browser.open).not.toHaveBeenCalled();
  });
});

describe('Sign in with Apple (iOS)', () => {
  it('sends Apple the SHA-256 of the nonce and Supabase the raw nonce', async () => {
    cap.appleAuthorize.mockResolvedValue({ identityToken: 'id.token.jwt' });
    const res = await signInWithAppleNative();
    expect(res).toEqual({ status: 'signed_in' });

    const hashed = cap.appleAuthorize.mock.calls[0][0].nonce;
    const call = auth.signInWithIdToken.mock.calls[0][0];
    expect(call.provider).toBe('apple');
    expect(call.token).toBe('id.token.jwt');
    expect(call.nonce).not.toBe(hashed);
    expect(await sha256Hex(call.nonce)).toBe(hashed);
  });

  it('treats a dismissed sheet as a cancel, not an error', async () => {
    cap.appleAuthorize.mockRejectedValue(Object.assign(new Error('canceled'), { code: 'CANCELED' }));
    await expect(signInWithAppleNative()).resolves.toEqual({ status: 'cancelled' });
    expect(auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('propagates a real failure', async () => {
    cap.appleAuthorize.mockRejectedValue(Object.assign(new Error('boom'), { code: 'FAILED' }));
    await expect(signInWithAppleNative()).rejects.toThrow('boom');
  });

  it('keeps the name Apple only sends once', async () => {
    cap.appleAuthorize.mockResolvedValue({ identityToken: 't', givenName: 'Ada', familyName: 'Lovelace' });
    await signInWithAppleNative();
    expect(auth.updateUser).toHaveBeenCalledWith({
      data: { full_name: 'Ada Lovelace', given_name: 'Ada', family_name: 'Lovelace' },
    });
  });

  it('does not touch the user when Apple sent no name', async () => {
    cap.appleAuthorize.mockResolvedValue({ identityToken: 't' });
    await signInWithAppleNative();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('fails when Supabase rejects the token', async () => {
    cap.appleAuthorize.mockResolvedValue({ identityToken: 't' });
    auth.signInWithIdToken.mockResolvedValue({ data: null, error: new Error('Unsupported provider') });
    await expect(signInWithAppleNative()).rejects.toThrow('Unsupported provider');
  });
});

describe('nativeSignIn routing', () => {
  it('uses the native Apple sheet on iOS', async () => {
    cap.appleAuthorize.mockResolvedValue({ identityToken: 't' });
    await nativeSignIn('apple');
    expect(cap.appleAuthorize).toHaveBeenCalled();
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it('uses browser OAuth for Apple on Android', async () => {
    cap.getPlatform.mockReturnValue('android');
    await nativeSignIn('apple');
    expect(cap.appleAuthorize).not.toHaveBeenCalled();
    expect(auth.signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'apple' }));
  });

  it('uses browser OAuth for Google everywhere', async () => {
    await nativeSignIn('google');
    expect(auth.signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google' }));
  });
});

describe('nonce helpers', () => {
  it('produces 64 hex chars of fresh randomness', () => {
    const a = randomNonce();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(randomNonce()).not.toBe(a);
  });

  it('hashes to the known SHA-256 vector', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
