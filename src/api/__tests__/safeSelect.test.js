import { describe, it, expect, vi } from 'vitest';
import { safeSelect, __testOnly__ } from '../safeSelect';

const { identifyMissingColumn } = __testOnly__;

describe('safeSelect — happy path', () => {
  it('returns the result on first success without retrying', async () => {
    const build = vi.fn(async (cols) => ({ data: { cols }, error: null }));
    const out = await safeSelect({ columns: ['a', 'b'], build });
    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith('a, b');
    expect(out).toEqual({ data: { cols: 'a, b' }, error: null });
  });
});

describe('safeSelect — PGRST204 (PostgREST schema-cache miss)', () => {
  it('strips the named column and retries until success', async () => {
    const build = vi.fn(async (cols) => {
      if (cols.includes('b')) {
        return {
          data: null,
          error: { code: 'PGRST204', message: "Could not find the 'b' column of 'tbl' in the schema cache" },
        };
      }
      return { data: { cols }, error: null };
    });
    const out = await safeSelect({ columns: ['a', 'b', 'c'], build });
    expect(build).toHaveBeenCalledTimes(2);
    // Second call should drop 'b' but keep 'a' and 'c' in order
    expect(build).toHaveBeenNthCalledWith(2, 'a, c');
    expect(out).toEqual({ data: { cols: 'a, c' }, error: null });
  });

  it('handles the alternate PGRST204 message shape', async () => {
    const build = vi.fn(async (cols) => {
      if (cols.includes('alt')) {
        return { data: null, error: { code: 'PGRST204', message: "column 'alt' does not exist" } };
      }
      return { data: 'ok', error: null };
    });
    const out = await safeSelect({ columns: ['x', 'alt'], build });
    expect(out.data).toBe('ok');
  });
});

describe('safeSelect — 42703 (Postgres undefined_column)', () => {
  it('strips on the bare "column X does not exist" form', async () => {
    const build = vi.fn(async (cols) => {
      if (cols.includes('b')) {
        return { data: null, error: { code: '42703', message: 'column "b" does not exist' } };
      }
      return { data: { cols }, error: null };
    });
    const out = await safeSelect({ columns: ['a', 'b'], build });
    expect(out.data).toEqual({ cols: 'a' });
  });

  it('strips on the qualified "table.col" form', async () => {
    const build = vi.fn(async (cols) => {
      if (cols.includes('country_flag')) {
        return {
          data: null,
          error: { code: '42703', message: 'column user_profiles.country_flag does not exist' },
        };
      }
      return { data: { cols }, error: null };
    });
    const out = await safeSelect({ columns: ['email', 'country_flag', 'username'], build });
    expect(out.data).toEqual({ cols: 'email, username' });
  });

  it('reads error.hint as a fallback when the column name only appears there', async () => {
    const build = vi.fn(async (cols) => {
      if (cols.includes('b')) {
        return {
          data: null,
          error: { code: '42703', message: 'cryptic', hint: 'column "b" does not exist' },
        };
      }
      return { data: 'ok', error: null };
    });
    const out = await safeSelect({ columns: ['a', 'b'], build });
    expect(out.data).toBe('ok');
  });
});

describe('safeSelect — error pass-through', () => {
  it('returns unrecognized errors verbatim without retrying', async () => {
    const build = vi.fn(async () => ({
      data: null,
      error: { code: 'PGRST301', message: 'JWT expired' },
    }));
    const out = await safeSelect({ columns: ['a', 'b'], build });
    expect(build).toHaveBeenCalledTimes(1);
    expect(out.error.code).toBe('PGRST301');
  });

  it('returns a 42703 error verbatim when the column is NOT in the caller list (foreign-column safety)', async () => {
    const build = vi.fn(async () => ({
      data: null,
      error: { code: '42703', message: 'column "secret_internal" does not exist' },
    }));
    const out = await safeSelect({ columns: ['email', 'username'], build });
    expect(build).toHaveBeenCalledTimes(1);
    expect(out.error.code).toBe('42703');
  });
});

describe('safeSelect — termination', () => {
  it('returns the error when only one column remains and it is the missing one', async () => {
    const build = vi.fn(async () => ({
      data: null,
      error: { code: 'PGRST204', message: "the 'only_one' column missing" },
    }));
    const out = await safeSelect({ columns: ['only_one'], build });
    expect(build).toHaveBeenCalledTimes(1);
    expect(out.error.code).toBe('PGRST204');
  });

  it('refuses to run without columns', async () => {
    const build = vi.fn();
    await expect(safeSelect({ columns: [], build })).rejects.toThrow(/non-empty/);
    expect(build).not.toHaveBeenCalled();
  });

  it('refuses to run without a build function', async () => {
    await expect(safeSelect({ columns: ['a'], build: null })).rejects.toThrow(/must be a function/);
  });
});

describe('identifyMissingColumn — direct introspection', () => {
  it('returns null for unknown error shapes', () => {
    expect(identifyMissingColumn(null, ['a'])).toBe(null);
    expect(identifyMissingColumn({}, ['a'])).toBe(null);
    expect(identifyMissingColumn({ code: 'PGRST301', message: 'JWT' }, ['a'])).toBe(null);
  });

  it('returns null when column is not in the caller list', () => {
    const err = { code: '42703', message: 'column "foreign" does not exist' };
    expect(identifyMissingColumn(err, ['a', 'b'])).toBe(null);
  });

  it('extracts column names from both qualified and bare 42703 forms', () => {
    expect(identifyMissingColumn(
      { code: '42703', message: 'column "x" does not exist' },
      ['x', 'y'],
    )).toBe('x');
    expect(identifyMissingColumn(
      { code: '42703', message: 'column tbl.x does not exist' },
      ['x', 'y'],
    )).toBe('x');
  });

  it('extracts from PGRST204 in either phrasing', () => {
    expect(identifyMissingColumn(
      { code: 'PGRST204', message: "the 'x' column of tbl" },
      ['x'],
    )).toBe('x');
    expect(identifyMissingColumn(
      { code: 'PGRST204', message: "column 'x' missing" },
      ['x'],
    )).toBe('x');
  });
});
