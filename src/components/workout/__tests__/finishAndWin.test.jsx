// Logger part 3: the finish sheet and the win screen that plays after a
// save. Reduced motion is on here so every beat of the win screen is
// already on screen; the staging itself is timing, not logic.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/utils';
import { LanguageProvider } from '@/lib/LanguageContext';
import { WeightUnitProvider } from '@/lib/WeightUnitContext';
import FinishSheet from '../FinishSheet';
import WorkoutWin from '../WorkoutWin';

vi.mock('@/lib/reducedMotion', () => ({ default: () => true, prefersReducedMotion: () => true }));

beforeEach(() => { localStorage.clear(); });

const wrap = (ui) => render(<LanguageProvider><WeightUnitProvider>{ui}</WeightUnitProvider></LanguageProvider>);

const exercises = [
  { name: 'Bench Press', muscle_groups: ['Chest'], sets: [{ weight: 100, reps: 10, completed: true }, { weight: 100, reps: 10 }] },
];

describe('FinishSheet', () => {
  const base = {
    open: true, onClose: () => {}, onSave: () => {}, exercises, startedAt: new Date(Date.now() - 20 * 60000).toISOString(),
    name: '', onNameChange: () => {}, tags: ['push', 'chest'], onTagsChange: () => {}, notes: '', onNotesChange: () => {},
  };

  it('shows the session and says unchecked sets still save', async () => {
    wrap(<FinishSheet {...base} unchecked={1} />);
    expect(await screen.findByText('20 min')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByText(/1 set is not checked off\. It still saves\./)).toBeInTheDocument();
  });

  it('opens with the derived tags and can edit them', async () => {
    wrap(<FinishSheet {...base} />);
    expect(await screen.findByText('Push')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /edit tags/i }));
    expect(screen.getByRole('button', { name: 'Back', pressed: false })).toBeInTheDocument();
  });

  it('saves', async () => {
    const onSave = vi.fn();
    wrap(<FinishSheet {...base} onSave={onSave} />);
    fireEvent.click(await screen.findByRole('button', { name: /save workout/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('WorkoutWin', () => {
  const win = { workout: { title: 'Push Day', exercises }, xpGained: 180, xpBefore: 0, minutes: 24, prs: [] };

  it('plays an ordinary session as volume moved', async () => {
    wrap(<WorkoutWin win={win} weightUnit="lbs" onClose={() => {}} onShareWorkout={() => {}} onSharePr={() => {}} onSaveTemplate={() => {}} />);
    expect(await screen.findByText('Workout complete')).toBeInTheDocument();
    expect(screen.getByText('Push Day')).toBeInTheDocument();
    expect(screen.getByText('2,000')).toBeInTheDocument();
    expect(screen.getByText('+180 XP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save as template/i })).toBeInTheDocument();
  });

  it('turns into the PR screen and shares the top PR', async () => {
    const onSharePr = vi.fn();
    const pr = { name: 'bench press', displayName: 'Bench Press', oldPR: 140, newPR: 145, delta: 5 };
    wrap(<WorkoutWin win={{ ...win, prs: [pr], unit: 'lb' }} weightUnit="lbs" onClose={() => {}} onShareWorkout={() => {}} onSharePr={onSharePr} onSaveTemplate={() => {}} />);
    expect(await screen.findByText('New personal record')).toBeInTheDocument();
    expect(screen.getByText('145')).toBeInTheDocument();
    expect(screen.getByText('+5 lb on your best')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /share this pr/i }));
    expect(onSharePr).toHaveBeenCalledWith({ pr, unit: 'lb' });
  });

  it('never headlines a zero: a cardio only session shows its time', async () => {
    const cardio = { ...win, workout: { title: 'Run', exercises: [{ kind: 'cardio', completed: true }] } };
    wrap(<WorkoutWin win={cardio} weightUnit="lbs" onClose={() => {}} onShareWorkout={() => {}} onSharePr={() => {}} onSaveTemplate={() => {}} />);
    expect(await screen.findByText('24')).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('renders nothing without a win', () => {
    wrap(<WorkoutWin win={null} weightUnit="lbs" onClose={() => {}} onShareWorkout={() => {}} onSharePr={() => {}} onSaveTemplate={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists what else the save earned as lines on the screen', async () => {
    const notes = [
      { key: 'comeback', text: 'Comeback bonus earned. Good to have you back.', sub: '+50 XP' },
      { key: 'streak', text: '7-day workout streak! +20 coins' },
    ];
    wrap(<WorkoutWin win={{ ...win, notes }} weightUnit="lbs" onClose={() => {}} onShareWorkout={() => {}} onSharePr={() => {}} onSaveTemplate={() => {}} />);
    expect(await screen.findByText('Comeback bonus earned. Good to have you back.')).toBeInTheDocument();
    expect(screen.getByText('+50 XP')).toBeInTheDocument();
    expect(screen.getByText('7-day workout streak! +20 coins')).toBeInTheDocument();
  });

  it('answers "Save as template" on its own button', async () => {
    const onSaveTemplate = vi.fn().mockResolvedValue({ ok: true });
    wrap(<WorkoutWin win={win} weightUnit="lbs" onClose={() => {}} onShareWorkout={() => {}} onSharePr={() => {}} onSaveTemplate={onSaveTemplate} />);
    fireEvent.click(await screen.findByRole('button', { name: /save as template/i }));
    expect(await screen.findByRole('button', { name: /saved to regimens/i })).toBeInTheDocument();
    expect(onSaveTemplate).toHaveBeenCalledTimes(1);
  });

  it('says why a template did not save, under the button', async () => {
    const onSaveTemplate = vi.fn().mockResolvedValue({ ok: false, reason: 'Session has no exercises to save.' });
    wrap(<WorkoutWin win={win} weightUnit="lbs" onClose={() => {}} onShareWorkout={() => {}} onSharePr={() => {}} onSaveTemplate={onSaveTemplate} />);
    fireEvent.click(await screen.findByRole('button', { name: /save as template/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Session has no exercises to save.'));
    expect(await screen.findByRole('button', { name: /didn't save/i })).toBeInTheDocument();
  });
});
