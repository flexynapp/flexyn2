import { describe, it, expect, beforeEach, vi } from 'vitest';

// Chainable supabase mock — captures the called columns + emits whatever
// the test stages. Because debriefs.js wraps reads in safeSelect, the
// mock must support .from().select(cols).order(col, opts).order(col, opts)
// and .from().select(cols).order().order().limit().maybeSingle().
const _state = {
  lastTable: null,
  lastSelectCols: null,
  lastRpc: null,
  nextData: null,
  nextError: null,
};

vi.mock('@/api/supabaseClient', () => {
  const finalize = () => ({ data: _state.nextData, error: _state.nextError });

  return {
    supabase: {
      rpc: async (name, params) => {
        _state.lastRpc = { name, params };
        return { data: { ok: true }, error: null };
      },
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
  _state.lastRpc = null;
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

// ── Week-window helpers ──────────────────────────────────────────────────────
// Regression coverage for the audit-found bug: currentWeekStart() shifted to
// the local Monday correctly but serialized via toISOString().slice(0, 10) —
// the UTC calendar day — so users west of UTC in their evening (or east of
// UTC in their early morning) asked the RPC for the WRONG week, and
// DebriefVault's `ws === thisWeek` current-week comparison missed. The fix
// serializes from LOCAL date parts (toLocalDateString). All inputs below are
// explicit local-part Date constructions so the suite is timezone-agnostic.

describe('currentWeekStart', () => {
  it('returns the local Monday for a mid-week date', () => {
    // Wednesday June 10 2026 → Monday June 8
    expect(debriefs.currentWeekStart(new Date(2026, 5, 10))).toBe('2026-06-08');
  });

  it('treats Sunday as the END of the week (ISO)', () => {
    // Sunday June 14 2026 → Monday June 8 (not June 15)
    expect(debriefs.currentWeekStart(new Date(2026, 5, 14))).toBe('2026-06-08');
  });

  it('is idempotent on a Monday', () => {
    expect(debriefs.currentWeekStart(new Date(2026, 5, 8))).toBe('2026-06-08');
  });

  it('keeps the LOCAL day at the edges of Monday (the toISOString trap)', () => {
    // 23:30 local Monday is already Tuesday in UTC for any TZ west of
    // UTC-0:30 — the old serialization returned 2026-06-09 there.
    expect(debriefs.currentWeekStart(new Date(2026, 5, 8, 23, 30))).toBe('2026-06-08');
    // 00:10 local Monday is still Sunday in UTC for TZs east of UTC+0:10 —
    // the old code returned LAST week's Monday there.
    expect(debriefs.currentWeekStart(new Date(2026, 5, 8, 0, 10))).toBe('2026-06-08');
  });

  it('crosses month boundaries correctly', () => {
    // Wednesday July 1 2026 → Monday June 29
    expect(debriefs.currentWeekStart(new Date(2026, 6, 1))).toBe('2026-06-29');
  });
});

describe('prevWeekStart', () => {
  it('returns the Monday of the previous week', () => {
    expect(debriefs.prevWeekStart(new Date(2026, 5, 10))).toBe('2026-06-01');
  });

  it('crosses month boundaries correctly', () => {
    // Wednesday June 3 2026 → previous Monday is May 25
    expect(debriefs.prevWeekStart(new Date(2026, 5, 3))).toBe('2026-05-25');
  });
});

describe('generateWeeklyDebrief — week-start serialization', () => {
  it('passes string week starts through untouched', async () => {
    await debriefs.generateWeeklyDebrief('2026-06-08');
    expect(_state.lastRpc).toEqual({
      name: 'generate_my_weekly_debrief',
      params: { p_week_start: '2026-06-08' },
    });
  });

  it('serializes Date week starts from LOCAL parts, not UTC', async () => {
    // 23:30 local — toISOString() flips this to June 9 in any TZ west
    // of UTC-0:30.
    await debriefs.generateWeeklyDebrief(new Date(2026, 5, 8, 23, 30));
    expect(_state.lastRpc).toEqual({
      name: 'generate_my_weekly_debrief',
      params: { p_week_start: '2026-06-08' },
    });
  });

  it('omits the param for the current-week default', async () => {
    await debriefs.generateWeeklyDebrief();
    expect(_state.lastRpc).toEqual({
      name: 'generate_my_weekly_debrief',
      params: {},
    });
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
