// The exercise card's header and setup above the first set. "How to do it"
// lives in the ⋯ menu and the guide opens in place from there. The ⋯ sits in
// the header row beside the name; bar, machine, tempo and notes sit behind
// one Setup pill, which shares a line with the volume readout.

import React, { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/utils';
import ExerciseLogger from '../ExerciseLogger';
import ExerciseActionsMenu from '../ExerciseActionsMenu';
import { LanguageProvider } from '@/lib/LanguageContext';
import { WeightUnitProvider } from '@/lib/WeightUnitContext';
import { RestTimerProvider } from '@/lib/RestTimerContext';

vi.mock('@/lib/toast', () => {
  const t = vi.fn();
  for (const k of ['success', 'info', 'message', 'warning', 'error', 'dismiss']) t[k] = vi.fn();
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
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation(q => ({
      matches: false, media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }
});

// Wired the way Workout.jsx wires them: the menu handed in as a prop, the
// open state held by the page.
function Host({ initial, withMenu = true }) {
  const [ex, setEx] = useState(initial);
  const [guideOpen, setGuideOpen] = useState(false);
  return (
    <LanguageProvider><WeightUnitProvider><RestTimerProvider>
      <ExerciseLogger
        exercise={ex}
        onChange={setEx}
        workoutLogs={[]}
        userProfile={{ id: 'u1' }}
        {...(withMenu ? {
          guideOpen,
          onGuideOpenChange: setGuideOpen,
          menu: <ExerciseActionsMenu name={ex.name} onHowTo={() => setGuideOpen(true)} onRemove={() => {}} />,
        } : {})}
      />
    </RestTimerProvider></WeightUnitProvider></LanguageProvider>
  );
}

const bench = { name: 'Bench Press', muscle_groups: ['Chest'], sets: [
  { _key: 'a', weight: 135, reps: 10 },
  { _key: 'b', weight: 155, reps: 8 },
] };

describe('How to do it', () => {
  it('is not a row on the card when the menu carries it', async () => {
    render(<Host initial={bench} />);
    await screen.findByRole('button', { name: 'Options for Bench Press' });
    expect(screen.queryByRole('button', { name: /how to do bench press/i })).toBeNull();
  });

  it('opens the guide in place from the menu, and folds it away again', async () => {
    render(<Host initial={bench} />);
    const trigger = await screen.findByRole('button', { name: 'Options for Bench Press' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'How to do it' }));

    const header = await screen.findByRole('button', { name: /how to do bench press/i });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/watch for/i)).toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.queryByRole('button', { name: /how to do bench press/i })).toBeNull();
  });

  it('keeps its own disclosure where no menu is handed in', async () => {
    render(<Host initial={bench} withMenu={false} />);
    const header = await screen.findByRole('button', { name: /how to do bench press/i });
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('setup pill and volume', () => {
  it('share one line, volume last', async () => {
    render(<Host initial={bench} />);
    const pill = await screen.findByRole('button', { name: /^Setup:/ });
    const vol = screen.getByText(/vol$/);
    expect(pill.parentElement.contains(vol)).toBe(true);
    expect(vol.className).toMatch(/\bms-auto\b/);
    expect(vol.className).toMatch(/text-muted-foreground/);
  });

  it('names the bar on a barbell lift, and the bar select is off the card face', async () => {
    render(<Host initial={bench} />);
    const pill = await screen.findByRole('button', { name: /^Setup:/ });
    expect(pill.textContent).toMatch(/Olympic.*45 lb/);
    expect(screen.queryByRole('combobox', { name: /barbell weight/i })).toBeNull();
    fireEvent.click(pill);
    expect(await screen.findByRole('combobox', { name: /barbell weight/i })).toBeInTheDocument();
  });

  it('is one quiet pill: rounded, filled, borderless, 32px to look at and 44px to hit', async () => {
    render(<Host initial={bench} />);
    const pill = await screen.findByRole('button', { name: /^Setup:/ });
    for (const c of ['rounded-full', 'bg-secondary', 'h-8', 'text-xs', 'font-semibold', 'after:-inset-y-1.5']) {
      expect(pill.className.split(/\s+/)).toContain(c);
    }
    expect(pill.className).not.toMatch(/\bborder\b/);
  });

  it('reads Setup when there is no bar and no machine, and still shows volume', async () => {
    render(<Host initial={{ name: 'Lat Pulldown', muscle_groups: ['Back'], sets: [{ _key: 'a', weight: 100, reps: 10 }] }} />);
    await screen.findByRole('button', { name: 'Options for Lat Pulldown' });
    expect(screen.getByRole('button', { name: 'Setup: Setup' })).toBeInTheDocument();
    expect(screen.getByText(/vol$/)).toBeInTheDocument();
  });

  it('draws no volume when nothing is lifted yet', async () => {
    render(<Host initial={{ name: 'Lat Pulldown', muscle_groups: ['Back'], sets: [{ _key: 'a' }] }} />);
    await screen.findByRole('button', { name: 'Options for Lat Pulldown' });
    expect(screen.queryByText(/vol$/)).toBeNull();
  });

  it('shows a tempo or note as one muted truncated line beside the pill', async () => {
    render(<Host initial={{ ...bench, tempo: '3-1-2', notes: 'Elbows tucked' }} />);
    const line = await screen.findByText('3-1-2 · Elbows tucked');
    expect(line.className).toMatch(/\btruncate\b/);
    expect(line.className).toMatch(/text-muted-foreground/);
    expect(screen.queryByText(/tempo · notes/i)).toBeNull();
  });

  it('edits tempo and notes in the Setup sheet', async () => {
    render(<Host initial={bench} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Setup:/ }));
    fireEvent.change(await screen.findByPlaceholderText('3-1-2'), { target: { value: '4-0-1' } });
    fireEvent.change(screen.getByPlaceholderText(/felt weak today/i), { target: { value: 'Feet flat' } });
    expect(await screen.findByText('4-0-1 · Feet flat')).toBeInTheDocument();
  });
});

describe('header', () => {
  it('puts one 44px ghost ⋯ in the header row beside the name', async () => {
    render(<Host initial={bench} />);
    const title = await screen.findByRole('heading', { name: 'Bench Press' });
    const trigger = screen.getByRole('button', { name: 'Options for Bench Press' });
    const row = title.parentElement.parentElement;
    expect(row.contains(trigger)).toBe(true);
    expect(trigger.className.split(/\s+/)).toEqual(expect.arrayContaining(['w-11', 'h-11']));
    expect(trigger.className).not.toMatch(/\bborder\b/);
  });

  it('says muscles and "N of M sets" on one muted line, in place of the ring', async () => {
    render(<Host initial={{ ...bench, sets: [{ ...bench.sets[0], completed: true }, bench.sets[1]] }} />);
    const meta = await screen.findByText('1 of 2 sets');
    expect(meta.parentElement.textContent).toMatch(/^Chest · 1 of 2 sets$/);
    expect(meta.parentElement.className).toMatch(/text-muted-foreground/);
  });

  it('has no drag grip and no Add equipment chip on the card face', async () => {
    render(<Host initial={bench} />);
    await screen.findByRole('heading', { name: 'Bench Press' });
    expect(screen.queryByRole('button', { name: /drag to reorder/i })).toBeNull();
    expect(screen.queryByText(/add equipment/i)).toBeNull();
  });
});
