/**
 * A cardio reminder has to land on the session, not on the picker.
 *
 * `fire_scheduled_workout_reminders` deep-links to
 * `/workout?scheduled=<id>`, and Workout.jsx's handler bailed unless the
 * payload had `workout.exercises.length`. Before Planned Sessions moved
 * onto `scheduled_workouts` that was safe — every row was an AI Coach
 * session. It stops being safe the moment a cardio row exists: the
 * notification would arrive, the tap would open the Workout page, and
 * nothing at all would happen.
 *
 * These drive CardioSection's `deepLink` prop directly. That is the
 * contract between the two files, and it is where the routing decision
 * lives; the URL parsing above it is one line of URLSearchParams.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, tFallback: (_k, e) => e, language: 'en' }),
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/DistanceUnitContext', () => ({ useDistanceUnit: () => ({ distanceUnit: 'mi' }) }));
vi.mock('@/api/db', () => ({ db: { auth: { me: async () => ({}) }, entities: {} } }));
vi.mock('@/lib/cardioSession', () => ({ readSnapshot: () => null, clearSnapshot: () => {} }));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));

// The leaf views are stubbed to announce which one mounted — that is the
// whole assertion, and rendering the real trackers would drag in GPS,
// wake locks and speech synthesis for no added confidence.
vi.mock('@/components/cardio/CardioManualForm', () => ({
  default: ({ mode, env }) => <div data-testid="manual">{`manual:${mode}_${env}`}</div>,
}));
vi.mock('@/components/cardio/CardioLiveTrackerOutside', () => ({
  default: ({ mode }) => <div data-testid="live-outside">{`live:${mode}`}</div>,
}));
vi.mock('@/components/cardio/CardioLiveTrackerIndoor', () => ({
  default: ({ mode, env }) => <div data-testid="live-indoor">{`live:${mode}_${env}`}</div>,
}));
vi.mock('@/components/cardio/CardioSavedList', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioDetailModal', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioTemplates', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioPlanned', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioWearableStub', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioGoals', () => ({ default: () => <div /> }));

import CardioSection from '@/components/cardio/CardioSection';

function mount(deepLink, onConsumed = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CardioSection onBack={() => {}} deepLink={deepLink} onDeepLinkConsumed={onConsumed} />
    </QueryClientProvider>
  );
}

afterEach(cleanup);

describe('a scheduled cardio reminder', () => {
  it('opens the input-type screen for the activity that was scheduled', () => {
    mount({ mode: 'running', env: 'outside' });
    // The input-type screen, not the home grid: the user already answered
    // "what" and "where" when they scheduled it.
    expect(screen.getByText('cardio.input.title')).toBeTruthy();
    expect(screen.queryByText('Start Session')).toBeNull();
  });

  it('carries mode and env through to the manual form', () => {
    mount({ mode: 'biking', env: 'stationary' });
    act(() => { screen.getByText('cardio.input.manual').click(); });
    expect(screen.getByTestId('manual').textContent).toBe('manual:biking_stationary');
  });

  it('sends a swim straight to the form, skipping a question with one answer', () => {
    // Swim has no live tracker, so the input-type screen would offer
    // Manual and nothing else.
    mount({ mode: 'swimming', env: 'pool' });
    expect(screen.getByTestId('manual').textContent).toBe('manual:swimming_pool');
  });

  it('stays on the home view with no deep link', () => {
    mount(null);
    expect(screen.getByText('Start Session')).toBeTruthy();
  });

  it('ignores a half-formed payload rather than routing somewhere wrong', () => {
    mount({ mode: 'running' });
    expect(screen.getByText('Start Session')).toBeTruthy();
  });

  it('reports the link consumed, so backing out does not bounce forward again', () => {
    const onConsumed = vi.fn();
    mount({ mode: 'running', env: 'outside' }, onConsumed);
    expect(onConsumed).toHaveBeenCalledTimes(1);
  });
});
