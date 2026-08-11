/**
 * Regimen exercise ordering, where a superset or circuit moves as one unit.
 *
 * `RegimenForm` holds a FLAT array of exercises. Grouping is explicit — every
 * member of a superset carries the same `group_id` — and the form renders
 * those members clustered into one container at the position of the group's
 * first member. So the thing a user sees and reasons about is not the flat
 * array, it is a list of UNITS: each unit is either a lone exercise or a whole
 * group.
 *
 * Reordering operates on units. Kegan chose groups-as-units over
 * reorder-within-group, so dragging a superset moves all of its exercises and
 * keeps them together, and there is no gesture that pulls a member out of one
 * (Ungroup already exists for that).
 *
 * WHY THIS IS SAFER THAN THE DASHBOARD EQUIVALENT, which needed the row list
 * frozen for the length of a drag: there, pairing was derived from ADJACENCY,
 * so reordering re-composed the rows underneath framer and rows appeared and
 * vanished mid-gesture. Here membership comes from `group_id`, which a
 * reorder never touches. Moving units around cannot change which unit an
 * exercise belongs to, so the unit list only ever changes order — the case
 * `Reorder` is built for — and no freeze is required. See lib/dashboardRows.js
 * for the case where it was.
 *
 * `flattenUnits` also NORMALISES: a group's members come out contiguous. They
 * already were in practice (`createGroup` gathers them) but nothing enforced
 * it, and the renderer would happily draw a group whose members were scattered
 * through the array as though they were adjacent. After any reorder the array
 * matches what the screen shows.
 */

// Client-side row identity. Never persisted — `RegimenForm` strips it before
// submit — and never read as data.
export const UID = '_uid';

let seq = 0;

/**
 * Give every exercise a stable per-session id, leaving existing ones alone.
 *
 * A reorderable list of EDITABLE rows needs an identity that survives both the
 * reorder and the editing. The form's rows had `key={index}`, which breaks on
 * reorder (React reuses a node for a different exercise). The obvious repair —
 * key by name — is worse here than it looks: these rows contain the input that
 * SETS the name, so the key would change on every keystroke, remounting the
 * field and dropping focus mid-word. A blank new exercise has no name at all.
 *
 * Hence an id. It is assigned in memory rather than persisted because the
 * saved shape is a public artefact (regimens are shared and sold) and does not
 * need a key that only this form uses.
 */
export function ensureUids(exercises) {
  return (exercises || []).map((ex) =>
    ex && ex[UID] ? ex : { ...ex, [UID]: `rx-${++seq}` });
}

/** Strip the client-only id. Call this before anything leaves the form. */
export function stripUid(exercise) {
  const copy = { ...exercise };
  delete copy[UID];
  return copy;
}

/**
 * Flat exercises → ordered units.
 *
 * A group takes the position of its first member and carries every member,
 * wherever they sit in the flat array. `globalIdx` is preserved on each item
 * because the form's editing helpers (update, remove, select) address
 * exercises by their index in the flat array.
 */
export function buildRegimenUnits(exercises) {
  const units = [];
  const seenGroup = new Set();
  (exercises || []).forEach((ex, globalIdx) => {
    if (ex.group_id) {
      if (seenGroup.has(ex.group_id)) return;
      seenGroup.add(ex.group_id);
      units.push({
        type: 'group',
        key: `group:${ex.group_id}`,
        groupId: ex.group_id,
        groupMeta: ex.group_meta || {},
        items: exercises
          .map((e, ii) => ({ exercise: e, globalIdx: ii }))
          .filter(({ exercise }) => exercise.group_id === ex.group_id),
      });
    } else {
      units.push({
        type: 'single',
        key: `single:${ex[UID] ?? globalIdx}`,
        exercise: ex,
        globalIdx,
      });
    }
  });
  return units;
}

/**
 * Reorder units to match the key order framer reports.
 *
 * Unknown keys are ignored and missing ones dropped, so a callback that
 * arrives after the list has changed cannot resurrect a unit. Units pass
 * through by reference — same object, same key — so React keeps the element.
 */
export function reorderUnits(units, keys) {
  const byKey = new Map(units.map((u) => [u.key, u]));
  return keys.map((k) => byKey.get(k)).filter(Boolean);
}

/** Units → the flat exercise array to store, groups contiguous. */
export function flattenUnits(units) {
  return units.flatMap((u) =>
    (u.type === 'group' ? u.items.map((it) => it.exercise) : [u.exercise]));
}
