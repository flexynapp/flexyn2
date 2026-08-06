# Audit 19 — Onboarding polish pass

**Date:** 2026-08-06 · **Branch:** `claude/onboarding-audit-prompt-ogfrgq` ·
**Brief:** [`docs/onboarding-polish-audit-prompt.md`](../docs/onboarding-polish-audit-prompt.md)
**Scope:** `src/pages/Onboarding.jsx` (3,897 LOC, 13 steps) + `i18n-onboarding.js`,
as a stranger's first run from the welcome screen to their first Dashboard.

Audit **and** fix pass — Phase 2 ran. Everything unambiguous is fixed in the
same commit as this report.

---

## Summary

**12 findings: 2 high · 7 medium · 3 low. Eleven fixed, one reported.**
Seven more candidates were killed before they reached this table — see
*Killed* below, which is the more useful half of the pass.

The flow is in good shape. The fluid scale is doing its job: eleven of the
thirteen steps fit a 375×667 iPhone SE with room to spare, and nothing runs
under the home indicator anywhere. What's left is one real data bug, one
grammar bug on the single most-read sentence in the flow, and a set of small
inconsistencies that read as unfinished rather than broken.

**The three worth caring about:**

1. **"Skip — no injuries" saved the injuries anyway.** Reproduced end to end.
2. **The payoff screen said "dialled in for a advanced lifter."**
3. **Four tap targets were under the WCAG floor**, including the only
   destructive control in the flow at 26×23px.

### Coverage — read before trusting anything below

Driven **live** in Chromium at 375×667, 393×852 and 430×932 against the real
`Onboarding.jsx`, with only the auth and network edges stubbed (a signed-in
user with an empty profile; a no-op Supabase client that records writes
instead of performing them). Step order, CTA gating, transitions and layout
are the shipped ones.

**The frame loop was working** — `requestAnimationFrame` fired, Framer
animated, `AnimatePresence` completed its exits, and all thirteen steps were
reachable. That is the thing audit 18 could not get, and it is why the
measurements here cover the whole flow rather than the welcome screen.

**Production was not touched.** No account created, no profile written, no
gym promoted. The only database access was read-only `information_schema` over
MCP to confirm the payload's columns and types.

Not covered: real iOS/Android hardware, the software keyboard, VoiceOver,
`prefers-reduced-motion` behaviour beyond confirming the flow has none, and
the OAuth round trip through `SignInToContinue`.

Gate after the fixes: **lint 0 errors**, production build clean with the
`Onboarding` chunk emitted, **2,933 tests passing across 212 files** (+5 new).

---

## Findings

Verified: `live` reproduced in the browser · `sql` proven against the database ·
`code` read-only.

| # | Sev | File:line | Scenario | Observed | Fix | Verified |
|---|-----|-----------|----------|----------|-----|----------|
| 1 | **high** | Onboarding.jsx:3863 | User logs injuries, changes their mind, taps **"Skip — no injuries"** | `onSkip={next}` — it advances without clearing. `data.onboardingInjuries` survives, so the rows are still INSERTed into `injury_logs` at submit **and** still reach `ensureStarterRegimen`, which drops muscle groups for injuries the user just said they don't have. Reproduced: logged Chest + Legs, tapped Skip, both rows were handed to the insert. This is audit 18 #4's defect exactly; the fix reached `assessment` and `home_gym` and missed the third sibling | Clear before advancing, like the other two | **live** |
| 2 | **high** | Onboarding.jsx:2942 + i18n-onboarding.js:254 | Any user who picks **Advanced** | The reveal's one dominant element read **"A 12-week build strength block, dialled in for a advanced lifter on 3 days."** The article is hardcoded in the template and two of the four level labels start with a vowel. It is the last thing a user reads before committing | Pluralise — "for {level} lifters" drops the article in every language at once, rather than teaching an English a/an rule to a string 14 other locales have to translate | **live** |
| 3 | medium | Onboarding.jsx:2728 | Any user on any of the 14 non-English locales, on the home-gym step | **"Browse map"** was the one hardcoded user-facing string left in the flow — every other string on that step goes through `tFallback`. It is also the escape hatch for anyone the radius search can't serve | Add `onboarding.homeGym.browseMap` | **code** |
| 4 | medium | Onboarding.jsx:1174 | Every user, every time they pick an experience level | The meter's four bars animate `background` — the *shorthand*, which reads back from the DOM as `"rgba(0, 0, 0, 0) none repeat scroll 0% 0% / auto padding-box border-box"` and Framer cannot interpolate. So the bars **snap** to their colour instead of animating, and each pick logs **4** `not an animatable value` warnings. The `height` half of the same animation worked throughout, which is why the snap read as a rendering glitch rather than a missing transition | `backgroundColor` | **live** |
| 5 | medium | Onboarding.jsx:861, 954, 987, 2570 | Anyone with average-sized thumbs | Four controls under the WCAG 2.5.8 24px floor or well under Apple's 44px: goal's **Clear** at 21.8px, the twelve sharpen **chips** at 31.5px, sharpen's **TimeInput** at 40px, and injury's **Remove ×** at 26×23 — the only destructive control in the flow and the smallest thing in it | Chips and inputs grew for real; Clear and Remove grew via `::before`, because real height put those two steps into overflow (see *Fix log*) | **live** |
| 6 | medium | Onboarding.jsx:1661, 2016, 2325 | Anyone who taps the big number to type instead of dragging | The hero number **resizes the moment you touch it**, by a different amount on each of the three steps and each phone. Measured at 375×667: age **53.4px → 96px** (grows 80%), height **53.4px → 32px** (shrinks 40%), weight **64px → 48px**. Weight's display was also the only one of the three not on the fluid scale, so on an SE it rendered *larger* than age's | All six sizes read `--fluid-hero` — "the one big number on a step", per its own definition in index.css | **live** |
| 7 | low | Onboarding.jsx:431 | Every form step | The back button carried `backdrop-blur-sm` and `rounded-xl`. CLAUDE.md bans glassmorphism outright and pins the radius set to `sm/lg/2xl/full`; the carousel 250 lines below had its `backdrop-filter` removed citing that exact rule. This was the last one left, and it renders on all ten form steps | `bg-card` opaque, `rounded-lg` | **code** |
| 8 | medium | Onboarding.jsx:1163-1177 | SE-sized phone, user picks an experience level | Opening the meter pushed the step **36px past the fold** on a 375×667 (box 514px, content 550px), so the fourth option card was half-hidden right after the user had been asked to choose among four. The card carried **four fixed pixel values** on the one step in the flow that overflowed: 40px of vertical padding, an 80px bar chart, and two `mb-4`s that are both in the 12–20px spacing register CLAUDE.md bans outright | All four now read the fluid scale, via a new `--fluid-meter: clamp(56px, 9vh, 80px)` in index.css alongside the existing single-purpose `--fluid-panel` / `--fluid-scrubber`. Then the duplicated heading came out (#9). **SE: 36px over → 33.8px slack.** i15 104.3 → 126.1, Pro Max 169.2 → 186.0 | **live** |
| 9 | medium | Onboarding.jsx:1232 | Every user, the moment they pick a level | The meter card was headed by the level's **name** at `text-2xl` — repeating the option card 8px below it, which the user had just tapped and which already carries that name, an accent border and a check. The card's loudest element was the one thing on it the user could not need. `text-2xl` is also not one of the six named type steps, and at 24px it matched `--fluid-heading`'s floor: a confirmation chip rendering at page-heading size, directly under the actual page heading | Removed rather than shrunk — fixing the hierarchy by subtraction. The card keeps the only thing it ever knew that nothing else did (what the level means for the program) and that sentence takes the card's voice at `text-body`. Recovered another 25px on an SE | **live** |
| 10 | low | Onboarding.jsx:1371, 2480, 2973, 3812 + 1300 | — | Comment drift from the 14-step era: "step 10 of 14", "step 09 of 14", "eleven steps", "all eleven steps", and an assessment comment describing 4 questions when there are 5. In a codebase whose reasoning lives in comments, drift is the thing that makes the next reader distrust all of them | Corrected to the real counts | **code** |
| 11 | low | Onboarding.jsx:3287, App.jsx:266-274 | — | `hasFullProfile` reads `user?.training_days_per_week`. **That column does not exist** on `user_profiles` — confirmed against the live schema. The term is permanently `undefined`, so it contributes nothing to an OR that reads like a safety net. Harmless today because five sibling terms are real | Report only — the fix belongs with App.jsx, which is outside this pass | **sql** |
| 12 | low | Onboarding.jsx — whole file | A user with the OS "Reduce Motion" toggle on | The flow has **no** `prefers-reduced-motion` handling anywhere, while eight other components in the app do. It is the most animation-dense surface in the product: thirteen keyed step transitions, word-by-word heading reveals, a 4.9s loading theatre and confetti | Report only — needs a decision on what the reduced-motion flow should *be*, not a blanket disable | **code** |

---

## Killed before reporting

Seven candidates died on inspection. Recording them because each one looks
exactly like a finding until you check, and the next auditor will raise them
again.

| Candidate | Why it isn't real |
|---|---|
| **"The final CTA is permanently dead after a username collision."** `handleRevealNext` sets `submittingRef.current = true`, and the duplicate-username and profanity branches `return` early without resetting it — so a second submit should no-op forever | A `return` from inside `catch` **runs the `finally` block first**, and `finally` resets the ref. Reading the two branches without the block that follows them makes this look like a hard signup blocker |
| **"Carousel pips are 4px tap targets."** Five of them, on the first screen | `before:absolute before:-inset-y-5` gives them a **44px** effective height. Measured. Their ~14px effective width is marginal, but they are redundant with swipe and auto-rotation |
| **"The peeking carousel card overflows the viewport by 279px"** | Its direct parent is `overflow-hidden`. Measured the ancestor chain — clipped by design, that is what makes it *peek* |
| **"The age ruler overflows horizontally by 332px"** | Same shape: a translated tick track inside a masked, `overflow-hidden` box |
| **"The reveal step overflows 244px on an SE"** | It is a `flex-1 overflow-y-auto` box holding a generated exercise list. A scroll box that scrolls is not a defect; the CTA sits outside it and stays pinned |
| **"The profile is saved twice — `updateMe` fires two times."** | The second call is `setWeightUnit` persisting the unit preference. Traced the stack |
| **"`npm run build` only emits `push-sw.mjs` — the app isn't building."** | `logLevel: 'error'` in vite.config.js suppresses the main build's asset table, so only the PWA plugin's separate rollup run prints. `dist/assets/Onboarding-*.js` emits normally |

---

## Vertical fit — measured, all 13 steps × 3 devices

Every step driven to its **worst case** (every goal, every day, every time
slot, all five assessment answers, five injuries logged). `overflow` is
content below the fold in the step's scroll box; `slack` is empty room.
Post-fix numbers.

| Step | SE 375×667 | i15 393×852 | Pro Max 430×932 |
|---|---|---|---|
| welcome | fits (CTA 89.7px clear) | fits (92.5) | fits (94.2) |
| goal | **+23.6 slack** | +112.3 | +197.5 |
| sharpen | +38.7 | +188.0 | +270.6 |
| experience | **+33.8** (was −36, #7 + #9) | +126.1 | +186.0 |
| age | **+17.8 slack** | +137.3 | +198.4 |
| height | +51.5 | +117.7 | +150.3 |
| weight | +98.7 | +226.5 | +329.5 |
| days | +85.2 | +213.0 | +336.0 |
| assessment | +47.9 | +177.0 | +246.9 |
| injury_history | −6 (5 logged, the cap) | +75.6 | +147.8 |
| home_gym | +121.5 | +297.8 | +370.0 |
| reveal | scrolling list | scrolling list | scrolling list |

The CTA clears the viewport bottom on every step on every device (16px on the
SE, 18.7 on the i15, 20.5 on the Pro Max — that is `.safe-page` doing its job).
**No step's worst case is the middle phone**, so nothing is sized against the
wrong axis.

CLAUDE.md's claim that the goal step "went from 131px over to a 24px gap" on
the SE is **confirmed at 23.6px**.

---

## Fix log

Nine fixed, all carrying an `(Onboarding polish #n)` comment at the call site.

**One fix had to be redone**, and it is the useful part of this log. Growing
`Clear` and `Remove ×` with `min-h-11` — the obvious fix — put the goal step
**6px into overflow** and the injury step **96px** into it, because those two
steps have the least room in the flow and `Remove` renders once per logged
injury. Re-measuring caught it. Both now grow via `::before`, the technique
the carousel pips in the same file already use: a 44px hit area at zero
layout cost. Verified effective sizes: Clear **70.6×43.8**, Remove
**47.1×48**, chips **49.1×44**, TimeInput **64×44**.

A fourth target was **deliberately left alone**: injury's "Skip — no injuries"
at 36px tall. It is 327px wide and full-bleed — the easiest thing on the step
to hit — and `min-h-11` there is 8px taken straight off the scroll box on the
step that can least afford it. It clears the WCAG minimum; the three that were
fixed did not.

New guard: `src/pages/__tests__/onboardingSkipClears.test.js` (5 tests) asserts
that **every** optional step's `onSkip` clears its own field, and that no
template strands an article before `{level}`. Source-level, because nothing in
the repo renders `Onboarding.jsx` — the seven existing step tests are all
`readFileSync` assertions, which is precisely why finding #1 survived a green
suite for as long as it did.

---

## Audit 18 regression spot-check

Not the full 26-row triage — this pass touched fifteen of them, and those are
what is reported here. The remaining eleven were not re-verified.

| Audit 18 | State | Evidence |
|---|---|---|
| #1 username `ilike` wildcard | fixed | `escapeLikePattern(u)` at :3416 |
| #2 `075 KG` reel padding | fixed | `NumberReel` takes no `digits` prop |
| #3 age ruler blank tail | fixed | ticks derive from `AGE_MIN`/`AGE_MAX` |
| **#4 skip persists anyway** | **regressed** | Fixed on `body_baseline` (since deleted), `assessment` and `home_gym` — **still live on `injury_history`**. This pass's finding #1 |
| #5 home-gym dead CTA | fixed | CTA swaps to Skip when nothing is picked |
| #6 zero i18n | fixed | 237 keys; one string missed — finding #3 |
| #8 resolve-with-`{error}` trap | fixed | both inserts re-throw at :3632, :3651 |
| #9 `"511"` height parse | fixed | `parseHeightInput`, tested |
| #10 `pointercancel` opens keypad | fixed | `onGaugeCancel` is separate |
| #12 username threshold split | fixed | both read `MIN_USERNAME_LENGTH` |
| #13/#14 clamps and numeric types | fixed | `PROFILE_RANGES` / `DB_CHECK_BOUNDS` |
| #19 username-only redirect | fixed | `hasFullProfile` gate at :3283 |
| #23 anon draft bucket | fixed | write gated on `user?.id`, stale key swept |
| #24 assessment skip | fixed | clears to `{}` at :3854 |
| #25 `goTo` TDZ | fixed | declared above its effect |

---

## Open questions

Product calls, not mine:

1. **The 4.9s loading theatre** (6 × 720ms + 600ms). Still audit 18 #20 —
   nobody has decided whether the pacing is deliberate. It is the only step
   where a user waits on nothing real: the regimen is already computed, as
   `previewRegimen`, before the step mounts.
2. **`preferred_workout_time` still has zero readers.** The days step asks
   for it and nothing consumes it. Wire it to reminder scheduling, or drop
   the control.
3. **What should reduced-motion onboarding look like?** (#11.) Disabling the
   step transitions wholesale would leave the flow feeling broken; the honest
   version probably keeps the crossfade and drops the word-by-word reveals,
   the confetti and the loading pulse.
4. **Should the meter be a card at all?** With the duplicated heading gone
   it holds a bar chart and one sentence. CLAUDE.md reserves cards for
   discrete, user-arranged objects and says read-only data that is not a
   widget gets a hairline instead. A hairline-separated meter would drop the
   border and 32px of padding — but the card is also what makes the
   confirmation feel like a response to the tap, so this is a judgement about
   the moment, not about the pixels.
5. **Should `home_gym` be in onboarding at all?** It is the newest and
   least-proven step, it is the only one that can write before final save
   (via `GymJoinSheet`), and it is optional. It also has the most slack of
   any step on every device, which suggests it is doing less than its
   position implies.
6. **`GymJoinSheet`'s Cancel clears an already-joined gym.** `onCancel` calls
   `onChange(null)`, so after joining gym A, opening gym B's sheet and
   cancelling drops A from the draft — while the join RPC for A has already
   run server-side. Left alone because the right behaviour depends on whether
   tapping a second gym is meant to mean "switch" or "compare".
