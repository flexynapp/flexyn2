import { describe, it, expect, beforeEach } from 'vitest';
import { rememberTabLocation, tabHref, _resetTabMemory } from '@/lib/tabMemory';

describe('tabMemory', () => {
  beforeEach(() => _resetTabMemory());

  it('reopens a tab on the view it was left on', () => {
    rememberTabLocation('/progress', '?tab=records');
    expect(tabHref('/progress')).toBe('/progress?tab=records');
  });

  it('opens a tab never visited at its root', () => {
    expect(tabHref('/hub')).toBe('/hub');
  });

  it('never remembers a one-shot action param, which would reopen a sheet', () => {
    rememberTabLocation('/nutrition', '?openLogMeal=1&nutrients=vitamins');
    expect(tabHref('/nutrition')).toBe('/nutrition?nutrients=vitamins');
    rememberTabLocation('/hub', '?compose=1');
    expect(tabHref('/hub')).toBe('/hub');
  });

  it('forgets a view once the tab is back at its root', () => {
    rememberTabLocation('/workout', '?history=cardio');
    rememberTabLocation('/workout', '');
    expect(tabHref('/workout')).toBe('/workout');
  });
});
