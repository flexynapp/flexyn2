// A regimen shared in crew chat or assigned to the crew is usually the
// author's PRIVATE regimen. The regimens table shows it to nobody else, so
// "Equip" said "Regimen not found" for every member but the author and the
// assigned banner rendered without a name. Both now go through the
// get_crew_regimen RPC, and these pin that they do.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const insertSingle = vi.fn();
const assignedRows = { data: [], error: null };

function builder(table) {
  const b = {};
  for (const m of ['select', 'eq', 'order', 'insert']) b[m] = () => b;
  b.single = () => insertSingle(table);
  b.then = (resolve) => resolve(assignedRows);
  return b;
}

vi.mock('@/api/supabaseClient', () => ({
  supabase: { rpc: (...a) => rpc(...a), from: (t) => builder(t) },
}));
vi.mock('@/lib/data/users', () => ({ selectProfiles: vi.fn() }));
vi.mock('@/api/db', () => ({ db: { auth: {}, entities: {} }, default: {} }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

const { equipRegimen, getCrewAssignedRegimens } = await import('@/lib/data/crews');

const SHARED = {
  id: 'r1', user_id: 'author', name: 'Push day', description: null,
  exercises: [{ name: 'Bench' }], original_author_username: 'sam',
};

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(async (fn) => (
    fn === 'get_crew_regimen' ? { data: SHARED, error: null } : { data: null, error: null }
  ));
  insertSingle.mockResolvedValue({ data: { id: 'copy' }, error: null });
});

describe('crew regimens', () => {
  it('equips a regimen through the crew RPC, not a direct read', async () => {
    const copy = await equipRegimen('r1', { id: 'me', email: 'me@x' });
    expect(copy).toEqual({ id: 'copy' });
    expect(rpc).toHaveBeenCalledWith('get_crew_regimen', { p_regimen_id: 'r1' });
  });

  it('says not found when the server will not share it', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(equipRegimen('r1', { id: 'me' })).rejects.toThrow('Regimen not found');
  });

  it('fills an assigned regimen the embed could not see', async () => {
    assignedRows.data = [
      { id: 'a1', regimen_id: 'r1', regimens: null },
      { id: 'a2', regimen_id: 'r2', regimens: { id: 'r2', name: 'Own' } },
    ];
    const rows = await getCrewAssignedRegimens('crew');
    expect(rows[0].regimens.name).toBe('Push day');
    expect(rows[1].regimens.name).toBe('Own');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
