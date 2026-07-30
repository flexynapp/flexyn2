// src/lib/equipmentImage.js
//
// Decides which image represents a piece of equipment, and guarantees
// there is always one. The picker and the exercise header must never
// render a blank box, so the chain always terminates in a drawn
// silhouette that ships with the app.
//
// ── The chain ────────────────────────────────────────────────────────
//
//   1. 'space'      — a photo of THIS machine, in THIS space. The only
//                     tier that actually answers "show me that exact
//                     machine", and the reason Phase 3 exists.
//   2. 'model'      — an approved photo of the same catalog model taken
//                     in some other space. Right machine, wrong room.
//   3. 'reference'  — an openly-licensed generic photo of this implement
//                     TYPE. Currently empty — see below.
//   4. 'silhouette' — drawn line art. Always available, zero legal risk.
//
// ── Why tier 3 is empty ──────────────────────────────────────────────
//
// The plan called for Wikimedia Commons CC-BY-SA photos as a generic
// per-type tier. The map below is the slot for them, deliberately left
// unpopulated: every Commons file needs its OWN license page verified
// (a category listing is not per-file license proof), each one adds an
// attribution obligation we must surface in-app and in ATTRIBUTIONS.md,
// and hotlinking Wikimedia from a mobile app is fragile offline.
//
// A verified entry is a one-line addition here plus an ATTRIBUTIONS.md
// row — the capability is wired, just not populated with images whose
// licenses nobody has actually checked. A generic stock photo of *a*
// leg press is also barely better than the silhouette; a photo of
// YOUR leg press (tier 1) is what users asked for.
//
// NEVER add a manufacturer product photo here. Brand names are
// nominative use as text; their photography is not ours to ship.
// See docs/gym-equipment-picker-research.md §3.

/**
 * Openly-licensed generic photos, keyed by implement type.
 * Shape: { url, author, license, licenseUrl, sourceUrl }
 * Every field is required — an entry without attribution data is a
 * license violation waiting to happen, so resolveEquipmentImage()
 * skips incomplete entries rather than rendering them.
 */
export const REFERENCE_IMAGES = {
  // (empty — see the header note. Verified additions go here.)
};

function isCompleteReference(ref) {
  return !!(ref && ref.url && ref.author && ref.license && ref.licenseUrl);
}

/**
 * Resolve the image for a piece of equipment.
 *
 * @param {object}   args
 * @param {string=}  args.spacePhotoUrl  space_equipment.photo_url
 * @param {string=}  args.modelPhotoUrl  an approved photo of the same model
 * @param {string=}  args.implementType  slug from equipmentCatalog
 * @returns {{ kind: 'space'|'model'|'reference'|'silhouette',
 *             url: string|null, attribution: object|null }}
 *
 * `kind` is part of the contract, not a debug field — the UI labels a
 * tier-2 photo ("photographed at another gym") so a user isn't misled
 * into thinking it's their room, and shows attribution for tier 3.
 */
export function resolveEquipmentImage({ spacePhotoUrl, modelPhotoUrl, implementType } = {}) {
  if (spacePhotoUrl) {
    return { kind: 'space', url: spacePhotoUrl, attribution: null };
  }
  if (modelPhotoUrl) {
    return { kind: 'model', url: modelPhotoUrl, attribution: null };
  }
  const ref = REFERENCE_IMAGES[implementType];
  if (isCompleteReference(ref)) {
    return {
      kind: 'reference',
      url: ref.url,
      attribution: {
        author: ref.author,
        license: ref.license,
        licenseUrl: ref.licenseUrl,
        sourceUrl: ref.sourceUrl || null,
      },
    };
  }
  // Terminal. The caller renders <EquipmentSilhouette implementType={…} />.
  return { kind: 'silhouette', url: null, attribution: null };
}

/** True when the resolved image is a real photograph of real equipment. */
export function isPhoto(resolved) {
  return resolved?.kind === 'space' || resolved?.kind === 'model';
}
