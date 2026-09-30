// The dialog after a saved workout is the finish screen: what the session
// was worth, then the share card. The numbers must be the session's own,
// and a duration nobody recorded must not render as "0 min".

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkoutShareCard from '../WorkoutShareCard';

vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});
vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => ({ weightUnit: 'lbs' }) }));
vi.mock('@/lib/DistanceUnitContext', () => ({ useDistanceUnit: () => ({ distanceUnit: 'km' }) }));
vi.mock('@/lib/analytics', () => ({ track: () => {}, EVENTS: {} }));

HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({ width: 0 }) });
HTMLCanvasElement.prototype.toBlob = function toBlob() {};

const WORKOUT = {
  date: '2026-09-26',
  exercises: [
    { name: 'Bench Press', sets: [{ weight: 135, reps: 8 }, { weight: 135, reps: 8 }] },
    { name: 'Row', sets: [{ weight: 100, reps: 10 }] },
  ],
};

describe('the finish screen', () => {
  it('shows what the session was worth', () => {
    render(<WorkoutShareCard open workout={WORKOUT} onClose={() => {}}
      summary={{ xpGained: 120, prs: [{ name: 'bench press', displayName: 'Bench Press' }] }} />);
    expect(screen.getByText('Workout complete')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();           // sets
    expect(screen.getByText('3,160 lb')).toBeTruthy();    // 135*8*2 + 100*10
    expect(screen.getByText('+120 XP')).toBeTruthy();
    expect(screen.getByText('New PR: Bench Press')).toBeTruthy();
  });

  it('leaves out a duration nobody recorded rather than showing 0', () => {
    render(<WorkoutShareCard open workout={WORKOUT} onClose={() => {}} summary={{ xpGained: 0, prs: [] }} />);
    expect(screen.queryByText('Time')).toBeNull();
    expect(screen.queryByText(/XP/)).toBeNull();
  });

  it('counts a run by its distance and time, never as sets', () => {
    const run = { kind: 'cardio', activity: 'running', name: 'Running', sets: [], segments: [{ duration_s: 1500, distance_m: 5100 }] };
    render(<WorkoutShareCard open workout={{ ...WORKOUT, exercises: [...WORKOUT.exercises, run] }} onClose={() => {}}
      summary={{ xpGained: 0, prs: [] }} />);
    expect(screen.getByText('3')).toBeTruthy();           // sets: the run adds none
    expect(screen.getByText('5.1 km')).toBeTruthy();
    expect(screen.getByText('25 min')).toBeTruthy();      // the run's time, with no stated duration
  });

  it('shows a run-only session without a zero sets cell', () => {
    const run = { kind: 'cardio', activity: 'running', name: 'Running', sets: [], segments: [{ duration_s: 1800, distance_m: 5000 }] };
    render(<WorkoutShareCard open workout={{ date: '2026-09-26', exercises: [run] }} onClose={() => {}}
      summary={{ xpGained: 0, prs: [] }} />);
    expect(screen.getByText('5 km')).toBeTruthy();
    expect(screen.queryByText('Sets')).toBeNull();
  });

  it('Done closes it', () => {
    const onClose = vi.fn();
    render(<WorkoutShareCard open workout={WORKOUT} onClose={onClose} summary={{ xpGained: 10, prs: [] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('is still a plain share dialog when opened without a summary', () => {
    render(<WorkoutShareCard open workout={WORKOUT} onClose={() => {}} />);
    expect(screen.getByText('Share your workout')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  });
});
