// The auth flow type is decided once, when the client is created. The web
// must keep the options it has always had (implicit flow, URL detection on);
// only the native app switches to PKCE, because PKCE ties a magic link to
// the browser that requested it and the web cannot afford that.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const createClient = vi.hoisted(() => vi.fn(() => ({ auth: {} })));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

const native = vi.hoisted(() => ({ value: false }));
vi.mock('@/lib/native', () => ({ isNative: () => native.value }));

async function optionsFor(isNativeApp) {
  native.value = isNativeApp;
  vi.resetModules();
  createClient.mockClear();
  await import('../supabaseClient');
  return createClient.mock.calls[0][2];
}

beforeEach(() => { native.value = false; });

describe('supabase client auth options', () => {
  it('web: unchanged, no flowType key at all', async () => {
    const opts = await optionsFor(false);
    expect(opts).toEqual({
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    });
  });

  it('native: PKCE, and the deep-link handler owns the URL', async () => {
    const opts = await optionsFor(true);
    expect(opts.auth).toEqual({
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    });
  });
});
