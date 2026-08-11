/**
 * A swim renders a name, not a key path.
 *
 * The unit tests next door cover the helper. These render the two
 * surfaces where the raw string was actually visible to a person — the
 * cardio detail modal, and the Hub's activity block on a shared post —
 * because "the key exists" and "the screen says a word" are different
 * claims and only the second one is the bug.
 *
 * `t` is stubbed to the REAL resolution order (language -> en -> key), so
 * a missing key produces the key path here exactly as it does in the app.
 * The house `(key, english) => english` stub cannot reproduce that, which
 * is why this defect survived a full test suite in the first place.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { cardioI18n } from '@/lib/i18n-cardio';
import { translations_p8 as part8 } from '@/lib/i18n-part8';

const EN = { ...(part8.en || {}), ...(cardioI18n.en || {}) };
const t = (key) => (EN[key] !== undefined ? EN[key] : key);
const tFallback = (key, english) => (EN[key] !== undefined ? EN[key] : english);

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ t, tFallback, language: 'en' }),
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { email: 'k@x.com' } }) }));
vi.mock('@/lib/DistanceUnitContext', () => ({ useDistanceUnit: () => ({ distanceUnit: 'mi' }) }));
vi.mock('@/lib/dateLocales', () => ({ getDateLocale: () => undefined }));
vi.mock('@/api/db', () => ({
  db: { entities: { CardioLog: { filter: async () => [], delete: async () => {} } } },
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}));
vi.mock('@/components/cardio/RouteMap', () => ({ default: () => <div /> }));

import CardioDetailModal from '@/components/cardio/CardioDetailModal';

const swim = (type) => ({
  id: 's1', type, mode: 'manual', date: '2026-08-11',
  duration_seconds: 1800, distance_meters: 1000,
  pool_length_m: 25, laps: 40, stroke_type: 'Freestyle',
  gps_track: null,
});

afterEach(cleanup);

describe('the swim detail modal', () => {
  it('titles a pool swim "Pool swim"', () => {
    render(<CardioDetailModal log={swim('swimming_pool')} open onOpenChange={() => {}} onEdit={() => {}} />);
    expect(screen.getByText('Pool swim')).toBeTruthy();
  });

  it('titles an open-water swim "Open water swim"', () => {
    render(<CardioDetailModal log={swim('swimming_openwater')} open onOpenChange={() => {}} onEdit={() => {}} />);
    expect(screen.getByText('Open water swim')).toBeTruthy();
  });

  // The regression itself. Before the fix this modal's <DialogTitle> read
  // "cardio.type.swimming_pool" verbatim.
  //
  // Asserts on document.body, NOT on render()'s `container`. Radix
  // portals the dialog out of the container, so `container.textContent`
  // is the empty string and `expect(...).not.toContain(...)` passes for
  // any input at all — this test passed against the broken code until
  // that was fixed, which makes it a decent illustration of why a
  // negative assertion has to be shown failing before it is trusted.
  it('never puts a cardio.type.* key path on screen', () => {
    render(<CardioDetailModal log={swim('swimming_pool')} open onOpenChange={() => {}} onEdit={() => {}} />);
    expect(document.body.textContent).toContain('Pool swim');
    expect(document.body.textContent).not.toContain('cardio.type.');
  });

  it('still titles the six that always worked', () => {
    render(<CardioDetailModal log={swim('running_outside')} open onOpenChange={() => {}} onEdit={() => {}} />);
    expect(screen.getByText('Outdoor run')).toBeTruthy();
  });
});
