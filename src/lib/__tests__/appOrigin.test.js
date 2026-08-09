// Rules for the origin that gets printed onto a gym wall.
//
// Tested through the pure resolver rather than by stubbing window.location:
// the interesting logic is "which host is durable", not how it is read.

import { describe, it, expect } from 'vitest';
import { resolveOrigin, isEphemeralHost } from '@/lib/appOrigin';

const FALLBACK = 'https://flexyn.netlify.app';

describe('isEphemeralHost — hosts a stranger\'s phone cannot reach', () => {
  it.each(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]', 'kegans-mac.local'])(
    'treats %s as ephemeral', (host) => {
      expect(isEphemeralHost(host)).toBe(true);
    });

  it('treats a Netlify deploy preview as ephemeral — the branch gets deleted', () => {
    expect(isEphemeralHost('deploy-preview-12--flexyn.netlify.app')).toBe(true);
    expect(isEphemeralHost('feature-gyms--flexyn.netlify.app')).toBe(true);
  });

  it('treats the production hosts as durable', () => {
    expect(isEphemeralHost('flexyn.netlify.app')).toBe(false);
    expect(isEphemeralHost('flexyn.app')).toBe(false);
  });

  it('treats a missing hostname as ephemeral rather than guessing', () => {
    expect(isEphemeralHost(undefined)).toBe(true);
    expect(isEphemeralHost('')).toBe(true);
  });
});

describe('resolveOrigin', () => {
  it('uses the live origin when the host is durable', () => {
    expect(resolveOrigin({ hostname: 'flexyn.netlify.app', origin: 'https://flexyn.netlify.app' }))
      .toBe('https://flexyn.netlify.app');
  });

  it('refuses a dev origin — this is what puts localhost on a printed poster', () => {
    expect(resolveOrigin({ hostname: 'localhost', origin: 'http://localhost:5173' }))
      .toBe(FALLBACK);
  });

  it('refuses a deploy preview', () => {
    expect(resolveOrigin({
      hostname: 'deploy-preview-12--flexyn.netlify.app',
      origin: 'https://deploy-preview-12--flexyn.netlify.app',
    })).toBe(FALLBACK);
  });

  it('lets a configured public origin win, even from a dev server', () => {
    expect(resolveOrigin({
      hostname: 'localhost', origin: 'http://localhost:5173',
      configured: 'https://flexyn.app',
    })).toBe('https://flexyn.app');
  });

  it('strips a trailing slash so the URL never doubles up', () => {
    expect(resolveOrigin({ configured: 'https://flexyn.app/' })).toBe('https://flexyn.app');
  });

  it('ignores a configured value that is not a plain https origin', () => {
    // A typo here would be baked into print, so a bad value falls back
    // rather than shipping.
    for (const bad of ['flexyn.app', 'http://flexyn.app', 'https://flexyn.app/checkin', '', '   ']) {
      expect(resolveOrigin({ configured: bad })).toBe(FALLBACK);
    }
  });

  it('falls back with no window and no config', () => {
    expect(resolveOrigin()).toBe(FALLBACK);
    expect(resolveOrigin({})).toBe(FALLBACK);
  });
});
