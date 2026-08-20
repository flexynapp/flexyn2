# Prompt — Achievements surface audit

Self-contained brief. Paste into a fresh session; assumes no memory of the
one that wrote it. Written 2026-08-12 against `~/flexyn2` at `f60fc89c`.

---

## Task

Audit **four named sub-features of the Achievements surface** in `~/flexyn2`
(Flexyn — React + Vite + Supabase, mobile-only, ships to the iOS/Android
stores):

| # | Sub-feature | The user-facing claim being tested |
|---|---|---|
| 1 | **Unlocked Achievements Count** | "You have earned N of M." |
| 2 | **Achievement List** | "Here is every badge, earned and unearned." |
| 3 | **Filter by category** | "You can narrow the list to one category." |
| 4 | **Share an Achievement** | "You can post a badge you earned to the Hub." |

The goal is release readiness. For each sub-feature, decide which of these
it is, and prove it:

- **(a) exists and works** — renders, is reachable, and is correct
- **(b) exists and is wrong** — renders, but produces a wrong number,
  a wrong list, or a broken action
- **(c) partially wired** — the code exists but nothing reaches it, or it
  reaches only some of the surfaces that need it
- **(d) absent** — no implementation anywhere in `src/`

**This is an audit, not a refactor.** Do not redesign the surface. A
one-defect / four-line fix with an obvious blast radius may be applied; say
explicitly which ones you took and which you only wrote up. Everything else
is a finding with a recommendation.

## Where the surface actually lives — read this before grepping

Achievements is **not a page and not a route**. Getting this wrong wastes
an hour, so take it as given and verify it in one command rather than
discovering it:

```
src/components/achievements/AchievementsVault.jsx   full-screen portal, z-[200]
  └─ src/components/progress/AchievementsTab.jsx    the entire UI (497 lines)
src/lib/trophyDefinitions.js                        the catalog (587 lines)
src/lib/data/trophies.js                            listEarned / getProgress / grantEligible
src/lib/data/shareAchievement.js                    the share path
src/lib/achievementsFlow.js                         the open-me event
supabase/migrations/167, 323                        server-side grant + progress RPCs
```

`AchievementsTab.jsx` still lives under `components/progress/` for
historical reasons — it was a tab on the Progress page and is now hosted by
`AchievementsVault`, which `ProfileMenu` lazy-imports. There is no
`/achievements` route. Confirm the entry points with:

```
grep -rn "AchievementsVault\|requestOpenAchievements\|OPEN_ACHIEVEMENTS_EVENT" src/
```

**There are two generations of this feature in the tree and only one is
live.** The surface was rewritten onto the trophy engine in `79576689`,
extended to 120 rungs in `ff9d5686`. The retired generation —
`src/lib/achievementDefinitions.js` (26 flat badges), `src/lib/data/achievements.js`
(the `Achievement` entity), the `public.achievements` table — may still have
readers. **Establish which files are dead before you audit any of them**, or
you will write findings about code nothing renders. That is itself a finding
if a live surface still reads the retired generation.

## Method

Four stages. Each one's output is the next one's input.

### Stage 0 — Inventory before opinion

Produce two tables before forming a view on anything.

**Table A — every render site of an achievement count.** The count is the
sub-feature most likely to disagree with itself, because several surfaces
compute it independently:

```
grep -rn "TROPHIES.length\|namedEarned\|user_trophies\|achievements_count\|listEarned" src/
```

For each hit: file, what it counts, what it divides by, and whether tails
and season trophies are in or out of each half.

**Table B — the catalog's shape.** From `trophyDefinitions.js`:
`TROPHIES.length`, ladder count, rungs per ladder, how many rungs sit on a
ladder whose signal the server does not populate, how many are `capstone`,
how many are reachable only through a feature the user may never open
(crew wars, gauntlet, prestige, marketplace).

### Stage 1 — Establish ground truth in production, read-only

Supabase project `ebvqxuwfiptcmlkhflfj`. Everything you claim about live
behaviour must be checked here, not inferred. At minimum:

```sql
SELECT count(*) AS rows, count(DISTINCT user_id) AS users FROM user_trophies;
SELECT trophy_id, count(*) FROM user_trophies GROUP BY 1 ORDER BY 2 DESC LIMIT 20;
SELECT count(*) FROM hub_posts WHERE post_type = 'achievement';
```

**Two traps that have already caught sessions on this repo:**

- **Production carries seeded test rows** from parallel sessions. Check
  `created_at` before reading a count as organic.
- **MCP and the SQL editor run as `postgres` and bypass RLS entirely.** Any
  claim about what a *user* can see must be executed as one:
  `BEGIN; SET LOCAL role authenticated; SET LOCAL request.jwt.claims =
  '{"sub":"<uuid>","role":"authenticated"}'; … ROLLBACK;` — and assert the
  probe identity is who you think it is, because a wrong `sub` looks exactly
  like an RLS leak.

Then check the *installed* RPC bodies, not the migration files:
`pg_get_functiondef('public.grant_eligible_trophies'::regproc)` and the same
for `get_trophy_progress`. A later migration redefining a function from a
stale template is invisible in the file that owns the feature — that is how
push notifications sat dead for months here.

### Stage 2 — Exercise, don't infer

Every behavioural claim gets exercised. jsdom paints nothing, so a green
test is not evidence that a layout is right — there is a Vite stub-alias
render harness pattern in this repo (`docs/`, and see the render-harness
note) that found two visible defects behind 4117 passing tests. Use it, or
the browser pane, for anything about what a user *sees*.

Specifically:

- Render the vault with **zero** earned trophies, with **one**, and with a
  set that includes a **generated tail id** (`sessions_x2`) and a **league
  season trophy**. Those two resolve through `getTrophy()` rather than
  `TROPHY_BY_ID`, and they are excluded from the denominator on purpose.
- Drive the **Share** button for real and confirm what lands in `hub_posts`,
  then confirm `HubPostCard` renders that row. A share that writes a row the
  feed cannot render is indistinguishable from a working share at the button.

### Stage 3 — Rank and report

One table per sub-feature, then one severity-ranked findings table across
all four. Each finding: what is wrong, the concrete failure (inputs →
wrong outcome a user would see), the file:line evidence, and the fix with
its blast radius. Separate **defects** (provably wrong) from **product
calls** (pacing, taxonomy, what belongs on the page) — do not decide the
second kind unilaterally.

---

## Sub-feature 1 — Unlocked Achievements Count

The header renders `{namedEarned} / {namedTotal}` plus a `+{extra}` suffix
(`AchievementsTab.jsx:280-299`). Confirm or refute each of these; do not
assume any is true:

1. **Does the numerator agree with the list below it?** `namedEarned`
   excludes `isTail` and `season` trophies; the Earned tab renders all of
   them. A user can therefore count more badges on screen than the header
   admits to. Decide whether `+N` closes that gap or just names it.
2. **Is `namedTotal` honest?** It is `TROPHIES.length` — every named rung in
   the catalog, including rungs gated behind features a user may never open.
   Work out the largest denominator a solo user can actually reach and
   compare. A denominator nobody can finish is a product call, not a defect;
   report it as one, with the number.
3. **Does the count agree with every OTHER surface that shows one?** The
   profile, `public_profiles`, and any leaderboard or hub join that carries
   an achievement figure. Two sources of truth for "how many badges" is the
   classic drift bug in this repo — see the denormalised-columns section of
   `CLAUDE.md`, and **count the populated rows before trusting any column**
   (`SELECT count(*), count(the_column) …`).
4. **What does the count read as on a brand-new account?** `0 / 120` with a
   zero-width bar is the app opening with a scoreboard that says you have
   done nothing.
5. **Is the count reachable without opening the vault?** `grantEligible()`
   runs on vault open. If nothing else calls it, the count is stale
   everywhere else until the user visits — check what `checkAndCelebrate()`
   is wired to.

## Sub-feature 2 — Achievement List

Two tabs, "In progress" and "Earned" (`:337-355`), over a ladder-grouped
body.

1. **Can the same rung appear twice**, or a rung vanish? `earnedRows` keys
   on `row.trophy_id`; `LadderRow` renders earned rungs as medallions AND
   the Earned tab renders them as cards. Check the dedupe on both.
2. **What happens to a trophy id the catalog no longer knows?**
   `earnedRows` filters on `getTrophy(id)` truthiness — a row that fails to
   resolve is silently dropped from the list *and* from `extra`. Query
   production for ids in `user_trophies` that `getTrophy` cannot resolve.
3. **Does the "In progress" tab ever render nothing?** Ladders whose signal
   the server does not populate sit at 0 forever. Establish which signals
   `get_trophy_progress` actually returns against the LADDERS list — a
   signal key that does not exist in the payload is a permanently-empty bar
   and is invisible in code review.
4. **Empty states.** The Earned tab has one. Does the In-progress tab? Does
   the Locked section render its own zero case?
5. **i18n.** The app ships 15 languages. Count the untranslated literals on
   this surface — `AchievementsVault` alone hardcodes "Back" and
   "Achievements", and every trophy `name` / `description` in the 587-line
   catalog is an English literal with no key. Decide whether that is
   English-only-by-decision (like `journal.*`) or an oversight, and say
   which. **Do not machine-translate** — that is a standing rule here.

## Sub-feature 3 — Filter by category

**Start from the null hypothesis that this control does not exist.**
`TROPHY_CATEGORIES` (ten entries) is used as static section headings at
`:366-374`; the only stateful control on the page is the two-way
`tab` state. `AchievementsVault.jsx`'s own header comment claims the tab
"already handles category tabs" — verify that claim before repeating it.

1. Is there **any** category control anywhere — the vault, a retired
   component, the old `AchievementsModal`? Grep the retired generation too.
2. If absent: what would it cost, and **is it worth building?** Ten
   categories over a single scrolling column on a 390px viewport may be
   better served by the existing grouped headings than by a filter that
   hides nine tenths of the page. Give a recommendation with a number
   (rungs per category, scroll length of the current page).
3. If a filter is recommended, note the constraints it must respect:
   `tileRow()` rather than `grid-cols-N` for a data-driven count, the two
   spacing registers, no gradient, no glassmorphism. See the UI composition
   section of `CLAUDE.md`.

## Sub-feature 4 — Share an Achievement

The Share button sits on every earned card (`:476-487`) and calls
`shareAchievementPost` (`src/lib/data/shareAchievement.js`).

1. **Does the post render in the feed?** It writes `post_type:'achievement'`
   with a `linked_entity_snapshot` and a deliberately-NULL
   `linked_entity_id` (a badge id is a slug, and the column is a UUID —
   sending one raises `22P02`). Confirm `HubPostCard` reads the snapshot and
   not the id, and confirm on a real row.
2. **Can the same badge be shared twice?** `sharingId` is single-flight
   *within one mount* only. Nothing appears to prevent five identical posts.
   Decide whether that is acceptable or needs a guard.
3. **Does the toast tell the truth?** The module header says the user gets a
   toast with an "Open" action pointing at the post; the call site raises a
   plain success toast. Check what actually fires — and note that the
   toast-policy wrapper in this repo has twice silently dropped whole
   variants (see the toast section of `CLAUDE.md`).
4. **Privacy.** The post is hardcoded `privacy: 'public'`. Check that
   against the user's own default post privacy and against a private
   profile. Sharing a badge should not be the one path that publishes past
   someone's setting.
5. **Failure paths.** The catch reports through `reportError` with
   `feature: 'achievements.share'` — confirm that tag exists in Sentry's
   expected set, and that a network failure leaves no spinner stuck.
6. **i18n and a11y.** The button label "Share" and its `aria-label`
   (`Share ${trophy.name} to Hub`) are English literals; the success and
   failure toasts go through `tFallback`. That is an inconsistency inside
   one 12-line component.

---

## Constraints — from `CLAUDE.md`, read it first

- **The client never computes XP, coins, or achievements.** Trophies are
  granted by `grant_eligible_trophies()` SECURITY DEFINER against
  `auth.uid()`. Migration 189 removed a client INSERT policy precisely
  because it allowed badge forgery. Nothing you propose may reintroduce a
  client-side grant.
- **Before writing a migration that references existing schema, grep for the
  real column/function name.** The most common defect in this repo is
  referencing something that does not exist.
- **Paste-safe SQL**: no dotted `alias.column`, no record `.id` tokens. CTEs
  with `USING()`, bare columns, `#variable_conflict use_column`.
- **Declare every `const` before first use**, including inside deps arrays.
- Gate before push: `npm run lint` clean, `npm run test`, `npm run build`.
- Push the feature branch, then fast-forward `main`. Never force-push.
- After every push, post the SQL inline in a ```sql block, or say
  "No SQL needed — frontend only". Never point at a file path.
- The tree is shared with a second Claude session. `git fetch` and rebase
  before non-trivial edits, and **never `git stash`** — use a worktree
  branched off `origin/main`.

## Done means

A written audit at `docs/achievements-audit.md`: the two inventory tables,
a verdict (a/b/c/d) per sub-feature with claim / proof / what-failure-looks-like,
production ground truth with the date it was measured, and one
severity-ranked findings table separating defects from product calls.

**A clean sub-feature is a valid result.** Say so plainly and show the
evidence rather than manufacturing a finding to justify the pass.
