// Today's goal slot: ask for a goal when there is none, name the closest
// one otherwise, and step aside for GoalsAlmostComplete at 75%+.

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

  it('names the closest goal and counts the rest', () => {
    render(<TodayGoalCard goals={[goal('Bench', 20), goal('Deadlift', 60), goal('Row', 5)]} />);
    expect(screen.getByText('Deadlift')).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();
    expect(screen.getByText('2 more goals')).toBeTruthy();
  });

  it('says "Not started" rather than 0%', () => {
    render(<TodayGoalCard goals={[goal('Bench', 0)]} />);
    expect(screen.getByText('Not started')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('renders nothing once a goal is 75% there, where the Complete card takes over', () => {
    const { container } = render(<TodayGoalCard goals={[goal('Bench', 80), goal('Row', 10)]} />);
    expect(container.textContent).toBe('');
  });
});
