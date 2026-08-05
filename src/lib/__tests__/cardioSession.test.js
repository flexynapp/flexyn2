// Live-cardio crash-recovery snapshots must not cross accounts.
//
// The key used to be a single global `fn-cardio-active-session`.
// CardioSection offers any snapshot under 12h old on mount without
// checking who made it, so on a shared phone User A abandoning a run left
// a snapshot that User B was offered next time they opened Cardio —
// accepting it wrote A's distance and duration into B's logs, which feed
// distance totals, XP and quest progress.
//
// These tests pin the two properties that closed it: the key carries the
// user id, and the legacy global key is never readable.
import { describe, it, expect, beforeEach } from 'vitest';
import { snapshot, readSnapshot, clearSnapshot } from '../cardioSession';

const A = 'user-a';
const B = 'user-b';
const LEGACY_KEY = 'fn-cardio-active-session';

beforeEach(() => {
  localStorage.clear();
});

describe('cardioSession', () => {
  it('round-trips a snapshot for the user that wrote it', () => {
    snapshot(A, { kind: 'outside', mode: 'run', savedAt: 123 });
    expect(readSnapshot(A)).toEqual({ kind: 'outside', mode: 'run', savedAt: 123 });
  });

  it("does NOT hand one user's session to another", () => {
    snapshot(A, { kind: 'outside', mode: 'run', savedAt: 123 });
    expect(readSnapshot(B)).toBeNull();
  });

  it('clearing one user leaves the other intact', () => {
    snapshot(A, { kind: 'outside', savedAt: 1 });
    snapshot(B, { kind: 'indoor', savedAt: 2 });
    clearSnapshot(A);
    expect(readSnapshot(A)).toBeNull();
    expect(readSnapshot(B)).toEqual({ kind: 'indoor', savedAt: 2 });
  });

  it('namespaces the key per the flexyn.<feature>.<userId> convention', () => {
    snapshot(A, { savedAt: 1 });
    expect(localStorage.getItem(`flexyn.cardioActiveSession.${A}`)).toBeTruthy();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('never reads the legacy global key, and evicts it', () => {
    // A snapshot left by a pre-fix build must not be resurrected for
    // whoever happens to open Cardio next.
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ kind: 'outside', savedAt: 1 }));
    expect(readSnapshot(A)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('falls back to an anon bucket rather than a shared global key', () => {
    snapshot(undefined, { savedAt: 1 });
    expect(readSnapshot(undefined)).toEqual({ savedAt: 1 });
    // The anon bucket must still be distinct from a real user's.
    expect(readSnapshot(A)).toBeNull();
  });

  it('survives malformed JSON without throwing', () => {
    localStorage.setItem(`flexyn.cardioActiveSession.${A}`, '{not json');
    expect(readSnapshot(A)).toBeNull();
  });
});
