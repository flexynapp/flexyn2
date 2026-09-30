// Today's goal row, at the top of the "To do" block: ask for a goal when there
// is none, name the closest one otherwise, and read Done once it is hit.
// Goals complete themselves on the server, so there is no button to press.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const ACTIVITY = { 'goals.activity.running': 'Running' };
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => ACTIVITY[k] ?? k,
    tFallback: (_k, en, vars) => (vars ? en.replace(/\{(\w+)\}/g, (_, n) => vars[n]) : en),
  }),
}));
vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => ({ weightUnit: 'lbs' }) }));
let mockDistanceUnit = 'km';
vi.mock('@/lib/DistanceUnitContext', () => ({ useDistanceUnit: () => ({ distanceUnit: mockDistanceUnit }) }));
// Only the progress figure is faked; the title and target are the real
// helpers, because naming the goal is what the row is tested for.
vi.mock('@/lib/goalProgress', async (importOriginal) => ({
  ...(await importOriginal()),
  goalProgress: (g) => g._p,
}));

import TodayGoalCard from '../TodayGoalCard';

const goal = (name, p, status = 'active') => ({ id: name, exercise_name: name, status, _p: p });

describe('TodayGoalCard', () => {
  it('asks for a goal when none is active, and opens the form', () => {
    const onCreate = vi.fn();
    render(<TodayGoalCard goals={[goal('Squat', 100, 'completed')]} onCreate={onCreate} />);
    fireEvent.click(screen.getByText('Set a goal'));
    expect(onCreate).toHaveBeenCalled();
  });

  it('names the closest goal and counts the rest', async () => {
    render(<TodayGoalCard goals={[goal('Bench', 20), goal('Deadlift', 60), goal('Row', 5)]} />);
    expect(screen.getByText('Deadlift')).toBeTruthy();
    // The percentage counts up to its value, so wait for it to land.
    expect(await screen.findByText('60%')).toBeTruthy();
    expect(screen.getByText('2 more goals')).toBeTruthy();
  });

  it('says "Not started" rather than 0%', () => {
    render(<TodayGoalCard goals={[goal('Bench', 0)]} />);
    expect(screen.getByText('Not started')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('keeps showing a goal past 75%, not Done until it is hit', () => {
    render(<TodayGoalCard goals={[goal('Bench', 80), goal('Row', 10)]} />);
    expect(screen.getByText('Bench')).toBeTruthy();
    expect(screen.queryByText('Done')).toBeNull();
  });

  it('reads Done at 100% with no button to complete it, and the row still opens goals', () => {
    const onOpen = vi.fn();
    render(<TodayGoalCard goals={[goal('Bench', 100)]} onOpen={onOpen} />);
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Open goals' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('names a cardio goal by its label, never the stored slug, in the reader distance unit', () => {
    const run = { id: 'r', status: 'active', goal_type: 'cardio_distance', cardio_activity: 'running', target_distance_meters: 5000, _p: 40 };
    mockDistanceUnit = 'km';
    const { unmount } = render(<TodayGoalCard goals={[run]} />);
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.queryByText(/running/)).toBeNull();
    expect(screen.queryByText(/5000/)).toBeNull();
    expect(screen.getByText(/^5(\.0)? km$/)).toBeTruthy();
    unmount();
    mockDistanceUnit = 'mi';
    render(<TodayGoalCard goals={[run]} />);
    expect(screen.getByText(/^3\.1 mi$/)).toBeTruthy();
    mockDistanceUnit = 'km';
  });

  it('shows a strength goal as the lift with its target', () => {
    render(<TodayGoalCard goals={[{ id: 'b', status: 'active', exercise_name: 'Bench Press', target_weight: 225, target_reps: 5, _p: 30 }]} />);
    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText(/225.*× 5/)).toBeTruthy();
  });
});
