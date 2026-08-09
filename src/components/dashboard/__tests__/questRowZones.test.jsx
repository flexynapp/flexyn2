// The quest row is two tap targets, and this asserts which half does what.
//
// It shipped as ONE target — the whole row navigated — which made the sheet
// nearly unreachable: the only other way in is the card header, so on a
// four-row card almost every pixel sent you to another page. The fix is a
// layout change as much as a handler change, because the text block was
// `flex-1` and therefore the apparently-blank grey gap was still the navigate
// target.
//
// That distinction is invisible to a snapshot and easy to undo by "tidying"
// the flex classes, so it is asserted here directly: tapping the tile or the
// text navigates, tapping the gap or the claimed tick opens the sheet, and
// Claim still claims without doing either.
//
// Rendered against the real DailyQuestsCard row rather than a copy — the
// xpFuelButton test reproduces its handler and says so, and that is a weaker
// position I did not want to repeat for the thing under test here.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuestRow } from '../DailyQuestsCard';
import { getQuestDefinition } from '@/lib/questCatalog';

const t = (k) => k;
const tFallback = (_k, en, vars) =>
  Object.entries(vars || {}).reduce((s, [n, v]) => s.replaceAll(`{${n}}`, v), en);

function makeQuest(over = {}) {
  return {
    id: 'row-1',
    quest_id: 'workout_complete',
    difficulty: 'medium',
    progress: 0,
    target: 1,
    coin_reward: 20,
    xp_reward: 50,
    completed_at: null,
    claimed_at: null,
    definition: getQuestDefinition('workout_complete'),
    ...over,
  };
}

function setup(over = {}) {
  const onGo = vi.fn(), onClaim = vi.fn(), onOpenSheet = vi.fn();
  const { container } = render(
    <QuestRow
      quest={makeQuest(over)}
      onGo={onGo} onClaim={onClaim} onOpenSheet={onOpenSheet}
      t={t} tFallback={tFallback}
    />,
  );
  return { onGo, onClaim, onOpenSheet, container, row: container.firstChild };
}

// The spacer is the element that owns the blank middle. It carries no text, so
// it has to be found structurally.
const spacerOf = (row) => [...row.children].find(el => el.className.includes('flex-1'));

beforeEach(() => vi.clearAllMocks());

describe('quest row — the navigate half', () => {
  it('navigates when the quest icon is tapped', async () => {
    const { onGo, onOpenSheet } = setup();
    await userEvent.click(screen.getByRole('button', { name: /go to/i }).firstChild);
    expect(onGo).toHaveBeenCalledTimes(1);
    expect(onOpenSheet).not.toHaveBeenCalled();
  });

  it('navigates when the quest title is tapped', async () => {
    const { onGo, onOpenSheet } = setup();
    await userEvent.click(screen.getByText('Complete a workout'));
    expect(onGo).toHaveBeenCalledTimes(1);
    expect(onOpenSheet).not.toHaveBeenCalled();
  });

  it('navigates when the reward line is tapped', async () => {
    const { onGo, onOpenSheet } = setup();
    await userEvent.click(screen.getByText(/20 coins/));
    expect(onGo).toHaveBeenCalledTimes(1);
    expect(onOpenSheet).not.toHaveBeenCalled();
  });

  it('is keyboard reachable', async () => {
    const { onGo } = setup();
    screen.getByRole('button', { name: /go to/i }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onGo).toHaveBeenCalledTimes(1);
  });
});

describe('quest row — the sheet half', () => {
  // The regression this whole change exists to fix. The gap looks blank, so
  // it is the first place a thumb lands, and it used to navigate.
  it('opens the sheet from the grey space beside the text', async () => {
    const { onOpenSheet, onGo, row } = setup();
    const spacer = spacerOf(row);
    expect(spacer, 'no flex-1 spacer — the text block is stretching again').toBeTruthy();
    await userEvent.click(spacer);
    expect(onOpenSheet).toHaveBeenCalledTimes(1);
    expect(onGo).not.toHaveBeenCalled();
  });

  it('opens the sheet from the claimed tick', async () => {
    const { onOpenSheet, onGo, container } = setup({
      completed_at: '2026-08-09T10:00:00Z', claimed_at: '2026-08-09T10:01:00Z',
    });
    const tick = container.querySelector('svg.lucide-circle-check-big, svg.lucide-check-circle-2')
      || [...container.querySelectorAll('svg')].pop();
    await userEvent.click(tick);
    expect(onOpenSheet).toHaveBeenCalledTimes(1);
    expect(onGo).not.toHaveBeenCalled();
  });

  // A claimed quest has nowhere useful to navigate to, so the whole row —
  // including the text — should fall through to the sheet.
  it('opens the sheet from anywhere on a claimed row', async () => {
    const { onOpenSheet, onGo } = setup({
      completed_at: '2026-08-09T10:00:00Z', claimed_at: '2026-08-09T10:01:00Z',
    });
    expect(screen.queryByRole('button', { name: /go to/i })).toBeNull();
    await userEvent.click(screen.getByText('Complete a workout'));
    expect(onGo).not.toHaveBeenCalled();
    expect(onOpenSheet).toHaveBeenCalledTimes(1);
  });
});

describe('quest row — Claim stays its own action', () => {
  it('claims without navigating or opening the sheet', async () => {
    const { onClaim, onGo, onOpenSheet } = setup({ completed_at: '2026-08-09T10:00:00Z' });
    await userEvent.click(screen.getByRole('button', { name: 'dashboard.claim' }));
    expect(onClaim).toHaveBeenCalledTimes(1);
    expect(onGo).not.toHaveBeenCalled();
    expect(onOpenSheet).not.toHaveBeenCalled();
  });

  // Claim is a focusable descendant of the navigate zone, so Enter on it used
  // to bubble into the row's key handler and navigate away mid-claim. The
  // `e.target !== e.currentTarget` gate is what stops that.
  it('does not navigate when Enter lands on Claim', async () => {
    const { onGo } = setup({ completed_at: '2026-08-09T10:00:00Z' });
    screen.getByRole('button', { name: 'dashboard.claim' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onGo).not.toHaveBeenCalled();
  });
});

// These assert on CLASS NAMES, which normally deserves suspicion — but jsdom
// has no layout engine, so it is the only thing that can catch this here.
// Verified by putting `flex-1` back on the text block: every click test above
// still passed, because in jsdom the spacer element exists and is clickable at
// zero width. In a real browser it would have collapsed and the sheet would be
// unreachable again. Only the assertions below went red.
describe('quest row — layout invariants the zones depend on', () => {
  // If the text block goes back to flex-1 it swallows the gap and the sheet
  // becomes unreachable again, with no visual difference to catch it.
  it('sizes the text block to its content, not the full row', () => {
    const { row } = setup();
    const nav = screen.getByRole('button', { name: /go to/i });
    expect(nav.className).not.toMatch(/\bflex-1\b/);
    expect(nav.className).toMatch(/\bmin-w-0\b/);
    // The nav zone holds the tile and then the text block, both DIVs — pick
    // the one that actually contains the title rather than the first.
    const textBlock = [...nav.children].find(el => el.querySelector('p'));
    expect(textBlock.className).not.toMatch(/\bflex-1\b/);
    expect(textBlock.className).toMatch(/\bmin-w-0\b/);
    expect(spacerOf(row)).toBeTruthy();
  });

  // Nesting a button in a button is invalid, and the row's pointer handler is
  // deliberately not a keyboard stop — the header already opens the sheet.
  it('does not make the row itself a nested button', () => {
    const { row } = setup();
    expect(row.getAttribute('role')).toBeNull();
    expect(row.getAttribute('tabindex')).toBeNull();
  });
});
