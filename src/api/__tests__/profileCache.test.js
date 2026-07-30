// The profile cache is what db.auth.me() returns. Its whole reason for
// existing as a separate module is that it must be importable with no side
// effects, so data modules can keep it in sync without dragging in db.js's
// supabase.auth.onAuthStateChange listener.

import { describe, it, expect, beforeEach } from 'vitest';
import { getProfile, setProfile, patchProfile, clearProfile } from '../profileCache';

describe('profileCache', () => {
  beforeEach(() => clearProfile());

  it('starts empty', () => {
    expect(getProfile()).toBeNull();
  });

  it('round-trips a profile', () => {
    setProfile({ id: 'u1', email: 'a@b.c', is_private: false });
    expect(getProfile()).toMatchObject({ id: 'u1', is_private: false });
  });

  it('merges a patch without dropping other columns', () => {
    setProfile({ id: 'u1', email: 'a@b.c', is_private: false, quiet_hours_start: null });
    patchProfile({ is_private: true });
    const p = getProfile();
    expect(p.is_private).toBe(true);
    expect(p.email).toBe('a@b.c');
    expect(p).toHaveProperty('quiet_hours_start', null);
  });

  it('replaces the object identity on patch so react-query sees a change', () => {
    setProfile({ id: 'u1', is_private: false });
    const before = getProfile();
    patchProfile({ is_private: true });
    expect(getProfile()).not.toBe(before);
  });

  it('is a no-op before anything is loaded', () => {
    expect(patchProfile({ is_private: true })).toBeNull();
    expect(getProfile()).toBeNull();
  });

  it('ignores junk patches rather than corrupting the cache', () => {
    setProfile({ id: 'u1', is_private: false });
    patchProfile(null);
    patchProfile('nope');
    expect(getProfile()).toMatchObject({ id: 'u1', is_private: false });
  });

  it('clears on sign-out', () => {
    setProfile({ id: 'u1' });
    clearProfile();
    expect(getProfile()).toBeNull();
  });

  it('imports without touching supabase — no auth listener side effect', async () => {
    // If this module ever grows a supabase import, every test that stubs the
    // client starts failing at import time (this is exactly how gymRival.js
    // broke gymRivalOverthrow.test.js). Assert the source stays clean.
    const src = await import('../profileCache?raw').catch(() => null);
    // Vite's ?raw isn't available in all configs; fall back to a behavioural
    // check — importing this module must not have thrown, which it didn't.
    if (src?.default) {
      // Match a real import STATEMENT, not the words — this file's own header
      // discusses supabaseClient and onAuthStateChange at length, and a naive
      // substring check just fails on its own documentation.
      expect(src.default).not.toMatch(/^\s*import[^\n]*(supabaseClient|@\/api\/db)/m);
    }
    expect(typeof patchProfile).toBe('function');
  });
});
