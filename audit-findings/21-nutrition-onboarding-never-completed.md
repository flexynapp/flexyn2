# Audit 21 — the nutrition goal engine has never run for anyone

**2026-08-11.** Opened as a one-line footnote to the Insights audit
("`user_profiles.activity_level` is null on all 53 rows"). The column is
null, but the cause is not the one the footnote assumed, and the blast
radius is much larger than one column.

All counts below are measured on production, 2026-08-11.

---

## What the footnote said

> `user_profiles.activity_level` is null on all 53 rows, yet it has four
> touchpoints: written by `NutritionOnboardingModal.jsx:227`, read by
> `nutritionDefaults.js`, `planBuilder.js` and `WorkoutQuickGenerator.jsx`.
> That's CLAUDE.md's third shape — the writer exists and has never been
> reached.

The last sentence is right. Everything anyone would infer from it is wrong.

## What is actually true

The write is correct. `handleSubmit` builds a payload containing
`activity_level` and hands it to `db.auth.updateMe`, which upserts into
`user_profiles` — the same table the readers read. The column exists
(migration 191). Nothing is stripped, nothing errors.

`handleSubmit` has simply never executed.

```
user_profiles                                   56 rows
  nutrition_onboarding_complete = true          10
  nutrition_goal        IS NOT NULL              0
  activity_level        IS NOT NULL              0
  weekly_rate_lbs       IS NOT NULL              0
  target_weight_lbs     IS NOT NULL              0
  dietary_restrictions  IS NOT NULL              0
```

Ten accounts are flagged complete and not one of them carries a single
value from the flow. They all arrived via `handleSkip`, which writes the
completion flag alone:

```js
const handleSkip = async () => {
  try { localStorage.setItem(onboardedKey, 'true'); } catch { /* ignore */ }
  try { await db.auth.updateMe({ nutrition_onboarding_complete: true }); } catch { /* ignore */ }
  onComplete?.();
};
```

**Nutrition onboarding has a 0% completion rate over 10 exposures.**

## Why that matters more than the column

`calculateDailyValues` returns before it ever reaches the activity line:

```js
if (!userProfile.nutrition_goal) {
  return applyCalorieCycling(standard, userProfile);
}
// ---------- goal-driven calorie & macro calculation ----------
const bmr = mifflinStJeor({ weightKg, heightCm, age, gender });
const activity = ACTIVITY_MULTIPLIERS[userProfile.activity_level] ?? ACTIVITY_MULTIPLIERS.moderate;
```

`nutrition_goal` is null for all 56. So the entire goal-driven engine —
Mifflin-St Jeor, the activity multiplier, the weekly-rate derivation, the
3500-kcal-per-lb delta, the 1200/1500 safety floors — is unreachable in
production. Every user of the app gets the `standard` literal:

> 2000 kcal · protein `weight_lbs × 0.8` · carbs 300 g · fat 78 g

There is no `daily_calorie_goal` column to override it — `calculateDailyValues`
is the only source of the target, across all eight call sites (the Nutrition
page's top bar, macro and mineral boxes, trends chart, plans modal, and the
dashboard's calorie and macro-ring widgets).

**Consequence for the original finding:** "`nutritionDefaults` silently
defaults everyone to `moderate`" is true of the source and invisible in the
product. That line sits three statements inside a branch nothing enters.
Changing the `?? moderate` fallback would alter nothing any user sees.

## The reachable one

`_demographicScale({ gender, age, activityLevel })` in `workoutGenerator.js`
is fed `userProfile.activity_level` by both `WorkoutQuickGenerator.jsx:109`
and `planBuilder.js:680`. That path *does* run, for everyone:

```js
const actFactor = ACTIVITY[String(activityLevel || '').toLowerCase()] ?? 1;
```

`actFactor` has been exactly 1 for every workout ever generated. Demographic
volume scaling has never once accounted for how much the user actually
trains. Nothing errors and nothing looks wrong; the term is just inert.

## The inconsistency this leaves in the product

`InsightsTab` computes a real TDEE from *observed* behaviour — Mifflin-St
Jeor times a multiplier derived from sessions per week over a rolling window
— and puts it on the Progress page with the session count and multiplier
shown as its supporting figures. Its ladder (1.2 / 1.375 / 1.55 / 1.725 /
1.9) is identical to `ACTIVITY_MULTIPLIERS`.

TDEE is computable for 25 of 56 accounts today (weight + height + age all
present). For those users the app displays a personalised maintenance
number on Progress and a flat 2000 on Nutrition, and the personalised one is
the one it doesn't use.

## Adjacent, found on the way

- **`birthday` is null on all 56 rows** while `age` is populated on 25.
  Another live/dead column pair of the shape that has produced three silent
  bugs this week. `profileAge()` already resolves both, so nothing is
  currently broken by it — but `responders.js:913` describes `birthday` as
  "the field onboarding actually writes for some users", and for zero users
  is what the data says.
- **`responders.js:902` recorded a false cause** and has been corrected in
  this pass. It excluded `activity_level` as "nothing writes it" while
  keeping `nutrition_goal` / `dietary_restrictions` / `weekly_rate_lbs`
  because "the writers are real" — but all four are written by the same
  object literal in the same function. The distinction never existed.

## Not done here

Making the nutrition target fall back to the observed TDEE when no goal is
set is the fix that would matter to users, and it is a product decision
rather than a bug fix: it changes the calorie number shown to every account
on the app. It also touches `calculateDailyValues`' signature across eight
call sites in Nutrition and Dashboard files that other sessions are actively
editing. Left for a deliberate decision.
