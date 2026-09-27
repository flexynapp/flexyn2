// The exercise card's setup above the first set. "How to do it" moved into
// the ⋯ menu and the guide opens in place from there; bar weight and the
// volume readout share one line, and neither leaves an empty row behind.

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

// Wired the way Workout.jsx wires them: the menu beside the card, the open
// state held by the page.
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
        {...(withMenu ? { guideOpen, onGuideOpenChange: setGuideOpen } : {})}
      />
      {withMenu && (
        <ExerciseActionsMenu name={ex.name} onHowTo={() => setGuideOpen(true)} onRemove={() => {}} />
      )}
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

describe('bar and volume', () => {
  it('share one line, volume last', async () => {
    render(<Host initial={bench} />);
    const select = await screen.findByRole('combobox', { name: /barbell weight/i });
    const vol = screen.getByText(/vol$/);
    const row = select.closest('div').parentElement;
    expect(row.contains(vol)).toBe(true);
    expect(vol.className).toMatch(/\bms-auto\b/);
    expect(vol.className).toMatch(/text-muted-foreground/);
  });

  it('shows volume alone when there is no bar', async () => {
    render(<Host initial={{ name: 'Lat Pulldown', muscle_groups: ['Back'], sets: [{ _key: 'a', weight: 100, reps: 10 }] }} />);
    await screen.findByRole('button', { name: 'Options for Lat Pulldown' });
    expect(screen.queryByRole('combobox', { name: /barbell weight/i })).toBeNull();
    expect(screen.getByText(/vol$/)).toBeInTheDocument();
  });

  it('draws no row when there is neither', async () => {
    const { container } = render(<Host initial={{ name: 'Lat Pulldown', muscle_groups: ['Back'], sets: [{ _key: 'a' }] }} />);
    await screen.findByRole('button', { name: 'Options for Lat Pulldown' });
    expect(screen.queryByText(/vol$/)).toBeNull();
    expect(container.querySelector('.-me-8, .mt-1\\.5.flex.gap-2')).toBeNull();
  });
});

// The ⋯ button is absolute at the card's top right. Only the title row sits
// level with it, so only that row keeps the right-hand reserve; the bar and
// volume line below runs to the card's content edge, with or without a
// muscles line (freestyle Bench Press has none).
describe('right-hand reserve for the ⋯ button', () => {
  for (const [label, ex] of [
    ['with a muscles line', bench],
    ['without a muscles line', { name: 'Bench Press', sets: bench.sets }],
  ]) {
    it(`sits on the title row only, ${label}`, async () => {
      render(<Host initial={ex} />);
      const title = await screen.findByRole('heading', { name: 'Bench Press' });
      expect(title.parentElement.className).toMatch(/\bpe-8\b/);
      const vol = screen.getByText(/vol$/);
      const line = vol.parentElement;
      expect(line.className).not.toMatch(/-me-8|\bpe-8\b/);
      for (let el = line.parentElement; el && !/\bp-4\b/.test(el.className); el = el.parentElement) {
        expect(el.className).not.toMatch(/\bpe-8\b/);
      }
    });
  }
});
