# Audit 20 — Progress page, main view

**Date:** 2026-08-10 · **Branch:** `progress-audit-high-four`
**Scope:** `src/pages/Progress.jsx` (1,237 LOC at audit time) — the page shell
and everything on screen before a tab is tapped, plus the two surfaces that
file renders into modals (Personal Bests, the analytics charts). Requested as
a pass over the page *before* going into its subpages, so `InsightsTab`,
`ProgressPhotosTab`, `MuscleGroupHeatmap`, `GroupedExerciseTrends`,
`WorkoutCalendarGrid` and `PRHistoryModal` are **out of scope** and unaudited.

Audit **and** fix pass. All 13 findings shipped across three commits.

---

## Summary

**13 findings: 4 high · 4 medium · 5 low. All 13 fixed.**
Three more candidates were killed on inspection — see *Killed* below.

The page's defect signature is unusually consistent, and worth naming because
it predicts where to look next: **nothing here was broken, and nothing threw.**
Every one of the four high findings renders a plausible number or a plausible
label. A cardio count that silently survives an account reset, a workout total
that freezes at 200, a pounds figure labelled "lbs" to a kg user, and English
muscle names in a 15-language app all look exactly like working software. The
page had no way to show you it was wrong.

**The four worth caring about:**

1. **`cardioLogs` never went through `filterAfterReset`** — the one list on the
   page that skipped the reset filter, so a reset left cardio behind.
2. **Every lifetime stat was computed from a 200-row slice**, with nothing on
   screen saying the history had been truncated.
3. **The Weekly Review printed lbs at kg users**, on the one page where every
   other volume already respected `weightUnit`.
4. **The muscle pills rendered raw database strings**, untranslated, while the
   same file already looked them up properly twice.

### Coverage — read before trusting anything below

Static: `npm run lint`, `npm run build` (vite-build-guard active), `npm run
test`. Green at every commit; 3,752 tests across 268 files at the end.
Production data was queried read-only over MCP for the claims that depend on
it (see *What production actually holds*).

**Not verified in a browser, on any of the three commits.** This is the gap in
this report and it is not a small one — the i18n pass alone rewired ~55 call
sites and moved four visible labels, and none of that has been seen rendered.
Two different blocks: the first two commits found all five dev-server slots
held by other chats, and stopping one of theirs was not mine to do; on the
third a slot had freed and the server started clean, but the Browser pane
returned `Policy check in progress` for every tool — navigate, read_page,
console, screenshot — across several retries. **Anyone picking this up should
open `/progress` first.** The highest-risk change to eyeball is the frame
label row and the tab bar, because those are the strings whose length changed.

**Penpot was unreachable throughout** (the MCP plugin timed out on a bare
`1 + 1`), so the requested UI suggestion for this page was never produced.

---

## Findings

| # | sev | where | issue | fix |
|---|---|---|---|---|
| 1 | high | Progress.jsx queries | `cardioLogs` was the only list not passed through `filterAfterReset`. `logs`, `regimens` and `bodyMetrics` all were. It fed the "Cardio" tile and was handed unfiltered to `InsightsTab`, so after an account reset the page kept counting sessions the reset was meant to erase. The filter is a defensive layer for a half-failed backend delete; a layer with one hole is not a layer. | Filtered like the other three. |
| 2 | high | `WorkoutLog.filter(…, 200)` | Every lifetime stat — workout count, Personal Bests, Top PRs, Insights' "training since" — derived from a 200-row slice, where `db.js` defaults to 1000. Past 200 sessions the count freezes, the oldest PRs drop off, and the training-age start date is really the user's 200th-newest session. Nothing said "last 200". | Raised to 1000 via `LOG_FETCH_LIMIT` in `src/lib/constants.js`. Hoisted to a constant because `BodyMetricsTab` shares the `['workoutLogs', email]` query key — React Query serves both from one cache entry and whichever mounts first supplies the queryFn, so two different limits make the row count depend on mount order. |
| 3 | high | Weekly Review card | `d.volume_lbs` printed raw under a hardcoded `lbs` suffix. Every other volume on the page already respects `weightUnit`. (Carried over from audit 11 #17, still open.) | `fromLbs(…, weightUnit)` + `{weightUnit}` label. `volume_change_pct` is a ratio and stays as-is. |
| 4 | high | muscle pills | Rendered `{g}` straight from the column, untranslated, while the same file does `t('muscleGroups.' + muscleKey(g))` for the charts and the filter dropdown. Also deduped by the raw string, so `Chest` and `chest` drew two pills for one muscle. `MUSCLE_PILL`'s `'full body'` key could never match once `muscleKey` normalised it to `fullBody`. | Deduped by `muscleKey`, labelled with `tFallback('muscleGroups.<key>', raw)`, map rekeyed. All ten keys already ship in 15/15 languages. |
| 5 | med | whole main view | ~55 hardcoded English literals — the hero carousel, timeframe stats card, last-workout callout, Top PRs rail, tab bar and Weekly Review summary. Everything on the first screen except the page title and the two buttons above the carousel. | Extracted to `src/lib/i18n-progress.js`, all call sites on `tFallback`. |
| 6 | med | muscle-pill empty state | "No workouts logged this week." was gated on the pill set being empty, not on there being no workouts — so a session whose exercises carry no `muscle_group` rendered "1 Workout" and "No workouts logged this week" one line apart in the same card. | Gated on `frameLogs`. With workouts but no muscle data it now renders nothing. |
| 7 | med | `FRAME_LABELS` | The toggle filters a **rolling** window (7 days back from now) while the label claimed a calendar period — and the Weekly Review card one scroll below is a real ISO week printing "Week 32, 2026". Two things on one screen said "this week" and meant different spans. | Labels moved to match the code: `Last 7 Days` / `Last 30 Days` / `Last 365 Days` / `All Time`. See *Decisions* for why this direction. |
| 8 | med | `isLoading` | `userProfile` was outside the skeleton gate, so the page painted a complete-looking hero from the `= {}` default — "Start today" and "Lv 1" at someone with a 40-day streak — until that query landed. Streak and Level have no other source. | Added to the gate. Also closes the window where `filterAfterReset` ran before the reset timestamp arrived. |
| 9 | low | dead wiring | `ProgressCarousel` was a `forwardRef` exposing `.goToId(id)` for stat tiles that have since moved into the Advanced Analytics modal — which takes them as data and holds no handle on the carousel. The whole chain was inert, with a comment describing the caller as though it existed. Plus `carouselRef`, `tabsBarRef`, `distanceUnit`, `dateLocale`, and the `language` that only fed `dateLocale`. | All removed. See *Decisions* on why deleted rather than reconnected. |
| 10 | low | `frameCardio` | Summed `distanceMeters`, `durationSeconds` and `calories` on every frame change; the card shows one number and nothing read the other three. The `weeklyCardio` alias kept "for backward compat" had exactly one caller and said "weekly" while holding whichever frame was selected. | Reduced to `frameCardioSessions`, a count. Alias gone. |
| 11 | low | tab-bar comment | Described a `flex-1` row that overflow-scrolls on mobile. The code under it is a 2×2 grid. A comment describing code that is gone is worse than no comment — it reads as the intent. | Rewritten, and now records why `grid` is correct here per CLAUDE.md (the count is a fixed 4 from `TAB_META`, not decided by data, so there is no partial row for `tileRow()` to centre). |
| 12 | low | `AnalyticsTab` charts | The max-weight series carried a second value under the key `'Max Weight (lbs)'` that no axis, line or tooltip read — a hardcoded unit in a key name is exactly what a kg user must not be shown, so this was one careless `dataKey` from being a bug rather than dead weight. The volume `XAxis` also carried `inputMode="decimal"`, an `<input>` attribute on an SVG axis. | Both removed. |
| 13 | low | `?tab=` effect | Missing `navigate` in the deps (lint warning). | Added; `useNavigate` is stable so the effect does not re-run. The `replace` that strips the param stays and now says why. |

**Result: `Progress.jsx` lints with zero warnings, down from three.**

---

## Killed before reporting

Recorded because the reasoning is the reusable part, per CLAUDE.md's "a raw
count is a question, not a conclusion".

- **PR weights compared as strings.** `map[ex.name].weight = s.weight` seeds
  the accumulator at number `0`, so if the column ever yielded a string the
  map would hold one and the *next* comparison would be lexicographic —
  `'90' > '135'` is true. Two independent write paths coerce
  (`Number(s.weight) || 0` in both `Workout.jsx` and `EditWorkoutModal.jsx`),
  which is the real evidence. **The data is not evidence here:** the entire
  database holds two sets, both `number`. Treat this as *unproven*, not
  disproven — if a third write path is ever added, it must coerce.
- **`topPRs` sorted in lbs while displayed in kg.** Sort order is invariant
  under a positive scalar conversion, so the ordering is identical in every
  unit. Not a bug. (Audit 11 #16 flagged the same line and reached the same
  conclusion; kept here so a third pass doesn't spend the time again.)
- **`parseLocalDate` returning `null` in the frame filters.** `null >= date`
  coerces to `0 >= t` → false, so a malformed date is excluded rather than
  crashing. Degrades correctly. The one place it would surface is
  `daysSinceLast`, which would render "NaN days ago" — left alone as a
  genuine edge case nobody has hit, and now behind an i18n template.

---

## What production actually holds

Queried read-only over MCP on 2026-08-10. Relevant because three findings
would have been sized wrong without it.

| Fact | Measured | Why it matters |
|---|---|---|
| `user_profiles.total_volume_lbs` > 0 | **1 of 44** (max 4,995) | The Volume figure therefore comes from `calcVolume(logs)` for essentially everyone, and switches data source the first time the credit RPC fires for a user. `reconcile_my_workout_volume` exists to heal the drift, so this is a spot-check rather than a fix — but the two-source read is worth knowing about before trusting that number. |
| `workout_logs` total | **3 rows** | Finding 2 (the 200-row cap) is entirely latent. No user is near it. It is still a real defect and cheap to fix, but nobody is currently seeing it. |
| set `weight` / `reps` jsonb type | **2 of 2 `number`** | Sample too small to prove anything. See *Killed*. |

---

## Fix log

| Commit | Findings | Files |
|---|---|---|
| `7b7e14ce` | 1–4 | `Progress.jsx`, `BodyMetricsTab.jsx`, `constants.js` |
| `79878c68` | 5–8 | `Progress.jsx`, **new** `i18n-progress.js`, `i18nCoverage.test.js` |
| `e28e7e0d` | 9–13 | `Progress.jsx` |

All three pushed to `main` by fast-forward. **No SQL — frontend only**, all
three.

### The i18n ratchet fired, and that is the guard working

Commit two failed `i18nCoverage.test.js` on first run: 61 new English-only
keys grow the denominator and dropped `es` to 78.6% against a 79% floor.

Resolved by adding **eleven narrow prefixes** to `AWAITING_TRANSLATION`
(`progress.tab.`, `.frame.`, `.frameShort.`, `.stat.`, `.carousel.`,
`.slide.`, `.lastWorkout.`, `.topPRs.`, `.pb.`, `.analytics.`, `.review.`)
rather than a bare `progress.`, for the same reason `league.gate.` is narrow:
`progress.` would also exempt the ~96 keys in that namespace that **are**
translated and hide a future regression in them. The floor was not touched.
The companion test — every prefix must still match untranslated keys —
passes, so none of the eleven is a no-op, and it will force each line to be
deleted as its translations land.

**Three strings needed no new key at all.** `progress.today`,
`progress.yesterday` and `progress.all` already shipped in all 15 languages
and had simply stopped being called, while this file hardcoded the same three
words in English a few lines away. Those call sites point back at them.
`progress.ago` stays deliberately unused: it is the bare word "ago", and
gluing a count onto a bare preposition puts the words in English order in
every language, so the N-days case took a whole template instead.

---

## Decisions worth re-opening

Three calls made without asking. Each is cheap to reverse.

1. **Frame labels changed rather than frame behaviour** (finding 7). Rolling
   windows are the better product here — a Monday morning reading "This Week:
   0 workouts" is demoralising and true of nobody's training — so the copy
   moved to match the code. Making them real calendar periods instead is a
   one-line change to `FRAME_DAYS` and the labels revert with it.
2. **Tab labels stayed short, English-only** (finding 5). `progress.tabs.*`
   already ship translated in 15 languages, so reusing them was free — but
   they read "Exercise Trends" / "Body Metrics" / "Progress Photos", copy
   written for a list with room rather than four pills in a 2×2 grid. Taking
   the free translations would have relabelled the tab bar, which is a design
   change. New short keys instead. Reversible if the longer labels are wanted.
3. **The `goToId` bridge was deleted, not reconnected** (finding 9). The
   comment described stat tiles jumping the carousel when tapped; those tiles
   now live inside a modal that sits *in front of* the carousel. Reconnecting
   means designing an interaction, not restoring one.

---

## Open — not fixed, not in scope

- **Browser verification of all three commits.** The single most useful thing
  the next session can do.
- **The Penpot UI suggestion** for this page, still outstanding.
- **The subpages.** `InsightsTab` (710 LOC) is the largest unaudited surface
  here, then `ProgressPhotoCapture` (456) and `MuscleGroupHeatmap` (434).

  A note on where NOT to start: audit 11 raised six findings against
  `InsightsTab`, and this report nearly listed two of them as outstanding.
  Both are fixed — the goal-weight unit flip (#7) has a `useEffect([weightUnit])`
  and the "Already reached 🎉" direction bug (#23) has a trend check, each
  with a comment naming the audit number it closed. Grepping for the symptom
  found the string and would have re-reported both; reading four lines up
  found the fix. Assume the rest of audit 11's Progress findings landed too
  and verify before re-raising any of them.
- **The 61 new keys need a native pass in 14 languages**, tracked by the
  eleven prefixes above.
