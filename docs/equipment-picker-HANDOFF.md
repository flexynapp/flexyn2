# Handoff — Equipment picker (session continuation prompt)

Paste this into a new session to pick up where the last one stopped.

---

## Start here

You are continuing work on **Flexyn** (`~/flexyn2`), a fitness PWA.
Read `CLAUDE.md` first, then:

- `docs/gym-equipment-picker-research.md` — evidence base, licensing constraint
- `docs/gym-equipment-picker-prompt.md` — the phase-by-phase build log, with
  every decision and every bug found, in order

Branch **`equipment-picker`**, already fast-forwarded to `main`.
Last commit: `6380d2f`. Working tree clean, `origin/main` in sync.

## What the feature is

Inside an active workout, a dropdown next to each exercise title records the
**specific implement** the lifter is on — their gym's Hammer Strength row
rather than "a row", or their own Bowflex 552s at home. Gyms describe their
floor so members' pickers lead with real machines.

**Phases 0–6 are complete and shipped.** Migrations 268, 269 and 270 are
**applied to production** — do not hand Kegan SQL for them.

## Non-negotiables (learned the hard way, don't relitigate)

1. **Never ship manufacturer product photography or brand logos.** Brand and
   model names as *text* are nominative use and fine. Images come from users,
   falling back to drawn silhouettes. See `ATTRIBUTIONS.md`.
2. **Mobile-only.** ≥44px targets, no hover-only affordances, `MobileSelect`
   or `BottomSheet` rather than bare shadcn `Select`.
3. **Test RLS by executing the attack, not by reading the policy.** Raw SQL
   through the Supabase MCP runs as `postgres` and **bypasses RLS entirely** —
   it proves nothing. Use:
   ```sql
   BEGIN;
   SET LOCAL role authenticated;
   SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
   -- ...the exact statements the client makes...
   ROLLBACK;
   ```
   This is how the mig-270 hole was found after five clean "reviews" missed it.
   CTEs in one statement can't see each other's writes, so multi-step client
   flows must be separate statements or you'll get a false "blocked".
4. **`i18n-check.js` already exists** — a DEV checker with `ALLOW_IDENTICAL`
   and `ALLOW_IDENTICAL_BY_LANG`. Don't rebuild it. `scripts/i18n-audit.mjs`
   is the CLI counterpart; keep their exclusions in sync.
5. **Machine translation is a documented one-off**, not precedent. See the
   `i18n-equipment.js` header and `CLAUDE.md`. Don't extend it to prose without
   asking.
6. **Push straight to main** (branch first, then fast-forward). Check
   `git log` before claiming anything is uncommitted — a parallel session
   stages the whole tree.

## Key files

| File | Role |
|---|---|
| `src/lib/equipmentCatalog.js` | Vocabulary: 26 brands, 57 implement types, 50 seed models, exercise→implement map, `snapToSelectable` |
| `src/lib/equipmentImage.js` | Image fallback chain; `REFERENCE_IMAGES` deliberately empty |
| `src/lib/recentImplements.js` | Per-user pick history (localStorage) |
| `src/lib/data/equipment.js` | All DB access; every function degrades to null rather than throwing |
| `src/components/workout/ImplementPicker.jsx` | The in-workout dropdown |
| `src/components/workout/EquipmentThumb.jsx` | Thumbnail — kept separate so the gym page doesn't pull 31 KB of picker |
| `src/components/gyms/GymEquipmentTab.jsx` | Member-facing floor list, on GymHub |
| `src/components/gyms/GymEquipmentEditor.jsx` | Owner's pill-grid editor, in GymEdit |
| `supabase/migrations/268/269/270` | Schema, data fixes, security gate |

## Open items, highest value first

1. **The upload path — DB half now verified, browser half still open.**
   Verified 2026-07-30 by executing the exact client statements against
   production as `authenticated` (`SET LOCAL role` + JWT claims, each step a
   separate statement, `ROLLBACK`), on a user with no existing home space:
   all four writes and all three read-backs pass —
   `training_spaces` INSERT → `equipment_models` INSERT (+ submitter can read
   back its own unapproved row) → `space_equipment` INSERT →
   `equipment_photos` INSERT → `photo_url` denormalize → `findModelPhoto` and
   `listSpaceEquipment` both return the row.
   Storage side: `uploads` is public (so `getPublicUrl` resolves), its INSERT
   policy admits `uploads/<uid>/…` and **blocks another user's prefix (42501)**.
   Note `INSERT … RETURNING` on `storage.objects` fails under RLS because mig
   185 dropped the bucket's SELECT policy — that's expected, and `supabase-js`
   doesn't use RETURNING there.
   `src/lib/data/__tests__/equipment.test.js` (new, 21 tests) pins the client
   half: statement sequence, payloads, the `.is(col, null)` identity filter,
   `approved: false`, the 23505 re-read, and "don't steal an existing primary".
   **Still unproven:** the real browser round trip — `compressImage` on a
   camera capture, the multipart PUT, and the rendered thumbnail. Needs Kegan
   to add one photo on a device. Sentry tags: `equipment.homeSpace`,
   `equipment.attachPhoto`.
2. **Native review of the translations.** ~3,000 machine-translated strings.
   `docs/i18n-review-brief.md` + two CSVs are ready for a human. The 12 HIGH
   rows matter most — `formcoach.betaDisclosure` tells users their camera
   images never leave the device. Claude cannot do this review; don't offer to.
3. **`getOrCreateHomeSpace` can race** into two "My gear" spaces. Harmless
   (reader takes the oldest); fixing it is a `UNIQUE (owner_id) WHERE kind =
   'home'` index.
4. **`equipment_models`' SELECT policy nests three levels of RLS** per row.
   Fine at 50 rows, wants a SECURITY DEFINER helper at thousands.
5. **Phase 4's owner-curation is only exercised on one gym.** Camp
   Quannapowitt (`WKF2QPWT`) is the only gym with an owner; the other 25 are
   deliberately ownerless demo seeds. Owner controls render for nobody on
   those, which is correct, not a bug.

## Things that will bite you

- **`gym_businesses.owner_id` is nullable ON PURPOSE** (mig 137). Demo gyms
  have no owner. Do not "restore" the NOT NULL and do not backfill owners onto
  demo rows. I misdiagnosed this once and it's documented in the prompt doc as
  a retraction.
- **`classifyEquipment` is NOT the gate** for the picker — it's wrong on ~25
  of the exercises that matter. `implementTypeForExercise` overrides it. Don't
  "fix" the classifier; its other consumer depends on current behaviour.
- **`Workout.jsx` rebuilds exercise objects key-by-key in several places.**
  `:507` and `:1330` carry `equipment` forward; the save-path maps use spread.
  Anything new on an exercise must be added to those rebuilds or it vanishes.
- **Two effects in `ExerciseLogger` share one `onChange`** deliberately. As
  separate effects they clobbered each other. Anything else seeded there must
  join that effect, not add a third.
- **Radix `Select` throws on an empty-string item value.** Use a sentinel.
- **Part files have inconsistent shapes** — nested `lang: {}` in most,
  top-level `const ru = {}` in part10, `missingKeys.es = {}` in part9. A
  patcher that assumes one shape silently does nothing.

## How to verify anything here

```bash
npm run test          # 2342 tests / 166 files, all green
npx eslint src        # 0 errors
npm run build
node scripts/i18n-audit.mjs            # summary
node scripts/i18n-audit.mjs --partial  # the real i18n gaps
```

There is **no local Postgres** (Docker isn't installed), so migrations can't
be parsed offline — the first real parse happens on apply.

## Working style Kegan expects

Short one-line progress notes, not detailed summaries. State what's verified
versus what's assumed, and flag it explicitly when something is unverified —
several real bugs in this feature were found only because a claim got checked
instead of trusted.
