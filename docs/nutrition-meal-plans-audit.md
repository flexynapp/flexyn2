# Audit — Nutrition, Meal Plans

Run 2026-08-11 against `origin/main` @ `361b742a` and production
(`ebvqxuwfiptcmlkhflfj`). Four sub-features were named in the brief:
View Assigned Plan, Meal Suggestions, Swap Meals, Mark Completed.

**Not one of the four exists as named.** Three are absent or unwired; the
fourth is a browse surface described as an assignment. Meanwhile the code
around them — the weekly planner grid — has a defect nobody could see,
because the grid has never once been used.

| # | Sub-feature | Verdict | |
|---|---|---|---|
| 1 | View Assigned Plan | **(c) partially wired** | every template is offered; **nothing is ever assigned or saved** |
| 2 | Meal Suggestions | **(d) absent** | no meal-suggestion surface exists anywhere |
| 3 | Swap Meals | **(d) absent as named** | the *ingredient* substitution engine is excellent and automatic; the user never chooses |
| 4 | Mark Completed | **(c) partially wired** | `markCompleted` is correct and has **zero callers**; two readers depend on a flag nothing can set |

**The finding that outranks the four:** the weekly meal-planner grid has
**never created a single row.** All 8 `meal_plans` rows are side effects of
logging a photo meal on the Nutrition page. Three code changes shipped; the
defects they fix were invisible because the only writer that has ever run is
not the one anybody was looking at.

---

## Ground truth — re-verified line by line

The brief's block was re-measured before any of it was used. **It held
exactly**, including the 0-of-8 columns and the dinner/snack restriction.

| Claim | Verified |
|---|---|
| 8 rows, ONE user, 2026-07-16 → 2026-08-11 | ✅ exact |
| `is_completed` true 0 of 8 (all 8 non-null, all false) | ✅ exact |
| `recipe_id` 0 of 8 · `food_snapshot` 8 of 8 · `notes` 0 of 8 | ✅ exact |
| `meal_type` only `dinner` and `snack` | ✅ exact |
| RLS: owner read + owner write, no public read | ✅ exact |
| `nutrition_recipes`: 1 row, `is_public=false`, 1 ingredient | ✅ exact |
| **Zero** DB functions read `meal_plans` or `nutrition_recipes` | ✅ **re-run, still zero** |
| `markCompleted` has zero callers | ✅ exact — see check 1 |

`pg_proc` was re-grepped rather than inherited, per the brief. The result is
still empty: unlike `nutrition_logs` (six server-side consumers), these two
tables really are client-only. There is no server-side reader to have missed.

### Four things the block did not contain

1. **Only 2 distinct `(user_id, plan_date, meal_type)` slots exist** across
   the 8 rows. One slot holds **six**. Six of the eight rows are unreachable
   in the UI. See defect 1.
2. **3 of 8 rows are orphans** — their `food_snapshot->>'log_id'` points at a
   `nutrition_logs` row that no longer exists. See defect 3.
3. **All 8 snapshots carry 14 identical keys**, including `log_id`, `items`,
   `confidence` and `source: 'photo_ai'`. None carries `ingredients`.
4. **`nutrition_logs.notes` is 0 of 126 and `meal_plans.notes` is 0 of 8**, so
   `syncPlannerDiaryLog` has never executed. It is not unwired — it has
   callers — it has never been *reached*. See check 4.

---

## Rule Zero — does each sub-feature exist?

### 1. View Assigned Plan — (c), and the name is wrong

`NutritionPlansPanel` (in `NutritionPlansModal.jsx`, also mounted as the
"Nutritional Plans" tab of the weekly planner) maps over **every** entry in
`PLAN_TEMPLATES`, adapts each to the user's restrictions, scales it to their
calorie target, and sorts by goal fit. Tapping one sets `selected`, which is
`useState(null)` — **component state, discarded on unmount.**

*Claim:* a plan can be assigned to a user and read back.
*Proof:* grep across `src/` and `supabase/migrations/` for
`selected_plan|active_plan|assigned_plan|current_plan|nutrition_plan`, plus a
scan for a `flexyn.*` localStorage key in the nutrition components.
*Failure:* any hit.
**Result: zero hits in either place.** There is no column, no localStorage
key, no profile field, and no write of any kind. Nothing is ever assigned.

The AI Coach was checked too, since a prescription would live elsewhere:
`nutritionTip` (`responders.js:517`) returns a **static string** — three
generic bullets, identical for every user, naming no meal. It does not
prescribe a plan.

So this is a **browse** surface, and a good one. Calling it "View Assigned
Plan" describes a feature that does not exist. **Nothing was changed.**

### 2. Meal Suggestions — (d) ABSENT

*Claim:* something suggests meals to the user.
*Proof:* grep for `suggest` across all of `src/components/nutrition/`,
`src/lib/nutritionPlans.js` and `src/lib/aiCoach/`.
*Failure:* a surface that names a meal to eat.
**Result: none exists.** The only nutrition hits are
`NutritionOnboardingModal`'s target-date helper, and the Coach's
`NUTRITION_TIP` intent, whose responder is the static string above. The
`Sparkles` icon in `NutritionPlansModal` is the swap-count badge
("adapted for you"), not a suggestion.

`fuelNote()` in `trainingModifiers.js` *does* name a food and *is* correctly
allergen-filtered (CLAUDE.md's rule holds — verified, its tests pass), but it
is a fuelling note on the workout card, not a meal suggestion, and it is not
on the Nutrition page.

**This has never been built. I did not start it — that is new product work.**

### 3. Swap Meals — (d) absent as named; the engine underneath is excellent

`adaptPlan()` → `adaptIngredient()` substitutes ingredients that violate a
dietary restriction or allergen, tags them `swapped` / `swappedFrom`, and
surfaces a `swapCount` badge. `MealRow` renders "swapped from X" per
ingredient; `adaptSupplement` does the same for supplements.

*Claim:* a user can choose to swap a meal.
*Proof:* read every handler in `NutritionPlansModal.jsx` and
`WeeklyMealPlannerModal.jsx`; grep for a swap callback.
*Failure:* any user-initiated swap control.
**Result: none.** Every substitution is automatic and restriction-driven.
The user never picks. The `ArrowLeftRight` icon is a label on a completed
swap, not a button.

Its test file (`src/lib/__tests__/nutritionPlans.test.js`) was read **first**,
per the brief, and it is the best-tested code in the nutrition area — it
locks in that no surviving ingredient violates any restriction, including
stacked combinations and the soy-allergic-vegan case where the obvious swap
reintroduces the allergen. **I changed nothing here and recommend nobody
does without reading that file.**

### 4. Mark Completed — (c) partially wired, and it is the load-bearing one

`markCompleted(id, isCompleted)` at `mealPlans.js:53` is correct code.

*Claim:* something calls it.
*Proof:* `grep -rn "markCompleted" src/` and `grep -rn "is_completed" src/`.
*Failure:* a caller, or a second write path.
**Result: `markCompleted` appears exactly once — its own definition.**
`is_completed` appears exactly four times: the reader at
`WeeklyMealPlannerModal.jsx:356`, the writer at `mealPlans.js:57`, the
grocery-list filter at `mealPlans.js:74`, and a test fixture. There is **no
inline supabase update** in the planner, and **no comment anywhere**
describing a control that was removed. It was never wired.

Confirmed against production from the other direction: `is_completed` is
`false` on all 8 rows and `true` on none — a 0-of-8 with a writer that
exists and has never been called. That is the fourth shape in CLAUDE.md's
taxonomy, and this is a clean example of it.

**Consequences, both live right now:** the grocery list's "skip completed
plans" branch has never executed, and the planner's uncompleted-plan count is
just a plan count wearing a filter. See defect 2 — that filter being
permanently inert is *half* of why the CTA lied.

---

## Checks — claim / proof / failure

**1. Does the weekly planner grid create rows at all?**
*Claim:* the 8 rows came from the planner UI.
*Proof:* the three writers produce **structurally different snapshots**.
The planner's photo path (`WeeklyMealPlannerModal.jsx:498`) writes 6 keys
and no `log_id`; its manual path writes a name plus 16 nutrient keys
including `vitamin_b12_mcg`; the Nutrition-page mirror
(`Nutrition.jsx:1016` → `:716`) writes exactly 14 keys — `name`, 7 macros,
`image_url`, `portion_estimate`, `confidence`, `items`, `source`, plus
`log_id` added in `onSuccess`. One SQL query separates them.
*Failure:* any row with 6 keys, or any row carrying `vitamin_b12_mcg`.

```
plans 8 | log_id set 8 | items 8 | confidence 8 | source='photo_ai' 8
        | ingredients 0 | vitamin_b12_mcg 0 | distinct key-counts 1
```

**All 8 rows are the mirror's 14-key shape. Zero came from the planner.**
Corroborated independently: every `meal_plans.created_at` lands
**120–192 ms after** its `nutrition_logs` row.

**The weekly meal planner has never been used.** `recipe_id` being 0-of-8
follows automatically — the mirror only ever writes `food_snapshot`.

**2. Is `meal_type` restricted to dinner+snack by the UI, or by usage?**
*Claim:* the planner cannot create breakfast or lunch.
*Proof:* read `MEAL_SLOTS`, and compare plan `meal_type` to the source log's.
*Failure:* fewer than four slots in the grid.
**Result: the grid offers all four** (breakfast/lunch/dinner/snack), and
every plan's `meal_type` **equals the `meal_type` of the diary row it
mirrors.** So the restriction is not the planner's — it is which meal type
the user happened to pick when logging a photo. Nobody has planned a
breakfast; nothing stops them. Lead 4 resolves to "nobody has", not "cannot".

**3. Does one slot hold more than one plan?**
*Claim:* `upsert` replaces the plan in a slot.
*Proof:* `upsert(row, { onConflict: 'id' })` is called with **no `id`** on
every fresh save. Postgres generates one, nothing conflicts, and the upsert
INSERTs. Confirmed against the schema: `meal_plans` has a PK on `id` and a
**non-unique** index on `(user_id, plan_date)` — no uniqueness on the slot.
*Failure:* a unique constraint, or one row per slot.
**Result: 8 rows, 2 slots, worst slot holds 6.** See defect 1.

**4. Has `syncPlannerDiaryLog` ever run?**
*Claim:* it is unwired (the brief's open question).
*Proof:* grep for callers; then check whether the precondition ever held.
*Failure:* zero callers would make it (c).
**Result: it HAS callers** — `logToDiaryIfToday`
(`WeeklyMealPlannerModal.jsx:523`), reached from the planner's photo and
manual save paths. But it early-returns unless `planDate === today`, and
both entry points are in the planner, **which check 1 proves has never
created a row.** So: `nutrition_logs.notes` is 0 of 126 and
`meal_plans.notes` is 0 of 8.

**This is CLAUDE.md's third shape — the writer exists, is correct, and has
never been REACHED** — not the fourth shape (`markCompleted`, which has no
caller at all). The two look identical in the data and need opposite fixes:
`markCompleted` needs a caller, `syncPlannerDiaryLog` needs nothing.
Nothing to build.

**5. What does `buildGroceryList` do with the real 8-row shape?**
*Claim:* the CTA's count matches what the sheet renders.
*Proof:* `buildGroceryList` takes ingredients from `recipe.ingredients` or
`food_snapshot.ingredients`. **0 of 8 production snapshots carry an
`ingredients` key**, and neither the photo nor the manual planner path
writes one — both store macros.
*Failure:* any production row producing an item.
**Result: the list is empty for every row that exists**, while the CTA
counted 8. See defect 2.

**6. Does `nutrition_recipes`' "public read" policy actually scope on the flag?**
*Claim (from the brief):* a public-read policy that ignores `is_public`
would expose every private recipe.
*Proof:* tested as a **real authenticated user** — `SET LOCAL role
authenticated` + `request.jwt.claims`, with all uuids resolved *before*
dropping privileges.
*Failure:* a third party reading the private recipe.

| Probe | Result |
|---|---|
| third party reads the private recipe | **0 rows** ✅ |
| third party reads owner's `meal_plans` | **0 rows** ✅ |
| flip `is_public=true`, third party reads | **1 row** ✅ (correct) |
| third party UPDATEs a *public* recipe | **0 rows changed** ✅ |
| third party marks another's plan completed | **0 rows changed** ✅ |

The policy is `USING (is_public = true)` `TO authenticated` — it scopes
correctly, and `anon` has no grant. **Not a leak.** `is_public` seeded and
restored to `false` in the same call; verified.

**A false positive worth recording.** The first run of this probe reported
"third party sees 8 meal_plans", which reads exactly like a broken policy.
It was not: I had resolved "another user" relative to the *recipe* owner,
and that user is the *meal_plans* owner. RLS is enabled on both tables
(`relrowsecurity = true`). **Check who the row actually belongs to before
believing a leak** — the shape of the wrong answer and the shape of a real
finding are identical.

**7. Does the photo-path double-insert also produce a duplicate PLAN?**
*Claim (inherited from the meal-logging audit):* `confirmPhotoMeal` can
double-insert; one byte-identical `nutrition_logs` pair exists in production.
*Proof:* those two log ids both appear as `log_id` on **two separate plan
rows**, same date, same `meal_type`, same food name.
**Result: yes.** But the duplicate-insert bug is not the main cause here —
check 3 shows *every* re-log of an occupied slot appends a row, whether or
not it was a double-submit. Fixing the double-insert would not have fixed
this.

**8. Do the existing tests cover the shape production actually has?**
*Claim:* `mealPlans.test.js` covers `buildGroceryList`.
*Proof:* read its seven cases.
*Failure:* all fixtures using a path production has never taken.
**Result: exactly that.** Six of seven use `recipe_id` (0 of 8 in
production); the seventh uses a `food_snapshot` carrying `ingredients`
(0 of 8). Every test is green against a shape that has never existed, and
none against the shape that does. Not wrong — incomplete in the direction
that hid defect 2. Fixed by the new file.

---

# RESULTS

## Confirmed defects — three fixed, three reported

| # | Severity | Defect | Status |
|---|---|---|---|
| **1** | **High** | **Six of the eight plan rows in production are unreachable.** `upsert` passes `onConflict: 'id'` but sends no `id` on a fresh save, so it always INSERTs; there is no uniqueness on `(user_id, plan_date, meal_type)`. The grid builds its cell map with `m.set(key, p)` — last write wins — so re-logging a photo meal into an occupied slot silently buries the previous row. Production: 8 rows, 2 slots, one slot holding 6. The buried rows still counted toward the grocery CTA and were still walked by `buildGroceryList`. | **FIXED** (client) + SQL below |
| **2** | **High** | **The grocery-list CTA promised meals it could not deliver.** It counted `!is_completed` plans; the list only yields items from plans carrying ingredients, and **no Photo-AI or manual plan ever carries any**. On production's data the button read "Generate grocery list · N meals" and opened a sheet reading "Nothing to buy yet." The code comment above it claimed the opposite — *"the button never promises a list bigger than what it will actually produce"*. Compounded by defect 4: the `is_completed` filter it relied on can never be true. | **FIXED** |
| **3** | **Medium** | **Deleting a diary entry orphans its mirrored plan.** `deleteMutation` (`Nutrition.jsx:833`) removes the `nutrition_logs` row and nothing else; the mirrored `meal_plans` row keeps a `log_id` pointing at a row that no longer exists, and the meal stays on the planner grid. **3 of 8 production rows are already in this state.** The reverse direction is handled — deleting the *plan* un-logs the diary row — so only this half is missing. | **Reported, not fixed** |
| **4** | **Medium** | **`markCompleted` has zero callers**, so `is_completed` can never become true. Two readers depend on it: the planner's uncompleted count and `buildGroceryList`'s skip. The grocery list therefore includes every planned meal forever, and "uncompleted plans" is a synonym for "plans". | **Reported** — wiring it needs a design, see below |
| **5** | **Medium** | **Every date in the planner was locale-blind.** The grid's weekday and day-of-month, and the week-range header, all went through date-fns `format()`, which binds no locale — so `MON 10` / `Aug 10 – Aug 16, 2026` rendered in English under all 15 languages. CLAUDE.md names this exact defect class. | **FIXED** |
| **6** | **Low** | **The whole planner modal is hardcoded English** — roughly 30 user-visible strings ("Weekly Plan & Plans", the four meal-slot labels, "Pick a recipe", the grocery sheet, plus a native `confirm('Remove this meal?')`) with no `t()` / `tFallback()` anywhere. | **Reported** — see "What I did NOT do" |

### Why defect 4 is reported rather than fixed

Wiring `markCompleted` means **designing a control** — where the checkbox
lives on a 58px cell, what a completed cell looks like, whether completing
also logs to the diary. Kegan composes Flexyn UI in Penpot precisely so this
does not get invented by an agent. The data layer is ready and correct; the
missing piece is a design, not code.

One thing to know before it is wired: with all plans completed the CTA
currently reads **"Plan a meal to build a grocery list"** while seven meals
are visibly on the grid (verified in the harness). That branch is unreachable
today and becomes wrong the moment completion works.

## What changed

- **`src/lib/data/mealPlans.js`**
  - `findSlot(userId, planDate, mealType)` — new. Resolves the plan already
    occupying a slot, newest-first.
  - `upsert()` now resolves the slot's existing id before writing, so
    `onConflict: 'id'` actually matches. **Deliberately client-side**: it works
    whether or not the SQL below has been run, which matters because the
    frontend auto-deploys from `main` and the SQL is pasted by hand.
  - `planIngredients(plan, recipesById)` / `shoppablePlans(plans, …)` — new,
    and `buildGroceryList` now routes through the first. One predicate decides
    what a plan contributes, so the CTA's number and the list cannot drift.
    That drift is exactly how the meal-logging audit's defect 4 happened with
    the water filter.
- **`src/components/nutrition/WeeklyMealPlannerModal.jsx`**
  - The CTA counts `shoppableCount`, not `plannedCount`, and has a third
    state: plans exist but none can produce a list → *"Add a recipe to build
    a grocery list"*, disabled.
  - Four display dates moved to `useDateFormatter()` from `src/lib/intl.js`.
    `isoDay()` deliberately stays on date-fns with a comment saying why — it
    is the `plan_date` column and the cell key, so it must not move with the
    locale.

## New test coverage

**20 tests, 2 new files.** `src/components/nutrition/__tests__/` already
existed (3 files from the meal-logging audit) — extended, not duplicated.

- `src/lib/data/__tests__/mealPlansSlot.test.js` (14) — the slot resolution
  and the grocery predicate, driven against a table-keyed supabase stub.
  Fixtures are the **real 14-key photo-AI snapshot**, not an invented one.
- `src/components/nutrition/__tests__/weeklyMealPlanner.test.jsx` (6) — the
  **first test file for the 919-line planner**, the largest component in the
  area. Covers the CTA's three states and the Spanish date regression.

**Verified not vacuous.** Reverting the `findSlot` resolution fails 4 of the
14 data-layer tests; reverting the CTA and date changes fails 3 of the 6
component tests. The invariant tests pass in both directions.

Suite: **4572 tests across 331 files**, from 4552 / 329.

## Browser render

jsdom paints nothing, so every figure below was read in a real browser
through a stub-alias harness at 390px, dark theme (recipe at the foot).

| Fixture | Rendered |
|---|---|
| **none** | "Plan a meal to build a grocery list", disabled. No zeros. |
| **prod** (the real 8 rows) | **8 rows → 2 filled cells.** Six invisible. CTA "Add a recipe to build a grocery list", disabled. |
| **full** (28 photo meals) | 28/28 cells filled; CTA still correctly disabled. Before the fix: "Generate grocery list · 28 meals" → 0 items. |
| **completed** (all 7 completed) | 7 cells filled, CTA "Plan a meal…" — the copy defect noted under defect 4. |
| **recipes** (the path never taken in production) | CTA "Generate grocery list · **3** meals" for 4 plans — the photo plan correctly excluded. Sheet: 4 items, Chicken Breast **400g** (2 × 200), Milk 250g, Oats 60g, Rice 300g. Arithmetic correct. |

No `NaN`, `Infinity` or `undefined` renders in any fixture.

## Checks that PASSED

Ground truth verbatim, every line · `pg_proc` re-grepped, still zero
server-side consumers · RLS on `meal_plans` and `nutrition_recipes` correct
under a real authenticated third party, including the `is_public` scope and
a write attempt · the ingredient-swap engine and its restriction invariants
(untouched) · `fuelNote`'s allergen filter · the nutrition-onboarding gate
correctly reads the completion flag only · `buildGroceryList`'s arithmetic
and case-insensitive dedupe · the plan list's goal-fit ordering · lint clean
· build clean.

## What I did NOT do

- **Did not wire a Mark Completed control.** Defect 4 — it needs a Penpot
  design, not an invented one. The data layer is ready.
- **Did not build Meal Suggestions.** It has never existed; that is new
  product work and the brief says to ask first. **This needs your call.**
- **Did not touch the ingredient-swap engine.** It is correct, thoroughly
  tested, and the sub-feature named in the brief ("Swap Meals") is a
  different thing that does not exist.
- **Did not add plan assignment.** Same reason — "View Assigned Plan"
  describes a feature nobody has built. **Needs your call on whether it
  should exist.**
- **Did not fix the orphaned plans (defect 3).** The fix is a cleanup in
  `Nutrition.jsx`'s `deleteMutation` keyed on `food_snapshot->>'log_id'`,
  which is a PostgREST JSONB filter I could not verify end-to-end without a
  live authenticated round trip. Reporting a mechanism I have not run beats
  shipping one. The 3 existing orphans are in the cleanup SQL below.
- **Did not convert the planner to i18n (defect 6).** ~30 strings across a
  919-line file, and CLAUDE.md forbids machine-translating them. Adding one
  `tFallback` among 30 hardcoded strings is worse than either extreme. The
  dates were fixed because that is a *functional* locale bug, not a
  translation. **Recommended as its own task.**
- **Did not delete the 6 duplicate production rows.** That is data loss and
  it is your call — SQL below.
- **Did not re-report anything settled by the 2026-08-11 meal-logging audit**
  (the water encoding, migration 006's ten discarded nutrients, the
  `water_oz DEFAULT 0` defusal, the macro/vitamin display fix, migration 343).
  The planner's manual entry form collects the same 16 nutrients into a
  JSONB snapshot, so it is unaffected by 006 — but `syncPlannerDiaryLog`
  writes all 16 to `nutrition_logs`, so if the planner is ever used, ten of
  them will be silently dropped by that audit's defect 1. Inherited, not
  re-derived.

## The thing that outranks every defect above

**This feature is backed by eight rows from one user, and the surface it was
built for has never been opened.** The planner grid, the recipe picker, the
manual entry form, the diary mirror, the grocery list's recipe path — none of
it has ever run. The 8 rows exist because a different page writes into this
table as a side effect.

So most numbers here are *unexercised*, and I have said so where that is the
answer: `recipe_id` at 0-of-8 is not a broken join, it is a join nobody has
reached; dinner-and-snack-only is not a UI limit; `syncPlannerDiaryLog` needs
nothing built.

**But defects 1, 2 and 5 are not that.** They are unconditionally true right
now. Every re-log of a meal slot buries a row. The grocery button
miscounted on every render for every user. Every date rendered in English on
a fifteen-language app. None would ever surface as an error, none failed a
test, and the suite was green through all of it — 4552 tests, and the one
component holding the defects had no test file at all.

**And the most valuable finding is a number that is confidently wrong at a
scale nobody has reached.** With 8 rows in 2 slots the buried-row defect
costs almost nothing. The first person who actually plans a week — 28 slots,
edited a few times each — would have found a grid quietly accumulating dead
rows, a grocery list built from meals they had replaced, and a button
counting all of them.

---

## SQL — APPLIED 2026-08-11, verified

Kegan ran the bundle below. Confirmed against production afterwards:

| Check | Result |
|---|---|
| rows / distinct slots | **2 / 2** — was 8 / 2 |
| `meal_plans_user_date_slot_uniq` present | **yes** |
| duplicate-slot INSERT (the exact old behaviour) | **rejected, `unique_violation`** |
| INSERT into a genuinely free slot (same day, breakfast) | **accepted** — not over-strict |
| orphaned plans remaining | **0** — was 3 |
| probe rows left behind | **0** |

Two outcomes worth recording. **The dedupe cleared all three orphans as a
side effect**, because in both slots the newest row happened to be one whose
diary log still exists — luck, not design, so defect 3's underlying cause is
still unfixed and will produce new orphans. And the survivors are exactly the
two meals the grid had been showing all along, which is what keeping the
newest per slot was chosen to guarantee.

Shipped as `344_meal_plans_one_per_slot.sql` **after** the fact so a rebuilt
database gets the index too — the migration carries the index only. The
`DELETE` is documented in its head and deliberately not restated: a delete
that runs on every fresh database is a footgun, and a fresh database has
nothing to collapse.

The bundle as run:

```sql
BEGIN;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, plan_date, meal_type
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM public.meal_plans
)
DELETE FROM public.meal_plans
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS meal_plans_user_date_slot_uniq
  ON public.meal_plans (user_id, plan_date, meal_type);

COMMIT;

SELECT count(*)                                       AS plan_rows,
       count(DISTINCT (user_id, plan_date, meal_type)) AS distinct_slots
FROM public.meal_plans;
```

Returned `plan_rows 2 | distinct_slots 2`, as expected.

The orphan query below now returns **0 rows** — cleared incidentally by the
dedupe. Defect 3's cause is still live, so keep this to hand:

```sql
SELECT id, plan_date, meal_type, food_snapshot->>'name' AS meal
FROM public.meal_plans mp
WHERE NOT EXISTS (
  SELECT 1 FROM public.nutrition_logs nl
  WHERE nl.id = (mp.food_snapshot->>'log_id')::uuid
);
```

## Reproducing the render harness

Deliberately **not committed** — throwaway scaffolding.

- `harness.html` at root, `class="dark"` on `<html>`, mounting `/src/harness.jsx`.
- `src/harness.jsx` mounts `WeeklyMealPlannerModal` inside
  `QueryClientProvider` + `LanguageProvider` + `SettingsProvider`. **Both
  providers are required** — without `LanguageProvider` every card throws and
  the body renders empty, which looks like a mount failure.
- `src/harness-stubs.js` — fixtures plus a **table-keyed chainable supabase
  stub**. Stub at the supabase layer, *not* by reassigning the data module's
  exports: `mealPlans.listInRange = …` fails the dep scan outright with
  *"Cannot assign to import"*, because ESM exports are immutable bindings.
  Keying the stub by table name also proves which table each function reads.
- `vite.harness.config.js` aliases `@/api/db`, `@/api/supabaseClient`,
  `@/lib/AuthContext`, `@/lib/WeightUnitContext` to the stub, plus
  `optimizeDeps.entries: ['harness.html']` — without it Vite's dep scan walks
  `index.html` → `App.jsx` → `virtual:pwa-register` and the server dies.
- `npx vite --config vite.harness.config.js --port 5253 --strictPort`, then
  `preview_start({url})`. Confirm with
  `curl -s localhost:5253/harness.html | grep -c src/harness.jsx`.
- Fixtures: `?fx=none|prod|full|completed|recipes`.
- Read with `get_page_text` / `javascript_tool`; the pane pauses rAF when
  hidden, so framer never settles and screenshots come back mid-fade.
