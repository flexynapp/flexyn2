// The "Welcome back" comeback overlay must never be a dead end.
//
// It is a full-screen `fixed inset-0` layer, so if either button stops
// doing something the user is stuck on it with no way into the app. That
// has happened once already: dismiss() wrote its flag but the hook's memo
// never recomputed, because Workout.jsx passes a memoized logs array whose
// reference never changes (see useComebackProtocol.js). The hook test pins
// that half. This file pins the other half: the screen wired to the hook
// the way Workout.jsx wires it, clicked like a user would, must go away.

import React, { useMemo, useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnimatePresence } from 'framer-motion';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (k) => k,
    tFallback: (_k, e, vars) =>
      String(e).replace(/\{(\w+)\}/g, (m, name) => (vars && name in vars ? vars[name] : m)),
  }),
}));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

const { useComebackProtocol } = await import('@/hooks/useComebackProtocol');
const ComebackScreen = (await import('../ComebackScreen')).default;

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const LOGS = [5, 8, 12].map((ago, i) => ({
  id: `w${i}`,
  date: isoDaysAgo(ago),
  exercises: [
    { name: 'Bench Press', sets: [{ weight: 135, reps: 8 }, { weight: 135, reps: 8 }] },
    { name: 'Barbell Row', sets: [{ weight: 115, reps: 10 }] },
  ],
}));

// Mirrors Workout.jsx: the logs array is memoized, so its reference is
// stable across renders. That stability is what made the buttons dead.
function Harness({ logs, onStart, onHome = () => {} }) {
  const stableLogs = useMemo(() => logs, [logs]);
  const [started, setStarted] = useState(false);
  const comeback = useComebackProtocol({ workoutLogs: stableLogs, hasActiveSession: false, userId: 'u1' });
  return (
    <>
      <div>{started ? 'workout started' : 'workout idle'}</div>
      <AnimatePresence>
        {comeback.triggered && (
          <ComebackScreen
            daysSince={comeback.daysSince}
            workoutLogs={stableLogs}
            userProfile={{}}
            onStartSession={(ex, title) => { comeback.dismiss(); setStarted(true); onStart(ex, title); }}
            onSkip={() => comeback.dismiss()}
            onHome={() => { comeback.dismiss(); onHome(); }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

beforeEach(() => sessionStorage.clear());

describe('ComebackScreen — both buttons lead somewhere', () => {
  it('shows after a long absence', () => {
    render(<Harness logs={LOGS} onStart={vi.fn()} />);
    expect(screen.getByText('Welcome back.')).toBeTruthy();
    expect(screen.getByText(/It's been 5 days/)).toBeTruthy();
  });

  // Declining goes to the dashboard (kegan, 2026-09-26), not the empty
  // Workout page behind the overlay.
  it('"Go to my dashboard" takes the overlay down and heads home', async () => {
    const onHome = vi.fn();
    render(<Harness logs={LOGS} onStart={vi.fn()} onHome={onHome} />);
    fireEvent.click(screen.getByRole('button', { name: /Go to my dashboard/i }));
    await waitFor(() => expect(screen.queryByText('Welcome back.')).toBeNull());
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(screen.getByText('workout idle')).toBeTruthy();
  });

  it('"Let\'s go" starts a comeback session and takes the overlay down', async () => {
    const onStart = vi.fn();
    render(<Harness logs={LOGS} onStart={onStart} />);
    fireEvent.click(screen.getByRole('button', { name: /Let's go/i }));
    await waitFor(() => expect(screen.queryByText('Welcome back.')).toBeNull());
    expect(onStart).toHaveBeenCalledTimes(1);
    const [exercises, title] = onStart.mock.calls[0];
    expect(exercises.length).toBeGreaterThan(0);
    expect(title).toMatch(/Comeback Session/);
    expect(screen.getByText('workout started')).toBeTruthy();
  });

  it('with too little history, the primary button still leaves the screen', async () => {
    render(<Harness logs={LOGS.slice(0, 1)} onStart={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Start workout/i }));
    await waitFor(() => expect(screen.queryByText('Welcome back.')).toBeNull());
  });

  it('stays dismissed when the page remounts in the same session', async () => {
    const { unmount } = render(<Harness logs={LOGS} onStart={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Go to my dashboard/i }));
    await waitFor(() => expect(screen.queryByText('Welcome back.')).toBeNull());
    unmount();
    render(<Harness logs={LOGS} onStart={vi.fn()} />);
    expect(screen.queryByText('Welcome back.')).toBeNull();
  });
});
