# Audit — "Projected Goal Date" (Progress → Insights)

**Scope.** The goal-weight projection card in `src/components/progress/InsightsTab.jsx`
(lines ~196–250 storage, ~428–512 logic, ~792–911 render), plus everything it
depends on to be true: the `bodyMetrics` feed from `Progress.jsx`, `LogWeightModal`
as the only writer, `weightUnit.js` conversions, and the `insights.goal.*` i18n keys.

**Not in scope.** The `Goal` entity / `GoalsModal` / `GoalsList` family. That is a
different feature that happens to share the word "goal" — this card stores its
target in **localStorage**, not in the `goals` table, and the two never talk. Whether
that divorce is intended is question **F3** below; fixing it is not this audit.

**Method.** Every check states a CLAIM, the PROOF that settles it, and what FAILURE
looks like. A check is not passed by reading the code and finding it plausible —
CLAUDE.md's standing rule. Where a check needs the thing to actually render, use the
Vite stub-alias harness (jsdom paints nothing, so layout and empty-state defects
survive a green test suite).

Existing coverage to build on, not repeat: `src/components/progress/__tests__/insightsTab.test.jsx`
already has 6 goal tests (stone round-trip, per-user scoping, legacy-key migration,
invalid input, clear, and one projection case).

---

## A — Data path: does the card receive real weigh-ins?

**A1. `bodyMetrics` actually reaches the tab with rows in it.**
Claim: `Progress.jsx` fetches `BodyMetric` and passes it to `InsightsTab`.
Proof: read the `rawBodyMetrics` query and the `<InsightsTab>` props at
`Progress.jsx:1332`; then confirm against production that `body_metrics` holds
rows with a non-null `weight_lbs`. Per CLAUDE.md, `count(*)` vs `count(weight_lbs)` —
a denormalised-column zero here renders as the empty state and reads as "user
never logged", which is the exact failure shape that section warns about.
Failure: the tab is handed `[]` or rows whose `weight_lbs` is NULL on every row.

**A2. `weight_lbs` survives PostgREST's numeric-as-string.**
Claim: the `Number.isFinite(m.w)` filter at line 435 catches it.
Proof: unit test feeding `weight_lbs: '180.5'` (string) and asserting the
projection still computes. The comment at 433 says this was already a bug once.
Failure: string weights are dropped by the filter → fewer than 2 points → empty state.

**A3. `filterAfterReset` does not silently eat weigh-ins.**
Claim: post-account-reset filtering removes only pre-reset rows.
Proof: render with `userProfile.account_reset_at` set after some metric dates,
assert only the newer rows survive.
Failure: an off-by-one on the boundary drops a legitimate weigh-in, which at
exactly 2 entries collapses the whole card to the empty state.

**A4. `LOG_FETCH_LIMIT` ordering does not truncate the wrong end.**
Claim: the query orders `-date` (newest first) and takes N; `weighIns` re-sorts ascending.
Proof: read the limit value; reason about a user with more weigh-ins than the limit.
Failure: with `-date` + limit, a long-term user loses their OLDEST entries — so the
regression is fit over a recent window only. That may be defensible (recent trend is
more predictive) but it is currently **accidental**, not chosen, and the disclaimer
copy doesn't say it. Report as a finding either way.

---

## B — Projection math

**B1. The regression is right.**
Claim: `linearRegression` returns least-squares slope/intercept.
Proof: unit test with a known-answer series (exact linear, then noisy). Assert slope
and intercept to a tolerance. Include a 2-point series (the minimum the card accepts).
Failure: transposed sums, or `denom` sign errors.

**B2. `daysToGoal` is measured from the right origin.**
Claim: `addDays(firstDate, daysToGoal)` is correct because `reg.intercept` is
anchored at `x = 0 = firstDate`.
Proof: construct a series where the answer is known by hand — e.g. start 200 lb on
day 0, −0.5 lb/day, goal 180 → exactly day 40 → `firstDate + 40`. Assert the rendered date.
Failure: an off-by-one, or anchoring to `new Date()` instead of `firstDate`.

**B3. `directionMismatch` catches every wrong-way case, and only those.**
Claim: lines 467–469 flag trend-vs-goal disagreement.
Proof: table test over the four sign combinations {gaining, losing} × {goal above,
goal below}, plus `goalDirection === 0` (goal exactly equals current weight).
Failure: the `=== 0` guard means a goal EQUAL to current weight is never a mismatch —
verify what that renders instead (see B4).

**B4. ⚠ SUSPECTED DEFECT — "Already reached! 🎉" is claimed on a goal not reached.**
Line 849 branches on `daysFromNow > 0`; anything else prints "Already reached! 🎉".
But `daysFromNow` is derived from the **regression line**, not the user's actual
latest weight. With noisy data the fitted line can cross the goal while the last real
weigh-in has not — so the card says "Already reached! 🎉" directly above a
"Remaining: 4.2 lb" stat it computed from the real numbers.
Proof: build a weigh-in series where `reg` crosses the goal in the past but
`currentWeightLbs` is still short of it; render and assert both strings.
Failure = both strings present. Correct behaviour is to gate the congratulation on
`currentWeightLbs` having actually reached `goalLbs` (direction-aware), and to say
something else — "behind your trend" — when only the line has crossed.

**B5. Boundary: `daysFromNow === 0` (goal projected for today).**
`differenceInDays` truncates, so a projection landing today yields 0 → falls into the
"Already reached!" branch. Proof: fixed-clock test with a projection dated today.
Failure: today's projection is announced as already achieved.

**B6. `ratePerWeek` converts correctly in every unit.**
Claim: `formatWeight(ratePerWeek, unit, 1)` renders a rate.
Proof: assert the rendered string for lbs / kg / stone at a known slope.
Failure: `stone` at 1 decimal — 1 lb/week is 0.07 stone/week and renders "0.1 stone",
so every slow-but-real rate collapses to the same number. Precision, not correctness;
report as minor.

**B7. The projection is not extrapolated absurdly far.**
Claim: none — there is no cap.
Proof: a near-flat slope just above the 0.001 threshold with a distant goal. At
slope 0.0011 lb/day the projection is ~decades out.
Failure: the card confidently prints a date in 2071. Needs a horizon cap with an
honest message past it.

---

## C — State, persistence, units

**C1. ⚠ SUSPECTED DEFECT — the goal is dropped when `userId` is undefined.**
`saveGoalWeight` early-returns on a falsy `userId` (line 243). `userProfile` arrives
from an async query, so on a cold load `userProfile?.id` is `undefined` for the first
render(s).
Proof: render with `userProfile = {}`, type a goal, press Set, then re-render with a
real id. Assert whether the goal persisted and whether the user was told it didn't.
Failure: Set shows "Goal weight saved" (line 504 fires unconditionally) while
`saveGoalWeight` wrote nothing — a success toast over a discarded write, which is the
toast-policy failure shape CLAUDE.md documents.

**C2. Unit switching round-trips without drift.**
Claim: the effect at 310–313 re-formats from stored lbs on unit change.
Proof: set 12 stone → switch to kg → switch back. Assert the input and the "Goal"
pill agree and the stored lbs is unchanged.
Failure: rounding to 1 dp per hop accumulates.

**C3. `goalRevision` genuinely re-reads storage.**
Claim: the two `eslint-disable` memos at 447 and 487 are load-bearing.
Proof: set a goal and assert the projection block appears without a remount.
Failure: stale projection until navigation.

**C4. Per-user scoping holds across an account switch mid-session.**
Already covered for the write path; extend to: user A sets a goal, `userId` changes to
B in the same mount, assert B does not see A's goal.

**C5. localStorage unavailable (private mode / quota).**
Claim: try/catch at 244 swallows it.
Proof: stub `localStorage.setItem` to throw. Assert the app does not crash — and
assert what the user is told.
Failure: "Goal weight saved" over a throw. Same shape as C1.

---

## D — Empty and edge states

**D1. ⚠ SUSPECTED DEFECT — the flat-trend case renders nothing at all.**
When `weighIns.length >= 2` but `|slope| < 0.001`, `projection` is `null` (line 457).
The render then shows the goal input and **nothing else** — no date, no explanation.
A user with stable weight sets a goal, presses Set, gets a success toast, and the card
stays blank. That is indistinguishable from a broken feature.
Proof: render two weigh-ins at the same weight; assert on what is on screen.
Failure = no message. Needs an explicit "your weight is holding steady — no trend to
project from" state.

**D2. Same-day weigh-ins (`denom === 0`) reach the same dead end.**
`linearRegression` returns null → `projection` null → blank card. Proof and fix as D1.

**D3. The `needsGoal` state says nothing either.**
Line 461 returns `{ needsGoal: true }` and the render only draws when `!needsGoal`.
Verify the input alone is enough of a prompt, or whether it needs a line of copy.

**D4. Exactly 2 weigh-ins.**
The stated minimum. Proof: assert a projection renders and the disclaimer is present.
A 2-point regression is a line through two points with zero confidence signal — check
whether the disclaimer copy is honest enough at n=2.

**D5. The empty-state CTA lands somewhere that works.**
`navigate('/dashboard?logWeight=1')` → `Dashboard.jsx:1056` consumes the param and
opens `LogWeightModal`. **Verified reachable by reading both ends** — still needs the
round trip driven in a browser (E2 below), because "the param is read" is not "the
modal opens and the row lands".

---

## E — Render + round trip (browser, not jsdom)

**E1. Render the card in the stub-alias harness** at 375×667 and 430×932. Assert
no overflow, and that the three-stat row (Current / Goal / Remaining) does not wrap
into the divider rules at the narrow width with 3-digit stone values.

**E2. End-to-end: log two weights → see a projection.**
Drive the real app: Progress → Insights → "Log your weight" → LogWeightModal → save
→ back to Insights. Repeat for a second date. Assert the card leaves the empty state
and prints a date. This is the check the user actually asked for; everything above
exists to explain a failure here.
Per memory: `preview_start` only ever serves `~/flexyn2`, so run `vite --root` against
a worktree and open it with `preview_start({url})`.

---

## F — Copy, i18n, product

**F1. Every `insights.goal.*` key exists in `i18n-insights.js` with an English value**,
and no call site uses the banned `t(key) || 'English'` form. `i18nRawKeys.test.js`
should already cover the latter — confirm it covers this file.

**F2. Count-aware `insights.goal.daysAway.one/.other` resolve.**
`tCount` builds the key by suffix. Proof: assert both branches render real copy, not
a raw key path. Per CLAUDE.md, test with a stub that IGNORES the English fallback and
interpolates the template — every stub in this repo returns the pre-interpolated
fallback and is blind to a missing `{rate}` / `{n}`.

**F3. Product question, not a bug: this goal lives only on this device.**
It is localStorage, per-user, never synced. Reinstall the PWA, switch phones, or
clear site data and the goal is gone with no warning — while the app has a `goals`
table one tap away. Worth a decision from Kegan; not something to "fix" unasked.

---

## Execution order

1. **B, C, D as unit tests** — fastest, and B4/C1/D1 are the three suspected real
   defects. Extend `insightsTab.test.jsx`.
2. **A against production SQL** — cheap, and settles whether anyone has the data
   to hit this card at all.
3. **E in the browser** — last, because it is the slowest and the tests above will
   have already named what to look at.
4. Report findings; fix only what is confirmed.

---

# RESULTS — run 2026-08-11

39 tests green on branch `goal-projection-audit` (15 new, in the `Goal projection`
describe). **The new tests are CHARACTERIZATION tests: they assert what the card
does today, so they pass on the bug and will fail on the fix.** Invert them as part
of any fix — do not read "39 passing" as "the feature is correct".

## Confirmed defects

| # | Severity | What happens |
|---|---|---|
| **B4** | **High** | "Already reached! 🎉" is decided from the fitted LINE, not the user's latest weigh-in, so it prints directly above a "Remaining 5 lbs" stat that contradicts it. Reproduced on the live production rows. |
| **D1** | **High** | Flat trend (`\|slope\| < 0.001`) → `projection` is null → a card titled *Projected Goal Date* renders **only** an input. Setting a goal returns a success toast and draws nothing. |
| **D2** | **High** | All weigh-ins on one day (`denom === 0`) → identical blank card. |
| **C1** | **Medium** | `saveGoalWeight` early-returns on a falsy `userId`, which is the state during the async profile load — but `toast.success('Goal weight saved')` fires unconditionally. Success reported over a discarded write. |
| **C5** | **Medium** | Same shape when `localStorage.setItem` throws (private mode / quota): the catch is silent, the success toast is not. |
| **B6** | **Medium** | The pace figure is formatted at 1 decimal in the display unit, so any slow-but-real rate renders **"0.0 /week pace"**. Not stone-only as drafted — B7's screenshot shows `0.0 lbs/week`. The card claims zero progress while printing a date. |
| **B7** | **Medium** | No horizon cap. A slope just past the 0.001 cutoff renders **"Feb 12, 2076 · 18,081 days away"** with a straight face. |
| **B2b** | **Low** | `differenceInDays` truncates against local-midnight dates, so the "N days away" line reads one lower than the date printed above it (19 vs a date 20 days out). |
| **E1** | **Low** | At 375px the 🎉 in "Already reached! 🎉" wraps onto its own line and collides with the trend indicator. |

## Checks that PASSED

`A1` (`weight_lbs`, `created_by` and `user_id` all populated 4/4 — no
denormalised-zero problem) · `A2` (numeric-as-string handled) · `A4` (not a real
risk: `LOG_FETCH_LIMIT` is 1000 against 4 rows) · `B2` (projection correctly
anchored to the first weigh-in) · `B3` (direction mismatch flagged) · `B3b` (goal
equal to current weight legitimately reads as reached) · `C2` (unit round-trip, no
drift) · `C3` (goal applies without a remount) · `D4` (two weigh-ins suffice,
disclaimer shown) · `D5` (`/dashboard?logWeight=1` is consumed at `Dashboard.jsx:1056`) ·
`F1` (all 21 `insights.goal.*` keys present in English) · `F2` (both plural
branches interpolate).

**Not a defect, checked and cleared:** the 699 lb production row is inside
`LogWeightModal`'s 70–700 lb guard, which exists and works. It is tester data at
the boundary, not a validation hole.

## The finding that outranks all of the above

**3 of 57 profiles have ever logged a body weight, and exactly ONE clears the
two-entry bar** — so 56 of 57 users see the empty state, and the entire live
population of the projection is a single account whose data is 699 lb → 140 lb in
15 days. The card is not broken *in production* so much as unreached. Every defect
above is real and worth fixing, but the first product question is why nobody logs a
weight, not why the projection is wrong for the one person who did.

## Not done

**E2 (full authenticated round trip) was NOT run.** It needs a sign-in, and entering
credentials is something I don't do. Everything E2 would have proven about rendering
is covered by the harness (`harness.html` + `src/harness.jsx` on the audit branch,
`npx vite --port 5199`, seven fixtures); what remains unproven by me is the
LogWeightModal → `body_metrics` → card refresh path end to end on a real session.
That one is worth ten minutes of yours.
