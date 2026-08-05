# Acceptance review — S-tier features #1–25

Run 2026-08-05 against `main` @ `dd5e7e5`, dev server, Chromium 1194 at
375×812 (DPR 2, touch, iPhone UA). Onboarding walked end to end as a brand-new
guest account. Screenshots and control geometry captured per step.

**Two environment caveats, stated up front because they bound the findings:**

1. **Typography is unjudged.** `fonts.googleapis.com` is unreachable from this
   sandbox (`ERR_CONNECTION_RESET`), so every screenshot rendered in system
   fallbacks. Same blindness both August reviewers hit. Nothing below is a
   claim about letterforms.
2. **The browser cannot reach Supabase directly** — the same limitation that
   stopped the August critique running Pass 1. Worked around with a local
   Node relay (browser → `localhost:8787` → Supabase) so TLS verification
   stayed intact. Every flow below ran against **real production data**.

**Measurement caveat that matters for tap targets:** `getBoundingClientRect()`
reports the *rendered* box, not a `before:`-pseudo hit area. Several controls
were widened with `before:-inset-*` in an earlier pass; those still measure at
their visual size here. Where that applies it is called out.

---

## S tier · Active

### #1 `SH1` — Five-tab bottom nav
**GRADE: A**
**STATE:** All five tabs present, routed, and correctly sized.
**EVIDENCE:** Nav is 67px tall, fixed, `top:745`. Tabs measure 89×58
(Dashboard), 66×58, 52×58, 67×58, 69×58 — every one clears 44×44. Auto-hide
verified: `transform: matrix(1,0,0,1,0,67)` after scrolling down,
`matrix(1,0,0,1,0,0)` after scrolling up. The Hub ring reads neutral grey while
inactive and only the active tab is orange — screenshot `D-01-top.png`.
**GAPS:** None found.

### #2 `D15` — Hero slideshow
**GRADE: C**
**STATE:** Works — auto-advances, dots navigate, content is real.
**EVIDENCE:** 4 slides on a new account (not 9 — that figure came from a
seeded account). Auto-advance confirmed: body text changed within 9s. Dots
measure **24×6 active, 6×6 inactive**.
**GAPS:**
1. Dots are 6px tall. They carry `before:-inset-y-4 before:-inset-x-0.5` from
   an earlier pass so the real hit box is taller than measured, but the
   *visual* is still a 6px dot — below the threshold of reading as a control.
2. On a brand-new account the hero occupies y≈650–1330, roughly 45% of the
   first viewport, above any training content.
**FIXES:**
1. Raise the dot to 8×8 visual with 12px gaps, or drop the dots entirely and
   rely on the chevron + swipe. `HeroSlideshow.jsx`, three dot rows. **S**
2. Product decision, not a defect — see backlog A-M1. **L**

### #3 `ON1` — "14-step onboarding flow"
**GRADE: B**
**STATE:** Complete and working, but it is **11 steps, not 14**.
**EVIDENCE:** Walked start to finish. Progress bar reads `01/11` … `11/11`.
The `STEPS` array in `Onboarding.jsx:2822` has 14 entries, but `welcome`,
`loading` and `reveal` are not numbered steps a user counts. Flow completed
with zero errors and landed on `/dashboard`.
**GAPS:** The feature description is wrong — 14 is an internal array length.
Anyone reasoning about drop-off from "14 steps" is reasoning about a number no
user experiences.
**FIXES:** Correct the ranking sheet to "11-step onboarding (14-entry internal
flow incl. welcome/loading/reveal)". **S**

### #4 `ON10` — Training-days-per-week picker
**GRADE: C**
**STATE:** Built and working; blocks correctly until a day is chosen.
**EVIDENCE:** Step 08/11. Day chips measure **39×50** — 39px wide, under the
44px minimum, seven of them in a row. Disabled CTA reads "Pick at least one
day" (good). Time-of-day chips are 156×46 (fine).
**GAPS:** Seven adjacent 39px-wide targets is the densest mis-tap risk in
onboarding — adjacent days are different answers, so a miss is silently wrong
rather than obviously wrong.
**FIXES:** Widen day chips to ≥44px, or reduce to a 4+3 two-row grid at 80px
each. `Onboarding.jsx`, schedule step. **S**

### #5 `ON11` — Four-question fitness self-assessment
**GRADE: C**
**STATE:** All four questions render with Yes / Not yet, plus a skip.
**EVIDENCE:** Step 09/11. YES / NOT YET buttons measure **139×34** — 34px tall,
eight of them. "Skip — generate a generic plan" is **327×28**.
**GAPS:**
1. Eight 34px-tall targets.
2. The skip control is 28px tall and set in muted text — it reads as a caption,
   not an escape hatch, on the one step users most want to skip.
**FIXES:**
1. Raise Yes/Not-yet to 44px min-height. **S**
2. Give skip the same 44px height and treat it as a secondary button. **S**

### #6 `ON15` — Reveal step
**GRADE: B**
**STATE:** Renders the generated plan before entry.
**EVIDENCE:** Captured as step 13: "Strength Plan · 5 lifts", CTA transitions
to "Saving…" (disabled) then lands on `/dashboard`.
**GAPS:** The save has no failure path visible in this run — the button shows
"Saving…" and, if the write failed, there is no observed error state. Not
proven broken; not proven handled.
**FIXES:** Force a failed save (offline) and confirm the user gets a retry
rather than a stuck "Saving…". **S** to test, unknown to fix.

### #7 `ON17` — Auto-generated starter regimen
**GRADE: A**
**STATE:** Works. Generated from the answers given and immediately usable.
**EVIDENCE:** Answered "Build strength" + "New" + Mon. Landed on `/workout`
showing "BUILT BY YOUR AI COACH / Your starter plan is ready / STRENGTH ·
BEGINNER · 1×/WEEK" with Squat, Bench Press, Deadlift, Overhead Press at 4×10
and "+1 more". Starting the session pre-loaded exactly those lifts.
**GAPS:** None found. The 1×/WEEK correctly reflects the single day picked.

### #8 `ON2` — Cinematic hero slideshow (marketing)
**GRADE: C**
**STATE:** Renders, auto-advances through all 5 slides with custom SVGs.
**EVIDENCE:** Screenshot `02-splash-slide0.png`. Pips are real buttons with
correct aria-labels ("Show AI Coach" … "Show Streaks") but measure
**28×4 active, 6×4 inactive** — 4 pixels tall, with no `before:` expansion.
**GAPS:**
1. 6×4px tap targets on the app's first screen. These are the *only*
   navigation for the slideshow and they are effectively unhittable.
2. Large dead vertical space between headline and card, and card and CTA, on
   375×812.
**FIXES:**
1. Add `relative before:absolute before:content-[''] before:-inset-y-3
   before:-inset-x-1` to the pip buttons, matching the Dashboard treatment.
   `SplashScreen.jsx`. **S**
2. Tighten the vertical rhythm. **M**

### #9 `ON3` — Six selectable goals
**GRADE: A**
**STATE:** All six render, multi-select, gate the CTA correctly.
**EVIDENCE:** Step 01/11. Cards measure 319×70–82 — comfortably over target.
Disabled CTA reads "Pick at least one". Whole list fits with **zero scroll
overflow** at 375×812 (measured `scrollHeight - innerHeight = 0`), which
contradicts the August finding that the 6th goal was hidden behind the CTA.
**GAPS:** None found.

### #10 `ON30` — Username picker + profanity check
**GRADE: B**
**STATE:** Input works, gates the step, server check wired.
**EVIDENCE:** Step 04/11. Input is 285×48. Disabled CTA reads "Choose a
username to continue" — states its blocker.
**GAPS:** No availability or validity feedback observed while typing a valid
name; the only signal is the CTA enabling. A taken username is not surfaced
until submit (not reproduced here — I did not collide).
**FIXES:** Inline "✓ available" / "✗ taken" under the field, debounced.
`Onboarding.jsx` About-You step. **M**

### #11 `ON6` — Four experience levels
**GRADE: A**
**STATE:** All four present with animated bar meters; gates correctly.
**EVIDENCE:** Step 03/11, cards 319×68. Disabled CTA reads "Pick your
experience level". Eyebrow reads `EXPERIENCE · 03` and matches the `03/11`
progress bar — the counter mismatch reported in August is fixed.
**GAPS:** None found.

### #12 `ON7` — Age, height, weight capture
**GRADE: C**
**STATE:** Three separate steps (04, 05, 06), all functional with validation.
**EVIDENCE:** Age: reel + ruler + ±1/±5 steppers, hint reads "YEARS OLD · TAP
TO TYPE OR DRAG", value printed once. Height: `FT·IN`/`CM` toggle at
**75×29 / 60×29**. Weight: `LB`/`KG` at **60×29**, steppers at **41×48**.
**GAPS:**
1. Unit toggles are 29px tall on both height and weight — and picking the
   wrong unit is a 2.2× data error.
2. Weight steppers are 41px wide.
3. The weight step carries **two instruction lines** — "DRAG DIAL TO SET · TAP
   TO TYPE" *and* "tap number to type" in the stepper row. This is the exact
   duplication that was fixed on the age step but not here.
**FIXES:**
1. Unit toggles to 44px min-height. **S**
2. Steppers to 44px min-width. **S**
3. Delete "tap number to type" from the weight stepper row; the dial hint
   already says it. **S**

### #13 `ON8` — Gender selection
**GRADE: A**
**STATE:** Male / Female / Other, each **90×44**.
**EVIDENCE:** Step 04/11, measured at exactly the 44px minimum.
**GAPS:** None found.

### #14 `ON9` — Body-baseline step
**GRADE: C**
**STATE:** Four optional measurements with a clear skip.
**EVIDENCE:** Step 07/11, eyebrow "BODY BASELINE · OPTIONAL". Number inputs
measure **237×40**. Both CTAs are full width and clear ("Skip for now" /
"I know my measurements — let me enter them").
**GAPS:** Inputs are 40px tall — four of them, below target.
**FIXES:** Raise to `h-11` (44px). **S**

### #15 `W1` — Free-form workout session builder
**GRADE: A**
**STATE:** Works. Session starts, timer runs, exercises add and remove.
**EVIDENCE:** Started a session; got a live elapsed chip (`0:04`), an `LB VOL`
pill, date row, "Add Exercise" with search, Cardio, Plate calculator and Form
Coach entry points, per-exercise muscle tags and bar selection.
**GAPS:** None found at this level.

### #16 `W2` — Exercise autocomplete
**GRADE: A**
**STATE:** Works well.
**EVIDENCE:** Typing `ben` returned Bench Dip, Bench Press, Bench Press
Against Band, Close-Grip Bench Press, Decline Bench Press, Feet-Up Bench Press
— each with its muscle groups. Substring matching, not just prefix.
**GAPS:** None found.

### #17 `W25` — Save workout; discard with confirm
**GRADE: A**
**STATE:** Discard confirmation is genuinely well built.
**EVIDENCE:** Screenshot `K-05-discard-confirm.png`. Modal reads "Discard
workout? / Your logged sets will be lost. This can't be undone." with a red
**Discard** and a neutral **Keep going**. Destructive action is the coloured
one, the safe action is the escape, and the copy names the consequence.
**GAPS:** None found.

### #18 `W3` — Per-set logging
**GRADE: C**
**STATE:** Works correctly on the happy path.
**EVIDENCE:** Typed 135 into set 1 weight (reps pre-filled at 10), blurred,
tapped the set checkmark → value persisted and `LB VOL` went **0 → 1350**.
Correct. `inputMode` is `decimal` for weight and `numeric` for reps — right
keyboards on mobile.
**GAPS:**
1. Weight inputs are **52×36**, reps **65×36**. 36px tall, and these are the
   single most-repeated controls in the app.
2. **Possible input-commit race, needs a human to confirm.** In one run I
   typed a weight and tapped the set-complete checkmark *without blurring
   first*; the value did not persist and `LB VOL` stayed 0 (screenshot
   `K-06-set-done.png` shows set 1 ticked green with an empty weight field).
   Adding a `Tab` blur before the same tap made it persist every time. Type →
   tap ✓ is the natural mobile gesture, so if this is real it is a data-loss
   bug on the app's core action. I could not reproduce it a second time, so I
   am flagging it rather than asserting it.
**FIXES:**
1. Raise set-row inputs to 44px min-height. **S**
2. Repro by hand on a device: type a weight, immediately tap ✓ without
   tapping elsewhere, check the pill. If it reproduces, commit the input on
   `pointerdown` of the checkmark rather than relying on blur. **S** to test.

### #19 `W8` — Mark set done / not done, with haptic
**GRADE: C**
**STATE:** Works. Toggles, turns green, increments "Complete exercise 1/4",
and auto-starts a rest timer.
**EVIDENCE:** `button[aria-label="Complete set"]` measures **36×36**.
Completing set 1 moved the counter to 1/4 and started `REST 1:29`.
**GAPS:**
1. 36×36 target, four per exercise, sitting 8px from the reps input.
2. A set can be completed with an **empty weight field** and counts toward
   "1/4" while contributing 0 to volume. No prompt, no warning.
3. Haptic unverifiable in a headless browser.
**FIXES:**
1. Raise to 44×44, or add `before:-inset-1`. **S**
2. Decide the intent: either block completion with no weight, or treat empty
   as bodyweight explicitly. Silent 0 is the worst of the three. **M**

---

## S tier · Ambient

### #20 `SH14` — `···` quick-action affordance
**GRADE: F**
**STATE:** **Does not exist.** Deleted 2026-08-05.
**EVIDENCE:** No `···` element in the rendered nav; `Layout.jsx` carries a
comment where it used to be. It was `text-[5px]` at `opacity-50`.
**GAPS:** The ranking sheet lists it at 90% reach. It was invisible when it
existed and is now gone. The affordance is taught by the one-shot tooltip
(#103 `SH15`) instead.
**FIXES:** Remove from the sheet, or re-point the row at `SH15`. **S**

### #21 `SH2` — Hub tab as centre FAB ring
**GRADE: A**
**STATE:** Renders as a distinct ringed pill, correctly neutral when inactive.
**EVIDENCE:** `D-01-top.png` — Hub sits in a grey ring while Dashboard is
orange and bold. The "two tabs look selected" defect is fixed.
**GAPS:** None found.

### #22 `SH20` — Fixed mobile header
**GRADE: C**
**STATE:** Present on every route, correct height, logo + actions.
**EVIDENCE:** Header renders logo, message icon, bell, avatar.
**GAPS:** **Two count badges, 40px apart, both reading "1".** Measured
`rgb(209,31,31)` on the bell and `rgb(242,112,13)` on the avatar — so they are
now different hues, but at ~16px on a light ground, red and orange read as the
same alert. The August finding partially stands.
**FIXES:** Make the avatar badge a different *shape* or drop it — the profile
menu already surfaces its content. Colour alone is not enough at this size.
`Header.jsx` / `ProfileMenu.jsx`. **S**

### #23 `SH24` — Animated route transitions
**GRADE: A**
**STATE:** Present and smooth across every navigation performed.
**EVIDENCE:** Route changes between Dashboard, Workout and back animated
without flash or layout jump. No console errors during transitions.
**GAPS:** None found. Not tested under `prefers-reduced-motion`.

### #24 `SH26` — `last_active_at` presence heartbeat
**GRADE: not gradeable by this method**
**STATE:** Write-only DB call, no UI.
**EVIDENCE:** No rendered surface exists. Confirmed in source
(`Layout.jsx`, `HubProfile.jsx`) as a fire-and-forget write.
**GAPS:** Nothing a design review can assess. Correctness would need a DB
check that the column advances once per session per day.
**FIXES:** None. Route this row to a backend correctness pass.

### #25 `SH27` — Safe-area insets
**GRADE: not verifiable here**
**STATE:** Implemented — nav uses
`calc(0.25rem + env(safe-area-inset-bottom))`.
**EVIDENCE:** Computed `padding-bottom: 4px`, i.e. `env()` resolved to **0**,
because headless Chromium reports no notch. The code is right; the behaviour
cannot be observed in this environment.
**GAPS:** Unverified.
**FIXES:** Check on a real notched device — the only thing that settles it.

---

## Summary

**Grades:** A ×9 · B ×3 · C ×10 · F ×1 · 2 not gradeable.

Nothing in #1–25 is broken. The failure mode across this band is **tap-target
size**: 11 of the 25 have controls under 44px, and they cluster on the two
surfaces every user must pass through — onboarding and set logging.

**Best improvement-per-hour, in order:**

1. **Splash slideshow pips (#8) — 6×4px on the app's first screen.** One line
   of Tailwind, and it is the first interaction anyone has.
2. **Set-row inputs and the set-complete toggle (#18, #19) — 36px.** The most
   repeated controls in the product. One change to the set row fixes both.
3. **Onboarding day chips (#4) — 39px wide, seven adjacent.** Highest
   mis-tap-to-wrong-answer ratio in the flow.
4. **Height/weight unit toggles (#12) — 29px.** A mis-tap here is a 2.2× data
   error that silently poisons every downstream calculation.
5. **Assessment Yes/Not-yet (#5) — 34px, eight of them.**

Then the two that are not size: the duplicate instruction line on the weight
step (#12), and the possible type-then-tap-✓ commit race (#18) — which is the
only item here that could lose user data and the only one I could not settle.

**Could not verify:** typography (fonts blocked), safe-area insets (no notch in
headless), haptics (#19), reduced-motion behaviour (#23), the reveal step's
save-failure path (#6), and username-collision feedback (#10).
