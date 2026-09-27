// Tests for src/lib/data/templates.js — the single template data layer.
//
// This file replaces workoutTemplates.test.js. That module was a second,
// parallel implementation against the same `workout_templates` table; only
// its saveTemplate was ever reached, and it has been folded in here.
//
// The behaviour worth protecting: a template stores STRUCTURE, never the
// numbers from the session it came from.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const createEntity = vi.fn();
// The statements are pinned in templatesStatements.test.js; here the row
// helper is faked so the assertions read what the module handed it.
vi.mock('../ownedRows', () => ({
  ownedRows: () => ({
    create: (...a) => createEntity(...a),
    filter: vi.fn(() => Promise.resolve([])),
    update: vi.fn(() => Promise.resolve({})),
    remove: vi.fn(() => Promise.resolve(true)),
  }),
}));
vi.mock('@/api/supabaseClient', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(() => Promise.resolve({})) },
}));

let mod;
beforeEach(async () => {
  vi.resetModules();
  createEntity.mockReset();
  createEntity.mockResolvedValue({ id: 'tpl-1' });
  mod = await import('../templates');
});

describe('stripTemplateNumbers', () => {
  it('blanks weight and reps but keeps the set COUNT', () => {
    const out = mod.stripTemplateNumbers([
      { name: 'Bench Press', sets: [{ weight: 185, reps: 5 }, { weight: 185, reps: 5 }, { weight: 175, reps: 8 }] },
    ]);
    expect(out[0].sets).toHaveLength(3);
    expect(out[0].sets.every(s => s.weight === null && s.reps === null)).toBe(true);
  });

  it('preserves the exercise identity fields', () => {
    const out = mod.stripTemplateNumbers([
      { name: 'Squat', displayName: 'Back Squat', muscle_group: 'legs', sets: [{ weight: 225, reps: 5 }] },
    ]);
    expect(out[0]).toMatchObject({ name: 'Squat', displayName: 'Back Squat', muscle_group: 'legs' });
  });

  it('leaves the target_sets / target_reps shape untouched', () => {
    // The hand-built template form uses scalars and never carries weights.
    // The workout loader reads either shape, so this one must survive as-is.
    const form = [{ name: 'Row', displayName: 'Row', muscle_group: 'back', target_sets: 3, target_reps: 10 }];
    expect(mod.stripTemplateNumbers(form)).toEqual(form);
  });

  it('is safe on junk input', () => {
    expect(mod.stripTemplateNumbers(null)).toEqual([]);
    expect(mod.stripTemplateNumbers(undefined)).toEqual([]);
    expect(mod.stripTemplateNumbers([{ name: 'x' }])).toEqual([{ name: 'x' }]);
  });
});

describe('create — enforces the skeleton invariant', () => {
  it('strips numbers even when a caller passes them', async () => {
    await mod.create({ name: 'T', exercises: [{ name: 'Bench', sets: [{ weight: 200, reps: 3 }] }] });
    const payload = createEntity.mock.calls[0][0];
    expect(payload.exercises[0].sets).toEqual([{ weight: null, reps: null }]);
  });

  it('still throws on profanity', () => {
    expect(() => mod.create({ name: 'fuck', exercises: [] })).toThrow();
  });
});

describe('saveTemplate — post-workout entry point', () => {
  it('rejects a missing or blank name', async () => {
    const ex = [{ name: 'a', sets: [{}] }];
    expect(await mod.saveTemplate({ name: '', exercises: ex })).toEqual({ ok: false, reason: 'name_required' });
    expect(await mod.saveTemplate({ name: '   ', exercises: ex })).toEqual({ ok: false, reason: 'name_required' });
    expect(await mod.saveTemplate({ exercises: ex })).toEqual({ ok: false, reason: 'name_required' });
  });

  it('rejects a name over 80 chars', async () => {
    expect(await mod.saveTemplate({ name: 'x'.repeat(81), exercises: [{ name: 'a', sets: [{}] }] }))
      .toEqual({ ok: false, reason: 'name_too_long' });
  });

  it('rejects a description over 280 chars', async () => {
    expect(await mod.saveTemplate({ name: 'ok', description: 'y'.repeat(281), exercises: [{ name: 'a', sets: [{}] }] }))
      .toEqual({ ok: false, reason: 'description_too_long' });
  });

  it('rejects an empty exercise list — the reason Workout.jsx branches on', async () => {
    expect(await mod.saveTemplate({ name: 'ok', exercises: [] })).toEqual({ ok: false, reason: 'no_exercises' });
    expect(await mod.saveTemplate({ name: 'ok' })).toEqual({ ok: false, reason: 'no_exercises' });
  });

  it('rejects profanity by returning, not throwing', async () => {
    const res = await mod.saveTemplate({ name: 'fuck', exercises: [{ name: 'a', sets: [{}] }] });
    expect(res).toEqual({ ok: false, reason: 'profanity' });
  });

  it('saves a skeleton, not the session numbers', async () => {
    const res = await mod.saveTemplate({
      name: 'Push Day',
      exercises: [{ name: 'Bench Press', muscle_group: 'chest', sets: [{ weight: 185, reps: 5 }, { weight: 185, reps: 5 }] }],
    });
    expect(res).toEqual({ ok: true, id: 'tpl-1' });
    const payload = createEntity.mock.calls[0][0];
    expect(payload.name).toBe('Push Day');
    expect(payload.is_public).toBe(false);
    expect(payload.exercises[0].sets).toEqual([
      { weight: null, reps: null },
      { weight: null, reps: null },
    ]);
  });

  it('reports a db failure instead of throwing at the toast action', async () => {
    createEntity.mockRejectedValueOnce(new Error('nope'));
    expect(await mod.saveTemplate({ name: 'ok', exercises: [{ name: 'a', sets: [{}] }] }))
      .toEqual({ ok: false, reason: 'db_error' });
  });
});
