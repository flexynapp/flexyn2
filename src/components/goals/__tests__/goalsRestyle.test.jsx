/**
 * Goals restyle (2026-09-27, option B). Pins the three defects the audit
 * found in the sheet itself:
 *   • cardio goals read 0% because the sheet was never handed cardio logs
 *   • Edit on a cardio goal opened with its target blank
 *   • "225 × 5" summed reps across sessions instead of meaning one set
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/lib/LanguageContext';

vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => ({ weightUnit: 'lbs' }) }));
vi.mock('@/lib/DistanceUnitContext', () => ({ useDistanceUnit: () => ({ distanceUnit: 'km' }) }));
vi.mock('@/lib/SettingsContext', () => ({ useSettings: () => ({ allowDeleteCompletedGoals: true }) }));
vi.mock('@/lib/haptic', () => ({ triggerHaptic: vi.fn() }));
vi.mock('@/components/regimens/ExerciseAutocomplete', () => ({
  default: ({ value }) => <input aria-label="exercise" defaultValue={value} />,
}));

import GoalsList from '@/components/goals/GoalsList';
import GoalForm from '@/components/goals/GoalForm';

const CREATED = '2026-09-01T00:00:00Z';
const AFTER = '2026-09-10T00:00:00Z';

const wrap = (ui) => render(
  <MemoryRouter><LanguageProvider>{ui}</LanguageProvider></MemoryRouter>,
);

afterEach(cleanup);

describe('Goals list', () => {
  it('reads a cardio goal from cardio logs instead of showing 0', async () => {
    const goal = {
      id: 'c1', status: 'active', goal_type: 'cardio_distance', cardio_activity: 'running',
      period: 'lifetime', target_distance_meters: 20000, created_date: CREATED,
    };
    const cardioLogs = [
      { created_date: AFTER, type: 'running_outside', distance_meters: 8000 },
      { created_date: AFTER, type: 'running_outside', distance_meters: 4400 },
    ];
    wrap(<GoalsList goals={[goal]} logs={[]} cardioLogs={cardioLogs} />);
    expect(await screen.findByText(/12\.4 km/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '62');
    expect(screen.getByText(/7\.6 km to go/)).toBeInTheDocument();
  });

  it('shows the one set closest to a weight × reps target', async () => {
    const goal = {
      id: 's1', status: 'active', goal_type: 'strength', exercise_name: 'Bench Press',
      target_weight: 225, target_reps: 5, created_date: CREATED,
    };
    const logs = [{ created_date: AFTER, exercises: [{ name: 'Bench Press', sets: [
      { weight: 225, reps: 1 }, { weight: 225, reps: 1 }, { weight: 225, reps: 1 },
      { weight: 225, reps: 1 }, { weight: 225, reps: 1 }, { weight: 215, reps: 5 },
    ]}]}];
    wrap(<GoalsList goals={[goal]} logs={logs} cardioLogs={[]} />);
    expect(await screen.findByText(/215 × 5/)).toBeInTheDocument();
    expect(screen.getByText(/10 lbs? to go/)).toBeInTheDocument();
    // Five singles at 225 no longer add up to a set of five.
    expect(screen.queryByText(/Target hit/)).toBeNull();
  });

  it('offers Mark done only once the target is hit', async () => {
    const goal = {
      id: 's2', status: 'active', goal_type: 'strength', exercise_name: 'Pull-ups',
      target_reps: 10, created_date: CREATED,
    };
    const logs = [{ created_date: AFTER, exercises: [{ name: 'Pull-ups', sets: [{ weight: 0, reps: 10 }] }] }];
    wrap(<GoalsList goals={[goal]} logs={logs} cardioLogs={[]} onComplete={vi.fn()} />);
    expect(await screen.findByText(/Target hit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark done/ })).toBeInTheDocument();
  });
});

describe('Goal form', () => {
  it('opens a cardio goal with its saved target filled in', async () => {
    const goal = {
      id: 'c2', status: 'active', goal_type: 'cardio_distance', cardio_activity: 'running',
      period: 'month', target_distance_meters: 20000,
    };
    wrap(<GoalForm initial={goal} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByDisplayValue('20')).toBeInTheDocument();
  });

  it('opens a duration goal split into hours and minutes', async () => {
    const goal = {
      id: 'c3', status: 'active', goal_type: 'cardio_duration', cardio_activity: 'any',
      period: 'week', target_duration_seconds: 5400,
    };
    wrap(<GoalForm initial={goal} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByDisplayValue('1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('30')).toBeInTheDocument();
  });
});
