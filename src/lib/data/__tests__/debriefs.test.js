import { describe, it, expect, beforeEach, vi } from 'vitest';

// Chainable supabase mock — captures the called columns + emits whatever
// the test stages. Because debriefs.js wraps reads in safeSelect, the
// mock must support .from().select(cols).order(col, opts).order(col, opts)
// and .from().select(cols).order().order().limit().maybeSingle().
const _state = {
  lastTable: null,
  lastSelectCols: null,
  nextData: null,
  nextError: null,
};

vi.mock('@/api/supabaseClient', () => {
  const finalize = () => ({ data: _state.nextData, error: _state.nextError });

  return {
    supabase: {
      from: (table) => {
        _state.lastTable = table;
        return {
          select: (cols) => {
            _state.lastSelectCols = cols;
            // Build a chain object that supports the call shapes both
            // listDebriefs and latestDebrief use, AND the SELECT * path
            // used by getDebrief.
            const chain = {
              order: () => chain,                    // chain .order().order()
              limit: () => chain,
              maybeSingle: async () => finalize(),
              eq:  () => chain,
              then: (resolve, reject) => Promise.resolve(finalize()).then(resolve, reject),
            };
            return chain;
          },
        };
      },
    },
  };
});

const debriefs = await import('../debriefs');

beforeEach(() => {
  _state.lastTable = null;
  _state.lastSelectCols = null;
  _state.nextData = null;
  _state.nextError = null;
});

describe('listDebriefs', () => {
  it('queries weekly_debriefs with the documented column list', async () => {
    _state.nextData = [];
    await debriefs.listDebriefs();
    expect(_state.lastTable).toBe('weekly_debriefs');
    // safeSelect joins the array — exact order matters for snapshot stability
    expect(_state.lastSelectCols).toBe(
      'id, week_number, year, week_label, epoch_id, epoch_name, data, created_at'
    );
  });

  it('returns the rows on success', async () => {
    _state.nextData = [{ id: 'd1', week_number: 20, year: 2026 }];
    expect(await debriefs.listDebriefs()).toEqual([{ id: 'd1', week_number: 20, year: 2026 }]);
  });

  it('returns [] when supabase returns null data', async () => {
    _state.nextData = null;
    expect(await debriefs.listDebriefs()).toEqual([]);
  });

  it('throws on a non-schema-cache error', async () => {
    _state.nextError = { code: 'PGRST301', message: 'JWT expired' };
    await expect(debriefs.listDebriefs()).rejects.toMatchObject({ code: 'PGRST301' });
  });
});

describe('latestDebrief', () => {
  it('queries weekly_debriefs limited to 1 row', async () => {
    _state.nextData = { id: 'd1' };
    const row = await debriefs.latestDebrief();
    expect(_state.lastTable).toBe('weekly_debriefs');
    expect(row).toEqual({ id: 'd1' });
  });

  it('returns null when no debrief exists yet', async () => {
    _state.nextData = null;
    expect(await debriefs.latestDebrief()).toBe(null);
  });

  it('throws on error', async () => {
    _state.nextError = { code: 'PGRST301', message: 'denied' };
    await expect(debriefs.latestDebrief()).rejects.toMatchObject({ code: 'PGRST301' });
  });
});

describe('getDebrief (single by id, SELECT *)', () => {
  it('uses SELECT * — no columns explicitly named (column-agnostic)', async () => {
    _state.nextData = { id: 'd1', custom_future_column: 'ok' };
    const row = await debriefs.getDebrief('d1');
    expect(_state.lastSelectCols).toBe('*');
    expect(row).toEqual({ id: 'd1', custom_future_column: 'ok' });
  });

  it('returns null when the id is unknown', async () => {
    _state.nextData = null;
    expect(await debriefs.getDebrief('missing')).toBe(null);
  });

  it('throws on error', async () => {
    _state.nextError = { message: 'denied' };
    await expect(debriefs.getDebrief('d1')).rejects.toMatchObject({ message: 'denied' });
  });
});

describe('debriefs — safeSelect integration', () => {
  it('strips a PGRST204 column miss and retries', async () => {
    // First call: PGRST204 on epoch_id. Second call: success without that col.
    let callIndex = 0;
    _state.nextData = null;
    _state.nextError = null;

    // Re-stub from() so we can return different results on each call
    const { supabase } = await import('@/api/supabaseClient');
    const originalSelect = supabase.from('weekly_debriefs').select;

    // Patch the mock to alternate responses
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      _state.lastTable = table;
      return {
        select: (cols) => {
          _state.lastSelectCols = cols;
          const isFirst = callIndex++ === 0;
          const result = isFirst
            ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'epoch_id' column of 'weekly_debriefs'" } }
            : { data: [{ id: 'd1' }], error: null };
          const chain = {
            order: () => chain,
            limit: () => chain,
            maybeSingle: async () => result,
            then: (resolve) => Promise.resolve(result).then(resolve),
          };
          return chain;
        },
      };
    });

    const rows = await debriefs.listDebriefs();
    expect(callIndex).toBe(2); // one retry happened
    expect(rows).toEqual([{ id: 'd1' }]);
    // Second call should have stripped epoch_id
    expect(_state.lastSelectCols).not.toContain('epoch_id');
  });
});
