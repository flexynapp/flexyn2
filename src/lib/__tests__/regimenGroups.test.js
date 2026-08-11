import { describe, it, expect } from 'vitest';
import {
  UID, ensureUids, stripUid, buildRegimenUnits, reorderUnits, flattenUnits,
} from '../regimenGroups';

/* Reordering a regimen has to move a superset as one thing. The form holds a
 * FLAT array and grouping is carried on each exercise as `group_id`, so the
 * list the user manipulates — units — is derived, and the derivation has to
 * survive a round trip: units → new order → flat array → units again.
 *
 * The identity problem is the interesting half. These rows are editable, so
 * the key has to survive both a reorder AND typing in the name field, which
 * rules out the index (breaks on reorder) and the name (changes per keystroke,
 * remounting the input mid-word). Hence a client-only id that never reaches
 * the database.
 */

const ex = (name, extra = {}) => ({ name, target_sets: 3, target_reps: 8, ...extra });
const GROUP = { type: 'superset', round_count: 3 };

describe('ensureUids / stripUid — identity that never reaches the database', () => {
  it('gives every exercise an id', () => {
    const list = ensureUids([ex('Squat'), ex('Bench')]);
    expect(list[0][UID]).toBeTruthy();
    expect(list[1][UID]).toBeTruthy();
    expect(list[0][UID]).not.toBe(list[1][UID]);
  });

  it('leaves an existing id alone, so re-running it is not a reshuffle', () => {
    const first = ensureUids([ex('Squat'), ex('Bench')]);
    const again = ensureUids(first);
    expect(again[0][UID]).toBe(first[0][UID]);
    expect(again[1][UID]).toBe(first[1][UID]);
  });

  it('gives distinct ids to two blank exercises, which name-keying cannot', () => {
    const list = ensureUids([ex(''), ex('')]);
    expect(list[0][UID]).not.toBe(list[1][UID]);
  });

  it('strips the id without touching anything else', () => {
    const [one] = ensureUids([ex('Squat', { notes: 'belt' })]);
    const clean = stripUid(one);
    expect(UID in clean).toBe(false);
    expect(clean).toEqual({ name: 'Squat', target_sets: 3, target_reps: 8, notes: 'belt' });
  });

  it('tolerates an empty or missing list', () => {
    expect(ensureUids([])).toEqual([]);
    expect(ensureUids(undefined)).toEqual([]);
  });
});

describe('buildRegimenUnits — a group is one unit, at its first member', () => {
  it('turns a flat array into singles and groups', () => {
    const list = ensureUids([
      ex('Squat'),
      ex('Curl', { group_id: 'g1', group_meta: GROUP }),
      ex('Pushdown', { group_id: 'g1', group_meta: GROUP }),
      ex('Row'),
    ]);
    const units = buildRegimenUnits(list);
    expect(units.map((u) => u.type)).toEqual(['single', 'group', 'single']);
    expect(units[1].groupId).toBe('g1');
    expect(units[1].items.map((i) => i.exercise.name)).toEqual(['Curl', 'Pushdown']);
  });

  it('keeps globalIdx, which is how the form addresses exercises for edits', () => {
    const list = ensureUids([
      ex('Squat'),
      ex('Curl', { group_id: 'g1' }),
      ex('Pushdown', { group_id: 'g1' }),
    ]);
    const units = buildRegimenUnits(list);
    expect(units[0].globalIdx).toBe(0);
    expect(units[1].items.map((i) => i.globalIdx)).toEqual([1, 2]);
  });

  it('gathers a group whose members are scattered through the flat array', () => {
    // Nothing enforces contiguity in storage; the renderer already drew these
    // as one container, so the unit list must agree.
    const list = ensureUids([
      ex('Curl', { group_id: 'g1' }),
      ex('Squat'),
      ex('Pushdown', { group_id: 'g1' }),
    ]);
    const units = buildRegimenUnits(list);
    expect(units.map((u) => u.type)).toEqual(['group', 'single']);
    expect(units[0].items.map((i) => i.exercise.name)).toEqual(['Curl', 'Pushdown']);
  });

  it('keys singles by their id, so the key survives renaming the exercise', () => {
    const [one] = ensureUids([ex('')]);
    const before = buildRegimenUnits([one])[0].key;
    const after = buildRegimenUnits([{ ...one, name: 'Squat' }])[0].key;
    // Same row, same key — the name input is inside this row and must not
    // remount while it is being typed into.
    expect(after).toBe(before);
  });
});

describe('reorderUnits + flattenUnits — the round trip', () => {
  const list = ensureUids([
    ex('Squat'),
    ex('Curl', { group_id: 'g1', group_meta: GROUP }),
    ex('Pushdown', { group_id: 'g1', group_meta: GROUP }),
    ex('Row'),
  ]);
  const units = buildRegimenUnits(list);
  const keyOf = (t, n) => units.find((u) => (u.type === 'group' ? u.groupId === n : u.exercise.name === n)).key;

  it('moves a whole superset when its unit moves', () => {
    const moved = reorderUnits(units, [keyOf('group', 'g1'), keyOf('single', 'Squat'), keyOf('single', 'Row')]);
    expect(flattenUnits(moved).map((e) => e.name)).toEqual(['Curl', 'Pushdown', 'Squat', 'Row']);
  });

  it('never splits a group, whatever the order', () => {
    const moved = reorderUnits(units, [keyOf('single', 'Row'), keyOf('group', 'g1'), keyOf('single', 'Squat')]);
    const names = flattenUnits(moved).map((e) => e.name);
    expect(names).toEqual(['Row', 'Curl', 'Pushdown', 'Squat']);
    // Members adjacent, and both still carry the group.
    expect(flattenUnits(moved).filter((e) => e.group_id === 'g1')).toHaveLength(2);
    expect(names.indexOf('Pushdown') - names.indexOf('Curl')).toBe(1);
  });

  it('round-trips: flatten then rebuild gives the same unit order', () => {
    const moved = reorderUnits(units, [keyOf('group', 'g1'), keyOf('single', 'Row'), keyOf('single', 'Squat')]);
    const rebuilt = buildRegimenUnits(flattenUnits(moved));
    expect(rebuilt.map((u) => u.key)).toEqual(moved.map((u) => u.key));
  });

  it('loses no exercises', () => {
    const moved = reorderUnits(units, [keyOf('single', 'Row'), keyOf('group', 'g1'), keyOf('single', 'Squat')]);
    expect(flattenUnits(moved)).toHaveLength(list.length);
  });

  it('passes units through by reference so React keeps the element', () => {
    const moved = reorderUnits(units, [keyOf('single', 'Row'), keyOf('single', 'Squat'), keyOf('group', 'g1')]);
    expect(moved[2]).toBe(units.find((u) => u.type === 'group'));
  });

  it('ignores a key it does not know', () => {
    const moved = reorderUnits(units, ['single:ghost', keyOf('single', 'Squat')]);
    expect(moved.map((u) => u.key)).toEqual([keyOf('single', 'Squat')]);
  });

  it('normalises a scattered group into contiguous members', () => {
    const scattered = ensureUids([
      ex('Curl', { group_id: 'g1' }),
      ex('Squat'),
      ex('Pushdown', { group_id: 'g1' }),
    ]);
    const rebuilt = flattenUnits(buildRegimenUnits(scattered));
    expect(rebuilt.map((e) => e.name)).toEqual(['Curl', 'Pushdown', 'Squat']);
  });
});

describe('the id stays out of the database', () => {
  // A regimen is a shared, sellable artefact — its exercise JSON is a public
  // shape. `_uid` is this form's row identity and nothing else, and the
  // submit path spreads `...ex`, so it would ride along unless stripped.
  // Asserting on the source because the alternative is standing up the whole
  // form; same approach as sheetShell.test.jsx's re-inlining guard.
  it('RegimenForm strips it before handing exercises to onSubmit', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('src/components/regimens/RegimenForm.jsx', 'utf8');
    expect(src, 'the submit normalise step no longer strips the row id')
      .toMatch(/exercises\.map\(stripUid\)/);
  });

  it('and the only writer of the id is ensureUids', async () => {
    // If a literal `_uid:` assignment appears in the form, some other path is
    // minting ids and stripUid may not know about it.
    const fs = await import('fs');
    const src = fs.readFileSync('src/components/regimens/RegimenForm.jsx', 'utf8');
    expect(src).not.toMatch(/_uid\s*:/);
  });
});
