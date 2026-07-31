# PROMPT — Gym Equipment Picker (machine-level selection in an active workout)

> Self-directed execution prompt. Read
> [`gym-equipment-picker-research.md`](./gym-equipment-picker-research.md)
> first — it holds the evidence, the licensing constraint, and the verified
> file/line anchors this plan depends on.

---

## The ask

Multiple users want to record the *specific* piece of equipment their gym has.
Inside an active workout, next to the exercise title, gym/machine exercises get
a dropdown to pick the exact machine — and picking it shows an image of that
machine.

## The one thing that shapes the whole design

**No open dataset exists below the category level, and manufacturer product
photos are copyrighted.** So:

- Brand and model names ship as **text** (nominative use — legal, and it is
  what the user is actually asking for).
- Images come from **users, not manufacturers**. Fallback chain, always:
  `user photo for this gym's machine → gym-wide photo → Wikimedia CC-BY-SA
  generic for this machine type → drawn silhouette icon`.
- The feature must be **fully useful with zero photos on day one.** Photos are
  an enrichment layer that fills in as the community uses it. If any phase
  makes the feature depend on a photo existing, that phase is wrong.

## Non-negotiable constraints

- **Mobile-only.** Flexyn ships to iOS/Android app stores only. Design
  mobile-first, ≥44px tap targets, no hover-only affordances. Use
  `MobileSelect` (bottom Drawer under 768px), not a bare shadcn `Select`.
- **Do not ship manufacturer product photography or brand logos.** Text only
  for brands.
- **Migration numbering starts at 268.** Grep for actual column/function names
  in `supabase/migrations/` before referencing existing schema — per
  `CLAUDE.md`, referencing nonexistent columns is this repo's #1 defect class.
- **SECURITY DEFINER RPCs gate on `auth.uid()` server-side**, never on a
  client-passed identifier.
- **i18n**: every user-facing string via `tFallback('key', 'English')`. English
  fallbacks inline. Never machine-translate the other 14 locales.
- **Push straight to `main`** (fast-forward), no per-change PRs. Check
  `git log` before claiming work is uncommitted — a parallel session stages the
  whole tree.
- Report progress as short one-line notes, not detailed summaries.

---

## Phase 0 — Decide the data model — ✅ COMPLETE (2026-07-30)

### Q1. Global catalog + per-space join? → **Yes. No RLS friction.**

`gym_businesses` RLS is `"gym_businesses: read all" FOR SELECT TO authenticated
USING (TRUE)` (mig 135:142); `gym_members: read all` is also `USING (TRUE)`
(135:176). Any authenticated user can already read every gym and every
membership, so a global `equipment_models` table with a join table needs no
policy gymnastics. **Decision: global catalog + join.**

### Q2. Does selection need a gym? → **No — and the owning entity must not be a gym at all.**

Kegan's home-gym requirement makes this the load-bearing decision.

Verified:
- There is **no** `home_gym`, `available_equipment`, or `training_location`
  column anywhere in 267 migrations.
- The only user-side equipment concept is `planBuilder.js:84` — a *regex over a
  chat message* returning `gym | dumbbells | minimal | bodyweight` for AI
  session generation. `:111` marks it "session only". Ephemeral, never persisted.
- `gym_businesses` requires `latitude`/`longitude` NOT NULL and a `flexyn_code`,
  and **INSERT is gated behind a SECURITY DEFINER approval RPC** (135:150) —
  there is no client insert path. *A user cannot create a row for their garage.*
  Modeling home gyms as `gym_businesses` would mean weakening the gym
  verification path. Don't.
- `gym_members` and `gym_checkins` both FK hard to `gym_businesses(id)`.

**Decision: introduce `training_spaces`, and make the feature space-scoped, not
gym-scoped.**

- `kind = 'gym'` → FK to `gym_businesses`, shared, visible to members.
- `kind = 'home'` → `owner_id = auth.uid()`, private to that user.
- A user may have several (home + their commercial gym + a travel gym).
- The join table is `space_equipment (space_id, …)`, not `gym_equipment`.
- RLS: home spaces gate on `owner_id = auth.uid()`; gym spaces inherit gym
  member visibility.

**This must be space-shaped from Phase 1.** Retrofitting a `space_id` later
means a data migration on live user content.

**Consequence — the catalog is much wider than machines.** Home users track
adjustable dumbbells (Bowflex SelectTech 552 / Results Series 552, PowerBlock,
REP QuickDraw, REP × PÉPIN Fast, Ironmaster, NÜOBELL, Nike, Snode AD80,
NordicTrack Select-A-Weight), racks (Rogue R-3 / RML, REP PR-4000 / 5000,
Titan T-3), benches (REP AB-3000, Rogue Adjustable), bars (Rogue Ohio, Eleiko),
kettlebells, bands, and all-in-one trainers (Tonal, Force USA).

**Second payoff, worth building for:** adjustable dumbbells have *non-linear
weight increments* (the Bowflex 552 steps 2.5 lb to 25 lb, then 5 lb). Knowing
the user's exact model lets `src/lib/progressiveOverload.js` suggest a load
they can actually select instead of an impossible number. Same for a home rack
with fixed pin spacing. Fold this into Phase 5.

**Rename the feature** from "gym equipment picker" to **"my equipment /
training space"**. The commercial-gym floor catalog is one *kind* of space, not
the whole feature.

### Q3. Gate the dropdown on `classifyEquipment`? → **No. It fails badly.**

Ran the classifier over all 394 `EXERCISE_LIBRARY` entries. It is wrong on
~25 of the exercises that matter most here.

**False negatives — real machines landing in `other`, so the dropdown would be
hidden on them:**
- **Every lat pulldown variant but one**: Close-Grip Lat Pulldown, Lat Pulldown
  With Neutral / Pronated / Supinated Grip, Neutral Close-Grip Lat Pulldown,
  One-Handed Lat Pulldown, Straight Arm Lat Pulldown. Only the literal "Machine
  Lat Pulldown" hits `machine`. The lat pulldown is *the* machine users most
  want to disambiguate.
- Tricep Pushdown With Bar / With Rope, Rope Pulldown, Face Pull, Pallof Press
  (cable stations)
- T-Bar Row, Back Extension, Reverse Hyperextension, Glute Ham Raise, Hip Thrust
- Seated / Standing / Donkey Calf Raise
- Stationary Bike

**False positives — non-machines landing in `machine`:**
- **Barbell Hack Squat**, **Landmine Hack Squat** — barbell lifts caught by the
  `hack` pattern
- **Bodyweight Leg Curl**, **Leg Curl On Ball** — caught by `leg curl`

**Mis-bucketed by precedence** (the `bodyweight` pattern is tested first):
- **Machine Crunch** → `bodyweight`
- **Cable Crunch** → `bodyweight`
- **Assisted Dip / Assisted Pull-Up / Assisted Chin-Up** → `bodyweight`, but
  these are performed *on the assist machine* — prime dropdown candidates

The classifier is fine at its real job (a coarse filter pill in
`ExerciseAutocomplete` where a miss is invisible). It is the wrong gate here.
**Do not "fix" it** — its existing consumer and tests depend on current
behavior.

**Decision:** add an explicit `EXERCISE_IMPLEMENT` map in `gymEquipment.js`
(exercise name → machine_type slug) covering the ~120 exercises that involve a
nameable implement, with `classifyEquipment` as fallback for unmapped names.
And since home gyms are in scope, **don't restrict to machines** — dumbbell,
barbell, bench and rack exercises want the dropdown too. Effective gate:
"does this exercise use any nameable implement", i.e. everything except pure
bodyweight, with the explicit map correcting the assisted-machine, cable-crunch
and machine-crunch misses.

### Bonus finding A — the repeat-workout path silently drops the selection

Phase 2 below claimed persistence needs no code changes. Half true:
- Save-path maps at `Workout.jsx:654`, `:667`, `:677` all use `{...ex}` spread
  → extra keys survive. ✅
- **`Workout.jsx:507` ("Repeat this workout") rebuilds the exercise object
  key-by-key and would drop `equipment`.** ❌ Repeating a workout is exactly
  when the machine should carry forward. Must be patched in Phase 2.
- `Workout.jsx:485` (start-from-routine) also rebuilds; nothing to carry today,
  but routines should eventually store a default implement.

### Bonus finding B — `MobileSelect` is not sufficient

`MobileSelect.jsx:60-72` renders a flat, unsearchable, ungrouped list of
`{value,label}` with no thumbnails. The picker needs section headers (this
space → catalog → add new), a search field, and image thumbnails. **Build a
purpose-built `ImplementPickerDrawer` on the same `Drawer` primitives** rather
than bending `MobileSelect`. (Still use `MobileSelect` for any simple selects
this feature adds elsewhere.)

### Net effect on the plan

Phases 1–5 below still hold in shape, but everywhere they say *gym* read
*training space*, everywhere they say *machine* read *implement*, and Phase 1's
schema gains `training_spaces` before `space_equipment`.

---

## Phase 1 — Data layer — ✅ COMPLETE (2026-07-30), migration NOT applied

Shipped:
- `src/lib/equipmentCatalog.js` — `BRAND_META` (26 brands, with corporate
  `parent` and `legacy` flags), `IMPLEMENT_TYPE_META` (57 types, each keyed to
  a `classifyEquipment` kind), `SEED_MODELS` (50 verified products),
  `EXERCISE_IMPLEMENT` override table + `implementTypeForExercise()`.
- `supabase/migrations/268_training_spaces_equipment.sql` — `training_spaces`,
  `equipment_models`, `space_equipment`, `equipment_photos`, 13 RLS policies,
  profanity triggers, `updated_at` triggers, service_role grants.
- `src/lib/__tests__/equipmentCatalog.test.js` — 64 tests, all passing.
  Full suite still green (1197 tests / 83 files).

Read-only preflight against the live project (`ebvqxuwfiptcmlkhflfj`) confirmed
`is_gym_member_or_owner(uuid, uuid)` and `is_text_clean(text, boolean)` exist
with exactly the signatures the migration calls, `gym_businesses` /
`gym_members` / `workout_logs` exist, and none of the four new table names are
taken.

**The migration has NOT been applied.** Applying it is a production DDL change
and needs Kegan's go-ahead. No local Postgres is available to parse it first
(Supabase CLI is installed but Docker is not), so the first real parse happens
on apply.

Two decisions worth knowing about:
- Named the module `equipmentCatalog.js`, not `gymEquipment.js` — Phase 0
  renamed the feature away from "gym", and a `gymEquipment.js` sitting next to
  the existing `gymAmenities.js` and `exerciseEquipment.js` would have read as
  a third gym-scoped thing.
- `equipment_models` has **no client UPDATE or DELETE policy**. Approval and
  moderation go through service_role only. An UPDATE policy scoped to
  `submitted_by` would let a user flip their own `approved` to TRUE and
  publish into the global catalog.

### Original spec

**Goal:** a controlled vocabulary + a seeded catalog + tables. No UI.

**New:** `src/lib/gymEquipment.js`, modeled directly on `src/lib/gymAmenities.js`
(slug → metadata map, unknown slugs render with a fallback, additive-safe):

- `BRAND_META` — slug → `{ label, parent }`. Seed from the research doc:
  `life_fitness`, `hammer_strength`, `technogym`, `precor`, `cybex` (legacy,
  parent `life_fitness`), `matrix`, `nautilus`, `rogue`, `eleiko`, `atlantis`,
  `arsenal`, `prime`, `panatta`, `gym80`, `watson`, `other`, `unknown`.
- `MACHINE_TYPE_META` — slug → `{ label, icon, equipmentKind }` where
  `equipmentKind` is one of the 9 categories `exerciseEquipment.js` already
  returns, so the two vocabularies stay aligned. ~35–45 types: leg press, hack
  squat, pendulum squat, belt squat, leg extension, leg curl (seated/lying),
  hip thrust, glute drive, abductor, adductor, calf raise (seated/standing),
  chest press, incline press, pec deck, cable crossover, lat pulldown, seated
  row, high row, low row, t-bar row, pullover, shoulder press, lateral raise,
  rear delt, preacher curl, triceps extension, dip/assist, ab crunch, back
  extension, smith machine, functional trainer, treadmill, bike, rower, stair
  climber, elliptical, ski erg.
- `SEED_MODELS` — `{ brand, line, model, machineType }`. Seed only what the
  research doc verified (Life Fitness Insignia/Axiom/Optima; Hammer Strength
  Select / MTS / Plate-Loaded incl. Super Squat Press, Pendulum-X Squat, Super
  Fly, Glute Drive, Hack Squat, Iso-Lateral Chest Press, Hip Abductor, Belt
  Squat; Technogym Selection Pro / Pure Strength / Artis; Precor Resolute /
  Vitality / Discovery; Cybex Eagle / VR3 / Prestige; Matrix Ultra / Versa /
  Aura / Magnum; Nautilus Inspiration / Impact). **Do not invent model names.**
  Anything unverified goes in as brand + machine type only.

**Migration `268_gym_equipment.sql`:**

- `equipment_models` — global catalog. `id`, `brand_slug`, `line`, `model_name`,
  `machine_type`, `is_seeded bool`, `submitted_by uuid`, `approved bool`,
  `created_at`. Public `SELECT` on approved rows; inserts of user submissions
  land unapproved.
- `gym_equipment` — the join. `gym_id → gym_businesses`, `model_id →
  equipment_models`, `machine_type`, `label_override`, `count int`,
  `photo_url`, `added_by`, `verified_by_owner bool`, `created_at`.
  `UNIQUE (gym_id, model_id)`.
- `equipment_photos` — `equipment_id`, `gym_id`, `url`, `uploaded_by`,
  `is_primary`, `reported int default 0`. Photos are user content, so this
  needs the same moderation posture as `gym_feed_posts` — read
  `158_gym_security_and_profanity.sql` and match it.
- RLS: members of a gym can read and add; only the gym owner (`owner_id`) or
  the adder can edit/remove; report/flag path for photos.
- Grant `service_role` (mig 085's ALTER DEFAULT PRIVILEGES should cover it —
  verify, don't assume).

**Verification gate:** run the schema-drift audit
(`supabase/migrations/_audit_schema_drift.sql`) and confirm no missing FKs or
grants. Unit-test `gymEquipment.js` the way
`src/lib/__tests__/exerciseEquipment.test.js` tests its sibling: every
`MACHINE_TYPE_META.equipmentKind` must be a value `classifyEquipment` can
actually return.

---

## Phase 2 — The dropdown — ✅ COMPLETE (2026-07-30)

Shipped:
- `src/components/workout/ImplementPicker.jsx` — trigger chip + BottomSheet
  with search (appears past 8 options), "Your equipment" / "Common models"
  sections, clear-selection, and add-your-own.
- `src/lib/recentImplements.js` — per-user, per-type recall in
  `flexyn.implements.<userId>`, ranked recency-first so switching gyms
  promotes the new machine over an old high-count one.
- `ExerciseLogger.jsx` — picker in the active card header (wraps below the
  title rather than squeezing it), chosen label carried into the collapsed
  complete summary.
- `Workout.jsx:507` **and `:1330`** — both repeat paths now carry `equipment`
  forward. Phase 0 only caught `:507`; `:1330` ("repeat last workout") is the
  same key-by-key rebuild and would have dropped it too.
- 33 new tests (14 render + 19 recall). Full suite green: 2165 / 158 files.
  Production build clean; picker + catalog land in the `Workout` chunk
  (378 KB), not the startup index chunk.

**Not wired to the database.** Options come from the bundled `SEED_MODELS`
plus local pick history. Migration 268 is still unapplied, and the picker is
built to be fully useful without it — Phase 4 layers a gym's shared floor
*above* "Your equipment" without changing anything here.

Fixed mid-phase: the trigger chip announced "Choose equipment" regardless of
state, so a screen-reader user couldn't tell what was selected. Its
`aria-label` now includes the chosen implement.

**Verification gap:** the picker's on-screen layout at 375 px is NOT visually
confirmed. The dev server runs and the app loads clean (no console errors),
but an active workout is behind sign-in and I did not authenticate as the
user. Wrapping behavior in the title row is covered by reasoning and the
`flex-wrap` fallback, not by a screenshot.

### Original spec

**Goal:** the requested control, working end to end, storing the selection.

- New `src/components/workout/MachinePicker.jsx` — wraps `MobileSelect`.
  Renders as a small chip/caret next to the title, not a full-width select;
  it must not push the muscle `Badge` row around.
- Wire into `src/components/workout/ExerciseLogger.jsx` at the active-card
  header (`~:241`, next to the `<h4>`). **Also update the collapsed-complete
  summary at `~:217`** to show the chosen machine as text — easy to miss, and
  a completed exercise losing the label looks like a bug.
- Options are ordered: *this gym's machines for this machine type* → *other
  catalog models of this type* → `Add a machine…` → `Not sure`.
- Selection persists into the existing `workout_logs.exercises` JSONB as
  `equipment: { modelId, gymEquipmentId, label }`. **No migration needed** —
  confirm nothing downstream (`workoutVolume.js`, `progressiveOverload.js`,
  `exerciseHistory.js`, share cards) chokes on the extra key.
- Only render for exercises Phase 0 decided qualify.

**Verification gate:** start a workout in the preview, pick a machine, finish
it, reload, and confirm the label survives in the saved log and in Progress.
Screenshot the header at 375px width to confirm it doesn't wrap badly.

---

## Phase 3 — Images — ✅ COMPLETE (2026-07-30)

Migration 268 **is now applied** to the live project (`ebvqxuwfiptcmlkhflfj`).
Verified after apply: 4 tables, RLS enabled on all, 13 policies (2/3/4/4),
profanity + touch triggers present.

Shipped:
- `src/lib/equipmentImage.js` — `resolveEquipmentImage()`, the chain
  `space photo → same-model photo → reference photo → silhouette`. Always
  terminates; `kind` is part of the contract so the UI can label a tier-2
  photo and credit a tier-3 one.
- `src/components/workout/equipmentSilhouettes.jsx` — 12 line-art shapes
  covering visually distinct families, with every implement type mapped onto
  one.
- `src/lib/data/equipment.js` — spaces / models / equipment / photos access.
  Every function degrades to null rather than throwing: a photo failing must
  never block someone mid-set.
- `ImplementPicker` — thumbnails run the chain, plus an add/replace photo
  block with `capture="environment"` so the rear camera opens at the machine.
- `ExerciseLogger` — the collapsed summary shows a 14px thumbnail beside the
  label.
- 20 new tests. Full suite 2180 / 159 green, lint and build clean.

**Two deliberate departures from the original spec, both stated rather than
silently absorbed:**

1. **The Wikimedia Commons tier ships empty.** `REFERENCE_IMAGES` is wired
   and tested but unpopulated. Each Commons file needs its own license page
   verified (a category listing is not per-file proof), adds an in-app
   attribution obligation, and hotlinking is fragile offline — and a generic
   photo of *a* leg press is barely better than the silhouette when tier 1 is
   a photo of *your* leg press. A verified addition is one line here plus an
   `ATTRIBUTIONS.md` row. A test asserts any future entry carries full
   attribution, and the resolver skips incomplete entries rather than
   rendering them uncredited. Nothing was added to `ATTRIBUTIONS.md` because
   no third-party imagery ships.
2. **A thin slice of Phase 4 came forward.** `equipment_photos` FKs to
   `space_equipment`, so photos need a persisted row to hang off. Phase 3
   creates one implicit "My gear" home space on first upload. Gym-kind
   spaces, owner curation, the verified flag and reading a gym's shared floor
   are still Phase 4 and don't change these functions.

**Bug caught before commit:** `findOrCreateModel` filtered
`.eq('product_line', '')` while the column stores NULL. Confirmed against the
live DB that `NULL = ''` is false while the unique index's `COALESCE(col,'')`
treats them as equal — so every lookup would have missed, fallen through to
an insert, and 23505'd. Now uses `.is(col, null)` for the empty case.

**Verification gaps:** the picker's on-screen layout is still unconfirmed
(sign-in gated, unchanged from Phase 2), and the upload → Storage → DB path
has not been exercised end-to-end against a real session — only its failure
handling is unit-tested.

### Original spec

**Goal:** the "shows an image of that exact machine" half, with the fallback
chain that keeps it never-empty.

- `resolveEquipmentImage(gymEquipment, model, machineType)` in
  `src/lib/gymEquipment.js` implementing:
  `gym photo → any approved photo for this model → Commons generic for this
  machine type → silhouette icon`.
- Silhouette icons per machine type. Follow
  `src/components/emptyStateIllustrations.jsx` for the in-repo SVG pattern.
- Commons fallbacks: pick a handful of clearly CC-BY-SA machine photos, record
  file, author, and license in `ATTRIBUTIONS.md` (the Twemoji entry is the
  template), and surface the credit in the image viewer.
- Upload path: reuse `db.integrations.Core.UploadFile` + `compressImage`,
  copying `AvatarUploader.jsx`'s handler almost verbatim (type check, size
  check, downscale to 800px, toast on failure).
- Tapping the image opens a larger view with brand/model text and attribution.

**Verification gate:** confirm every one of the 4 fallback tiers renders, by
forcing each. Confirm no bundled asset is manufacturer-sourced.

---

## Phase 4 — Gym floor + owner curation — ✅ COMPLETE (2026-07-30)

Shipped:
- `GymEquipmentTab.jsx` + a new **Equipment** tab on `GymHub` (lazy-loaded,
  matching the Feed/Events pattern). Members add; the owner confirms.
  Grouped by implement type so a 40-machine floor reads as a floor plan.
- `lib/data/equipment.js` — `getOrCreateGymSpace`, `listGymFloor`,
  `addToGymFloor`, `setEquipmentVerified`, `removeSpaceEquipment`.
- `ImplementPicker` now has three ranked sections: **Your equipment** →
  **At \<gym\>** → **Common models**. The gym floor is fetched lazily on
  drawer open, inside the picker rather than threaded through `Workout.jsx`,
  so a slow or failing gym query can never delay the workout screen.
- 12 new tests (6 gym-floor, plus the data-module mocks that stop the suite
  attempting real network calls to the stub Supabase host).
  Full suite 2186 / 159 green, lint 0 errors, build clean.

**A gym's floor is the union of every member's space, not one canonical
space.** That falls out of the schema rather than being a preference:
`training_spaces` is `UNIQUE (owner_id, gym_id)` and the INSERT policy
requires `owner_id = auth.uid()`, so a member cannot create a space the gym
owns. It also models the trust tiers for free — owner's space is
authoritative, `verified_by_owner` is a blessed member find, everything else
is member-submitted.

**Section ordering reversed from what Phase 3's notes assumed.** Those said
the gym floor would layer *above* personal history. It's the other way
round: a machine you have picked three times is a stronger signal than one
that merely exists somewhere on the floor. The stale comment in
`recentImplements.js` was corrected rather than left to mislead.

### ❌ RETRACTED — the finding below was a misdiagnosis (corrected 2026-07-30)

**The ownerless gyms are deliberate, not drift. I got this wrong.**

Migration 137 explicitly runs `ALTER COLUMN owner_id DROP NOT NULL`, with a
header comment saying it does so "so these demo rows can exist without an
auth.users row backing them," and documents the cleanup:
`DELETE FROM gym_businesses WHERE owner_id IS NULL AND name LIKE 'Demo:%'`.
`approve_gym_verification` (migs 136/150) always sets `owner_id` from the
verification queue, so real gyms get real owners. Mig 135's NOT NULL wasn't
violated — it was superseded by a later migration doing its job.

I read mig 135, saw `NOT NULL`, saw nulls in production, and called it drift
without checking whether a later migration had changed it. The nulls were the
documented design.

**There is no owner backfill to do, and doing one would be actively wrong** —
assigning a real user to a demo gym grants them edit rights over fake data.

Two real things did come out of re-checking, kept below:

1. **One genuine orphan.** "Camp Quannapowitt" (Wakefield MA, `WKF2QPWT`) is
   NOT demo-named, has no `verification_id`, no owner, and one member —
   `sjoudrie@gmail.com`, who joined 96 seconds after the row was created. It
   looks hand-inserted during development. It's the only gym on the platform
   that a real person uses and nobody can edit.
2. **The demo seed ran twice and duplicated.** 50 rows for 25 distinct names.
   An earlier seed ran 2026-05-24 20:31 with `*FLX*` codes; mig 137 ran
   2026-05-25 00:39 with `*DEMO` codes. `ON CONFLICT (flexyn_code) DO NOTHING`
   couldn't dedupe them because the codes differ. The map shows 50 pins for 25
   gyms. **Careful if cleaning up:** Sean's `Demo: Cambridge Strength Lab`
   membership is attached to the OLDER (`CMB2FLXJ`) copy, and
   `gym_members.gym_id` is `ON DELETE CASCADE` — deleting the older set would
   silently take his membership with it.

### Original (incorrect) finding, kept for the record

Running the "verify RLS against real data" checkpoint surfaced a real
problem that predates this work:

**All 51 gyms in production have `owner_id IS NULL`, and the live column is
`NULLABLE` even though migration 135 declares it `NOT NULL`.** That is schema
drift plus data that could not exist under the declared constraint.

Consequences, all pre-existing:
- `is_gym_member_or_owner` can never pass via its owner branch.
- The `gym_businesses: owner update` policy never matches, so **no one can
  edit any gym**.
- Phase 4's owner controls (Confirm / owner-authoritative badge) render for
  nobody on any gym currently in the database.

Context: every one of the 51 rows has `verification_id IS NULL`, was created
2026-05-24/25, and `gym_verification_queue` is empty — so these are all demo
seed rows (mig 137) and **no gym has ever been through
`approve_gym_verification`**. That RPC presumably sets `owner_id`, so real
gyms would likely be fine; it is untested in production.

Phase 4 degrades correctly rather than breaking: `listGymFloor` guards on
`!!gymOwnerId`, so `fromOwnerSpace` is simply false and entries show as
member-submitted. Members can still add, photograph, and remove their own.

**Not fixed here** — deliberately. Restoring `NOT NULL` needs owner
backfill decisions I can't make (who owns a demo gym?), and it is
production schema surgery well outside this feature.

### Original spec

**Goal:** the dropdown gets good because gyms describe their floor once.

- A "Equipment" section on the gym page (`GymHub.jsx` / `GymEdit.jsx`) where
  the owner adds machines, marks counts, uploads photos, and flags
  member-submitted entries as verified.
- Members can add a missing machine from inside the picker (`Add a machine…`),
  which creates an unapproved `equipment_models` row + a `gym_equipment` row.
- Owner-verified entries sort above member-submitted ones.
- Moderation: reuse the profanity/report machinery from mig 158 for
  `label_override` and photos.

**Verification checkpoint:** before building, re-read how `GymEdit.jsx` handles
amenities — that flow is the UX precedent and should be matched, not
reinvented.

---

## Phase 5 — Make it feel automatic — ✅ COMPLETE (2026-07-30)

All four items shipped. Full suite 2217 / 161 green, lint 0 errors, build clean.

**1. Prefill from last use.** `getLastImplementForExercise` reads the machine
off the workout log rather than localStorage — the log is already in memory
and follows the user across devices. Fires once per exercise and never
overwrites an explicit choice, including a deliberate clear.

**2. Check-in scoping.** New `getTodayCheckinGymId()` — mig 149's
`has_gym_checkin_today` RPC answers only yes/no, and the picker needs the
identity. If the user checked in somewhere today, the gym section shows that
floor; otherwise it unions every gym they belong to. A check-in at a gym they
haven't joined falls back rather than showing nothing.

**3. Machine in the history line.** `getRecentSessionsDetailed` returns
`[{ sets, equipment, date }]`; `getRecentSessionsForExercise` is now a thin
wrapper so its long-standing array-of-set-arrays contract is byte-identical.
The line names the machine **only when it changed** from the session before —
"185 on the Hammer Strength, 160 on the Cybex" is the insight; repeating the
same name on every row buries the numbers.

**4. Adjustable-dumbbell increments.** `selectableWeights` /
`snapToSelectable` in the catalog, wired into `progressiveOverload`'s bump
and regress branches. A Bowflex 552 steps 2.5 lb to 25 then jumps in 5s, so
an unsnapped "+5" from 22.5 names 27.5 — a weight the handle cannot be set
to. Ties round DOWN. The ladder was **verified against Bowflex's own spec**,
and `ladder` is only present on models where the exact settings were
confirmed; everything else is a deliberate no-op, because a guessed ladder
produces confidently wrong advice. A test asserts every shipped ladder is
sorted, unique, positive, and consistent with its `maxLb`.

### Three bugs caught in-flight

- **Shape change broke two live consumers.** Repointing `recentSessions` at
  the detailed shape silently broke `ExerciseLogger`'s warm-up seeder
  (`recentSessions[0].filter` on an object) and the history render. Both
  fixed; the wrapper exists so nothing else has to care.
- **`snapToSelectable(null)` returned 5.** `Number(null)` is `0`, which is
  finite, so the guard let it through and it clamped to the bottom of the
  stack. Now null-checked before coercion.
- **A test premise of mine was wrong.** I asserted 50 lb → "hold" on a 552;
  in fact 55 snaps to 52.5, which is a real bump. The genuine hold case is
  52.5 (the ceiling). Fixed the test and made the message accurate — it now
  says "that's the heaviest this gear goes" rather than implying a next notch
  exists.

### Original spec

**Goal:** the dropdown should mostly already be right.

- Remember the last machine chosen for `(exercise, gym)` and prefill it.
  Per-device state goes under the `flexyn.<feature>.<userId>` localStorage
  namespace; cross-device belongs in the DB — pick one and say why.
- When a check-in (`gym_checkins`) says which gym they're in, scope the
  dropdown to that gym's floor automatically.
- Surface the machine on the exercise history line
  (`getRecentSessionsForExercise`) so "185 on the Hammer Strength, 160 on the
  Cybex" becomes legible — this is the actual payoff users are asking for and
  it should not be skipped.

---

## Post-build audit (2026-07-30)

A pass back over all six phases. Three defects found and fixed, two
logged and left alone, one claim corrected.

### Fixed

1. **The machine prefill silently ate the warm-up seed.** (Regression I
   introduced in Phase 5, breaking a pre-existing feature.) The warm-up
   seeder and the implement prefill were two effects firing in the same
   commit, each spreading the same stale `exercise` — so the second
   overwrote the first. The machine landed; the seeded warm-up set
   vanished. Merged into one effect issuing one `onChange`.
   *Why the tests missed it:* they asserted on a `vi.fn()` spy, where
   both calls look correct. Only a **stateful parent** shows that the
   second write discards the first. The regression guard now uses one.
2. **`implementKey` collided across gym-floor rows.** Two unbranded leg
   presses on the same floor produce identical brand/line/model, so they
   shared a React key and both rendered as selected. Gym rows now key on
   their DB id.
3. **The gym page pulled 31 KB of workout-picker chunk** — camera
   capture, image compression, the Storage upload path — to render a
   40 px thumbnail, because `EquipmentThumb` lived inside
   `ImplementPicker`. Extracted to its own module;
   `GymEquipmentTab`'s chunk graph no longer references the picker.

### Verified clean (checked, not assumed)

- 50 seed models: no duplicate brand/line/model identities (which the DB
  unique index would have rejected), no React-key collisions within any
  implement type, no unusable labels.
- All 38 i18n call-site keys resolve; none dead; `common.cancel` reuses
  the existing translated key.
- No RLS policy recursion: `equipment_models` → `space_equipment` →
  `training_spaces` → `is_gym_member_or_owner` (SECURITY DEFINER,
  terminates).

### Logged, deliberately not fixed

- **`getOrCreateHomeSpace` can race.** Two concurrent first-photo
  uploads could create two "My gear" spaces — nothing constrains one
  home space per user (the unique index is partial, `WHERE gym_id IS NOT
  NULL`). Harmless today: the reader takes the oldest, so the second is
  inert. A `UNIQUE (owner_id) WHERE kind = 'home'` index would fix it,
  but that's a migration and this needs a real concurrent upload to
  trigger.
- **`equipment_models`' SELECT policy nests three levels of RLS** per
  row. Correct, but it will get slow as the catalog grows. Worth a
  `SECURITY DEFINER` helper (like `is_gym_member_or_owner`) if the
  catalog reaches thousands of rows. Not a problem at 50.

### Claim corrected

`SEED_MODELS` holds **50** entries, not the 60 previously reported here.

## Phase 6 — Close it out — ✅ COMPLETE (2026-07-30)

Full suite 2228 / 162 green, lint 0 errors, build clean.

- **i18n**: `src/lib/i18n-equipment.js`, 37 keys, picked up automatically by
  the splitter (39 part files, en.js 1609 → 1646). **English only, with a
  `TODO(i18n)` head comment** — per CLAUDE.md we don't ship machine-translated
  copy, so the other 14 locales fall back to the inline English via
  `tFallback`. Includes translator notes: brand/model names are proper nouns
  and must not be translated, and `implement.atGymNamed` carries a `{gym}`
  placeholder. Verified programmatically that all 38 call-site keys resolve,
  none are dead, and `common.cancel` correctly reuses the existing
  already-translated key.
- **Docs**: `CLAUDE.md` gained an Equipment-picker section (the six
  conventions a contributor must not undo, plus the `owner_id` blocker);
  `ATTRIBUTIONS.md` gained a section explaining the deliberate *absence* of
  equipment imagery, so nobody adds a manufacturer photo later.
- **Tests**: `ExerciseLoggerEquipment.test.jsx`, 11 tests covering bar-selector
  gating, prefill, and the change-only history line.

### The visual verification finally happened — and it found three things

Five phases of deferring this ended by mounting `ExerciseLogger` in a
throwaway Vite harness outside the auth gate (`equipment-preview.html/jsx`,
deleted after; never referenced by the app or the build). Confirmed working
at 375 px: long names wrap with the chip dropping below, short names stay
inline, the history line reads "185×8, 185×8 · Hammer Strength MTS / 160×8 ·
Cybex Eagle", prefill populates the chip, and the Phase-2 aria-label fix
renders as "Choose equipment: Hammer Strength MTS".

Three defects no test had caught, because they were all about how it *looks*:

1. **Truncation cut the model name.** "Life Fitness Insignia Series Arc Le…",
   "Hammer Strength Plate Loaded S…" — losing exactly the part that
   distinguishes two machines, in a list whose only job is distinguishing
   machines. Now `line-clamp-2`.
2. **Silhouettes were illegible.** 1.6 stroke units on a 48 viewBox renders
   under one device pixel at the 27 px drawn size — a grey smudge, not line
   art. Now 2.6.
3. **A leg press offered a barbell.** The `isBarbell` name regex matches
   "press", so Leg Press showed a bar-weight selector and a barbell plate
   diagram. Pre-existing and merely odd — but once the user can state "this is
   a Hammer Strength leg press", it's a contradiction on screen. An explicit
   non-barbell choice now overrides the guess; no choice = unchanged behavior.

### Original spec

- i18n sweep: every new string through `tFallback`, English inline only.
- Tests: `gymEquipment.js` vocab consistency, `resolveEquipmentImage` fallback
  order, `MachinePicker` render for a qualifying and a non-qualifying exercise.
- Run the app, walk a full workout on a 375px viewport, screenshot the picker
  open and closed, and the completed-exercise summary.
- Update `CLAUDE.md` with the new vocabulary-file convention and the
  "no manufacturer imagery" rule so future sessions don't undo it.
- Note in `ATTRIBUTIONS.md` any Commons images shipped.

---

## Research/verification checkpoints to repeat during execution

- **Before Phase 1 seeds ship:** re-verify every brand/line/model name against
  the manufacturer's own catalog page. Do not carry over a model name that
  only appears on a reseller blog.
- **Before Phase 3 ships:** re-check the license page of each Commons file
  actually used — category listings are not per-file license proof.
- **Before Phase 4 ships:** confirm the RLS policies with a real
  non-owner/non-member session, not by reading the SQL.
- **After Phase 2 and Phase 5:** confirm nothing that consumes
  `workout_logs.exercises` breaks on the new key — grep, don't assume.
