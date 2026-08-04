# Prompt — total app critique

Self-contained brief. Paste into a fresh session; it assumes no memory of the
one that wrote it. Everything you need to start is below.

---

## Task

Criticise **every detail** of Flexyn (`~/flexyn2` — React + Vite + Supabase +
Tailwind + Radix PWA, ~206k lines across 904 source files, 32 pages, 304
migrations, 6 edge functions, 15 languages). Product, interaction, visual
design, copy, performance, accessibility, data model, security, economy,
operations, code health. Nothing is out of scope and nothing is above
criticism, including decisions documented as deliberate in `CLAUDE.md`.

The bar is **productive** criticism. A complaint that cannot be acted on is
noise, and noise is what makes a critique easy to ignore. Every finding must
carry a repro or a measurement, a stated cost of leaving it, and a specific
fix. "The Dashboard feels cluttered" is worthless; "the Dashboard renders 11
cards above the first workout affordance, so on a 375×812 screen the primary
action is 2.3 screens down — measured, screenshot attached — move it above
the fold or collapse the discovery rail" is a finding.

**Do not fix anything during the critique.** The deliverable is a written
document. Fixes come after, in separate commits, once the user has picked
what they want fixed. The one exception is at the very bottom of this brief.

## Why this is worth doing properly

The app is big, was built fast, and most of it has never been looked at by
anyone but the person who wrote it. Two prior sweeps exist and both are
stale — see *Prior art*. The failure mode this brief exists to prevent is a
critique that reads impressive, lists forty things, and changes nothing
because none of them were verified, prioritised, or costed.

The second failure mode is flattery. You will be tempted to open with what's
strong and hedge every criticism. Don't. The user asked to be criticised.
A short "what actually works, and why" section at the end is useful as
calibration; an approving paragraph at the top is not.

## The standard every finding must meet

Five fields. A finding missing any of them is not ready to report.

| Field | What it means |
|---|---|
| **Claim** | One sentence. What is wrong. Not a category — the actual defect. |
| **Evidence** | A repro (inputs → observed wrong outcome), a measurement with units, a screenshot, a query result, or `file.jsx:line`. Something a sceptic can re-run. |
| **Cost** | Who is hurt and how much. "Every new user, on the screen that decides whether they stay" ≠ "an edge case reachable by two of 38 users". |
| **Fix** | Specific and sized. Name the file or the migration. If you don't know the fix, say "unknown — needs investigation" rather than inventing one. |
| **Confidence** | `verified` (you made it happen) · `traced` (read the code path end to end) · `suspected` (pattern-matched, not proven). Label honestly; a suspected finding is still worth reporting, mislabelling it is not. |

Anything you cannot fill in is a **question**, not a finding. Questions go in
their own section. Mixing the two is how a critique loses credibility on the
first item the reader checks.

## Prior art — read before you start, do not re-report

Two sweeps already exist. Re-reporting a fixed bug destroys trust in
everything else in your document, so **check each one against the current
tree before you repeat it**.

| Doc | Date | Status |
|---|---|---|
| `SHIP-READINESS-AUDIT-2026-06-10.md` | 2026-06-10 | 14 domain audits, verdict "NOT READY FOR LAUNCH", blockers C1–C11+. **~8 weeks old.** Many are fixed. Verify each. |
| `audit-findings/00-SUMMARY.md` + `01`–`17` | 2026-05-25 | Overnight bug hunt, 17 reports. Older still. |
| `docs/xp-audit-2026-07-29.md`, `coin-economy-audit-*`, `loot-system-audit-*` | 2026-07-29 | Economy already audited. Read the conclusions; don't redo the simulations unless you're challenging one. |
| `docs/feature-tier-list.md` | — | An inventory of what exists. Useful as a checklist of surfaces; it is a pitch document, not an assessment. |
| `CLAUDE.md` | living | Conventions, plus a candid list of known-broken and intentionally-deferred things at the bottom. |

`CLAUDE.md` already admits these are open. Confirm they're still true and
assess the *cost*, but they are not discoveries:

- `push_subscriptions` is 0 rows — nobody has opted in, so push has never
  been proven to reach a real device.
- Weekly Debriefs is deployed but inert (no `DEBRIEF_CRON_SECRET`, cron
  unscheduled).
- ~128 i18n keys missing in Arabic / Chinese / Russian; discovery cards and
  ~21 Hub keys English-only on 8 of 15 locales.
- RTL class swaps done, device verification not.
- `bio` profanity check is client-only.
- `is_active` on regimens is dormant.

The interesting question about that list isn't whether the items are real —
it's whether shipping in that state is the right call, and whether the list
is the *whole* list. It isn't. Find what's missing from it.

## Method

Five passes. Each one's output feeds the next. Do not jump to Pass 3 because
reading code is easier than running the app — a critique written without
using the product will be wrong in the ways that matter most.

### Pass 0 — Establish ground truth

Before any opinion, know what is actually running.

- Build and run it. `npm run build` (note the time and the chunk sizes),
  `npm run test` (`CLAUDE.md` claims 2366 across 167 files as of 2026-07-31 —
  re-measure), `npx eslint .` **without** `--quiet` (claimed 141 warnings;
  the ship audit said 192 — re-measure and reconcile).
- Check the live database via the Supabase MCP, read-only. How many users?
  How many have logged a second workout? A tenth? How many rows in the tables
  behind each major feature? **A feature with zero rows after months live is
  the single most important fact in this critique** and no amount of code
  reading will surface it.
- Check what's deployed vs what's in the tree: `list_migrations` against
  `supabase/migrations/`, `list_edge_functions` against
  `supabase/functions/`. Drift here invalidates findings on both sides.
- Run `get_advisors` for both `security` and `performance`.
- Note the deployed build hash (`src/lib/buildInfo.js`) so device reports and
  your observations refer to the same code.

Write these numbers down. They are the calibration for every severity call
you make later.

### Pass 1 — Use the app as four different people

Drive the real app in a browser at **375×812** (the majority case), then spot
check 320 px and desktop. Both themes. Take screenshots. This pass produces
more good findings than the rest combined, because it is the only one that
sees the product rather than the code.

Four journeys, in this order:

1. **Cold first-run.** A brand-new account, empty everything. Sign-up →
   onboarding → the first screen you land on → to a completed first workout.
   Time it. Count taps. Count the screens where a new user with no data sees
   an empty card, a zero, or a leaderboard they're last on. **This journey
   decides retention and it is the one nobody re-walks after the first
   month.** `src/pages/Onboarding.jsx` is 3,682 lines — assume it has grown
   past what anyone intended.
2. **Day 7 returning.** Simulated by seeding a few workouts. What does the
   app open to? What does it ask of you? Is there a reason to open it on a
   day you don't train?
3. **Power user.** Someone with 200 workouts, PRs, a crew, a nemesis, a gym.
   Does anything degrade — list length, chart density, load time, the
   notification feed? Pick the heaviest real account in the DB and look at
   what their screens would actually render.
4. **Lapsed, returning after 30 days.** Streak gone, quests expired, league
   demoted, nemesis stale. Games are cruellest here and it's the moment a
   returning user is most fragile. What does the app say to them?

For each journey: what did you want to do, what did the app make you do, and
where did you hesitate. Hesitation is data — record every place you weren't
sure what a control did, including ones you figured out.

### Pass 2 — Sweep every surface

32 pages plus their modals, sheets, and tabs. Visit each one. This is the
"every detail" part and it is meant to be tedious.

```
Dashboard · Workout · Hub · Progress · Nutrition · Coach · Messages · Market
Onboarding · Profile · Notifications · Duels · Bounties · Gauntlet · Splash
MyGym · MyGyms · GymHub · GymMap · GymEdit · RegisterGym · PublicGymLanding
TrainerStudio · TrainerMarket · CorporatePortal · TradeHistory · CheckInPage
DuelInviteLanding · PublicProfile · SignInToContinue · AdminGyms · AdminReports
```

Per surface, a one-line verdict plus anything that fails these:

- **First 400 ms.** Skeleton, spinner, layout shift, or blank? Does content
  jump when data lands?
- **Empty state.** With zero data, is it a designed state or a bare `0`?
- **Error state.** Kill the network mid-load. Does it say something true and
  offer a way out, or spin forever?
- **The primary action.** Is there exactly one, is it obvious, is it
  reachable one-handed on a 6.1" phone?
- **Density.** Count the cards. Count the distinct colours. Count how many
  numbers are on screen at once.
- **Dead ends.** Any screen you can enter and not leave without the back
  button. Any control that does nothing on tap.
- **Toasts.** `src/lib/toast.js` suppresses non-error toasts without an
  `action` — every success path you exercise either shows feedback or is
  silently indistinguishable from a dead button. Check each one.

The four public routes (`/duel-invite/:token`, `/@username`, `/p/gym/:id`,
`/checkin/:code`) were 100% blank in June because of nested `<Router>`s.
**Load all four signed-out** before assuming that's fixed. They are the
entire viral funnel.

### Pass 3 — Cross-cutting lenses

Run every lens. Each is a different failure class and they don't overlap as
much as they look like they will. If you're running this as a fleet, one
agent per lens is the natural split; if you're one session, do them in this
order — the early ones inform the later.

**A. Product coherence — the highest-value lens, and the one that gets
ducked.** Flexyn ships duels, bounties, nemesis, gauntlet, crews, stories,
DMs, a market, a trainer marketplace, a corporate portal, gym businesses, a
gym map, nutrition with barcode scanning, a TF.js form coach, injuries,
cycle tracking, sleep, mood, hydration, and an AI coach. Ask the questions
that inventory is designed to prevent:

- What is the app *for*, in one sentence, as evidenced by what it opens to?
- Which features have zero or near-zero production usage (you have the query
  results from Pass 0)? What did each cost to build and maintain?
- Which pairs are the same feature twice? (Duels vs Bounties vs Gauntlet vs
  Crew Wars are four framings of "compete against someone".)
- **What would you cut?** Name specific features, with the evidence, and say
  what the app becomes without them. This will be uncomfortable to write. It
  is the most valuable paragraph in the document.
- Where does the gamification actively work against the fitness outcome —
  rewarding volume that a beginner shouldn't chase, or shaming a rest day?

**B. Information architecture.** Five tabs plus four hoisted destinations
plus 23 more routes. Map how a user reaches each. Count the ones reachable
only from a menu inside a modal. Anything unreachable in three taps from the
Dashboard is effectively invisible — is that intentional for each one?

**C. Visual design.** Colour budget per screen, type scale consistency,
spacing rhythm, alignment, the number of border radii and shadow levels in
use, gradient overuse, contrast ratios in *both* themes. Recent commits were
a colour-budget pass — check it held. The June audit counted 817 uses of
9–11 px text; re-count and judge whether that's a density choice or an
unreadable one.

**D. Motion.** Framer Motion is everywhere plus `ThemeAnimationLayer.jsx`
(1,686 lines) and confetti on six celebration paths. Time the animations.
Anything over ~200 ms on a repeated interaction is a tax paid every session.
Check `prefers-reduced-motion` is honoured — with confetti, haptics and
particles, if it isn't, that's an accessibility failure, not a preference.

**E. Copy and voice.** Read every string on the surfaces from Pass 2.
Consistent person and tense? Does the app ever scold? Are errors actionable
or apologetic? Do numbers have units? Is the same concept named the same
thing everywhere (streak vs consistency vs active days; regimen vs program
vs template vs routine — that's four words, check whether they're four
concepts).

**F. i18n and RTL.** Beyond the known key gaps: hardcoded English in JSX,
concatenated sentence fragments that can't translate, dates and numbers not
going through `src/lib/intl.js`, layouts that break at German string length,
and Arabic RTL with real content. 41 `i18n-*.js` part files — check the
splitter's output is complete and that no locale silently renders a key
code.

**G. Accessibility.** Tap target sizes, focus order, focus visibility,
keyboard traps in modals, `aria-label` on icon-only buttons, screen-reader
pass over one full workout log, and contrast. Health data plus UGC means this
is compliance, not polish.

One free finding to start you off, confirmed present as this brief was
written: `index.html:62` still carries `maximum-scale=1.0, user-scalable=no`,
so pinch-zoom is disabled app-wide. That was blocker **C5** in the June audit
— a hard WCAG 1.4.4 failure and a known App Review flag — and it is a
one-line fix that has now been open for eight weeks. Treat it as the
calibration case: if something that cheap and that well-documented is still
live, assume the rest of the June list needs checking one by one rather than
assuming it was worked through.

**H. Performance.** `npm run analyze` for the treemap. Report per-chunk KB
gzipped, the cost of TF.js / maplibre / html2canvas / zxing and whether each
is genuinely lazy, time-to-interactive on a throttled Fast 3G, and the
render cost of the heaviest screens. Then the database side: N+1 query
patterns in the data layer, missing indexes (the advisor output from Pass 0),
and any screen that fires more than ~6 requests to paint.

**I. Offline and PWA.** It claims installability and offline. Test both:
airplane mode mid-workout, mid-set, on save. What is lost? The service
worker was dead from 2026-05-23 to 2026-07-31 — verify the precache actually
covers the app shell now, and that the update prompt appears on a new build.

**J. Data correctness.** Unit conversion round-tripping (kg↔lb, cm↔in,
stone), timezone and DST handling on every "local day" boundary (streaks,
quests, scheduled workouts, leagues), week-start assumptions, PR detection
edge cases, and whether the same number displayed on two screens can
disagree. Two sources of truth for one value is the defect class this
codebase is most prone to.

**K. Security and privacy.** RLS coverage on every table, SECURITY DEFINER
functions gating on `auth.uid()` rather than a client-supplied identifier,
`REVOKE` on anything with side effects, storage bucket policies, what a
tampered client can write, and what data leaves the device (Sentry payloads,
third-party APIs). Verify RLS the way `CLAUDE.md` describes — as
`authenticated` with JWT claims set, or via a node probe with the anon key.
**MCP and SQL-editor queries run as `postgres` and bypass RLS entirely**, so
a query that "works" there proves nothing.

**L. Privacy of health data specifically.** Body photos, weight, injuries,
mood, sleep, and cycle logs. Who can read each? What survives account
deletion? Is there a privacy policy and consent surface yet (blocker C1 in
June)? Does "delete account" actually delete (C2)?

**M. Notifications.** Every push and in-app type: is it something the user
asked for or something we decided to send? Category mapping correct, quiet
hours honoured, unsubscribe reachable, copy not scolding. Count the maximum
notifications a moderately active user could receive in one day — if that
number is above about five, say so.

**N. Economy and balance.** XP, coins, capsules, loot, leagues, prestige.
The audits from 2026-07-29 did the modelling; your job is whether the
*experience* is right — does progress feel earned, are rewards legible, can
a new user tell what they're for, is anything inflationary.

**O. Code health.** `Onboarding.jsx` 3,682 lines, `Workout.jsx` 3,441,
`Nutrition.jsx` 2,335, `HubProfile.jsx` 2,199. Judge the real cost: how long
does it take to find where a given behaviour lives, how many responsibilities
per file, how much duplicated logic across pages, how much dead code. Check
test *quality* not count — mocked dependencies that return null are not
coverage (see `CLAUDE.md` on `equipment.js`). Find the code paths a user hits
every session that no test exercises.

**P. Operations.** What happens when something breaks in production and
nobody is watching? Sentry coverage and whether the alerts are actionable,
cron job failure visibility (a job that 404'd weekly for ten weeks recorded
`succeeded` every time), silent-guard patterns that swallow failures, backup
and restore, and cost at 10× the current user count.

**Q. Legal and store readiness.** Privacy policy, terms, consent, IAP
compliance on anything sold, OAuth inside a webview wrapper, health-data
disclosures. If the answer to "could this be submitted tomorrow" is no, list
what stands between here and yes, in order.

### Pass 4 — Rank, cost, and report

Score every finding, then sort. Severity is not a feeling:

| | Meaning |
|---|---|
| **S0** | Data loss, security or privacy breach, or a core flow that fails for everyone. |
| **S1** | A common flow is broken, misleading, or so slow people abandon it. |
| **S2** | Real friction or a wrong-but-recoverable behaviour on a path many users hit. |
| **S3** | Polish, inconsistency, code health with no current user impact. |

Cross with **reach** (everyone / most / some / rare) and **fix cost**
(XS <1h · S <1d · M 1–3d · L >3d). The recommended order is severity ×
reach ÷ cost, and where your gut disagrees with that ordering, say so and
explain — that disagreement is usually where the real product insight is.

Then separate, into distinct sections:

- **Defects** — provably wrong. Fix without asking.
- **Product calls** — pacing, generosity, scope, taste. Present with a
  recommendation; **do not act on these unilaterally.**
- **Questions** — things you couldn't verify, with what you'd need.

## Deliverable

One document: `docs/app-critique-<YYYY-MM-DD>.md`.

```
1. Verdict            — 5 sentences. What is this app, what is wrong with it,
                        what would you do first. Written last, read first.
2. Ground truth       — the Pass 0 numbers, in a table.
3. Top 10             — the ten findings that matter most, full five fields
                        each, ordered. If someone reads only this, it should
                        be the right ten.
4. By severity        — every remaining finding, S0 → S3, one row each.
5. Product calls      — with recommendations, awaiting a decision.
6. Questions          — unverified, with what would settle each.
7. What works         — genuinely, with evidence. Calibration, not comfort.
8. Where I might be wrong — the findings you're least sure of and why.
```

Section 8 is mandatory. A critique with no stated uncertainty is a critique
that wasn't checked.

Screenshots go in the doc where they're evidence. Scripts and simulations
stay in the scratchpad — their *results* come into the document.

## Traps

These are the specific ways this task goes wrong.

- **Softening.** Every "consider possibly" and "might be worth" costs a
  finding its force. Say the thing.
- **Manufacturing.** The opposite failure, and worse. Padding to hit a count
  buries the real findings among the invented ones. If a lens turns up
  nothing, write "nothing found, here's what I checked" — that is a valid and
  useful result.
- **Critiquing from the code.** You cannot see a layout shift, a confusing
  label, or a dead-end screen by reading JSX. Run the app.
- **Re-reporting June.** Check `SHIP-READINESS-AUDIT-2026-06-10.md` and the
  `audit-findings/` set against the current tree first. Where something was
  fixed, note it — "C6 fixed, verified live" is useful information.
- **"Rewrite it in X."** Any recommendation that requires rebuilding a
  subsystem needs a migration path and a cost, or it's not a recommendation.
- **Taste as fact.** If you dislike the purple gradient, say so and label it
  taste. If it fails contrast at 4.5:1, measure it and label it a defect.
  Both are legitimate; conflating them is not.
- **Verified-runs ≠ verified-works.** A migration that executes cleanly says
  nothing about whether its functions work. Call the RPC as a real
  authenticated user.
- **Stale device builds.** An installed PWA can be months behind `main`. If a
  device report contradicts the code, get the build hash first
  (Settings → footer → tap the build label).

## Constraints

From `CLAUDE.md` — read it in full before starting; these are the ones that
bite during a critique:

- **Read-only against production.** This pass observes; it does not write.
  Anything a probe creates gets cleaned up.
- **RLS can only be tested as `authenticated`** with JWT claims set, or
  through a node probe with the anon key. `postgres` bypasses everything.
- **Don't fix while critiquing.** One document first, then fixes as separate
  commits, one concern each.
- If any fix does follow: `npm run lint` clean, `npm run test` green,
  `npm run build` clean before pushing. Feature branch first, then
  fast-forward `main`. Never force-push `main`.
- **After every push, post the SQL inline in chat** in a ```sql block, or say
  "No SQL needed — frontend only". Never point at a file path — the user is
  on mobile and cannot open files.
- Paste-safe SQL only: no dotted `alias.column` or record `.id` tokens.

## Done means

A document that the user can read on a phone, act on in order, and hand to
someone else without explaining. Ten findings they didn't know about, at
least one of which changes what they build next. Every claim re-checkable.
No flattery at the top, no manufactured severity, and an explicit answer to
"what would you cut".

**The single permitted exception to don't-fix:** if you find an S0 with an
obvious isolated fix — an exposed RPC, a data-loss path — fix it immediately,
say so at the top of the document, and continue. Everything else waits.

If the app turns out to be in better shape than this brief assumes, say that
plainly and show the evidence. A short critique that's true beats a long one
that's padded.
