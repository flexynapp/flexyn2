# Prompt — Onboarding polish pass (first-run audit, Aug 2026)

Self-contained brief. Paste into a fresh session; assume no memory of the one
that wrote it. Supersedes `docs/onboarding-audit-prompt.md`, which was written
against a 14-step / 3,743-line version of the file and is now wrong on both.

**Mode: audit, then fix.** Phase 1 produces the report. Phase 2 fixes what is
unambiguous and leaves taste and product calls in Open Questions. If you only
want the specification pass, delete Phase 2 before pasting and say so in the
summary.

---

## Who you are for this task

Act as the CTO of this product with hands-on depth in mobile UI/UX and
front-end engineering. Three things that means in practice:

1. **You own the whole column.** A chip that overflows on an iPhone SE, a
   `NaN` written to `user_profiles`, and a Continue button that does nothing
   on the one step where it matters are all your problem and go in one list.
2. **You separate defect from taste.** A bug is something that does not do
   what it says it does. "I'd have designed this differently" is not a
   finding — route it to Open Questions for Kegan.
3. **You do not guess.** Every finding carries `file:line` plus a repro, a
   measurement, or a screenshot. Anything you cannot reproduce is labelled a
   theory or dropped.

## The ask

A stranger installs Flexyn, opens it for the first time, and walks from the
welcome screen to their first Dashboard. **That walk must contain no visual
defects and no functional failures, and it must feel deliberately designed
rather than generated.**

Done means all three of these are true and evidenced:

- **Nothing is broken.** No dead control, no CTA that can never enable, no
  step that can be advanced without the answer it requires, no input whose
  displayed value disagrees with what gets stored, no write that fails
  silently and leaves the user believing it landed.
- **Nothing is visually wrong on a real phone.** No clipped text, no overflow,
  no content under the home indicator, no tap target below 44px, no contrast
  failure, no layout that only fits the phone you happened to test on.
- **It reads as one flow.** Consistent spacing rhythm, one accent, one type
  ramp, transitions that feel like one system rather than thirteen screens
  that were each polished separately.

## The target

Verified against the working tree on 2026-08-06 — re-check the anchors before
trusting them, the file moves constantly.

| | |
|---|---|
| Route | `/onboarding`, plus `src/App.jsx:326` and `:348` render it for any authenticated user whose onboarding is incomplete |
| Main file | `src/pages/Onboarding.jsx` — **3,897 lines**, ~40 components in one module, `export default` at :3091 |
| Steps | `STEPS` at :3007 — **13**: `welcome · goal · sharpen · experience · age · height · weight · days · assessment · injury_history · home_gym · loading · reveal` |
| Progress counter | `FORM_STEP_NAMES` at :3008 — **10** form steps drive the `NN/10` counter and the step kicker |
| Step components | `FeatureCarousel` :567 · `WelcomeStep` :743 · `GoalStep` :819 · `SharpenStep` :991 · `ExperienceStep` :1116 · `AssessmentStep` :1296 · `AgeStep` :1506 · `HeightStep` :1859 · `WeightStep` :2159 · `DaysStep` :2359 · `InjuryHistoryStep` :2519 · `HomeGymStep` :2697 · `LoadingStep` :2814 · `RevealStep` :2899 |
| Auth gate | Welcome CTA → `SignInToContinue`. Everything after the welcome screen needs a session |
| Draft | `localStorage` at :3166 / :3204. The `…anon` bucket was removed — no pre-auth step collects anything |
| Final save | :3458 (`updateMe(fullProfile)`) with tier-2 :3504 and tier-3 :3521 fallbacks, `body_metrics` insert :3618, `injury_logs` insert :3649, home-gym attach :3674–3684, draft cleared :3691 |
| Payload logic | `src/lib/data/onboardingProfile.js` — pure, 57 tests. Clamps, unit conversion, height parsing |
| Coach | `src/components/onboarding/OnboardingCoach.jsx` + `src/lib/aiCoach/onboardingCoach.js`, mounted at the flow root so it survives step transitions |
| Supporting | `src/lib/firstLaunch.js` · `onboardingErrors.js` · `data/starterRegimen.js` · `data/onboardingCardioGoal.js` · `data/homeGym.js` · `i18n-onboarding.js` (237 keys) |

Out of scope: `NutritionOnboardingModal.jsx`, the 7-day nudge sequence, and
Settings. In scope only where onboarding's own writes feed them.

## What changed since the last pass — do not re-report these

`audit-findings/18-onboarding-deep-pass-2026-08-05.md` found 26 items and three
fix rounds landed. Since then a further ~20 commits reworked the flow. Treat
this list as fixed unless you can reproduce otherwise:

- `body_baseline` **step is gone** (waist / body-fat). The prior prompt's
  14-step list and its "Skip saves anyway" finding are both obsolete.
- **i18n is wired.** All steps use `tFallback`; 237 English-only keys live in
  `i18n-onboarding.js` behind an `AWAITING_TRANSLATION` burn-down list. Do not
  re-file "hardcoded English" as a finding — file *missing* keys instead.
- **The fluid scale landed.** Onboarding is the **only** surface converted to
  `--fluid-*` + `.safe-page` (see the CLAUDE.md section). Vertical sizing is
  clamped against viewport height, not fixed px.
- The username `ilike` wildcard bug, the `075 KG` reel, the `"511"` height
  parse, the age ruler's blank tail, and the anon draft bucket are fixed.
- **`home_gym` was reworked repeatedly and is the least-proven step** — the
  type-it-yourself path was retired, the map got an onboarding-specific
  Continue, and the OSM search radius geometry changed. Start here.
- `sharpen`, `assessment` and `reveal` were all recomposed in the last two
  weeks. Also newer than the last audit.

**Still open from audit 18, already known — confirm, don't rediscover:** #11's
second half (`preferred_workout_time` has zero readers), #17 (the carousel
illustration is a Penpot decision), #20 (the loading step runs 6 × 720ms +
600ms ≈ **4.9s**; whether that pacing is deliberate is a product call).

## The two traps that ate the last session

Read these before you open a browser. Both cost hours.

**1. The browser pane can report `visibilityState: 'hidden'`, and then
`requestAnimationFrame` never fires.** Consequence: framer-motion pins every
`motion` element to its `initial` variant and `AnimatePresence mode="wait"`
(:3767) never completes an exit, **so the next step never mounts**. The last
audit reached only the welcome step and nearly filed a P0 "guest is trapped,
CTA is dead" — React state had advanced correctly; the pane could not render
the transition. Check first:

```js
document.visibilityState
let n = 0; requestAnimationFrame(() => n++); setTimeout(() => console.log('frames', n), 1600)
```

If frames is 0, do not trust anything animated, and do not file animation
findings from it. Layout *is* still trustworthy — flexbox/grid geometry comes
from the layout engine, not the frame loop — so measurements are valid.
Prefer a real device or a visible browser for the walk-through.

**2. `scrollHeight` cannot measure vertical fit.** It clamps to
`clientHeight`, so it reports "0px spare" for a screen that is exactly full
*and* one that is half empty. Measure slack as
`clientHeight − last child's getBoundingClientRect().bottom`, inside an
**iframe** (a div resolves `vh` against the window and quietly lies), and kill
the iframe's scrollbar first or every width measurement is 17px pessimistic:

```css
*{scrollbar-width:none}*::-webkit-scrollbar{display:none;width:0}
```

## Method

### Stage 0 — Read first

CLAUDE.md sections that are directly load-bearing here: **UI composition**,
**Fitting every phone (`--fluid-*`)**, **i18n discipline**, **Profile cache**,
**TDZ trap**, **Toast policy**. Then skim audit 18's findings table so you
recognise a regression when you see one.

Then build the inventory before forming any opinion — one row per step:

| step | what it collects | required or skippable | validation | persisted to (draft key / column) | who reads it later |

### Stage 1 — Walk it as a new user

`npm run dev`, browser pane at **375×812 first**. Flexyn ships to phones; a
desktop-first read misses the bugs that matter. Desktop pass second — Kegan
runs walkthroughs there.

Cover, at minimum:

- **Every control on every step.** Primary CTA, Back, Skip, unit toggles,
  chips, the age ruler, the weight dial, ± nudges, tap-to-type, the Coach
  button, the language hint, "I already have an account". Anything present
  that does nothing is a finding.
- **Both directions.** Forward through all 13, then back through all 13.
  Check the `NN/10` counter, the step kicker, and the transition on each — the
  counter counts 10 of 13, so an off-by-one on the three non-form steps is the
  likely shape.
- **Disabled-state honesty.** For each step: what exactly unlocks the CTA? A
  step you can pass without answering and a step whose CTA never enables are
  both findings. Where a CTA is disabled, does its label say why? Most steps
  swap the label ("Pick at least one day"); check they all do.
- **Input abuse** on age / height / weight / username: out-of-range, negative,
  `0`, leading zeros, `1e10`, decimals, unicode, emoji, cleared field, spammed
  ± buttons, scrubber dragged past both ends. Watch for the **displayed value
  and the stored value disagreeing** — that class shipped twice already.
- **Interruption.** Refresh mid-flow. Background and restore. Kill the tab at
  step 6 and reopen. Does the draft survive, and does it survive *correctly*?
- **Double-tap the final CTA** on a throttled connection.
- **Keyboard.** Does the iOS keyboard cover the focused input? Does Enter
  advance? Focus rings and tab order on desktop.
- **`prefers-reduced-motion`** — grep says `Onboarding.jsx` has **no**
  reduced-motion handling anywhere, while eight other components do. Confirm,
  and judge what a user with the OS toggle on actually experiences across the
  reveal, the loading theatre and the step transitions.
- Capture `read_console_messages` and `read_network_requests` throughout. A
  warning or a failed request is a finding even when the screen looks fine.

### Stage 2 — Measure the fit on three phones

Onboarding pins a CTA to the viewport bottom, which is exactly why it was
converted to the fluid scale. Verify it actually fits:

Render **every one of the 13 steps** at **375×667** (iPhone SE), **393×852**
(iPhone 15) and **430×932** (Pro Max), in an iframe, scrollbar killed, and
record the slack per step. A layout that fits a Pro Max tells you nothing.
Flag: negative slack (content under the CTA or the home indicator), and any
step whose worst case is the *middle* phone — that means something is sized
against the wrong axis, which is the bug `--fluid-heading-sentence` exists to
fix on the reveal step.

Also check `.safe-page` is on the shell (:3766) and that nothing inside
re-introduces a fixed inset that defeats it.

### Stage 3 — Judge the craft, against the house rules not your taste

From CLAUDE.md's UI composition section — these are the rules the app already
committed to, so a violation is a defect, not an opinion:

- **Two spacing registers only.** `gap-1`/`gap-2` within a group, `gap-6`
  between sections. 12–20px is banned. In this flow the registers are the
  `--fluid-stack` / `--fluid-section` pair — check steps use them rather than
  hand-rolled px.
- **One dominant element per screen.** On a form step that is the question.
- **Elevation has two levels** — hairline, or `shadow-md`. No coloured
  shadows, no `shadow-xl`.
- **Four hues.** The reveal step previously carried a fifth-hue badge; check
  nothing reintroduced one. One accent per screen.
- **No gradient as decoration, no glassmorphism**, no `backdrop-blur`.
- **Six type steps, 11px floor.** Something that needs to recede changes
  weight, not size.
- Radius is `sm` / `lg` / `2xl` / `full` only.

Then the cross-step read: put screenshots of all 13 steps side by side. Does
the header row start at the same y on each? Do the kickers use one format? Do
the CTAs sit at one height? Inconsistency across steps is the single loudest
"generated" tell and is invisible when you audit one screen at a time.

### Stage 4 — Follow the data

For every field collected, confirm the column exists, the type matches, and
the value survives a round trip. Specifically:

- The **three-tier fallback** at :3458 / :3504 / :3521 — what does a user end
  up with if tier 1 and tier 2 both fail? Is that state recoverable, or are
  they on a Dashboard of empty cards with no route back?
- The **fire-and-forget writes** — `body_metrics` (:3618) and `injury_logs`
  (:3649). Which of these can the user never discover failed? Injuries feed
  `getExcludedMuscleGroups`, so a silent loss means the AI Coach prescribes
  lifts against an injury the user *told us about*. Weigh that accordingly.
- The **home-gym attach** (:3674–3684) — three branches, one of which promotes
  an OSM feature into a persistent community gym. What happens if it throws
  after the profile write succeeded?
- **Never patch `flex_coins` / `total_xp` / `current_level`** or any privileged
  column from here; if you touch profile writes, read the Profile cache
  section first.

Use the Supabase MCP tools **read-only** — `list_tables`, `execute_sql` on
your own rows, `get_advisors`. No migrations in this pass.

### Stage 5 — Try to kill your own findings

Before anything reaches the report, attempt to disprove it. Re-run the repro
from a clean state. **Read the comments around the code** — this repo keeps
its reasoning in comments that greps don't read, and CLAUDE.md records that
four of five findings in one audit shrank or inverted on inspection. A grep
hit is a question, not a conclusion. Cut what doesn't survive.

Note also: **no test renders `Onboarding.jsx`.** The step tests in
`src/pages/__tests__/` (`revealStep`, `sharpenStep`, `assessmentStep`,
`experienceStepMount`, `aboutStepRequiresSex`, `onboardingHeaderAlign`,
`goalStepCopy`) are all `readFileSync` source assertions. That is why visual
regressions here survive a green suite — do not read "2,769 tests passing" as
coverage of this file.

## Constraints

- **Do not create accounts or complete a signup against production.** Drive
  anonymously to the sign-in gate; for the authenticated half ask Kegan for a
  session or a disposable account. Say clearly in the report which steps you
  exercised live and which you only read.
- **Do not redesign.** Kegan composes this UI in Penpot specifically to avoid
  a generated look. Report defects against the existing intent.
- **Do not machine-translate.** New copy ships English-only via
  `tFallback(key, 'English')` with the key added to `i18n-onboarding.js`.
- Mobile is the product. Judge every visual finding at phone width first.

## Phase 2 — fix what is unambiguous

Only after the report exists, and only for findings that are **defects with
one obvious correct behaviour**: broken controls, clipping, overflow, values
that don't round-trip, silent write failures, missing i18n keys. Leave
anything that is a product or design call in Open Questions.

Per fix: an `(Onboarding polish #n)` comment at the call site saying what it
was, a test where the logic is testable (prefer pure functions in
`onboardingProfile.js` over rendering the page), and a re-measurement at all
three device heights if it touched layout.

Then: `npm run lint` clean, `npm run build` clean (the `[vite-build-guard]`
codes are build failures — fix the import, never disable the guard),
`npm run test` green. Commit per coherent fix with a message that explains the
why. Push the branch, then fast-forward `main`.

**After the push, report the SQL** — either the pending migrations pasted
inline in a fenced `sql` block, or "No SQL needed — frontend only". Don't wait
to be asked, and never point at a file instead: Kegan reads this on mobile and
cannot open one.

## Deliverable

`audit-findings/19-onboarding-polish-<date>.md`:

1. **Summary** — one screen. Count by severity, the three things you'd fix
   first if you only got three, and an honest coverage statement: which steps
   were driven live, which were read, and whether the frame loop was working.
2. **Findings table**: `# · sev · file:line · scenario · observed · fix ·
   verified`. Severities: **critical** (blocks signup or loses data) ·
   **high** (visibly degraded) · **medium** (edge case) · **low** (polish).
   Verified: `live` · `sql` · `offline` (ran the file's own logic in a
   harness) · `code`.
3. **Visual findings** as their own subsection, with screenshots saved beside
   the report and named per finding, plus the slack table from Stage 2.
4. **Regression check** — audit 18's 26 findings, each `fixed` / `open` /
   `regressed`, one line of evidence. Do not assume fixed because line numbers
   moved.
5. **Fix log** (if Phase 2 ran) — what was fixed, what was left, why.
6. **Open questions** — the product calls that are not yours: the 4.9s loading
   theatre, whether `preferred_workout_time` should be wired or dropped,
   whether `home_gym` belongs in onboarding at all, which fields should be
   required, the under-18 posture.
