// Dates on a shared Hub activity card go through the language-bound
// formatter, not date-fns.
//
// DEFECT PINNED. Both date-bearing blocks in PostActivityBlock rendered
// their date with `format(parseISO(d), 'MMM d, yyyy')`. date-fns
// `format()` binds no locale, so "Aug 7, 2026" survived every
// translation pass and sat inside otherwise fully-translated copy — the
// exact failure CLAUDE.md's i18n section names. The achievement block
// was fixed in the achievements audit; the goal block sat two lines away
// with the identical bug and is fixed here.
//
// The assertion is deliberately about the MECHANISM rather than a
// formatted string: it stubs `@/lib/intl` and checks the component
// called it. A test asserting "7 ago 2026" would pass just as happily
// against a hardcoded Spanish string, and would break on any ICU data
// change; what actually matters is that the date is routed through the
// locale-bound path at all.
//
// There is no `expect(...).not.toContain('Aug')` here for the same
// reason — the file importing date-fns at all is the regression, and
// that is what the last test checks.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fmtDate = vi.fn((d) => `L10N(${String(d).slice(0, 10)})`);

vi.mock('@/lib/intl', () => ({
  useDateFormatter: () => fmtDate,
  useNumberFormatter: () => (n) => String(n),
}));
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    tFallback: (_k, fb, vars) =>
      vars ? Object.entries(vars).reduce((s, [n, v]) => s.replace(`{${n}}`, v), fb) : fb,
    language: 'es' }),
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/DistanceUnitContext', () => ({ useDistanceUnit: () => 'mi' }));
vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => 'lbs' }));
vi.mock('@/api/db', () => ({ db: { entities: {} } }));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PostActivityBlock = (await import('@/components/hub/PostActivityBlock')).default;

// PostActivityBlock reaches for react-query internally (the regimen
// block fetches), so every render needs a client even for the branches
// that never query.
const show = (post) => render(
  <QueryClientProvider client={new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })}>
    <PostActivityBlock post={post} />
  </QueryClientProvider>,
);

const post = (type, snapshot) => ({
  id: 'p1',
  post_type: type,
  linked_entity_type: type,
  linked_entity_snapshot: snapshot,
});

beforeEach(() => fmtDate.mockClear());

describe('shared activity dates are locale-bound', () => {
  it('formats a completed GOAL date through useDateFormatter', () => {
    show(post('goal_completed', {
      exercise_name: 'Back Squat',
      completed_date: '2026-08-07T10:00:00Z',
    }));

    expect(fmtDate).toHaveBeenCalledWith('2026-08-07T10:00:00Z', { dateStyle: 'medium' });
    expect(screen.getByText(/L10N\(2026-08-07\)/)).toBeTruthy();
  });

  it('formats an unlocked ACHIEVEMENT date the same way', () => {
    show(post('achievement', {
      name: 'First Rep',
      unlocked_date: '2026-08-07T10:00:00Z',
    }));

    expect(fmtDate).toHaveBeenCalledWith('2026-08-07T10:00:00Z', { dateStyle: 'medium' });
    expect(screen.getByText(/L10N\(2026-08-07\)/)).toBeTruthy();
  });

  it('omits the date line rather than formatting a missing value', () => {
    show(post('goal_completed', { exercise_name: 'Back Squat' }));
    expect(fmtDate).not.toHaveBeenCalled();
    expect(screen.queryByText(/L10N\(/)).toBeNull();
  });

  it('does not import date-fns at all', () => {
    // The real regression guard. Either block reaching for `format()`
    // again reintroduces an English date inside translated copy, and
    // neither a render test nor a reviewer reliably catches that — the
    // output looks perfectly fine in English.
    const src = fs.readFileSync('src/components/hub/PostActivityBlock.jsx', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/from ['"]date-fns['"]/);
    expect(src).not.toMatch(/\bparseISO\s*\(/);
  });
});
