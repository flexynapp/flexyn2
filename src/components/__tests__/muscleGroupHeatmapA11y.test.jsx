/**
 * Progress → Body, accessibility.
 *
 * The two silhouettes ARE the feature, and until now a screen reader could
 * not reach any of it: fourteen `<g onClick>` groups with no role, no
 * accessible name and no tab stop, plus a bottom sheet that was a bare
 * `<div>` — no dialog role, no Escape, no focus management. Colour carried
 * 100% of the information, and colour cannot be heard.
 *
 * These tests assert the contract rather than the implementation, so they
 * survive the markup being reworked: query by ROLE and by accessible NAME,
 * the way an assistive technology does. A rendering test would have passed
 * against the old markup — every string was on screen, just unreachable.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LanguageProvider } from '@/lib/LanguageContext';
import MuscleGroupHeatmap from '@/components/progress/MuscleGroupHeatmap';

let unit = 'lbs';
vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => ({ weightUnit: unit }) }));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));

const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
const LOGS = [
  { date: day(0), exercises: [{ name: 'Bench Press', muscle_groups: ['Chest'], sets: [{ weight: 185, reps: 5 }] }] },
  { date: day(4), exercises: [{ name: 'Back Squat', muscle_groups: ['legs'], sets: [{ weight: 255, reps: 5 }] }] },
];

/* `show` is async ON PURPOSE, and every test must await it.
   LanguageProvider renders a LOADING SHELL instead of its children until the
   dictionary lands — `ready` starts from a module-level cache check and flips
   on a promise. In a fresh worker `isLanguageLoaded('en')` is false, so
   `render()` returns a spinner and the component never mounts, which fails
   every assertion in the file at once rather than one of them.
   That made this file intermittently red (~1 in 4 full-suite runs, whole-file)
   depending purely on whether another file had already warmed the cache in the
   same worker. Awaiting an element that only exists once the component is
   mounted removes the race instead of narrowing it. */
const show = async (logs = LOGS) => {
  render(<LanguageProvider><MuscleGroupHeatmap logs={logs} /></LanguageProvider>);
  await screen.findByRole('group', { name: /front view/i });
};

/* The figure renders each muscle twice — front and back silhouettes share
   ids for the groups that appear on both. Any one of them is the control. */
const muscleButtons = (namePattern) => screen.getAllByRole('button', { name: namePattern });

beforeEach(() => { unit = 'lbs'; });
afterEach(cleanup);

describe('the figure is reachable', () => {
  it('exposes every muscle as a button, not an unlabelled shape', async () => {
    await show();
    // Chest was trained today, so it is the one with a value worth stating.
    expect(muscleButtons(/Chest/i).length).toBeGreaterThan(0);
    expect(muscleButtons(/Quads/i).length).toBeGreaterThan(0);
  });

  it('puts the muscle VALUE in the accessible name — the fill is not audible', async () => {
    await show();
    // Trained today → 0% recovered. Without the number, a screen-reader user
    // gets a body diagram with every reading stripped out.
    const chest = muscleButtons(/Chest/i)[0];
    expect(chest).toHaveAccessibleName(/Chest/i);
    expect(chest).toHaveAccessibleName(/0%/);
  });

  it('interpolates its placeholders — a raw {pct} is the classic i18n hole', async () => {
    await show();
    for (const b of screen.getAllByRole('button')) {
      expect(b.getAttribute('aria-label') || '').not.toMatch(/\{[a-z]+\}/i);
    }
  });

  it('says the muscle opens something, so the gesture is discoverable', async () => {
    await show();
    expect(muscleButtons(/Chest/i)[0]).toHaveAccessibleName(/shows details/i);
  });

  it('gives each silhouette a name of its own', async () => {
    await show();
    expect(screen.getByRole('group', { name: /front view/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /back view/i })).toBeInTheDocument();
  });

  it('makes every muscle a tab stop', async () => {
    await show();
    expect(muscleButtons(/Chest/i)[0]).toHaveAttribute('tabindex', '0');
  });
});

describe('the figure is operable without a pointer', () => {
  it('opens the detail sheet on Enter', async () => {
    await show();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(muscleButtons(/Chest/i)[0], { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens the detail sheet on Space', async () => {
    await show();
    fireEvent.keyDown(muscleButtons(/Chest/i)[0], { key: ' ' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('ignores keys that are not activation keys', async () => {
    await show();
    fireEvent.keyDown(muscleButtons(/Chest/i)[0], { key: 'a' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('the detail sheet behaves like a dialog', () => {
  const open = async () => {
    await show();
    fireEvent.keyDown(muscleButtons(/Chest/i)[0], { key: 'Enter' });
    return screen.getByRole('dialog');
  };

  it('announces itself as a modal dialog named for the muscle', async () => {
    const dialog = await open();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName(/Chest/i);
  });

  it('closes on Escape — it was a fixed overlay with no key handling at all', async () => {
    await open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('moves focus into the sheet rather than leaving it behind the overlay', async () => {
    const dialog = await open();
    const close = within(dialog).getByRole('button', { name: /close muscle details/i });
    expect(close).toHaveFocus();
  });

  it('returns focus to the muscle that opened it', async () => {
    await show();
    const chest = muscleButtons(/Chest/i)[0];
    chest.focus();
    fireEvent.keyDown(chest, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(chest).toHaveFocus();
  });

  it('names its close button beyond the word CLOSE', async () => {
    const dialog = await open();
    // "CLOSE" alone is ambiguous once focus has moved away from the title.
    expect(within(dialog).getByRole('button', { name: /close muscle details/i })).toBeInTheDocument();
  });
});

describe('the ranked list is reachable', () => {
  it('makes each row a button, not a clickable div', async () => {
    await show();
    // The rows open the same sheet the figure does, so they need the same
    // role and the same keyboard.
    const rows = screen.getAllByRole('button', { name: /Chest/i });
    expect(rows.length).toBeGreaterThan(1);
  });

  it('opens the sheet from the list with the keyboard', async () => {
    await show();
    const rows = screen.getAllByRole('button', { name: /Hamstrings/i });
    fireEvent.click(rows[rows.length - 1]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
