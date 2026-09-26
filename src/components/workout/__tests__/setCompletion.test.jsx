// The set rows as rebuilt in the logger redesign: a Previous column that
// copies last session's numbers into the row, a check that finishes the
// exercise on its own once every set is ticked, and no separate
// "Complete exercise" button asking for a second confirmation.

import React, { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@/test/utils';
import ExerciseLogger from '../ExerciseLogger';
import { LanguageProvider } from '@/lib/LanguageContext';
import { WeightUnitProvider } from '@/lib/WeightUnitContext';
import { RestTimerProvider } from '@/lib/RestTimerContext';

vi.mock('@/lib/data/gymBusinesses', () => ({ listMyGyms: vi.fn(async () => []) }));
vi.mock('@/lib/data/gymCheckins', () => ({ getTodayCheckinGymId: vi.fn(async () => null) }));
vi.mock('@/lib/data/equipment', () => ({
  listGymFloor: vi.fn(async () => []),
  persistEquipmentPhoto: vi.fn(async () => null),
}));

beforeEach(() => {
  localStorage.clear();
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation(q => ({
      matches: false, media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }
});

function Host({ initial, logs = [] }) {
  const [ex, setEx] = useState(initial);
  return (
    <LanguageProvider><WeightUnitProvider><RestTimerProvider>
      <div data-testid="state">{JSON.stringify({ sets: ex.sets, completed: !!ex.completed })}</div>
      <ExerciseLogger exercise={ex} onChange={setEx} workoutLogs={logs} userProfile={{ id: 'u1' }} />
    </RestTimerProvider></WeightUnitProvider></LanguageProvider>
  );
}
const state = () => JSON.parse(screen.getByTestId('state').textContent);

const logs = [{
  date: '2026-09-20',
  exercises: [{ name: 'Curl', sets: [{ weight: 30, reps: 12 }, { weight: 35, reps: 10 }] }],
}];

describe('Previous column', () => {
  it('shows last session per set and copies it into the row on tap', async () => {
    render(<Host initial={{ name: 'Curl', sets: [{ weight: 20, reps: 5 }, { weight: 20, reps: 5 }] }} logs={logs} />);
    const prev = await screen.findByRole('button', { name: /35 × 10/ });
    fireEvent.click(prev);
    expect(state().sets[1]).toMatchObject({ weight: 35, reps: 10 });
    expect(state().sets[0]).toMatchObject({ weight: 20, reps: 5 });
  });
});

describe('finishing an exercise', () => {
  it('has no Complete exercise button', async () => {
    render(<Host initial={{ name: 'Curl', sets: [{ weight: 20, reps: 5 }] }} />);
    await screen.findByRole('button', { name: /complete set/i });
    expect(screen.queryByRole('button', { name: /complete exercise/i })).toBeNull();
  });

  it('folds on its own once the last set is checked', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Host initial={{ name: 'Curl', sets: [{ weight: 20, reps: 5, completed: true }, { weight: 20, reps: 5 }] }} />);
      fireEvent.click(await screen.findByRole('button', { name: /^complete set/i }));
      expect(state().completed).toBe(false);
      await act(async () => { vi.advanceTimersByTime(1000); });
      expect(state().completed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not snap shut again after it is reopened', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Host initial={{ name: 'Curl', completed: true, sets: [{ weight: 20, reps: 5, completed: true }] }} />);
      fireEvent.click(await screen.findByRole('button', { name: /edit/i }));
      await act(async () => { vi.advanceTimersByTime(1500); });
      expect(state().completed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
