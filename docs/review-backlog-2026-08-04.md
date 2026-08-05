# Consolidated review backlog — 2026-08-04

Every finding from the three 2026-08-04 reviews, deduplicated against each
other and against what was verified, corrected or shipped in the session that
produced this file. **96 items.** Counts were re-measured that day against
production, not carried forward from the documents.

Sources: the app-reviewer teardown, the Dashboard·Hub·Profile button review,
the total app critique, plus a verification pass against production and the
working tree.

Claims marked **verified** were re-checked; **traced** means read in source but
not executed.

---

## Status — end of the 2026-08-05 fix session

**37 of the 96 items are now shipped.** Six commits on
`claude/analysis-next-steps-g8i60y`. 2592 tests passing (up from 2578),
lint clean, build clean.

Two things still need a human and block the rest:

1. **Run the SQL** for migrations 280 and 281, and
   `supabase functions deploy delete-account`. Until both land, account
   deletion returns an honest "temporarily unavailable" rather than
   falsely reporting success.
2. **Fill the three placeholders in `src/pages/Legal.jsx`** — entity,
   contact email, jurisdiction.

Measured improvements this session:

| | Before | After |
|---|---|---|
| Eager critical path | 556 KB gz | **492 KB gz** (−11.5%) |
| `vendor-misc` | 268 KB gz | **202 KB gz** |
| Render-blocking font families | 5 | **3** |
| ESLint warnings | 215 | **212** (0 TDZ in Workout.jsx) |
| Dead `ui/*` wrappers | 33 | **0** |
| Unused Radix dependencies | 22 | **0** |
| Tests | 2578 | **2592** |

### Corrections found while fixing

- **The delete cascade would have aborted.** 104 FKs into `auth.users`
  already cascade, but four are `NO ACTION`/`RESTRICT` — `bounties`,
  `duels`, `pending_duel_invites`, `gym_businesses` — so a naive
  `deleteUser()` fails with `23503` for anyone who ever won a duel.
- **`PublicGymLanding` was never blank.** A `.then` with no `.catch`
  left it wedged in its loading branch. "8 DOM nodes, zero characters"
  was the spinner.
- **The muted-contrast finding is arithmetic.** The colour both reviews
  reported, `rgb(96,107,118)`, computes to **5.09:1** on the cream
  background — passing AA. Their 4.3:1 matches the *previous* token
  value. Token left alone.
- **The `vendor-misc` mystery was a transitive-dependency gap.** jsPDF
  and TF.js were excluded from the eager chunk; their dependencies were
  not. canvg, dompurify, pako (via fast-png) and @mediapipe were riding
  along.
- **The tap-target counts are mostly SVG.** A sweep for real `<button>`
  elements with a pinned sub-44px box finds seven across Hub and
  Progress, not 266. All seven fixed.
- **`VITE_ANTHROPIC_API_KEY` would publish an Anthropic key** to every
  visitor if set — Vite inlines `VITE_*` into the bundle. Unset today;
  now documented under a DO-NOT-SET heading.

### Deliberately not done

Self-hosting fonts (needs a real unicode-range subsetting pass for 15
languages — doing it badly is worse than the status quo), the profile
tier banner legibility (already carries a three-layer vignette and
doubled text shadows; any further change should follow a screenshot),
the magenta avatar (a deterministic per-user identity colour, not a
palette break), and `B-D4` content-under-nav (needs one look on device
to find which scroll container is at fault). Product decisions P1–P9 and
the nine unverified items are untouched by design.

---

## Scoreboard (original triage)

| Bucket | Count |
|---|---|
| Shipped | 13 |
| Corrected / won't fix | 7 |
| Open — blockers | 5 |
| Open — quality | 15 |
| Open — UX & polish | 27 |
| Product decisions | 9 |
| Unverified | 9 |
| Confirmed good | 11 |

---

## Shipped

On branch `claude/analysis-next-steps-g8i60y`. Lint clean, build clean, 2589
tests across 181 files. **Migration 280 is written but not applied** — it needs
pasting into the SQL editor.

| ID | Item |
|---|---|
| C-F1 | **Unauthenticated email harvest closed.** `resolve_profile_email` was SECURITY DEFINER with no auth gate and `anon` held EXECUTE, so the anon key in the production bundle converted any username into that user's email over plain HTTP. Usernames are public by design. Mig 213 excluded this function on the reasoning that it "returns email to anon one row at a time" — that is a loop, not a mitigation — and the refactor it waited on landed in mig 220. Fixed with an `auth.uid()` gate plus revoke. All three call sites are authenticated; verified in no policy and no other function body. |
| A-B1 | **League leaderboard FK.** `leagues.js:154` embed, 400/`PGRST200` every call. |
| A-B2 | **Gym roster FK.** `gymBusinesses.js:449`, same shape, fails into `return []`. |
| X1 | **Gym feed posts FK** — missed by all three reviews. `gymBusinesses.js:244`. The embed was added by Audit 12 (#42/#43) to stop the feed rendering email local-parts as display names; because it never resolved, **the `author_email` fallback has been the live path the whole time** — that leak was never actually closed. Latent only because the table is empty. |
| X2 | **Gym feed comments FK** — same, also missed. `gymBusinesses.js:337`. |
| C-F5 | **`/privacy` + `/terms`** in `src/pages/Legal.jsx`, mounted above the auth gate. Disclosures drawn from the live schema and real outbound calls (Supabase, Sentry, Anthropic, OpenStreetMap, Google/Apple OAuth). Statically imported so they can't fail behind a chunk fetch. |
| X3 | **Legal links at the point of collection** on `SignInToContinue`, as plain `<a>` to the public routes. |
| C-F8 | **Pinch-zoom restored.** `maximum-scale=1.0, user-scalable=no` was a WCAG 1.4.4 failure and an App Review flag, compounding with 819 strings at 9–11px. |
| C-F4 | **`toast.success` un-suppressed.** 284 non-error call sites, 252 of them success; the July policy silenced every one without an `action`. `info`/`message`/`warning` stay filtered. |
| B-D1 | **"Open a duel" → `/duels`** (`HeroSlideshow.jsx:895`, was `/workout`). |
| B-D5 | **Hub nav ring neutral when inactive.** Two tabs read as selected on every screen. Applied to the purple and blue per-user tiers too. |
| B-D3 | **`src/lib/initials.js`** — username-first, because five of six call sites already were and Hub profiles are username-only by design. 10 new tests. |
| B-D6 | **Carousel holds on pointer-down/focus.** It's the largest tap target on the Dashboard; a clicker lost the race 133 times. |

---

## Corrected & deliberately not fixed

Three of these would have caused damage if applied as written. Keep this
section so they don't get re-raised.

| ID | Item |
|---|---|
| X4 | **The FK diagnosis was backwards.** Both reviews say `league_members` has no `user_id` FK. It has one — pointing at **`auth.users(id)`**. PostgREST won't traverse into `auth`, an unexposed schema. Realising this is what surfaced X1 and X2. |
| X5 | **The published SQL would have failed with `42710`.** It names its constraints `league_members_user_id_fkey` / `gym_members_user_id_fkey` — both already exist. Mig 280 uses `*_user_profile_fkey`. |
| C-F13 | **Revoking anon on `is_blocked` would break public profiles.** It is called inside the SELECT policies on `hub_posts` and `hub_comments`; a policy helper runs as the *querying* role and `anon` holds SELECT on `hub_posts`. The revoke turns a filtered read into `permission denied for function`. The review's own F15 already found it isn't routable over PostgREST. |
| X6 | **`is_crew_admin` — same class,** ~13 crew policies. |
| C-F12 | **`public_profiles` is SECURITY DEFINER on purpose.** RLS on `user_profiles` permits reading only your own row, so the definer view *is* how anyone sees anyone else's profile. `security_invoker = on` would reduce Hub, every leaderboard and every profile to the viewer's own row. Exposes a 31-column subset, no email since mig 220. |
| C-F14 | **Blanket default-privilege revoke deferred.** Same regression class — helper functions live in RLS policies and several public surfaces legitimately need anon reach. Needs per-function grant discipline, not a one-liner. |
| X7 | **The 95% invisible-toast figure cuts both ways.** Save-workout carries an `action` (`Workout.jsx:959`) so it always surfaced; log-meal does not (`Nutrition.jsx:791`) and nutrition is the one healthy signal. Overstated for the headline flow, understated for the one that matters. |

---

## Open — blockers

| ID | Sev | Item |
|---|---|---|
| C-F2 | S0 | **"Delete account" does not delete the account.** `_invokeDeleteAccount` (`db.js:604`) is a client-side cascade over a hand-maintained list; it never deletes `user_profiles` or `auth.users`. The final step is `auth.updateMe()` setting fields to null plus an `account_reset_at` stamp — a reset. **The auth identity survives, so a magic link re-enters the account.** No `delete-account` Edge Function is deployed. 54 user-owned tables uncovered, 28 holding rows, including `journal_entries` (flagged in June, still missed) and `bug_reports`. Apple 5.1.1(v) and GDPR Art. 17. **Fix:** service-role Edge Function — cascade, `auth.admin.deleteUser(uid)`, `storage.remove('<uid>/*')` — deriving the table list from `information_schema`. |
| X9 | S0 | **`Legal.jsx` carries three unfilled placeholders**: legal entity, contact email, jurisdiction. Rendered as visible amber placeholders. A policy naming no controller fails GDPR Art. 13(1)(a)–(b) on its face. Constants at the top of the file. |
| C-F3 | S0 | **The core action has been performed 4 times in 3 months** — 4 workout logs from 3 users against 375 quest rows across 26. Not a code fix; the question every other number is downstream of. |
| C-F7 | S1 | **Trainer marketplace calls an undeployed Edge Function.** `trainerMarket.js:136` invokes `checkout-session`; only four functions are ACTIVE. **Do not deploy it** — Stripe for digital goods in an iOS wrapper is the rejection (Apple 3.1.1). Feature-flag the surface off. |
| C-F6 | S1 | **14-step onboarding in front of a 7.7% activation rate.** 76% finish onboarding; they drop *after*. The fix is not "cut steps" — instrument the first session after reveal. The critique flags its own interpretation here as its weakest claim. |

---

## Open — quality

| ID | Sev | Item |
|---|---|---|
| C-F9 | S2 | 556 KB gz eager critical path; ~200 KB of `vendor-misc` unattributed. Run `npm run analyze`. |
| C-F10 | S2 | Three identity columns (`created_by` / `user_id` / `user_email`) with no rule. Why F2's cascade drifted by 54. |
| C-F11 | S2 | **819** uses of 9–11px text plus **1,219** `text-xs`. June counted 817. |
| A-C1 | S2 | `prefers-color-scheme` ignored — dark-mode phones get the cream app. |
| A-C2 | S2 | Muted grey ~4.3:1 on cream, under AA. Most-used text colour after ink. |
| A-C3 | S2 | Dashboard mixes two card languages: orange gradient beside pale-green ring. |
| A-FT1 | S2 | Five web fonts from one render-blocking request; three are display faces. |
| A-FT2 | S2 | Three font stacks on one screen — one is Tailwind's untouched default, meaning those components never got a brand font. Fix once in `tailwind.config.js`. |
| A-FT3 | S2 | Self-host the fonts. |
| C-F19 | S3 | `user_profiles` carries 100+ columns. |
| C-F17 | S3 | **215 ESLint warnings, 0 errors.** 54 are `no-use-before-define` — the 2026-05-23 crash pattern. Three in `Workout.jsx`: `resetWorkout` at 884/904 and `calculateTotalVolume` at 722 (the third not named in any review). |
| C-F16 | S3 | ~25 dead `ui/*` wrappers, zero consumers; `@radix-ui/react-toast` unused. |
| C-F18 | S3 | `PublicGymLanding` renders 8 DOM nodes and zero characters under network failure, while three sibling public routes degrade gracefully. |
| C-F20 | S3 | `.env.example` omits `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. |
| C-F15 | — | 7 post-213 SECURITY DEFINER functions are anon-executable but **not routable** (`PGRST202`). Recorded so it isn't re-raised as a breach. |

---

## Open — UX & polish

Deduplicated across both visual reviews. All under an hour each.

**Onboarding** — U1 step counter disagrees with itself (`03/11` vs
`EXPERIENCE · 02`) · U2 option lists have no scroll affordance (5 of 6 goals,
5th clipped) · U3 step 8's CTA says "Build my plan" with three steps left ·
U4 disabled CTAs don't state their blocker (step 1 does, step 4 doesn't) ·
U5 step 3's inert placeholder chart owns the top third · U6 age picker takes
a full screen for one number, printed twice, two instruction lines · U7 step
8 has ~250px of dead space.

**Dashboard** — U8 greeted by username not first name, and the username is
the darker word · U9 "Evening work," parses as a noun phrase · U10 two red
"1" badges 40px apart · U11 "1 day streak" chip has a chevron and does
nothing (a `<span>` styled as expandable) · U12 nine 6×6px carousel dots ·
U14 first-screen order buries training fourth.

**Nav** — U15 the "···" quick-action hint is ~4px of pale grey · **B-D4**
content renders through the translucent bottom nav. *Note:* `main` already
reserves `pb-[calc(4rem+env(safe-area-inset-bottom))]` (`Layout.jsx:402`), so
the cause is likely a page-level inner scroll container. Not blind-fixed —
needs one look on device. Robust fallback is an opaque nav background.

**Workout** — U17 four identical ~26px "i" badges in one viewport ·
U18 two icon-tile treatments for peer actions in the same 2×2 grid.

**Hub** — U19 11+ orange elements competing in one viewport · U20 the FAB
covers the first post's top-right control · U21 two create affordances 230px
apart · U22 "Build your feed" clipped mid-word ("seant") with no scroll hint ·
U23 full-width orange Marketplace promo · U24 73 of 112 controls under 44px,
plus three unlabeled ~24px header icons.

**Profile** — U25 magenta avatar, a colour used nowhere else, on the orange
cover gradient (the green completion bar is the second single-use colour) ·
U26 white text on the orange gradient (week strip, "BRONZE", "LV 1") ·
U27 "0 Followers · 0 Following · 0 Posts" is a cold opening.

**Progress** — U28 193 of 212 controls under 44px; densest screen by 4×.

---

## Product decisions

Not defects. All left alone.

| ID | Item |
|---|---|
| C-P1 | **Rewards app or fitness app?** 375 quest rows against 4 workouts. Someone holds 20,075 coins at level 5 — the economy has decoupled from the activity it rewards. It's being built as both and gamification is winning because it requires nothing of the user. |
| C-P3 | **Follow the nutrition signal.** 106 logs / 6 users vs 4 workouts / 3 users. ~26× more used, daily, low-friction — and it's the fifth tab. |
| C-P2 | **What to cut** — ~20 tables at zero rows: corporate portal, trainer marketplace, crew wars, crew challenges, the equipment picker (6 migrations), stories, scheduled workouts. What's left is five surfaces instead of thirty-two. |
| A-M1 | **Delete the Feature of the Day carousel** — 45% of the home screen, 9 slides of internal advertising. A carousel that advertises your own navigation is the app telling you the navigation is broken. Fix the cause (A-M2). |
| A-M2 | **Collapse six routes into two** — Duels+Bounties+Gauntlet → "Compete"; the three gym routes → "Gym". 3–5 days. |
| A-M3 | **Coach into the nav, Hub out of the centre slot.** In a fitness app that slot should start a workout. |
| A-M4 | **Flag off** Trainer Studio, Trainer Market, Corporate Portal. Overlaps C-F7. |
| A-H1 | **18 of 23 features live off-nav** against 5 nav slots. Full ranking in the teardown. |
| C-P5 | **What a returning user meets after 30 days** — expired quests, broken streak, league demotion. Unwalked. |

---

## Unverified — needs a real browser run

The critique's headless browser had no network route to Supabase; both visual
reviews rendered every screenshot in fallback fonts.

- **C-U1** — 11 of 17 lenses never run: no first-run/day-7/power-user/lapsed
  journey, no layout-shift, empty-state, dead-end, tap-target, focus-order,
  contrast or density observations, no per-surface verdicts for 32 pages.
  *"These are the problems findable without running the app."*
- **C-U2** — is the invisible-toast problem as bad on screen? Half-answered by X7.
- **C-U3** — what is the other ~200 KB of `vendor-misc`? One command.
- **C-U4** — how did `is_blocked` / `is_crew_admin` keep anon EXECUTE through
  the 213 sweep? Whatever did it will do it again.
- **C-U5** — does Storage get cleaned on account deletion? Part of the F2 rebuild.
- **C-U7** — push delivery to a real device: `push_subscriptions` still 0.
- **C-U8** — i18n, RTL, motion timing, notification volume. Not run.
- **A-FT0** — typography entirely unjudged. Note `document.fonts.check()`
  returns true regardless, so it isn't a usable signal.
- **C-U6** — *answered: no.* The low workout count is not a wipe artifact —
  1 of 34 profiles has `account_reset_at`, stamped before the oldest surviving
  log. Residual risk: a wipe path that doesn't stamp the column.

---

## Confirmed good

Recorded so they don't get "fixed".

- **G1** Three June blockers genuinely fixed — C6 nested `<Router>`,
  C7 draft flush handlers, C8 bodyweight sets.
- **G2** RLS on tables is solid; every anon direct-table probe returned empty.
  The email hole was a function grant, not a policy gap.
- **G3** `get_public_profile_by_username` returns email only when
  `auth.uid() IS NOT NULL` — the right answer to C-F1, on the function next door.
- **G4** 2,589 tests / 181 files, ~83s.
- **G5** Lazy-loading discipline holds; tree-shaking verified by inspecting the
  built chunk for unused Radix primitives (0 occurrences).
- **G6** Build guards (`MISSING_EXPORT` → build failure) and the bounded AI
  Coach modifiers with notes-on-the-card.
- **G7** The Workout screen is the best thing in the app.
- **G8** Palette disciplined — six values, 8–14 per screen, across 23 screens.
- **G9** Onboarding better than most shipped fitness apps.
- **G10** Both admin routes properly gated.
- **G11** Almost every button works — the 175 "unclickable" controls were
  harness artifacts, and the reviewer reported the corrected number.

---

## Ground truth

| Measure | Review | Re-measured 4 Aug | Note |
|---|---|---|---|
| Auth users / profiles | 34 / 34 | 34 / 34 | first signup 2026-05-03 |
| Completed onboarding | 26 | 27 | 79% of signups |
| Workout logs / users | 3 / 2 | **4 / 3** | one logged that day |
| Nutrition logs / users | 105 / 6 | 106 / 6 | ~26× workouts |
| Daily-quest rows | 366 | 375 | ~94× workouts |
| Signed in last 7d | 4 | **8** | still opening the app |
| `push_subscriptions` | 0 | 0 | delivery unproven |
| Tests / files | 2578 / 180 | **2589 / 181** | +11 this session |
| ESLint (no `--quiet`) | 215 | 215 | 0 errors; 54 TDZ-class |
| 9–11px text uses | 818 | 819 | +1,219 `text-xs` |
| Non-error toast sites | 283 | 284 | 252 are success |
| Edge functions deployed | 4 of 6 | 4 of 6 | `checkout-session` absent |
| Public tables / user-owned | ~140 | 139 / 94 | F2 covers 40 |
| `league_members` rows | — | 37 | 0 orphans, 0 nulls |

**The first three rows are still the whole critique.** A fitness app with 27
onboarded users and 4 workouts is not a fitness app yet. Everything above is
worth doing; none of it changes that number.
