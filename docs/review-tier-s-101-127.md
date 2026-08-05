# Acceptance review — features #101–127 (final band)

Run 2026-08-05 against `main` and the production database. This is the tail of
the list — the sheet has 127 rows, so this closes it out.

Almost all of it is **A tier · Ambient**: the small primitives, hooks and
signature details that don't have their own screen. That makes it a different
kind of review from the last three. There is very little here that can be
"broken" in the sense of throwing — the failure mode for ambient features is
that they exist and nobody ever encounters them.

Which is exactly what the one bad grade turned out to be.

---

## Headline

**#110 — the tooltip registry declares five one-shot hints and mounts one.**
Four hidden gestures that each need teaching are shipped with no teaching. The
registry's own header says how to add one, in two steps; step 2 was never done
for four of the five.

Everything else in this band is genuinely good, and two items are the best
implementations reviewed anywhere in the 127.

---

## Workout tail (#101–102)

### #101 `W75` — Starter plan view
**GRADE: A** — `StarterPlanView.jsx` present and wired.

### #102 `W9` — "Complete exercise" one-tap
**GRADE: A** — `markComplete()` in `ExerciseLogger.jsx`, and it auto-fires when
`allSetsDone`. The one-tap is a shortcut, not the only path — completing every
set gets you there without the tap, which is the right relationship between the
two.

---

## App shell (#103–105)

### #103 `SH15` — One-shot tooltip teaching the long-press gesture
**GRADE: A** — Mounted in `Layout.jsx` on the nav tab, `TOOLTIP.LONG_PRESS_TABS`,
fires once per device. This is the one that works, and it is why the
`···` hint was removed from the tab (see the comment there) — one legible
teaching moment instead of permanent 5px noise. Correct call.

### #104 `SH28` — Keyboard-inset hook
**GRADE: A** — `useKeyboardInset.js`, 3 consumers, all composers.

### #105 `SH6` — Haptic pulse on tab tap
**GRADE: A** — `triggerHaptic('light')` on tab tap, `'primary'` reserved for
higher-intent actions. Two weights, used deliberately.

---

## Dashboard (#106–109)

### #106 `D20` — Workout streak banner
**GRADE: A** — Present.

### #107 `D25` — Daily quote, prev/next, editable rotation
**GRADE: A** — `ChevronLeft` / `ChevronRight` controls, an `editMode` prop, and
a local-midnight rollover computed properly (`next local midnight + 1s`, floored
at 1000ms) rather than a fixed 24h timer that would drift.

### #108 `D47` — Stat tiles with vs-last-week trend arrows
**GRADE: A** — `WeeklyRecap.jsx` renders `TrendingUp` in `text-success` and
`TrendingDown` in `text-destructive` against the previous 7 days.

### #109 `D53` — Trophy check on load
**GRADE: A** — Fires once per dashboard mount per user, with an explicit
unmount guard so a route change or sign-out mid-check doesn't fire a
celebration onto the next screen. That guard is the part people forget.

---

## Design system (#110–115)

### #110 `UI10` — OneShotTooltip + tooltip registry
**GRADE: D — the registry is real; four fifths of it is dead.**

`tooltipRegistry.js` declares five IDs. A grep for `OneShotTooltip` across the
whole app returns **one** mount site.

| ID | Teaches | Feature exists? | Mounted? |
|---|---|---|---|
| `LONG_PRESS_TABS` | hold a nav tab for shortcuts | yes | **yes** |
| `WORKOUT_SMART_PASTE` | paste `225 x 8` into the weight field | yes — `SetRow.jsx` | **no** |
| `PR_PROXIMITY_BAR` | what the new bar on set rows means | yes — `PRProximityBar.jsx` | **no** |
| `DM_DOUBLE_TAP` | double-tap a message to react | yes — `HubChat.jsx` | **no** |
| `STREAK_FLAME_TAP` | tap the flame for streak details | **no `onClick` on `StreakFlame`** | **no** |

Three of the four orphans point at real, shipped, entirely invisible gestures.
Smart paste is the worst of them: parsing `225 x 8` out of the clipboard is a
genuinely good feature that no user will ever discover by accident.

The fifth is different — `STREAK_FLAME_TAP` describes a gesture that doesn't
exist. `StreakFlame.jsx` has no click handler. So that entry is either a
tooltip for an unbuilt feature or a leftover from one that was removed.

The registry header spells out the two steps: append a constant, then mount the
component. Step 1 was done five times and step 2 once. Nothing enforces the
pair, and an unmounted tooltip is invisible by definition — there is no error,
no warning, and the feature it was meant to teach still works for anyone who
already knows about it.
**FIX:** Mount the three that have features. Delete or build the fourth. Add a
test asserting every registered ID has a mount site. **S**

### #111 `UI2` — BottomSheet
**GRADE: A** — 5 consumers.

### #112 `UI22` — Haptic helper with named patterns
**GRADE: A** — 25 consumers. Named weights, not raw `navigator.vibrate` calls
scattered around.

### #113 `UI3` — MobileSelect
**GRADE: B** — Real component, 5 consumers, all in the gyms/equipment area.
Correct but narrowly adopted for something ranked as a design-system primitive;
most selects elsewhere are still native or Radix.

### #114 `UI4` — FormattedNumberInput
**GRADE: B** — Exists, **2 consumers**. The thinnest adoption in the band. Not
wrong, but it is a primitive in name more than in practice.

### #115 `UI9` — EmptyState + illustrations
**GRADE: A** — 22 consumers.

---

## Gamification (#116–121)

### #116 `GA20` — Atomic capsule open + server-authoritative rolls
**GRADE: A** — `open_capsule_atomic` present. Production shows the system
genuinely in use: **174 capsules opened, 119 unopened**, three capsule types
(standard / premium / elite) and a 75-row loot catalog spanning **seven**
rarities (common → uncommon → rare → epic → legendary → mythic → animated).
The rarity ladder in #88 is the client-visible half of this and they agree.

### #117 `GA47` — StreakFlame with intensity by length
**GRADE: A** — 5 consumers.

### #118 `GA50` — Reward queue serializing multi-celebration moments
**GRADE: A** — and this needed checking rather than counting. Two consumers,
both in `Workout.jsx`, looks like under-adoption for a queue meant to stop
celebrations colliding. It isn't: I mapped where all seven celebration helpers
fire from, and `Workout.jsx` is the **only** surface where two can land on the
same action (a first workout that also sets a PR). `GoalsModal` fires two
helpers but on mutually exclusive branches. The queue is used at exactly the
one place overlap is possible.

### #119 `GA51` — Particles / theme animation layer
**GRADE: A** — `ThemeAnimationLayer.jsx` present.

### #120 `GA52` — "Six celebration helpers, each with a distinct signature"
**GRADE: A — and there are seven, not six.** Every one carries a genuinely
distinct vibration pattern; no two collide:

| Helper | Pattern |
|---|---|
| `goalCelebration` | `[15, 50, 15]` |
| `firstGoalCelebration` | `[10, 30, 80]` |
| `firstMealCelebration` | `[12, 30, 12, 30, 12]` |
| `firstRegimenCelebration` | `[15, 45, 15, 45]` |
| `firstWorkoutCelebration` | `[20, 60, 20, 60, 80]` |
| `prCelebration` | `[40, 80, 40, 80, 40, 80]` |
| `crewWinCelebration` | `[20, 50, 20, 50, 20, 50, 80]` |

Seven for seven distinct. The discipline CLAUDE.md asks for is actually being
followed — this is the cleanest "we said we'd do X and did X" in the whole
review. Both the sheet ("six") and CLAUDE.md's table (five + PR) predate
`crewWinCelebration` and undercount.

### #121 `GA9` — Level reward schedule (migration 263)
**GRADE: A** — `grant_level_up_rewards` present, and its ledger rows show it
firing in production.

---

## Notifications (#122)

### #122 `NT18` — ~33 notification types wired to push
**GRADE: A.** The largest single claim in the whole sheet, and it holds up.

`notification_type_category()` maps **41** types across seven categories, and
every category key is **singular** (`streak`, `quests`, `league`, `social`,
`achievements`, `engagement`, `competitive`) — the exact thing migration 083 had
to repair after 065 regressed it to plurals. It did not regress again.

**Every one of the 41 has a producer.** I checked each type string against both
`src/` and `supabase/`; none is a mapped-but-unreachable entry.

**Checked and NOT reported, because the obvious reading is wrong:** only 14 of
the 41 types have ever been inserted in production. That looks damning until you
account for the beta — 49 profiles, a handful active. Crew wars, gauntlets,
trades and league resolutions simply haven't happened yet. Absence of rows here
is not evidence of a broken wire, and the producer check above is the test that
actually settles it.

**Same for the streak-break reminder,** which has produced **zero** rows since
migration 035. The cron gates on `workout_streak >= 2 AND
timezone_offset_minutes IS NOT NULL`. Production: 43 of 49 profiles have a
timezone, and **zero** currently have a workout streak of 2 or more. The
eligible pool is empty, so an idle cron is correct behaviour, not a third silent
cron. (I went looking for one — this codebase has produced two already.)

**One observation, not a defect:** the break warning protects the **workout**
streak only. Five users hold a login streak of 2+ and none of them can receive a
break warning for it. Whether the login streak deserves one is a product call.

---

## Resilience (#123–125) and Workout chrome (#126–127)

### #123 `RS20` — Scroll position + restoration hooks
**GRADE: A** — `useScrollPosition.js` and `useScrollRestoration.js`.

### #124 `RS28` — Body-scroll lock hook
**GRADE: A** — `useBodyScrollLock.js`.

### #125 `RS29` — Autofocus-on-open hook
**GRADE: A** — `useAutofocusOnOpen.js`.

### #126 `W16` — Live volume pill
**GRADE: A** — And its motion-value subscriber is the reason it stays cheap
while you type; see the note left on it during the #26–50 batch.

### #127 `W17` — Workout elapsed-time chip
**GRADE: A** — `WorkoutElapsedChip.jsx` over a shared `elapsedClock` module, so
the chip and the duration autofill on save read the same clock rather than two
that can drift.

---

## Summary

**Grades:** A ×24 · B ×2 · D ×1.

The strongest band of the four, and not by accident — ambient features are
small enough to finish, and most of these were. Two deserve specific credit:
the **seven celebration helpers** are seven-for-seven on distinct haptic
signatures, which is a convention that survives only if every contributor
honours it; and **#122's 41 notification types** all map to singular categories
with a real producer behind each, in the exact place a documented past
regression had occurred.

**The one failure is the shape this band is prone to.** Nothing in #110 is
broken. `OneShotTooltip` works, the registry works, the four unmounted hints
would work the moment they were mounted, and the gestures they teach all
function for anyone who knows about them. The feature simply never reaches a
user. That is what "ambient" fails like — not an exception, an absence.

It also rhymes with the other three bands more than it first appears. Storage
GC reported success while collecting nothing; 28 toasts were dropped with no
error; and here, four hints are registered, documented, and never rendered.
**Every time, the mechanism is present and the outcome is missing**, and every
time the reason nobody noticed is that the failure produces silence rather than
a signal.

**Best improvement-per-hour:**
1. Mount `WORKOUT_SMART_PASTE`, `PR_PROXIMITY_BAR` and `DM_DOUBLE_TAP` (#110).
   Three real features go from invisible to discoverable.
2. Resolve `STREAK_FLAME_TAP` — build the tap or drop the entry.
3. Add the test that a registered tooltip ID must have a mount site, so step 2
   can't be skipped again.
4. Correct the "six celebration helpers" count in the sheet and CLAUDE.md to
   seven (#120).
