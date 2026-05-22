// Tests for src/lib/data/workoutTemplates.js — the validation
// branches of saveTemplate + updateTemplate. The actual Supabase
// calls are mocked.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const from = vi.fn();
const getUser = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (...args) => from(...args),
    auth: { getUser: (...args) => getUser(...args) },
  },
}));

let mod;
beforeEach(async () => {
  vi.resetModules();
  from.mockReset();
  getUser.mockReset();
  mod = await import('../workoutTemplates');
});

describe('saveTemplate validation', () => {
  it('rejects empty/missing name', async () => {
    expect(await mod.saveTemplate({ name: '',     exercises: [{ name: 'a', sets: [{}] }] }))
      .toEqual({ ok: false, reason: 'name_required' });
    expect(await mod.saveTemplate({ name: '   ',  exercises: [{ name: 'a', sets: [{}] }] }))
      .toEqual({ ok: false, reason: 'name_required' });
    expect(await mod.saveTemplate({ exercises: [{ name: 'a', sets: [{}] }] }))
      .toEqual({ ok: false, reason: 'name_required' });
  });

  it('rejects name > 80 chars', async () => {
    const longName = 'x'.repeat(81);
    expect(await mod.saveTemplate({ name: longName, exercises: [{ name: 'a', sets: [{}] }] }))
      .toEqual({ ok: false, reason: 'name_too_long' });
  });

  it('rejects description > 280 chars', async () => {
    expect(await mod.saveTemplate({
      name: 'ok',
      description: 'x'.repeat(281),
      exercises: [{ name: 'a', sets: [{}] }],
    })).toEqual({ ok: false, reason: 'description_too_long' });
  });

  it('rejects empty exercise list', async () => {
    expect(await mod.saveTemplate({ name: 'ok', exercises: [] }))
      .toEqual({ ok: false, reason: 'no_exercises' });
    expect(await mod.saveTemplate({ name: 'ok' }))
      .toEqual({ ok: false, reason: 'no_exercises' });
  });

  it('strips weight/reps from sets (skeleton-only)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.c' } } });
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null }),
      }),
    });
    from.mockReturnValue({ insert });

    const res = await mod.saveTemplate({
      name: 'Push day',
      exercises: [
        { name: 'Bench Press', sets: [{ weight: 225, reps: 5 }, { weight: 225, reps: 5 }] },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.id).toBe('new-id');

    const insertedRow = insert.mock.calls[0][0];
    expect(insertedRow.name).toBe('Push day');
    expect(insertedRow.exercises[0].sets).toEqual([
      { weight: null, reps: null },
      { weight: null, reps: null },
    ]);
  });

  it('rejects when no authenticated user', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await mod.saveTemplate({
      name: 'ok',
      exercises: [{ name: 'a', sets: [{}] }],
    });
    expect(res).toEqual({ ok: false, reason: 'unauthenticated' });
  });
});

describe('updateTemplate', () => {
  it('rejects missing id', async () => {
    expect(await mod.updateTemplate('', {})).toEqual({ ok: false, reason: 'no_id' });
  });

  it('only sends provided fields', async () => {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    from.mockReturnValue({ update });

    await mod.updateTemplate('t1', { name: 'New name' });
    const patch = update.mock.calls[0][0];
    expect(patch.name).toBe('New name');
    expect(patch.description).toBeUndefined();
    expect(patch.exercises).toBeUndefined();
    expect(patch.updated_at).toBeTruthy();
  });

  it('clamps name to 80 chars', async () => {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    from.mockReturnValue({ update });

    await mod.updateTemplate('t1', { name: 'x'.repeat(200) });
    const patch = update.mock.calls[0][0];
    expect(patch.name.length).toBe(80);
  });
});
