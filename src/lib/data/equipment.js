// src/lib/data/equipment.js
//
// Data access for the equipment picker's persistent side — training
// spaces, the equipment in them, and the photos users take of it.
// Schema is migration 268.
//
// ── Scope note ───────────────────────────────────────────────────────
// This is the THIN slice Phase 3 needs, not the full space model.
// Phase 3's whole point is "show a photo of that exact machine", and a
// photo needs a space_equipment row to hang off (equipment_photos FKs
// to it). So this module gets a user to a persisted equipment row with
// as little ceremony as possible: one implicit "My gear" home space,
// created on first photo upload.
//
// What Phase 4 adds on top: gym-kind spaces, owner curation, the
// verified flag, multiple named spaces, and reading a gym's shared
// floor into the picker. None of that changes the functions here.
//
// ── Everything here degrades to null, never throws to the UI ─────────
// The picker works fully offline off the bundled catalog. If these
// tables are unreachable (partial deploy, offline, RLS surprise), the
// user must still be able to log their workout — a photo failing is
// not a reason to block a set. Callers treat a null return as "no
// photo available" and fall through to the silhouette.

import { supabase } from '@/api/supabaseClient';
import { reportError } from '@/lib/reportError';

const DEFAULT_HOME_SPACE_NAME = 'My gear';

/**
 * The user's default home space, creating it on first use.
 * Returns null if it can't be resolved — callers fall back to local-only.
 */
export async function getOrCreateHomeSpace(userId) {
  if (!userId) return null;
  try {
    const { data: existing, error: readErr } = await supabase
      .from('training_spaces')
      .select('id, name, kind')
      .eq('owner_id', userId)
      .eq('kind', 'home')
      .order('created_at', { ascending: true })
      .limit(1);
    if (readErr) throw readErr;
    if (existing?.length) return existing[0];

    const { data: created, error: writeErr } = await supabase
      .from('training_spaces')
      .insert({
        owner_id: userId,
        kind: 'home',
        name: DEFAULT_HOME_SPACE_NAME,
        is_default: true,
      })
      .select('id, name, kind')
      .single();
    if (writeErr) throw writeErr;
    return created;
  } catch (err) {
    reportError(err, { feature: 'equipment.homeSpace' });
    return null;
  }
}

/**
 * Find or create the catalog row for an implement, so photos of the
 * same machine taken by different people can dedupe onto it.
 *
 * User submissions land unapproved (migration 268 pins that in the RLS
 * WITH CHECK, so this can't self-approve even if it tried). An
 * unapproved row is still visible to its submitter and to anyone in a
 * space that has it — which is exactly what the picker needs.
 */
/**
 * Build the identity filter for a catalog row.
 *
 * product_line / model_name are NULLABLE and we insert NULL (not '')
 * when absent. The unique index compares COALESCE(col, '') so it
 * dedupes correctly, but a PostgREST `.eq(col, '')` does NOT match a
 * NULL — `NULL = ''` is NULL, not true. Matching the index's COALESCE
 * semantics therefore needs `.is(col, null)` for the empty case, or
 * every lookup misses, falls through to an insert, and 23505s.
 */
function applyIdentityFilter(query, { brandSlug, implementType, line, model }) {
  let q = query
    .eq('brand_slug', brandSlug)
    .eq('implement_type', implementType);
  q = line  ? q.eq('product_line', line) : q.is('product_line', null);
  q = model ? q.eq('model_name', model)  : q.is('model_name', null);
  return q;
}

export async function findOrCreateModel({ brand, line, model, implementType, userId }) {
  if (!implementType || !userId) return null;
  const brandSlug = brand || 'unknown';
  const identity = { brandSlug, implementType, line, model };
  try {
    const { data: found, error: readErr } = await applyIdentityFilter(
      supabase.from('equipment_models').select('id'), identity
    ).limit(1);
    // A read failure here is not fatal — fall through to insert and let
    // the unique index dedupe.
    if (!readErr && found?.length) return found[0].id;

    const { data: created, error: writeErr } = await supabase
      .from('equipment_models')
      .insert({
        brand_slug: brandSlug,
        implement_type: implementType,
        product_line: line || null,
        model_name: model || null,
        submitted_by: userId,
        approved: false,
        is_seeded: false,
      })
      .select('id')
      .single();
    if (writeErr) {
      // 23505 = the unique index caught a concurrent insert. Re-read.
      if (writeErr.code === '23505') {
        const { data: raced } = await applyIdentityFilter(
          supabase.from('equipment_models').select('id'), identity
        ).limit(1);
        return raced?.[0]?.id ?? null;
      }
      throw writeErr;
    }
    return created.id;
  } catch (err) {
    reportError(err, { feature: 'equipment.findOrCreateModel' });
    return null;
  }
}

/**
 * Ensure a space_equipment row exists for this implement in this space,
 * and return it. This is the row a photo attaches to.
 */
export async function ensureSpaceEquipment({ spaceId, modelId, implementType, label, userId }) {
  if (!spaceId || !implementType || !userId) return null;
  try {
    if (modelId) {
      const { data: found } = await supabase
        .from('space_equipment')
        .select('id, photo_url')
        .eq('space_id', spaceId)
        .eq('model_id', modelId)
        .limit(1);
      if (found?.length) return found[0];
    }

    const { data: created, error } = await supabase
      .from('space_equipment')
      .insert({
        space_id: spaceId,
        model_id: modelId || null,
        implement_type: implementType,
        label_override: label || null,
        added_by: userId,
      })
      .select('id, photo_url')
      .single();
    if (error) throw error;
    return created;
  } catch (err) {
    reportError(err, { feature: 'equipment.ensureSpaceEquipment' });
    return null;
  }
}

/**
 * Attach an uploaded photo. Sets it as the space_equipment primary when
 * that slot is still empty, so the first photo someone takes becomes the
 * one the picker shows.
 */
export async function attachPhoto({ equipmentId, modelId, url, userId, makePrimary }) {
  if (!equipmentId || !url || !userId) return null;
  try {
    const { data: photo, error } = await supabase
      .from('equipment_photos')
      .insert({
        equipment_id: equipmentId,
        model_id: modelId || null,
        url,
        uploaded_by: userId,
        is_primary: !!makePrimary,
      })
      .select('id, url')
      .single();
    if (error) throw error;

    if (makePrimary) {
      // Best-effort — the photo row is the source of truth, photo_url is
      // a denormalized convenience. A failure here is not worth surfacing.
      await supabase
        .from('space_equipment')
        .update({ photo_url: url })
        .eq('id', equipmentId);
    }
    return photo;
  } catch (err) {
    reportError(err, { feature: 'equipment.attachPhoto' });
    return null;
  }
}

/**
 * Any approved photo of this catalog model, from any space the caller
 * can see. Tier 2 of the image chain — right machine, wrong room.
 */
export async function findModelPhoto(modelId) {
  if (!modelId) return null;
  try {
    const { data, error } = await supabase
      .from('equipment_photos')
      .select('url')
      .eq('model_id', modelId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1);
    if (error) throw error;
    return data?.[0]?.url ?? null;
  } catch (err) {
    reportError(err, { feature: 'equipment.findModelPhoto' });
    return null;
  }
}

/** Equipment in a space, for the picker's "your gear" section. */
export async function listSpaceEquipment(spaceId) {
  if (!spaceId) return [];
  try {
    const { data, error } = await supabase
      .from('space_equipment')
      .select('id, model_id, implement_type, label_override, photo_url, verified_by_owner')
      .eq('space_id', spaceId);
    if (error) throw error;
    return data || [];
  } catch (err) {
    reportError(err, { feature: 'equipment.listSpaceEquipment' });
    return [];
  }
}

// ── Gym floors (Phase 4) ─────────────────────────────────────────────
//
// A gym's floor is the UNION of equipment across every training_space
// pointing at that gym, not one canonical space.
//
// That falls out of the schema rather than being a choice: training_spaces
// is keyed `UNIQUE (owner_id, gym_id)`, and the RLS INSERT policy requires
// `owner_id = auth.uid()`, so a member cannot create a space owned by the
// gym. Each member gets their own space for a gym they belong to, and the
// read policy lets every member see all of them.
//
// It also happens to model the trust levels for free:
//   • equipment in the GYM OWNER's space  → authoritative
//   • equipment in a MEMBER's space       → member-submitted
//   • verified_by_owner = true            → owner blessed a member entry
//
// The owner can edit or verify a member's row because the mig 268 UPDATE
// policy reaches through training_spaces.gym_id to gym_businesses.owner_id.

/** The caller's own space for a gym, created on first contribution. */
export async function getOrCreateGymSpace(gymId, userId) {
  if (!gymId || !userId) return null;
  try {
    const { data: existing, error: readErr } = await supabase
      .from('training_spaces')
      .select('id, name, kind, gym_id')
      .eq('owner_id', userId)
      .eq('gym_id', gymId)
      .limit(1);
    if (readErr) throw readErr;
    if (existing?.length) return existing[0];

    const { data: created, error: writeErr } = await supabase
      .from('training_spaces')
      .insert({ owner_id: userId, kind: 'gym', gym_id: gymId })
      .select('id, name, kind, gym_id')
      .single();
    if (writeErr) throw writeErr;
    return created;
  } catch (err) {
    reportError(err, { feature: 'equipment.gymSpace' });
    return null;
  }
}

/**
 * Everything on a gym's floor, across all member spaces.
 *
 * Sorted owner-authoritative first, then owner-verified member entries,
 * then the rest — so the picker leads with what's actually confirmed to
 * be on the floor.
 */
export async function listGymFloor(gymId, gymOwnerId) {
  if (!gymId) return [];
  try {
    const { data: spaces, error: spaceErr } = await supabase
      .from('training_spaces')
      .select('id, owner_id')
      .eq('gym_id', gymId);
    if (spaceErr) throw spaceErr;
    if (!spaces?.length) return [];

    const byId = new Map(spaces.map(s => [s.id, s.owner_id]));
    const { data: rows, error: eqErr } = await supabase
      .from('space_equipment')
      .select('id, space_id, model_id, implement_type, label_override, photo_url, verified_by_owner, added_by')
      .in('space_id', spaces.map(s => s.id));
    if (eqErr) throw eqErr;

    return (rows || [])
      .map(r => ({
        ...r,
        fromOwnerSpace: !!gymOwnerId && byId.get(r.space_id) === gymOwnerId,
      }))
      .sort((a, b) => {
        const rank = (x) => (x.fromOwnerSpace ? 0 : x.verified_by_owner ? 1 : 2);
        return rank(a) - rank(b);
      });
  } catch (err) {
    reportError(err, { feature: 'equipment.listGymFloor' });
    return [];
  }
}

/**
 * Owner blesses (or un-blesses) a member-submitted entry.
 *
 * Authorization is NOT checked here — migration 268's UPDATE policy is
 * the gate, and it reaches through to gym_businesses.owner_id server-side.
 * A client-side check would be decoration; this returns false when RLS
 * rejects, which is the honest signal.
 */
export async function setEquipmentVerified(equipmentId, verified) {
  if (!equipmentId) return false;
  try {
    const { error } = await supabase
      .from('space_equipment')
      .update({ verified_by_owner: !!verified })
      .eq('id', equipmentId);
    if (error) throw error;
    return true;
  } catch (err) {
    reportError(err, { feature: 'equipment.setVerified' });
    return false;
  }
}

/** Remove an entry. RLS allows the adder, space owner, or gym owner. */
export async function removeSpaceEquipment(equipmentId) {
  if (!equipmentId) return false;
  try {
    const { error } = await supabase
      .from('space_equipment')
      .delete()
      .eq('id', equipmentId);
    if (error) throw error;
    return true;
  } catch (err) {
    reportError(err, { feature: 'equipment.removeSpaceEquipment' });
    return false;
  }
}

/** Add an implement to a gym's floor, from the gym page or the picker. */
export async function addToGymFloor({ gymId, userId, implement }) {
  if (!gymId || !userId || !implement?.implementType) return null;
  const space = await getOrCreateGymSpace(gymId, userId);
  if (!space) return null;

  const modelId = await findOrCreateModel({
    brand: implement.brand,
    line: implement.line,
    model: implement.model,
    implementType: implement.implementType,
    userId,
  });

  return ensureSpaceEquipment({
    spaceId: space.id,
    modelId,
    implementType: implement.implementType,
    label: implement.label,
    userId,
  });
}

/**
 * The whole persist-a-photo flow, so the UI has one call to make.
 * Returns the public URL on success, null on any failure.
 */
export async function persistEquipmentPhoto({ implement, url, userId }) {
  if (!implement || !url || !userId) return null;
  const space = await getOrCreateHomeSpace(userId);
  if (!space) return null;

  const modelId = await findOrCreateModel({
    brand: implement.brand,
    line: implement.line,
    model: implement.model,
    implementType: implement.implementType,
    userId,
  });

  const equipment = await ensureSpaceEquipment({
    spaceId: space.id,
    modelId,
    implementType: implement.implementType,
    label: implement.label,
    userId,
  });
  if (!equipment) return null;

  const photo = await attachPhoto({
    equipmentId: equipment.id,
    modelId,
    url,
    userId,
    makePrimary: !equipment.photo_url,
  });
  return photo?.url ?? null;
}
