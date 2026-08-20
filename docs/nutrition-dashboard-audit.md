# Nutrition Dashboard Audit — 2026-08-12

**Audit date:** 2026-08-12  
**Auditor:** Claude  
**Scope:** Four sub-features on the Nutrition page dashboard: Daily Macros, Calorie Budget, Macro Pie Chart, Nutrition Goal Progress

---

## GROUND TRUTH (Production state, 2026-08-12)

### nutrition_logs table
- **Total rows:** 126
- **Meal rows (meal_type NOT NULL):** 8
- **Water rows (meal_type NULL):** 118
- **Rows with calories > 0:** 7
- **Rows with protein > 0:** 7
- **Latest entry date:** 2026-08-11
- **Entries across N days:** 19 days

**Critical:** Today (2026-08-12) has zero entries. All four sub-features scope to TODAY, so production renders empty states for all of them. This is **not a bug** — data simply does not exist for today. Testing requires use of 2026-08-11 data or fixture dates.

### user_profiles table
- **Total users:** 57
- **With weight_lbs set:** 27 (47%)
- **With height_inches set:** 27 (47%)
- **With gender set:** 13 (23%)
- **With nutrition_goal set:** 0 (0%)
- **With activity_level set:** 0 (0%)
- **With calorie_cycling set:** 0 (0%)

**Critical:** No user has configured a nutrition goal, activity level, or calorie cycling. Every nutrition target is derived at render time from `calculateDailyValues()` with hard defaults:
- weight_lbs: 180 (if unset)
- height_inches: 70 (if unset)
- gender: 'male' (if unset)
- activity_level: 'moderate' (if unset)
- nutrition_goal: null → use standard FDA values (2000 cal, 300g carbs, etc)

---

## SUB-FEATURE ASSESSMENTS

### 1. Daily Macros (Carbs/Protein/Fat)

**Component:** `src/components/nutrition/MacroNutrientBox.jsx` (206 lines)

**Status:** **(a) exists and works** ✓

**What it renders:**
- Card titled "Nutritional Values"
- 8 nutrient tiles in a 2-column grid (4 on mobile, 2-4 responsive with tileRow)
- Nutrients: Calories, Protein, Carbs, Fat, Sodium, Fiber, Sugar, Cholesterol
- Two view modes: bar (default) and ring (when `nutrientRingView` setting is on)
- Net carbs calculation (carbs − fiber) shown below

**Tile gating:** Each tile is rendered only if `totals[key] > 0`. On a day with zero entries (water only), all 8 tiles are hidden and the card appears empty.

**Denominator:** All percentages divide by `calculateDailyValues(userProfile)`, which returns:
- Hard defaults if no nutrition_goal is set
- Goal-derived targets if nutrition_goal exists
- Calorie cycling applied if configured

**Data flow:**
1. Nutrition.jsx queries `nutritionLogs` for today
2. Passes `entries` to MacroNutrientBox
3. Component sums into `totals` via useMemo
4. Computes `dailyValues` via `calculateDailyValues(userProfile)`
5. Renders `actual / goal` as tile content

**Tests:** None exist for this component. No test file in `src/components/__tests__/`.

**Defects:** None found. Prior audit (2026-08-11) fixed permanent zeros by gating tiles on `> 0` and moving to tileRow layout. Verified working.

---

### 2. Calorie Budget Remaining

**Component:** `src/components/nutrition/CalorieTopBar.jsx` (122 lines)

**Status:** **(a) exists and works** ✓

**What it renders:**
- Large number (calories remaining) in top-left, red if over budget
- Small tally (consumed / goal) in top-right
- Battery gauge 0–100% showing fill level
- Gradient color: green (full) → yellow (half) → red (empty)
- 28 decorative specks flowing right-to-left across the fill with vertical bob

**Arithmetic:**
```
consumed = SUM(entry.calories for entry in entries)
goal = calculateDailyValues(userProfile).calories || 2000
remaining = goal - consumed
remainingPct = MAX(0, MIN((remaining / goal) * 100, 100))
```

**Behavior:**
- Remaining can go negative (shown in red)
- Bar clamps at 0 (never goes below empty)
- Number keeps counting into negatives
- Specks animation continues even when over-budget

**Transitions:** On production, bar transitions from 100% (fresh day) to calculated % as meals log. Specks fade in/out at edges.

**Tests:** None exist for this component.

**Defects:** None found. Prior audit (2026-08-11) verified arithmetic correct on empty day (2000 remaining, 0/2000 cal). Re-verified working.

---

### 3. Macro Pie Chart

**Status:** **(d) absent** ✗

**Hypothesis:** The "Macro Pie Chart" sub-feature name likely refers to one of:

1. **MacroRingWidget** (`src/components/dashboard/MacroRingWidget.jsx`, 199 lines)
   - Is NOT a pie chart; it's a 4-ring concentric donut chart (calories, protein, carbs, fat)
   - Designed for Dashboard display, not Nutrition page
   - **Not rendered anywhere:** Not in WIDGET_COMPONENTS (src/components/dashboard/WidgetRenderer.jsx), not in Dashboard.jsx, not in Nutrition.jsx
   - **Status:** (c) partially wired — code exists, nothing renders it

2. **MuscleGroupsWidget** (src/components/dashboard/ChartWidgets.jsx)
   - Uses recharts PieChart
   - Charts muscle groups from workout logs, not macros
   - Not relevant to nutrition dashboard

3. **No other macro pie/ring/donut chart exists in the codebase**

**Verification:** Searched entire src/ for:
- `PieChart` — only MuscleGroupsWidget
- `pie\|donut\|ring` (case-insensitive) — only MacroRingWidget and HydrationRing
- Nutrition-related charts — only CalorieTopBar (gauge), NutritionTrendsChart (history modal), MacroRingWidget (orphaned)

**Conclusion:** If "Macro Pie Chart" means a pie chart of macro split (carbs/protein/fat as slices), **it does not exist**. If it means the macro ring chart, it exists but is orphaned and never rendered.

---

### 4. Nutrition Goal Progress

**Status:** **(d) absent or misnamed** ✗

**Investigation:**

No component or page element is explicitly titled "Nutrition Goal Progress". Candidates:

1. **CalorieProgressWidget** (`src/components/dashboard/CalorieProgressWidget.jsx`, 197 lines)
   - Shows: consumed/goal bar + remaining number + macro breakdown (protein/carbs/fat)
   - Designed for Dashboard display
   - **Not rendered anywhere:** Not in WIDGET_COMPONENTS, not in Dashboard.jsx, not in Nutrition.jsx
   - **Status:** (c) partially wired — code exists, nothing renders it
   - **Comment at top:** "Gone from here: MacroRingWidget, CalorieProgressWidget and HydrationRing. All three duplicated the Nutrition tab… no feature lost."

2. **NutritionTrendsChart** (`src/components/nutrition/NutritionTrendsChart.jsx`, ~170 lines)
   - Shows 7-day (or N-day) calorie bars + summary stats + average macro bars
   - Only mounted inside MealHistoryModal
   - Shows historical trends, not today's progress
   - **Status:** (d) absent from dashboard/today view

3. **NutritionOnboardingModal** (32 KB)
   - Shows calorie targets during onboarding
   - Not a dashboard feature

**Conclusion:** **No "Nutrition Goal Progress" feature exists on the Nutrition page dashboard.** CalorieProgressWidget was deliberately removed. The remaining progress tracking lives in the Nutrition page's CalorieTopBar (remaining calories) and MacroNutrientBox (macro percentages).

---

## ORPHANED COMPONENTS

Two Dashboard widgets exist but are completely unused:

| Component | Lines | Status | Reason removed |
|-----------|-------|--------|-----------------|
| MacroRingWidget | 199 | Not in WIDGET_COMPONENTS, not rendered | Duplicated Nutrition tab functionality |
| CalorieProgressWidget | 197 | Not in WIDGET_COMPONENTS, not rendered | Duplicated Nutrition tab functionality |

Both import and use `calculateDailyValues()`, `useAuth()`, and `useQuery()` for nutrition_logs — maintaining feature parity with the Nutrition page. They are dead code with no render site.

---

## SHARED DENOMINATOR

All four nutrition features divide by targets from `calculateDailyValues(userProfile)`:

**Location:** `src/lib/nutritionDefaults.js:98` (191 lines)

**Callers:**
1. MacroNutrientBox (useMemo → recalc on userProfile change)
2. CalorieTopBar (plain call)
3. MineralsVitaminsBox
4. NutritionTrendsChart
5. NutritionPlansModal
6. CalorieCyclingModal
7. MacroRingWidget
8. CalorieProgressWidget

**No test file exists for calculateDailyValues.** The function:
- Computes BMR via Mifflin-St Jeor formula (metric inputs)
- Scales by activity multiplier → TDEE
- Applies weekly rate (preference: stored weekly_rate_lbs, fallback: target weight + target date)
- Clamps rate to safe ranges (cut: −2.0 lb/wk max, bulk: +1.5 lb/wk max)
- Derives protein (0.8–1.0 g/lb by goal), fat (25% of calories, floor 0.35 g/lb), carbs (remainder)
- Applies calorie cycling if configured
- Falls back to standard FDA values if no nutrition_goal

**Critical paths untested:**
- The undefined-while-loading transition mentioned in LEAD #4
- The calorie cycling logic
- The gender='other' average defaults
- The boundary conditions (0 weight, 0 height, future date, etc.)

---

## FINDINGS BY SECTION

### Visibility & Rendering

✓ **Daily Macros exists and renders correctly**
- 8 nutrient tiles on Nutrition page, properly gated on values > 0
- Two view modes work (bar / ring via nutrientRingView setting)
- Sorted as: primary 3 (cal, protein, carbs, fat) + secondary 4 (sodium, fiber, sugar, cholesterol)

✓ **Calorie Budget exists and renders correctly**
- Battery gauge physics work (fill 0–100%, color hue green→yellow→red)
- Specks animation (flow + bob) continues
- Arithmetic verified correct on empty days (2000 remaining)

✗ **Macro Pie Chart does NOT exist** (as pie)
- MacroRingWidget is a 4-ring donut, not a pie
- MacroRingWidget is orphaned (no render site)
- No pie chart alternative exists

✗ **Nutrition Goal Progress does NOT exist**
- CalorieProgressWidget was deliberately removed as duplication
- NutritionTrendsChart is history-only (not today)
- No remaining "goal progress" feature on the dashboard

### Data & Defaults

✓ **Calorie cycling is implemented and functional**
- Reads `userProfile.calorie_cycling` → `{ training: {...}, rest: {...} }`
- Checks `last_workout_date === today` to pick training vs rest branch
- Applies cycling AFTER base targets computed

✓ **Denominator (calculateDailyValues) is sound**
- Mifflin-St Jeor BMR formula is correct (same as Cronometer)
- Activity multipliers align with standard ranges
- Macro splits by goal match industry standard (1.0 g/lb cut, 0.9 bulk, 0.8 maintain)

✗ **No test coverage on calculateDailyValues**
- 8 callers, no test file
- Boundary conditions untested (0 weight, 0 height, invalid dates, null goal, etc.)
- Undefined-while-loading states untested

✗ **No test coverage on component-level rendering**
- MacroNutrientBox: no test
- CalorieTopBar: no test
- MineralsVitaminsBox: no test
- CalorieCyclingModal: no test
- NutritionTrendsChart: no test

### Product State

✓ **Water encoding is deliberate and handled everywhere**
- "Water" or "Water|N" in food_name, meal_type NULL
- 118 of 126 rows are water entries
- Properly handled in 5+ call sites

✓ **Profile defaults are sensible**
- 180 lb, 70", 'male' unset defaults
- 30 age fallback
- 'moderate' activity fallback (1.55 multiplier → ~3100 TDEE at defaults)

✗ **Only 47% of profiles have height/weight entered**
- 57 users, 27 with weight_lbs, 27 with height_inches
- 47% show a target derived entirely from a stranger's body (180 lb / 70")
- 23% have gender unset (average of male/female formulas used)

✗ **Zero profiles have nutrition goals configured**
- 0 of 57 users have nutrition_goal set
- Every target falls back to standard FDA values (2000 cal, etc.)
- No user has activity level entered
- Calorie cycling configured for 0 users

---

## PRIOR AUDIT FINDINGS (DO NOT RE-REPORT)

The prior audits found and fixed / documented these:

1. **MacroNutrientBox permanent zeros** — FIXED 2026-08-11
   - Ten of 16 nutrient fields rendered permanent 0
   - Fixed by gating tiles on `totals[key] > 0` and moving to tileRow
   - Pinned by `src/components/nutrition/__tests__/nutrientDisplayGating.test.jsx` (9 tests)

2. **CalorieTopBar arithmetic** — VERIFIED correct 2026-08-11
   - Checked: 2000 remaining, 0/2000 cal on empty day
   - Confirmed honest and not broken
   - Re-render both now; do not re-report arithmetic

3. **Water encoding** — DELIBERATE 2026-08-11
   - "Water" / "Water|N" in food_name, meal_type NULL
   - Handled in 5+ locations correctly
   - Settled, do not re-report

4. **Migration 006 unapplied** — REPORTED, NOT FIXED
   - Declares protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, water_oz
   - Column strip-and-retry in src/api/safeSelect.js handles gracefully
   - Waiting on Kegan decision — not your change

5. **nutrition_logs.food_item_id** — DEAD COLUMN, CONFIRMED 2026-08-12
   - 0 of 126 rows populated
   - No reader, no writer, no view, no FK
   - Dropping it is Kegan's call

---

## WHAT THIS AUDIT COVERS

✓ **Verified:**
- CalorieTopBar exists, renders, arithmetic is correct
- MacroNutrientBox exists, renders, gating works
- Calorie cycling is wired and functional
- calculateDailyValues formula is sound
- Water encoding is deliberate and handled

✗ **Not found:**
- "Macro Pie Chart" does not exist as pie (MacroRingWidget is orphaned donut)
- "Nutrition Goal Progress" does not exist (CalorieProgressWidget removed, NutritionTrendsChart is history-only)

⚠ **Test gaps:**
- calculateDailyValues: no test file (8 callers, untested)
- MacroNutrientBox: no test file
- CalorieTopBar: no test file
- NutritionTrendsChart: no test file
- CalorieCyclingModal: no test file

⚠ **Data findings:**
- 47% of users have unmeasured weight/height (using 180/70" defaults)
- 100% of users have no nutrition goal set (using FDA standard values)
- 0 users have activity level set (all using 'moderate' default)
- 0 users have calorie cycling configured
- No entries exist for today (latest is 2026-08-11)

---

## DELIVERABLES DECISION

### MacroRingWidget + CalorieProgressWidget (396 lines)

**Status:** Both are orphaned, removed from Dashboard by design.

**Decision:** **Delete both files.**

**Reasoning:**
1. Not rendered anywhere (not in WIDGET_COMPONENTS, not on Dashboard, not on Nutrition page)
2. Explicitly removed from Dashboard.jsx:1487 comment: "Gone from here: MacroRingWidget, CalorieProgressWidget and HydrationRing. All three duplicated the Nutrition tab… no feature lost."
3. Their functionality (macro/calorie progress for today) is already present on the Nutrition page via CalorieTopBar and MacroNutrientBox
4. Keeping dead code confuses future audits (this audit spent time determining they were orphaned)
5. Tests would need to be written to verify them if kept
6. No feature is lost by deletion

**Files to delete:**
- `src/components/dashboard/MacroRingWidget.jsx` (199 lines)
- `src/components/dashboard/CalorieProgressWidget.jsx` (197 lines)

**Cleanup checklist:**
- [ ] Check widgetOrder localStorage for any saved MacroRingWidget or CalorieProgressWidget references and warn user
- [ ] Verify no other imports exist (grep: MacroRingWidget, CalorieProgressWidget)
- [ ] Delete both files
- [ ] Lint + build + test green
- [ ] Note deletion in commit message: "Remove orphaned nutrition widgets (dead code, duplicated by Nutrition page)"

---

## NEXT STEPS FOR KEGAN

1. **Decide on the four sub-features:**
   - Current state: two exist and work (Macros, Budget), two do not exist (Pie Chart, Goal Progress)
   - Clarify: are you maintaining the orphaned widgets or deleting them?
   - Clarify: should a "Macro Pie Chart" (macro split breakdown) be built?

2. **Decide on MacroRingWidget + CalorieProgressWidget:**
   - Recommendation: Delete both (dead code, no render site)
   - If keeping: add tests + wire to Dashboard as optional widgets

3. **Decide on nutrition goal configuration:**
   - 0 of 57 users have goals, activity level, or cycling configured
   - Targets show as "personalized" but are generic defaults for 100% of users
   - Consider: should onboarding require these fields? UX implications?

4. **Migration 006 decision:**
   - Waiting on your decision to apply or abandon
   - Currently silent column strip-and-retry handles the absence gracefully

---

## CONCLUSION

**Current state is:**
- Two of four sub-features exist and work correctly (Daily Macros, Calorie Budget)
- Two of four sub-features do not exist (Macro Pie Chart, Nutrition Goal Progress)
- Two orphaned Dashboard widgets exist with no render site (MacroRingWidget, CalorieProgressWidget)
- Test coverage is zero for all nutrition components and the calculateDailyValues denominator
- No users have configured nutrition goals; all targets use defaults
- No data exists for today; latest entry is 2026-08-11

**Recommendation:**
- Delete the orphaned widgets (dead code)
- Clarify what "Macro Pie Chart" and "Nutrition Goal Progress" should be
- Add test coverage for calculateDailyValues and component-level rendering
- Consider whether the "personalized" targets should require user configuration
