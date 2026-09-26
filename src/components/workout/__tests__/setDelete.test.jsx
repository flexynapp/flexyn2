// Deleting a set: the labelled Delete in the set's ⋯ drawer and the swipe
// both go through ExerciseLogger's removeSet, which must offer Undo and put
// the set back where it was, without undoing anything typed since.

import React, { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@/test/utils';
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
const sets = () => JSON.parse(screen.getByTestId('state').textContent);

const three = { name: 'Curl', sets: [
  { _key: 'a', weight: 20, reps: 5 },
  { _key: 'b', weight: 25, reps: 6 },
  { _key: 'c', weight: 30, reps: 7 },
] };

async function deleteSet(n) {
  const more = await screen.findAllByRole('button', { name: /more set options/i });
  fireEvent.click(more[n]);
  fireEvent.click(await screen.findByRole('button', { name: /delete set/i }));
}

describe('deleting a set', () => {
  it('shows a labelled Delete set, not a bare icon, in the ⋯ drawer', async () => {
    render(<Host initial={three} />);
    const more = await screen.findAllByRole('button', { name: /more set options/i });
    fireEvent.click(more[0]);
    const del = await screen.findByRole('button', { name: /delete set/i });
    expect(del.textContent).toMatch(/delete set/i);
  });

  it('removes the set and offers Undo that restores it in place', async () => {
    render(<Host initial={three} />);
    await deleteSet(1);
    expect(sets().map(s => s._key)).toEqual(['a', 'c']);

    const call = toastCalls.find(c => c[0] === 'success');
    expect(call[1]).toMatch(/set 2 deleted/i);
    expect(call[2].action.label).toMatch(/undo/i);

    await act(async () => { call[2].action.onClick(); });
    expect(sets().map(s => s._key)).toEqual(['a', 'b', 'c']);
  });

  it('Undo keeps edits made to other sets after the delete', async () => {
    render(<Host initial={three} />);
    await deleteSet(0);
    const call = toastCalls.find(c => c[0] === 'success');
    // Let the deleted row finish its exit animation, then tick the (now
    // first) remaining set before undoing.
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^complete set/i })).toHaveLength(2));
    const done = screen.getAllByRole('button', { name: /^complete set/i });
    fireEvent.click(done[0]);
    await act(async () => { call[2].action.onClick(); });
    const now = sets();
    expect(now.map(s => s._key)).toEqual(['a', 'b', 'c']);
    expect(now[1].completed).toBe(true);
  });
});
