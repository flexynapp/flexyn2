// src/lib/data/__tests__/equipment.test.js
//
// The persist-a-photo chain, which had no direct coverage until now:
// the only thing exercising `persistEquipmentPhoto` was a mock in
// ImplementPicker.test.jsx that always returned null, so every step
// BETWEEN the picker and the database was untested.
//
// The chain was separately verified against production RLS (as
// `authenticated`, inside a rolled-back transaction) — all four writes
// and all three read-backs pass. These tests pin the CLIENT half of
// that: the statement sequence, the payloads, and the two traps the
// module's comments call out.
//
// The two traps, both of which look fine until they aren't:
//   • the identity filter must use `.is(col, null)` for absent
//     product_line / model_name. `.eq(col, '')` never matches a NULL,
//     so every lookup would miss, fall through to insert, and 23505.
//   • `approved` must always go in false. An insert that could set it
//     true would publish straight into the global catalog.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Chainable supabase mock ──────────────────────────────────────────
// Records every builder call in order and hands back whatever the test
// staged, so a test can assert on the SEQUENCE of statements rather
// than just the last one — the sequencing is the thing under test.

const calls = [];
let queue = [];

function stage(...responses) {
  queue = responses.map(r => ({ data: r?.data ?? null, error: r?.error ?? null }));
}

function makeChain(table) {
  const rec = { table, op: 'select', payload: null, cols: null, filters: [] };
  calls.push(rec);
  const settle = () => queue.shift() ?? { data: null, error: null };
  const chain = {
    select: (cols) => { rec.cols = cols; return chain; },
    insert: (row) => { rec.op = 'insert'; rec.payload = row; return chain; },
    update: (patch) => { rec.op = 'update'; rec.payload = patch; return chain; },
    delete: () => { rec.op = 'delete'; return chain; },
    eq: (c, v) => { rec.filters.push(['eq', c, v]); return chain; },
    is: (c, v) => { rec.filters.push(['is', c, v]); return chain; },
    in: (c, v) => { rec.filters.push(['in', c, v]); return chain; },
    order: (c, o) => { rec.filters.push(['order', c, o]); return chain; },
    limit: (n) => { rec.filters.push(['limit', n]); return chain; },
    single: async () => settle(),
    maybeSingle: async () => settle(),
    then: (res, rej) => Promise.resolve(settle()).then(res, rej),
  };
  return chain;
}

vi.mock('@/api/supabaseClient', () => ({
  supabase: { from: (table) => makeChain(table) },
}));

const reportError = vi.fn();
vi.mock('@/lib/reportError', () => ({ reportError: (...a) => reportError(...a) }));

const eq = await import('../equipment');

const USER = 'user-1';
const URL_ = 'https://cdn.example.test/uploads/user-1/1.jpg';

beforeEach(() => {
  calls.length = 0;
  queue = [];
  reportError.mockClear();
});

const tables = () => calls.map(c => `${c.table}.${c.op}`);
const find = (table, op) => calls.find(c => c.table === table && c.op === op);

// ── getOrCreateHomeSpace ─────────────────────────────────────────────

describe('getOrCreateHomeSpace', () => {
  it('returns the existing space without writing', async () => {
    stage({ data: [{ id: 'space-1', name: 'My gear', kind: 'home' }] });
    const space = await eq.getOrCreateHomeSpace(USER);
    expect(space.id).toBe('space-1');
    expect(tables()).toEqual(['training_spaces.select']);
  });

  it('creates one on first use, flagged home + default', async () => {
    stage({ data: [] }, { data: { id: 'space-1', name: 'My gear', kind: 'home' } });
    const space = await eq.getOrCreateHomeSpace(USER);
    expect(space.id).toBe('space-1');
    expect(find('training_spaces', 'insert').payload).toEqual({
      owner_id: USER, kind: 'home', name: 'My gear', is_default: true,
    });
  });

  it('takes the OLDEST space when the create raced into two', async () => {
    // Documented as harmless precisely because the read is ordered
    // ascending and limited to 1 — if that ordering is ever dropped the
    // race stops being harmless, so pin it.
    stage({ data: [{ id: 'older', name: 'My gear', kind: 'home' }] });
    await eq.getOrCreateHomeSpace(USER);
    expect(calls[0].filters).toContainEqual(['order', 'created_at', { ascending: true }]);
    expect(calls[0].filters).toContainEqual(['limit', 1]);
  });

  it('degrades to null rather than throwing', async () => {
    stage({ error: { message: 'nope' } });
    await expect(eq.getOrCreateHomeSpace(USER)).resolves.toBeNull();
    expect(reportError).toHaveBeenCalledWith(expect.anything(), { feature: 'equipment.homeSpace' });
  });

  it('is a no-op without a user', async () => {
    await expect(eq.getOrCreateHomeSpace(null)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});

// ── findOrCreateModel ────────────────────────────────────────────────

describe('findOrCreateModel', () => {
  it('matches absent line/model with .is(null), never .eq("")', async () => {
    stage({ data: [{ id: 'model-1' }] });
    await eq.findOrCreateModel({ brand: 'rogue', implementType: 'rower', userId: USER });
    expect(calls[0].filters).toEqual(expect.arrayContaining([
      ['eq', 'brand_slug', 'rogue'],
      ['eq', 'implement_type', 'rower'],
      ['is', 'product_line', null],
      ['is', 'model_name', null],
    ]));
  });

  it('uses .eq for the fields that are present', async () => {
    stage({ data: [{ id: 'model-1' }] });
    await eq.findOrCreateModel({
      brand: 'hammer-strength', line: 'Select', model: 'Row',
      implementType: 'row-machine', userId: USER,
    });
    expect(calls[0].filters).toEqual(expect.arrayContaining([
      ['eq', 'product_line', 'Select'],
      ['eq', 'model_name', 'Row'],
    ]));
  });

  it('submits unapproved, unseeded, attributed to the submitter', async () => {
    stage({ data: [] }, { data: { id: 'model-1' } });
    const id = await eq.findOrCreateModel({
      brand: 'rogue', model: 'Echo', implementType: 'rower', userId: USER,
    });
    expect(id).toBe('model-1');
    expect(find('equipment_models', 'insert').payload).toMatchObject({
      approved: false, is_seeded: false, submitted_by: USER,
      product_line: null, model_name: 'Echo',
    });
  });

  it('re-reads instead of failing when the unique index catches a race', async () => {
    stage(
      { data: [] },                                  // initial miss
      { error: { code: '23505' } },                  // concurrent insert won
      { data: [{ id: 'model-raced' }] },             // re-read
    );
    const id = await eq.findOrCreateModel({
      brand: 'rogue', implementType: 'rower', userId: USER,
    });
    expect(id).toBe('model-raced');
    expect(reportError).not.toHaveBeenCalled();
  });

  it('falls through to insert when the READ fails (read errors are not fatal)', async () => {
    stage({ error: { message: 'transient' } }, { data: { id: 'model-1' } });
    await expect(eq.findOrCreateModel({
      brand: 'rogue', implementType: 'rower', userId: USER,
    })).resolves.toBe('model-1');
  });

  it('degrades to null when the insert fails for any other reason', async () => {
    stage({ data: [] }, { error: { code: '42501' } });
    await expect(eq.findOrCreateModel({
      brand: 'rogue', implementType: 'rower', userId: USER,
    })).resolves.toBeNull();
  });
});

// ── ensureSpaceEquipment ─────────────────────────────────────────────

describe('ensureSpaceEquipment', () => {
  it('reuses the existing row for that model in that space', async () => {
    stage({ data: [{ id: 'equip-1', photo_url: 'old.jpg' }] });
    const row = await eq.ensureSpaceEquipment({
      spaceId: 'space-1', modelId: 'model-1', implementType: 'rower', userId: USER,
    });
    expect(row.id).toBe('equip-1');
    expect(tables()).toEqual(['space_equipment.select']);
  });

  it('skips the lookup entirely when there is no model to match on', async () => {
    stage({ data: { id: 'equip-1', photo_url: null } });
    await eq.ensureSpaceEquipment({
      spaceId: 'space-1', modelId: null, implementType: 'rower', userId: USER,
    });
    expect(tables()).toEqual(['space_equipment.insert']);
    expect(find('space_equipment', 'insert').payload).toMatchObject({
      space_id: 'space-1', model_id: null, implement_type: 'rower', added_by: USER,
    });
  });
});

// ── attachPhoto ──────────────────────────────────────────────────────

describe('attachPhoto', () => {
  it('denormalizes onto space_equipment.photo_url when primary', async () => {
    stage({ data: { id: 'photo-1', url: URL_ } }, { data: null });
    const photo = await eq.attachPhoto({
      equipmentId: 'equip-1', modelId: 'model-1', url: URL_, userId: USER, makePrimary: true,
    });
    expect(photo.url).toBe(URL_);
    expect(tables()).toEqual(['equipment_photos.insert', 'space_equipment.update']);
    expect(find('space_equipment', 'update').payload).toEqual({ photo_url: URL_ });
    expect(find('equipment_photos', 'insert').payload).toMatchObject({
      equipment_id: 'equip-1', uploaded_by: USER, is_primary: true,
    });
  });

  it('leaves an existing primary alone', async () => {
    stage({ data: { id: 'photo-2', url: URL_ } });
    await eq.attachPhoto({
      equipmentId: 'equip-1', url: URL_, userId: USER, makePrimary: false,
    });
    expect(tables()).toEqual(['equipment_photos.insert']);
  });

  it('degrades to null when the photo row is rejected', async () => {
    stage({ error: { code: '42501' } });
    await expect(eq.attachPhoto({
      equipmentId: 'equip-1', url: URL_, userId: USER, makePrimary: true,
    })).resolves.toBeNull();
    expect(reportError).toHaveBeenCalledWith(expect.anything(), { feature: 'equipment.attachPhoto' });
  });
});

// ── persistEquipmentPhoto — the whole chain ──────────────────────────

describe('persistEquipmentPhoto', () => {
  const implement = {
    brand: 'rogue', model: 'Echo', implementType: 'rower', label: 'Rogue Echo',
  };

  it('walks space → model → equipment → photo and returns the url', async () => {
    stage(
      { data: [] },                                        // home space miss
      { data: { id: 'space-1' } },                         // home space created
      { data: [] },                                        // model miss
      { data: { id: 'model-1' } },                         // model created
      { data: [] },                                        // equipment miss
      { data: { id: 'equip-1', photo_url: null } },        // equipment created
      { data: { id: 'photo-1', url: URL_ } },              // photo row
      { data: null },                                      // photo_url denormalize
    );
    await expect(eq.persistEquipmentPhoto({ implement, url: URL_, userId: USER }))
      .resolves.toBe(URL_);
    expect(tables()).toEqual([
      'training_spaces.select', 'training_spaces.insert',
      'equipment_models.select', 'equipment_models.insert',
      'space_equipment.select', 'space_equipment.insert',
      'equipment_photos.insert', 'space_equipment.update',
    ]);
  });

  it('does NOT steal the primary slot when the machine already has a photo', async () => {
    stage(
      { data: [{ id: 'space-1' }] },
      { data: [{ id: 'model-1' }] },
      { data: [{ id: 'equip-1', photo_url: 'someone-elses.jpg' }] },
      { data: { id: 'photo-2', url: URL_ } },
    );
    await eq.persistEquipmentPhoto({ implement, url: URL_, userId: USER });
    expect(find('equipment_photos', 'insert').payload.is_primary).toBe(false);
    expect(find('space_equipment', 'update')).toBeUndefined();
  });

  it('returns null when the space cannot be resolved, without writing further', async () => {
    stage({ error: { message: 'rls' } });
    await expect(eq.persistEquipmentPhoto({ implement, url: URL_, userId: USER }))
      .resolves.toBeNull();
    expect(tables()).toEqual(['training_spaces.select']);
  });

  it('still persists the equipment row when the model cannot be created', async () => {
    // A null model is survivable — the row hangs off the space with its
    // implement_type, so the photo is not lost.
    stage(
      { data: [{ id: 'space-1' }] },
      { data: [] },
      { error: { code: '42501' } },                        // model insert rejected
      { data: { id: 'equip-1', photo_url: null } },        // equipment insert
      { data: { id: 'photo-1', url: URL_ } },
      { data: null },
    );
    await expect(eq.persistEquipmentPhoto({ implement, url: URL_, userId: USER }))
      .resolves.toBe(URL_);
    expect(find('space_equipment', 'insert').payload.model_id).toBeNull();
  });

  it('is a no-op when any required argument is missing', async () => {
    await expect(eq.persistEquipmentPhoto({ implement, url: URL_ })).resolves.toBeNull();
    await expect(eq.persistEquipmentPhoto({ implement, userId: USER })).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});
