// The active session's pinned bar and the per exercise ⋯ menu from the
// logger redesign (part 2).

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/utils';
import SessionBar, { sessionProgress } from '../SessionBar';
import ExerciseActionsMenu from '../ExerciseActionsMenu';
import { LanguageProvider } from '@/lib/LanguageContext';
import { WeightUnitProvider } from '@/lib/WeightUnitContext';

beforeEach(() => { localStorage.clear(); });

describe('sessionProgress', () => {
  it('counts ticked sets, folded exercises and cardio items', () => {
    expect(sessionProgress([
      { name: 'Bench', sets: [{ completed: true }, {}, {}] },
      { name: 'Row', completed: true, sets: [{}, {}] },
      { kind: 'cardio', completed: false },
      { kind: 'cardio', completed: true },
    ])).toEqual({ done: 4, total: 7 });
  });

  it('is zero over an empty session', () => {
    expect(sessionProgress([])).toEqual({ done: 0, total: 0 });
  });
});

const wrap = (ui) => render(
  <LanguageProvider><WeightUnitProvider>{ui}</WeightUnitProvider></LanguageProvider>,
);

describe('SessionBar', () => {
  it('shows progress and finishes from the bar', async () => {
    const onFinish = vi.fn();
    wrap(
      <SessionBar
        title="Push Day"
        startedAt={Date.now()}
        exercises={[{ name: 'Bench', sets: [{ weight: 100, reps: 5, completed: true }, { weight: 100, reps: 5 }] }]}
        onCancel={() => {}}
        onFinish={onFinish}
        canFinish
      />,
    );
    expect(await screen.findByText('1 of 2 sets')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('cannot finish an empty session', async () => {
    wrap(<SessionBar title="Freestyle" exercises={[]} onCancel={() => {}} onFinish={() => {}} canFinish={false} />);
    expect(await screen.findByRole('button', { name: 'Finish' })).toBeDisabled();
  });
});

describe('ExerciseActionsMenu', () => {
  const open = async () => {
    const trigger = await screen.findByRole('button', { name: 'Options for Bench' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
  };

  it('lists only the actions it was given', async () => {
    wrap(<ExerciseActionsMenu name="Bench" onPlateCalc={() => {}} onRemove={() => {}} />);
    await open();
    expect(await screen.findByRole('menuitem', { name: /plate calculator/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /superset/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /check my form/i })).toBeNull();
  });

  it('removes the exercise', async () => {
    const onRemove = vi.fn();
    wrap(<ExerciseActionsMenu name="Bench" onPair={() => {}} onRemove={onRemove} />);
    await open();
    fireEvent.click(await screen.findByRole('menuitem', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  // The owner's review: the rows looked unfinished. Pin what "finished"
  // means here so a later restyle of the shared primitive cannot undo it.
  it('draws 44px rows, one icon size, and colours only Remove', async () => {
    wrap(<ExerciseActionsMenu name="Bench" onPair={() => {}} onPlateCalc={() => {}} onFormCheck={() => {}} onRemove={() => {}} />);
    await open();
    const items = await screen.findAllByRole('menuitem');
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(item.className).toMatch(/\bmin-h-11\b/);
      expect(item.className).toMatch(/\[&>svg\]:size-4/);
    }
    const remove = screen.getByRole('menuitem', { name: /remove exercise/i });
    expect(remove.className).toMatch(/\btext-destructive\b/);
    for (const item of items.filter(i => i !== remove)) {
      expect(item.className).not.toMatch(/destructive|primary/);
    }
    expect(screen.getAllByRole('separator')).toHaveLength(1);
  });

  // "How to do it" left the card for this menu. It sits with the other
  // tools, right after Check my form, above the divider, never coloured.
  it('offers How to do it next to Check my form and opens the guide', async () => {
    const onHowTo = vi.fn();
    wrap(<ExerciseActionsMenu name="Bench" onFormCheck={() => {}} onHowTo={onHowTo} onRemove={() => {}} />);
    await open();
    const howTo = await screen.findByRole('menuitem', { name: 'How to do it' });
    const items = screen.getAllByRole('menuitem');
    expect(items.map(i => i.textContent.trim())).toEqual(['Check my form', 'How to do it', 'Remove exercise']);
    expect(howTo.className).toMatch(/\bmin-h-11\b/);
    expect(howTo.className).not.toMatch(/destructive|primary/);
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    fireEvent.click(howTo);
    expect(onHowTo).toHaveBeenCalledTimes(1);
  });

  it('leaves How to do it out when there is no guide to open', async () => {
    wrap(<ExerciseActionsMenu name="My Lift" onFormCheck={() => {}} onRemove={() => {}} />);
    const trigger = await screen.findByRole('button', { name: 'Options for My Lift' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await screen.findByRole('menuitem', { name: /check my form/i });
    expect(screen.queryByRole('menuitem', { name: /how to do it/i })).toBeNull();
  });

  it('drops the divider when Remove is the only action', async () => {
    wrap(<ExerciseActionsMenu name="Bench" onRemove={() => {}} />);
    await open();
    await screen.findByRole('menuitem', { name: /remove exercise/i });
    expect(screen.queryByRole('separator')).toBeNull();
  });
});
