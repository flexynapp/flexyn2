import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// CoachPlanCard reads useLanguage() now that its copy goes through
// tFallback, so it needs the provider the same way every other translated
// component in the app does.
import { LanguageProvider } from '@/lib/LanguageContext';
import CoachPlanCard from '../coach/CoachPlanCard';

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));
const scheduleWorkoutMock = vi.fn(() => Promise.resolve('sched-1'));
vi.mock('@/lib/data/scheduledWorkouts', async (importOriginal) => ({
  ...(await importOriginal()),
  scheduleWorkout: (...args) => scheduleWorkoutMock(...args),
}));
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
    <MemoryRouter><LanguageProvider><CoachPlanCard plan={plan} onPlanChange={onPlanChange} {...overrides} /></LanguageProvider></MemoryRouter>,
  );
  const rerenderWithLatest = () => {
    plan = onPlanChange.mock.calls.at(-1)[0];
    view.rerender(
      <MemoryRouter><LanguageProvider><CoachPlanCard plan={plan} onPlanChange={onPlanChange} {...overrides} /></LanguageProvider></MemoryRouter>,
    );
    return plan;
  };
  return { onPlanChange, rerenderWithLatest, getPlan: () => plan };
}

const enterEditMode = () => fireEvent.click(screen.getByRole('button', { name: /edit workout/i }));
const rowFor = (name) => screen.getByText(name).closest('div').parentElement;

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  // The scheduling tests pin the clock; leaking that into another file would
  // make unrelated date assertions fail in whichever order vitest picks.
  vi.useRealTimers();
});

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
    render(<MemoryRouter><LanguageProvider><CoachPlanCard plan={makePlan()} /></LanguageProvider></MemoryRouter>);
    enterEditMode();
    fireEvent.click(screen.getByRole('button', { name: /swap Bench Press/i }));
    expect(screen.getByText('Incline Dumbbell Press')).toBeTruthy();
  });

  it('offers no edit affordance on a weekly plan', () => {
    const plan = { ...makePlan(), kind: 'plan', workout: null };
    render(<MemoryRouter><LanguageProvider><CoachPlanCard plan={plan} /></LanguageProvider></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /edit workout/i })).toBeNull();
  });

  it('shows the current prescription on each row', () => {
    renderCard();
    enterEditMode();
    expect(within(rowFor('Bench Press')).getByText(/3 × 8 @ 135 lb · chest/)).toBeTruthy();
    expect(within(rowFor('Plank')).getByText(/3 × 14 · bodyweight · core/)).toBeTruthy();
  });
});

describe('CoachPlanCard — scheduling a session', () => {
  const openScheduler = () => fireEvent.click(screen.getByRole('button', { name: /schedule it/i }));

  it('offers Schedule above Save on a session', () => {
    renderCard();
    // Both reachable, but only one is the primary commitment.
    expect(screen.getByRole('button', { name: /schedule it/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /save as regimen/i })).toBeTruthy();
  });

  it('offers no scheduling on a weekly plan — a plan already is a schedule', () => {
    const plan = { ...makePlan(), kind: 'plan', workout: null };
    render(<MemoryRouter><LanguageProvider><CoachPlanCard plan={plan} /></LanguageProvider></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /schedule it/i })).toBeNull();
  });

  it('schedules the session for the chosen day and hour', async () => {
    vi.setSystemTime(new Date(2026, 7, 5, 9, 0, 0)); // 9am, so every slot is open
    const plan = makePlan();
    renderCard();
    openScheduler();
    fireEvent.click(screen.getByRole('button', { name: 'Tomorrow' }));
    fireEvent.click(screen.getByRole('button', { name: /Evening/ }));
    fireEvent.click(screen.getByRole('button', { name: /remind me tomorrow at 6\s*PM/i }));

    await screen.findByRole('button', { name: /tomorrow,\s*6\s*PM/i });
    expect(scheduleWorkoutMock).toHaveBeenCalledWith({
      date: '2026-08-06',
      hour: 18,
      title: plan.title,
      // The whole session travels, so the reminder opens what was committed to.
      workout: expect.objectContaining({ exercises: expect.any(Array) }),
    });
  });

  it('schedules the EDITED session, not the one originally generated', async () => {
    vi.setSystemTime(new Date(2026, 7, 5, 9, 0, 0));
    const { rerenderWithLatest } = renderCard();
    enterEditMode();
    fireEvent.click(screen.getByRole('button', { name: /remove Plank/i }));
    rerenderWithLatest();
    fireEvent.click(screen.getByRole('button', { name: /finish editing/i }));

    openScheduler();
    fireEvent.click(screen.getByRole('button', { name: /remind me/i }));
    await screen.findByRole('button', { name: /,\s*7\s*AM/i });
    expect(scheduleWorkoutMock.mock.calls.at(-1)[0].workout.exercises.map(e => e.name))
      .toEqual(['Bench Press']);
  });

  it('will not let you schedule a slot that has already passed today', () => {
    vi.setSystemTime(new Date(2026, 7, 5, 19, 0, 0)); // 7pm
    renderCard();
    openScheduler();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    // Morning/Midday/Evening are gone; the confirm says so rather than firing
    // a reminder that would be instantly overdue.
    expect(screen.getByRole('button', { name: /Morning/ }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /that time has passed/i }).disabled).toBe(true);
  });

  it('defaults to tomorrow, which is always a valid slot', () => {
    vi.setSystemTime(new Date(2026, 7, 5, 23, 30, 0)); // nothing left today
    renderCard();
    openScheduler();
    expect(screen.getByRole('button', { name: /remind me tomorrow at 7\s*AM/i }).disabled).toBe(false);
  });

  it('surfaces a failure inline, where the fix is', async () => {
    vi.setSystemTime(new Date(2026, 7, 5, 9, 0, 0));
    scheduleWorkoutMock.mockRejectedValueOnce(new Error('too many scheduled workouts'));
    renderCard();
    openScheduler();
    fireEvent.click(screen.getByRole('button', { name: /remind me/i }));
    expect(await screen.findByText(/too many scheduled workouts/i)).toBeTruthy();
    // Still offering the action, because retrying is the recovery.
    expect(screen.getByRole('button', { name: /schedule it/i })).toBeTruthy();
  });
});
