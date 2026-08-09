# CLAUDE.md

Working notes for Claude sessions on this repo. Skim this first — it
will save you ~15 minutes of exploration on your first task.

## What this is

**Flexyn** — a fitness companion PWA. React + Vite + Supabase + Tailwind +
Radix UI + Tanstack Query + Framer Motion. Five top-level routes
(Dashboard, Workout, Hub, Progress, Nutrition) plus four hoisted-from-
Hub destinations (Messages, Market, Coach, Onboarding). PWA installable
on iOS / Android / desktop. 15 supported languages.

The README has the production overview; this file is for working
conventions a contributor needs day-to-day.

**How this file is ordered.** Invariants first — the properties the app
depends on, where being wrong means a security or data bug, not an ugly
screen. Then how to work here (workflow, layout, tests, guards). Then the
domain sections. Then history: the May 2026 session journal and the standing
out-of-scope list are at the BOTTOM because they are the least likely thing a
contributor needs and the most likely to have gone stale.

Three habits this file exists to enforce, all learned expensively:

- **Read the installed artefact, not the migration that created it.** A later
  migration redefining a function from a stale template is invisible in the
  file that "owns" the feature. `pg_get_functiondef()` is the source of truth.
  Push notifications had never sent a single request for months because of it.
- **Before treating a grep hit as debt, read the comments.** The reasoning in
  this codebase lives in comments that greps don't read, so a raw count is a
  question, not a conclusion. Four of five findings in one audit shrank or
  inverted on inspection.
- **Count the populated rows before you trust a denormalised column.**
  `count(col)` against `count(*)`. Several columns here are NULL or 0 on
  *every* row because nothing has ever written them, and a reader gets a
  plausible zero rather than an error — so it never surfaces as a bug. See
  the section below.

## INVARIANTS — break these and you ship a security or data bug

Everything below this heading is a convention. Everything in this section is a
property the app depends on. Read it before writing code that touches XP,
coins, achievements, or anything keyed to a user.

### The client never computes XP, coins, or achievements

The server is authoritative. This is not a style preference — it is enforced in
the database, and client-side arithmetic will be **silently clamped, rejected,
or rate-limited** rather than failing loudly.

| Migration | What it enforces |
|---|---|
| `042` | `increment_user_xp` credits `auth.uid()` only — the client-supplied `p_user_id` is IGNORED. Single grant capped at 100k. |
| `142` / `173` | Privileged `user_profiles` columns are immutable to direct PostgREST writes. The RPC is the ONLY path. |
| `176` | `increment_flex_coins` mint guard: 2,500/call, 25,000/day, against `flex_coin_grant_ledger`. |
| `180` | Crew-war XP clamp. |
| `188` | Rolling 24h per-user XP cap inside the RPC, plus an append-only audit ledger that both drives the cap and is the tamper-proof log. |
| `189` | XP-milestone achievements granted by `grant_xp_milestone_achievements()`. The client used to INSERT achievement rows directly, which let any signed-in user forge a badge. |
| `192` | `grant_level_up_rewards` clamps `p_new_level` to the server's `current_level`. It previously trusted the client, so any authenticated user — including an anonymous guest — could pass 99 and mint the entire capsule ladder plus ~6,800 coins in one call. |
| `262` | Cardio XP caps. |
| `264` | Flex-coin ledger + mint ceiling, applied as a TRIGGER rather than by restating 22 SECURITY DEFINER functions — see that migration's head for why. |

Consequences a contributor must know:

- **Never write `flex_coins`, `total_xp`, `current_level` or any other
  privileged column from the client**, and never patch them into the profile
  cache from a client-computed value. The full list is in the Profile cache
  section; `flex_coins` is doubly unsafe because 264's trigger clamps credits
  past the rolling ceiling, so even an accepted write may not store the number
  you sent. Patch only with a value the **server returned**.
- **Awarding something new means a SECURITY DEFINER RPC**, deriving the user
  from `auth.uid()` — never from a parameter. Then `REVOKE` it from PUBLIC and
  run `get_advisors` (see the Scheduled workouts section for how a missing
  REVOKE exposed a cron-only function to `anon`).
- **The anti-cheat systems are not advertised in the product.** Onboarding used
  to name them and the signals they watch on its second screen; that copy is
  gone and `src/pages/__tests__/goalStepCopy.test.js` fails if it returns. A
  check only works while it is not universally known.

### Privacy boundaries that are enforced, not just intended

Four holes were found in one pass on 2026-08-06, and **three of them were
found by testing a claim this file already made.** The docs described the
intent correctly every time; the enforcement had drifted. That is a cheap
audit to repeat against the rest of these invariants — pick a sentence
here, write the SQL that proves it, and run it as the role it is meant to
stop.

The technique that found all four: `BEGIN; SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
… ROLLBACK;` — actually attempting the thing that should fail. MCP and
the SQL editor run as `postgres` and bypass RLS entirely, so a query that
"looks fine" there proves nothing.

- **`gym_members` is readable only for your own rows or a gym you belong
  to** (mig 301). It carried `USING (true)` until then, so any signed-in
  user could pull any gym's roster and join it to `public_profiles` for
  usernames, avatars, XP and streaks — while the leaderboard RPCs
  correctly answered 42501. The gate was on the expensive door with the
  window open.
- **`is_blocked(uuid, text)` is INTERNAL** (migs 302, 304). It takes the
  viewer as a parameter, so exposing it lets anyone probe "does X block
  Y?" for pairs they are not half of. It is revoked from `anon` and
  `authenticated`; only SECURITY DEFINER callers reach it. Client and
  policy code uses **`viewer_is_blocked_by(text)`**, which reads the
  viewer from `auth.uid()`.
  **Do not "fix" is_blocked by guarding on `p_viewer_id = auth.uid()`.**
  `enforce_block_on_dm_send` and `notify_dm_received` legitimately pass
  the RECIPIENT's id — "does the person I am messaging block me?" — and
  that guard would silently switch off block enforcement on DMs.
- **The hub feed's read policies are `TO authenticated`** (mig 303). They
  were `TO PUBLIC` and unreachable by anon only because anon lacked
  EXECUTE on `current_user_email`. Depending on a missing GRANT is not a
  boundary. Measured: granting anon those helpers exposed 23 posts and 8
  comments; after scoping the policies, 0 and 0.
- **Gym activity is previewable without identity above a threshold**
  (mig 301). `get_gym_public_preview` returns counts and bare day-count
  integers, and withholds everything but the member count below **five
  members** — because the roster is visible to members, so at smaller
  sizes an individual's attendance is derivable by subtraction. The
  threshold is what protects people; omitting names is not.
- **`public_profiles` is a SECURITY DEFINER view ON PURPOSE, and
  `get_advisors` will report that as ERROR forever.** Do NOT "fix" it by
  setting `security_invoker=true`. `user_profiles` has RLS restricting you
  to your own row, so the view has to run as its owner to see anyone else
  — and it applies its own predicate instead: `WHERE NOT
  viewer_is_blocked_by(email)`, plus `full_view := NOT is_private OR id =
  auth.uid() OR viewer_follows(email)` gating bio, city, website,
  last_active, XP, level, prestige, lifetime_xp, volume, distance,
  achievements, streaks, league_tier and trophy_case. Flipping the flag
  makes the view fall back to that RLS and return ONLY YOUR OWN ROW, so
  every profile page, leaderboard join and follow suggestion silently goes
  blank and reads as a data problem rather than a config one.
  Two things the linter cannot see, and both are why this is safe:
  `email` is selected in the inner subquery (the helpers key on it) but is
  NOT in the outer select, so the view has no email column; and `anon` has
  no SELECT grant, only `authenticated`. `auth.uid()` still resolves to the
  real viewer inside a definer view — it reads the JWT session setting, not
  the role — which is the whole reason the predicate works.
  Verified 2026-08-09 by seeding what production does not have: **0 of 41
  profiles are private**, so `full_view` had never once been false and a
  check against live data would have exercised one branch. Seeded and
  rolled back, as a real authenticated viewer: private + not following →
  row visible, `bio`/`total_xp`/`workout_streak` all NULL; private +
  following → both revealed; target blocks viewer → 0 rows; own private
  profile → full; `anon` → `permission denied for view public_profiles`.
  Note what stays visible on a private profile by design — username,
  full_name, avatar_url, country_flag, created_at, equipped cosmetics —
  because you have to be able to see who someone is in order to follow
  them. "Private" hides stats and bio, not identity.

**Rewriting an RLS policy: prove equivalence on seeded data.** The live
hub had 23 public posts, zero followers-only, zero scheduled and zero
blocks, so a before/after there would have exercised one branch. Seed the
missing cases, capture the exact SET of visible row ids per viewer, apply,
capture again, and diff both directions. Matching counts are not enough —
all four test viewers matched on counts while a swap would have been
invisible.

**`ALTER POLICY … TO role` changes roles without restating the
expression.** Prefer it to DROP/CREATE: `hub_posts`' old expression
carried `hub_follows.follower_email` and `hub_posts.author_email`, exactly
the `alias.column` tokens the paste pipeline mangles (see the workflow
section). Where the expression genuinely must change, hoist correlated
subqueries into helper functions so the policy is bare columns and
`public.fn()` calls only.

### Identity — four keys, and which one to use

Rows are keyed four different ways, which is a real source of bugs (the
`followed_email` / `followee_email` mix-up broke 100% of Block-button clicks).
Across `src/lib/data/` alone: `user_id` 231 uses, `created_by` 71,
`user_email` 47, `owner_id` 17, `author_email` 16.

- **`user_id UUID REFERENCES auth.users(id)` is the key. RLS gates on
  `auth.uid()`.** Every new table gets this.
- **`created_by TEXT` is an email and a base44 legacy** — migration 001 says so
  in a comment. Older tables carry BOTH and their policies read
  `auth.email() = created_by OR auth.uid() = user_id`. `makeEntity().create` in
  `src/api/db.js` auto-injects both so RLS passes either way. Don't add
  `created_by` to a new table.
- **A denormalised `user_email` is for delivery, not identity.** It exists on
  tables the push fan-out reads (`scheduled_workouts`, `notifications`) so the
  worker doesn't need a join. It is written by the RPC from `auth.uid()`, never
  accepted from the client — that's exactly why `scheduled_workouts` has no
  client INSERT policy.
- **Never gate on a client-supplied identifier.** Migration 108 was a privacy
  leak from trusting a client-passed email.

## Workflow

1. `git fetch origin && git rev-list --left-right --count HEAD...origin/main`
   before any work. If origin is ahead, rebase.
2. Edit. Run `npm run lint` + `npm run build` (and `npm run test` if
   logic changed).
3. Commit with a multi-paragraph message that explains the why, not just
   the what. Use HEREDOC so quotes survive.
4. `git push origin <branch>` — push the feature branch first.
5. `git push origin <branch>:main` — fast-forward main. Only after the
   branch push succeeds.
6. **ALWAYS, after every push, send the user the SQL to run.** This is a
   standing instruction (kegan, 2026-05). Frontend ships via Netlify
   auto-deploy from `main`, but the DB is deployed by the user manually
   pasting SQL into the Supabase SQL editor — so a push is only "done"
   once they have the matching SQL. After each push, report EITHER:
     • the pending migration(s) as a copy-paste block, OR
     • "No SQL needed — frontend only" when the change touched no
       migrations / DB objects.
   Don't wait to be asked. See the paste-safety rule below — the SQL
   you hand over must survive the user's clipboard pipeline.
   **MANDATORY, NO EXCEPTIONS (kegan, 2026-05, mobile):** ALWAYS paste the
   actual SQL inline in chat inside a fenced ```sql code block so it has a
   one-tap copy button. NEVER tell the user to open / copy a file from the
   repo or GitHub — they are on mobile and cannot open files. This applies
   no matter how long the SQL is; if a bundle is huge, split it across
   several ```sql blocks in the SAME reply (each its own copy button) and
   tell them the run order — but it must all be in chat. A file path is
   NEVER an acceptable substitute for the inline SQL.
7. **Paste-safe SQL is mandatory.** The user's paste pipeline mangles
   short `alias.column` tokens AND record-field `.id` tokens (e.g.
   `up.id`, `v_verif.id`, `v_capsule.id`) → `42601 syntax error at "<"`.
   Only emit: `public.<table>`, `auth.<fn>()`, `NEW.`/`OLD.`, bare
   columns in single-table statements, CTE-renamed join keys, and
   `#variable_conflict use_column` for RETURNS TABLE OUT-param shadowing.
   Prefer scalar `SELECT ... INTO v_a, v_b` over `%ROWTYPE` + dotted
   record access. A migration that's fine for a CLI runner can still
   mangle on paste — rewrite the bundle you hand the user accordingly.
8. Update tasks via `TaskUpdate` (this session uses TaskCreate /
   TaskUpdate / TaskList — `TodoWrite` was deprecated mid-session).

## Two engineers, parallel sessions

Two Claude sessions edit this repo concurrently — yours and a teammate's.
**Before any non-trivial edit, fetch origin and rebase.** Direct pushes
to `main` are the convention here (no PR workflow). Push your feature
branch first, then fast-forward `main`. Never force-push `main`.

See: `~/.claude/projects/C--Flexyn/memory/feedback_parallel_sync.md`.

## File locations cheat sheet

- New page → `src/pages/<Name>.jsx`, registered as a lazy import in
  `src/App.jsx`.
- New data-layer function → `src/lib/data/<table>.js`. Export named
  functions, use `supabase` from `@/api/supabaseClient`, wrap
  column-named reads in `safeSelect`. If it writes `user_profiles`, read
  the "Profile cache" section above first — you almost certainly need a
  `patchProfile()` call, and you must import `@/api/profileCache` rather
  than `@/api/db`.
- New component → `src/components/<area>/<Name>.jsx`. Components for
  Dashboard go in `dashboard/`, hub in `hub/`, etc.
- A row of things whose COUNT comes from data → `tileRow()` from
  `src/lib/tileRows.js`, never `grid-cols-N`. See the rule in the UI
  composition section below.
- New lib helper → `src/lib/<helper>.js`. If it's a celebration, mirror
  one of the existing `*Celebration.js` files.
- Anything that changes what the AI Coach programs → `src/lib/aiCoach/`,
  and read the "AI Coach personalization" section above first. New context
  inputs go through `buildTrainingModifiers` (clamped + explained on the
  card), not straight into `generateWorkout`.

## Testing

- Framework: vitest, jsdom. Setup in `src/test/setup.js`.
- Existing tests: `src/lib/__tests__/`, `src/lib/data/__tests__/`,
  `src/components/__tests__/`, `src/api/__tests__/`, `src/hooks/__tests__/`.
- Supabase mock pattern: see `src/lib/__tests__/capsuleMilestones.test.js`
  or `src/lib/data/__tests__/injuries.test.js` for the chainable-mock shape.
- Confetti tests: `canvas-confetti` mock leaks across tests because
  `setTimeout`-scheduled bursts from prior tests can land in later
  buffers. Filter the mock calls by a **unique signature** (e.g. the
  helper's distinctive origin coords) rather than asserting on exact
  call count.
- Data-layer modules under `src/lib/data/` are worth testing directly, not
  only through the components that call them. `equipment.js` looked covered
  because `ImplementPicker.test.jsx` mocked `persistEquipmentPhoto` — but
  the mock always returned null, so every step between the picker and the
  database was untested. A mocked dependency is not coverage of that
  dependency. See `src/lib/data/__tests__/equipment.test.js` for a
  chainable-mock shape that asserts on the **sequence** of statements,
  which is usually the part that's actually unproven.
- `npm run test` — full suite. `npm run test:watch` — watch mode.
  `npm run test:coverage` — V8 coverage. As of 2026-08-06: **2769 tests
  passing across 198 files**.

## Build guards (don't disable)

The build has an `onwarn` hook in `vite.config.js` that turns specific
Rollup warning codes into **build failures**. These were added after a
production crash on 2026-05-23 — a `inventory.listMine` call referenced
a non-existent named export, Vite's `logLevel: 'error'` setting silenced
the `MISSING_EXPORT` warning, and the bug shipped as a runtime crash.
The guard ensures that defect class can never silently land again.

Currently blocking:
- `MISSING_EXPORT` — `import { foo } from 'mod'` or `ns.foo` where
  `foo` isn't on the module's exports. Symptoms in production: silent
  `undefined`-call TypeError, or in some bundler configs a minified
  TDZ (`can't access lexical declaration 'oe' before initialization`).
- `UNRESOLVED_IMPORT` — module path doesn't resolve at build time.
- `PLUGIN_ERROR` — a Vite/Rollup plugin escalated to error (shouldn't
  be a warning anyway).

**If the build fails with `[vite-build-guard]`** — don't disable the
guard. The warning corresponds to a real bug. Fix the import, then
rebuild. If you have a defensible case for treating one as a false
positive (extremely rare), surface it explicitly rather than removing
the code from the blocking set silently.

## TDZ trap — declare const/let BEFORE first use

JavaScript hoists `function` declarations but **not** `const` or `let`.
Code that *reads* a const-bound name before its declaration line
throws `ReferenceError: can't access lexical declaration X before
initialization`. Dev mode masks some patterns (React's double-render,
JSX callback fns that only run after render); production minified
re-orders statements and the bug fires on the first render.

The 2026-05-23 production Hub crash was this exact pattern in
`HubPostCard.jsx`:

```jsx
function HubPostCard({ post }) {
  // ...
  useEffect(() => {
    if (... || isMine) return;     // ← reads `isMine`
    // ...
  }, [user?.email, post.id, isMine]);  // ← AND in deps array

  // ... 80 lines later ...
  const isMine = post.author_email === user?.email;  // ← declared LATE
}
```

The deps array `[..., isMine]` is evaluated synchronously when
`useEffect` is called, but `isMine` is in TDZ at that point. **Always
declare a `const` before its first use, including inside any
`useEffect` / `useMemo` / `useCallback` deps array.**

ESLint has `no-use-before-define` configured at `'warn'` level
(masked by `--quiet` in the default `npm run lint` script — run
`npx eslint .` to see all 141 existing warnings). Goal is to upgrade
to `'error'` once those are cleaned up. New code: don't add new
violations of this rule.

## ESLint

- `npm run lint` — must exit clean before any push. It runs `--quiet`, so
  it only reports ERRORS. Run bare `npx eslint .` to see the 240 warnings,
  which is where the standing debt lives.
- Common stumble: teammate's commits sometimes land unused imports
  (`X`, `useCallback`, etc.). Those are chore commits — fix in a
  separate small commit so the blame stays clean.

**`react-hooks/exhaustive-deps` was registered but never enabled** (fixed
2026-08-06). The plugin was in `plugins:` and `rules-of-hooks` was on, but
its other half was missing from the rules block — so every
`eslint-disable-line react-hooks/exhaustive-deps` in the codebase had been
suppressing a rule that wasn't running. ESLint reports those as "unused
directive", which reads like a dead comment and invites deletion; **26 of
the 34 were doing real work the moment the rule existed.** Deleting them
would have silently un-suppressed 26 deliberate decisions with nobody
looking. It is now `'warn'` with 65 pre-existing violations, in the same
posture as `no-use-before-define` — see the comment in
`eslint.config.js` for the upgrade path.

Lesson worth keeping: **"unused eslint-disable" means the rule produced no
error, NOT that the code is clean.** Check whether the rule is even on
before treating one as debt. And when you add a plugin, check you enabled
every rule you meant to — a half-configured plugin fails silently and
looks configured.

**`src/lib/**` is now linted too** (2026-08-06). It never had been: the
component block's `files:` globs cover only `src/components`, `src/pages`
and `Layout.jsx`, and `src/lib` was in its `ignores` on top of that. So
every data module, context provider, helper and i18n part file was
unchecked — most of the app's logic — and a clean `npm run lint` said
nothing about any of it. It now runs the same rules; `src/lib/i18n-langs/`
is excluded because `split-i18n.mjs` generates it (ESLint doesn't read
`.gitignore`, so generated output has to be named in `ignores`).

That surfaced 18 dead imports, **nine of them `safeSelect`** in
`src/lib/data/` modules that import it and never wrap anything — worth
knowing, because the Resilience-layers section says a new `.select()`
with explicit columns should go through it, and those nine reads don't.

**Zero unused directives remain, and that's the target.** A directive
naming a rule that isn't enabled suppresses nothing and reports forever
as a warning, which trains people to ignore lint warnings. Intent belongs
in a prose comment next to the code — every one removed already had one.
The two shapes that came up:

- **Wrong rule name.** `src/lib/toast.js` disabled `no-unused-vars`,
  which this config explicitly sets to `"off"` in favour of
  `unused-imports/no-unused-vars`. Renaming it made it work.
- **Rule not enabled at all.** `no-console` in `reportError.js`,
  `no-alert` in `ErrorBoundary.jsx`. Removed; if either rule is ever
  turned on, lint names the exact lines to re-annotate.

## Build & analyze

- `npm run dev` — Vite dev server.
- `npm run build` — production build. Vite + manual chunking in
  [vite.config.js](vite.config.js) splits the heaviest deps into their
  own vendor chunks (`vendor-tfjs`, `vendor-supabase`, `vendor-charts`,
  `vendor-motion`, etc.).
- `npm run analyze` — build with `ANALYZE=true` so
  rollup-plugin-visualizer writes a treemap to `dist/bundle-stats.html`.
  Use this when adding a substantial library or wondering where bytes
  went.
- Lazy-loading rule: modals and tabs that only mount on user action
  should be `React.lazy()` + `<Suspense fallback={null}>`. Existing
  examples: `DebriefVault`, `InjuryForm`, the page chunks in `App.jsx`.
- `html2canvas`, `canvas-confetti`, `@zxing/browser`, and `maplibre-gl`
  are excluded from the `vendor-misc` chunk so their dynamic imports
  get their own lazy chunks. Don't break that — see the `manualChunks`
  function in vite.config.

## Verifying against production — three layers

Each layer catches what the one below it cannot, and every real bug in the
July 2026 equipment/storage work was found by dropping a layer:

1. **SQL as `authenticated`** — `BEGIN; SET LOCAL role authenticated; SET
   LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'; …
   ROLLBACK;` with the client's statements issued **separately** (CTEs in
   one statement can't see each other's writes, which gives a false
   "blocked"). This is the only way to test RLS — raw MCP/SQL-editor
   queries run as `postgres` and bypass it entirely. Blind to PostgREST and
   Storage: a bucket MIME allowlist is enforced by the Storage service, not
   the database.
2. **A node probe** using the anon key from `.env.local` plus
   `supabase.auth.signInAnonymously()`, driving the real HTTP APIs. Proves
   the service layer. Clean up whatever it writes.
3. **The deployed site in the browser pane.** A file input can be driven
   without a real file: build a `File` (canvas → `toBlob` for an image,
   `MediaRecorder` over `canvas.captureStream()` for a genuinely decodable
   video), assign via `DataTransfer` to `input.files`, dispatch `change`.

## Denormalised columns nothing writes

**Before trusting any denormalised column, count the populated rows:**
`SELECT count(*), count(the_column) FROM the_table`. This repo has a standing
habit of adding a convenience column, reading it everywhere, and never
wiring the write. The reader then gets a plausible **zero** instead of an
error, so it never surfaces as a bug — it just makes a feature quietly wrong
for months.

Found in one pass on 2026-08-09, auditing what the weekly review reads:

| Column | Populated | Consequence |
|---|---|---|
| `workout_logs.total_volume` | **0 of 3** | Every weekly review said "0 lbs". `get_gym_leaderboard` ranked members on it and `get_gym_community_progress` summed it into the gym's "lbs moved", so both read zero for every gym since launch. `dayContext.js` had already worked around it. |
| `cardio_logs.duration_min` | **0 of 5** | The tracker writes `duration_seconds`. Cardio "moving time" was always 0. |
| `workout_logs.duration_min` | **0 of 3** | No other source for a lifting session, so the UI drops the stat rather than faking it. |
| `league_members.rank` | **0 of 42** | Only written when a league RESOLVES. Anything gating on it is invisible during the week it describes — which is the only week it matters. Currently has no reader at all. |
| `nutrition_logs.food_item_id` | **0 of 120** | The food-catalog join has never been exercised. |

`total_volume` is fixed at both ends — `Workout.jsx` persists it on save, and
migration 329 backfilled the existing rows with the same formula. The weekly
review derives volume from the `exercises` JSONB regardless, so it is correct
even on a row that was never written.

**Two shapes, two different causes — don't group them.** *0-of-N* means no
writer exists. *k-of-N* means a writer exists and one entry path skips it, and
that is usually NOT a bug: `nutrition_logs.protein` is 6 of 120 because the AI
recogniser and the full-macro form both write it while quick-add captures
calories only. Treating that as a dead column would have produced a migration
that fixed nothing. The correct handling is in the UI — the macro bar is gated
on a macro total, so a calorie-only week says so instead of drawing a
zero-width bar over three "0 g" labels.

**A section with no data must not render as zeros.** A `0` reads as a failure
the user did not commit; "0 kcal" at someone who does not track food is the app
calling them lazy. Same for a fixed stat row — drop the stats that have nothing
behind them rather than rendering a permanent column of em dashes.

### Stored volume is RAW — the bar-weight preference is display-only

`include_bar_in_volume` adds ~45 lb per rep on every barbell set. It is a
**display** choice, and `workout_logs.total_volume` must never carry it:
`get_gym_leaderboard` ranks members against each other on that column, so a
user flipping a Settings toggle would climb past someone who lifted identical
weight. Nobody is cheating; the number just stops meaning one thing.

- **Persisted or spent** — `workout_logs.total_volume`, the `total_volume_lbs`
  RPC credit, the `WORKOUT_VOLUME` reward action, solo-challenge progress, and
  the edit/delete reconciliation deltas — all take `includeBarWeight: false`.
- **Display** — `LiveVolumePill`, the share card and the saved list re-derive
  from the `exercises` array and honour the preference there.

The weekly review is deliberately preference-blind despite being a personal
stat: it sits one tap from the gym and crew boards, and a personal number that
silently disagrees with the comparative number beside it is worse than one that
is merely raw.

## Deploying an Edge Function — the CLI does not work in this repo

**`supabase functions deploy <name>` fails here, and it fails in a way that
reads like success if you aren't watching.** There is no
`supabase/config.toml` in this repo, and CLI 2.109.1 ignores the
`supabase/.temp/linked-project.json` that *does* carry the right project ref
(`ebvqxuwfiptcmlkhflfj`). You get:

```
{"_tag":"Error","error":{"code":"LegacyProjectNotLinkedError",
 "message":"Cannot find project ref. Have you run supabase link?"}}
```

Nothing is uploaded. This cost a full cycle on `coach-chat` (Aug 2026): the
function was written, committed, and believed deployed, and every client call
404'd — which the client latches as PIPELINE_MISSING and silently falls back
from, so the app looked fine and the feature was simply absent.

Deploy paths that DO work:

- **The Supabase MCP tool** — `deploy_edge_function` with `project_id`,
  `name`, `entrypoint_path`, `verify_jwt`, and the file contents. No local
  auth needed. This is how `coach-chat` v1 shipped.
- **The dashboard** — Edge Functions → Deploy, paste the source.
- **The CLI with an explicit ref**, if you have `SUPABASE_ACCESS_TOKEN` or
  have run `supabase login`:
  `supabase functions deploy <name> --project-ref ebvqxuwfiptcmlkhflfj --no-verify-jwt`

**Always confirm the deploy landed** with `list_edge_functions` rather than
trusting the command's exit — check the slug appears and `verify_jwt` matches
what the function expects. `verify_jwt` must be **false** for anything the
browser calls directly (`send-push`, `recognize-meal`, `coach-chat`): with it
on, the CORS preflight (OPTIONS, no Authorization header) is rejected at the
gateway before the function's own auth gate ever runs. Those functions
authenticate *inside* the handler — Bearer JWT + `client.auth.getUser()`.

**Verifying a deployed function** is layer 2 of the three layers below: a node
probe with the anon key from `.env.local` plus `supabase.auth.signInAnonymously()`,
invoking through `supabase.functions.invoke` exactly as the app does. That
exercises the real JWT gate and any quota RPCs; MCP/SQL-editor queries run as
`postgres` and prove nothing about the auth path. Clean up the rows the probe
writes — an anonymous user still increments quota tables.

## Database migrations

- All migrations live in `supabase/migrations/NNN_*.sql` in execution order.
- The runbook is [docs/migrations-runbook.md](docs/migrations-runbook.md)
  with a state-check query at the bottom — paste it into Supabase SQL
  Editor to see what's deployed.
- **Every `CREATE POLICY` must be guarded with `DROP POLICY IF EXISTS`** —
  Postgres doesn't support `CREATE POLICY IF NOT EXISTS`, so a retry of a
  partially-applied migration fails with `42710` otherwise. Migrations
  047, 048, 050, 051, 052, 053 follow this pattern; 043 and 044 were
  patched after the fact. See:
  `~/.claude/projects/C--Flexyn/memory/feedback_postgres_policy_idempotency.md`.
- The same rule applies to triggers (`DROP TRIGGER IF EXISTS` before
  `CREATE TRIGGER`). Other idempotent constructs (`CREATE TABLE IF NOT
  EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE
  FUNCTION`, `INSERT ... ON CONFLICT DO UPDATE`) already self-guard.
- **Numbering with parallel engineers**: pick the next free `NNN` when
  you start. If two branches independently pick the same number, the
  branch that lands second renames its file to `NNN+1_*.sql` before
  pushing. Files at the same `NNN` are tolerated if their bodies are
  independent (current examples: `054_bio_profanity_check.sql` +
  `054_duels.sql`, and `055_crew_wars.sql` +
  `055_first_workout_capsule_flag.sql` — both pairs touch disjoint
  tables, so the alphabetical execution order is harmless). Don't add
  a third file at the same number — renumber instead.
- **"Free" has TWO answers and you need the pessimistic one.** Neither
  place you'd naturally look is complete on a shared checkout:
  `ls supabase/migrations` **overstates** what's taken (it shows files
  that are untracked or committed-but-unpushed, which nobody else can
  see) and `git ls-tree origin/main` **understates** it (it misses
  exactly those). The safe number is one past the max across **both**:

  ```bash
  { ls supabase/migrations; git ls-tree --name-only origin/main supabase/migrations/ | sed 's#.*/##'; } | grep -oE '^[0-9]{3}' | sort -n | tail -1
  ```

  This is not hypothetical and it recurs. On 2026-08-09 one session
  broadcast "the next genuinely free number is 329, not 328 — 328 exists
  locally unpushed, so `ls` shows it and origin/main does not." Within
  the hour 328 and 329 had both landed on `origin/main` and 330 existed
  as an untracked local file, so the answer was 331 and the advice would
  have collided with a *pushed* migration. The session that wrote it had
  correctly identified the trap one number earlier and still got caught
  by it, because a number that is free is only free until someone else
  takes it. (330 was then pushed in the minutes it took to write this
  paragraph, which is the point made twice: the answer moves under you,
  and only the pessimistic view is ever safe to act on.)
  **Re-derive it at the moment you create the file, not when
  you start the task**, and prefer colliding with your own unpushed work
  over someone else's pushed work — the first is a rename, the second is
  a rename plus a conversation.
- **Never quote a free number to another session.** All three sessions
  above sent each other a number that had expired by the time it was
  read, which is not three mistakes but one: a broadcast number is stale
  on arrival, because "free" decays the instant anybody pushes. Send the
  command, or send what you took — never send what you think is next.

## Profile cache — invalidating `['userProfile']` does NOT refresh it

`db.auth.me()` returns a **module-level cache** (`src/api/profileCache.js`)
and only re-reads the row when that cache is empty. So this does nothing:

```js
await supabase.from('user_profiles').update({ some_flag: true }).eq('id', id);
queryClient.invalidateQueries({ queryKey: ['userProfile', email] }); // ← refetches
// ...and the refetch calls me(), which hands back the SAME stale object.
```

The symptom is nasty because the write **succeeds**: with an optimistic
local state the control flips, then the effect that syncs from `profile`
reads the old value back, so the toggle reverts on remount while the row
holds the new value. UI and database disagree and the user can't tell which
is real. This bit the cycle-tracker X, all four Settings privacy toggles,
story privacy, quiet hours, prestige, trainer status and the equipped
title/frame — see commits 88933c0, 208cf82, 7db3f83.

**The rule:**

- `db.auth.updateMe()` refreshes the cache itself → nothing to do.
- A **raw `supabase.from('user_profiles').update()`** or an **RPC** that
  changes the row → call `patchProfile({ ...the columns you changed })`
  from `@/api/profileCache` on success.
- **Import `@/api/profileCache`, never `@/api/db`, from a data module.**
  `db.js` registers a `supabase.auth.onAuthStateChange` listener at module
  scope, so importing it drags that listener in and breaks any test that
  stubs the supabase client — this is exactly how `gymRival.js` broke
  `gymRivalOverthrow.test.js`. `profileCache.js` is plain state with no
  imports and is safe anywhere.

**Do NOT patch these** — migration 142 rejects direct client writes to them
with `42501`, so a client-computed value would cache something that never
persisted, which is worse than being stale:

> `flex_coins` · `total_xp` · `current_level` · `prestige_level` ·
> `league_tier` · `login_streak` · `workout_streak` ·
> `longest_login_streak` · `longest_workout_streak` ·
> `milestone_capsules_awarded` · `referral_code` · `referred_by` ·
> `last_daily_chest_at`

`flex_coins` is doubly unsafe: migration 264's ledger trigger **clamps**
credits past the rolling ceiling, so even an accepted write may not store
the number you sent. For all of these, patch only with a value the **server**
returned (an RPC's payload), never one computed on the client. The existing
raw writes to those columns are deliberately guarded pre-030 / pre-173
fallbacks — leave them alone.

Not worth patching either: pure write-only columns nothing reads back
through `me()`, e.g. the `last_active_at` presence heartbeat in `Layout.jsx`
and `HubProfile.jsx`.

## Resilience layers

The app uses a layered approach to failure handling — each layer catches
a different class of bug:

| Layer | Where | What it catches |
|---|---|---|
| Write strip-and-retry | `src/api/db.js` `updateMe` + `makeEntity().create` | 42703 / PGRST204 missing-column on inserts/upserts |
| Read strip-and-retry | `src/api/safeSelect.js` | Same, but for `supabase.from().select()` chains |
| Per-region ErrorBoundary | Wrapped around each major card on Dashboard / Workout / Progress / Goals / Nutrition | Render-time throws inside the section |
| Route-level ErrorBoundary | `src/App.jsx` on every route | Render-time throws in a whole page chunk |
| Recovery affordances | `src/components/ErrorBoundary.jsx` | "Go to Home" + "Try again" + "Copy details" + auto-reset on `location.pathname` change |
| Async error capture | `src/lib/reportError.js` | catch-block / mutation-onError failures → Sentry with feature tags |

**Patterns to use:**

- New `.select()` with explicit column lists → wrap in
  [safeSelect](src/api/safeSelect.js). Existing examples:
  `HubProfile.jsx`, `stories.js`, `debriefs.js`, `LoginStreakBanner.jsx`.
- New catch blocks for async failures → use
  [reportError](src/lib/reportError.js) with a `feature` tag (e.g.
  `workout.save`, `onboarding.starter-regimen`).
- New page → wrap in `<ErrorBoundary label="...">`. New region inside an
  existing page → same.

## Toast policy — everything except decoration now reaches the user

`src/lib/toast.js` is the app-wide wrapper. **The old "errors only" policy is
gone**, in two steps, and both were the same bug found twice:

- **2026-08-04** — `success` was suppressed unless it carried an `action`.
  271 of 283 non-error call sites carried none, so for a month a successful
  save was pixel-identical to a dead button. `success` became a passthrough.
- **2026-08-05** — that pass only scanned `success`. A second audit found
  **28 of 28** `info` / `message` / `warning` calls also carried no action.
  Not most — all. Among the messages nobody was seeing: `SetRow`'s
  "Capped at 315 lb" (the app silently overwriting a weight the user typed),
  the cardio tracker's "Auto-paused" / "GPS signal weak" mid-run, and
  Onboarding's "Some profile details could not be saved". All three became
  passthroughs.

Current shape:

| Variant | Behaviour |
|---|---|
| `error` `success` `info` `message` `warning` | always delivered |
| plain `toast(...)` | delivered only with an `action` |
| `loading` `custom` | suppressed (decoration) |

**Why this kept being invisible:** `keepIfAction` returns `undefined` and every
call site ignores the return value, so a dropped toast is indistinguishable
from a delivered one at the call site. Nothing throws, nothing warns, no test
failed. `src/lib/__tests__/toastPolicy.test.js` now asserts on **delivery** —
did sonner actually get called — and carries the call-site audit as a standing
check. Re-run it before re-filtering any variant: a variant where 100% of
callers pass no action isn't being filtered, it's being switched off.

## i18n discipline

- 15 supported languages: `en es fr de pt it ja ko zh ar hi ru tr pl nl`.
- Per-domain translation files: `src/lib/i18n-*.js` (e.g. `i18n-coach.js`,
  `i18n-goals.js`, `i18n-discovery.js`). Each exports a `{ <lang>:
  { 'key': 'value' } }` object.
- At build time `scripts/split-i18n.mjs` merges every part file into
  per-language aggregates under `src/lib/i18n-langs/`.
- New keys: add to a part file with English at minimum. At the call site
  use **`tFallback(key, 'English')`** so a missing translation surfaces a
  sensible string, never a key code.
- **NEVER `t(key) || 'English'`. It does not work**, and this file used to
  recommend it. `getTranslation` ends with `return enVal ?? key`, so a
  total miss returns the *key string* — which is non-empty, therefore
  truthy, so `||` never reaches the fallback. Eleven call sites had
  accumulated: five rendered raw key paths (two of them inside
  `toast.error`, so users saw a toast reading `nutrition.toast.waterCap`),
  five were dead-but-harmless, and one was worse than either —
  `t('progress.title') || 'of daily goal'` rendered **"45% Progress"** on
  the hydration ring, because that key exists and means the Progress page
  title. A missing key looks broken; that one looked fine and said the
  wrong thing. `src/lib/__tests__/i18nRawKeys.test.js` now fails the suite
  on the pattern itself, so it can't come back.
- **A language may appear at most once per part file.** JavaScript resolves
  a duplicate literal key by keeping the last block and discarding the
  earlier one silently — no error, no warning. Three of 41 files had this;
  it cost `onboarding.welcome.languageHint` in pt/it/ja/ko, the one string
  whose job is telling someone who can't read the current language how to
  switch, so those four fell back to English asking "Don't speak English?".
  `scripts/split-i18n.mjs` now fails the build on it. The guard is
  brace-depth aware because `i18n-warn.js` legitimately holds two separate
  object literals that each declare all 15 languages.
- Adding a new part file: name it `i18n-<domain>.js` and the splitter
  picks it up automatically. Export shape must match existing files.
- **Don't ship machine-translated copy** on prominent surfaces. If you
  can't get native-quality translations for all 15 languages, ship
  English-only for the missing ones with a `TODO(i18n)` comment in the
  file head.
  - **One deliberate exception exists**: `src/lib/i18n-equipment.js` (37
    short UI labels, machine-translated 2026-07-30 with Kegan's sign-off,
    on the reasoning that a reviewed-later label beats an English
    fallback). It marks itself as MT, tracks outstanding languages in an
    exported `REVIEW_PENDING`, and is guarded by
    `src/lib/__tests__/i18nEquipment.test.js`. **This is not a precedent**
    — don't machine-translate prose, onboarding, or marketing, and don't
    add a second exception without asking.

## UI composition — the rules that stop it looking generated

Full evidence and the rendered specs: `docs/ui-craft-research.md`,
`docs/ui-craft-prompt.md`, and the Penpot file **Flexyn Dashboard UI**. Written Aug 2026.

**Correction (2026-08-06):** this said the Penpot file held "8 boards, including a token
set carrying these values". It was **empty** when opened over MCP — no boards, no
components, no tokens. It now carries token sets generated from `index.css` and
`tailwind.config.js` (`core`, `theme.light`, `theme.dark`, `accent`, with Light/Dark
themes) plus boards for the consolidated Sharpen, Assessment and Age steps. Values in
this section are sourced from the CODE, so they were never wrong — but don't cite the
Penpot file as their origin.

Tokens produce *consistency*. Consistency with no hierarchy is exactly what reads
as AI-generated — uniform cards, one spacing value, no focal point. These rules
govern hierarchy, which tokens can't encode.

- **Two spacing registers, nothing between them.** Intra-group `gap-1`/`gap-2`
  (4–8px); inter-section `gap-6` (24px). The middle — `gap-3`/`gap-4`/`gap-5` —
  is **banned**: if a gap wants to be 12–20px, either those elements are one
  group (tighten to `gap-2`) or they are two (separate to `gap-6`). 8→24 is a 3×
  ratio, which is what makes the two registers read as distinct rather than as
  drift. Tuned tighter than the 32/40 the literature suggests because this app is
  deliberately dense; the ratio is what matters, not the absolute.
- **Exactly one `gap-8` (32px) per page.** On Dashboard it sits below
  `TodaysPlan` — the seam between *action* (above) and *state* (below). A second
  break means neither reads as the break.
- **One dominant element per screen, and only it may bleed.** It breaks the
  page's `px-4` inset; nothing else does. `HeroSlideshow` is Dashboard's — it
  holds the first slot but currently has no bleed handling, so it reads as one
  card among many.
- **Cards mark discrete, user-arranged objects.** Dashboard is a configurable
  widget grid (16 definitions in `src/lib/widgetDefinitions.js`), so a card per
  widget is *correct* — 31 of its 34 are widget shells and must stay. Read-only
  data that is **not** a widget gets no surface: hairline dividers instead. Never
  nest a card in a card (already removed once — see `Dashboard.jsx:1231`).
- **Elevation has two levels.** Resting = hairline border, no shadow. Raised =
  `shadow-md`, for interactive or genuinely floating surfaces. `shadow-sm` adds
  nothing a hairline doesn't; `shadow-xl`/`2xl` on a 390px viewport is a tell,
  not depth. **Coloured shadows are banned.**
- **`grid-cols-N` is for a fixed count. A collection uses `tileRow()`**
  (`src/lib/tileRows.js`), which wraps and centres. A grid packs a partial row
  into its LEADING columns — correct for a table, wrong for a collection: two
  capsule pulls sat against the left edge of the reveal panel with a dead third
  column beside them, and so did the last row of every count that wasn't a
  multiple of the column count. The same defect was live in the collection
  catalog (once per rarity tier, five of six tiers), five of the Bag's six
  grids and four of the marketplace's seven. **The test is whether the COUNT is
  decided by data**: a 5-tab bar, a 2-block rail and a 3-item daily drop stay
  grids, because they have no partial row to centre.
  Three things a contributor has to know before touching this:
  - **`tileRow()` returns `{ row, item }` and you need BOTH.** A row with no
    tile width collapses every tile to its content; a width with no row does
    nothing. Two files can share a row by passing the same spec (the listings
    feed does — `MarketplaceFeed` and `ListingCard`) rather than copying a
    string.
  - **Widths are literals and cannot be generated.** Tailwind's scanner reads
    source text, so a basis class built by interpolating a gap and a column
    count emits NO css and the tile silently falls back to content width. A new
    shape means adding an entry to `ITEMS`; `tileRows.test.js` re-derives every
    width from its own key so a wrong calc fails the suite.
  - **Grep for `col-span-*` before converting a grid.** It is a grid-only
    property that a flex container silently ignores. The marketplace's bundle
    row looks identical to the listings row but every `BundleCard` is
    `col-span-full`, so converting it would have collapsed each bundle to its
    content width with nothing raised anywhere.
- **Radius is `sm` / `lg` / `2xl` / `full`**, per the roles documented at
  `tailwind.config.js:48–71`. `xl` and `md` are compatibility aliases pinned to
  existing values — **never reach for them in new code**, and don't add a sixth.
- **Four hues, no exceptions.** A new state replaces an existing hue; it does not
  extend the list. Macros are the one case that needs mutual distinguishability
  rather than state meaning, so they use the semantically-neutral chart ramp:
  protein `--chart-1`, carbs `--chart-2`, fat `--chart-3`. Routing them through
  the state hues would render a healthy protein figure as `destructive`.
- **Hierarchy by weight and colour before size.** Six type steps, 11px floor. If
  something needs to recede, change weight — do not invent a seventh size.
- **No gradient as decoration, no glassmorphism.** `bg-gradient-to-*` and
  `backdrop-blur` are both on the published list of signals designers use to
  identify generated UI. Neither is how you make something look designed.
- **`mix-blend-mode` does not survive the trip to iOS Safari** (2026-08-08).
  The dashboard hero carried a dither-grain layer — a stitched `feTurbulence`
  tile at 0.11 opacity under `mix-blend-mode: overlay`, with `isolation:
  isolate` on the band to confine the blend. In desktop Chrome it measured
  exactly as designed (sd 1.80 against the real band colour, mean shift
  −0.33). On an iPhone it rendered as a **warm box with a hard horizontal
  edge** at ~60% of the band height — the knee of the layer's own mask.
  Removing the layer fixed it. Blend modes plus a stacking context are a
  known divergence; treat anything relying on them as unverifiable until it
  has been seen on a phone.
  The wider lesson, which cost several rounds: **that grain existed to fix
  8-bit banding on a 6-bit + FRC desktop MONITOR.** This app ships to iOS and
  Android only. A fix aimed at a device no user has is worth nothing, and
  here it was worth less than nothing. Check which device a rendering
  complaint came from before building for it.
- **Absolute positioning does not create clearance.** The hero's watermark
  icon is `absolute`, so it occupies no space and text flows underneath it
  however small it gets — shrinking only moves the width at which a long
  title collides again. Reserve the column instead (`pe-20` against a 72px
  icon). And measure overlap with `Range.getClientRects()` over TEXT NODES,
  not element rects: a block `<h2>` spans the full column even when the word
  inside it is "Stories", which reported all 9 slides colliding when only one
  actually did.
- **`Reorder.Item` enables `layout` by default, and that is wrong for a list
  whose MEMBERSHIP changes** (2026-08-08). Reorder's projection assumes a
  stable list where only the ORDER moves — the drag case. Dashboard's rows are
  not that: sections render null until their query resolves, so
  `dashboardRows` is rebuilt several times in the first second after mount.
  Project across two different lists and a row can be left holding a delta it
  never resolves — it keeps its flow box while painting somewhere else, so a
  gap opens where it belongs and it lands on top of the rows below. That is
  the bug where Discover drew an empty band and then painted its card on top
  of the daily quote and the install banner. Fix is `layout={editMode}`:
  nothing reorders outside edit mode, and `dragListener` was already gated the
  same way. **A nested `layout` child is the obvious suspect and usually is
  not it** — `DiscoveryCards.jsx` has one and measured identically with and
  without. Measure the *row*, not the card: read the computed transform on
  each element and compare painted rect against flow position. A stuck
  translate is unambiguous where a screenshot only shows you the collision.
- **Data must be earned.** A number gets screen space only with trend, history or
  comparison attached. A bare figure in a box is decoration.

## Fitting every phone — the fluid scale (`--fluid-*`)

**Vertical sizing is fluid, not fixed. Use `--fluid-*` from `:root` (defined in
`src/index.css`) rather than adding a px value beside one.**

The app is one column on a screen we don't control, from a 375×667 iPhone SE to
a 430×932 Pro Max — a 40% swing in the axis that runs out. Fixed pixels cannot
serve both ends: a 30px heading and 24px gaps cost the *same* on both, so the
onboarding goal step overflowed the SE by **131px** — hiding two of six cards
and slicing a third under the CTA — while the Pro Max had **193px** going
spare. Tuning that per device is a breakpoint treadmill; clamping against
viewport height is one rule that fits all of them.

| Variable | Range | For |
|---|---|---|
| `--fluid-pad-y` | 16→24 | shell padding |
| `--fluid-header-gap` | 16→28 | under a page header |
| `--fluid-heading` | 24→30 | page heading |
| `--fluid-section` | 12→24 | between groups |
| `--fluid-stack` | 6→8 | within a group |
| `--fluid-card-y` | 10→12 | card padding |
| `--fluid-card-title` / `--fluid-card-sub` | 14→15 / 11→12 | card text |
| `--fluid-tile` | 32→40 | icon tile |
| `--fluid-cta-h` / `--fluid-cta-gap` | 48→56 / 8→16 | pinned CTA |
| `--fluid-heading-sentence` | 24→30 | a heading that is a **sentence** |

**One of these clamps against width, and it has to.** Every heading on a form
step is a question of three to five words, so its line count doesn't move and
sizing it by height is right. The reveal step's heading is a full sentence, and
how many lines a sentence takes is a function of the column it wraps in — width.
Sized by height it got the axis wrong and showed it: at `3.4vh` the 393×852
iPhone 15 rendered 29px in a 345px column and took **four** lines, while the
*wider* 430px Pro Max took three at 30px. The middle phone wrapped worst, which
viewport height cannot explain. `--fluid-heading-sentence` is
`clamp(24px, calc(7.75vw - 3.7px), 30px)` — the ratio from sweeping 22→30px
against each device's real content width. Reach for it when a heading is prose;
keep `--fluid-heading` for the questions.

Minimums are the floor below which a surface stops being *comfortable*, not the
smallest thing that technically fits. Maximums are what the design was drawn at,
so nothing at iPhone-15 size or above changes. Text floors at 11px — the
app-wide minimum, and going under it is one of the loudest generated-UI tells.

Result on the goal step, all six selected: SE went from 131px over to a **24px
gap**, iPhone 15 and Pro Max unchanged.

**`.safe-page`** is the companion shell class — safe-area insets plus that
padding. Any full-screen surface that positions its own edges instead of
sitting inside `Layout.jsx` needs it. Layout has had insets since launch;
anything escaping Layout does not, which is how onboarding shipped with its
Continue button partly under the home indicator on **every notched iPhone, on
all eleven steps**, for months. If you build a page, sheet or full-height menu
outside Layout, start from `.safe-page`.

**Two things this does not do.** The scale is vertical only — horizontal
crowding is a wrapping problem, not a scaling one. And only onboarding is
converted so far; the rest of the app still uses fixed values and is fine
because it scrolls inside Layout rather than pinning a CTA to the viewport
bottom. Convert a surface when it has to *end* at a fixed point.

**Verify at 667 as well as 932.** A layout that fits a Pro Max tells you
nothing. Render the surface in an iframe at each device height (an iframe, not
a div — `vh` inside a div resolves against the window and quietly reports the
wrong answer), and measure the last child's bottom against the scroll box.
`scrollHeight` cannot do this: it clamps to `clientHeight`, so it reads "0px
spare" for both a screen that is exactly full and one that is half empty.

**Kill the iframe's scrollbar before you measure width.** Desktop Chrome
reserves a ~17px classic scrollbar inside an iframe that iOS and Android do
not, so the column you measure is 17px narrower than the phone's. That is
enough to change where text wraps: it made the reveal heading read as four
lines on a Pro Max that actually renders three, and every slack number taken
that way is pessimistic. Inject
`*{scrollbar-width:none}*::-webkit-scrollbar{display:none;width:0}` into the
frame — it keeps `vh` honest while restoring the true width.

**Before treating a grep hit as debt, read the comments.** Auditing this codebase
produced five findings; four shrank or inverted on inspection. `text-[5px]` and
`rounded-card` were prose inside comments; "6 and 11 distinct radii" was counting
class names when `lg` and `xl` resolve to the same value; "34 cards, cut to 20"
would have broken the widget grid. The reasoning in this repo lives in comments
that greps don't read — so a raw count is a question, not a conclusion.

## AI Coach personalization

Everything that shapes a generated session lives in one pure module,
[trainingModifiers.js](src/lib/aiCoach/trainingModifiers.js). It takes
context and returns four bounded numbers plus the notes explaining them;
`generateWorkout` applies them. No I/O, no React — callers fetch the
context and pass it in.

```
buildTrainingModifiers({ goal, nutritionGoal, weeklyRateLbs, restrictions,
                         age, cycleState, feel })
  → { loadMultiplier, setsDelta, repDelta, restDeltaSec, notes[], applied }
```

`generateWorkout` takes three separate context inputs — `modifiers`,
`demographics` ({ gender, age, activityLevel }) and `excludeMuscleGroups`.
**All three default to inert**, so a caller that passes none gets the exact
workout the generator produced before any of this existed.

**Rules for anything added here:**

- **Clamp it.** Every output is bounded: load `0.8–1.1`, sets `±1`, reps
  `-4…+6`, rest `-30…+60s`. Stacked signals must never compound into a
  prescription nobody asked for. When you add an input, check the clamp
  still leaves room — a +30s age bonus on a +30s strength goal hit the old
  45s ceiling and silently collapsed two age bands into one value.
- **Explain it on the card.** Every adjustment pushes a `notes` string, and
  `CoachPlanCard` renders them. An automatic change to someone's training
  that isn't explained reads as a bug — a user who suddenly gets a lighter
  day must be able to see it was the deficit, the phase, or their check-in.
- **Verify with real numbers, not just tests.** Twice now, green tests hid
  a defect that printing the actual output across a range exposed
  immediately (the rest clamp; the goal-priority ordering).
- **Context flows IN.** These modules must not import `@/api/db` — see the
  Profile cache section. `planBuilder`'s test mocks `@/api/db` with only
  `entities.WorkoutLog`, so a `db.auth.me()` call there breaks it.
- **Both surfaces or neither.** Quick pick
  ([WorkoutQuickGenerator.jsx](src/components/coach/WorkoutQuickGenerator.jsx))
  and the chat path (`CoachChat` → `askCoach(user, msg, ctx)` →
  `buildCoachPlan`) must get the same context, or the two disagree about
  the same lift. Both were silently running on `{}` at different points.

**Cycle phase is deliberately weak.** A 2023 Frontiers systematic review
found no reliable effect of cycle phase on strength performance or on
adaptation; ACSM's guidance is to adapt to symptoms, not the calendar. So
phase moves load by **at most 5%**, never blocks a session, and is fully
overridden the moment the user answers the "how do you feel today?"
check-in — a reported symptom beats a predicted phase. Do not strengthen
this without new evidence. The one un-hedged phase note is ovulation
(ligament laxity → ACL risk), which surfaces as a warm-up cue, not a load
change. Cycle context is read **only** when `cycle_tracking_enabled` is on.

**Multi-goal profiles blend, they don't collapse.** Onboarding lets people
tick several goals and a profile carrying all six is normal.
`normalizeGoals()` returns every match and the rules are **averaged** —
summing would let strength+endurance cancel by luck and strength+speed
compound. `normalizeGoal()` (singular) still returns the dominant one for
callers that want a label. `mobility` contributes a note and no numbers, so
its note is re-added after the blend or averaging erases its only
contribution.

**Diet cuts volume, not load.** Intensity is what protects strength in a
deficit, so `lose` removes a set and leaves the bar heavy; `gain` adds one.

**Fuel notes are allergen-filtered.** `fuelNote()` checks the user's
`DIETARY_RESTRICTIONS` + `ALLERGENS` (via `loadRestrictions`) and never
names a food they can't eat. If a stacked combination rules out every named
option it falls back to unnamed macros rather than guessing. Never add a
food suggestion anywhere in the Coach without routing it through this.

**Starting weights use demographics.** `_demographicScale()` in
workoutGenerator scales the bodyweight multipliers by sex (upper and lower
body separately — the gap is far smaller in the legs), age and activity.
Unset or `other` sex takes a conservative middle value rather than
defaulting to male: over-prescribing a first working set is the direction
that hurts someone. Only applies when there's no history for that lift.

**Injuries must be passed.** `getExcludedMuscleGroups()` in
[injuries.js](src/lib/data/injuries.js) handles synergists (a serious
shoulder injury also drops chest and triceps). It and `excludeMuscleGroups`
both existed for months with zero callers connecting them, so an injured
user was still handed Overhead Press. Any new surface that generates a
workout has to resolve active injuries and pass them.

## Celebration system

There are **seven** helpers — five "first-X" milestones, one goal
completion, one PR, one crew win. Each fires confetti + haptic + toast +
Sentry breadcrumb, but uses a **distinct vocabulary** so a user feels each
as its own moment:

| Helper | Trigger | Haptic | Confetti shape | Emoji | Palette |
|---|---|---|---|---|---|
| `fireGoalCelebration` | Goal completed | `[15,50,15]` | 2 side bursts y:0.55 | 🏆 | Green/yellow |
| `fireFirstWorkoutCelebration` | First workout logged | `[20,60,20,60,80]` | Center + 2 sides y:0.55-0.6 | 🎉 | Orange/green |
| `fireFirstRegimenCelebration` | First regimen saved | `[15,45,15,45]` | 2 side bursts y:0.6 | 💪 | Purple/pink |
| `fireFirstGoalCelebration` | First goal created | `[10,30,80]` | 1 top burst y:0.3 | 🎯 | Blue/teal |
| `fireFirstMealCelebration` | First meal logged | `[12,30,12,30,12]` | 2 bottom corners y:0.85 | 🥗 | Warm food |
| `firePRCelebration` | Personal record | `[40,80,40,80,40,80]` | — | 🏋️ | Gold/crimson |
| `fireCrewWinCelebration` | Crew war won | `[20,50,20,50,20,50,80]` | — | ⚔️ | Crew colours |

Audited 2026-08-05: **seven for seven distinct vibration patterns**, no two
colliding. This table said five for a while — `firePRCelebration` and
`fireCrewWinCelebration` both postdated it — so re-read
`src/lib/*Celebration.js` rather than this table if the count matters.

All live in `src/lib/*Celebration.js`. Each is well-tested in
`src/lib/__tests__/*Celebration.test.js`. **Don't add another celebration
without giving it a distinct haptic + confetti signature.**

## Push notifications

**The pipeline IS deployed.** (This section previously said it wasn't —
that was stale; audited 2026-07-30, see the status block below.) The full
chain:

| Migration / file | Role |
|---|---|
| `033_push_subscriptions.sql` | Table + `upsert_push_subscription` RPC. Client opt-in lives in `src/lib/usePushSubscription.js`. |
| `034_notification_push_trigger.sql` | AFTER INSERT trigger on `notifications` → `pg_net.http_post` to the Edge Function. Trigger is a no-op when `app.send_push_url` / `app.send_push_secret` are unset, so the in-app row still lands. |
| `035_streak_break_reminders.sql` | Hourly cron, 15-language text helpers, pushes when a ≥2-day streak is about to break in user's local 18-21h. |
| `036_notification_prefs_and_language.sql` | Per-category opt-in JSONB on `user_profiles`. The 034 trigger reads it; muted categories skip push fanout (in-app row still inserts). |
| `037_welcome_back_and_quest_crons.sql` | Two more crons — welcome-back (3-30 day churned, hourly) and quest-expiry (incomplete dailies, every 15min). |
| `038_push_secrets_via_vault.sql` | Stores `app.send_push_secret` in the Vault rather than the postgres role. |
| `supabase/functions/send-push/index.ts` | Edge Function — VAPID delivery, 410-Gone cleanup, dual auth (Bearer JWT or X-Send-Push-Secret). |

**Deployment status — audited 2026-07-30, delivery fixed 2026-07-31.**
Every step of the old "still missing" checklist is done, and the pipeline
now delivers. The one remaining gap is that nothing is subscribed:

| Step | State | Evidence |
|---|---|---|
| VAPID keys generated | ✅ | 87-char P-256 public key baked into the production bundle |
| `VITE_VAPID_PUBLIC_KEY` in client build env | ✅ | listed in the Netlify resolved config; key present in the served JS |
| `send-push` Edge Function deployed | ✅ | ACTIVE, version 17 |
| `send_push_url` / `send_push_secret` in Vault | ✅ | both rows exist, created 2026-05-21 |
| `pg_net`, fanout fn, trigger, `push_subscriptions` | ✅ | all present; 2 push-related crons. Only the STATEMENT-level `trg_notifications_push_fanout_batch` is attached — `notify_push_fanout` (row-level) exists unattached, so fix both when changing either |
| **Actually delivering** | ✅ | fixed by mig 274; verified `200 {"ok":true,…}` on 2026-07-31 |
| Anyone subscribed to deliver TO | ❌ | 0 rows — see the end of this section |

**The subscribe side was broken too — fixed 2026-07-31.** Separate from the
delivery bug below, almost nobody could subscribe in the first place. Web
push needs a service worker registration, and the app wasn't registering
one at all: the dynamic `import('virtual:pwa-register')` in
`AppUpdatePrompt.jsx` carried a `/* @vite-ignore */`, so Vite never bundled
the virtual module and the runtime import rejected into a `.catch(() =>
null)`. `usePushSubscription` awaits `navigator.serviceWorker.ready`, which
never resolves without a registration, so opt-in hung silently — no error,
no toast, nothing in Sentry. That is the likely explanation for
`push_subscriptions` holding exactly one row. Verified fixed on the live
authenticated page (`ready` resolves, `/push-sw.js` controls the page).
**This does not explain the 404 below** — that is a separate, still-open
problem on the delivery side.

**RESOLVED 2026-07-31 (mig 274). Delivery is verified working.** A
self-targeted notification produced `200` with
`{"ok":true,"sent":0,"removed":1,"batch":1}` — trigger → Vault → pg_net →
Edge Function, authenticated. A 200 rather than 401 also rules out the
`send_push_secret` / `SEND_PUSH_TRIGGER_SECRET` mismatch that used to be
undiagnosable from outside.

**This section previously documented a wrong diagnosis. Both halves of it
were false, and the retraction is worth keeping**, because the reasoning
that produced it looks sound:

- *"The fanout's one recorded HTTP call 404s, so `send_push_url` is
  wrong."* The 404 was **not push**. `net._http_response` held one row,
  404 at 2026-07-26 20:00:00, body `{"code":"NOT_FOUND","message":
  "Requested function was not found"}`. Cron job 5 runs `0 20 * * 0` —
  Sundays at 20:00 — posting to `/functions/v1/generateWeeklyDebriefs`,
  2026-07-26 was a Sunday, and that function has never been deployed. It
  is the Weekly Debriefs follow-up, firing weekly at a dead endpoint. The
  old note ruled this out by arguing "every `net.http_post` caller in the
  applied migrations is push-related" — **job 5 is a raw cron command, not
  a migration function body**, so a grep over migrations could never see
  it. Check `cron.job` as well as `pg_proc` before attributing an HTTP
  call to a feature.
- *"The Vault URL doesn't resolve."* It was correct all along —
  `https://<ref>.functions.supabase.co/send-push`, the form that returns
  401 — and it was **never read**, so `vault.update_secret()` would have
  fixed nothing. (`vault.decrypted_secrets` IS readable as `postgres` via
  MCP, contrary to the old note; that one query would have settled it.)

**The actual defect was a silent revert.** Mig 080 taught the fanout to
read `vault.decrypted_secrets`; migs 098 and 127 later redefined the same
function from the pre-080 template and put
`current_setting('app.send_push_url', true)` back. Managed Supabase blocks
`ALTER DATABASE … SET` — the whole reason mig 038 moved these into the
Vault — so both GUCs read NULL, the function hit its secrets-missing guard,
and returned before dispatching. Push had **never sent a single request**.

Two lessons, both cheap:

- **Read the INSTALLED function body, not the migration that created it.**
  `pg_get_functiondef()` is the source of truth. A later migration
  redefining a function from a stale template is invisible in the file
  that "owns" the feature, and this had been live since mig 098.
- **The guard is deliberately silent** (mig 034) so partial deploys don't
  break notification inserts. In-app rows keep landing and nothing raises.
  `net._http_response` is the only place it shows — and an *empty* table
  there means "never dispatched", which reads identically to "never
  triggered".

Remaining, and NOT a push bug: `push_subscriptions` is currently **0**. The
one subscription (2026-05-25) was 410 Gone and the Edge Function cleaned it
up on that first successful call, which is correct behaviour. Nobody could
create a replacement while the service worker was failing to register (see
the section above), so re-opt-in from Settings is what proves end-to-end
delivery to a device. Expect `sent: 1, removed: 0`.

**Patterns for adding new push types:**

- Self-targeted (notifying yourself, e.g. quest reset) → call
  `notifications.create({ userId, type, title, body, ... })` from the
  client. RLS lets you insert your own row; the trigger handles fanout.
- Cross-user (notifying someone else, e.g. friend follow, league win,
  duel result) → write a `notify_X_for(p_user_id, …)` SECURITY DEFINER
  RPC in a new migration following the pattern in
  `041_friend_notifications_i18n.sql`. Server-side text helpers go in
  the same migration with branches for all 15 languages, mirroring
  `streak_break_text`. The RPC inserts into `notifications`, the
  trigger does the rest.
- Cron-driven (time-window pushes like welcome-back) → mirror the
  atomic `UPDATE…RETURNING last_X_nudge_at` claim pattern in
  `037_welcome_back_and_quest_crons.sql` so concurrent cron firings
  can't double-send.

## Storage — the `uploads` bucket

Every user upload goes through `_uploadFile` in `src/api/db.js`, which
defaults to the public `uploads` bucket and writes
`<auth.uid()>/<timestamp>.<ext>`. That prefix is what every RLS policy on
the bucket keys off, so don't change the path shape casually.

- **The bucket's `allowed_mime_types` must agree with `SAFE_MIMES` +
  `VIDEO_MIMES` in db.js.** They didn't until mig 272, and the result was
  that Hub video posts and story videos had **never once succeeded** since
  the project was created — Storage rejected them before writing, and the
  UI showed a generic "couldn't post". When you teach `_uploadFile` a new
  type, add it to the bucket in the same change or it will fail in exactly
  this silent way.
- **50 MB is a hard ceiling on the Free plan.** Supabase enforces a global
  file-size limit above every bucket which cannot exceed 50 MB on Free, so
  a per-bucket limit above that is fiction. `VIDEO_MAX_BYTES` and the
  user-facing copy say 50 MB for that reason. Moving to Pro means raising
  the global limit, the bucket, the constant, and the copy together.
- **Pin `contentType` from the extension for videos too.** It read
  `SAFE_MIMES[ext]`, and `ext` is `''` on the video branch (it lives in
  `videoExt`), so it was `undefined` and supabase-js fell back to the
  client-supplied `file.type` — the exact thing the comment there says we
  don't trust.
- **`remove()` needs a SELECT policy** (mig 273). Storage resolves a
  delete's targets with a SELECT first. Mig 185 dropped the bucket's only
  SELECT policy to stop enumeration, which silently broke deletion: the API
  returns **200 with an empty array** and removes nothing. Every
  failed-after-upload cleanup was orphaning its blob. Mig 273 restores a
  SELECT scoped to the caller's own uid prefix — enumeration stays closed.
  If you ever add a bucket policy, check `remove()` still deletes rather
  than assuming a 200 means success.
- **`storage.protect_delete()` blocks direct `DELETE FROM storage.objects`**
  with `42501`. It only checks a session setting, so `BEGIN; SET LOCAL
  storage.allow_delete_query = 'true'; DELETE …; COMMIT;` works. Use it only
  when the owning user no longer exists — it removes the metadata row and
  can orphan the blob. Prefer the Storage API.

## Service worker / PWA

- **Never put `/* @vite-ignore */` on the `virtual:pwa-register` import.**
  It tells Vite not to resolve the specifier, so the module is never
  bundled and the runtime import rejects on a bare string. It sat on that
  import from 2026-05-23 until 2026-07-31 and disabled the service worker
  entirely: no precache, no offline shell, no update prompt, and push
  opt-in hanging forever on `navigator.serviceWorker.ready`. There is a
  comment at the call site; leave it there.
- **`AppUpdatePrompt` is the only thing that registers the worker**, and it
  sits below five early returns in `App.jsx` (loading, `user_not_registered`,
  `auth_required`, incomplete onboarding, stashed token). So nothing global
  in that render — service worker, install prompt — mounts while signed
  out. Measuring any of it on the marketing or onboarding screens shows it
  missing whether or not it works.
- **An installed PWA can be months behind `main`.** A device was found
  running a ten-week-old build while every server-side check said the
  backend was healthy — and the feature under test didn't exist in that
  build. `buildInfo.js` exists for this: Settings → footer → tap the build
  label copies hash + date + UA, and the live hash is readable straight out
  of the served bundle. **Ask for the device build hash before theorising**
  whenever a device report and the database disagree.

## Equipment picker (migrations 268–273, July 2026)

Lifters can record the SPECIFIC implement they're using — their gym's
Hammer Strength row rather than "a row", or their own Bowflex 552s.
Docs: `docs/gym-equipment-picker-research.md` (evidence) and
`docs/gym-equipment-picker-prompt.md` (phase-by-phase build log).

Conventions a contributor must not undo:

- **Never ship manufacturer product photography or brand logos.** Brand
  and model names as TEXT are nominative use and fine; their imagery is
  not ours. Images come from users, falling back to drawn silhouettes.
  `ATTRIBUTIONS.md` has the full rule and `REFERENCE_IMAGES` in
  `src/lib/equipmentImage.js` is the (empty, licence-gated) slot for
  openly-licensed generics.
- **Controlled vocabularies live in one module and are additive-only.**
  `src/lib/equipmentCatalog.js` holds `BRAND_META`,
  `IMPLEMENT_TYPE_META` and `SEED_MODELS`, in the same slug→metadata
  shape as `src/lib/gymAmenities.js`. Adding entries is always safe;
  RENAMING a slug is a data migration, because slugs are persisted in
  `workout_logs.exercises` and `space_equipment`.
- **`classifyEquipment` (exerciseEquipment.js) is NOT the gate for the
  picker.** It's a coarse 9-way regex built for a filter pill where a
  miss is invisible, and it's wrong on ~25 of the exercises that matter
  most here — every Lat Pulldown variant falls to 'other', Machine and
  Cable Crunch fall to 'bodyweight', Barbell Hack Squat falls to
  'machine'. `implementTypeForExercise` overrides by name and falls back
  to it. Don't "fix" the classifier; its existing consumer and tests
  depend on current behavior.
- **Only add a `ladder` to a seed model when the exact settings are
  verified against the manufacturer's own spec.** `snapToSelectable`
  uses it to keep progressive-overload suggestions on weights the gear
  can actually be set to; a guessed ladder produces confidently wrong
  advice. Absent = no snapping, which is the safe default.
- **A gym's floor is the union of every member's `training_spaces` row
  for that gym**, not one canonical space. That's forced by the schema:
  `UNIQUE (owner_id, gym_id)` plus an INSERT policy requiring
  `owner_id = auth.uid()` means a member cannot create a space the gym
  owns. Trust tiers fall out of it — owner's space is authoritative,
  `verified_by_owner` is a blessed member find, the rest is
  member-submitted.
- **`equipment_models` has no client UPDATE or DELETE policy on
  purpose.** An UPDATE scoped to `submitted_by` would let a user flip
  their own `approved` flag and publish into the global catalog.
  Approval is service_role only.
- **One home space per owner** (mig 271). `getOrCreateHomeSpace` is
  read-then-insert, and `UNIQUE (owner_id, gym_id)` never constrained it
  because `gym_id` is NULL for home spaces and NULLs are distinct. The
  partial unique index closes it — but the index alone would have made
  things worse, because the losing racer's INSERT now returns 23505 and
  the old code reported it and returned null, turning a harmless
  duplicate into a silently dropped photo. Both `getOrCreateHomeSpace`
  and `getOrCreateGymSpace` re-read the winner on 23505. If you add
  another get-or-create here, it needs the same branch.
- **`equipment_models` is empty in production and that is correct.** The
  50 "seed models" are `SEED_MODELS` in `equipmentCatalog.js`, a
  client-side vocabulary; no migration inserts a row. The table fills
  only from user submissions, as a dedupe target. Don't read
  `count(*) = 0` as missing seed data.
- **A `kind='gym'` training_space requires gym membership** (mig 270).
  Mig 268 checked only `owner_id = auth.uid()`, which let any signed-in
  user attach a space to any gym and inject entries onto its floor —
  `listGymFloor` unions every space with that gym_id, so it rendered to
  all members. Verified as a real exploit against production before
  patching. When adding a policy here, test it by executing the attack
  under `SET LOCAL role authenticated` + JWT claims; MCP/SQL-editor
  queries run as `postgres` and bypass RLS entirely.

## Scheduled workouts (migration 276, Aug 2026)

"Schedule it" on the AI Coach plan card. Saving to Regimens produces an
artefact the user has to remember to return to; implementation-intention
research (Gollwitzer) is clear that naming *when* roughly doubles
follow-through, so a session can now be pinned to a day and an hour and
`scheduled_workouts` + an hourly cron turns that into an actual trigger.

- **Local date + local hour, never a timestamptz.** "Thursday at 7am"
  means 7am wherever the user wakes up. An absolute instant would shift
  the reminder for anyone who travels and would need rewriting on every
  timezone change. `scheduled_date` / `scheduled_hour` are resolved
  against `user_profiles.timezone_offset_minutes` at fire time, the same
  way migration 035 does streak reminders.
- **`public.user_local_now(uuid)` exists so the cron's WHERE clause stays
  paste-safe** — one function call instead of a join, which keeps every
  statement single-table with bare column names per the clipboard rule in
  the Workflow section. Don't "simplify" it back into a join.
- **The whole session is stored in `workout` JSONB**, not a regimen id.
  What fires is what the user committed to, even if the generator's
  catalog or their history has moved on. It's also what
  `/workout?scheduled=<id>` loads, so the reminder lands you *in* the
  session rather than on the Workout page to go find it.
- **Anything more than 12h past its slot is marked `missed`, not
  notified.** If the cron was down or an offset moved, a reminder for
  yesterday morning arriving tonight reads as the app being broken and
  can't be acted on.
- **There is no client INSERT policy.** Rows are created only through
  `schedule_workout()`, which derives `user_id` and `user_email` from
  `auth.uid()`. An INSERT policy would let someone attach a schedule to
  another user, and `user_email` is what the push fan-out delivers to.
- **A new function is EXECUTE-able by PUBLIC until you revoke it, and
  every public-schema function is a PostgREST endpoint.** `REVOKE` on
  `fire_scheduled_workout_reminders` is load-bearing: without it any
  caller, including `anon`, could POST to
  `/rest/v1/rpc/fire_scheduled_workout_reminders` and fire every user's
  due reminders early or sweep pending rows into `missed`, running
  SECURITY DEFINER while doing it. The cron is unaffected — pg_cron runs
  the job as its owner. Caught by the security advisor, not by testing
  the feature, which worked perfectly throughout. **Run `get_advisors`
  after adding any SECURITY DEFINER function**; 17 functions in this
  project currently carry the same lint and most are benign helpers, so
  the signal to look for is a function with side effects.
- **`workout_reminder` is deliberately absent from
  `notification_type_category`.** Unmapped types always deliver (mig 083),
  which is right here: the user asked for THIS reminder at THIS hour, so
  muting the broad "engagement" category — which exists for nudges *we*
  initiate — must not silence it. Quiet hours (mig 098) still apply.

## Home gym / "My Gym" (migration 275, Aug 2026)

Beta testers wanted to declare the gym they actually train at, see it on
the locator map, and race the people who train there. `gym_members` was
already the "belongs to N gyms" junction; `user_profiles.home_gym_id` is
the ONE that is theirs.

- **The map now has three tiers, and shape carries the meaning.** Purple
  bubble = verified business (`source='owner'`). Grey bubble =
  `source='community'`, a real gym with real members and a real
  leaderboard that nobody has claimed. Grey teardrop = a live
  OpenStreetMap result nobody has picked yet, fetched from Overpass and
  never persisted. Grey is shared between the last two on purpose (both
  mean "unclaimed"); the bubble-vs-teardrop distinction is what says
  "has a community".
- **Picking an OSM gym PROMOTES it.** Almost no real gym has registered
  a business account, so `set_home_gym_from_osm` creates a persistent
  `source='community'` row from the OSM feature. Everyone who later
  picks that gym must land on the SAME row or one gym floor gets two
  leaderboards — that's enforced by the partial unique index
  `gym_businesses_osm_uniq (osm_type, osm_id) WHERE osm_id IS NOT NULL`,
  not by client discipline.
- **`ON CONFLICT` against a PARTIAL index must repeat the predicate.**
  `ON CONFLICT (osm_type, osm_id) DO NOTHING` raises `42P10` — Postgres
  only matches a partial index when the clause carries its `WHERE`. This
  shipped broken through a migration-executes-cleanly check and was only
  caught by calling the RPC as a real authenticated user. **Verifying
  that a migration runs is not verifying that its functions work.**
- **Key on `(osm_type, osm_id)`, never `osm_id` alone.** OSM ids are
  unique only within a type, so `node/123` and `way/123` are different
  places. The client carries `osmType` through `fetchOsmGyms` for this
  reason; dropping it merges two unrelated gyms into one row.
- **Overpass lookup lives in `src/lib/osmGyms.js`, not `GymMap.jsx`.**
  GymMap statically imports maplibre-gl, so importing anything from it
  drags the whole map engine into the onboarding chunk — vite.config
  keeps maplibre out of `vendor-misc` precisely so it stays lazy. The
  onboarding picker and the map share this module instead.
- **A search radius is in KILOMETRES, never in degrees** (fixed
  2026-08-06). `fetchOsmGymsNear` took a single `radiusDeg` and applied it
  to latitude and longitude alike, but a degree of longitude shrinks by
  cos(latitude): the 0.05° default reached 5.56 km north-south and only
  4.83 km (Houston) / 4.22 km (New York) / 3.75 km (Seattle) east-west.
  So anywhere north of ~30° the advertised radius was under three miles in
  the axis that mattered, and a gym three miles down the road was not
  ranked low — it was never fetched. Verified against live Overpass: a
  point 2.79 mi east of a Chicago Planet Fitness missed it under the old
  geometry (2.57 mi reach) and finds it under `bboxAround()`.
- **The lookup is a cheap query plus a free classifier, and that split is
  load-bearing.** Overpass only uses its index for exact `key=value`
  matches; a case-insensitive regex or a negative match like
  `["sport"!~"tennis"]` degrades to a bbox scan. Measured over a 27 km box:
  the exact-match query answered in 27s, the same query with one `!~`
  clause 504'd three times at 58s / 57s / 82s. So `GYM_SELECTORS`
  over-fetches on exact matches only, and `isGymLike()` decides what a gym
  is from tags already in hand. **Put new rules in the classifier, not the
  query.**
- **Query `nwr`, not `node` + `way`.** Relations were never asked for, so
  a gym mapped as a multipolygon — normal for anything inside a larger
  building — was invisible.
- **The map's search box answers two questions and they have different
  costs.** Typing filters the pins in view (`src/lib/gymSearch.js` — free,
  instant, no network, and it must cover BOTH pin layers; it filtered only
  the registered `gym_businesses` rows for months, which on a typical
  viewport is a handful out of dozens). Submitting geocodes a place
  (`src/lib/geocode.js` → Nominatim). **Never fire the geocoder on a
  keystroke** — Nominatim's usage policy forbids client-side autocomplete
  against it, and a debounce is still autocomplete. It is a donated
  service that blocks by IP, so the failure mode is the feature dying for
  everyone at once. The 1 req/s gate and the result cache in that file are
  load-bearing, and so is `PLACES_ATTRIBUTION` under the results — the
  map's own attribution control covers the tiles, not this. See
  ATTRIBUTIONS.md.
- **Flying to a place must clear the query.** The same string is the pin
  filter, so leaving "chicago" in the box after flying to Chicago filters
  the gyms that just loaded down to the ones named "chicago" — you arrive
  at an empty map.
- **`leisure=sports_centre` is fetched unfiltered on purpose.** It used to
  be qualified with `["sport"~"fitness"]`, which was the single biggest
  source of misses: YMCAs, council rec centres, boxing gyms and climbing
  gyms carry no `sport` tag at all or one that isn't the string "fitness".
  Measured near downtown Houston, the old filter found 20 of the 30 named
  fitness places within three miles; the current one finds 27 and the
  three it drops are a tennis centre, a public pool and a basketball
  arena. The client-side per-mirror abort is 30s against a `[timeout:25]`
  header — it was 20s, i.e. the app hung up on queries the server was
  still legitimately working on.
- **`owner_id` stays NULL on a community gym.** Same reasoning as demo
  gyms below: nobody proved they own the place, so nobody gets owner
  controls. `created_by_user_id` records who promoted it and grants
  nothing — it exists so the 20-gym anti-spam cap has something to count.
  A real owner claims the gym later through the verification queue.
- **Onboarding holds the pick and applies it at final save.** The
  `home_gym` step writes nothing; `handleRevealNext` calls the RPC with
  the other side effects. Abandoning onboarding halfway therefore leaves
  no community gym and no membership behind for a user who never
  finished signing up.
- **Never read `user.home_gym_id` from AuthContext alone** — use
  `resolveHomeGymId()` (context → profile cache → one query). Onboarding
  attaches the gym AFTER its `checkUserAuth()`, and a pick made on
  another device never touches this tab's context, so the context value
  is legitimately stale in both cases. Reading only it renders "you
  haven't picked a gym yet" at someone who picked one a minute ago.
- **The board ranks by consistency, not volume** — `active days in the
  last 7`, reusing `get_gym_consistency_leaderboard` (mig 150/158).
  Ranking a local gym floor by weight moved sorts it by bodyweight and
  training age and tells a beginner they're last, which is exactly the
  person this feature needs to keep. Don't "improve" it to volume.
- **~~A success toast here MUST carry an `action`, or it renders nothing.~~**
  **No longer true — see the toast-policy section below.** Both save paths
  originally called a bare `toast.success(...)`, which under the old
  "errors only" policy produced no feedback whatsoever and looked
  identical to a dead button. That is most of why this feature took four
  rounds to land. They still pass an Undo action, which is the right
  affordance for a one-tap commit regardless of the policy.
- **A trigger that writes ANOTHER table runs as the invoking role, and
  RLS drops that write in silence** (mig 324). `gym_businesses.member_count`
  had drifted — 2 against 1 real row — because joining and leaving are not
  symmetric: joins go through `join_gym_by_code` / `set_home_gym_*`, all
  SECURITY DEFINER, so the counter trigger inherited the definer context and
  incremented; leaving is a direct client DELETE, so the trigger ran as
  `authenticated` and its `UPDATE public.gym_businesses` matched **zero**
  rows against the `owner_id = auth.uid()` policy. The DELETE succeeded, the
  count didn't move, nothing raised. On a community gym (`owner_id` NULL) the
  counter could never come down at all. Fixed by making the trigger SECURITY
  DEFINER **and** deriving the value with `count(*)` rather than `±1`, so
  drift from any cause heals on the next join. A `BEFORE UPDATE OF
  member_count` guard recomputes it too, because owners may update their own
  gym row and that number is on every public map pin.
  Two things to carry forward: **an incremented counter can only ever be as
  correct as every increment before it** — derive it if the table is small
  enough to afford it. And **test a trigger's side effect as the role that
  fires it**; as `postgres` this behaved perfectly for months.
- **`/my-gym` and `/my-gyms` are one page as of 2026-08-09.** They were
  two routes behind two profile-menu rows a single line apart, told apart
  only by the plural, and both reachable only from that menu. `MyGym.jsx`
  now holds both halves: the gym you train at (leaderboard, community
  progress) above a single 32px break, every OTHER gym you've joined
  below it with join-by-code, the map and the owner CTA. `/my-gyms`
  **redirects** and must keep doing so — the 8-character Flexyn Code
  printed on gym signage tells people to open it, and printed signage
  can't be recalled. The design is the Penpot page "My Gym — one page
  (merge of /my-gym + /my-gyms)"; board C is the element ledger.
  Two things that fall out of the merge: the joined list filters out the
  home gym (setting a home gym joins it, so without the filter everyone
  sees their gym twice), and the separate geolocated "Near you" rail is
  gone because it only appeared when you had joined no gyms — which now
  means the picker is on screen doing the same lookup.
- **Tapping a gym in the My Gym picker SAVES it — no confirm step.** It
  was select-then-press-a-button, and the selected row's ✓ read as
  "saved" when it only meant "highlighted", so a pick sat uncommitted
  while everything looked done. `deselectable={false}` is passed there
  precisely because, once a tap commits, tapping your current gym again
  must not mean "unset my home gym". Onboarding keeps the deferred
  two-step (it must not write before final save) and so keeps
  `deselectable` at its default.
- **Overpass is unreliable and its failure must never render as "no gyms
  found".** Audited 2026-08-01 from a browser Origin: `overpass-api.de`
  answers browser User-Agents with `406` and sends no CORS header, so it
  can never succeed from the app (it was listed FIRST, and because
  `Promise.any`'s AggregateError is call-ordered, every outage got
  reported as its 406); `kumi.systems` was timing out on every request;
  `private.coffee` managed 2/3. Mirrors are ordered by that measurement
  and `pickError()` prefers an error from a mirror that could have
  worked. The picker tracks the failure separately from an empty result —
  "there are no gyms near you" is a claim about the world we may only
  make when the lookup actually succeeded.
- **Community aggregates are members-only.** `get_gym_community_progress`
  gates on `is_gym_member_or_owner` because it reports how many people
  train at a named physical address and when. Verified against
  production that a non-member gets `42501`.

**`gym_businesses.owner_id` is nullable ON PURPOSE — this is not drift.**
Migration 137 explicitly ran `ALTER COLUMN owner_id DROP NOT NULL` so the
25 seeded `Demo:` gyms could exist without an `auth.users` row behind
them, and documents the cleanup (`DELETE FROM gym_businesses WHERE
owner_id IS NULL AND name LIKE 'Demo:%'`). Real gyms come from
`approve_gym_verification`, which always sets `owner_id` from the
verification queue. Don't "restore" the NOT NULL and don't backfill
owners onto demo rows — an owned demo gym is worse than an ownerless
one, because it grants a real user edit rights over fake data.

Consequence worth knowing: the equipment tab's owner controls (Confirm /
"Listed by the gym") never render on a demo gym, because a demo gym has
no owner to be. That's correct behavior, not a bug.

## Session journal — May 2026 batch

A single long session shipped migrations 080–099 plus ~17,000 lines of
new product code. Conventions/patterns introduced here that future
contributors should match:

- **Migration order matters and we DON'T renumber retroactively.** When
  numbering parallel commits, pick the next free `NNN` at branch start.
  If two branches independently claim the same number, the second-to-
  land renames its file. Files at the same NNN are tolerated when
  bodies are disjoint (e.g. `054_duels.sql` + `054_bio_profanity_check.sql`).
- **The push pipeline is live and gated by `app.send_push_url` /
  `app.send_push_secret` via Supabase Vault** (not `ALTER DATABASE` —
  managed Supabase blocks that). The `notify_push_fanout` trigger short-
  circuits when secrets are missing, so new RLS tables don't break
  push delivery during partial-deploy windows. As of mig 098 the trigger
  also short-circuits during the user's quiet hours.
- **Per-category notification preferences use SINGULAR keys** (streak,
  quests, league, social, achievements, engagement, competitive). The
  category mapping was unified in migration 083 after migration 065
  silently regressed it to plural names — see the migration head comment
  for the full story.
- **Three share cards follow the same Canvas 2D pattern** (no
  html2canvas dep): WorkoutShareCard (purple/fuchsia), WeeklyRecapShareCard
  (emerald/cyan), PRShareCard (gold/crimson). Color rotation gives each
  moment its own identity; the share API + download fallback chain is
  identical.
- **Seven celebration helpers each have a distinct vibration + confetti
  signature** (goal / first-workout / first-regimen / first-goal /
  first-meal / pr / crew-win). When adding an 8th, give it its own
  signature — see `src/lib/prCelebration.js` for the pattern.
  Multi-celebration events should route through `src/lib/rewardQueue.js`
  to avoid overlapping toasts; today `Workout.jsx` is the only surface
  where two can land on one action (a first workout that also sets a PR),
  and it uses the queue.
- **`tFallback('key', 'English fallback')`** is the standard i18n call.
  English fallbacks ship inline; native translators fill non-English
  locales via `src/lib/i18n-*.js` part files (the splitter aggregates).
  Don't ship machine-translated copy.
- **localStorage flags for per-device UX state** follow the
  `flexyn.<feature>.<userId>` namespace pattern. Examples:
  `flexyn.celebratedCrewWars.<userId>`, `flexyn.pendingReferralCode`,
  `flexyn.pushOptInDismissed.<userId>`, `flexyn.iosInstallDismissed.<userId>`,
  `flexyn.onboardingState.<userId>`.
- **Schema drift audit lives at `supabase/migrations/_audit_schema_drift.sql`**
  (leading underscore keeps it out of auto-runners). Paste it into the
  SQL Editor to surface column-type drift, missing FKs, missing
  service_role grants, and orphan rows. Migration 085's ALTER DEFAULT
  PRIVILEGES auto-grants service_role on new public tables, so new
  drift in that dimension shouldn't accumulate.
- **The single most-common defect class shipped this session** has
  been references to nonexistent columns / functions in new
  migrations and RPCs — caught and patched across 100 (timezone_offset
  vs timezone_offset_minutes), 101 (weekly_xp/volume/sessions on the
  wrong table, total_posts nonexistent, grant_flex_coins undefined),
  109 (followed_email vs followee_email on hub_follows — broke 100%
  of Block-button clicks). Before writing a new migration that
  references existing schema, **grep for the actual column / function
  name in the migrations directory** rather than typing what you
  expect it to be. Same rule for SECURITY DEFINER RPCs that pass
  user-supplied identifiers: gate on auth.uid() server-side, not
  on the client-supplied param (108 was a privacy leak from
  trusting client-passed email).

The biggest user-facing additions this session:

- Push fanout for nemesis, gauntlet, comments+replies, memories,
  referrals (mig 081–089)
- Streak rescue (mig 087) — one-tap save on a missed day, once/month
- Onboarding 7-day nudge sequence + iOS install banner + push opt-in
- Live activity rail + follow suggestions + crew suggestions + friend
  leaderboards on Hub
- Workout calendar grid + workout memory card + workout suggestion +
  PR celebration + repeat-from-log on Dashboard/Workout
- Hydration ring + mood log + sleep log + recovery score + readiness
  card (mig 094–097)
- Voice input (set logging + Coach dictation)
- Built-in program templates + workout templates + bar inventory
- User-created bounties + crew challenges + quiet hours + dedicated
  notification page + story emoji reactions + story highlights schema

## Things that are intentionally out of scope right now

- LocationStep.jsx was deleted; no country/state collection in
  onboarding until the team makes a product decision.
- The `is_active` regimen column is dormant — schema is there but
  nothing reads/writes it.
- Server-side profanity check is on `username` only; `bio` is still
  client-only.
- ~~Weekly Debriefs.~~ **Shipped 2026-08-09 as "Weekly Reviews" — no longer
  out of scope.** See the section of that name above. The feature is renamed
  everywhere the user can see it (the table and RPCs keep the `debrief`
  names, so no data migration); the vault is an index of week rows rather
  than a grid of tiles; and it now reports cardio, steps, fuel, sleep, mood,
  body weight, XP, level, quests, coins, trophies, crews, duels, leagues and
  gym check-ins instead of lifting alone. Migration 328 is the v2 RPC
  (`generate_my_weekly_review`, with `generate_my_weekly_debrief` left as a
  forwarder), 329 backfills `total_volume`, 330 fixes cardio duration.

  What remains out of scope is only the **cron**: the Edge Function
  `generateWeeklyDebriefs` is deployed but still inert, so reviews are
  generated on demand when the user opens the screen rather than pushed on a
  Sunday. Two things would make the cron run: set `DEBRIEF_CRON_SECRET` as a
  function secret, then re-add the cron (recipe below). Note the Edge
  Function still carries the v1 XP formula and reads `total_volume`, so it
  will disagree with the RPC until it is redeployed — **fix that before
  scheduling it**, or Sunday's generated row will overwrite a correct one
  with worse numbers.

  Function deploy state, verified 2026-07-31: `POST` with no auth returns
  `401 {"error":"unauthorized"}`, `GET` returns `405`, and the deployed
  source matched the repo file byte for byte (456 lines, identical SHA-256).
  `verify_jwt` is deliberately false because the cron
  authenticates with `X-Cron-Secret`, which a gateway JWT check would
  reject before the function's own auth gate runs — same posture as
  `send-push`. `SEND_PUSH_TRIGGER_SECRET` and `ANTHROPIC_API_KEY` are
  optional: without them it skips the push fan-out and falls back to the
  rule-based insight.

  **The cron was unscheduled on 2026-07-31.** `cron.job` id 5
  (`weekly-debrief-generator`, `0 20 * * 0`) posted to
  `/functions/v1/generateWeeklyDebriefs`, which has never been deployed,
  so it 404'd every Sunday at 20:00 for ten weeks. It never showed as a
  failed job — `net.http_post` only queues, so the run always records
  `succeeded` — and it was the only row in `net._http_response` most
  weeks, which is exactly how it got misread as a push-delivery failure
  (see the Push notifications section).

  **When you re-add it, do NOT inline the key.** The old command carried
  the project's `service_role` JWT in plaintext inside `cron.job.command`.
  It was not leaked — `cron.job`'s RLS policy is `username =
  CURRENT_USER` and the job was owned by `postgres`, so `anon` and
  `authenticated` saw no rows despite holding SELECT, and the key appears
  nowhere in the working tree or git history — but a service_role JWT
  bypasses every RLS policy in the project, so it does not belong in a
  table. Use the Vault, the way mig 038 does for push:

  ```sql
  SELECT cron.schedule('weekly-debrief-generator', '0 20 * * 0', $$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets
                   WHERE name = 'debrief_func_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret
                                         FROM vault.decrypted_secrets
                                        WHERE name = 'debrief_cron_secret')),
      body    := '{}'::jsonb);
  $$);
  ```

  The function is deployed now, so re-adding the cron no longer restores a
  weekly 404 — but set `DEBRIEF_CRON_SECRET` first, or every run gets a
  401 instead, which is just as silent.
- i18n: discovery cards + ~21 Hub fallback keys still default to English
  on 8 of 15 languages. Needs a native-speaker pass. Also: the new
  `recap.*` keys used by `src/components/dashboard/WeeklyRecap.jsx`
  are English-only via `tFallback(key, 'English')`; safe to ship, but
  worth a translation pass.
- i18n translation gap: an audit pass found ~128 keys missing in
  Arabic, Chinese, and Russian relative to English. Many are toast
  messages and validation copy. Needs a native-speaker review pass
  per the "Don't ship machine-translated copy" rule. Affected files:
  `i18n-bug-report.js`, `i18n-hub.js`, `i18n-goals.js` and others —
  search for non-`en` blocks with fewer keys than the `en` block.
- RTL polish: `dir="rtl"` is wired on `<html>` for Arabic in
  LanguageContext. The bulk audit-pass swap is complete — 22 files
  cleaned across 6 batches (56 logical-property swaps + 4 icon-flip
  `rtl:scale-x-[-1]` transforms). Layout chrome, notification UI,
  Dashboard cards, Leaderboards, nutrition flows, debrief, duel
  modals, nemesis card all use logical properties (`text-start`/
  `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/`border-s`/`border-e`)
  instead of hardcoded LTR classes. Three audit-flagged components
  (OneShotTooltip, PullToRefresh, AdminReports) had hits that were
  intentional symmetric positioning (centering or full-width pins)
  and need no swap. Still pending: visual verification in RTL mode
  on device (class swaps produce correct LAYOUT but icon orientation
  in non-flipped components and JS animations — e.g., NotificationPanel
  slide-in direction — still need direction-aware logic for full
  Arabic readiness).
- `.toLocaleString()` migration: `src/lib/intl.js` is the new util
  (`useNumberFormatter` / `useDateFormatter` / `formatNumber` /
  `formatDate`). Sites swapped so far: WeeklyRecap, StatsHubModal,
  LeaderboardsContent, WorkoutCalendarGrid, ReferralCard,
  CrewStatsPanel, AchievementsTab, AchievementsModal,
  CreateInviteLinkModal, Gauntlet (ChallengeDetail), ui/chart.jsx
  (tooltip values). Remaining hardcoded-`'en-US'` sites that are
  intentionally English (buildInfo.js, workoutGenerator.js AI
  prompts, HubProfile.jsx joined-month, WeeklyDebriefCard helper)
  stay as-is.
- ~~Push pipeline is built but not deployed.~~ ~~It is however not
  DELIVERING, on a bad `send_push_url`.~~ **Both obsolete.** It is
  deployed AND delivering as of 2026-07-31 (mig 274) — verified with a
  `200 {"ok":true,…}` from the Edge Function. The `send_push_url`
  diagnosis was wrong; the 404 belonged to the weekly-debriefs cron. The
  real causes were the fanout silently reverting to GUCs that managed
  Supabase can never set, plus the service worker not registering so
  nobody could subscribe. Both fixed. What's left is that
  `push_subscriptions` is 0 — opt in from Settings on a device to prove
  delivery end to end. Full account in the "Push notifications" section.
- Competitive-feature pushes are wired:
  • Duels — `notify_duel_invite_for` / `_result_for` (mig 065)
  • Bounties — `notify_bounty_claim_for` / `_beaten_for` (mig 069)
  • Crew Wars — `notify_crew_war_started_for` / `_resolved_for` (mig 069)
  • Nemesis assigned — `notify_nemesis_assigned_for` (mig 081)
  • Nemesis overthrown — self-celebration in `performOverthrow`,
    `nemesis_overthrown` → competitive (mig 102)
  • Gauntlet path completion — self-targeted in `completeGauntletPath`
  • Weekly gauntlet started — hourly cron fans out on status flip
    upcoming→active to opted-in active users (mig 082)
  • Crew challenge created / completed — per-member fanout via
    `notify_crew_challenge_*_for` RPCs (mig 103)

  Still NOT pushing (pick any of these if extending):
  • Individual gauntlet-challenge completions — intentional, in-app
    celebration only.
  • Crew-challenge progress milestones (25/50/75%) — intentional,
    too noisy; chat header shows progress.
  • Crew-challenge expiry without hitting goal — intentional silent
    failure; a "you missed your goal" push reads as scolding.
  • "You got dethroned" cross-user push to the overthrown nemesis —
    skipped intentionally; likely demotivating.
