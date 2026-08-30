// The probe behind the sign-in screen's provider gate.
//
// The screen renders whatever this returns, so the failure modes that matter
// are the ones that would WIDEN the list: a non-2xx read as "everything on",
// a missing key read as enabled, or a stale cache outliving the answer.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchEnabledProviders, cachedProviders, RENDERABLE_PROVIDERS } from '../authProviders';

const CACHE_KEY = 'flexyn.authProviders.v1';

// The real shape, trimmed: GoTrue reports every provider it knows, on or off.
const settings = (external) => ({
  ok: true,
  json: async () => ({ external: { google: false, apple: false, github: false, ...external } }),
});

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchEnabledProviders', () => {
  it('returns only the providers reported true — the production answer', async () => {
    fetch.mockResolvedValue(settings({ google: true }));
    expect(await fetchEnabledProviders()).toEqual(['google']);
  });

  it('treats a provider MISSING from the payload as off', async () => {
    // `apple` absent entirely, not `apple: false`. Both mean do not render.
    fetch.mockResolvedValue({ ok: true, json: async () => ({ external: { google: true } }) });
    expect(await fetchEnabledProviders()).toEqual(['google']);
  });

  it('ignores providers the app has no button for', async () => {
    fetch.mockResolvedValue(settings({ google: true, github: true }));
    const out = await fetchEnabledProviders();
    expect(out).toEqual(['google']);
    expect(out.every((p) => RENDERABLE_PROVIDERS.includes(p))).toBe(true);
  });

  it('THROWS on a non-2xx rather than returning a list', async () => {
    // The caller keeps its previous (narrower) list on a throw. Returning []
    // would be survivable; returning a WIDE list would put the dead button
    // back, so the contract is "throw, do not guess".
    fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    await expect(fetchEnabledProviders()).rejects.toThrow(/503/);
  });

  it('throws when the request itself fails', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchEnabledProviders()).rejects.toThrow();
  });

  it('survives a payload with no external map', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    expect(await fetchEnabledProviders()).toEqual([]);
  });

  it('caches the answer for the next load', async () => {
    fetch.mockResolvedValue(settings({ google: true }));
    await fetchEnabledProviders();
    expect(JSON.parse(localStorage.getItem(CACHE_KEY))).toEqual(['google']);
  });

  it('does not cache a failed probe', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(['google']));
    fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(fetchEnabledProviders()).rejects.toThrow();
    expect(JSON.parse(localStorage.getItem(CACHE_KEY))).toEqual(['google']);
  });
});

describe('cachedProviders', () => {
  it('returns null with nothing stored', () => {
    expect(cachedProviders()).toBeNull();
  });

  it('reads back what was cached', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(['google']));
    expect(cachedProviders()).toEqual(['google']);
  });

  it('filters a cached provider the app no longer renders', () => {
    // The cache outlives a release. A provider dropped from
    // RENDERABLE_PROVIDERS must not come back off the user's disk.
    localStorage.setItem(CACHE_KEY, JSON.stringify(['google', 'github']));
    expect(cachedProviders()).toEqual(['google']);
  });

  it('returns null on corrupt or non-array JSON instead of throwing', () => {
    localStorage.setItem(CACHE_KEY, '{"not":"an array"}');
    expect(cachedProviders()).toBeNull();
    localStorage.setItem(CACHE_KEY, 'not json at all');
    expect(cachedProviders()).toBeNull();
  });
});
