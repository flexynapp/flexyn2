// The two behaviours in these sheets that are decisions rather than markup,
// pinned so a later tidy-up cannot quietly undo them.
//
// Both are things the OLD surfaces got wrong, and both are invisible in a
// screenshot of a healthy account — they only show on the shapes of data
// that produced the original bugs.

import { describe, it, expect } from 'vitest';
import { formatDuration } from '@/components/progress/AdvancedAnalyticsSheet';

// tFallback stub that IGNORES the English fallback and interpolates the KEY,
// per CLAUDE.md: the usual `(key, english) => english` stub returns a string
// that has already been interpolated, so it passes whether or not the vars
// were forwarded. This one fails if a var is dropped.
const t = (key, _english, vars) =>
  key + (vars ? '|' + Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',') : '');

describe('formatDuration — hours only once they exist', () => {
  it('reports bare minutes under an hour', () => {
    expect(formatDuration(39, t)).toBe('analyticsSheet.minutes|n=39');
  });

  it('drops the minutes component when it is zero', () => {
    // "2 h" rather than "2 h 0 m" — a zero component is noise, and this is
    // the same instinct as dropping a zero row rather than rendering it.
    expect(formatDuration(120, t)).toBe('analyticsSheet.hours|h=2');
  });

  it('reports hours and minutes together otherwise', () => {
    expect(formatDuration(5780, t)).toBe('analyticsSheet.hoursMinutes|h=96,m=20');
  });

  it('rounds rather than truncating, so 59.6 min is an hour', () => {
    expect(formatDuration(59.6, t)).toBe('analyticsSheet.hours|h=1');
  });

  it('forwards its vars — a dropped var renders a literal {n} in every non-English locale', () => {
    // The JournalView defect class. English cannot show it, so it is
    // asserted here rather than left to a screenshot.
    expect(formatDuration(39, t)).toContain('n=39');
    expect(formatDuration(5780, t)).toContain('h=96');
    expect(formatDuration(5780, t)).toContain('m=20');
  });
});

describe('the sheets are not in src/components/ui/', () => {
  it('SheetShell lives somewhere ESLint actually looks', async () => {
    // eslint.config.js ignores `src/components/ui/**/*` — that directory is
    // vendored shadcn primitives. A component of ours placed there silently
    // stops being linted, which is how this nearly shipped.
    const fs = await import('fs');
    expect(fs.existsSync('src/components/sheets/SheetShell.jsx')).toBe(true);
    expect(fs.existsSync('src/components/ui/SheetShell.jsx')).toBe(false);
  });
});
