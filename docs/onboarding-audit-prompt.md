# Prompt — Onboarding deep pass (audit 1 of 3)

> **SUPERSEDED 2026-08-06 — do not run this one.** It was written against a
> 3,743-line file with **14** steps including `body_baseline`; the file is now
> 3,897 lines with **13** steps, i18n is wired, and the fluid scale has landed,
> so every line number and roughly half the findings below are stale. It ran as
> `audit-findings/18-onboarding-deep-pass-2026-08-05.md`. For a current pass use
> [`onboarding-polish-audit-prompt.md`](./onboarding-polish-audit-prompt.md).
> Kept because its method section and its coverage caveats are still the best
> record of how this flow has to be tested.

Self-contained brief. Paste into a fresh session; assumes no memory of the one
that wrote it. Companion passes follow for **Dashboard** and **Progress** —
same method, same deliverable shape. Do those separately, not in this session.

---

## Who you are for this task

Act as the CTO of this product with hands-on depth in software engineering,
UI/UX, mobile app development, and information systems. That means three things
in practice:

1. **You own the whole column, not one layer.** A misaligned chip, a `NaN`
   written to Postgres, and a step order that leaks a user's draft onto a shared
   device are all your problem, and they go in one list.
2. **You separate defect from taste.** A bug is something that does not do what
   it says it does. "I'd have designed this differently" is not a finding —
   route it to the Open Questions section for Kegan and Sean.
3. **You do not guess.** Every finding carries a `file:line` and either a repro
   or a screenshot. Anything you can't reproduce is labelled a theory or dropped.

## Task

Deep-audit the **Onboarding flow** in `~/flexyn2` (Flexyn — React + Vite +
Supabase + Tailwind, mobile-first PWA) end to end. Find everything: visual
defects, broken or dead controls, validation holes, state and persistence bugs,
data written wrong, i18n gaps, accessibility failures, error and offline paths.

**This is a specification pass. Do not change code.** The deliverable is a
report. Fixes ship in a follow-up session once Kegan and Sean have ranked them.
That's the convention here — see `docs/walkthrough-findings-2026-08-05.md`,
committed as "nothing changed yet".

## The target

| | |
|---|---|
| Route | `/onboarding`, plus `src/App.jsx` renders it for any authenticated user whose onboarding is incomplete (App.jsx:326, :348, :379) |
| Main file | `src/pages/Onboarding.jsx` — **3,743 lines**, ~40 components in one module |
| Steps | `STEPS` at line 2883: `welcome · goal · sharpen · experience · age · height · weight · body_baseline · days · assessment · injury_history · home_gym · loading · reveal` — 11 of those are form steps (`FORM_STEP_NAMES`, line 2884) and drive the `NN/11` progress counter |
| Auth gate | Welcome CTA → `SignInToContinue` (line 3580). Steps before it run anonymously against a localStorage draft; everything after needs a session |
| Coach | `src/components/onboarding/OnboardingCoach.jsx` + `src/lib/aiCoach/onboardingCoach.js`, mounted at the flow root (line 3605) so it survives step transitions |
| Supporting | `src/lib/firstLaunch.js` · `src/lib/onboardingErrors.js` · `src/lib/data/starterRegimen.js` · `src/lib/data/onboardingCardioGoal.js` · `src/lib/i18n-onboarding-*.js` · `src/components/dashboard/OnboardingNudgeCard.jsx` |
| Branch | `home-gym`. `home_gym` and `sharpen` are the two newest steps — treat them as least-proven |

Out of scope for this pass: `NutritionOnboardingModal.jsx` (belongs to the
Nutrition/Progress pass) except where Onboarding's own writes feed it, and the
7-day nudge sequence except where it reads state Onboarding wrote.

## Prior art — read both, trust neither

- **`audit-findings/13-onboarding-behavior.md`** — 40 findings, 2026-05-25.
  **Stale.** It was written against a 2,888-line file with 12 steps; the file is
  now 3,743 lines with 14. Some of those 40 are fixed, some aren't, some may
  have regressed, and at least one was wrong on the maths (see its #14).
- **`docs/walkthrough-findings-2026-08-05.md` §1** — Kegan's live device
  walkthrough. One onboarding item: **"AI Coach renders a hallucinated,
  meaningless 'design' on first load"** (P1, desktop, first screen). The
  screenshot never arrived. Reproduce it and characterise it properly — start at
  `FeatureCarousel` (line 433) and the `FeatVisual*` SVG components (lines
  83–265), which are what paints the welcome screen.

Triaging the 40 prior findings is a required part of the deliverable, with
evidence per row. Do not re-report a fixed one, and do not assume an unfixed one
is fixed because the line numbers moved.

## Method

Five stages. Each one's output is the next one's input — don't jump to writing
findings from stage 1.

### Stage 0 — Map before you judge

Produce the inventory table first, with no opinions in it. One row per step:

| step | what it collects | required or skippable | state shape | validation | persisted to (draft key / column) | who reads it later |

Then a second table: every **write** the flow performs. Starting points, confirm
and extend rather than trusting the list:

```
grep -n "updateMe\|\.insert(\|\.upsert(\|rpc(" src/pages/Onboarding.jsx
grep -rn "onboarding_complete\|fn-onboarding-draft\|fn-has-launched" src/
```

For each write: what fires it, is it awaited or fire-and-forget, what happens on
failure, and is it idempotent if the user retries.

### Stage 1 — Drive it, don't read about it

```bash
npm run dev
```

Use the Browser pane (`preview_start` with name `flexyn-dev`, port 5173), and
**start at mobile — `resize_window` preset `mobile` (375×812)**. Flexyn ships to
the iOS and Android app stores only; a desktop-first read of this flow will miss
the bugs that matter. Do a desktop pass second, since Kegan runs walkthroughs
there too.

Cover, at minimum:

- **Every control on every step.** Primary CTA, Back, Skip, unit toggles, chips,
  scrubbers, ± nudge buttons, tap-to-type, the Coach button, the language hint,
  "I already have an account". Note anything that is present but does nothing.
- **Both directions.** Forward through all 14, then back through all 14. Check
  the progress counter, the step kicker (`Schedule · 04` style), and the
  transition animation for each — prior finding #8 was a kicker/counter mismatch
  and the two new steps make a repeat likely.
- **Disabled-state honesty.** For each step, what exactly unlocks the CTA? A
  step you can advance without answering, and a step whose CTA never enables,
  are both findings.
- **Input abuse** on age / height / weight / body baseline / username: type
  out-of-range, negative, `0`, leading zeros, `1e10`, decimals, paste unicode and
  emoji, clear the field, spam the ± buttons, drag the scrubber past both ends.
  Watch for the displayed value and the stored value disagreeing.
- **Interruption.** Refresh mid-flow. Background and restore. Kill the tab at
  step 6 and reopen. Does the draft survive, and does it survive *correctly*?
- **Double-tap the final CTA** on a throttled connection (DevTools throttling via
  `javascript_tool` or the network panel).
- **Keyboard.** On mobile, does the iOS keyboard cover the focused input? Does
  Enter advance? Tab order and focus rings on desktop.
- **Reduced motion** (`prefers-reduced-motion`) and **dark/light** — this flow
  force-sets theme variables at line ~3100+; check what happens on unmount.
- Capture `read_console_messages` and `read_network_requests` continuously.
  Warnings and failed requests are findings even when nothing looks wrong.

**Do not create accounts and do not complete a signup against production.** Drive
anonymously up to the sign-in gate. For the authenticated half, ask Kegan for an
already-signed-in session or a disposable test account before going further; until
then, verify those steps by code-read plus the vitest harness. Say clearly in the
report which steps you exercised live and which you only read.

### Stage 2 — Read the code

3,743 lines, all of it. Hunt these classes specifically:

- **Controlled vs uncontrolled inputs** — `defaultValue` + `onChange` that clamps
  state is a guaranteed display/state divergence.
- **Clamping at the boundary** — HTML `min`/`max` on an input that never submits a
  form validates nothing. Every numeric write needs a JS clamp before it reaches
  `body_metrics` / `user_profiles`.
- **Fire-and-forget writes** — `.then().catch(reportError)` after the user has
  already navigated away. Which of these can the user never discover failed?
- **Retry duplication** — a second submit attempt re-running inserts that have no
  unique constraint behind them.
- **The anon → user draft migration** (~line 3050–3110). Two different people
  signing up on one device is the case to reason about.
- **TDZ traps** — `const` read before its declaration line, including inside
  `useEffect` deps arrays. See the CLAUDE.md section; this class has caused a
  production crash in this repo.
- **i18n** — the file had **zero** `t()` / `tFallback()` calls at last audit and
  still imports no `useLanguage`. Confirm the current state and quantify it:
  count the hardcoded user-facing strings. Flag any English value that gets
  *persisted* (e.g. `preferred_workout_time`) separately — that's a data bug, not
  a copy bug.
- **Column types** — several `user_profiles` height/weight columns are TEXT.
  Check what this flow writes and what downstream readers assume.
- **Dead code** — steps, props, or helpers no longer reachable (`StatsStep` at
  line 2166 is a candidate; so is `src/lib/i18n-onboarding-steps.js`).

Also run and read the output of:

```bash
npm run lint && npx eslint src/pages/Onboarding.jsx && npm run test
```

### Stage 3 — Follow the data to the database

For each field the flow collects, confirm the column exists, the type matches,
and the value survives a round trip. Use the Supabase MCP tools read-only —
`list_tables`, `execute_sql` on your own rows, `get_advisors`. Do not apply
migrations in this pass. Note anything the flow writes that nothing reads, and
anything a later screen expects that this flow never sets.

### Stage 4 — Try to kill your own findings

Before anything reaches the report, attempt to disprove it. Re-run the repro
from a clean state. Read the surrounding comments — this codebase documents its
reasoning in comments, and the CLAUDE.md UI section records that four of five
findings in a previous audit shrank or inverted on inspection. A raw grep hit is
a question, not a conclusion. Cut anything that doesn't survive.

## Constraints

- **Mobile is the product.** Judge every visual finding at phone width first.
- **Do not redesign.** Kegan composes Flexyn's UI in Penpot specifically to avoid
  a generated look, and this pass is not a redesign. Report defects against the
  existing intent — overflow, cut-off text, dead space, misalignment, tap targets
  under 44px, contrast failures, inconsistent spacing against the two-register
  rule in CLAUDE.md. Where something is ugly but not broken, write one line in
  Open Questions and move on.
- **No code changes, no migrations, no pushes.**
- Read the CLAUDE.md sections on i18n discipline, UI composition, the profile
  cache, and TDZ before you start. Several are directly load-bearing here.

## Deliverable

Write `audit-findings/18-onboarding-deep-pass-2026-08-05.md` containing:

1. **Summary** — one screen. How many findings, at what severities, and the
   three things you'd fix first if you only got three.
2. **Findings table**, matching the column format of
   `audit-findings/13-onboarding-behavior.md`:
   `# · sev · file:line · scenario · observed bug · suggested fix`
   Severities: **critical** (blocks signup or loses data) · **high** (visibly
   degraded flow) · **medium** (edge case) · **low** (polish). Add a `verified`
   column: `live` (reproduced in the browser), `code` (read-only), or `theory`.
3. **Visual findings** as their own subsection with screenshots saved next to the
   report, named per finding.
4. **Prior-findings triage** — all 40 rows from audit 13, each marked
   `fixed` / `open` / `regressed` / `wrong`, one line of evidence each.
5. **Fix order** — top 10, ranked by user impact per unit of effort, with a rough
   effort estimate. This is the list Sean will work from.
6. **Open questions** — product calls that aren't yours to make. Step order,
   which fields should be required, the under-18 consent posture, whether the
   five-goal selection should shape more than the first goal.

Report honestly on coverage: if the authenticated half went unexercised because
no test account was available, say so in the summary rather than burying it.
