/**
 * The detail modal fetches its own row.
 *
 * CardioSavedList used to fetch `select('*')` for 500 rows and hand the row
 * object straight to this modal, because the modal reads twenty-two fields
 * off it — gps_track for the route map, calories, heart rate, cadence,
 * power, pool length, laps, stroke, route name, VO2max, notes. So opening
 * Saved Workouts paid for the GPS track of every session ever logged, on
 * the chance that one got tapped.
 *
 * Now the list carries five columns and the modal fetches the rest by id.
 * The two properties that make that safe are tested here: the summary is
 * enough to render immediately, and a FAILED fetch degrades to the summary
 * rather than blanking. The second one matters because the failure mode it
 * replaces was silent — DetailRow returns null for a missing value, so a
 * stripped row loses its rows rather than erroring.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { catalog } from '@/lib/__tests__/i18nCatalogs.fixture';

// The flat English catalog already IS the merge these two part files needed.
const EN = catalog('en');
const t = (key) => (EN[key] !== undefined ? EN[key] : key);
const tFallback = (key, english) => (EN[key] !== undefined ? EN[key] : english);

// What the LIST has: five columns.
const SUMMARY = {
  id: 'log-1', type: 'running_outside', date: '2026-08-11',
  distance_meters: 8047, duration_seconds: 2660,
};
// What the modal fetches: everything else.
const FULL = {
  ...SUMMARY, mode: 'manual', calories: 528, avg_heart_rate: 155,
  cadence_spm: 172, route_name: 'Morning Loop', notes: 'felt good',
  vo2max_estimate: 31.9, gps_track: null,
};

let getByIdImpl = async () => FULL;

vi.mock('@/lib/LanguageContext', () => ({ useLanguage: () => ({ t, tFallback, language: 'en' }) }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { email: 'k@x.com' } }) }));
vi.mock('@/lib/DistanceUnitContext', () => ({ useDistanceUnit: () => ({ distanceUnit: 'mi' }) }));
vi.mock('@/lib/dateLocales', () => ({ getDateLocale: () => undefined }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: () => {} }) }));
vi.mock('@/components/cardio/RouteMap', () => ({ default: () => <div /> }));
vi.mock('@/api/db', () => ({ db: { entities: { CardioLog: { delete: async () => {} } } } }));
vi.mock('@/lib/data/cardio', () => ({
  getById: (id) => getByIdImpl(id),
  listForPRs: async () => [],
}));

import CardioDetailModal from '@/components/cardio/CardioDetailModal';

const mount = () => render(
  <CardioDetailModal log={SUMMARY} open onOpenChange={() => {}} onEdit={() => {}} />
);

afterEach(() => { cleanup(); getByIdImpl = async () => FULL; });

describe('CardioDetailModal', () => {
  it('renders the summary straight away, before the fetch lands', () => {
    // Never-resolving fetch: whatever is on screen came from the list row.
    getByIdImpl = () => new Promise(() => {});
    mount();
    expect(screen.getByText('Outdoor run')).toBeTruthy();
    expect(screen.getByText('5.00 mi')).toBeTruthy();
  });

  it('fills in the columns the list does not carry', async () => {
    mount();
    // None of these are in SUMMARY — they can only come from the fetch.
    expect(await screen.findByText('528 cal')).toBeTruthy();
    expect(screen.getByText('155 bpm')).toBeTruthy();
    expect(screen.getByText('Morning Loop')).toBeTruthy();
    expect(screen.getByText('felt good')).toBeTruthy();
  });

  it('asks for the row it was given', async () => {
    const seen = [];
    getByIdImpl = async (id) => { seen.push(id); return FULL; };
    mount();
    await waitFor(() => expect(seen).toEqual(['log-1']));
  });

  // Degrading to the summary is the whole reason this is safe to ship: the
  // modal keeps its identity and its headline numbers even offline.
  it('degrades to the summary when the fetch fails', async () => {
    getByIdImpl = async () => null;
    mount();
    await waitFor(() => expect(screen.getByText('Outdoor run')).toBeTruthy());
    expect(screen.getByText('5.00 mi')).toBeTruthy();
    // The fields it could not get are simply absent, not rendered blank.
    expect(screen.queryByText('528 cal')).toBeNull();
  });

  it('still works for a caller that passes a complete row', async () => {
    getByIdImpl = async () => null;
    render(<CardioDetailModal log={FULL} open onOpenChange={() => {}} onEdit={() => {}} />);
    await waitFor(() => expect(screen.getByText('528 cal')).toBeTruthy());
  });
});
