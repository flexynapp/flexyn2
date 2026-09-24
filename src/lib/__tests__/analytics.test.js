import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The module reads VITE_POSTHOG_KEY at import time, so each case imports a
// fresh copy after stubbing the env.
async function load(key) {
  vi.resetModules();
  vi.stubEnv('VITE_POSTHOG_KEY', key);
  return import('../analytics.js');
}

describe('analytics', () => {
  let fetchSpy;
  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal('fetch', fetchSpy);
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends nothing when the build has no key', async () => {
    const a = await load('');
    a.track(a.EVENTS.WORKOUT_LOGGED);
    a.identify('u1');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(a.ANALYTICS_CONFIGURED).toBe(false);
  });

  it('sends a known event with the key, and drops unknown ones', async () => {
    const a = await load('phc_test');
    a.track(a.EVENTS.WORKOUT_LOGGED);
    a.track('made_up_event');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.event).toBe('workout_logged');
    expect(body.api_key).toBe('phc_test');
  });

  it('uses the account id after identify, never an email', async () => {
    const a = await load('phc_test');
    a.identify('11111111-2222-3333-4444-555555555555');
    a.track(a.EVENTS.MEAL_LOGGED, { email: 'someone@example.com', card: 'workout' });
    const last = JSON.parse(fetchSpy.mock.calls.at(-1)[1].body);
    expect(last.distinct_id).toBe('11111111-2222-3333-4444-555555555555');
    expect(last.properties.email).toBeUndefined();
    expect(last.properties.card).toBe('workout');
  });

  it('respects the per-device opt-out', async () => {
    const a = await load('phc_test');
    a.setAnalyticsOptOut(true);
    a.track(a.EVENTS.SHARED, { card: 'pr' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(a.isAnalyticsOptedOut()).toBe(true);
    a.setAnalyticsOptOut(false);
    a.track(a.EVENTS.SHARED, { card: 'pr' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('reduces identifying paths to route templates', async () => {
    const a = await load('');
    expect(a.routeTemplate('/@sean')).toBe('/@:username');
    expect(a.routeTemplate('/duel-invite/abcDEF123')).toBe('/duel-invite/:token');
    expect(a.routeTemplate('/checkin/AB12CD34')).toBe('/checkin/:code');
    expect(a.routeTemplate('/hub?profile=someone@example.com')).toBe('/hub');
    expect(a.routeTemplate('/workout#access_token=xyz')).toBe('/workout');
    expect(a.routeTemplate('/gym/5f1c2b9e-1234-4abc-9def-0123456789ab/floor')).toBe('/gym/:id/floor');
  });

  it('keeps only short labels, numbers and booleans', async () => {
    const a = await load('');
    expect(a.cleanProps({ a: 'ok', b: 3, c: true, d: { x: 1 }, e: 'x'.repeat(41), f: NaN, g: 'me@x.com' }))
      .toEqual({ a: 'ok', b: 3, c: true });
  });
});
