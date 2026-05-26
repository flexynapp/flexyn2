// Tests for src/lib/data/dataExport.js — buildExport + downloadExport.
// Mocks supabase.from so each EXPORT_TABLES entry's chain resolves to
// canned rows; verifies the output shape + partial-failure behavior.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromSpy = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: { from: (...args) => fromSpy(...args) },
}));

const { buildExport, downloadExport } = await import('../dataExport');

beforeEach(() => {
  fromSpy.mockReset();
});

// Helper to wire a chainable mock for one .from() return.
function chain(returnVal) {
  const limit = vi.fn().mockResolvedValue(returnVal);
  const eq    = vi.fn().mockReturnValue({ limit });
  const select = vi.fn().mockReturnValue({ eq });
  return { select };
}

describe('buildExport', () => {
  it('throws when user is missing id or email', async () => {
    await expect(buildExport({ id: 'u1' })).rejects.toThrow(/user/);
    await expect(buildExport({ email: 'a@x.com' })).rejects.toThrow(/user/);
    await expect(buildExport(null)).rejects.toThrow(/user/);
  });

  it('returns a structured envelope with schema_version + user + exported_at', async () => {
    fromSpy.mockImplementation(() => chain({ data: [], error: null }));
    const out = await buildExport({ id: 'u1', email: 'u1@x.com' });
    expect(out.schema_version).toBe(1);
    expect(out.user).toEqual({ id: 'u1', email: 'u1@x.com' });
    expect(typeof out.exported_at).toBe('string');
    expect(out.sections).toBeDefined();
  });

  it('fetches every known table once and includes a section per name', async () => {
    fromSpy.mockImplementation(() => chain({ data: [{ id: 1 }], error: null }));
    const out = await buildExport({ id: 'u1', email: 'u1@x.com' });
    // 12 sections from the EXPORT_TABLES array — guards against
    // accidentally dropping rows.
    expect(Object.keys(out.sections).length).toBeGreaterThanOrEqual(10);
    expect(out.sections.workouts).toEqual([{ id: 1 }]);
  });

  it('records per-table errors without blocking other sections', async () => {
    let callCount = 0;
    fromSpy.mockImplementation(() => {
      callCount += 1;
      // First call (profile) errors; rest succeed.
      if (callCount === 1) return chain({ data: null, error: { message: 'rls denied' } });
      return chain({ data: [], error: null });
    });
    const out = await buildExport({ id: 'u1', email: 'u1@x.com' });
    expect(out.sections.profile).toMatchObject({ error: 'fetch_failed', detail: 'rls denied' });
    expect(out.sections.workouts).toEqual([]);
  });

  it('tolerates a thrown fetch and tags the section with fetch_threw', async () => {
    let callCount = 0;
    fromSpy.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return {
          select: () => ({
            eq: () => ({ limit: () => Promise.reject(new Error('network')) }),
          }),
        };
      }
      return chain({ data: [], error: null });
    });
    const out = await buildExport({ id: 'u1', email: 'u1@x.com' });
    expect(out.sections.profile).toMatchObject({ error: 'fetch_threw' });
  });

  it('filters the profile fetch by user id and other tables by email', async () => {
    const captured = [];
    fromSpy.mockImplementation((table) => {
      const limit = vi.fn().mockResolvedValue({ data: [], error: null });
      const eq    = vi.fn((column, value) => { captured.push({ table, column, value }); return { limit }; });
      const select = vi.fn().mockReturnValue({ eq });
      return { select };
    });
    await buildExport({ id: 'u1', email: 'u1@x.com' });
    const profileCall = captured.find(c => c.table === 'user_profiles');
    const workoutCall = captured.find(c => c.table === 'workout_logs');
    expect(profileCall).toMatchObject({ column: 'id',         value: 'u1' });
    expect(workoutCall).toMatchObject({ column: 'created_by', value: 'u1@x.com' });
  });
});

describe('downloadExport', () => {
  it('triggers an <a download> click with a sensible filename', async () => {
    const origCreate = document.createElement.bind(document);
    const click = vi.fn();
    const anchor = origCreate('a');
    anchor.click = click;
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag) =>
      tag === 'a' ? anchor : origCreate(tag)
    );
    const origObj = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();

    await downloadExport({ exported_at: '2025-05-21T19:00:00Z', sections: {} });

    expect(click).toHaveBeenCalled();
    expect(anchor.download).toMatch(/flexyn-data-/);
    expect(anchor.href).toMatch(/blob:|^http/);

    spy.mockRestore();
    URL.createObjectURL = origObj;
  });
});
