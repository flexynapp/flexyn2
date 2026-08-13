# The Russian gap, and why the ratchet keeps tripping

**Measured 2026-08-13.** Every number here is a measurement with a date on
it, not a standing fact — re-run the commands below before acting on it.

## What happened

CI went red on run #77 (2026-08-12) with:

```
AssertionError: ru coverage fell to 79.0%: expected 0.7898126463700235 to be greater than 0.79
```

The ratchet's own comment reads a trip as a language having **lost ground**
on copy we said we would translate, and instructs the next contributor to
translate rather than loosen. That reading was wrong here, and following it
literally sends you hunting a regression that does not exist.

Measured at `79b2bc6e` (the last green commit) against the commit that
tripped it:

| | counted (denominator) | ru covered | pct |
|---|---|---|---|
| run #76, green | 1702 | 1349 | 79.26% |
| run #77, red | 1708 | **1349** | 78.98% |

The numerator is identical. Russian did not lose a single translation. Six
`hub.comments.*` keys were added, the denominator grew, and a ratio sitting
0.26 points above its floor went under.

Five of those six were **hardcoded English literals** in
`HubCommentsInline.jsx` before they were keyed (`:561`, `:611` twice,
`:616`, `:642` at the green commit), so every non-English reader already saw
exactly that text and still does. The sixth is an accessible name for a
control that had none. They are exempted in `AWAITING_TRANSLATION` on the
`goals.deadline.` and `goals.rowMenu` precedents, which cover exactly these
two shapes.

**This is the mechanism to understand: keying an English string that was
already on screen in English makes the ratio worse while making the app
strictly better.** A ratchet on a ratio cannot tell that apart from a
regression. Every honest extraction pass will trip it again.

## Why it will recur

Current margins against the 0.79 floor:

Margins below are in the units that actually caused this: **new
English-only keys the language can absorb before it drops under 0.79**, at
a fixed numerator. That is the real mechanism — the numerator never moved.
Stating the margin as "translations it can afford to lose" would describe a
failure mode that has not occurred.

| lang | covered / counted | pct | absorbs |
|---|---|---|---|
| es fr de pt ja | 1381 / 1702 | 81.14% | 46 keys |
| it | 1377 / 1702 | 80.90% | 41 keys |
| ko | 1355 / 1702 | 79.61% | 13 keys |
| tr pl nl | 1352 / 1702 | 79.44% | 9 keys |
| zh ar hi | 1350 / 1702 | 79.32% | **6 keys** |
| **ru** | **1349 / 1702** | **79.26%** | **5 keys** |

The push that broke CI added **six**. Four languages would trip on a push
that size, and `ru` trips on anything over five. The exemption added on
2026-08-13 bought back 0.26 points and nothing more — it restored the
status quo, it did not create headroom. The test's own comment predicted
this: *"a floor set flush against the minimum re-trips on the next honest
extraction, which is how it came down from 0.80 in the first place."*

The durable fix is translation, not another exemption. Machine translation
is not allowed here (CLAUDE.md), and the two standing exceptions
(`i18n-equipment.js`, `i18n-journal.js`) were both explicitly asked for.

## The cheapest 34 keys

These are **partial gaps**: `ru` lacks them but three to thirteen other
languages already have them. They are the best value per key because a
partial gap is the failure this ratchet exists to catch — one English line
inside an otherwise-translated screen — and because the surrounding context
is already translated, so a translator has the register to match.

Translating all 34 takes `ru` from 1349 to 1383 of 1702, **79.26% → 81.26%**,
clearing the current floor by 2.26 points and clearing the old 0.80 floor
too.

Roughly nine of them are standard nutrient and mineral names with settled
Russian forms. They still need a Russian speaker to confirm — they are
listed here, not filled in, deliberately.

### `i18n-part4.js` (15)

| have | key | English |
|---|---|---|
| 7/14 | `common.confirmDelete` | Confirm Delete |
| 7/14 | `nutrition.minerals.calcium` | Calcium |
| 7/14 | `nutrition.minerals.iron` | Iron |
| 7/14 | `nutrition.minerals.magnesium` | Magnesium |
| 7/14 | `nutrition.minerals.potassium` | Potassium |
| 7/14 | `nutrition.vitamins.a` | Vitamin A |
| 7/14 | `nutrition.vitamins.b12` | Vitamin B12 |
| 7/14 | `nutrition.vitamins.c` | Vitamin C |
| 7/14 | `nutrition.vitamins.d` | Vitamin D |
| 7/14 | `widgets.customize` | Add widgets to customize your dashboard |
| 7/14 | `widgets.library` | Widget Library |
| 7/14 | `widgets.noRecentWorkouts` | No recent workouts |
| 7/14 | `widgets.recentWorkouts` | Recent Workouts |
| 7/14 | `workout.deleteWorkout` | Delete Workout |
| 7/14 | `workout.duration` | Duration (min) |

### `i18n-part1.js` (10)

| have | key | English |
|---|---|---|
| 7/14 | `analytics.exercise` | exercise |
| 7/14 | `analytics.exercises` | exercises |
| 7/14 | `progress.exerciseTrends` | Exercise Trends |
| 7/14 | `progress.filter` | Filter |
| 7/14 | `progress.latestSets` | Latest sets |
| 7/14 | `progress.logWorkoutsForAnalytics` | Log some workouts to see your personal bests. |
| 7/14 | `progress.maxReps` | Max Reps |
| 7/14 | `progress.maxWeightLbs` | Max Weight (lbs) |
| 7/14 | `progress.maxWeightOverTime` | Max Weight Lifted Over Time |
| 7/14 | `settings.restTimer` | Rest timer |

### `i18n-leagues.js` (4)

| have | key | English |
|---|---|---|
| 5/14 | `dashboard.atRiskToday` | Train today to keep it |
| 5/14 | `dashboard.workoutDaysStreak` | day workout streak |
| 5/14 | `dashboard.workoutDayStreak` | day workout streak |
| 5/14 | `dashboard.workoutStreakMilestone` | 🔥 {day}-day workout streak! +{coins} coins |

`workoutStreakMilestone` carries **two placeholders**. A translation that
drops `{day}` or `{coins}` renders a hole, and English cannot show you that
— see the CLAUDE.md note on `JournalView`, where a wrapper that swallowed
the vars rendered a literal `Dormiste {n} h` in Spanish while English was
perfect. Russian pluralises on 1 / 2–4 / 5+, so `{day}-day` needs a form
that works for all three or a rewrite that avoids the agreement.

### `i18n-cardio.js` (3)

| have | key | English |
|---|---|---|
| 13/14 | `cardio.weather.feelsLike` | feels like |
| 3/14 | `cardio.weather.checking` | Checking conditions… |
| 3/14 | `cardio.weather.outside` | Outside conditions |

`feelsLike` is in **13 of 14** languages. Russian is the only gap.

### `i18n-rest-timer.js` (2)

| have | key | English |
|---|---|---|
| 6/14 | `restTimer.voiceCues` | Voice cues |
| 6/14 | `restTimer.voiceHint` | Hands-free coaching: rest start, 3-2-1 countdown, "time's up". Plug in your headphones. |

## What is NOT on this list, and why

`ru` is missing 359 counted keys in total. The other 325 are missing in
**all fourteen** languages — English-only features, mostly deliberate
(`nutritionOnboarding` 35, `workout` 27, `hub` 22, `gift` 17, `report` 17,
`leaderboards` 16, `myGym` 16). Translating those helps every language
equally and moves the ratio for all of them, but it is a much larger job and
it is not what the ratchet is complaining about.

Fix the 34 partial gaps first. They are the actual defect — a translated
screen with one English line in it.

## Reproducing this

```bash
node scripts/split-i18n.mjs        # required — i18n-langs/ is gitignored
node scripts/i18n-audit.mjs        # summary
node scripts/i18n-audit.mjs --partial   # the partial gaps, per key
npx vitest run src/lib/__tests__/i18nCoverage.test.js
```

`npm run test` runs the splitter first; `npx vitest` does not. In a fresh
worktree `src/lib/i18n-langs/` does not exist, and a coverage measurement
taken there is measuring an empty dictionary.

## When this is done

Once `ru` clears comfortably, raise `FLOOR` in
`src/lib/__tests__/i18nCoverage.test.js`. Leaving it at 0.79 with 2.26
points of slack means the next regression has to erase the whole
translation pass before anything fails — which is how a ratchet stops
ratcheting. Set it under the new lower bound with a margin, not flush
against it; flush is what produced this incident.
