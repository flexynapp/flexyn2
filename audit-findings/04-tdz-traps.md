# TDZ trap audit — `no-use-before-define` violations

**Date:** 2026-05-25 overnight pass
**Tool:** `npx eslint src/ --rule '{"no-use-before-define":["error",{...}]}'`
**Result:** 46 violations across 8 files.

## TL;DR

**No production-crash-risk TDZ patterns found.** Every violation falls into the
**"closure captures lazy"** category — the identifier is referenced inside a
callback / handler / JSX body that runs AFTER all `const` declarations have
executed in the render pass. The 2026-05-23 Hub crash pattern (const referenced
**inside a hook deps array**) does not appear in any of the 46 violations.

The flagged code works at runtime but is bad hygiene — when the parallel session
eventually moves `no-use-before-define` from `warn` to `error` (per CLAUDE.md
roadmap), these will need cleanup.

## Severity classification

All 46 → **low** (code-hygiene only, no runtime risk).

## Top offenders by file

| Count | File | Identifier(s) |
|---|---|---|
| 22 | `src/components/body-metrics/MuscleDiagram.jsx` | `styles` (21x), `BODY_PATHS` (1x) — all in JSX return |
| 5  | `src/components/hub/HubComposer.jsx` | `renderPrivacyButtons` (called 5 times from earlier JSX branches before its declaration) |
| 3  | `src/components/hub/HubProfile.jsx` | `noteLiked`, `trophyCase`, `trophyVisible` (inside handler callbacks) |
| 3  | `src/components/stories/StoriesRow.jsx` | `cleanupPreview` (in 3 effect-cleanup callbacks) |
| 3  | `src/pages/Nutrition.jsx` | `lookupAndShow`, `stopScanner` (2x) (inside handler callbacks) |
| 1  | `src/components/journal/JournalView.jsx` | `stopDictation` (NEW code from origin/main, in `goToDay` useCallback body) |
| 1  | `src/components/dashboard/DailyQuestsCard.jsx` | `handleClaimResult` (in another handler) |
| 1  | `src/components/hub/HubPostCard.jsx` | `postBody` (line 446 inside `handleSaveMeal`; declared at 523) |
| 1  | `src/components/workout/FirstWorkoutTutorial.jsx` | `handleDismiss` (in `handleNext`) |
| 1  | `src/components/workout/WorkoutGeneratorModal.jsx` | `handleClose` (in keydown listener inside useEffect) |
| 1  | `src/pages/MyGyms.jsx` | `refresh` (in `joinWithCode` handler) |
| 1  | `src/components/cardio/CardioLiveTrackerOutside.jsx` | `pause` |

## Verification methodology

For each violation, I built the line context (8 lines before + the violation
line) and grep-checked whether the identifier appears inside a `[...]` deps
array of `useEffect` / `useMemo` / `useCallback`. **Zero hits.**

The dangerous pattern would look like:

```jsx
useEffect(() => { ... isMine ... }, [..., isMine]);  // ← evaluated synchronously
// ... 80 lines later ...
const isMine = post.author_email === user?.email;   // ← declared too late
```

The pattern we DO see is:

```jsx
const handleSave = () => { ... uses postBody ... };  // ← closure: lazy lookup
// ... later ...
const postBody = post.body || '';                    // ← declared in time for click
```

## New violation added by the parallel session

**`src/components/journal/JournalView.jsx:117 — stopDictation`**

This is new code in the journal overhaul (commit `e2a1e46`). `goToDay`
(useCallback at line 114) calls `stopDictation()` (defined at line 182).

```jsx
const goToDay = useCallback(async (d) => {
  if (format(d, 'yyyy-MM-dd') === dateStr) return;
  await flush();
  stopDictation();          // ← line 117: TDZ-flagged
  setActiveDate(d);
  loadDay(d);
}, [dateStr, flush, loadDay]); // eslint-disable-line react-hooks/exhaustive-deps

// ... 65 lines later ...
const stopDictation = () => { ... };  // ← line 182
```

Safe at runtime (closure), but: (a) the eslint-disable on the deps array masks
that `stopDictation` should be in deps, (b) it adds a new violation to the
pile that CLAUDE.md says new code should avoid.

**Suggested fix:** Hoist `stopDictation` (and `startDictation`) above `goToDay`.
Then remove the eslint-disable and add `stopDictation` to the deps array.

## Recommended action

- **Now:** none required (no crash risk).
- **Pre-error-upgrade cleanup:** start with `MuscleDiagram.jsx` (one file, 22
  fixes — move `styles` const block above the return JSX). Then `HubComposer`,
  then the smaller ones.
- **Going forward:** keep the audit guard active in CI as `warn` for now; flip
  to `error` only after the existing 46 are cleaned.

## Notes for future audits

Re-running this exact command will catch new violations cheaply:

```bash
npx eslint src/ \
  --rule '{"no-use-before-define":["error",{"functions":false,"classes":true,"variables":true,"allowNamedExports":true}]}' \
  --no-inline-config \
  | grep -E "no-use-before-define" | wc -l
```

Current baseline: **46**. Any new code that pushes this number up should be
flagged in review.
