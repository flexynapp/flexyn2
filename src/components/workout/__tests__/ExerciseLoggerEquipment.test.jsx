// Tests for the equipment-aware behavior ExerciseLogger gained across
// Phases 2–6.
//
// The bar-selector gating is the one worth guarding hardest. The
// isBarbell name regex has to be broad enough to catch "Bench Press"
// and "Pendlay Row", which means it also matches "Leg Press" — so a leg
// press used to offer a barbell weight picker AND a plate diagram. That
// was pre-existing and merely odd; once the user can explicitly say
// "this is a Life Fitness leg press machine", it becomes a direct
// contradiction on screen. Found by actually looking at the rendered
// component, not by a test.

import React, { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/utils';
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

function mount(exercise, workoutLogs = []) {
  const onChange = vi.fn();
  const utils = render(
    <LanguageProvider><WeightUnitProvider><RestTimerProvider>
      <ExerciseLogger
        exercise={exercise}
        onChange={onChange}
        workoutLogs={workoutLogs}
        userProfile={{ id: 'u1' }}
      />
    </RestTimerProvider></WeightUnitProvider></LanguageProvider>
  );
  return { ...utils, onChange };
}

// Bar weight, the machine and the recent-sessions history moved off the card
// face into the Setup sheet behind the pill under the exercise name.
async function openSetup() {
  fireEvent.click(await screen.findByRole('button', { name: /^Setup:/ }));
  await screen.findByRole('heading', { name: / setup$/i });
}

const legPress = (equipment) => ({
  name: 'Leg Press', muscle_groups: ['Quads'],
  sets: [{ weight: 300, reps: 10 }],
  ...(equipment ? { equipment } : {}),
});

describe('bar-weight selector gating (in the Setup sheet)', () => {
  it('still shows for a real barbell lift', async () => {
    mount({ name: 'Bench Press', muscle_groups: ['Chest'], sets: [{ weight: 185, reps: 5 }] });
    await openSetup();
    expect(screen.getByLabelText(/barbell weight/i)).toBeInTheDocument();
  });

  it('shows on a Leg Press with no equipment chosen — unchanged behavior', async () => {
    // The name regex matches "press". Without an explicit choice we have
    // nothing better to go on, so this stays as it was.
    mount(legPress(null));
    await openSetup();
    expect(screen.getByLabelText(/barbell weight/i)).toBeInTheDocument();
  });

  it('disappears once the user says it is a machine', async () => {
    mount(legPress({
      brand: 'hammer_strength', line: 'Plate Loaded', model: 'Super Squat Press',
      implementType: 'leg_press', label: 'Hammer Strength Plate Loaded Super Squat Press',
    }));
    await openSetup();
    expect(screen.queryByLabelText(/barbell weight/i)).toBeNull();
  });

  it('stays when the chosen implement really is a barbell', async () => {
    mount({
      name: 'Bench Press', muscle_groups: ['Chest'], sets: [{ weight: 185, reps: 5 }],
      equipment: { brand: 'rogue', line: 'Ohio Bar', model: null, implementType: 'barbell', label: 'Rogue Ohio Bar' },
    });
    await openSetup();
    expect(screen.getByLabelText(/barbell weight/i)).toBeInTheDocument();
  });

  it('disappears for a cable choice too', async () => {
    mount({
      name: 'Cable Chest Press', muscle_groups: ['Chest'], sets: [{ weight: 60, reps: 12 }],
      equipment: { brand: 'unknown', line: null, model: null, implementType: 'cable_station', label: 'Cable station' },
    });
    await openSetup();
    expect(screen.queryByLabelText(/barbell weight/i)).toBeNull();
  });

  it('is unaffected by an implement type we do not recognise', async () => {
    mount(legPress({ implementType: 'not_a_real_type', label: 'Mystery machine' }));
    await openSetup();
    // Unknown kind resolves to null, which means "no opinion" — the name
    // regex keeps its existing behavior rather than the control vanishing.
    expect(screen.getByLabelText(/barbell weight/i)).toBeInTheDocument();
  });
});

describe('the equipment picker, from the Setup sheet', () => {
  // The chip beside the title is gone; the Setup sheet's Equipment row is
  // the way in, and choosing a machine still lands on the exercise.
  it('opens from the Equipment row and saves the pick', async () => {
    const { onChange } = mount(legPress(null));
    expect(screen.queryByText(/add equipment/i)).toBeNull();
    await openSetup();
    fireEvent.click(screen.getByRole('button', { name: /choose equipment/i }));
    fireEvent.click(await screen.findByText(/Super Squat Press/i));
    const call = onChange.mock.calls.find(c => /Super Squat Press/.test(c[0]?.equipment?.label || ''));
    expect(call).toBeTruthy();
  });

  it('names the chosen machine on the pill when there is no bar to show', async () => {
    mount({
      name: 'Cable Chest Press', muscle_groups: ['Chest'], sets: [{ weight: 60, reps: 12 }],
      equipment: { brand: 'unknown', line: null, model: null, implementType: 'cable_station', label: 'Cable station' },
    });
    expect(await screen.findByRole('button', { name: 'Setup: Cable station' })).toBeInTheDocument();
  });
});

describe('prefill from history', () => {
  const logs = [{
    date: '2026-07-20',
    exercises: [{
      name: 'Leg Press',
      equipment: { brand: 'cybex', line: 'Eagle', model: null, implementType: 'leg_press', label: 'Cybex Eagle' },
      sets: [{ weight: 300, reps: 10 }],
    }],
  }];

  it('fills the picker from the last logged session', () => {
    const { onChange } = mount(legPress(null), logs);
    const call = onChange.mock.calls.find(c => c[0]?.equipment);
    expect(call).toBeTruthy();
    expect(call[0].equipment.label).toBe('Cybex Eagle');
  });

  it('never overwrites an explicit choice', () => {
    const chosen = {
      brand: 'hammer_strength', line: 'Plate Loaded', model: 'Super Squat Press',
      implementType: 'leg_press', label: 'Hammer Strength Plate Loaded Super Squat Press',
    };
    const { onChange } = mount(legPress(chosen), logs);
    const overwritten = onChange.mock.calls.find(
      c => c[0]?.equipment && c[0].equipment.label !== chosen.label
    );
    expect(overwritten).toBeUndefined();
  });

  it('does nothing when the exercise has no history', () => {
    const { onChange } = mount(legPress(null), []);
    expect(onChange.mock.calls.find(c => c[0]?.equipment)).toBeUndefined();
  });
});

describe('the machine in the history line', () => {
  it('names the machine when it changed between sessions', async () => {
    const logs = [
      { date: '2026-07-20', exercises: [{ name: 'Seated Row', equipment: { implementType: 'seated_row', label: 'Hammer Strength Row' }, sets: [{ weight: 185, reps: 8 }] }] },
      { date: '2026-07-13', exercises: [{ name: 'Seated Row', equipment: { implementType: 'seated_row', label: 'Cybex Eagle' }, sets: [{ weight: 160, reps: 8 }] }] },
    ];
    mount({ name: 'Seated Row', muscle_groups: ['Back'], sets: [{ weight: 185, reps: 8 }] }, logs);
    await openSetup();
    expect(screen.getByText(/Hammer Strength Row/)).toBeInTheDocument();
    expect(screen.getByText(/Cybex Eagle/)).toBeInTheDocument();
  });

  it('does not repeat an unchanged machine on every line', async () => {
    const same = { implementType: 'seated_row', label: 'Hammer Strength Row' };
    const logs = [
      { date: '2026-07-20', exercises: [{ name: 'Seated Row', equipment: same, sets: [{ weight: 185, reps: 8 }] }] },
      { date: '2026-07-13', exercises: [{ name: 'Seated Row', equipment: same, sets: [{ weight: 180, reps: 8 }] }] },
      { date: '2026-07-06', exercises: [{ name: 'Seated Row', equipment: same, sets: [{ weight: 175, reps: 8 }] }] },
    ];
    mount({ name: 'Seated Row', muscle_groups: ['Back'], sets: [{ weight: 185, reps: 8 }] }, logs);
    await openSetup();
    // Once in the history block (the oldest line, where it "changed"
    // from nothing) plus at most once more in the sheet, never on all three.
    expect(screen.getAllByText(/Hammer Strength Row/).length).toBeLessThanOrEqual(2);
  });
});

describe('seeding does not clobber itself', () => {
  // Regression guard. The warm-up seed and the machine prefill were two
  // separate effects that fired in the same commit, each spreading the
  // same stale `exercise` — so the second silently discarded the first.
  // The machine landed; the warm-up set vanished. Needs a STATEFUL
  // parent to catch: with a vi.fn() onChange both calls look fine, and
  // only the last one actually reaches the component tree.
  function Host({ initial, logs }) {
    const [ex, setEx] = useState(initial);
    return (
      <LanguageProvider><WeightUnitProvider><RestTimerProvider>
        <div data-testid="state">{JSON.stringify({ sets: ex.sets, eq: ex.equipment?.label ?? null })}</div>
        <ExerciseLogger exercise={ex} onChange={setEx} workoutLogs={logs} userProfile={{ id: 'u1' }} />
      </RestTimerProvider></WeightUnitProvider></LanguageProvider>
    );
  }

  const logs = [{
    date: '2026-07-20',
    exercises: [{
      name: 'Seated Row',
      equipment: { brand: 'cybex', line: 'Eagle', model: null, implementType: 'seated_row', label: 'Cybex Eagle' },
      sets: [{ weight: 200, reps: 8 }],
    }],
  }];

  it('keeps both the seeded warm-up set and the prefilled machine', () => {
    render(<Host initial={{ name: 'Seated Row', muscle_groups: ['Back'], sets: [{ weight: null, reps: null }] }} logs={logs} />);
    const state = JSON.parse(screen.getByTestId('state').textContent);
    expect(state.eq, 'machine should be prefilled').toBe('Cybex Eagle');
    expect(state.sets[0].weight, 'warm-up seed should survive').not.toBeNull();
    expect(state.sets[0].is_warmup, '200lb top set seeds a warm-up').toBe(true);
  });

  it('still seeds the machine when sets are already filled in', () => {
    render(<Host initial={{ name: 'Seated Row', muscle_groups: ['Back'], sets: [{ weight: 185, reps: 8 }] }} logs={logs} />);
    const state = JSON.parse(screen.getByTestId('state').textContent);
    expect(state.eq).toBe('Cybex Eagle');
    expect(state.sets[0].weight).toBe(185);
  });
});
