// Plates and the "you are here" outline belong to the set about to be
// lifted. A plate diagram under every row doubled each row's height, so an
// iPhone SE showed about two sets before scrolling.

import React, { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/utils';
import ExerciseLogger from '../ExerciseLogger';
import { LanguageProvider } from '@/lib/LanguageContext';
import { WeightUnitProvider } from '@/lib/WeightUnitContext';
import { RestTimerProvider } from '@/lib/RestTimerContext';

const toastCalls = vi.hoisted(() => []);
vi.mock('@/lib/toast', () => {
  const t = vi.fn();
  for (const k of ['success', 'info', 'message', 'warning', 'error', 'dismiss']) {
    t[k] = vi.fn((...args) => { toastCalls.push([k, ...args]); });
  }
  return { toast: t, default: t };
});
vi.mock('@/lib/data/gymBusinesses', () => ({ listMyGyms: vi.fn(async () => []) }));
vi.mock('@/lib/data/gymCheckins', () => ({ getTodayCheckinGymId: vi.fn(async () => null) }));
vi.mock('@/lib/data/equipment', () => ({
  listGymFloor: vi.fn(async () => []),
  persistEquipmentPhoto: vi.fn(async () => null),
}));

beforeEach(() => {
  localStorage.clear();
  toastCalls.length = 0;
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation(q => ({
      matches: false, media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }
});

function Host({ initial }) {
  const [ex, setEx] = useState(initial);
  return (
    <LanguageProvider><WeightUnitProvider><RestTimerProvider>
      <div data-testid="state">{JSON.stringify(ex.sets)}</div>
      <ExerciseLogger exercise={ex} onChange={setEx} workoutLogs={[]} userProfile={{ id: 'u1' }} />
    </RestTimerProvider></WeightUnitProvider></LanguageProvider>
  );
}

const bench = { name: 'Bench Press', sets: [
  { _key: 'a', weight: 135, reps: 10, completed: true },
  { _key: 'b', weight: 155, reps: 8 },
  { _key: 'c', weight: 165, reps: 6 },
] };
const plateLabels = () => screen.queryAllByText(/· 45 bar/);

describe('the next set', () => {
  it('is the only row with a plate diagram', async () => {
    render(<Host initial={bench} />);
    await screen.findAllByRole('button', { name: /more set options/i });
    expect(plateLabels()).toHaveLength(1);
    expect(plateLabels()[0].textContent).toMatch(/1×45 \+ 1×10/); // 155 lb
  });

  it('moves the plates on when that set is checked', async () => {
    render(<Host initial={bench} />);
    const checks = await screen.findAllByRole('button', { name: 'Complete set' });
    fireEvent.click(checks[0]);
    await waitFor(() => expect(plateLabels()[0].textContent).toMatch(/1×45 \+ 1×10 \+ 1×5/)); // 165 lb
    expect(plateLabels()).toHaveLength(1);
  });

  it('is outlined once the exercise is under way, and not before', async () => {
    const { unmount } = render(<Host initial={bench} />);
    await screen.findAllByRole('button', { name: /more set options/i });
    expect(document.querySelectorAll('[data-set-row] .ring-primary\\/50')).toHaveLength(1);
    unmount();
    render(<Host initial={{ ...bench, sets: bench.sets.map(s => ({ ...s, completed: false })) }} />);
    await screen.findAllByRole('button', { name: /more set options/i });
    expect(document.querySelectorAll('[data-set-row] .ring-primary\\/50')).toHaveLength(0);
  });
});
