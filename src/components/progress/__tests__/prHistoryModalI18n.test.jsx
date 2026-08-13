/**
 * PR History modal — translatability, and the two defects behind it.
 *
 * ONE: the file had zero translation calls. Same shape as the Body tab, on
 * a smaller surface — an English literal and a correct English fallback
 * render identically, so nothing looked wrong until a translation landed
 * and this modal kept speaking English.
 *
 * TWO, and the reason the last test here exists: its dates were formatted
 * with date-fns `format()` and a literal pattern. The chart's axis ticks
 * passed NO locale at all, so every point read "Aug 9" in all 15 languages,
 * and the milestone rows passed one but pinned month-day-year order through
 * the pattern, which most of those languages do not use. CLAUDE.md names
 * this exactly: dates are not covered by translation keys, so a key audit
 * scores this file 100% while a German user reads an American date.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import fs from 'fs';

vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => ({ weightUnit: 'lbs' }) }));

/** Ignores the English fallback, per CLAUDE.md — the house stub
 *  `(key, english) => english` returns already-interpolated English and so
 *  cannot see a call site that dropped its vars. */
const TPL = {
  'progress.pb.titleFor': 'XX:historia de {name}',
  'progress.pb.copyValue': 'XX:record {weight}',
  'progress.pb.prsSet_other': 'XX:{n} records',
  'progress.pb.sessions_other': 'XX:{n} sesiones',
};
const mark = (key, _en, vars) => {
  let s = TPL[key] ?? `XX:${key}`;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)); });
  return s;
};

let language = 'en';
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ language, tFallback: (k, e, v) => mark(k, e, v) }),
}));

import PRHistoryModal from '@/components/progress/PRHistoryModal';

/** Two sessions, the second a PR, so every branch renders. */
const LOGS = [
  { date: '2026-03-14', exercises: [{ name: 'Bench Press', sets: [{ weight: 185, reps: 5 }] }] },
  { date: '2026-08-09', exercises: [{ name: 'Bench Press', sets: [{ weight: 225, reps: 3 }] }] },
];
/* BottomSheet renders through a portal, so the container `render` hands
   back is empty — the sheet lives on document.body. Read the text there. */
const open = () => {
  render(<PRHistoryModal open onClose={() => {}} exerciseName="Bench Press" logs={LOGS} />);
  return { text: () => document.body.textContent };
};

afterEach(() => { language = 'en'; cleanup(); });

describe('every string in the modal goes through the translation layer', () => {
  it('leaves no English literal on the screen', () => {
    const { text } = open();
    for (const s of [
      'PR History', 'All-time best', 'Weight over time', 'PR milestones',
      'No data yet', 'PRs set', 'sessions', 'new PR at that session',
    ]) {
      expect(text(), `"${s}" is still a hardcoded literal`).not.toContain(s);
    }
  });

  it('renders the headings and the copy affordance from keys', () => {
    const { text } = open();
    for (const key of [
      'progress.pb.allTimeBest', 'progress.pb.chartTitle',
      'progress.pb.chartLegend', 'progress.pb.milestones',
    ]) {
      expect(text(), `${key} did not reach the screen`).toContain(`XX:${key}`);
    }
  });

  it('forwards the exercise name into the title', () => {
    open();
    expect(screen.getByText('XX:historia de Bench Press')).toBeTruthy();
  });

  it('forwards both counts, so a dropped vars argument is visible', () => {
    const { text } = open();
    expect(text()).toContain('XX:2 records');   // two PRs
    expect(text()).toContain('XX:2 sesiones');  // two sessions
    expect(text()).not.toContain('{n}');
  });

  it('shows the empty state through keys when the exercise has no history', () => {
    render(<PRHistoryModal open onClose={() => {}} exerciseName="Deadlift" logs={LOGS} />);
    const text = () => document.body.textContent;
    expect(text()).toContain('XX:progress.pb.emptyTitle');
    expect(text()).toContain('XX:progress.pb.emptyBody');
  });
});

/* The fallback-vs-part-file drift check that used to live here has moved
   to `i18nFallbackDrift.test.js`, which runs it across every component in
   this directory against the MERGED English rather than one part file.
   That distinction stopped being academic the moment this modal started
   reading `copy.noun.pr` out of `src/locales/*.json`: the narrow version reported
   a correctly-defined key as missing, because it was only ever looking in
   `src/locales/*.json`. */

describe('dates follow the language, not a hardcoded pattern', () => {
  it('does not import date-fns format here', () => {
    const src = fs.readFileSync('src/components/progress/PRHistoryModal.jsx', 'utf8');
    // The whole defect in one line: a date-fns pattern is a decision about
    // field order, and field order is locale data.
    expect(src).not.toMatch(/from 'date-fns'/);
    expect(src).toMatch(/useDateFormatter/);
  });

  it('renders a German date in German order', () => {
    language = 'de';
    const { text } = open();
    // 2026-08-09 → "9. August 2026", never "August 9, 2026".
    expect(text()).toMatch(/9\.\s*August\s*2026/);
    expect(text()).not.toContain('August 9');
  });

  it('renders a Japanese date in Japanese order', () => {
    language = 'ja';
    const { text } = open();
    expect(text()).toMatch(/2026年8月9日/);
  });
});
