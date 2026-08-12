# Brief — Audit the Nutrition DASHBOARD

Drafted 2026-08-12 by the food-database audit session, from live recon against
`origin/main` @ `93ab0555` and production (`ebvqxuwfiptcmlkhflfj`). Written to be
pasted into a fresh session with no other context.

---

Continue to work on Flexyn. Audit the **DASHBOARD of the Nutrition page** in
`~/flexyn2` (Flexyn, React+Vite+Supabase PWA).

Read `CLAUDE.md` first — it is long but it encodes rules that will cost you a
cycle each if you skip them. Parts of it are stale; correct what you disprove.

**FOUR SUB-FEATURES, each of which must end with its own before/after graphic**
Daily Macros (Carbs/Protein/Fat) · Calorie Budget remaining · Macro Pie Chart ·
Nutrition Goal Progress

---

## GROUND TRUTH (measured against origin/main @ 93ab0555 + production, 2026-08-12)

Re-verify every line before trusting it. This block was measured at the time of
writing and it decays. The audit that produced it found its own migration
un-applied and a column its code reads that does not exist — both inside an
hour of writing this. **Treat this document as dated too.**

### Where these four things actually live

| | |
|---|---|
| Macro card (Nutrition page) | `src/components/nutrition/MacroNutrientBox.jsx` — 206 lines |
| Calorie budget bar | `src/components/nutrition/CalorieTopBar.jsx` — 122 lines |
| Per-nutrient ring | `src/components/nutrition/NutrientRing.jsx` — 58 lines |
| Vitamins/minerals card | `src/components/nutrition/MineralsVitaminsBox.jsx` |
| Trends chart | `src/components/nutrition/NutritionTrendsChart.jsx` — 170 lines |
| Plans modal (goal-driven) | `src/components/nutrition/NutritionPlansModal.jsx` — 538 lines |
| Calorie cycling | `src/components/nutrition/CalorieCyclingModal.jsx` — 195 lines |
| **The shared denominator** | `src/hooks/useNutritionTargets.js` — 74 lines, **7 consumers, NO test file** |
| Target arithmetic | `calculateDailyValues` in `src/lib/nutritionDefaults.js:159` |
| Observed activity | `observedSessionsPerWeek` in `src/lib/tdee.js` |
| Orphaned donut | `src/components/dashboard/MacroRingWidget.jsx` — 199 lines |
| Orphaned calorie widget | `src/components/dashboard/CalorieProgressWidget.jsx` — 197 lines |

`useNutritionTargets` is the single most important file in this audit. Its own
head comment says it serves **seven** surfaces — the Nutrition page's top bar,
macro box, mineral box, trends chart and plans modal, plus two dashboard
widgets. Every denominator on all four sub-features comes from it, and
`src/hooks/__tests__/` holds seven test files, **none of which is it**.

### `public.nutrition_logs` — 126 rows, 4 users, and only 8 real meals

```
rows 126 · real meals (meal_type NOT NULL) 8 · water (meal_type NULL) 118
calories non-null 126 · calories > 0 ONLY 7
protein non-null 8, > 0 7 · carbs non-null 8, > 0 7 · fat non-null 8, > 0 7
fiber > 0 7 · latest row date 2026-08-11
```

**None of `protein_g` / `carbs_g` / `fat_g` / `fiber_g` / `sodium_mg` /
`sugar_g` / `water_oz` exists.** Migration 006 declares all of them and has
never been applied. This is an inherited, still-open finding — see SETTLED.

### `public.user_profiles` — there is NO stored calorie or macro target

Columns that exist and matter here:

```
activity_level · age · calorie_cycling · fitness_goals · fitness_goals_arr
gender · height_cm · height_inches · height_unit · nutrition_goal
nutrition_onboarding_complete · onboarding_goal · target_weight_lbs
weight_kg · weight_lbs · weight_unit
```

**`daily_calorie_target` DOES NOT EXIST.** Neither does any per-macro goal
column. Every target on every one of these four surfaces is *derived* at render
time by `calculateDailyValues(userProfile, { sessionsPerWeek })`. Nothing is
persisted. Verify that before planning anything that reads a goal.

### Today is empty, and it will mislead you

The newest `nutrition_logs` row is **2026-08-11**. All four sub-features are
TODAY-scoped. So if you render "today" against production you will see four
empty states and may conclude the feature is broken. **It is not — there is no
data for today.** Fixture the dates, or measure 2026-08-11.

---

## THE COLLISION — read this before you plan anything

**Three of these four surfaces have already been audited, and two were already
FIXED.** This is the single biggest risk in this brief. `docs/nutrition-meal-logging-audit.md`
(2026-08-11) covers:

- **Macros Display — (b) exists, was broken, FIXED.** Ten of sixteen nutrient
  tiles rendered a permanent zero; both cards now gate each tile on having a
  value and moved to `tileRow()`. Pinned by
  `src/components/nutrition/__tests__/nutrientDisplayGating.test.jsx`.
- **Calories Display — (a) exists and works. NO DEFECT, no change made.**
  `CalorieTopBar`'s arithmetic was verified correct and honest on an empty day
  (`2,000 left · 0 / 2,000 cal` on a water-only day, read in a browser).

`docs/nutrition-food-database-audit.md` (2026-08-12) then re-verified the macro
gating and extended `tileRow()` with a `'2-2-2'` literal.

**So do NOT re-report the permanent zeros, and do NOT re-report the calorie
arithmetic.** Both are settled. Your job on those two is the part nobody has
done: the *denominator* they divide by, the states nobody rendered, and the
untested hook underneath all of it.

Equally: **do not assume they are still correct because a document says so.**
That is the exact mistake the food-database audit was sent to correct — it
inherited a "Search is absent" verdict that a commit had falsified hours
earlier. Re-render both cards yourself. A verdict is a measurement with a
timestamp.

---

## RULE ZERO — VERIFY EACH SUB-FEATURE EXISTS BEFORE PLANNING ANY CHANGE

For each of the four, establish and state plainly which it is:

- **(a)** exists and works
- **(b)** exists and is broken
- **(c)** partially wired — column, file or function exists, nothing reads or renders it
- **(d)** absent

Across the last six audits, of 29 named sub-features: six did not exist, three
had been deliberately deleted, one had been built AFTER being declared absent,
and several were correct code that had simply never had data. **A stat named in
a brief is a question, not a component.**

Say "unexercised" when that is what you mean. Eight real meals exist in the
whole database, seven of them carry macros, and none of them is from today.

---

## LEADS WORTH CHASING — hypotheses formed in recon and NOT confirmed

### 1. "Macro Pie Chart" is probably (d) or (c), and there are two candidates

**There is no macro pie chart.** The only recharts `PieChart` in the entire
application is `MuscleGroupsWidget` (`src/components/dashboard/ChartWidgets.jsx:127`)
and it charts **muscle groups from workout logs**, not macros.

The nearest macro thing is `MacroRingWidget`, whose head comment says
"Calories / Protein / Carbs / Fat donut chart for today's macros. Four
concentric rings — one per macro." **It appears to be dead code:**

- it is NOT in `WIDGET_COMPONENTS` (`src/components/dashboard/WidgetRenderer.jsx:346`)
- it is NOT in `src/lib/widgetDefinitions.js`
- `src/pages/Dashboard.jsx:1488` documents removing it: *"Gone from here:
  MacroRingWidget, CalorieProgressWidget and HydrationRing. All three
  duplicated the Nutrition tab, which owns MacroNutrientBox, CalorieTopBar and
  WaterTracker — no feature lost."*

That is **396 lines** of component code (199 + 197) with no render site, still
importing `useNutritionTargets`. **Confirm it renders nowhere** — and confirm it
from the REGISTRY, not from that comment. A comment saying something was removed
is a claim; `WIDGET_COMPONENTS` plus a grep for JSX usage is the artefact.

The third candidate is `nutrientRingView`, a real Settings toggle
(`src/components/settings/BodySection.jsx:281`) that switches `MacroNutrientBox`
and `MineralsVitaminsBox` from bars to `NutrientRing` — but that is a
**per-nutrient progress ring**, not a macro-split pie. One ring per nutrient
showing % of target is a different chart from one pie showing the protein/carb/
fat ratio.

**So: establish which of the three the feature name means. If a macro-split pie
does not exist, say so and ASK before building one.** Note what a pie would
even show on this data: 7 rows with macros, none from today.

### 2. `NutritionPlansModal` read a column that does not exist — is the fix complete?

`NutritionPlansModal.jsx:325` now reads `useNutritionTargets(userProfile)?.calories`,
and the comment above it says: *"Onboarding saves the goal/activity inputs, not
a stored calorie number, so reading a `daily_calorie_target` field left plans
stuck at the 2000 kcal base."*

That column genuinely does not exist on `user_profiles` (measured). So the
comment describes a real, already-fixed defect. **Grep for every other reader of
a nonexistent goal column** — `daily_calorie_target`, `protein_goal`,
`carbs_goal`, `fat_goal`, `macro_targets` — across `src/` AND `pg_proc`. One fix
in one file does not mean the pattern is gone, and `safeSelect`'s
strip-and-retry plus `db.js`'s missing-column cache make a bad column name
silent rather than loud.

### 3. "Daily Macros (Carbs/Protein/Fat)" names three; the card renders eight

`MACROS` in `MacroNutrientBox.jsx:40` is calories, protein, carbs, fat, sodium,
fiber, sugar, cholesterol — and each tile is gated on `totals[key] > 0`. So the
card's tile count is data-driven and the three named macros are not privileged.

Establish: on the real 7-row shape, do carbs / protein / fat each get a tile?
Can one of the three go missing while sodium or fiber shows? A macro card that
silently drops "carbs" because the day's carbs were zero is defensible for
sugar and wrong for a headline macro — the user needs to know a 0 g carb day
happened. **Check whether the three named macros should be exempt from the
`> 0` gate that the other five correctly obey.** That is a product judgement;
form the argument, do not just apply it.

### 4. The calorie budget visibly settles from 2000 to the real number

`useObservedActivity` returns `undefined` while the workout and cardio logs
load, and the hook's own comment says this is deliberate: `undefined` falls
through to a flat 2000 rather than pinning the user to the 1.2 sedentary band.
On Dashboard both queries are warm; **on Nutrition neither is**, so the comment
predicts a visible 2000 → derived transition on every cold Nutrition load.

Verify it actually happens, how long it lasts, and what the user sees mid-flight
— "1,847 left" changing to "2,310 left" a second later is the kind of thing that
reads as a bug even when the reasoning is sound. Then decide whether the
intermediate state should render at all, or whether the bar should hold its
skeleton until the targets land. **Do not "fix" the `undefined` to 0** — the
comment explains precisely why that is worse.

### 5. Every target falls back to a male 180 lb 5'10" body

`calculateDailyValues` (`nutritionDefaults.js:159`) defaults
`weight_lbs || 180`, `height_inches || 70`, `gender || 'male'`. The gender
default is deliberate and documented (it drives RDA rows, and the BMR path
passes sex through raw so the midpoint branch stays reachable) — **read that
comment before touching it.**

The unmeasured part: **how many real profiles have `weight_lbs`, `height_inches`
or `gender` unset?** Count it. If a meaningful share of users are being shown a
target derived entirely from a stranger's body, presented as personalised, that
is a finding — and the remedy is probably copy or a prompt, not arithmetic.

### 6. `useNutritionTargets` has seven consumers and no test

The hook that decides every denominator on this page is untested. Its two
queries reuse `['workoutLogs', email]` and `cardioLogsKey(email, …)`, so a key
change elsewhere silently repoints it. It is a hook, so it needs
`renderHook` + a `QueryClientProvider`, and per CLAUDE.md a component reaching
for react-query needs the provider even for branches that never query.

Test at minimum: the `undefined`-while-loading contract, the 2000 fallback, that
`sessionsPerWeek` reaches `calculateDailyValues`, and that it does not fire a
query with no email.

### 7. Does anything read `calorie_cycling`?

`user_profiles.calorie_cycling` exists and `CalorieCyclingModal.jsx` is 195
lines. Count the populated rows before trusting the column, then establish
whether the *budget bar* honours a cycling day or ignores it. A "remaining"
figure that ignores a cycling plan the user configured is the same class of
defect as a denominator nobody reads.

---

## METHOD

For every check write: the **CLAIM**, the **PROOF** that settles it, and what
**FAILURE** looks like. A check is not passed by reading code and finding it
plausible.

- **Count populated rows before trusting any column.** `count(*)` vs
  `count(col)` vs `count(*) FILTER (WHERE col > 0)`. Non-null is not non-zero —
  that distinction cost a previous audit a wrong claim about
  `workout_logs.total_volume` (9 of 9 non-null, 1 of 9 non-zero).
- **Check whether a writer's PRECONDITION has ever held**, not just that the
  writer exists.
- **Read the INSTALLED artefact, not the migration, and not a comment about it.**
  `pg_get_functiondef()` for functions; `WIDGET_COMPONENTS` for widgets;
  `pg_policies` for policies. A grep over source text is not a reading of the
  source, and a comment saying a thing was removed is not proof it was.
- **Grep the database, not just `src/`.**
- **Read comments before treating a grep hit as debt.** `useNutritionTargets`,
  `calculateDailyValues` and `CalorieTopBar` are unusually well commented and
  several apparent defects are documented decisions.
- **With 8 real meals and none from today, absence of data is NOT evidence of a
  bug.**
- **Render the empty state, the one-meal state, and the over-budget state.**
  jsdom paints nothing. The over-budget branch (`remaining < 0`, red number,
  bar clamped at 0) has almost certainly never been seen by anyone.

---

## ORDER

1. **Read the audit docs.** Cheapest possible way to avoid re-reporting.
   `docs/nutrition-meal-logging-audit.md` FIRST and in full — it owns two of
   your four sub-features. Then `docs/nutrition-food-database-audit.md`.
2. **Unit tests.** Already covered: `nutrientDisplayGating.test.jsx` (9),
   `mealWritePath.test.js` (16), `composerWaterFilter.test.js` (5),
   `weeklyMealPlanner.test.jsx`, plus the three food-database files added
   2026-08-12. **No test exists for `useNutritionTargets`, `calculateDailyValues`
   (check `src/lib/__tests__/` — `nutritionDefaults` may be partly covered),
   `CalorieTopBar` or `NutritionTrendsChart`.** Extend rather than duplicate.
3. **Production SQL.** Row counts and column presence need no RLS. Anything
   about a boundary must run as a real authenticated user:
   `SET LOCAL role authenticated; SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';`
   MCP runs as `postgres` and bypasses RLS entirely. Resolve every uuid BEFORE
   dropping privileges, and assert the probe identity is not the row owner.
4. **Browser render last.** Mount: no entries · water-only · one real meal ·
   the 2026-08-11 two-dinner day · over budget · targets still loading ·
   `nutrientRingView` on and off. Empty states and the settle are the whole
   product here.
5. **Report findings. Fix only what is confirmed.**

---

## ⚠ COLLISION WARNING — seven audits now exist. Read before reporting anything.

```
docs/nutrition-meal-logging-audit.md    ← OWNS two of your four. Read first, in full.
docs/nutrition-food-database-audit.md   ← 2026-08-12, adjacent, re-verified your macro card
docs/nutrition-meal-plans-audit.md      ← adjacent feature, 2026-08-11
docs/progress-insights-goal-audit.md    ← 8 defects, each pinned by a labelled
                                          CHARACTERIZATION test in insightsTab.test.jsx.
                                          Those tests PASS AGAINST THE BUGS ON PURPOSE.
                                          Invert them, never delete them.
docs/body-metrics-audit.md
docs/progress-stats-audit.md
docs/achievements-audit.md
```

## SETTLED. Do not re-report.

- **The water encoding** (`food_name` `'Water'` / `'Water|N'`, `meal_type NULL`).
  Deliberate, handled in five places. 118 of 126 rows. `GROUP BY meal_type`
  before trusting any per-column count.
- **Ten of the sixteen nutrient fields the Log Meal form collects are silently
  discarded** because migration 006 is unapplied. Reported, NOT fixed — a schema
  decision awaiting Kegan. If your work touches those fields, inherit that
  finding. `water_oz`'s `DEFAULT 0` has already been removed from 006; do not
  re-add it.
- **`MacroNutrientBox` / `MineralsVitaminsBox` rendered ten permanent zeros.**
  FIXED 2026-08-11, with tests.
- **`CalorieTopBar` arithmetic.** Verified correct and honest on an empty day.
  No defect found. Re-render it, but do not re-derive the arithmetic finding.
- **`nutrition_logs.food_item_id`** — 0 of 126, no reader, no writer, no view,
  no FK. Confirmed twice. Dropping it is Kegan's call; SQL is at the foot of
  `docs/nutrition-food-database-audit.md`.
- **`meal_plans` slot uniqueness** — migration 344, applied and verified.

## REPORTED and NOT fixed. If you touch these paths, they are already written up.

- `confirmPhotoMeal` can double-insert (guards on react-query `isPending`, then
  awaits an image upload before mutating). One byte-identical duplicate pair
  exists in production.
- **A blank calories field on the manual meal form stores a hard 0.** This one
  is directly upstream of you: it is why 126 rows are calorie-non-null and only
  7 are calorie-positive, and it is why the food-database audit had to gate a
  "0 cal" out of the search sheet. Expect to meet it again in the macro card.
- Deleting a diary entry orphans its mirrored `meal_plans` row.
- ~30 hardcoded English strings in `WeeklyMealPlannerModal`.
- **MIGRATION 345 IS WRITTEN AND NOT APPLIED** (verified 2026-08-12: `food_items`
  still carries `owner full access [ALL] TO public` and
  `verified items readable by all [SELECT] TO public`). It closes a confirmed
  hole where any authenticated user can publish a self-verified row into the
  shared food catalogue. Not your feature — but if you are handing Kegan SQL
  anyway, remind him. The block is at the foot of
  `docs/nutrition-food-database-audit.md`.

---

## REPO GOTCHAS THAT COST TIME — verified, most of them the hard way

**Worktree & environment**

- Work in a git worktree branched off `origin/main`, never off the shared tree,
  and **never stash it**. `~/flexyn2` runs behind with a dirty tree from a
  parallel session. `git stash` is blocked by policy and the block is correct.
- Symlink `node_modules` from `~/flexyn2` into the worktree.
- `src/lib/i18n-langs/` is gitignored and generated. Run
  `node scripts/split-i18n.mjs` in a fresh worktree or EVERY component test
  fails on a loading spinner. `npm run test` does this; `npx vitest` does not.
- Derive the next free migration number **at the moment you create the file**:
  `{ ls supabase/migrations; git ls-tree --name-only origin/main supabase/migrations/ | sed 's#.*/##'; } | grep -oE '^[0-9]{3}' | sort -n | tail -1`
  **349 is taken as of 2026-08-12.** Every migration needs a row in
  `docs/migrations-runbook.md` or `migrationCatalog.test.js` fails.
- A migration containing a `DELETE` against production may be refused by the
  tooling, and that is the right outcome. Ship the client-side fix that needs no
  SQL, hand him the destructive SQL inline, and record the applied change as a
  migration afterwards so a rebuilt database matches production.

**Testing**

- Radix dropdowns/menus open on `pointerdown`. `fireEvent.click` leaves them
  shut; use `@testing-library/user-event`.
- jsdom `localStorage` is a Proxy — `vi.spyOn(Storage.prototype, …)` silently
  never fires. Spy on `window.localStorage` directly.
- Components reaching for react-query need a `QueryClientProvider` even for
  branches that never query. **A hook needs `renderHook` plus that provider** —
  relevant to lead 6.
- A component rendering through `createPortal` puts nothing in RTL's
  `container`. Assert on `document.body`, or `screen`.
- **Wait for the query to settle before asserting on anything derived from it.**
  Doubly true here: `useNutritionTargets` resolves in two stages, so an early
  `findByRole` reads the 2000 fallback and the assertion is meaningless. Mount,
  await something that only exists once data has landed, THEN read.
- You cannot `vi.spyOn` an ESM export the module calls internally. Mock at the
  supabase layer — a chainable stub keyed by table name also proves which table
  a function reads.
- **Prove your tests are not vacuous.** Revert the fix, re-run, confirm the
  behavioural tests fail and the invariant tests still pass. This caught a real
  gap in each of the last three audits — most recently an assertion written as
  `not.toMatch(/\bcal\b/)` that passed against the bug, because a figure and its
  unit render adjacent as `0cal` and there is no word boundary between a digit
  and a letter. **Assert substrings, not `\b` regexes, on adjacent
  value+unit text.**
- Label characterization tests in the file header and say to invert rather than
  delete them.

**SQL via MCP**

- The whole `execute_sql` call runs in one implicit transaction. A `ROLLBACK`
  inside it rolls back your `CREATE TEMP TABLE` too. Either one probe per call
  with the `SELECT` last, or capture into a temp table without rolling back. A
  `DO` block with `BEGIN/EXCEPTION` per probe, writing outcomes into a temp
  table and `SELECT`ing at the end, works well — reset role to `postgres`
  before each bookkeeping `INSERT`.
- `RAISE NOTICE` is invisible through MCP. End every bundle in a `SELECT` that
  proves it ran.
- A probe `INSERT` can fail on a `NOT NULL` before it ever reaches the
  constraint you are testing, and the error reads exactly like "RLS blocked it".
  Supply every NOT NULL column and re-read the error.
- Test a constraint in BOTH directions — that the thing which should fail does,
  AND that the neighbouring legitimate case still succeeds.
- CLEAN UP anything you write to production, and verify the cleanup in the same
  call.

**Harness (build it; jsdom cannot answer the questions above)**

- `preview_start` alone only ever serves `~/flexyn2`. Run
  `npx vite --config vite.harness.config.js --port 5256 --strictPort` yourself
  and open it with `preview_start({url})`. **Do NOT use 5199, 5241, 5253 or
  5254** — parallel sessions have held all of those. Vite binds **IPv6 only**
  here, so confirm with
  `curl -s "http://[::1]:5256/harness.html" | grep -c src/harness.jsx` —
  `127.0.0.1` returns nothing and looks like a dead server.
- The harness config needs `optimizeDeps: { entries: ['harness.html'] }` or
  Vite's dep scan walks `index.html` → `App.jsx` → `virtual:pwa-register` and
  the server dies.
- Alias `@/api/db`, `@/api/supabaseClient`, `@/lib/AuthContext`,
  `@/lib/WeightUnitContext` to stubs. These cards need **`LanguageProvider` AND
  `SettingsProvider`** — without `LanguageProvider` every card throws
  `useLanguage must be used within a LanguageProvider` and you get an empty body
  that looks like a mounting failure. `SettingsProvider` is what
  `nutrientRingView` reads.
- Stub at the supabase layer, keyed by table name — never by reassigning the
  data module's exports. `foodItems.listMineForSearch = …` fails the dep scan
  outright with "Cannot assign to import"; ESM exports are immutable bindings.
  One chainable thenable per table, resolving at ANY depth in the chain, since
  different callers bottom out at different methods.
- **`useNutritionTargets` fetches `WorkoutLog` and `CardioLog` through
  `db.entities`, not through supabase.** Your stub must cover both or every
  target silently stays at the 2000 fallback and you will audit the wrong
  number. This is the single easiest way to get this audit wrong.
- Put `class="dark"` on `<html>` or you will audit the light theme by accident.
- The Browser pane pauses rAF when hidden, so framer-motion never settles:
  screenshots come back mid-fade and `computer` clicks may not register. Read
  with `get_page_text`, and drive state with `javascript_tool`
  (`element.click()` inside an async IIFE) rather than the `computer` tool. Call
  `resize_window` first — the pane can report a 0x0 viewport and `read_page`
  returns "(empty page)".
- The console buffer is **cumulative across navigations**, so stale HMR errors
  from an intermediate edit persist and read as live failures. Check whether the
  served module still contains the symbol the error names before chasing it.
- A working harness is throwaway: keep it out of the commit and record the
  recipe in the audit doc.

**Code conventions that bite**

- Dates go through `useDateFormatter()` / `formatDate()` from `src/lib/intl.js`,
  never date-fns `format()` — it binds no locale. Keep `format(d,'yyyy-MM-dd')`
  where the output is a KEY, not text. **`MacroRingWidget` and
  `CalorieProgressWidget` both compute `today` with date-fns `format` inside the
  component**, deliberately, so an overnight PWA does not freeze the date — read
  that comment before changing either.
- `t()` vs `tFallback()`: `tFallback(key, 'English')` is the standard for NEW
  keys. `t()` is CORRECT for keys already shipping in all 15 languages — check
  the dictionaries before converting anything. `nutrition.macros.*` ships in all
  15; `nutrition.minerals.*` and `nutrition.vitamins.*` ship in 8.
- New English-only keys trip the ratchet in
  `src/lib/__tests__/i18nCoverage.test.js`. Add a NARROW prefix to
  `AWAITING_TRANSLATION`, never a bare `nutrition.`. Do not machine-translate;
  do not lower `FLOOR`.
- Do not half-convert a file to i18n. Adding one `tFallback` among thirty
  hardcoded strings is worse than either extreme. Convert the file or report it.
- `grid-cols-N` is for a fixed count; a data-driven collection uses `tileRow()`
  from `src/lib/tileRows.js`. `MacroNutrientBox` already uses
  `tileRow({ gap: 3, cols: 2, smCols: 4 })`. Adding a shape means adding a
  literal to `ITEMS` — they cannot be built at runtime.
- **A section with no data must not render as zeros.** Drop the stat rather than
  rendering a permanent column of em dashes. This rule has now been applied
  three times in this feature area; apply it consistently rather than inventing
  a fourth variation.
- Declare `const`/`let` BEFORE first use — `no-use-before-define` is on at warn
  and the TDZ trap is real in production builds.
- If you find an identical defect two lines from one you are fixing, fix it or
  say explicitly why not.
- Before push: `npm run lint` (clean), `npm run build`, `npm run test`. The
  suite is **4604 tests across 334 files** as of 2026-08-12; it should not
  shrink. Push the feature branch first, then
  `git push origin <branch>:main`. After any push, report the SQL inline in a
  fenced ```sql block, or state "No SQL needed — frontend only".

---

## GRAPHICS — one PNG per sub-feature, four total, for pasting into Google Doc comments

- Self-contained HTML: inline ALL CSS in a `<style>` block. No external
  stylesheet.
- Use the app's real dark tokens from `src/index.css` (`.dark`): bg
  `hsl(210 18% 9%)`, card `hsl(210 18% 12%)`, primary `hsl(26 90% 52%)`, success
  `hsl(152 52% 52%)`, border `hsl(210 18% 20%)`, muted `hsl(210 10% 58%)`.
- Layout: numbered eyebrow (01 / 04), large Archivo title, one-line deck,
  two-column BEFORE/AFTER with faithful component mockups, a NUMBERED "what
  changed" list (claim in bold + the reasoning), and a footer with Migration /
  Tests / i18n / Visible change.
- For a sub-feature you did not change, do NOT fake a before/after. Label it
  "Audited · no code change" and use the two columns for hypothesis vs verified
  instead. Say plainly in item 01 that nothing changed.
- **NEVER produce a graphic implying you changed something you did not.** If a
  sub-feature is absent, say so and ask before building it.
- Every number on a card must match what you actually measured. Check the
  mockups against your own harness output before rendering — a sheet header
  reading "4 items" above three rows is the kind of slip that survives to the
  Google Doc. If you put a count in a card, COUNT IT; one card in the last
  audit had to be corrected from an estimated 30 to a measured 34.
- Disable font ligatures on all monospace:
  `font-variant-ligatures:none; font-feature-settings:'liga' 0,'calt' 0`. Use
  `white-space:pre` on any block where you hand-wrote line breaks.
- Render at 1240px wide, 2×. Measure height first, and note the trap:
  `documentElement.scrollHeight` floors at the viewport, so measuring inside a
  tall window returns the window height for every page. Measure with a SHORT
  window (`--window-size=1240,400`) so content exceeds it, then screenshot at
  exactly that height:
  `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=1240,<H> --virtual-time-budget=5000 --screenshot=out.png`
  (To read the height back out: set
  `document.title = String(document.documentElement.scrollHeight)` and use
  `--dump-dom | grep -o '<title>[0-9]*</title>'`.)
- **Budget ~4 minutes per card** (two Chrome launches at ~2 min each on this
  machine) and start them in the background early. **`timeout` is NOT installed
  on this Mac** — any diagnostic written as `timeout 60 <chrome> …` exits 1 with
  `command not found`, which reads exactly like the hang you were diagnosing.
  Use `run_in_background` plus an `until [ -f out.png ]` waiter. Before
  concluding a render is stuck, read the full argv from
  `pgrep -fl "[G]oogle Chrome --headless"` — it names the output file — and do
  not `pkill` broadly while a render you want is in flight.
  A faster way to measure height when a vite server is already up: copy the card
  into its root and read the title through the Browser pane. Instant, no Chrome.
- Read every PNG back with the Read tool before sending it. Send with
  `SendUserFile`.
- If work continues after the graphics are made, regenerate them — a card saying
  "no code change" goes stale the moment a later round touches that sub-feature.

---

## DELIVERABLES

- `docs/nutrition-dashboard-audit.md` — the audit (claim / proof / failure per
  check) plus a RESULTS section with confirmed defects, what passed, and what
  you did not do.
- Confirmed fixes, tested, lint + build + suite green.
- Four PNGs, one per sub-feature.
- A plain statement of which sub-features did not exist, which were deliberately
  removed, which were already covered by earlier audits, and what you built
  versus what you only audited.
- **A decision on `MacroRingWidget` + `CalorieProgressWidget`.** 396 lines with
  no render site, removed from Dashboard on purpose. Either delete them (with
  the reasoning, and check nothing in `widgetOrder`/`sectionLayouts`
  localStorage still names them) or record why they are being kept. Do not leave
  them undiscussed a third time.
- If any claim in this brief turns out to be wrong, **amend this file in place
  with a dated note** rather than silently fixing it downstream. That precedent
  is now three audits deep and it is the reason this brief is worth reading.

---

**Be blunt about scope.** This dashboard is backed by **8 real meals from 4
users, 7 of which carry macros, none of them from today**, and every target it
divides by is derived at render time from a profile that may be entirely
defaults. "Unexercised" is the most likely honest answer for a lot of it. The
most valuable finding may well be that two of these four surfaces were fixed
last week, a third is dead code with a name that promises a chart nobody can
reach, and the fourth divides by a number no test has ever checked.
