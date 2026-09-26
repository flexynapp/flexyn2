// The platform seam every native branch in the app hangs off.
//
// The property that matters most is the failure direction: anything that
// cannot answer must answer "web", because the web path is the default and
// the one real users are on today.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const cap = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  getPlatform: vi.fn(() => 'web'),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: cap }));

import { isNative, platform, isNativeIos, NATIVE_AUTH_CALLBACK, NATIVE_URL_SCHEME } from '@/lib/native';

beforeEach(() => {
  cap.isNativePlatform.mockReset().mockReturnValue(false);
  cap.getPlatform.mockReset().mockReturnValue('web');
});

describe('isNative / platform', () => {
  it('reads a browser as web', () => {
    expect(isNative()).toBe(false);
    expect(platform()).toBe('web');
    expect(isNativeIos()).toBe(false);
  });

  it('reads the iOS app', () => {
    cap.isNativePlatform.mockReturnValue(true);
    cap.getPlatform.mockReturnValue('ios');
    expect(isNative()).toBe(true);
    expect(platform()).toBe('ios');
    expect(isNativeIos()).toBe(true);
  });

  it('reads the Android app, which is native but not iOS', () => {
    cap.isNativePlatform.mockReturnValue(true);
    cap.getPlatform.mockReturnValue('android');
    expect(isNative()).toBe(true);
    expect(platform()).toBe('android');
    expect(isNativeIos()).toBe(false);
  });

  it('fails toward web when the bridge throws', () => {
    cap.isNativePlatform.mockImplementation(() => { throw new Error('no bridge'); });
    cap.getPlatform.mockImplementation(() => { throw new Error('no bridge'); });
    expect(isNative()).toBe(false);
    expect(platform()).toBe('web');
  });

  it('treats a truthy non-boolean as web, not native', () => {
    cap.isNativePlatform.mockReturnValue('yes');
    expect(isNative()).toBe(false);
  });

  it('maps an unknown platform string to web', () => {
    cap.getPlatform.mockReturnValue('electron');
    expect(platform()).toBe('web');
  });
});

describe('deep-link constants', () => {
  it('uses the app id as the scheme, and the path Supabase must allow', () => {
    expect(NATIVE_URL_SCHEME).toBe('app.flexyn');
    expect(NATIVE_AUTH_CALLBACK).toBe('app.flexyn://auth-callback');
  });
});
