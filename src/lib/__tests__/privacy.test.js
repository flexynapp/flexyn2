// Tests for src/lib/privacy.js — the pure visibility helpers for
// privacy mode (migration 117).

import { describe, it, expect } from 'vitest';
import { canViewProfile, filterSearchable } from '../privacy';

describe('canViewProfile', () => {
  const viewer  = { id: 'v1', email: 'viewer@x.com' };
  const owner   = { id: 'o1', email: 'owner@x.com' };

  it('returns true for a public profile regardless of follow state', () => {
    expect(canViewProfile(viewer, { ...owner, is_private: false }, false)).toBe(true);
    expect(canViewProfile(viewer, { ...owner, is_private: false }, true)).toBe(true);
  });

  it('returns true when viewer is the profile owner (by id)', () => {
    expect(canViewProfile(viewer, { id: viewer.id, email: 'OTHER@x.com', is_private: true }, false)).toBe(true);
  });

  it('returns true when viewer matches by email (case-insensitive)', () => {
    expect(canViewProfile(viewer, { id: 'other', email: 'VIEWER@x.com', is_private: true }, false)).toBe(true);
  });

  it('returns false for a private profile when the viewer is a stranger', () => {
    expect(canViewProfile(viewer, { ...owner, is_private: true }, false)).toBe(false);
  });

  it('returns true for a private profile when viewer follows the owner', () => {
    expect(canViewProfile(viewer, { ...owner, is_private: true }, true)).toBe(true);
  });

  it('returns false for null/undefined profile input', () => {
    expect(canViewProfile(viewer, null, true)).toBe(false);
    expect(canViewProfile(viewer, undefined, true)).toBe(false);
  });
});

describe('filterSearchable', () => {
  const viewer = { id: 'me', email: 'me@x.com' };
  const rows = [
    { id: 'a', email: 'a@x.com', hide_from_search: false },
    { id: 'b', email: 'b@x.com', hide_from_search: true },
    { id: 'me', email: 'ME@x.com', hide_from_search: true }, // viewer's own
  ];

  it('strips rows with hide_from_search=true', () => {
    const out = filterSearchable(rows, viewer);
    const ids = out.map(r => r.id);
    expect(ids).toContain('a');
    expect(ids).not.toContain('b');
  });

  it('always keeps the viewer\'s own row (matched by id)', () => {
    const out = filterSearchable(rows, { id: 'me' });
    expect(out.map(r => r.id)).toContain('me');
  });

  it('always keeps the viewer\'s own row (matched by email, case-insensitive)', () => {
    const out = filterSearchable(rows, { email: 'me@x.com' });
    expect(out.map(r => r.id)).toContain('me');
  });

  it('returns [] for null input', () => {
    expect(filterSearchable(null, viewer)).toEqual([]);
    expect(filterSearchable(undefined, viewer)).toEqual([]);
  });

  it('treats a missing hide_from_search as visible', () => {
    const out = filterSearchable([{ id: 'x', email: 'x@x.com' }], viewer);
    expect(out).toHaveLength(1);
  });
});
