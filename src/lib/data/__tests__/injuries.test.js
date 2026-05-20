import { describe, it, expect, beforeEach, vi } from 'vitest';

// Chainable supabase mock — captures the last call's args + returns
// whatever the test stages in _state.next{Data,Error}.
const _state = {
  lastTable: null,
  lastSelect: null,
  lastInsert: null,
  lastUpdate: null,
  lastEq: null,
  lastIn: null,
  lastDelete: false,
  nextData: null,
  nextError: null,
};

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (table) => {
      _state.lastTable = table;
      const ret = (data) => ({ data, error: _state.nextError });
      const single = async () => ret(_state.nextData);
      const order = () => ({
        order: () => ret(_state.nextData),
        // Allow .order().order() chain (debriefs uses two)
      });
      return {
        select: (cols) => {
          _state.lastSelect = cols;
          return {
            order: (col, opts) => {
              const chain = {
                order: () => Promise.resolve(ret(_state.nextData)),
                limit: () => ({ maybeSingle: single }),
                then: (resolve) => resolve(ret(_state.nextData)),
              };
              return chain;
            },
            eq: () => ({ maybeSingle: single, single, select: () => ({ single }) }),
            in: (col, vals) => {
              _state.lastIn = { col, vals };
              return {
                order: () => Promise.resolve(ret(_state.nextData)),
              };
            },
          };
        },
        insert: (row) => {
          _state.lastInsert = row;
          return { select: () => ({ single }) };
        },
        update: (patch) => {
          _state.lastUpdate = patch;
          return {
            eq: () => ({ select: () => ({ single }) }),
          };
        },
        delete: () => {
          _state.lastDelete = true;
          return { eq: async () => ({ error: _state.nextError }) };
        },
      };
    },
  },
}));

const injuries = await import('../injuries');

beforeEach(() => {
  _state.lastTable = null;
  _state.lastSelect = null;
  _state.lastInsert = null;
  _state.lastUpdate = null;
  _state.lastEq = null;
  _state.lastIn = null;
  _state.lastDelete = false;
  _state.nextData = null;
  _state.nextError = null;
});

describe('listInjuries', () => {
  it('queries injury_logs ordered by injured_at desc', async () => {
    _state.nextData = [{ id: 'a', muscle_group: 'shoulders' }];
    const rows = await injuries.listInjuries();
    expect(_state.lastTable).toBe('injury_logs');
    expect(rows).toEqual([{ id: 'a', muscle_group: 'shoulders' }]);
  });

  it('returns [] when supabase returns null data', async () => {
    _state.nextData = null;
    expect(await injuries.listInjuries()).toEqual([]);
  });

  it('throws on error', async () => {
    _state.nextError = { message: 'denied' };
    await expect(injuries.listInjuries()).rejects.toMatchObject({ message: 'denied' });
  });
});

describe('listActiveInjuries', () => {
  it('filters status IN (active, recovering)', async () => {
    _state.nextData = [];
    await injuries.listActiveInjuries();
    expect(_state.lastIn).toEqual({ col: 'status', vals: ['active', 'recovering'] });
  });
});

describe('logInjury', () => {
  it('inserts with snake_case column names + active status default', async () => {
    _state.nextData = { id: 'new', muscle_group: 'back' };
    await injuries.logInjury({
      userId: 'u1', userEmail: 'a@b.com',
      muscleGroup: 'back', severity: 'moderate',
      notes: 'tweaked', injuredAt: '2026-05-01',
      estimatedRecoveryDate: '2026-05-15',
    });
    expect(_state.lastInsert).toMatchObject({
      user_id: 'u1',
      user_email: 'a@b.com',
      muscle_group: 'back',
      severity: 'moderate',
      notes: 'tweaked',
      injured_at: '2026-05-01',
      estimated_recovery_date: '2026-05-15',
      status: 'active',
    });
  });

  it('defaults notes to null when missing', async () => {
    _state.nextData = {};
    await injuries.logInjury({ userId: 'u1', userEmail: 'a@b.com', muscleGroup: 'legs', severity: 'mild' });
    expect(_state.lastInsert.notes).toBe(null);
    expect(_state.lastInsert.estimated_recovery_date).toBe(null);
  });

  it('defaults injured_at to today when missing', async () => {
    _state.nextData = {};
    await injuries.logInjury({ userId: 'u1', userEmail: 'a@b.com', muscleGroup: 'legs', severity: 'mild' });
    const today = new Date().toISOString().split('T')[0];
    expect(_state.lastInsert.injured_at).toBe(today);
  });
});

describe('clearInjury', () => {
  it('marks status=cleared with cleared_at=today', async () => {
    _state.nextData = { id: 'x', status: 'cleared' };
    await injuries.clearInjury('x');
    expect(_state.lastUpdate.status).toBe('cleared');
    expect(_state.lastUpdate.cleared_at).toBe(new Date().toISOString().split('T')[0]);
  });
});

describe('extendRecovery', () => {
  it('updates estimated_recovery_date + flips status to recovering', async () => {
    _state.nextData = { id: 'x', status: 'recovering' };
    await injuries.extendRecovery('x', '2026-06-01');
    expect(_state.lastUpdate).toEqual({
      estimated_recovery_date: '2026-06-01',
      status: 'recovering',
    });
  });
});

describe('deleteInjury', () => {
  it('issues a delete with eq(id)', async () => {
    await injuries.deleteInjury('x');
    expect(_state.lastDelete).toBe(true);
  });

  it('throws on error', async () => {
    _state.nextError = { message: 'denied' };
    await expect(injuries.deleteInjury('x')).rejects.toMatchObject({ message: 'denied' });
  });
});

describe('getExcludedMuscleGroups (pure)', () => {
  it('returns an empty Set for no injuries', () => {
    expect(injuries.getExcludedMuscleGroups([])).toEqual(new Set());
  });

  it('excludes the directly-injured muscle group at any severity', () => {
    const excl = injuries.getExcludedMuscleGroups([{ muscle_group: 'chest', severity: 'mild' }]);
    expect(excl.has('chest')).toBe(true);
    expect(excl.size).toBe(1);
  });

  it('excludes synergists ONLY when severity is "serious"', () => {
    const mild = injuries.getExcludedMuscleGroups([{ muscle_group: 'chest', severity: 'mild' }]);
    expect(mild.has('shoulders')).toBe(false);
    expect(mild.has('triceps')).toBe(false);

    const serious = injuries.getExcludedMuscleGroups([{ muscle_group: 'chest', severity: 'serious' }]);
    expect(serious.has('chest')).toBe(true);
    expect(serious.has('shoulders')).toBe(true);
    expect(serious.has('triceps')).toBe(true);
  });

  it('combines multiple injuries into a single set without duplicates', () => {
    const excl = injuries.getExcludedMuscleGroups([
      { muscle_group: 'back', severity: 'serious' },
      { muscle_group: 'legs', severity: 'mild' },
    ]);
    // back+biceps from synergist, legs direct
    expect(excl.has('back')).toBe(true);
    expect(excl.has('biceps')).toBe(true);
    expect(excl.has('legs')).toBe(true);
  });

  it('is case-insensitive on muscle_group', () => {
    const excl = injuries.getExcludedMuscleGroups([{ muscle_group: 'CHEST', severity: 'serious' }]);
    expect(excl.has('chest')).toBe(true);
    expect(excl.has('shoulders')).toBe(true);
  });

  it('ignores entries without a muscle_group', () => {
    const excl = injuries.getExcludedMuscleGroups([{ severity: 'mild' }, { muscle_group: '', severity: 'serious' }]);
    expect(excl.size).toBe(0);
  });

  it('handles a muscle group with no synergist mapping', () => {
    // 'core' isn't in the SYNERGISTS map — should just include itself
    const excl = injuries.getExcludedMuscleGroups([{ muscle_group: 'core', severity: 'serious' }]);
    expect(excl.has('core')).toBe(true);
    expect(excl.size).toBe(1);
  });
});
