import { describe, it, expect, beforeEach, vi } from 'vitest';
import { _resetActiveSessions, isSessionActive, onSessionActiveChange, setSessionActive } from '../activeSession';

describe('activeSession', () => {
  beforeEach(() => _resetActiveSessions());

  it('is active while any surface holds it, and tells listeners only on change', () => {
    const fn = vi.fn();
    onSessionActiveChange(fn);
    setSessionActive('workout', true);
    setSessionActive('workout', true);
    setSessionActive('cardio', true);
    setSessionActive('workout', false);
    expect(isSessionActive()).toBe(true);
    setSessionActive('cardio', false);
    expect(isSessionActive()).toBe(false);
    expect(fn.mock.calls.map((c) => c[0])).toEqual([true, true, true, false]);
  });
});
