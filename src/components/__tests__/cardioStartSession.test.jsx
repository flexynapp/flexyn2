/**
 * Start Session — the hero and the picker sheet.
 *
 * Replaces four screens with one: the 2×2 activity grid, "How are you
 * running?", "How do you want to log it?", and the tracker's idle screen.
 * Same four questions; three of them pre-answered from the last session.
 *
 * These render the real CardioSection, which is deliberate — the first
 * version of the hero used a `Play` icon it never imported, and lint did
 * not catch it because react/jsx-no-undef is not enabled here. It would
 * have shipped as a blank screen and a ReferenceError. Rendering catches
 * that; asserting on props never would.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let LAST_LOG = [];

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    tFallback: (_k, e, vars) =>
      vars ? Object.entries(vars).reduce((s, [n, v]) => s.replace(`{${n}}`, v), e) : e,
    language: 'en' }),
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { email: 'k@x.com' } }) }));
vi.mock('@/lib/DistanceUnitContext', () => ({ useDistanceUnit: () => ({ distanceUnit: 'mi' }) }));
vi.mock('@/lib/cardioSession', () => ({ readSnapshot: () => null, clearSnapshot: () => {} }));
vi.mock('@/api/db', () => ({
  db: {
    auth: { me: async () => ({}) },
    entities: { CardioLog: { filter: async () => LAST_LOG } },
  },
}));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));

// Leaf views announce which one they are — that is the routing assertion.
vi.mock('@/components/cardio/CardioManualForm', () => ({
  default: ({ mode, env }) => <div data-testid="dest">{`manual:${mode}_${env}`}</div>,
}));
vi.mock('@/components/cardio/CardioLiveTrackerOutside', () => ({
  default: ({ mode }) => <div data-testid="dest">{`live-outside:${mode}`}</div>,
}));
vi.mock('@/components/cardio/CardioLiveTrackerIndoor', () => ({
  default: ({ mode, env }) => <div data-testid="dest">{`live-indoor:${mode}_${env}`}</div>,
}));
vi.mock('@/components/cardio/CardioSavedList', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioDetailModal', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioTemplates', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioPlanned', () => ({ default: () => <div /> }));

import CardioSection from '@/components/cardio/CardioSection';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CardioSection onBack={() => {}} />
    </QueryClientProvider>
  );
}
const tap = (label) => act(() => { screen.getByText(label).click(); });

afterEach(() => { cleanup(); LAST_LOG = []; });

describe('the cardio home', () => {
  it('renders the hero — and does not blow up doing it', () => {
    mount();
    expect(screen.getByText('Start Session')).toBeTruthy();
    expect(screen.getByText('Running, Walking, Biking, or Swimming')).toBeTruthy();
  });

  it('no longer offers the four activity tiles', () => {
    mount();
    // The 2x2 grid is gone; the activities live in the sheet now.
    expect(screen.queryByText('Walking')).toBeNull();
    expect(screen.queryByText('Biking')).toBeNull();
  });

  it('no longer offers Saved Workouts, Cardio Goals or Devices & Apps', () => {
    mount();
    // Each has a home elsewhere: All Workouts ▸ Cardio, the Goals form,
    // and Settings ▸ Connected apps.
    expect(screen.queryByText('cardio.savedWorkouts')).toBeNull();
    expect(screen.queryByText('Cardio Goals')).toBeNull();
    expect(screen.queryByText('Devices & Apps')).toBeNull();
  });

  it('keeps Templates and Planned Sessions, which have nowhere else to go', () => {
    mount();
    expect(screen.getByText('Templates')).toBeTruthy();
    expect(screen.getByText('Planned Sessions')).toBeTruthy();
  });
});

describe('the sheet', () => {
  it('opens from the hero with all three rows visible at once', () => {
    mount();
    tap('Start Session');
    expect(screen.getByText('Activity')).toBeTruthy();
    // Where and How are DIM, not absent — the height must not change as
    // you answer, or the sheet grows under a moving thumb.
    expect(screen.getByText('Where')).toBeTruthy();
    expect(screen.getByText('How')).toBeTruthy();
  });

  it('uses per-activity words, not one universal Outside/Inside pair', () => {
    mount();
    tap('Start Session');
    tap('Biking');
    // kegan's call, 2026-08-11: a bike is Stationary, not "Inside".
    expect(screen.getByText('Stationary')).toBeTruthy();

    tap('Swimming');
    expect(screen.getByText('Open Water')).toBeTruthy();
    expect(screen.getByText('Pool')).toBeTruthy();
  });

  it('routes a live run to the outdoor tracker', async () => {
    mount();
    tap('Start Session');
    tap('Running');
    tap('Outside');
    tap('cardio.input.live');
    tap('Start running');
    await waitFor(() => expect(screen.getByTestId('dest').textContent).toBe('live-outside:running'));
  });

  it('routes a treadmill run to the indoor tracker', async () => {
    mount();
    tap('Start Session');
    tap('Running');
    tap('Treadmill');
    tap('cardio.input.live');
    tap('Start running');
    await waitFor(() => expect(screen.getByTestId('dest').textContent).toBe('live-indoor:running_treadmill'));
  });

  it('routes manual entry to the form with the chosen activity', async () => {
    mount();
    tap('Start Session');
    tap('Biking');
    tap('Stationary');
    tap('cardio.input.manual');
    tap('Log biking');
    await waitFor(() => expect(screen.getByTestId('dest').textContent).toBe('manual:biking_stationary'));
  });

  it('forces a swim to manual and says why', () => {
    mount();
    tap('Start Session');
    tap('Swimming');
    // Live is disabled rather than removed — a row that changes length
    // between activities reads as a rendering bug.
    const live = screen.getByText('cardio.input.live').closest('button');
    expect(live.disabled).toBe(true);
    expect(screen.getByText(/Live tracking needs GPS/)).toBeTruthy();
  });

  it('pre-fills from the last session, so the common case is two taps', async () => {
    LAST_LOG = [{ id: '1', type: 'biking_stationary', distance_meters: 8000 }];
    mount();
    await screen.findByText('Start Session');
    tap('Start Session');
    // Nothing chosen by hand — the CTA is already live for the last activity.
    await waitFor(() => expect(screen.getByText('Start biking')).toBeTruthy());
  });
});
