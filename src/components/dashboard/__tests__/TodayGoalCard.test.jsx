// Today's goal row, at the top of the "To do" block: ask for a goal when there
// is none, name the closest one otherwise, and offer Complete once it is hit.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    tFallback: (_k, en, vars) => (vars ? en.replace(/\{(\w+)\}/g, (_, n) => vars[n]) : en),
  }),
}));
vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => ({ weightUnit: 'lbs' }) }));
vi.mock('@/lib/goalProgress', () => ({
  isCardioGoal: () => false,
  computeCardioGoalProgress: () => ({ progress: 0 }),
  computeStrengthGoalProgress: (g) => ({ progress: g._p }),
}));
vi.mock('@/lib/goalSummary', () => ({ summarizeGoalTarget: (g) => g.exercise_name }));

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

  it('keeps showing a goal past 75%, with no Complete until it is hit', () => {
    render(<TodayGoalCard goals={[goal('Bench', 80), goal('Row', 10)]} />);
    expect(screen.getByText('Bench')).toBeTruthy();
    expect(screen.queryByText('Complete')).toBeNull();
  });

  it('offers Complete at 100%, which opens goals', () => {
    const onOpen = vi.fn();
    render(<TodayGoalCard goals={[goal('Bench', 100)]} onOpen={onOpen} />);
    fireEvent.click(screen.getByText('Complete'));
    expect(onOpen).toHaveBeenCalled();
  });
});
