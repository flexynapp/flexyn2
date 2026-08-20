# Nutrition Settings Audit — 2026-08-12

**Scope:** Three named sub-features — Daily Calorie Target · Macro Split (%) · Preferred Units (g/oz)
**Measured against:** working tree at `~/flexyn2` + production, 2026-08-12
**Method:** claim / proof / what-failure-looks-like per check. Code read, columns counted, no claim carried from a prior doc.

---

## HEADLINE

**All three named sub-features are absent from Settings.** Settings › Body & nutrition
(`src/components/settings/BodySection.jsx:278-297`) contains exactly three controls, and none of
them is a target, a split, or a unit:

| Control | Type | Persisted to |
|---|---|---|
| Nutrient ring view | toggle | `localStorage` `fn-nutrient-ring-view` |
| Calorie cycling | toggle | `localStorage` `fn-calorie-cycling-enabled` |
| Cycle tracking | toggle | `user_profiles.cycle_tracking_enabled` |

Two of the three named features exist *somewhere else* in partial form. One does not exist
anywhere in the codebase.

---

## RULE ZERO — what each sub-feature actually is

| # | Sub-feature | Verdict | One-line reason |
|---|---|---|---|
| 1 | Daily Calorie Target | **(c) partially wired** | Not in Settings and never stored. Derived at render time; set indirectly by a wizard on the Nutrition page. |
| 2 | Macro Split (%) | **(d) absent** | No percentage input exists anywhere in `src/`. Ratios are hardcoded constants. |
| 3 | Preferred Units (g/oz) | **(d) absent** | No food-unit preference exists. 120 hardcoded unit tokens across 15 live files. |

---

## 1 · DAILY CALORIE TARGET — (c) partially wired

### CLAIM
A user can set a daily calorie target in Settings.

### PROOF
**False on both halves.** Two independent checks:

**Check 1 — is there a column?**
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='user_profiles'
  AND (column_name ILIKE '%calorie%' OR column_name ILIKE '%macro%');
```
Returns exactly one row: `calorie_cycling (jsonb)`. **`daily_calorie_target` does not exist.**
This confirms the comment at `NutritionPlansModal.jsx:322-325`, which records that reading such a
field "left plans stuck at the 2000 kcal base."

**Check 2 — is there an input?**
`BodySection.jsx` is the whole of Settings › Body & nutrition. Its Nutrition group is three
`ToggleRow`s (lines 279-297). No numeric input, no target row.

### WHERE THE TARGET ACTUALLY COMES FROM
Every calorie figure in the app is computed at render time by
`calculateDailyValues(userProfile)` — `src/lib/nutritionDefaults.js:98-191`. Nothing is persisted.

Two surfaces influence it, **neither in Settings**:

1. **"Edit Goals" → `NutritionOnboardingModal`** — reached from a button on the Nutrition page
   (`src/pages/Nutrition.jsx:1499-1505`). The user sets *goal*, *activity level*, *target weight*
   and *target date*. The calorie number itself is **read-only** — step 5 renders
   `{preview.calories}` as a `<p>`, not an input (`NutritionOnboardingModal.jsx:611-613`). Saved
   payload (`:224-247`) stores the **inputs**, never a calorie number.

2. **`CalorieCyclingModal`** — the only place in the app a user types an absolute calorie number
   (`CalorieCyclingModal.jsx:25-30`, eight numeric inputs across Training/Rest columns). Persists
   to `user_profiles.calorie_cycling` JSONB. **Gated off by default** — hidden unless the Settings
   toggle is on (`src/pages/Nutrition.jsx:1759`).

### WHAT FAILURE LOOKS LIKE
A user who wants "2,300 kcal/day" has no way to say so. They must express it as a goal + activity +
target-weight + date and accept whatever Mifflin-St Jeor returns — or enable a feature called
"calorie cycling" and type the number into a training/rest grid that changes meaning by day.

### PRODUCTION STATE (verified 2026-08-12)
| Measure | Count |
|---|---|
| Profiles | 57 |
| `nutrition_goal` set | **0** |
| `activity_level` set | **0** |
| `calorie_cycling` set | **0** |
| `nutrition_onboarding_complete = true` | 10 |

**All 57 users are on the FDA fallback of 2,000 kcal.** `calculateDailyValues` returns the
`standard` block unchanged whenever `nutrition_goal` is null (`nutritionDefaults.js:130-132`), so
the entire goal-driven branch — BMR, TDEE, weekly rate, macro splits — has **never executed for a
real user in production.**

### A SECOND FINDING INSIDE THE FIRST
10 profiles carry `nutrition_onboarding_complete = true` while **every other field written by the
same payload is NULL** — goal, activity, weekly rate, target weight, target date, restrictions, all
10 for 10.

That is not a broken write. There are two write paths and they are not equivalent:

- `handleSubmit` (`:224-247`) writes the full payload.
- `handleSkip` (`:278`) writes **only** `{ nutrition_onboarding_complete: true }`.

The data says **10 of 10 users who reached the wizard pressed Skip. Zero completed it.** The
sample is small, but it is unanimous, and it is the reason the goal-driven branch has never run.

**Re-entry is not blocked** — an "Edit Goals" button on the Nutrition page calls `openGoalsEditor`
(`Nutrition.jsx:644-648`), which clears the dismissal and re-opens the wizard. Verified reachable.
*(An earlier hypothesis in this audit — that Skip locks the user out permanently because
`NutritionPlansPanel`'s "Start nutrition setup" CTA sits inside `if (!hasOnboarded)` at
`NutritionPlansModal.jsx:365-386` — was disproved by that button. Recorded because the CTA
genuinely is unreachable after Skip; it is simply not the only door.)*

**One real defect in this area:** the save-failure toast reads *"Could not save your plan — you can
set it up later in **Settings**."* (`NutritionOnboardingModal.jsx:267`). Settings has no such
control. The string points at the wrong place.

---

## 2 · MACRO SPLIT (%) — (d) absent

### CLAIM
A user can set macro percentages (e.g. 40/30/30).

### PROOF
**No percentage input exists anywhere in `src/`.** Greps for `macro_split`, `macroSplit`,
`macro_percent`, `macroPercent`, `protein_pct`, `40/30/30` all return zero hits. No column exists
(the `information_schema` query above returns nothing macro-shaped besides `calorie_cycling`).

### WHERE THE SPLIT IS DECIDED
Hardcoded, in `src/lib/nutritionDefaults.js:166-182`:

```js
const proteinPerLb =
  userProfile.nutrition_goal === 'lose' ? 1.0 :
  userProfile.nutrition_goal === 'gain' ? 0.9 :
  0.8;
const fatKcal   = calories * 0.25;              // fat = 25% of calories
const fatFloor_g = Math.round(weightLbs * 0.35); // hormonal-health floor
const carbs_g   = Math.round(carbsKcal / 4);     // carbs = the remainder
```

Protein is g/lb by goal, fat is a fixed 25% with a bodyweight floor, carbs absorb what is left.
The user chooses a *goal*; the ratio follows from it and is not adjustable.

### THE NEAR-MISSES (three, none of them the feature)

1. **`MacroBar`** — `NutritionPlansModal.jsx:12-24`. Genuinely computes percentages:
   `pPct = (protein*4 / total) * 100`. **Read-only display.** It renders a plan's split as a
   three-segment bar. Nothing writes back.
2. **`CalorieCyclingModal`** — lets a user type **absolute grams** (`protein_g`, `carbs_g`,
   `fat_g`), not percentages, and only inside the training/rest cycling structure.
3. **`PLAN_TEMPLATES`** (`src/lib/nutritionPlans.js`) — pre-built plans (cut, bulk, recomp, keto,
   maintenance) each carry a fixed macro shape, scaled proportionally to the derived calorie
   target by `scalePlan`. Selecting a plan **does not persist anything**: `NutritionPlansModal` has
   no `updateMe`, no `supabase` and no `localStorage` write. `setSelected` is local view state.

So the closest thing to "choose your macro split" is browsing plans — and browsing a plan changes
nothing about your targets.

### WHAT FAILURE LOOKS LIKE
A keto user cannot express 5/70/25. They can view the Keto plan card, see its split rendered, and
close the sheet with their own targets unchanged at 0.8 g/lb protein / 25% fat / carbs-remainder.

---

## 3 · PREFERRED UNITS (g/oz) — (d) absent

### CLAIM
A user can choose whether food amounts display in grams or ounces.

### PROOF
**No such preference exists in any layer.** Four checks, all negative:

| Layer | Check | Result |
|---|---|---|
| Context | Providers in `src/App.jsx:501-508` | Theme, Language, WeightUnit, DistanceUnit, Settings, Auth, RestTimer — **no food-unit provider** |
| Settings state | `SettingsContext.jsx` keys | 10 keys, all behavioural; **none unit-related** |
| localStorage | keys containing `unit` | exactly two: `flexyn_weight_unit`, `flexyn_distance_unit` |
| Database | `user_profiles` unit columns | `weight_unit`, `distance_unit`, `height_unit` — **no food/nutrition unit** |

### THE TWO UNIT SYSTEMS THAT DO EXIST — and why neither covers food

| Context | File | Values | Persisted | Governs |
|---|---|---|---|---|
| `WeightUnitContext` | `src/lib/WeightUnitContext.jsx` | `lbs` · `kg` · `stone` | `flexyn_weight_unit` + `user_profiles.weight_unit` | **body & barbell weight** |
| `DistanceUnitContext` | `src/lib/DistanceUnitContext.jsx` | `mi` · `km` | `flexyn_distance_unit` + `user_profiles.distance_unit` | cardio distance & pace |

`WeightUnitContext` is the one that looks like it should apply and does not. It converts through
`src/lib/weightUnit.js` with lbs as canonical storage — a scale for a **person or a barbell**. Food
macros are grams/milligrams, a different quantity with a different canonical unit. Routing macros
through it would offer a user "kg of protein" and "stone of sodium".

### HOW UNITS ARE ACTUALLY RENDERED — measured
Every nutrition unit in the app is a literal. Counted 2026-08-12:

| Shape | Count | Files |
|---|---|---|
| `unit:`/`suffix:` literal in a module-level table | **94** | 9 |
| bare `g` typed directly into JSX after a value | **26** | 6 |
| **Total hardcoded unit tokens** | **120** | **15 live files** |

(17 files including the two orphaned dashboard widgets `MacroRingWidget` and
`CalorieProgressWidget`, which the Nutrition Dashboard audit recommends deleting.)

**Zero of these read a preference.** Representative:

```js
// MacroNutrientBox.jsx:11-18
{ key: 'protein_g', unit: 'g' }, { key: 'sodium_mg', unit: 'mg' }, …
// MacroNutrientBox.jsx:112
{actual.toFixed(macro.key === 'calories' ? 0 : 1)}{macro.unit}
```

There is even an i18n key that is a fixed SI symbol in all 15 languages —
`src/lib/i18n-part3.js:26` `'nutrition.macros.grams': 'g'` (Russian `'г'`), with
`i18n-check.js:67` noting `// "g" — SI symbol`. The codebase treats grams as invariant on purpose.

### THE ONE PLACE FOOD UNITS ARE CHOOSABLE — and it is per-ingredient, not a preference
`src/lib/data/nutritionRecipes.js:15-27` exports `INGREDIENT_UNITS`
(`g` · `oz` · `ml` · `cup` · `tbsp` · …, `DEFAULT_UNIT = 'g'`), rendered as a `<select>` per
ingredient in `RecipeBuilderModal.jsx:335-341` and stored inside the recipe's JSONB. That is a
property of an ingredient, not a display preference — it does not affect how any macro is shown
anywhere else.

### CONFIRMED DEFECT — the water unit toggle does not persist

The one nutrition-adjacent unit control that exists is broken.

**Claim:** the oz/ml/L toggle on the Nutrition page remembers the user's choice.
**Proof it does not:** `src/pages/Nutrition.jsx:378`

```js
const [waterUnit, setWaterUnit] = useState('oz');
```

Plain `useState` with a hardcoded initialiser — no `localStorage` read, no profile read. The only
two references to `setWaterUnit` in the entire repo are this declaration and the button's
`onClick` (`:1932`), so nothing ever writes it anywhere.

**The tell that this is an oversight and not a decision:** the very next hook, eight lines below,
persists a far less important preference —

```js
// Nutrition.jsx:379-385
const [customBottles, setCustomBottles] = useState(() => {
  const raw = localStorage.getItem('flexyn.customBottles.default');
  return raw ? JSON.parse(raw) : [];
});
```

**Failure mode:** a metric user sets ml, navigates away, comes back, and is reading oz again. Every
mount. Silent, because the numbers are still correct — only the unit reverted.

**Fix shape (not applied — see Scope):** lazy-init from a per-user key matching the convention
already used one line below (`flexyn.<feature>.<userId>`), and write on change. Roughly four lines.

---

## RESULTS

### Confirmed defects
| # | Severity | Finding | Location |
|---|---|---|---|
| 1 | Medium | **Water unit toggle is not persisted** — resets to `oz` on every mount | `src/pages/Nutrition.jsx:378` |
| 2 | Low | **Save-failure toast points at Settings**, which has no nutrition-goal control | `NutritionOnboardingModal.jsx:267` |
| 3 | Low | **"Start nutrition setup" CTA is unreachable after Skip** — it sits inside `if (!hasOnboarded)`, and Skip sets that flag. Not user-blocking (the "Edit Goals" button is a working second door), but the gate's own CTA is dead for exactly the users who most need it | `NutritionPlansModal.jsx:365-386` |

### Absent, by design or by omission
- **Daily Calorie Target** — no column, no Settings input. Derived. Settable only indirectly.
- **Macro Split (%)** — no input, no column, no percentage UI anywhere. Ratios are constants.
- **Preferred Units (g/oz)** — no context, no column, no key. 120 hardcoded tokens across 15 files.

### What passed
- `WeightUnitContext` and `DistanceUnitContext` are correctly built: validated value sets, dual
  persistence (localStorage + DB column), canonical storage units, conversion helpers isolated in
  `weightUnit.js` / `distanceUnit.js`. **A food-unit context should be modelled on these.**
- `CalorieCyclingModal`'s write path is sound — blank fields are dropped by `toStored`
  (`:48-55`) so an untouched day type stays unset and falls through to the computed goal, rather
  than persisting a misleading zero.
- `calculateDailyValues` arithmetic is standard and correctly commented (Mifflin-St Jeor,
  activity multipliers, safe-rate clamps, calorie floors at 1200 F / 1500 M).

### What this audit did NOT do
- **No code was changed.** All three sub-features are absent or partial; building any of them is a
  product decision, not a fix. The three defects above are reported, not patched.
- **No browser render.** The three named features have no UI to render. The water-unit defect was
  confirmed by reading the state declaration and proving no writer exists, which is stronger
  evidence than a screenshot.
- **No new tests.** Nothing was changed, so there is nothing to pin. Test gaps are listed below.

### Test gaps in the audited area
| File | Tests |
|---|---|
| `src/lib/nutritionDefaults.js` (`calculateDailyValues`, 8 consumers) | **none** |
| `src/components/settings/BodySection.jsx` | none (covered only by `settingsSectionsSmoke.test.jsx`) |
| `src/components/nutrition/CalorieCyclingModal.jsx` | none (the data layer `calorieCycling.js` **is** tested) |
| `src/lib/WeightUnitContext.jsx` / `DistanceUnitContext.jsx` | none |

---

## DECISIONS NEEDED FROM KEGAN

1. **Daily Calorie Target** — should a user be able to type a calorie number directly? Today the
   only path is `CalorieCyclingModal`, which is off by default and frames the number as a
   training/rest pair. A plain "override my daily target" row in Settings › Body & nutrition would
   need a new column (`daily_calorie_target`) plus a precedence rule against the derived value.

2. **Macro Split (%)** — build, or close? Ratios are currently goal-derived constants. A custom
   split needs: a percentage input that constrains to 100, a new column, and a precedence rule
   inside `calculateDailyValues`. Note the leverage is low right now — 0 of 57 users have even set
   a *goal*, so nobody is reaching the branch a custom split would modify.

3. **Preferred Units (g/oz)** — build, or close? Cost is 120 render sites across 15 files plus a
   new context, converter and column. Recommend **closing**: grams are the SI standard for
   nutrition labelling worldwide, and the app already treats `g` as invariant in i18n on purpose.

4. **The water unit toggle** — fix now? ~4 lines, no migration, matches an existing convention.
   This is the only item here that is unambiguously a bug rather than a missing feature.

5. **The Skip-vs-Submit finding** — 10 of 10 users skipped the nutrition wizard. Worth treating as
   a product signal, not a code defect: the wizard asks for goal, target weight, target date,
   activity level, dietary restrictions and allergens before it gives anything back.
