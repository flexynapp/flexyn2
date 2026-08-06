// The onboarding StepHeader — back button, progress bar, coach button — sits
// OUTSIDE each step's scroll box. So it lines up with the content below it
// only while the two share a horizontal inset, and nothing in the markup makes
// that true: they are separate elements in separate boxes.
//
// It stopped being true. Eight of the ten scroll boxes carried `pe-2`, a
// scrollbar gutter, and the header carried none — so the coach button sat 8px
// past the right edge of every card on those steps, while the two boxes
// without `pe-2` were correct. Measured at 393x852 before the fix: header
// 24..352 against content 24..344 on goal / experience / days, and 24..352
// against 24..352 on height / weight.
//
// The gutter protects nothing here — OptionCard has no scale, ring or shadow
// to clip, and this ships to iOS and Android where scrollbars are overlays —
// so it is gone rather than mirrored onto the header. One inset, set by the
// page shell. This test fails if a scroll box grows its own again.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync('src/pages/Onboarding.jsx', 'utf8');

describe('onboarding header alignment', () => {
  it('gives no scroll box a horizontal inset the header does not share', () => {
    const offenders = SOURCE.split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => line.includes('overflow-y-auto'))
      .filter(({ line }) => /\b(pe-\d|pl-\d|pr-\d|ps-\d|px-\d)/.test(line));
    expect(offenders.map(o => `${o.n}: ${o.line.trim()}`)).toEqual([]);
  });

  it('still has the scroll boxes it is guarding', () => {
    // A guard that passes because the thing it checks vanished is not a guard.
    const count = SOURCE.split('\n').filter(l => l.includes('overflow-y-auto')).length;
    expect(count).toBeGreaterThanOrEqual(9);
  });

  it('keeps the header symmetric — a 44px slot on each end of the bar', () => {
    // The bar is centred between two w-11 slots, not merely pushed off the
    // back button: when either button is hidden a spacer of the same size
    // holds its place, so the bar never shifts between steps.
    const start = SOURCE.indexOf('function StepHeader(');
    const end = SOURCE.indexOf('KINETIC HEADING', start);
    const header = SOURCE.slice(start, end);
    expect([...header.matchAll(/w-11 h-11/g)].length).toBeGreaterThanOrEqual(2);
    expect(header).toContain('flex-1');
  });
});
