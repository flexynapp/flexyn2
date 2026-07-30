// src/lib/equipmentCatalog.js
//
// Controlled vocabulary for the equipment picker — the dropdown next to
// an exercise title in an active workout that lets a lifter record the
// SPECIFIC implement they're using (their gym's Hammer Strength row, or
// their own Bowflex 552s at home).
//
// Same shape as src/lib/gymAmenities.js: slug → metadata map, additive-
// safe, unknown slugs render with a fallback rather than throwing. Adding
// entries is always safe; RENAMING a slug is a data migration, because
// slugs are persisted in workout_logs.exercises and space_equipment.
//
// Three vocabularies live here:
//   • BRAND_META          — who makes it
//   • IMPLEMENT_TYPE_META — what kind of thing it is
//   • SEED_MODELS         — specific verified products
// plus EXERCISE_IMPLEMENT, the exercise-name → implement-type map that
// decides which dropdown to show.
//
// ── Why this doesn't just reuse exerciseEquipment.js ──────────────────
// classifyEquipment() is a coarse 9-way name regex built for the filter
// pills in ExerciseAutocomplete, where a miss is invisible. It is wrong
// on ~25 of the exercises that matter most here: every Lat Pulldown
// variant except the literal "Machine Lat Pulldown" falls to 'other';
// "Machine Crunch" / "Cable Crunch" / "Assisted Pull-Up" fall to
// 'bodyweight' because the bodyweight pattern is tested first; "Barbell
// Hack Squat" falls to 'machine' because of the `hack` pattern. We do
// NOT fix that classifier — its existing consumer and tests depend on
// current behavior — so EXERCISE_IMPLEMENT below overrides it by name,
// and classifyEquipment is only the fallback for unmapped exercises.
//
// ── Why there are no manufacturer photos here ─────────────────────────
// Brand and model names ship as TEXT (nominative use — factually naming
// the machine in front of you). Manufacturer product photography is
// copyrighted and Flexyn ships to the app stores, so images come from
// users instead. See docs/gym-equipment-picker-research.md §3.

import { classifyEquipment } from '@/lib/exerciseEquipment';

// ── Brands ───────────────────────────────────────────────────────────
// `parent` records corporate ownership so a gym that says "Cybex" still
// groups sensibly (Life Fitness Holdings owns Life Fitness, Hammer
// Strength, Cybex, SCIFIT and ICG). `legacy: true` means the brand is no
// longer sold new but is still on thousands of floors — it must stay
// pickable.
export const BRAND_META = {
  // Commercial floors
  life_fitness:   { label: 'Life Fitness',    scope: 'commercial' },
  hammer_strength:{ label: 'Hammer Strength', scope: 'commercial', parent: 'life_fitness' },
  cybex:          { label: 'Cybex',           scope: 'commercial', parent: 'life_fitness', legacy: true },
  technogym:      { label: 'Technogym',       scope: 'commercial' },
  precor:         { label: 'Precor',          scope: 'commercial' },
  matrix:         { label: 'Matrix',          scope: 'commercial' },
  nautilus:       { label: 'Nautilus',        scope: 'commercial' },
  // Enthusiast / boutique — often the reason someone picks a gym
  atlantis:       { label: 'Atlantis',        scope: 'commercial' },
  arsenal:        { label: 'Arsenal Strength',scope: 'commercial' },
  prime:          { label: 'PRIME Fitness',   scope: 'commercial' },
  panatta:        { label: 'Panatta',         scope: 'commercial' },
  gym80:          { label: 'gym80',           scope: 'commercial' },
  watson:         { label: 'Watson',          scope: 'commercial' },
  // Free weights + home
  rogue:          { label: 'Rogue',           scope: 'both' },
  eleiko:         { label: 'Eleiko',          scope: 'both' },
  rep:            { label: 'REP Fitness',     scope: 'both' },
  titan:          { label: 'Titan Fitness',   scope: 'home' },
  bowflex:        { label: 'Bowflex',         scope: 'home' },
  powerblock:     { label: 'PowerBlock',      scope: 'home' },
  ironmaster:     { label: 'Ironmaster',      scope: 'home' },
  nuobell:        { label: 'NÜOBELL',         scope: 'home' },
  nordictrack:    { label: 'NordicTrack',     scope: 'home' },
  force_usa:      { label: 'Force USA',       scope: 'home' },
  tonal:          { label: 'Tonal',           scope: 'home' },
  // Escape hatches — always keep these last two.
  other:          { label: 'Other brand',     scope: 'both' },
  unknown:        { label: "Don't know",      scope: 'both' },
};

export const BRAND_SLUGS = Object.keys(BRAND_META);

/** Label for a brand slug; unknown slugs degrade to the raw slug. */
export function brandLabel(slug) {
  return BRAND_META[slug]?.label || String(slug || '').replace(/_/g, ' ');
}

// ── Implement types ──────────────────────────────────────────────────
// `kind` MUST be one of the 9 values classifyEquipment() can return
// ('barbell' | 'dumbbell' | 'cable' | 'machine' | 'bodyweight' |
// 'kettlebell' | 'band' | 'cardio' | 'other') so the two vocabularies
// stay aligned — the test asserts this.
//
// `adjustable: true` marks implements whose selectable loads are NOT a
// smooth ramp (Bowflex 552s step 2.5lb to 25lb then 5lb; a pin stack has
// fixed plates). Phase 5 feeds this to progressiveOverload.js so it
// suggests a weight the user can actually select.
export const IMPLEMENT_TYPE_META = {
  // Lower body machines
  leg_press:        { label: 'Leg press',            kind: 'machine' },
  hack_squat:       { label: 'Hack squat',           kind: 'machine' },
  pendulum_squat:   { label: 'Pendulum squat',       kind: 'machine' },
  belt_squat:       { label: 'Belt squat',           kind: 'machine' },
  leg_extension:    { label: 'Leg extension',        kind: 'machine' },
  leg_curl_seated:  { label: 'Seated leg curl',      kind: 'machine' },
  leg_curl_lying:   { label: 'Lying leg curl',       kind: 'machine' },
  hip_thrust:       { label: 'Hip thrust machine',   kind: 'machine' },
  glute_kickback:   { label: 'Glute kickback',       kind: 'machine' },
  abductor:         { label: 'Hip abductor',         kind: 'machine' },
  adductor:         { label: 'Hip adductor',         kind: 'machine' },
  calf_seated:      { label: 'Seated calf raise',    kind: 'machine' },
  calf_standing:    { label: 'Standing calf raise',  kind: 'machine' },
  // Push machines
  chest_press:      { label: 'Chest press',          kind: 'machine' },
  incline_press:    { label: 'Incline press',        kind: 'machine' },
  pec_deck:         { label: 'Pec deck / chest fly', kind: 'machine' },
  shoulder_press:   { label: 'Shoulder press',       kind: 'machine' },
  lateral_raise:    { label: 'Lateral raise',        kind: 'machine' },
  triceps_machine:  { label: 'Triceps machine',      kind: 'machine' },
  // Pull machines
  lat_pulldown:     { label: 'Lat pulldown',         kind: 'machine' },
  seated_row:       { label: 'Seated row',           kind: 'machine' },
  high_row:         { label: 'High row',             kind: 'machine' },
  low_row:          { label: 'Low row',              kind: 'machine' },
  t_bar_row:        { label: 'T-bar row',            kind: 'machine' },
  pullover:         { label: 'Pullover',             kind: 'machine' },
  rear_delt:        { label: 'Rear delt / reverse fly', kind: 'machine' },
  biceps_machine:   { label: 'Biceps machine',       kind: 'machine' },
  assist_dip_pull:  { label: 'Assisted dip / pull-up', kind: 'machine' },
  // Core / posterior
  ab_crunch:        { label: 'Ab crunch machine',    kind: 'machine' },
  back_extension:   { label: 'Back extension',       kind: 'machine' },
  reverse_hyper:    { label: 'Reverse hyper',        kind: 'machine' },
  ghd:              { label: 'GHD / glute-ham',      kind: 'machine' },
  // Cable + multi
  cable_station:    { label: 'Cable station',        kind: 'cable' },
  cable_crossover:  { label: 'Cable crossover',      kind: 'cable' },
  functional_trainer:{ label: 'Functional trainer',  kind: 'cable' },
  smith_machine:    { label: 'Smith machine',        kind: 'machine' },
  // Free weights
  barbell:          { label: 'Barbell',              kind: 'barbell' },
  ez_bar:           { label: 'EZ / curl bar',        kind: 'barbell' },
  trap_bar:         { label: 'Trap bar',             kind: 'barbell' },
  safety_squat_bar: { label: 'Safety squat bar',     kind: 'barbell' },
  rack:             { label: 'Rack / rig',           kind: 'barbell' },
  dumbbell:         { label: 'Dumbbells',            kind: 'dumbbell' },
  dumbbell_adj:     { label: 'Adjustable dumbbells', kind: 'dumbbell', adjustable: true },
  kettlebell:       { label: 'Kettlebell',           kind: 'kettlebell' },
  bench:            { label: 'Bench',                kind: 'barbell' },
  band:             { label: 'Resistance band',      kind: 'band' },
  landmine:         { label: 'Landmine',             kind: 'barbell' },
  // Cardio
  treadmill:        { label: 'Treadmill',            kind: 'cardio' },
  bike:             { label: 'Bike',                 kind: 'cardio' },
  rower:            { label: 'Rower',                kind: 'cardio' },
  elliptical:       { label: 'Elliptical',           kind: 'cardio' },
  stair_climber:    { label: 'Stair climber',        kind: 'cardio' },
  ski_erg:          { label: 'Ski erg',              kind: 'cardio' },
};

export const IMPLEMENT_TYPE_SLUGS = Object.keys(IMPLEMENT_TYPE_META);

/** Label for an implement-type slug; unknown slugs degrade to the slug. */
export function implementTypeLabel(slug) {
  return IMPLEMENT_TYPE_META[slug]?.label || String(slug || '').replace(/_/g, ' ');
}

// ── Seed models ──────────────────────────────────────────────────────
// ONLY verified product/line names go here (see the research doc's brand
// table). Where a line is real but individual model names weren't
// verified, the line is seeded WITHOUT a model — brand + line + type is
// already far more specific than what any other app offers, and an
// invented model name is worse than none.
//
// `line` is the product family, `model` the specific unit. Either may be
// null. `types` lists the implement types that line covers.
export const SEED_MODELS = [
  // Life Fitness — selectorized lines
  { brand: 'life_fitness', line: 'Insignia Series', model: null, types: ['leg_press', 'chest_press', 'shoulder_press', 'lat_pulldown', 'seated_row', 'leg_extension', 'leg_curl_seated', 'pec_deck', 'abductor', 'adductor'] },
  { brand: 'life_fitness', line: 'Axiom Series',    model: null, types: ['leg_press', 'chest_press', 'shoulder_press', 'lat_pulldown', 'seated_row', 'leg_extension', 'leg_curl_seated'] },
  { brand: 'life_fitness', line: 'Optima Series',   model: null, types: ['leg_press', 'chest_press', 'shoulder_press', 'lat_pulldown', 'seated_row', 'leg_extension', 'leg_curl_seated'] },
  { brand: 'life_fitness', line: 'Insignia Series', model: 'Arc Leg Press', types: ['leg_press'] },

  // Hammer Strength — the plate-loaded models are the recognizable ones
  { brand: 'hammer_strength', line: 'Select',        model: null, types: ['chest_press', 'shoulder_press', 'lat_pulldown', 'seated_row', 'leg_extension', 'leg_curl_seated', 'abductor', 'adductor', 'biceps_machine', 'triceps_machine'] },
  { brand: 'hammer_strength', line: 'MTS',           model: null, types: ['chest_press', 'incline_press', 'shoulder_press', 'high_row', 'low_row', 'lat_pulldown'] },
  { brand: 'hammer_strength', line: 'Plate Loaded',  model: 'Super Squat Press',      types: ['leg_press'] },
  { brand: 'hammer_strength', line: 'Plate Loaded',  model: 'Pendulum-X Squat',       types: ['pendulum_squat'] },
  { brand: 'hammer_strength', line: 'Plate Loaded',  model: 'Super Fly',              types: ['pec_deck'] },
  { brand: 'hammer_strength', line: 'Plate Loaded',  model: 'Glute Drive',            types: ['hip_thrust'] },
  { brand: 'hammer_strength', line: 'Plate Loaded',  model: 'Hack Squat',             types: ['hack_squat'] },
  { brand: 'hammer_strength', line: 'Plate Loaded',  model: 'Iso-Lateral Chest Press',types: ['chest_press'] },
  { brand: 'hammer_strength', line: 'Plate Loaded',  model: 'Hip Abductor',           types: ['abductor'] },
  { brand: 'hammer_strength', line: 'Plate Loaded',  model: 'Belt Squat',             types: ['belt_squat'] },

  // Technogym
  { brand: 'technogym', line: 'Selection Pro',  model: null, types: ['leg_press', 'chest_press', 'shoulder_press', 'lat_pulldown', 'seated_row', 'leg_extension', 'leg_curl_seated', 'abductor', 'adductor', 'pec_deck'] },
  { brand: 'technogym', line: 'Pure Strength',  model: null, types: ['leg_press', 'chest_press', 'lat_pulldown', 'seated_row', 'hack_squat'] },
  { brand: 'technogym', line: 'Artis',          model: null, types: ['leg_press', 'chest_press', 'shoulder_press', 'lat_pulldown', 'seated_row'] },

  // Precor
  { brand: 'precor', line: 'Resolute',  model: null, types: ['leg_press', 'chest_press', 'shoulder_press', 'lat_pulldown', 'seated_row', 'leg_extension', 'leg_curl_seated'] },
  { brand: 'precor', line: 'Vitality',  model: null, types: ['leg_press', 'chest_press', 'lat_pulldown', 'seated_row', 'leg_extension'] },
  { brand: 'precor', line: 'Discovery', model: null, types: ['leg_press', 'chest_press', 'incline_press', 'high_row', 'low_row', 'hack_squat', 'pec_deck'] },

  // Cybex — legacy but everywhere
  { brand: 'cybex', line: 'Eagle',    model: null, types: ['leg_press', 'chest_press', 'shoulder_press', 'lat_pulldown', 'seated_row', 'leg_extension', 'leg_curl_seated'] },
  { brand: 'cybex', line: 'VR3',      model: null, types: ['leg_press', 'chest_press', 'lat_pulldown', 'seated_row', 'leg_extension'] },
  { brand: 'cybex', line: 'Prestige', model: null, types: ['chest_press', 'lat_pulldown', 'seated_row', 'leg_extension', 'leg_curl_seated'] },

  // Matrix
  { brand: 'matrix', line: 'Ultra',  model: null, types: ['leg_press', 'chest_press', 'shoulder_press', 'lat_pulldown', 'seated_row', 'leg_extension', 'leg_curl_seated'] },
  { brand: 'matrix', line: 'Versa',  model: null, types: ['leg_press', 'chest_press', 'lat_pulldown', 'seated_row', 'leg_extension'] },
  { brand: 'matrix', line: 'Aura',   model: null, types: ['leg_press', 'chest_press', 'lat_pulldown', 'seated_row'] },
  { brand: 'matrix', line: 'Magnum', model: null, types: ['leg_press', 'hack_squat', 'chest_press', 'high_row', 'low_row'] },

  // Nautilus
  { brand: 'nautilus', line: 'Inspiration', model: null, types: ['leg_press', 'chest_press', 'shoulder_press', 'lat_pulldown', 'seated_row', 'leg_extension'] },
  { brand: 'nautilus', line: 'Impact',      model: null, types: ['leg_press', 'chest_press', 'lat_pulldown', 'seated_row'] },

  // ── Home gym ───────────────────────────────────────────────────────
  // Adjustable dumbbells. `increments` is the selectable ladder in lb —
  // this is what makes progressiveOverload.js able to suggest a real
  // number instead of "add 2.5lb" on a pair that can't do 2.5lb.
  // `ladder` is the machine-readable list of selectable weights in lb.
  // Only present where the exact settings were VERIFIED against the
  // manufacturer's own spec — progressiveOverload snaps its suggestion
  // to it, so a guessed ladder would produce confidently wrong advice.
  // Absent ladder = no snapping, which is the safe default.
  { brand: 'bowflex',     line: 'SelectTech',       model: '552',            types: ['dumbbell_adj'], maxLb: 52.5, increments: '2.5 to 25 lb, then 5 lb',
    ladder: [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 30, 35, 40, 45, 50, 52.5] },
  { brand: 'bowflex',     line: 'SelectTech',       model: '1090',           types: ['dumbbell_adj'], maxLb: 90,   increments: '5 lb' },
  { brand: 'bowflex',     line: 'Results Series',   model: '552',            types: ['dumbbell_adj'], maxLb: 52.5, increments: '2.5 to 25 lb, then 5 lb',
    ladder: [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 30, 35, 40, 45, 50, 52.5] },
  { brand: 'powerblock',  line: 'Elite',            model: 'EXP',            types: ['dumbbell_adj'], maxLb: 50,   increments: '2.5 lb with adder kit, else 5 lb' },
  { brand: 'powerblock',  line: 'Pro',              model: 'Series',         types: ['dumbbell_adj'] },
  { brand: 'rep',         line: 'QuickDraw',        model: null,             types: ['dumbbell_adj'], maxLb: 60,   increments: '5 lb' },
  { brand: 'rep',         line: 'Fast Series',      model: 'REP x PÉPIN',    types: ['dumbbell_adj'] },
  { brand: 'ironmaster',  line: 'Quick-Lock',       model: null,             types: ['dumbbell_adj'], increments: '2.5 lb (loadable)' },
  { brand: 'nuobell',     line: 'Classic',          model: '80LB',           types: ['dumbbell_adj'], maxLb: 80,   increments: '5 lb' },
  { brand: 'nordictrack', line: 'Select-A-Weight',  model: null,             types: ['dumbbell_adj'] },
  // Racks, benches, bars
  { brand: 'rogue',  line: 'R-Series',  model: 'R-3',       types: ['rack'] },
  { brand: 'rogue',  line: 'Monster',   model: 'RML-390F',  types: ['rack'] },
  { brand: 'rogue',  line: 'Ohio Bar',  model: null,        types: ['barbell'] },
  { brand: 'rogue',  line: 'Adjustable Bench', model: null, types: ['bench'] },
  { brand: 'rep',    line: 'PR-4000',   model: null,        types: ['rack'] },
  { brand: 'rep',    line: 'PR-5000',   model: null,        types: ['rack'] },
  { brand: 'rep',    line: 'AB-3000',   model: null,        types: ['bench'] },
  { brand: 'titan',  line: 'T-3',       model: null,        types: ['rack'] },
  { brand: 'eleiko', line: 'IWF Weightlifting Bar', model: null, types: ['barbell'] },
  // All-in-one
  { brand: 'force_usa', line: 'G-Series', model: null, types: ['rack', 'smith_machine', 'functional_trainer'] },
  { brand: 'tonal',     line: 'Tonal',    model: null, types: ['functional_trainer'] },
];

// ── Exercise → implement type ────────────────────────────────────────
// The map that decides which dropdown an exercise gets. Keys are
// lowercased exercise names as they appear in EXERCISE_LIBRARY.
//
// Only exercises whose implement is NOT obvious from classifyEquipment
// need an entry — but the misses are the whole point, so the machine /
// cable / assisted entries below are load-bearing. See the header note.
const EXERCISE_IMPLEMENT_ENTRIES = [
  // ── classifyEquipment says 'other' but these are machines/cables ──
  [/^(close-grip |neutral close-grip |one-handed |straight arm )?lat pulldown/i, 'lat_pulldown'],
  [/lat pulldown with (neutral|pronated|supinated) grip/i,                       'lat_pulldown'],
  [/^rope pulldown$/i,                                                           'cable_station'],
  [/^tricep pushdown with (bar|rope)$/i,                                         'cable_station'],
  [/^face pull$/i,                                                               'cable_station'],
  [/^pallof press$/i,                                                            'cable_station'],
  [/^t-bar row$/i,                                                               't_bar_row'],
  [/^back extension$/i,                                                          'back_extension'],
  [/^reverse hyperextension$/i,                                                  'reverse_hyper'],
  [/^glute ham raise$/i,                                                         'ghd'],
  [/^hip thrust$/i,                                                              'hip_thrust'],
  [/^seated calf raise$/i,                                                       'calf_seated'],
  [/^(standing|donkey) calf raise$/i,                                            'calf_standing'],
  [/^stationary bike$/i,                                                         'bike'],
  [/^rowing machine$/i,                                                          'rower'],

  // ── classifyEquipment says 'bodyweight' but these are machines ────
  [/^machine crunch$/i,                                                          'ab_crunch'],
  [/^cable crunch$/i,                                                            'cable_station'],
  [/^assisted (dip|pull-up|chin-up)$/i,                                          'assist_dip_pull'],

  // ── classifyEquipment says 'machine' but these are NOT ────────────
  [/^(barbell|landmine) hack squat$/i,                                           'barbell'],
  [/^bodyweight leg curl$/i,                                                     null],
  [/^leg curl on ball$/i,                                                        null],

  // ── Ordinary machines (agrees with classifyEquipment, mapped for the
  //    specific type so the picker can filter the catalog) ───────────
  [/leg press/i,                                                                 'leg_press'],
  [/hack squat machine/i,                                                        'hack_squat'],
  [/pendulum squat/i,                                                            'pendulum_squat'],
  [/belt squat/i,                                                                'belt_squat'],
  [/leg extension/i,                                                             'leg_extension'],
  [/seated leg curl/i,                                                           'leg_curl_seated'],
  [/lying leg curl/i,                                                            'leg_curl_lying'],
  [/hip abduction|hip abductor/i,                                                'abductor'],
  [/hip adduction|hip adductor/i,                                                'adductor'],
  [/hip thrust machine/i,                                                        'hip_thrust'],
  [/glute kickback/i,                                                            'glute_kickback'],
  [/pec deck|machine chest fly/i,                                                'pec_deck'],
  [/machine chest press/i,                                                       'chest_press'],
  [/machine shoulder press/i,                                                    'shoulder_press'],
  [/machine lateral raise/i,                                                     'lateral_raise'],
  [/reverse machine fly/i,                                                       'rear_delt'],
  [/machine bicep curl/i,                                                        'biceps_machine'],
  [/machine overhead triceps extension/i,                                        'triceps_machine'],
  [/machine lat pulldown/i,                                                      'lat_pulldown'],
  [/seated machine row/i,                                                        'seated_row'],
  [/smith machine/i,                                                             'smith_machine'],

  // ── Cables ────────────────────────────────────────────────────────
  [/wood chop with cable/i,                                                      'cable_station'],
  [/cable (crossover|chest fly)/i,                                               'cable_crossover'],
  [/\bcable\b/i,                                                                 'cable_station'],

  // ── Free weights + home ───────────────────────────────────────────
  [/\bez[- ]?(bar|curl)\b/i,                                                     'ez_bar'],
  [/trap bar/i,                                                                  'trap_bar'],
  [/safety bar squat/i,                                                          'safety_squat_bar'],
  [/landmine/i,                                                                  'landmine'],
  [/\bkettlebell\b|\bkb /i,                                                      'kettlebell'],
  [/\bdumbbell\b|\bdb /i,                                                        'dumbbell'],
  [/\bband\b|resistance band/i,                                                  'band'],
  [/\bbarbell\b/i,                                                               'barbell'],
];

// Cache — the picker calls this per exercise on every render of an
// active workout, and the list is ~60 regexes.
const _implementCache = new Map();

/**
 * The implement type an exercise uses, or null when it uses none
 * (pure bodyweight) and the dropdown should be hidden.
 *
 * Explicit map first, classifyEquipment as fallback for the long tail.
 */
export function implementTypeForExercise(name) {
  const key = String(name || '').trim();
  if (!key) return null;
  if (_implementCache.has(key)) return _implementCache.get(key);

  let result = null;
  let matched = false;
  for (const [regex, type] of EXERCISE_IMPLEMENT_ENTRIES) {
    if (regex.test(key)) { result = type; matched = true; break; }
  }

  if (!matched) {
    // Fallback: map the coarse classifier's kind onto a generic type.
    // 'bodyweight' and 'other' get no dropdown.
    const kind = classifyEquipment(key);
    result = ({
      barbell:    'barbell',
      dumbbell:   'dumbbell',
      cable:      'cable_station',
      machine:    null,        // a machine we can't name — see below
      kettlebell: 'kettlebell',
      band:       'band',
      cardio:     null,
      bodyweight: null,
      other:      null,
    })[kind] ?? null;

    // An unmapped 'machine' still deserves a picker — the user knows what
    // it is even when we don't. Fall back to the generic cable/machine
    // bucket rather than hiding the control.
    if (kind === 'machine') result = 'smith_machine';
  }

  _implementCache.set(key, result);
  return result;
}

/** True when the exercise should show the equipment dropdown. */
export function hasImplementPicker(name) {
  return implementTypeForExercise(name) !== null;
}

/** Seed models covering a given implement type. */
export function seedModelsForType(type) {
  if (!type) return [];
  return SEED_MODELS.filter(m => m.types.includes(type));
}

/**
 * The weights an implement can actually be set to, or null when we
 * don't know (which is most of the time, and must stay safe).
 *
 * Adjustable dumbbells are the case that matters: a Bowflex 552 goes up
 * in 2.5 lb steps to 25 lb and then jumps in 5s, so a suggestion of
 * "27.5" is a number the user physically cannot select. Matching on
 * brand + line + model rather than the label, because the label is
 * display text and gets translated.
 */
export function selectableWeights({ brand, line, model } = {}) {
  if (!brand) return null;
  const seed = SEED_MODELS.find(m =>
    m.brand === brand
    && (m.line  || null) === (line  || null)
    && (m.model || null) === (model || null)
  );
  return seed?.ladder || null;
}

/**
 * Snap a suggested weight onto the nearest weight the implement can
 * actually be set to. Ties round DOWN — suggesting a load the lifter
 * can't quite make is worse than suggesting one they can.
 *
 * Returns the input unchanged when the ladder is unknown, so callers
 * can pass any implement (or none) without branching.
 */
export function snapToSelectable(weight, implement) {
  const ladder = selectableWeights(implement || {});
  // `weight == null` is checked BEFORE coercion: Number(null) is 0, which
  // is finite, so a bare Number.isFinite guard would silently turn a null
  // into the bottom of the stack.
  if (weight == null) return weight;
  const w = Number(weight);
  if (!ladder?.length || !Number.isFinite(w)) return weight;

  // Above the top of the stack there is nothing to snap to — the honest
  // answer is the max the implement reaches.
  if (w >= ladder[ladder.length - 1]) return ladder[ladder.length - 1];
  if (w <= ladder[0]) return ladder[0];

  let best = ladder[0];
  let bestDist = Infinity;
  for (const step of ladder) {
    const dist = Math.abs(step - w);
    // `<` not `<=` keeps the FIRST (lower) of two equidistant steps.
    if (dist < bestDist) { bestDist = dist; best = step; }
  }
  return best;
}

/**
 * Display label for a chosen implement, e.g.
 *   "Hammer Strength Plate Loaded Super Squat Press"
 *   "Bowflex SelectTech 552"
 *   "Life Fitness Insignia Series"
 * Falls back to the implement type's label when brand is unknown.
 */
export function implementLabel({ brand, line, model, implementType } = {}) {
  const parts = [];
  if (brand && brand !== 'unknown' && brand !== 'other') parts.push(brandLabel(brand));
  if (line) parts.push(line);
  if (model) parts.push(model);
  if (parts.length === 0) return implementTypeLabel(implementType);
  return parts.join(' ');
}
