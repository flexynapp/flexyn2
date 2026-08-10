// src/lib/muscleRegions.js
//
// The muscle-group colour encoding, and the reason it is REGIONS and not
// muscles.
//
// There used to be a MUSCLE_GROUP_COLORS map giving each of twelve groups
// its own hue. It was removed rather than restored, with a note that if a
// real encoding were ever needed it had to be "built deliberately with a
// palette chosen for discriminability, not restored from that map." This
// is that build, and the measurements are what decided its shape.
//
// ── Why three hues and not twelve ────────────────────────────────────
//
// A categorical palette encodes IDENTITY, and identity only survives if
// any two slots are still tellable apart — including by the ~8% of men
// with red-green colour vision deficiency. Run against the dataviz
// validator (ΔE is Euclidean distance in OKLab ×100, protanopia and
// deuteranopia simulated at severity 1.0), on the app's own card
// surfaces, using the `--pairs all` gate that applies when any two marks
// can end up side by side:
//
//   5 hues   FAIL   dark: magenta↔aqua ΔE 1.6 (deutan) — identical
//   4 hues   FAIL   dark: yellow↔orange ΔE 4.8 (deutan), 10.6 normal
//   3 hues   PASS   both modes, worst 9.2 light / 9.4 dark
//
// So three is not a preference, it is the ceiling. Twelve hues was never
// an encoding; it was decoration wearing the costume of data, and four of
// its twelve (Chest / Triceps / Biceps / Forearms → red / orange / amber
// / yellow) were adjacent on the wheel and identical at 10px.
//
// Three buckets that a lifter already thinks in — PUSH, PULL, LEGS — is
// the canonical split, so the constraint and the domain agree. Everything
// else folds into OTHER, which is deliberately NEUTRAL: it sits below the
// chroma floor on purpose, because that is what says "this is a
// remainder, not an identity."
//
// ── Rules this file exists to hold ──────────────────────────────────
//
//   • Colour follows the ENTITY, never its rank or its position in a
//     list. `Chest` is push whether it is the biggest wedge or the
//     smallest, and whether or not `Back` is present.
//   • Slots are assigned in fixed order and NEVER cycled. The widget
//     this replaces did `COLORS[hash(name) % COLORS.length]`, which is
//     cycling by definition — with six slots and six wedges, the chance
//     that no two collided was 6!/6⁶ ≈ 1.5%. So ~98% of the time two
//     wedges shared a colour, silently.
//   • Adding a muscle here is safe. Adding a REGION is not — it needs a
//     fourth hue, and the measurements above say there isn't one.

/** Region ids, in fixed slot order. `other` is the neutral remainder. */
export const REGIONS = ['push', 'pull', 'legs', 'other'];

/**
 * Every value `muscleKey()` can produce, mapped to its region.
 *
 * Keyed by muscleKey output rather than the raw column, because the
 * column carries whatever the exercise row was written with — 'Chest'
 * and 'chest' are the same muscle and must not land in different
 * buckets. (That exact bug produced two pills for one muscle on the
 * Progress hero.)
 */
const REGION_BY_KEY = {
  // Push — the chest / shoulder / triceps chain.
  chest: 'push',
  shoulders: 'push',
  triceps: 'push',
  // Pull — back and the biceps / forearm chain that works with it.
  back: 'pull',
  lats: 'pull',
  traps: 'pull',
  biceps: 'pull',
  forearms: 'pull',
  // Legs — everything below the hip.
  legs: 'legs',
  quads: 'legs',
  hamstrings: 'legs',
  glutes: 'legs',
  calves: 'legs',
  // Other — core and whole-body work. Not a lesser category; just the
  // one that does not fit a push/pull/legs axis, and the one the colour
  // budget cannot afford a hue for.
  core: 'other',
  abs: 'other',
  obliques: 'other',
  fullBody: 'other',
  cardio: 'other',
};

/**
 * Region for a muscleKey. Unknown keys fall to 'other' rather than
 * throwing or inventing a slot — a muscle nobody has mapped yet is
 * exactly a remainder.
 */
export function regionFor(muscleKeyValue) {
  return REGION_BY_KEY[muscleKeyValue] || 'other';
}

/**
 * The CSS custom property holding this region's colour.
 *
 * Returns the `hsl(var(--…))` form, NOT a raw hex: the values are
 * defined per theme in src/index.css so light and dark are each their
 * own selected step, and a raw hex would ignore the user's theme.
 *
 * Recharts' <Cell fill> resolves this correctly because it lands in an
 * inline `fill` attribute the browser evaluates — what it cannot do is
 * resolve a bare `var(--card)`, since these variables hold raw HSL
 * triplets ("210 18% 12%") rather than colours. The widget's tooltip had
 * exactly that bug and rendered with no background at all.
 */
export function regionColor(region) {
  return `hsl(var(--region-${REGIONS.includes(region) ? region : 'other'}))`;
}

/**
 * Roll a per-muscle tally into per-region totals, in fixed slot order,
 * dropping regions with nothing in them.
 *
 * Regions are BOUNDED, which is the other reason to aggregate here: the
 * widget used to `.slice(0, 6)` its muscle list, and because that ran on
 * insertion order rather than size it kept the first six groups it
 * happened to see and silently discarded the rest — including, on a
 * varied week, bigger ones than the six it kept. Four buckets cannot
 * overflow, so nothing has to be dropped and nothing is.
 *
 * @param {Record<string, number>} byKey  muscleKey → count or volume
 * @returns {Array<{ region: string, value: number }>}
 */
export function rollUpToRegions(byKey = {}) {
  const totals = new Map(REGIONS.map((r) => [r, 0]));
  for (const [key, value] of Object.entries(byKey)) {
    const n = Number(value) || 0;
    if (n <= 0) continue;
    const r = regionFor(key);
    totals.set(r, totals.get(r) + n);
  }
  return REGIONS
    .map((region) => ({ region, value: totals.get(region) }))
    .filter((d) => d.value > 0);
}
