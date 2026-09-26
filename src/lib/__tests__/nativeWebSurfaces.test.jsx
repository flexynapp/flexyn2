// What the native app turns OFF: web push, the service worker and the
// "install this app" prompts. Each is pinned in both directions, because the
// web behaviour is the one real users have today and must not move.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const native = vi.hoisted(() => ({ value: false }));
vi.mock('@/lib/native', () => ({ isNative: () => native.value }));
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: vi.fn(), auth: {} } }));

const FALLBACK = 'https://flexyn.netlify.app';

beforeEach(() => { native.value = false; });

describe('shareOrigin', () => {
  it('web: exactly window.location.origin, as before', async () => {
    const { shareOrigin } = await import('@/lib/appOrigin');
    expect(shareOrigin()).toBe(window.location.origin);
  });

  it('native: the public origin, never capacitor://localhost', async () => {
    native.value = true;
    const { shareOrigin } = await import('@/lib/appOrigin');
    // jsdom's host is localhost, which is exactly what the web view reports.
    expect(shareOrigin()).toBe(FALLBACK);
  });
});

describe('usePushSubscription.isSupported', () => {
  const saved = {};
  beforeEach(() => {
    saved.sw = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: new Promise(() => {}), getRegistration: vi.fn() },
    });
    saved.pm = window.PushManager;
    window.PushManager = function PushManager() {};
    saved.n = globalThis.Notification;
    globalThis.Notification = { permission: 'default', requestPermission: vi.fn() };
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'BExampleKey');
  });
  afterEach(() => {
    if (saved.sw) Object.defineProperty(navigator, 'serviceWorker', saved.sw);
    else delete navigator.serviceWorker;
    window.PushManager = saved.pm;
    globalThis.Notification = saved.n;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('web: supported when the browser has the pieces', async () => {
    vi.resetModules();
    const { usePushSubscription } = await import('@/lib/usePushSubscription');
    const { result } = renderHook(() => usePushSubscription());
    expect(result.current.isSupported).toBe(true);
  });

  it('native: never supported, which hides every web opt-in surface', async () => {
    native.value = true;
    vi.resetModules();
    const { usePushSubscription } = await import('@/lib/usePushSubscription');
    const { result } = renderHook(() => usePushSubscription());
    expect(result.current.isSupported).toBe(false);
  });
});
