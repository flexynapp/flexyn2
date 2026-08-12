# Audit — Nutrition, Meal Logging

Run 2026-08-11 against `origin/main` @ `905da333` and production
(`ebvqxuwfiptcmlkhflfj`). Five sub-features were named in the brief: Log Meal
(Manual Entry), Recognize Meal (Photo AI), Search Food Database, Macros
Display, Calories Display.

**One of the five does not exist. Three of the remaining four share a single
root cause that nobody has ever seen fail, because it fails silently by
design.** Short version:

| # | Sub-feature | Verdict | |
|---|---|---|---|
| 1 | Log Meal (Manual Entry) | **(b) exists and is broken** | 16 nutrient inputs, 6 storable — **10 discarded on save** |
| 2 | Recognize Meal (Photo AI) | **(a) exists and works** | quota enforced server-side; one duplicate pair in production |
| 3 | Search Food Database | ~~**(d) absent**~~ **SUPERSEDED — see the amendment below** | was true on 2026-08-11; search shipped later the same day |
| 4 | Macros Display | **(b) exists, was broken** | 10 of 16 tiles rendered a permanent zero — **FIXED** |
| 5 | Calories Display | **(a) exists and works** | correct arithmetic, honest on an empty day |

**The root cause of 1 and 4 is one thing: migration 006 has never been
applied.** It declares the sixteen macro/micro/vitamin columns
`nutrition_logs` is missing, plus `water_oz`. It is in the repo, numbered 006
of 340-odd, and none of its `nutrition_logs` columns exist in production.

Three code changes shipped. Nothing was restored, and the deliberate water
encoding was not touched.

---

## Ground truth — re-verified line by line

The brief's block was checked before any of it was used. **It held exactly**,
including the water breakdown and the per-`meal_type` table.

| Claim | Verified |
|---|---|
| 126 rows, 4 users, 2026-05-19 → 2026-08-11 | ✅ exact |
| calories 126 non-null / 119 zero / 7 positive | ✅ exact |
| protein 8 non-null, 7 > 0; carbs/fat/fiber/sodium 7 each | ✅ exact |
| `food_item_id` 0 · `image_url` 2 · `ai_meta` 5 · `brand` 0 · `created_by` blank 0 | ✅ exact |
| 118 water rows (meal_type NULL), 8 real meals | ✅ exact |
| dinner 3 / snack 3 / lunch 1 / breakfast 1 | ✅ exact |
| `recognize-meal` ACTIVE, v11, `verify_jwt: false` | ✅ |
| food_items 2 · nutrition_recipes 1 · meal_plans 8 · recognize_meal_quota 2 | ✅ exact |

**Two columns the block did not mention are also 0-of-126:** `serving_size`
and `notes`. Both are read by the app; neither has ever been written by the
meal path. (`notes` does have a writer — the planner tags its mirrored diary
rows with `notes:'planner'` — so its zero means the planner mirror has never
run, not that the column is dead.)

**One thing in the data the block did not call out.** Two rows,
`da18054f` and `f5148559`, are byte-identical: same food_name, same macros,
same `ai_meta` JSON to the character, `created_at` **530 ms apart**. That is
one photo recognition stored twice. See check 7.

### The two CLAUDE.md numbers, corrected

Both were wrong, and the second was wrong in an instructive way.

- `nutrition_logs.food_item_id` said **0 of 120**. It is now **0 of 126** —
  still a true 0-of-N. Re-measured, and CLAUDE.md updated.
- The worked example said *"`nutrition_logs.protein` is 6 of 120 because the
  AI recogniser and the full-macro form both write it while quick-add
  captures calories only."* **The explanation is wrong.** `calories > 0` and
  `protein > 0` are both **7**, so there is not one production row matching
  "calories but no macros". The 119 calorie-less rows are water.
  **There is no quick-add path.** `addEntry` (Nutrition.jsx:1281) is the only
  manual writer and it sends all sixteen nutrient fields every time; the form
  has no calorie-only mode. The k-of-N here is 7-of-126 and its cause is
  simply that only 8 meals have ever been logged. CLAUDE.md now says so.

---

## Rule Zero — does each sub-feature exist?

### 1. Log Meal (Manual Entry) — (b) exists and is BROKEN

`LogMealForm.jsx` (399 lines) → `Nutrition.jsx addEntry` →
`src/lib/data/nutrition.js create()` → `db.js makeEntity().create`.
It is the only client-side writer of a manually-entered meal row.

The form renders **16 nutrient inputs** across two tabs — 8 macros
(`NUTRIENT_FIELDS`) and 8 vitamins/minerals (`VITAMIN_FIELDS`). Every one is
sent on save. `nutrition_logs` has **6** nutrient columns: calories, protein,
carbs, fat, fiber, sodium.

`nutrition.js create()` dual-writes five `_g`/`_mg` aliases onto the old
un-suffixed names, so those five land. **The other ten have no column and no
alias**, and `db.js`'s strip-and-retry drops each one and retries until the
insert succeeds. The user gets a success toast. See RESULTS defect 1.

### 2. Recognize Meal (Photo AI) — (a) exists and works

`FoodPhotoCaptureModal` → `photoMealRecognition.js` → the `recognize-meal`
Edge Function → `PhotoMealResultModal` → `confirmPhotoMeal`.

**The quota is enforced server-side, not client-side.** The brief flagged a
client-only quota on a paid AI call as a real finding if true; it is not.
`consume_recognize_meal_quota()` read via `pg_get_functiondef()` is
`SECURITY DEFINER`, `SET search_path TO ''`, caps at **3/day**, keys on
`auth.uid()` and ignores any client parameter. The Edge Function calls it at
`index.ts:96` before doing any work and calls `refund_recognize_meal_quota()`
on failure. `PhotoAiLimitModal` is presentation over an enforced limit.
One allowlist entry (`keganbergeron@gmail.com`) bypasses the cap.

**Three of five AI rows have no image, and that is not a silent failure.**
The three imageless rows are all 2026-07-16; both 2026-08-11 rows have an
image. The upload is best-effort by design — `confirmPhotoMeal` wraps it in
its own try/catch and reports to Sentry rather than blocking the log — and
the split by date says image upload started working, not that it fails.

### 3. Search Food Database — (d) ABSENT

> **AMENDED 2026-08-12 — this verdict is no longer true. Do not act on it.**
>
> Everything in this section was correct when it was written and is wrong now.
> Commit `6a7929ff` ("Nutrition: Search your own foods, and a barcode miss asks
> before it publishes") shipped `src/components/nutrition/FoodSearchSheet.jsx`
> and `src/lib/foodSearch.js` **after** this audit was written, on the same day.
> Search over food exists, is reachable from a full-width button at the top of
> the Log Meal form, and is tested.
>
> Two corrections to the specifics below:
>
> - *"`foodItems.js` exposes exactly two reads"* — three now. `listMineForSearch`
>   is the search source. `listRecent`, correctly noted here as having zero
>   callers, was **deleted** on 2026-08-12, along with `create()`, which lost its
>   last caller when 343 replaced the direct-publish path.
> - *"The only way to reach a food record is to scan a barcode"* — still true of
>   the shared `food_items` **catalogue**, and it is the reason "Add custom food"
>   is barcode-only. It is no longer true of finding a food to log: Search
>   merges your own scans, your recipes and your diary.
>
> What has NOT changed, and is the more interesting half: search is scoped to
> `created_by = <the caller>` on purpose, so it answers "what have I eaten"
> rather than searching a shared database. So this section's underlying point —
> that no user can find another user's food by name — survives its verdict.
>
> Full write-up, including the four-tier ranking fix and the moderation gate
> that turned out not to be enforced in the database:
> **`docs/nutrition-food-database-audit.md`**.
>
> Kept in place rather than rewritten, for the same reason this audit keeps its
> own retractions visible: a verdict is a measurement with a timestamp, and the
> next reader needs to see that it expired, not find it quietly gone.

There is no text search over food anywhere in the application.

`foodLookup.js` is a barcode waterfall (community `food_items` → Open Food
Facts by barcode). `foodItems.js` exposes exactly two reads: `findByBarcode`
(equality on `barcode`) and `listRecent` (no filter, documented
"for admin/moderation"). **`listRecent` has zero callers.** A grep for
`.ilike(`, `.textSearch`, `search_terms` and any OFF product-search endpoint
across `foodLookup.js`, `foodItems.js`, all 22 `components/nutrition/` files
and `Nutrition.jsx` returns nothing. The recipe builder, the recipes hub and
the weekly meal planner have no search input either.

**The only way to reach a food record is to scan a barcode.** Nothing was
removed — there is no comment anywhere describing a search that used to
exist. This was never built. **Building it is new product work; I did not
start it.**

That also answers lead 2: `food_items` has 2 rows because it fills only from
a barcode miss, and it is the `equipment_models` shape CLAUDE.md already
documents — an empty-ish catalog that is correct, not broken.

### 4. Macros Display — (b) exists, was broken, now fixed

`MacroNutrientBox` (8 tiles) and `MineralsVitaminsBox` (8 tiles), on a
two-tab switcher at `Nutrition.jsx:1845`.

**CLAUDE.md's macro gate is real but it is somewhere else.** The claim —
"the macro bar is gated on a macro total, so a calorie-only week says so" —
describes `WeeklyDebriefCard.jsx:478`, which does gate on `macroKcal > 0`
and does render "Calories logged without macros this week." That gate is
present and correct. **The Nutrition page has no such gate on either card.**
The only condition around them is `rowId === 'tabs'`, which is layout
ordering. See RESULTS defect 2.

### 5. Calories Display — (a) exists and works

`CalorieTopBar` sums `Number(e.calories) || 0` over the day's entries and
renders remaining/goal with a draining gauge. Water rows carry `calories = 0`
so they contribute nothing — this is **not** a fifth unfiltered consumer.
Verified in the browser on a water-only day: `2,000 left · 0 / 2,000 cal`
with a full bar, which is honest (a full budget, not a zero achievement).
`CalorieCyclingModal` and `CalorieProgressWidget` were read and are consistent.
No defect. **No change made.**

---

## Checks — claim / proof / failure

**1. Do the sixteen nutrient columns the form writes exist?**
*Proof:* `information_schema.columns` for the sixteen names migration 006
declares. *Failure:* any of them present. **All sixteen absent — the query
returns NULL for the whole set.** `workout_logs.duration_minutes` (also 006)
is absent too; only `duration_min` exists, which is the column name behind
the bug `workoutDuration.js` documents. **Migration 006's `nutrition_logs`
and `workout_logs` blocks have never been applied.**

**2. Is the data actually lost, or does the write fail loudly?**
*Proof:* `src/components/nutrition/__tests__/mealWritePath.test.js` drives
the real `create()` against a supabase stub that rejects exactly the columns
production lacks. *Failure:* would be the fields landing, or the insert
throwing. **Ten fields are stripped; the insert then succeeds and returns a
row.** Silent loss with a success toast.

**3. What does that cost at runtime?**
*Proof:* the same test counts insert attempts against a fresh module.
**16 round-trips on the first meal of a browser session** (15 rejections then
one that lands), **1 thereafter** — `db.js`'s `_missingCols` cache is
session-scoped. `db.js:53` names this table as the reason that cache exists,
so the workaround is deliberate and the retry budget (48) is not at risk.

**4. Is anything reading `food_item_id`?**
*Proof:* grep across `src/` → the only hit is the fixture in my own new test.
Plus `pg_proc`: no function mentions it. **Zero readers and zero writers.**
CLAUDE.md lists it as never-written; it is also never-read. Dead weight.

**5. Is anything reading these tables from inside the database?**
*Proof:* `SELECT proname FROM pg_proc WHERE prosrc ILIKE '%nutrition_logs%'`
etc. → **six functions**: `generate_weekly_review_for` and
`get_trophy_progress` (read `nutrition_logs`), `sweep_stale_guest_accounts`,
`admin_purge_user_data` (`food_items`), and the two quota functions.
*Failure:* treating this as client-only. **It is not** — the weekly review
reads these rows, so a dropped nutrient is dropped from the review too.

**6. Is `water_oz` a leftover or a planned column?**
*Proof:* it is declared in migration 006 alongside the fifteen nutrient
columns, and both readers carry comments naming 006 as unapplied. **Planned,
never landed.** See defect 3 for why applying it as written is dangerous.
*Nothing writes it* — `Nutrition.jsx:698` sets `water_oz` only on the
optimistic react-query cache entry, which never reaches PostgREST. So
`db.js` is not silently dropping it on save; this is not the
`duration_minutes` shape after all.

**7. What produced the byte-identical duplicate pair?**
*Proof:* `confirmPhotoMeal` (Nutrition.jsx:955) guards with
`if (saveMutation.isPending) return;` and then **awaits the image upload**
before calling `mutate()`. `isPending` is react-query state and flips on
re-render, so two entries into that window both pass. `addEntry` has the same
check *plus* `LogMealForm`'s synchronous `submittingRef` latch (added by
"Audit 11 #9"); the photo path has no ref guard and has a strictly wider
window. `PhotoMealResultModal`'s button is disabled on the same async
`isPending`. *Failure:* would be a ref guard already present. **Reported, not
fixed — see "What I did NOT do".**

**8. Is the eighth meal (`food_name = 'ck'`, all zeros) a validation hole?**
*Proof:* `addEntry` requires only `newEntry.food_name.trim()` — no minimum
length — and `safeEntry` maps every blank numeric field to `0`
(`v === '' || v == null → 0`). So "ck" plus sixteen untouched inputs is a
valid save that stores calories 0. **This is the same class the Progress
audit fixed in `CardioManualForm` the same day** (`Number('') || 0`
collapsing "unknown" into "zero", commit `8c720cf7`). I read that fix before
writing anything here. **Reported, not fixed — see "What I did NOT do" for
why the cardio remedy does not transfer.**

**9. Is there a fifth consumer of the water encoding that forgot to filter?**
*Proof:* grep for `water_oz` and `'Water'` across `src/`. Four known
consumers filter correctly (Nutrition.jsx:72, HydrationRing.jsx:41,
MealHistoryModal.jsx:178, and LogMealForm.jsx:128, which the brief did not
list). **A fifth exists and it is broken: `HubComposer.jsx:397`.**
*Failure:* would have been all five correct. **Confirmed — see defect 4.**

**10. Is `food_items` readable by every user, as `foodItems.js` claims?**
*Proof:* the policy is `USING (true)` for SELECT `TO public`; write policies
require `auth.uid() IS NOT NULL`. As a real authenticated user via
`SET LOCAL role authenticated` + JWT claims: both rows returned regardless of
who created them. **The head comment is accurate** — not user-scoped on read,
scoped on write.

**11. Does `brand` have a writer?**
*Proof:* grep for `brand:` across `src/` → every hit is gym/equipment
(`GymEquipmentEditor`, `ImplementPicker`, `osmGyms`, `equipment.js`).
`BarcodeResultModal` never sets it. **0-of-N with no writer anywhere**, on
both `nutrition_logs` and `food_items`. Recorded, not changed — adding a
writer is product work.

**12. Do the new empty-state keys exist in all 15 languages?**
*Proof:* they are new, so no. Added English-only via `tFallback` in a new
part file with a `TODO(i18n)` head, and `nutrition.untracked.` added to
`AWAITING_TRANSLATION` — narrow, **not** a bare `nutrition.`, which would
have exempted the whole translated namespace.

---

# RESULTS

## Confirmed defects — three fixed, three reported

| # | Severity | Defect | Status |
|---|---|---|---|
| **1** | **High** | **Ten of the sixteen nutrient fields the Log Meal form collects are silently discarded on save.** Sugar, cholesterol, iron, magnesium, calcium, potassium and vitamins A/C/D/B12 have no column on `nutrition_logs` — migration 006 declares all sixteen and has never been applied — so `db.js`'s strip-and-retry drops them and the insert succeeds. The user fills in a vitamin panel, taps Log Meal, gets "Meal logged", and none of it was stored. Also read by `generate_weekly_review_for`, so the loss propagates into the weekly review. | **Reported** — the fix is a schema decision, see below |
| **2** | **High** | **10 of 16 nutrient tiles rendered a permanent zero.** All eight of `MineralsVitaminsBox`'s tiles, plus sugar and cholesterol on `MacroNutrientBox`, read columns that do not exist, so they drew "0mg · 0%" over a zero-width bar for every user, every day, since launch — not "no data yet" but *structurally unreachable*. CLAUDE.md: a section with no data must not render as zeros. | **FIXED** |
| **3** | **High (latent)** | **Migration 006 is a loaded gun.** It adds `water_oz numeric DEFAULT 0`. Postgres 11+ materialises a non-volatile default onto every existing row, and both water readers treat the column as authoritative via `??` / `!= null` — which stop at 0. Applying it would have made all 118 water rows read **0 oz** instead of 8 or 30, wiping visible hydration history, and `HydrationRing`'s `isWaterEntry` (`water_oz != null`) would additionally have reclassified **every meal row as a water entry**. Both comments in the code say "migration 006 not applied", so someone will eventually apply it. | **FIXED** (defused) |
| **4** | **Medium** | **The Hub composer's "attach a recent meal" list is mostly water.** `HubComposer.jsx:397` filtered on `!(food_name === 'Water' && water_oz > 0)`. `water_oz` does not exist → `undefined > 0` is false → the conjunction is false → the negation is always true → **the filter excluded nothing**. It also never matched the `Water\|N` form. Measured against production: **8 of the 10 rows** offered to the app's most active nutrition user were water. | **FIXED** |
| **5** | **Medium** | **The photo-AI confirm path can double-insert.** `confirmPhotoMeal` checks `saveMutation.isPending` and then awaits the image upload before mutating; `isPending` flips on re-render, so two entries into that window both pass. The manual path has a synchronous ref latch for exactly this reason; the photo path does not. One duplicate pair exists in production, byte-identical `ai_meta`, 530 ms apart. | **Reported, not fixed** |
| **6** | **Low** | **A blank calories field on the manual meal form stores a hard 0**, via `safeEntry`'s `v === '' → 0`. Same class as the `CardioManualForm` defect fixed the same day in `8c720cf7`. The `'ck'` production row is this: a one-character name and sixteen untouched inputs, saved as a real breakfast with zero everything. | **Reported, not fixed** |

### Why defect 1 is reported rather than fixed

There are exactly two remedies and **they point in opposite directions**:

- **(a) Apply migration 006's `nutrition_logs` block.** The form, both display
  cards and the whole vitamin panel start working as designed. This is a
  schema change to a live table, and until today it also carried defect 3.
- **(b) Remove the ten inputs from the form.** Deletes a documented feature
  and the entire Vitamins & Minerals tab.

That is a product decision, not a bug fix, and CLAUDE.md is explicit that a
schema change of this size wants your sign-off. **I did neither.** What I did
do is make (a) *safe* (defect 3) and make the current state *honest*
(defect 2) — the display fix is correct under both futures: if 006 lands, the
tiles return on their own with no further code change, which is pinned by a
test.

The idempotent SQL for (a) is at the foot of this document.

## What changed

- **`MacroNutrientBox.jsx`** — a tile renders only when its nutrient has a
  value; the card says so plainly when none do. Sugar now falls back to
  `ai_meta.sugar_g`, which the photo path stores and this card was throwing
  away (`openMealDetail` already resolved it that way). Net carbs is gated
  the same way rather than printing a permanent "0.0 g".
- **`MineralsVitaminsBox.jsx`** — same gate. With 006 unapplied that means
  the card always states that these are not being recorded, which is the
  honest answer and is reversible the day the columns exist.
- Both grids moved from `grid-cols-2 md:grid-cols-4` to **`tileRow()`**,
  because gating made the tile count data-driven — the exact condition
  `src/lib/tileRows.js` exists for. New literal `'3-2-4'` added there, and
  the manifest test updated.
- **`HubComposer.jsx`** — the water predicate now matches the four correct
  consumers, and handles `Water|N`.
- **`006_data_integrity.sql`** — `water_oz` loses its `DEFAULT 0`, with the
  full reasoning in place so it cannot be re-added casually.
- **`CLAUDE.md`** — both stale numbers corrected.

## New test coverage

`src/components/nutrition/__tests__/` did not exist. **30 tests, 3 new files.**

- `mealWritePath.test.js` (16) — drives the real `create()` against a stub
  that rejects exactly the columns production lacks. Proves the five aliases
  survive under old names, that ten fields are lost, that exactly ten are
  lost, and the round-trip cost. **The ten-field block is labelled
  CHARACTERIZATION: it asserts the bug on purpose. Invert those if migration
  006 lands — do not delete them.**
- `nutrientDisplayGating.test.jsx` (9) — the display fix against real
  production shapes, including the water-only day. One test is
  forward-looking: it proves a tile returns the moment its nutrient has a
  value, so the fix needs no revisiting when the schema catches up.
- `composerWaterFilter.test.js` (5) — pins the corrected predicate, keeps the
  old one alongside so the regression stays visible, and guards "Watermelon
  salad" against an over-eager prefix match.

**Verified not vacuous:** reverting `MacroNutrientBox` and
`MineralsVitaminsBox` to their committed versions makes **all 9** display
tests fail; restoring makes all 9 pass.

## Browser render

jsdom paints nothing, so every figure was read in a real browser through a
stub-alias harness (recipe below), at 390px in the dark theme.

| Fixture | Rendered |
|---|---|
| **none** (0 entries) | both cards state they have nothing; no zeros |
| **water** (the real shape of most days) | `2,000 left · 0 / 2,000 cal`, full gauge; both cards honest |
| **ck** (the zero-everything meal) | identical to water — the meal contributes nothing and claims nothing |
| **prod** (2026-08-11: 2 photo dinners + water) | `1,200 left · 800 / 2,000 cal`; 7 macro tiles; **Sugar 7.0g** recovered from `ai_meta`; cholesterol tile absent; net carbs 140.0 g |
| **micros** (what 006 would unlock) | all 8 macro tiles incl. cholesterol, and 6 vitamin tiles — D and B12 are zero in the fixture and correctly stay hidden |

**No `0`, `—`, `NaN`, `Infinity` or `$NaN` renders in any fixture.** The
`micros` row is the one that matters most: it is the proof that the display
fix does not have to be undone when the schema lands.

## Checks that PASSED

Ground truth verbatim, including the per-`meal_type` split · the water
encoding is correctly handled in all four documented consumers · the photo-AI
quota is enforced server-side with a refund path · `recognize-meal` is
deployed, ACTIVE v11, `verify_jwt: false` as required · `food_items` read is
genuinely unscoped and write is scoped, as its head comment claims ·
`CalorieTopBar` arithmetic is correct and honest on an empty day ·
`WeeklyDebriefCard`'s macro gate exists and works · `MacroRingWidget` reads
the columns that actually exist and says so in a comment · the first-meal
celebration correctly excludes water via `not('food_name','like','Water%')` ·
`LogMealForm`'s history tab de-dupes and excludes water correctly ·
`addEntry`'s return-false contract still releases the form's latch · lint
clean · build clean · **4479 tests across 322 files**.

## What I did NOT do

- **Did not apply migration 006 or remove the ten form inputs.** Defect 1 —
  opposite remedies, both product decisions. **This needs your call.**
- ~~**Did not build Search Food Database.** It has never existed. Building it
  is new product work, not a fix.~~ **Obsolete — it was built later the same
  day in `6a7929ff`.** See the amendment in section 3 and
  `docs/nutrition-food-database-audit.md`.
- **Did not fix the photo-path double-insert (defect 5).** The fix is a
  synchronous ref latch mirroring `LogMealForm`'s, but it belongs in
  `PhotoMealResultModal`/`confirmPhotoMeal` and wants a test that drives the
  real modal — which needs the camera flow stubbed. One duplicate pair in
  three months of use put it below the three I did fix. Left as a clean
  next task with the mechanism documented in check 7.
- **Did not fix the blank-calories zero (defect 6).** The cardio remedy does
  not transfer: `CardioManualForm` could *estimate* from duration, distance
  and weight, and a meal name gives nothing to estimate from. Storing NULL
  instead of 0 is the honest alternative and every current consumer already
  tolerates it (`Number(e.calories) || 0`), but it changes what a saved row
  means and is worth doing deliberately rather than as an audit side-effect.
  The display fix already stops such a row rendering as "0cal".
- **Did not extract a shared `isWaterEntry` helper.** Five consumers now
  duplicate the predicate and the fifth is exactly how defect 4 happened. The
  other four are correct, and rewriting working hydration code across
  `Nutrition.jsx`, `HydrationRing`, `MealHistoryModal` and `LogMealForm` is
  more risk than the audit warrants. **Recommended as a small follow-up.**
- **Did not delete `food_item_id` or add a `brand` writer.** One is dead
  weight with no reader (check 4), the other is a missing feature (check 11).
  Both are recorded, neither is a bug I can fix without a product decision.
- **Did not touch `InsightsTab`, the Body tab, or the Progress stats
  dashboard.** All three were audited on 2026-08-11 by parallel sessions; the
  TDEE estimate my Calories work brushed against belongs to audit 21.
- **Did not run an authenticated end-to-end round trip.** Same limit the
  three previous audits hit — it needs a real sign-in. The write path is now
  covered by unit tests against a schema-accurate stub and the render by the
  harness; what remains unproven is form → PostgREST → card refresh live.

## A red test on `main` that was not mine — and was fixed while I wrote this

`src/components/__tests__/cardioPlannedScreen.test.jsx` → *"goes through
schedule_workout with a date, an hour and a cardio payload"* failed with
`expected "vi.fn()" to be called 1 times, but got 0 times` throughout this
audit. I ruled it out as mine by running that one file in a clean throwaway
worktree at `origin/main` with none of my changes: it failed there
identically, and in isolation, so it was neither a load flake nor a
collision with my work.

**It is fixed on `main` as of `24b34eaf`** ("Cardio audit: cross-user row
injection, and a test that fails after 8pm") — a parallel session landed the
fix while this audit was being written, and it passes after rebasing onto
that commit. Recorded rather than deleted because the method is the reusable
part: when the suite is red, prove ownership in a pristine worktree before
either fixing it or claiming it is someone else's.

## The thing that outranks every defect above

**This feature is backed by eight meals.** Four users, 88 days, and 118 of the
126 rows are glasses of water. Seven of the eight meals carry calories; the
eighth is `'ck'`.

So the honest reading of most of these numbers is *unexercised*, and I have
said so where that is the answer — `food_items` at 2 rows is correct, not
broken; `brand` at 0 is a missing feature, not a dead column; three AI meals
without images is a feature that started working, not one that fails.

**But defects 1 through 4 are not that.** They are not waiting on usage:
every one of them is unconditionally true right now, for every user, on every
render. Ten form fields cannot be saved regardless of who types in them. Ten
tiles cannot show a non-zero number regardless of what anyone eats. The Hub
composer's filter excludes nothing regardless of how much water is logged.
None of them would ever surface as an error, none failed a test, and the
suite was green through all of it.

**The most valuable finding is the one that has not happened yet:** migration
006 sits in the repo, is referenced by name in four code comments as the
reason for the current workarounds, and would have zeroed every glass of
water anyone has logged the moment someone applied it. It was one word.

---

## Recommendation — migration 006 (needs a decision)

**Not applied.** With `DEFAULT 0` removed it is now safe to run, and it is the
real fix for defect 1. It is idempotent (`ADD COLUMN IF NOT EXISTS` plus
guarded back-fills), so it can be run at any time.

Run **only the `nutrition_logs` block** — the file's other sections touch
`workout_logs` (`duration_minutes`, which is the wrong column name and must
stay unapplied), `user_profiles` and the `increment_user_xp` RPC, which has
been redefined many times since and must not be reverted from a 006-era
template. That is exactly the "read the installed artefact" trap.

```sql
ALTER TABLE public.nutrition_logs
  ADD COLUMN IF NOT EXISTS protein_g       numeric,
  ADD COLUMN IF NOT EXISTS carbs_g         numeric,
  ADD COLUMN IF NOT EXISTS fat_g           numeric,
  ADD COLUMN IF NOT EXISTS fiber_g         numeric,
  ADD COLUMN IF NOT EXISTS sodium_mg       numeric,
  ADD COLUMN IF NOT EXISTS sugar_g         numeric,
  ADD COLUMN IF NOT EXISTS cholesterol_mg  numeric,
  ADD COLUMN IF NOT EXISTS iron_mg         numeric,
  ADD COLUMN IF NOT EXISTS magnesium_mg    numeric,
  ADD COLUMN IF NOT EXISTS calcium_mg      numeric,
  ADD COLUMN IF NOT EXISTS potassium_mg    numeric,
  ADD COLUMN IF NOT EXISTS vitamin_a_iu    numeric,
  ADD COLUMN IF NOT EXISTS vitamin_c_mg    numeric,
  ADD COLUMN IF NOT EXISTS vitamin_d_iu    numeric,
  ADD COLUMN IF NOT EXISTS vitamin_b12_mcg numeric,
  ADD COLUMN IF NOT EXISTS water_oz        numeric;
```

**`water_oz` must carry no default** — see defect 3. After applying, the
`_g`/`_mg` aliases start landing as real columns; every reader already does
`entry.protein_g ?? entry.protein`, so old rows keep resolving through the
un-suffixed column and nothing needs back-filling for correctness.

## Reproducing the SQL

Every production figure came from `execute_sql` as `postgres`. Row counts and
column-presence checks do not need RLS. The `food_items` read/write boundary
(check 10) was tested as a real authenticated user with
`SET LOCAL role authenticated; SET LOCAL request.jwt.claims = '…'` in a
single call with the `SELECT` last, per the one-probe-per-call rule.

The query that settles the whole audit — the columns the form writes against
the columns that exist:

```sql
SELECT string_agg(column_name, ', ' ORDER BY column_name) AS mig006_present
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'nutrition_logs'
  AND column_name IN ('protein_g','carbs_g','fat_g','fiber_g','sodium_mg',
    'sugar_g','cholesterol_mg','iron_mg','magnesium_mg','calcium_mg',
    'potassium_mg','vitamin_a_iu','vitamin_c_mg','vitamin_d_iu',
    'vitamin_b12_mcg','water_oz');
-- returns NULL: none of the sixteen exist.
```

And the one that proves defect 3 without touching a real table:

```sql
CREATE TEMP TABLE t_water AS
  SELECT id, food_name FROM public.nutrition_logs WHERE food_name LIKE 'Water%' LIMIT 5;
ALTER TABLE t_water ADD COLUMN water_oz numeric DEFAULT 0;
SELECT food_name, water_oz FROM t_water;   -- 'Water|30' reads 0, not NULL
```

## Reproducing the render harness

Deliberately **not committed** — throwaway scaffolding.

- `harness.html` at root with `class="dark"` on `<html>`, mounting
  `/src/harness.jsx`
- `src/harness.jsx` mounting `CalorieTopBar`, `MacroNutrientBox` and
  `MineralsVitaminsBox` inside `QueryClientProvider` + `LanguageProvider` +
  `SettingsProvider`, fixture from `?fx=none|water|one|prod|ck|micros`.
  **Both providers are required** — without `LanguageProvider` every card
  throws `useLanguage must be used within a LanguageProvider` and the
  harness renders an empty body that looks like a mounting failure.
- `vite.harness.config.js` aliasing `@/api/db`, `@/api/supabaseClient`,
  `@/lib/AuthContext`, `@/lib/WeightUnitContext` to one stub module, plus
  `optimizeDeps.entries: ['harness.html']` — without it the dep scan walks
  `index.html` → `App.jsx` → `virtual:pwa-register` and the server dies.
- `npx vite --config vite.harness.config.js --port 5241 --strictPort`.
  **Not 5199** — a parallel session holds it and its SPA fallback returns 200
  for any path. Confirm with
  `curl -s localhost:5241/harness.html | grep -c src/harness.jsx`.
- `preview_start({url})` opens it; `preview_start` alone only ever serves
  `~/flexyn2`. Read numbers with `get_page_text`, not a screenshot.
