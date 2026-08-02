import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CoachPlanCard from '../coach/CoachPlanCard';

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }));
// StarterPlanView is the READ view; these tests are about the edit view.
vi.mock('@/components/workout/StarterPlanView', () => ({
  default: ({ regimen }) => (
    <div data-testid="read-view">{(regimen.exercises || []).map(e => e.name).join('|')}</div>
  ),
}));

const set = (weight, reps) => ({ weight, reps });

/** A session in generateWorkout's shape, with swap candidates attached. */
function makePlan() {
  const workout = {
    title: 'Full Body · 45 min',
    focus: 'full_body',
    duration_minutes: 45,
    exercises: [
      {
        name: 'Bench Press', group: 'chest', restSec: 120, note: '',
        sets: [set(135, 8), set(135, 8), set(135, 8)],
        alternatives: [
          { name: 'Incline Dumbbell Press', group: 'chest', restSec: 120, note: '', sets: [set(50, 8), set(50, 8), set(50, 8)] },
          { name: 'Push-up', group: 'chest', restSec: 75, note: '', sets: [set(0, 12), set(0, 12), set(0, 12)] },
        ],
      },
      {
        name: 'Plank', group: 'core', restSec: 75, note: '',
        sets: [set(0, 14), set(0, 14), set(0, 14)],
        alternatives: [],
      },
    ],
  };
  return {
    kind: 'session',
    title: workout.title,
    subtitle: '2 exercises · 45 min',
    exercises: workout.exercises.map(e => ({ name: e.name, displayName: e.name, kind: 'strength' })),
    regimenPayload: { name: workout.title, exercises: workout.exercises.map(e => ({ name: e.name })) },
    workout,
    goal: 'general',
    label: 'train',
    parsed: { goal: 'general', equipment: 'gym', durationMinutes: 45 },
  };
}

/** Render, re-rendering on every onPlanChange so the card behaves as it does in chat. */
function renderCard(overrides = {}) {
  const onPlanChange = vi.fn();
  let plan = makePlan();
  const view = render(
    <MemoryRouter><CoachPlanCard plan={plan} onPlanChange={onPlanChange} {...overrides} /></MemoryRouter>,
  );
  const rerenderWithLatest = () => {
    plan = onPlanChange.mock.calls.at(-1)[0];
    view.rerender(
      <MemoryRouter><CoachPlanCard plan={plan} onPlanChange={onPlanChange} {...overrides} /></MemoryRouter>,
    );
    return plan;
  };
  return { onPlanChange, rerenderWithLatest, getPlan: () => plan };
}

const enterEditMode = () => fireEvent.click(screen.getByRole('button', { name: /edit workout/i }));
const rowFor = (name) => screen.getByText(name).closest('div').parentElement;

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('CoachPlanCard — editing a session in chat', () => {
  it('shows the read view until Edit is tapped', () => {
    renderCard();
    expect(screen.getByTestId('read-view')).toBeTruthy();
    enterEditMode();
    expect(screen.queryByTestId('read-view')).toBeNull();
    expect(screen.getByRole('button', { name: /finish editing/i })).toBeTruthy();
  });

  it('swaps an exercise for a same-group candidate', () => {
    const { onPlanChange, rerenderWithLatest } = renderCard();
    enterEditMode();
    fireEvent.click(screen.getByRole('button', { name: /swap Bench Press/i }));

    const plan = onPlanChange.mock.calls.at(-1)[0];
    expect(plan.workout.exercises[0].name).toBe('Incline Dumbbell Press');
    expect(plan.workout.exercises[0].group).toBe('chest');
    // Every representation moved together.
    expect(plan.exercises[0].name).toBe('Incline Dumbbell Press');
    expect(plan.regimenPayload.exercises[0].name).toBe('Incline Dumbbell Press');
    rerenderWithLatest();
    expect(screen.getByText('Incline Dumbbell Press')).toBeTruthy();
  });

  it('cycles back to the original rather than stranding the user', () => {
    const { onPlanChange, rerenderWithLatest } = renderCard();
    enterEditMode();
    // 2 alternatives + the original = a 3-stop loop.
    for (let i = 0; i < 3; i++) {
      const btn = screen.getAllByRole('button', { name: /^swap /i })[0];
      fireEvent.click(btn);
      rerenderWithLatest();
    }
    expect(onPlanChange.mock.calls.at(-1)[0].workout.exercises[0].name).toBe('Bench Press');
  });

  it('disables swap for an exercise with no candidates', () => {
    renderCard();
    enterEditMode();
    expect(screen.getByRole('button', { name: /swap Plank/i }).disabled).toBe(true);
  });

  it('removes an exercise', () => {
    const { onPlanChange } = renderCard();
    enterEditMode();
    fireEvent.click(screen.getByRole('button', { name: /remove Plank/i }));
    const plan = onPlanChange.mock.calls.at(-1)[0];
    expect(plan.workout.exercises.map(e => e.name)).toEqual(['Bench Press']);
    expect(plan.regimenPayload.exercises.map(e => e.name)).toEqual(['Bench Press']);
    expect(plan.subtitle).toContain('1 exercise');
  });

  it('refuses to remove the last exercise', () => {
    const { rerenderWithLatest } = renderCard();
    enterEditMode();
    fireEvent.click(screen.getByRole('button', { name: /remove Plank/i }));
    rerenderWithLatest();
    // One left — an empty session is not startable or savable.
    expect(screen.getByRole('button', { name: /remove Bench Press/i }).disabled).toBe(true);
  });

  it('adds and drops working sets within the generator\'s own clamp', () => {
    const { onPlanChange, rerenderWithLatest } = renderCard();
    enterEditMode();
    fireEvent.click(screen.getByRole('button', { name: /one more set of Bench Press/i }));
    expect(onPlanChange.mock.calls.at(-1)[0].workout.exercises[0].sets).toHaveLength(4);
    rerenderWithLatest();

    fireEvent.click(screen.getByRole('button', { name: /one more set of Bench Press/i }));
    rerenderWithLatest();
    // 5 is generateWorkout's own ceiling; the control stops there.
    expect(onPlanChange.mock.calls.at(-1)[0].workout.exercises[0].sets).toHaveLength(5);
    expect(screen.getByRole('button', { name: /one more set of Bench Press/i }).disabled).toBe(true);
  });

  it('copies the existing prescription onto an added set', () => {
    const { onPlanChange } = renderCard();
    enterEditMode();
    fireEvent.click(screen.getByRole('button', { name: /one more set of Bench Press/i }));
    const sets = onPlanChange.mock.calls.at(-1)[0].workout.exercises[0].sets;
    expect(sets.at(-1)).toEqual({ weight: 135, reps: 8 });
  });

  it('hands the EDITED session to Start workout', () => {
    // The whole point: what you start is what the card shows.
    const onStartWorkout = vi.fn();
    const { rerenderWithLatest } = renderCard({ onStartWorkout });
    enterEditMode();
    fireEvent.click(screen.getByRole('button', { name: /remove Plank/i }));
    const plan = rerenderWithLatest();
    fireEvent.click(screen.getByRole('button', { name: /start workout/i }));
    expect(onStartWorkout).toHaveBeenCalledWith(plan.workout);
    expect(onStartWorkout.mock.calls[0][0].exercises.map(e => e.name)).toEqual(['Bench Press']);
  });

  it('clears the saved state after an edit, since the regimen on file is the old session', async () => {
    const onSaveRegimen = vi.fn().mockResolvedValue({});
    const { rerenderWithLatest } = renderCard({ onSaveRegimen });
    fireEvent.click(screen.getByRole('button', { name: /save as regimen/i }));
    expect(await screen.findByRole('button', { name: /saved to regimens/i })).toBeTruthy();

    enterEditMode();
    fireEvent.click(screen.getByRole('button', { name: /remove Plank/i }));
    rerenderWithLatest();
    expect(screen.getByRole('button', { name: /save as regimen/i })).toBeTruthy();
  });

  it('still edits without an onPlanChange handler, just not durably', () => {
    render(<MemoryRouter><CoachPlanCard plan={makePlan()} /></MemoryRouter>);
    enterEditMode();
    fireEvent.click(screen.getByRole('button', { name: /swap Bench Press/i }));
    expect(screen.getByText('Incline Dumbbell Press')).toBeTruthy();
  });

  it('offers no edit affordance on a weekly plan', () => {
    const plan = { ...makePlan(), kind: 'plan', workout: null };
    render(<MemoryRouter><CoachPlanCard plan={plan} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /edit workout/i })).toBeNull();
  });

  it('shows the current prescription on each row', () => {
    renderCard();
    enterEditMode();
    expect(within(rowFor('Bench Press')).getByText(/3 × 8 @ 135 lb · chest/)).toBeTruthy();
    expect(within(rowFor('Plank')).getByText(/3 × 14 · bodyweight · core/)).toBeTruthy();
  });
});
