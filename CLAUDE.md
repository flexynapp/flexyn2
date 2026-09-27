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
| `180` | Crew-war XP clamp. **Superseded in substance by 356–362** — war scoring is derived server-side from `workout_logs` (no client number at all), capped per lifter, and implausible sessions are excluded. See the Crew Wars and Plausibility sections. |
| `188` | Rolling 24h per-user XP cap inside the RPC, plus an append-only audit ledger that both drives the cap and is the tamper-proof log. |
| `189` | XP-milestone achievements granted by `grant_xp_milestone_achievements()`. The client used to INSERT achievement rows directly, which let any signed-in user forge a badge. |
| `192` | `grant_level_up_rewards` clamps `p_new_level` to the server's `current_level`. It previously trusted the client, so any authenticated user — including an anonymous guest — could pass 99 and mint the entire capsule ladder plus ~6,800 coins in one call. |
| `262` | Cardio XP caps. |
| `264` | Flex-coin ledger + mint ceiling, applied as a TRIGGER rather than by restating 22 SECURITY DEFINER functions — see that migration's head for why. |
| `374` | `award_xp_internal(p_user_id, p_xp)` — the ONLY way to credit a third party. Same 24h cap and same `xp_grant_log` write as 042, keyed on the parameter instead of `auth.uid()`. INTERNAL: revoked from PUBLIC, anon and authenticated. |

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
- **A cron job cannot call `increment_user_xp`, and the failure is total.** It
  opens `v_uid := auth.uid()` and raises `42501` when that is NULL, which
  aborts the whole calling statement — `p_user_id` is accepted and never
  referenced. `gym_rival_settle_week` did exactly this and had rolled back
  silently every Monday since it was scheduled, paying nobody; 0 of 44
  assignments had ever settled. Server-side awards to a third party go through
  **`award_xp_internal`** (374). Do not "fix" a cron award by writing
  `total_xp` directly — 188's ledger is what drives the rolling cap AND is the
  tamper-proof log, so a bare UPDATE is an unlogged, uncapped mint.
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
- **`crew_members` has NO client INSERT, and that is the fix, not an
  oversight** (mig 357). It carried exactly one INSERT policy —
  `WITH CHECK (user_id = auth.uid())` — which constrains which USER the
  row is for and says nothing about which CREW or which RANK. Meanwhile
  `crew_members_sync_role` does `NEW.role := COALESCE(NEW.role, …)` on
  insert, so a client-supplied role was KEPT and `is_admin` derived from
  it. Executed against production as a real authenticated guest with no
  invite, against a crew with `is_public = FALSE`:
  `INSERT INTO public.crew_members (crew_id, user_id, is_admin, role)
  VALUES ('<a private crew>', '<me>', TRUE, 'leader')` was **accepted**,
  and `is_crew_admin` then returned TRUE — which gates editing the crew,
  assigning regimens, creating challenges, kicking members, changing
  ranks and starting wars. Any signed-in user had full control of any
  crew whose id they had seen. `join_crew_atomic` and
  `create_crew_atomic` are SECURITY DEFINER and are now the only two
  doors; a guard trigger pins rank on any write that reaches the table.
  **Do not "restore" a client INSERT policy here.**
  Two things this cost that generalise: a rank vocabulary with no
  ORDERING (`role` text plus a legacy `is_admin` boolean) collapses every
  gate to admin-or-not, so `crew_rank()` returns 1/2/3 and every policy
  compares numbers; and **a helper revoked from `authenticated` cannot
  appear in an RLS policy or a SECURITY INVOKER trigger** — `crew_rank`
  RAISES 42501 rather than returning false, and a throwing permissive
  policy takes the whole statement with it. A first cut of 357 used it in
  both and would have refused a member LEAVING THEIR OWN CREW. Anything a
  client role evaluates gets a purpose-built helper that derives the
  actor from `auth.uid()` — `my_crew_rank`, `can_remove_crew_member`.
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
4. Push the feature branch and open a pull request against `main`. CI
   (lint, build, tests) must be green before merge. Netlify deploys the
   frontend from `main`.
5. **Database changes ship as migration files, never as SQL pasted into
   the Supabase editor** (since 2026-09-26). A change is a new file in
   `supabase/migrations/` named `<UTC timestamp>_<what>.sql`
   (`npx supabase migration new <what>` makes one). The Supabase GitHub
   integration builds a preview database for the PR and runs every
   migration on it; merging to `main` applies the new file to production
   and records it in production's history. See "Database migrations"
   below.
6. **Claude merges its own green PRs, database ones included** (kegan,
   2026-09-27; until then he merged every PR touching `supabase/`).
   Merging a migration is the same act as running SQL on production, so
   a database PR merges only when the Supabase Preview check has run the
   migration and passed, and its description says in plain words what it
   changes for users and data. **One exception: a migration that deletes
   user data** (DROP TABLE or COLUMN, DELETE, TRUNCATE on user rows)
   waits for Kegan's typed go-ahead, because it cannot be undone. After
   merging, confirm it landed (see "A merge is not a deploy" below).
7. Never run SQL that writes to production yourself, and never hand the
   user SQL to paste as a substitute for a migration. Read-only queries to
   check state are fine.

   The old flow (hand the user paste-safe SQL after every push, with the
   `alias.column` restrictions for their clipboard) is retired along with
   the paste. Its history is in `supabase/migrations_archive/`.
8. Update tasks via `TaskUpdate` (this session uses TaskCreate /
   TaskUpdate / TaskList — `TodoWrite` was deprecated mid-session).

## Two engineers, parallel sessions

Two Claude sessions edit this repo concurrently — yours and a teammate's.
**Before any non-trivial edit, fetch origin and rebase.** Work lands
through pull requests (the direct-push-to-`main` convention ended
2026-09-26). Never force-push `main`.

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
  `npm run test:coverage` — V8 coverage. As of 2026-08-20: **5252 tests
  passing across 379 files** (was 2769 across 198 on 2026-08-06 — this
  number goes stale fast, re-run before quoting it).

**`npx vitest` is NOT `npm run test`, and in a fresh worktree the
difference is silent.** `npm run test` is `node scripts/split-i18n.mjs &&
vitest run` — the splitter generates `src/lib/i18n-langs/`, which is
gitignored and therefore **absent from every new `git worktree`**. Run
`npx vitest` there and the whole app has zero translations loaded.

Two failure modes, and the second is the dangerous one:

- **Loud**: anything rendering inside `LanguageProvider` fails as a
  WHOLE FILE. See the provider note below — with no dictionary it never
  leaves its loading shell, so no child ever mounts and every query in
  the file fails at once. Easy to misread as a broken component.
- **Silent**: any test asserting an ENGLISH string passes anyway.
  `tFallback(key, 'English')` returns the fallback when the key is
  missing, and a missing key and an empty dictionary are the same thing
  — so an i18n test can pass against zero translations. This cost a
  wrong bug report: an a11y file "reproduced" a flake 8 runs out of 8 in
  a fresh worktree, and after running the splitter the same file passed
  6 of 6. The reproduction was the missing dictionary, not the bug.

Run `node scripts/split-i18n.mjs` once after creating a worktree, or use
`npm run test` and accept the extra second.

**`LanguageProvider` renders a loading shell, not your component.** Until
English plus the active language are loaded it returns a spinner instead
of `children` — `ready` starts from a module-level cache check and flips
on a promise. In a cold worker `render(<LanguageProvider><Thing /></…>)`
therefore yields a spinner, and a synchronous `screen.getBy*` on the next
line races the bootstrap. It usually wins, because some earlier file in
the same worker warmed the cache, which is what makes the failure
intermittent and whole-file rather than reproducible and local. Await
something that only exists once mounted:

```js
const show = async () => {
  render(<LanguageProvider><Thing /></LanguageProvider>);
  await screen.findByRole('group', { name: /front view/i });
};
```

**A whole-file red under load is usually a timeout, not an assertion.**
The default per-test timeout is 5s, and several sessions run dev servers,
builds and suites on this machine at once. A run measured 369s against
137s earlier the same day, and took out one a11y test at 6140ms plus two
in `signInExistingAccount` and two in `GymEquipmentEditor` — unrelated
files, all 3.7–5.3s. Check the suite duration before chasing it as a code
bug.

**There are TWO clocks, and `testTimeout` is not the one that usually
fires.** `findBy*` and `waitFor` have their own `asyncUtilTimeout`, which
vitest's `testTimeout` does not govern. It defaulted to **1000ms** while
testTimeout sat at 15s, so the setting raised to stop load producing false
reds could never help: RTL gave up first and threw a
`TestingLibraryElementError`. `src/test/setup.js` now
`configure({ asyncUtilTimeout: 5000 })`, and
`src/test/__tests__/asyncUtilTimeout.test.jsx` guards it by rendering
something that appears at 1600ms — asserting the CONSTANT would pass even if
`configure` wrote to a different module instance than the tests resolve.

Tell them apart by the message: *"Unable to find an element with the text: X"*
is RTL; *"Test timed out in Ns"* is vitest. Different messages, different
knobs. This class is nasty because it reads as a missing element (a real bug)
and vanishes on a solo re-run (pure noise), and nothing in the text says which.

**A test that shells out can fail because the FORK failed, not the
assertion.** `execFileSync`/`spawnSync` from a worker while ~30 others are
resident can genuinely fail — EAGAIN, ENOMEM, ENOBUFS — and the runner blames
the test, so the reader is told whatever that test exists to say.
`i18nCoverage > does not gain hardcoded strings` reported "hardcoded strings
rose" about a scan that never ran. It now retries once and, on a second
failure, says the scan did not happen. A retry is only honest when the tool is
deterministic — then it cannot mask a regression, only a failed fork.

**Ruling these out is cheap, and re-running until green is not ruling out.**
Run the tool alone N times (deterministic → not the tool); rebuild the exact
failing tree with `git archive <sha> | tar -x` and run the check there (passes
→ not the assertion); time it under real load against its own budget. All
three were needed to land on the fork.

**Never pipe a failing run through `grep`.** `npm test … | grep -E "FAIL|Tests "`
keeps the FAIL line and discards the assertion message. That destroyed the
only evidence twice in one session. Redirect the whole run to a file and grep
the file.

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
  own vendor chunks (`vendor-pose`, `vendor-supabase`, `vendor-charts`,
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

### Dependencies and Dependabot (2026-08-20)

`npm audit` is at **0 vulnerabilities**; keep it there. Two things learned
clearing 20 alerts:

- **An `overrides` entry that fixes a CVE becomes a CEILING that holds you at
  the next one.** `fast-uri` was pinned to `4.1.1` to escape one advisory and
  was itself the flagged version in the next. Re-read the whole `overrides`
  block whenever these are triaged, not just the package being reported.
- **Prefer `npm audit fix` to a global override for a transitive with several
  major lines in the tree.** `brace-expansion` was deliberately left unfixed
  once because forcing 5.0.8 globally breaks eslint's minimatch, which needs
  the 1.x/2.x API — true of an `overrides` key, which pins every copy to one
  version. `npm audit fix` patched each line separately (1.1.18, 2.1.4, 5.0.9
  coexisting) and lint stayed green.

**maplibre-gl is on v6** (2026-09-26, for a critical XSS advisory on v5). v6 is
ESM-only and must be told where its tile worker lives, or the map frame renders
with no tiles and nothing throws. **Import it only from `@/lib/maplibre`**, which
makes that `setWorkerUrl()` call; a direct `import … from 'maplibre-gl'` skips
it. `fast-uri` in `overrides` is now a caret range rather than an exact pin, for
the ceiling reason above.

**react-router is on v7** (7.18.2, migrated 2026-08-20 — the v6 line had no
patch for its last 3 advisories). Imports still come from `react-router-dom`,
which v7 keeps as a re-export, so the 83 call sites were untouched. Do NOT add
a `future={{ v7_* }}` prop to `<Router>`: `v7_startTransition` and
`v7_relativeSplatPath` are the default now and those keys are dead. The app
uses only the stable surface — no `createBrowserRouter`, loaders, actions or
`useFetcher` — which is why the migration was a version bump and a comment.

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
| `workout_logs.total_volume` | **was 0 of 3; now 1 of 9 non-zero** | Every weekly review said "0 lbs". `get_gym_leaderboard` ranked members on it and `get_gym_community_progress` summed it into the gym's "lbs moved", so both read zero for every gym since launch. `dayContext.js` had already worked around it. **Re-measure before quoting — see the correction below.** |
| `cardio_logs.duration_min` | **0 of 5** | The tracker writes `duration_seconds`. Cardio "moving time" was always 0. |
| `workout_logs.duration_min` | **0 of 9** | The writer now exists (`d0a15d2b`, 2026-08-10) and is correct; no real session has been saved since it landed. `AdvancedAnalyticsSheet` drops the Total-time / Avg-session rows rather than faking a zero. |
| `league_members.rank` | **0 of 42** | **Not one of these — see the third shape below.** The writer exists and is correct; its precondition has never been met. Also currently has no reader. |
| `nutrition_logs.food_item_id` | **0 of 126** (re-measured 2026-08-12) | The food-catalog join has never been exercised. Independently re-confirmed: **no reader, no writer, no view, no foreign key, and no `pg_proc` body mentions it.** Dead weight, not a broken write. Dropping it is a schema change and therefore kegan's; the SQL is at the foot of `docs/nutrition-food-database-audit.md`. |

`total_volume` is written at both ends — `Workout.jsx` persists it on save, and
migration 329 backfilled the existing rows with the same formula. The weekly
review derives volume from the `exercises` JSONB regardless, so it is correct
even on a row that was never written.

**CORRECTION (2026-08-11): "fixed at both ends" was too strong, and this
paragraph said it for two days.** Measured again on 2026-08-11:
`count(*) = 9`, `count(total_volume) = 9`, `count(*) FILTER (WHERE
total_volume > 0) = 1`. **Six rows carry 0 against real logged volume**
(675 / 725 / 870 / 775 / 800 / 660 lbs). Non-null is not non-zero — the
same distinction this section teaches, missed one table row above.

The cause is not a broken writer. Migration 329 **is** a one-shot `UPDATE`,
not a trigger, and the six rows were inserted **after** it ran. So the
column is a snapshot with no invariant behind it: any insert path that is
not `Workout.jsx` leaves it at zero permanently, and
`reconcile_my_workout_volume` filters on `COALESCE(total_volume,0) > 0`, so
a zero row can never credit `user_profiles.total_volume_lbs` either. Six
database functions read this column, two of them leaderboards.

**REFINEMENT (2026-08-12), and the correction above stays as written.** The
six zero rows are a **seeding artefact, not evidence about the writer.** They
carry no `idempotency_key` — which `Workout.jsx:1765` has put in the same
`create` payload as `total_volume` (`:797`) since 2026-05-24 (`e713f1d7`) — and
they landed six at a time inside **783 ms** with backdated `date` values from one
guest account. All three rows a real account wrote DO carry the key, and their
stored volume is right (one at 4995 matching its derived value; two honest
zeros). So "any insert path that is not Workout.jsx leaves it at zero" is
correct, and the sharper statement is that **no row written by the app has a
wrong `total_volume`** — which is a different claim from the column being
unreliable. Check `idempotency_key` before attributing a row on this table to
the client. Full write-up: `docs/all-workouts-audit.md`.

**Re-measure this column before quoting it, and use the FILTER clause.**
The general lesson is the one the section already makes and this entry
proves twice: a backfill makes a column correct on the day it runs, not
afterwards. Full write-up: `docs/progress-stats-audit.md`.

**A third shape, and the most deceptive: the writer exists and has never
been REACHED.** `league_members.rank` sits in the table above because it
measures 0 of 42, and it does not belong to either cause.
`resolve_league_bracket_internal` does write it — `ORDER BY weekly_xp DESC
NULLS LAST, joined_at ASC`, incrementing a counter — but only inside the loop
over members with `qualified = TRUE`, and qualifying in bronze takes one
training day in the week. Across seven resolved leagues `qualified` has been
**0 every time**, because the entire database holds 3 workout logs and 5
cardio logs. Every member fell through to the unqualified branch, took
`outcome = 'unranked'`, and kept a NULL rank. Nothing needs building: one
member of the current week already has two active days, so the next Monday
rollover writes this column's first non-NULL value in the app's history.

Reading the code proves the writer exists. Reading the data proves it never
ran. Both are true, and either one alone sends you the wrong way — a migration
to "add the missing writer" would have duplicated working code. **Check whether
the writer's PRECONDITION has ever held**, which here is one query:
`SELECT count(*) FILTER (WHERE qualified) FROM league_members`.

Two traps inside that one function, both of which produced a wrong prediction
before being checked:

- **`league_members.active_days` is an OUTPUT, not an input.** Reading it on an
  unresolved league gives 0 for everyone and looks like "nobody trained". The
  resolver COMPUTES it — `public.league_active_days(user_id, week_start,
  week_end)` — and writes it back before qualifying anyone, so a stored zero
  only means the league has not resolved yet. Call the function to find out who
  will qualify; do not read the column. That is the same failure this section
  documents, inverted: a derived value mistaken for a source.
- **`c_min_bracket` (5) gates only `v_promote_n` / `v_demote_n`, not the rank
  loop.** A bracket with one qualified member promotes and demotes nobody and
  still writes `rank = 1`. Reading "bracket too small" as "no rank" is wrong.

**A correction, kept because the misreading is instructive.** This section
first claimed those seven historical leagues were "resolved in a catch-up
sweep, silent only because nobody qualified". They were not resolved at all.
Migration 310 ends with a one-shot that VOIDS them — seven stranded brackets,
32 of 35 memberships at 0 XP, marked resolved with no ranks, no payouts and no
notifications, because resolving them under any ruleset would have promoted AFK
accounts. 310's own comment says *"This is deliberate, not a bug. outcome =
'void' records why, so a future reader does not mistake these for brackets the
resolver skipped."*

Which is precisely the mistake that got made. `leagues.resolved_at` was read as
proof the resolver ran; it had been stamped by the void. The tell was one
column away the whole time — the resolver writes `promote` / `demote` / `hold`
/ `unranked` / `decayed` and ALWAYS stamps `qualified`, so `outcome = 'void'`
with `qualified = NULL` means those rows were never passed through it. **When a
table says something ran, check what it wrote, not just that a timestamp
moved.**

The notification hazard is still worth knowing, but as a caution rather than an
observed event: `roll_weekly_leagues` resolves every unresolved past league it
finds, and resolution notifies per promotion, demotion and shield, so a genuine
backlog would deliver months of backdated results at once. It has never
happened here — 310 made sure of it deliberately, not by luck.

**Two shapes, two different causes — don't group them.** *0-of-N* means no
writer exists. *k-of-N* means a writer exists and one entry path skips it, and
that is usually NOT a bug. The correct handling for the latter is in the UI —
`WeeklyDebriefCard.jsx:478` gates its macro bar on a macro total, so a
calorie-only week says "Calories logged without macros this week" instead of
drawing a zero-width bar over three "0 g" labels.

**CORRECTION (2026-08-11): this section used `nutrition_logs.protein` as its
worked example of a k-of-N and the explanation was wrong.** It said "6 of 120
because the AI recogniser and the full-macro form both write it while
quick-add captures calories only." Measured: `calories > 0` and `protein > 0`
are **both 7 of 126**, so not one production row matches "calories but no
macros", and **there is no quick-add path** — `addEntry` is the only manual
writer and it sends all sixteen nutrient fields every time. The 119
calorie-less rows are water (see below). The real cause of 7-of-126 is that
only eight meals have ever been logged.

The genuinely instructive fact about this table is a *third* thing, and it is
neither shape: **`nutrition_logs` is missing sixteen columns the client
writes.** Migration 006 declares the `_g`/`_mg` aliases, sugar, cholesterol,
eight vitamins and minerals, and `water_oz` — and has never been applied. So
ten of the sixteen nutrient inputs on the Log Meal form are stripped by
`db.js` and silently discarded on every save, and ten display tiles rendered a
permanent zero until 2026-08-11. `db.js` documented the strip as deliberate,
which is exactly why it never surfaced. **Do not apply migration 006 without
reading `docs/nutrition-meal-logging-audit.md` first** — its `water_oz
DEFAULT 0` would have zeroed every glass of water ever logged (that default
has since been removed), and its `workout_logs` block adds `duration_minutes`,
which is the wrong column name and must stay unapplied.

**Water lives in this table too, and it dominates every count.** 118 of the
126 rows are hydration — `meal_type IS NULL`, `food_name` of `'Water'` (8 oz)
or `'Water|N'` (N oz). The encoding is deliberate and handled in five places;
`GROUP BY meal_type` before trusting any per-column count here.

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

## Deploying an Edge Function

**Update 2026-09-26: `supabase/config.toml` now exists** and declares every
deployed function. Once the Supabase GitHub integration is on, merging to
`main` deploys them, and the manual paths below are for emergencies only.
The history is kept because the failure mode (a deploy that silently
uploads nothing) is still how a missing `config.toml` entry behaves.

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

**How it works (since 2026-09-26).** `supabase/migrations/` holds
timestamped migrations the Supabase CLI and GitHub integration run in
order. It starts from a three-part baseline dumped from production:

| File | What |
|---|---|
| `20260926150000_baseline_schema.sql` | `supabase db dump` of production, unedited |
| `20260926150100_baseline_platform.sql` | what a dump misses: the `auth.users` sign-up trigger, storage buckets and policies, the 21 cron jobs |
| `20260926150200_baseline_reference_data.sql` | catalog rows the app needs: XP levels, loot, crew challenges and perks, gauntlet |

Production is recorded as having applied all three; they only ever run on
fresh databases (local, preview branches). Replayed on a fresh local
Supabase on 2026-09-26, the result matched production exactly: 151 tables,
275 policies, 405 functions, 85 triggers, 3 views, 21 cron jobs.

- **The 414 numbered files (`001`–`387`) are in
  `supabase/migrations_archive/`.** They are history, not instructions:
  production's history had recorded 15 of them, and several later files
  redefined functions from stale copies. Read them for the reasoning behind
  a table; read `pg_get_functiondef()` or the baseline for what exists.
  `docs/migrations-runbook.md` catalogues them.
- **Never edit a migration that has merged.** Fix forward with a new one.
- **`config.toml` declares every deployed Edge Function** with the
  `verify_jwt` it has in production; merging to `main` deploys them. A new
  function needs an entry, or it is never deployed.
- **A function's folder name must be lowercase.** The CLI lowercases every
  config.toml key, so `[functions.generateWeeklyDebriefs]` deploys as
  `generateweeklydebriefs` and looks for a folder of that name. The bundle
  fails with "entrypoint path does not exist", and the functions step stops
  there, so every function listed after it silently stays on its old
  version. That held `main` at FUNCTIONS_FAILED from 2026-09-26 until the
  entry was set `enabled = false`. Name new functions in kebab-case.
- **Refreshing the baseline** is the "DB baseline capture" Action (read-only;
  pushes to the `db-baseline-capture` branch). The one-time history rewrite
  is "DB mark baseline applied", which stops if production has drifted from
  the baseline.
- `npx supabase db start` gives you a local copy with all migrations applied
  (needs Docker). Test RLS there as `authenticated` with JWT claims, the same
  way as against production.
- **A merge is not a deploy until you have checked production.** The
  integration acts only on pushes made after it is connected and linked to
  `main`: PR #79 and #80 both merged on 2026-09-26 with nothing deployed,
  because the branch link was only set at 18:49 UTC that day. After merging
  a migration, confirm it with `select version from
  supabase_migrations.schema_migrations` rather than trusting the merge.
  `list_branches` shows the link as `git_branch: "main"`.

The lessons below were learned under the old paste flow and still apply to
writing SQL:

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
- **A trigger's COLUMN LIST is the gate, and replacing the function alone
  changes nothing.** `BEFORE INSERT OR UPDATE **OF name**` fires only when a
  listed column is in the UPDATE's SET clause, so widening what the function
  checks is invisible until the TRIGGER is recreated with the wider list —
  and a column list cannot be altered in place, so it is DROP + CREATE inside
  one transaction. Migration 372 walked into this: the new body was verifiably
  live on the trigger (`pg_get_functiondef(tgfoid)` contained the new clause)
  and `UPDATE crews SET description = …` still went straight through.
- **End a migration in a SELECT that ATTEMPTS the thing, not one that
  inspects the catalog.** 372's first draft passed every existence check while
  blocking nothing. Attempt the write inside a rolled-back savepoint and assert
  BOTH directions — the bad write is refused AND ordinary input still saves; a
  guard that rejects everything passes all the "is it blocked?" checks. And
  never write a literal `TRUE AS function_installed`: it proves nothing and
  reads as evidence.
- **Numbering is no longer a coordination problem.** Migration versions
  are UTC timestamps, so two sessions cannot pick the same one by accident.
  The old three-digit scheme collided 27 times; see the archive.

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
| ~~Write strip-and-retry~~ | removed 2026-09-27 | `src/api/db.js` `makeEntity` create/update and `updateMe` used to drop a column the table lacked and retry (`updateMe` could even fall back to saving only the onboarding flags). That is how data went unsaved for weeks, so a missing column now throws. A field the app collects but deliberately does not store is dropped by name at its writer (`NOT_STORED` in `src/lib/data/nutrition.js`). |
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

## Schema drift — `npm run schema:columns`

A column the client names but the database lacks fails two ways, and only one
is visible. Named in a `select()` or a FILTER, PostgREST 400s the whole request
(`public_profiles.email`, `nutrition_logs.protein_g`). Read off a `select('*')`
row, it is `undefined` with a 200 — nothing throws, nothing logs. That second
shape hid `HubComposer` keying a Map on a dropped `u.email`, so no follower was
ever notified of a post, and `hub_reactions.reaction` (the column is
`reaction_type`), which left the Likes view on your own profile empty from the
day it shipped: 47 rows, 7 users, none of them able to see their own likes.

`npm run schema:columns` extracts every `(table, column)` pair the client sends
— explicit select lists plus every `.eq/.in/.order/...` filter — and prints a
read-only query to paste into the Supabase SQL editor. Anything it returns is a
live defect.

**It prints SQL rather than checking itself, on purpose.** The only honest
source of truth is production. Migrations here are pasted by hand, so a
migration-derived map is a SUPERSET of reality — mig 006 declares
`nutrition_logs.protein_g` and has never been applied, which is the column that
broke. A committed snapshot would answer confidently and be wrong.

**No unit test can catch this class.** `likedPosts.test.js` asserted
`['reaction', 'like']` and passed for as long as the bug existed, because a
mocked supabase chain sees the filter's shape and never whether the column is
real.

The extractor's precision is the whole point: the first ad-hoc version reported
16 findings and 15 were its own fault. Both causes are pinned in
`src/lib/__tests__/schemaColumns.test.js` — a storage bucket is not a table,
and a chain must stop at its own statement rather than N characters later, or
it steals the next query's columns.

## i18n discipline

**ARCHITECTURE CORRECTION (2026-08-16):** this section described
`src/lib/i18n-*.js` part files and a `scripts/split-i18n.mjs` build step.
Both were **deleted** when the flat catalogs shipped (2026-08-13). The
lessons below survived the move and are kept; the mechanics did not.

- 15 catalogs: `en es fr de pt it ja ko zh ar hi ru tr pl nl`. Only
  **en/es/fr are RELEASED** (`SUPPORTED_LANGUAGES`); the rest are shelved
  but maintained. `ALL_LANGUAGES` is what tooling reads.
- One flat JSON per language, `src/locales/<lang>.json`, sorted, committed
  as the source of truth. No build step. Policy that cannot live in a flat
  catalog (English-only keys, machine-drafted domains) sits in
  `src/locales/_meta.json`; the term base is `src/locales/_glossary.json`.
- New keys: add to `en.json` **and to every released locale in the same
  change**. At the call site use **`tFallback(key, 'English')`** so a
  missing translation surfaces a sensible string, never a key code.
- **A `tFallback` key that is not in `en.json` is an ORPHAN, and it is the
  one i18n defect every other guard here is blind to.** It renders
  perfectly — tFallback falls through to its second argument, so English
  is always right — while being invisible to `i18n:audit` (which compares
  locales *against* en.json), to `_coverage.json` (an orphan is not a key,
  so it moves neither counter), to `i18n-hardcoded.mjs` (it is already
  wrapped), and to the DEV missing-translation warning (which needs
  English to have the key). No translator and no TMS can discover it
  exists. **Measured 2026-08-16: 764 of them against a 3,895-key
  catalog** — about one in six of the strings that *look* translated were
  never on the table. `src/components/crews` was cleared outright; the
  rest are baselined in `src/locales/_orphans.json` and ratcheted by
  `i18nOrphanKeys.test.js` (`npm run i18n:orphans`). The ratchet is
  two-directional on purpose: a fixed key left on the list also fails, or
  the baseline rots into a lie.
- **Adding a key to `en.json` is never free.** `releasedLocales.test.js`
  needs 95% coverage to offer a locale, and coverage is `keys present in
  the locale / keys in en`. Adding N English keys without translating them
  pushes every released locale DOWN. That is why en/es/fr move together.
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
- *(Historical — part files are gone, but the failure mode generalises to
  any hand-merged catalog.)* **A language may appear at most once per part
  file.** JavaScript resolves
  a duplicate literal key by keeping the last block and discarding the
  earlier one silently — no error, no warning. Three of 41 files had this;
  it cost `onboarding.welcome.languageHint` in pt/it/ja/ko, the one string
  whose job is telling someone who can't read the current language how to
  switch, so those four fell back to English asking "Don't speak English?".
  `scripts/split-i18n.mjs` now fails the build on it. The guard is
  brace-depth aware because `i18n-warn.js` legitimately holds two separate
  object literals that each declare all 15 languages.
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
  - **A second exception now exists, and it was asked for**:
    `src/lib/i18n-journal.js` (2026-08-09, Kegan chose the split over
    English-only or full MT). It is the SAME shape as the equipment file —
    self-marked, `REVIEW_PENDING`, guarded by
    `src/lib/__tests__/i18nJournal.test.js` — with one addition worth
    copying: an exported **`ENGLISH_ONLY`** listing the 14 prose keys that
    are deliberately English in every language, and a test asserting no
    non-English block defines any of them. That inverts the usual failure:
    a future pass cannot quietly fill a sentence in, because doing so fails
    the suite rather than looking like progress. The split line is short
    labels vs. full sentences, and a test checks that too (a held key that
    reads like a label fails).

- **A translation without its vars renders a hole, and English cannot show
  you that.** The standard call is `tFallback(key, 'English {n}', { n })` —
  three arguments. Any wrapper in between must forward all three.
  `JournalView` passed `(key, english) => tFallback(key, english)` and
  rendered a literal **"Dormiste {n} h"** in Spanish while English was
  perfect, because the English fallback is a template literal that has
  already interpolated. **Every test stub in this repo is
  `(key, english) => english`**, which has the identical blind spot — it
  returns the pre-interpolated fallback and passes either way. When a string
  carries a placeholder, test it with a stub that ignores the fallback and
  interpolates a template (see `dayContext.test.js` / `journalProvenance.test.js`);
  otherwise the bug is invisible until someone switches language.

- **No dashes in display copy** (kegan, standing). Not hyphens, en dashes
  or em dashes in any string a user reads: a dash-joined clause is a tell
  of generated copy the same way gradients and glassmorphism are. Three
  moves allowed — two sentences, a comma, or cut the clause. Swept
  2026-08-16: 349 catalog strings and 65 hardcoded literals.
  - **The catalog is not the whole surface.** `npm run i18n:hardcoded`
    finds ~708 user-visible strings with no key at all, and 65 of them
    carried a dash. Fixing only `src/locales/*.json` would have left
    dashes on screen while every measurement read zero.
  - **A rule per shape, not one regex.** An imperative continuation is two
    sentences ("Could not save. Try again.", the app's most common toast).
    A coordinating conjunction is a comma, never a sentence break.
    `**Term** — definition` in the Coach bullets takes a colon, because a
    dash there is glossary typography, not the tell.
  - **A lone `—` is a GLYPH, not copy.** It means "no value" at 20+ render
    sites. Rewriting it to "None" changed behaviour everywhere — and it
    got there because the call-site sync substituted a one-character
    string across the whole tree. Never bulk-substitute a short literal.
  - **Numeric ranges keep the en dash** (`5–8 reps`); a SPACED one reads as
    a dash and was reworded (`between 36 and 108 inches`). Intra-word
    hyphens stay: `warm-up` is orthography, not a clause.
  - **What the sweep broke, none of it visible in a 349-string diff**: a
    sentence break landing inside parentheses; two dashes that were one
    parenthetical aside flattening into a run-on; a colon after a question
    mark; eight sentences opening with And/Or/Plus. Each was found by a
    targeted assertion over the before/after PAIRS, which is the only way
    to review a sweep this size.
  - **The check that lied.** The first "0 problems" ran against an empty
    list: the before/after report had been clobbered by an accidental
    re-import of the sweep module, whose top-level code re-ran and wrote a
    zero-length file. Rebuild the diff from `git show HEAD:` rather than
    trusting a file the run itself wrote.
  - Shelved locales still carry dashes, deliberately. Repunctuating twelve
    languages nobody is shown, and that I cannot read, is worse than
    leaving them.

- **Dates are not covered by translation keys.** `date-fns` `format()` binds
  no locale, so "Sunday, August 9" survives every translation pass — the
  journal header, its month rules and its Log rows all read English under a
  fully-Spanish screen. Fix with **`useDateFormatter()` / `formatDate()`
  from `src/lib/intl.js`** (`Intl.DateTimeFormat`, already language-bound),
  never by importing date-fns locales: that is 15 locale bundles on the
  startup path to reproduce something the platform already has. Keep
  `format(d, 'yyyy-MM-dd')` as-is where the output is a KEY rather than
  text — those must not move with the locale.

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
  **On a surface converted to the fluid scale, `--fluid-section` supersedes
  this** — see the reconciliation at the end of the fluid-scale section. This
  rule governs values you TYPE; the scale governs values a viewport computes.
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

**A PARTIAL conversion is a legitimate outcome, and usually the right one.**
Progress (2026-08-10) took `--fluid-pad-y` and `--fluid-section` and nothing
else: it scrolls inside Layout, so it needs neither its type nor its component
heights clamped. Four things stayed fixed there and the reasoning generalises —
**a floor is not a gap** (48px tap targets are the Apple HIG minimum), **the
one `gap-8` seam must not shrink with the gaps it exists to stand apart from**
(holding it while sections compress makes the ratio *better* on a small screen:
32:16 is 2× against 32:22 on a Pro Max), **type already sitting on the 11px
floor has nowhere to go**, and **a horizontal literal that another rule depends
on has to stay literal** (that page's `px-4` is what its full-bleed band's
`-mx-4` cancels; making one fluid silently breaks the bleed).

Measure before converting. Progress was already fine on an SE — no overflow,
nothing clipped — and the conversion bought 24px, or 1.7%. That is a real
result and a small one; the value was that the page moves with the device
rather than being drawn for one. Don't promise a screen back.

### The fluid scale beats the two-register rule (kegan, 2026-08-10)

These two rules contradict each other and the contradiction is real, not a
misreading. `--fluid-section` is `clamp(12px, …, 24px)`, so it interpolates
straight through the 12–20px middle register that the composition rules ban
outright. On Progress at 667px it lands on **16px — a banned value, arrived at
by a sanctioned mechanism.**

**The scale wins.** The reconciliation: the two-register rule exists to stop
someone reaching for `gap-4` because 24 "felt like too much" — it polices
*arbitrary values chosen by hand*. A clamped value is neither arbitrary nor
chosen by hand; it is one endpoint of a range whose endpoints ARE 12 and 24,
both legal. The registers govern what you type. The scale governs what a
viewport computes from what you typed.

So: **on a converted surface, `--fluid-section` is correct even where it
resolves into the banned middle. On an unconverted surface the ban stands in
full** — `gap-3`/`gap-4`/`gap-5` remain wrong, because there the 16px really
is a hand-picked in-between.

Don't "fix" a fluid gap that measures 16px, and don't cite the register rule
against the scale in review.

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

## Skins — seasonal looks (Sept 2026)

Whole-app looks (Halloween first) are **skins**: data in `src/lib/skins.js`,
parts in `src/components/skins/<id>/`, rendered through fixed slots
(`Backdrop`, `NavEdge`, `LogoMark`, `Icon`, `EmptyAccent`). A skin
may move the neutral token ramp and never `--primary` or the state hues.
**There is no slot above the page**: the old themes cut content off that
way. Figures live in the Backdrop at the skin's declared `ink`; the NavEdge
reserves its room through `--skin-nav-edge`. `skinFit.test.js` and
`skinContrast.test.js` enforce both, so don't add an overlay slot back.
Grounded figures are **planted, not placed**: derived from the skin's
`groundY()` and checked by `skinGrounding.test.js`, never given a typed y.
**Read `docs/skins.md` before adding one.** Layout's shell carries
`.app-shell` so it can go transparent while a skin's backdrop is on. Don't
give it an opaque background again, or every backdrop silently disappears.

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

## Native app (Capacitor)

The App Store / Play build is Capacitor 8 around the SAME `dist/`. Full
build steps and the account checklist: `docs/native-app.md`. Conventions a
contributor must not break:

- **The web path is the default and must not move.** Every native
  difference is a runtime branch on `isNative()` / `platform()` from
  `src/lib/native.js`, and a helper that cannot tell answers "web". Tests
  pin both directions (`nativeAuthRouting`, `supabaseClientFlow`,
  `nativeWebSurfaces`). A change that alters web behaviour to suit the app
  is a regression, however small.
- **Never set `server.url` in `capacitor.config.json`.** The bundle ships
  inside the app; a remote wrapper is rejected under App Review 4.2. It also
  means a Netlify deploy does not reach store users.
- **No service worker, no Web Push, no install prompts in the app.**
  `AppUpdatePrompt` returns before importing `virtual:pwa-register`,
  `usePushSubscription` reports unsupported (which hides every opt-in
  surface), and both install prompts stay quiet. Native push is APNs/FCM,
  not built yet.
- **Auth on native is PKCE through the system browser**, returning on
  `app.flexyn://auth-callback` (`src/lib/nativeAuth.js`). The web client
  keeps the implicit flow on purpose: PKCE would break a magic link opened
  in a different browser. Never start OAuth inside the web view (Google
  refuses it), and never build a redirect from `window.location.origin` on
  native: it is `capacitor://localhost` or `https://localhost`.
- **Links other people open use `shareOrigin()`** (`src/lib/appOrigin.js`),
  not `window.location.origin`, for the same reason. On the web the two are
  identical.
- **Sign in with Apple on iOS is a Swift plugin in the app target**
  (`ios/App/App/FlexynBridgeViewController.swift`), registered by the root
  view controller. The community npm plugin pins Capacitor 7 in its Swift
  package and cannot resolve against 8, so do not "replace it with the
  standard plugin" without checking that first. App Review 4.8: Google
  sign-in requires Apple sign-in, so Apple must be enabled in Supabase
  before any iOS submission.
- **`ios/` and `android/` are committed; their `public/` copies are not.**
  Run `npm run cap:sync` after a web change you want on a device.
  `ios/App/CapApp-SPM/Package.swift` is rewritten by `cap sync`; add native
  dependencies through npm plugins, not by editing it. Both trees are in
  ESLint's global ignores because they contain copies of the built bundle.
- **`@capacitor/assets` is run through npx, never installed** (`npm run
  cap:assets`). It pins an old `@capacitor/cli` with a vulnerable `tar`,
  and npm audit is held at zero. For the same reason `package.json`
  overrides `uuid` under `xcode`, a dependency of `@capacitor/cli`.
- **A new web capability may need a native declaration.** Camera,
  microphone, speech and location already have `Info.plist` usage strings
  and Android permissions; a web view cannot reach anything the app does
  not declare, and iOS terminates an app that uses the camera without a
  usage string.

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

## Crew Wars (migrations 356–359, Aug 2026)

Crew vs crew over seven days. The feature existed on paper long before it
worked: the Workout card navigated to `/hub` with
`state: { openCrewWars: true }` and **nothing in Hub.jsx has ever read
`openCrewWars`**, so every tap landed on the Hub feed. It opens a sheet in
place now and does not navigate at all.

- **The card is gated on membership.** A user in no crew cannot be in a
  crew war, so the hero slide is not rendered for them and the carousel
  dots count two. `HeroPager` wraps modulo `slides.length`, so the list is
  built per render — a fixed three with a hidden page leaves a blank slide
  in the rotation.
- **Cross-page hand-offs use ROUTER STATE, not `flexyn:open-crew`.** That
  event works only for a dispatcher already inside Hub (HubProfile) or
  firing while Hub is mounted. Workout is neither, so an event dispatched
  beside `navigate()` lands before the listener exists — the same failure
  as the `openCrewWars` bug. Hub consumes `location.state.openCrewId` and
  clears it, or a back-navigation re-opens the crew page you just left.
- **Matchmaking is on the ROSTER, not the division.** 356 snapshots five
  numbers onto the queue row when a crew enters — size, mean age, mean
  bodyweight-relative e1RM over 90 days, mean sessions per member over 28
  days, season division — and `crew_match_gap` ranks candidates on a
  weighted distance. Snapshotted rather than recomputed because it is what
  the crew WAS when it queued, and because the alternative is four
  aggregates over every member of every waiting crew on every join.
  Tolerance opens 0.15 per 12 hours waited, so nobody is stranded by a
  small pool.
- **Coverage is the whole design of that distance function.** Measured
  before writing it: `age` is set on 26 of 60 profiles, `gender` on 13,
  `activity_level` on **0 of 60**. A distance that reads a missing value
  as zero ranks crews on ABSENCE, silently. So a dimension is compared
  only where BOTH crews have it and the divisor is the weight actually
  used. **Gender is not a dimension at all** — 13 of 60 is too thin, and
  sorting crews by gender mix is not something this app should do.
- **`::numeric` on the roster term is load-bearing.** Both counts are
  integers, so `ABS(2-12) / GREATEST(2,12,1)` is integer division and
  measured **exactly 0.000000** — roster size, the dimension the feature
  exists for, contributed nothing. Every other term already divides by a
  numeric literal, which is why it was the only one affected. Caught by
  printing the gap across a sweep, not by a test.
- **Both sides field the same number of lifters.** `recompute_crew_war`
  set each score to `SUM(xp_contributed)`, so a twelve-person crew beat a
  four-person crew whatever either lifted. Each side now scores its top N
  where N is the smaller roster. A per-member MEAN was the other candidate
  and is worse: it rewards a crew for dropping whoever trained least, so
  the fair-looking metric makes kicking people the winning move. Measured
  on seeded rows: old sum 1500–1400 to the bigger crew, top-N 500–1400 to
  the crew that actually trained.
- **Three ranks, and the number is the point.** 3 leader / 2 moderator /
  1 member. `src/lib/crewPermissions.js` mirrors the matrix for the UI and
  says in its own header that it is NOT the enforcement — 357 is. Add a
  capability in both or it is not a permission;
  `crewPermissions.test.js` pins the matrix and asserts monotonicity.
- **Starting a war is LEADER-only** (mig 358, kegan's call). It sat at
  rank 2 for one commit on the reasoning that entering matchmaking is
  operational rather than structural; committing every member to a
  seven-day competition is a fair reading of structural. 358 is a NEW FILE
  rather than an edit to 357 because 357 was already applied — see the
  first habit at the top of this file.
- **Transfer Leadership is its own action, never a row in the rank
  picker** (mig 359). It promotes the target and steps the caller down in
  ONE transaction, and it promotes FIRST: 357's guard refuses a demotion
  that would leave zero leaders, so the order is forced, and a crash
  between the two statements leaves two leaders rather than none. Only one
  of those is recoverable by the users themselves.
- **A crew always keeps a leader** (23514), and equal ranks cannot act on
  each other — `canActOn` is strictly greater, so two moderators cannot
  race to eject one another.
- **The war board shows BOTH rosters** (mig 360). It was own-crew only,
  which was my call and was overridden. The line moved to DETAIL rather
  than identity: every member of both crews returns with a name and a
  score, and `volume_lbs` / `sessions` / `days_active` stay own-crew —
  a rival's score is the contest, their training calendar is not.
- Design: Penpot pages **Crew Wars** (boards A–D states, E the gate,
  F the spec) and **Crew Manage** (roster by rank, member actions, the
  permission matrix).
- **The whole `src/components/crews` directory is now translated**
  (2026-08-16) — 145 keys across en/es/fr, and it is the one directory
  the orphan-key ratchet asserts stays clear. Vocabulary was DERIVED from
  strings that had already shipped, not invented: `crewWarPanel.crewWar`
  was already *Guerra de Crews* / *Guerre des Crews*. Two terms were
  chosen rather than inherited and both are in `_glossary.json` with the
  reason — **Roster is es "Plantel", never "Plantilla"** (Plantilla is
  already Template, and the Rutina=Regimen+Routine collision is exactly
  what one word for two objects costs), and **Lifter is Atleta/Athlète**
  because "levantador" is not how a gym speaks and the shipped copy had
  dodged the noun by recasting. One genuine mistranslation was avoided by
  reading the UI rather than the word: `crewWars.record` is a W–L
  **record**, so es is *BALANCE* — "Récord" would have meant a personal
  best on a cell showing 3–1.
- **`CrewLeaguePanel` shipped four pre-interpolated fallbacks**
  (``tFallback('league.division', `Division ${division}`)``) and they were
  harmless only while the keys did not exist. The moment a catalog entry
  lands, `t()` wins and renders the literal `{n}` — the JournalView
  defect, armed and waiting. **Adding a key is what detonates it**, so
  grep for template-literal fallbacks before any extraction pass.

## Crew challenges are a catalog now (migration 367, Aug 2026)

Kegan, 2026-08-16: pre-built **generational** goals a crew chases, the
leader picking from what its **crew level** unlocks, each paying a
**unique trophy** the crew keeps. The leader-composed challenge from 098
stays alongside it (his call) — `template_key IS NULL` is the old kind.

- **Measured before building: `crew_challenges` held ZERO rows in
  production**, and `crew_challenge_contributions` zero. The composed
  feature had never been used once since 098 shipped. That is what made
  "replace vs keep both" a free choice rather than a migration problem.
- **The client cannot create a templated challenge, by construction.**
  The INSERT policy is `is_crew_moderator`, so a rank-2 member posting a
  row with `template_key` set and `target_value = 1` would mint the
  crew's trophy in one request. The guard trigger forces `template_key`
  to NULL on every client INSERT and pins it on UPDATE; the leader-only
  definer RPC is the only door. Probed: a smuggled key comes back NULL.
- **`ends_at` is nullable now and NULL means no deadline.** A far-future
  sentinel would render as "ends in 36,500 days" — a lie the user can
  read. Every reader is guarded instead; `CrewChallengeCard` was the one
  that would have printed "ends 56 years ago", because `new Date(null)`
  is the epoch.
- **The window floor is the LATER of the challenge start and
  `joined_at`.** A chase is forward-looking, and the `joined_at` half is
  what stops a crew stuck at 80% recruiting a veteran whose back
  catalogue lands on the bar. One member is capped at **60% of target**:
  a goal cannot be soloed, but a crew of two can still finish one.
- **`sync_my_crew_challenge_progress` had no plausibility filter and pays
  XP, coins and `award_crew_progress`.** 361/362 swept the
  competitive-or-credited readers and missed it — the list in the
  plausibility section names fifteen of twenty-four, and this was one of
  the nine never classified. **If you are auditing that sweep, the other
  eight are still unclassified.**
- The probe is the reason any of this works. Three rolled-back
  transactions, 33 assertions. The one that mattered: the first run
  credited **1** where 6 was correct, because the seeded history sat
  outside the window — the code was right and the header comment was
  wrong, and only running it told them apart.
- Design: Penpot page **Crew Trophies** — boards A (empty shelf), B (a
  chase in progress, with contributions), C (shelf with trophies earned),
  D (the leader's picker as a bottom sheet), F (the spec).
  **Board E was deleted, not built** (kegan, 2026-08-16): it drew the same
  list as a read-only sheet for a member, and the tab already lists every
  challenge inline with the gate stated above it, so it was a tap that
  bought nothing. The same argument later removed a mid-chase picker
  button. **A board describing a screen that should not exist is worse
  than no board** — when a design is dropped, delete it rather than
  leaving it to be implemented by whoever reads the page next.
  **Every colour on it is a real token read out of `index.css`** —
  `#13171B` background, `#191F24` card, `#F5F2F0` foreground, `#89949F`
  muted, `#F37616` primary, `#45C489` success, `#2A333C` border — plus
  `#FFD700`, which is `TROPHY_TIERS.gold` from `trophyDefinitions.js`
  rather than a new colour. Archivo for headings and numerals, Figtree
  for everything else, matched to the Crew Manage page. **A trophy is a
  monogram chip, not an icon**: 44×44 at radius 14 with the title's two
  initials, which is the same mark the crew avatar already uses, so the
  shelf needed no new iconography invented for it.
- **The tab strip becomes five wide** (Home / Roster / Chat / League /
  Trophies) and still fits 390px at `gap-5 px-4` — **measured in a render
  harness, not derived**: content ends at 320px (en), 306px (es), 343px
  (fr), so the tightest released locale keeps 47px of slack.
- **Two design corrections the CODE made to the Penpot board**, both
  worth keeping if the boards are ever redrawn:
  1. **The gold is wrong.** The boards draw trophies in `#FFD700`
     (`TROPHY_TIERS.gold`), and `index.css` is explicit that the app gets
     FOUR hues, that amber and gold route into `--primary`, and that
     "nothing outside this block gets to introduce a hue". A trophy takes
     **`--success`** (which means "earned / complete", exactly what a
     trophy in hand is) and an unstarted challenge takes `--primary`.
  2. **A trophy row's subtitle must be conditional.**
     `get_crew_challenge_catalog` filters on `is_active`, so a template
     retired after somebody won it is absent — an unguarded `<p>` then
     renders an empty line that still takes its height.
- **Rendering it in French found a gap English could not show**: the
  challenge titles come from `crew_challenge_templates`, so they were
  English in every locale with no key for a translator to find — the
  orphan-key defect in a second shape. `challengeName()` now routes them
  through `crewChallenge.<template_key>` with the server's title as the
  fallback. **Numbers stay server-side, words move client-side.** Trophy
  NAMES stay English deliberately (product names, same class as Crew and
  Capsule) and `_glossary.json` records why.

## Crew visibility and invites (migration 372, Aug 2026)

`crews.is_public` was readable and **unwritable** for months: `updateCrewProfile`
had accepted it since 248 and the only caller in the app was CrewChat's avatar
upload. Measured before the fix: 4 crews, 0 public, 0 with a description, 0
with a tag. Migration 370 had to drop discovery's `is_public` filter because it
returned zero rows for all 56 users — a filter nothing could satisfy.

- **`CrewSettingsSheet` is the writer**, leader-only. `crews_update` is
  `is_crew_admin(id)` for USING and WITH CHECK, and `is_crew_admin` reads
  `is_admin`, NOT `role` — gate UI on the same column or you offer a control
  the server refuses with 0 rows and no error.
- **`authenticated` holds UPDATE on EVERY column of `crews`.** What stops a
  leader forging `crew_xp` is the `crews_guard_write` BEFORE trigger, which
  silently reassigns privileged columns back to OLD. A widened payload
  SUCCEEDS and does nothing — keep `updateCrewProfile`'s allow-list equal to
  what the trigger lets through (name, description, is_public, tag,
  avatar_url).
- **"Private" does not mean hidden.** Since 370 every crew is listed;
  `is_public` decides only whether `join_crew_atomic` inserts a member row or
  files a `crew_join_requests` row. The copy says so — do not reword it into
  a promise of concealment.
- **Invites are real now.** `invite_to_crew` (250) had zero callers and
  `crew_invites` had never held a row, so a DM invite degraded into an
  ordinary application. Both senders — crew creation and `CrewInviteSheet` on
  the roster — write the invite **before** the DM, or a friend tapping Accept
  immediately files a request instead. Its gate is `is_admin OR role IN
  ('leader','moderator')`, so `INVITE_MEMBER` sits at RANK.MODERATOR to match
  the database; that is a rank BELOW `EDIT_CREW_PROFILE` on purpose.
- `is_text_clean` is a **slur** filter, not a swear filter — 14 terms, word
  boundaries, leetspeak fold. It returns clean for ordinary vulgarity, which
  is why production holds a crew called 'Butt Crackers' with the name guard
  working correctly the whole time. 372 extends it to description and tag; it
  does not move that line.

## Plausibility — a flag, not a refusal (migrations 360–362, Aug 2026)

`detectImplausibleWorkout` in `src/lib/workoutFatigue.js` models a day's
realistic volume from bodyweight, age and sex. **It is not a recovery
score** — that is `recoveryScore.js`, a different thing — it is the app's
second anti-cheat layer, and until 360 it ran ONLY on the client
(`Workout.jsx` and `EditWorkoutModal`). `public.workout_logs` had **zero
triggers**, measured. A crafted request wrote whatever it liked.

**The gate FLAGS, it does not reject, and the reasoning is the whole
design.** Three reasons in order of weight:

1. A reject destroys the session. `weight_lbs` is set on 27 of 60
   profiles, so the model falls back to a 160 lb default and a genuinely
   strong lifter with a blank profile trips it honestly.
2. The real client already blocks. A server reject adds nothing for an
   honest user and can only fire where the two models disagree — the
   false-positive case.
3. **A reject teaches the threshold.** Refuse at 28,800 and the next
   attempt is 28,700, forever. A flag accumulates the pattern instead,
   which is what a ban decision needs.

`workout_logs.implausible` + `implausible_ratio` are assigned by the
trigger on EVERY write, so a client cannot self-declare itself clean —
verified by sending exactly that. Same-day accumulation is covered: the
check sums the user's other logs on that date, or the answer to any
ceiling is "post it in ten pieces" (a day split across four rows was
caught in testing).

**THE LINE: competitive-or-credited filters, personal history does not.**
24 functions read `workout_logs` and they are not one kind of read.

- **Filters** (361, 362) — `reconcile_my_workout_volume`, the four gym
  boards, `league_active_days`, `get_friend_leaderboard`,
  `get_period_leaderboard`, `recompute_crew_war`. A forged row here takes
  something from somebody else.
- **Guards with a RAISE** (362) — `complete_bounty_claim`,
  `complete_gauntlet_challenge`, `submit_duel_result_atomic`. Each takes a
  specific `p_workout_log_id`, so the question is whether one row may be
  SPENT, not which rows to sum. Raising is right here and wrong in 360:
  refusing to save destroys the session, refusing to spend it costs only
  the award and the log stays in their history. The guard raises BEFORE
  any state change, so a refused claim stays `active` rather than burnt.
- **Does NOT filter, deliberately** — `generate_weekly_review_for`,
  `dispatch_memory_reengagement`, `get_crew_inactive_members`,
  `get_org_analytics`, `get_trophy_progress`. Hiding a session from
  someone's own weekly review makes the app lie to them about their own
  week, and a false positive would delete real history from the one place
  they would notice.

Four things to carry forward:

- **`NOT COALESCE(implausible, FALSE)`, never `implausible = FALSE`.** A
  row that escaped the backfill is NULL and must read as "fine". Dropping
  unknown rows from a leaderboard is a worse bug than keeping one bad one.
- **`reconcile_my_workout_volume` needs the SAME predicate on its SELECT
  and its UPDATE.** Filtering only the sum stamps a flagged row
  `volume_credited_at` while crediting nothing — spent silently.
- **`get_period_leaderboard` needed PARENTHESES.** Its window is
  `WHERE v_since IS NULL OR date >= v_since`; AND binds tighter than OR,
  so appending the predicate would have left the ALL-TIME board unfiltered
  while reading as correct.
- **The ceiling only ever TIGHTENS and is a no-op on an unknown profile.**
  200,000 stays the absolute cap, and a blank profile models to 201,600
  for the week, which clamps straight back. Nobody is punished for an
  empty form. Verified 200000 / 107100 (120 lb, 55, female) / 200000
  (300 lb, 25, male).

**THE SWEEP IS NOW COMPLETE (migration 375, 2026-08-16), and the count
above was wrong.** There are **31** functions reading `workout_logs`, not
24 — the Gym Rival work (363–365, 373, 374) added several after this
section was written, which is the general hazard: a classification is
only true for the functions that existed when it was made.

- **A forged workout was winning Gym Rival weeks and being paid for it.**
  `gym_rival_settle_week` → `gym_rival_net_rating` → `gym_rival_volume_lbs`,
  which read `workout_logs` unfiltered, → picks the winner → XP, flex
  coins, loot capsules and a push. Competitive AND credited, and open.
  Probed: **1,350 vs 1,351,350**.
- **`mark_workout_volume_credited` was a second door to the stamp.** 361
  gave `reconcile_my_workout_volume` the same predicate on its SELECT and
  UPDATE for exactly this reason; nobody checked the function next to it,
  which stamps `volume_credited_at` from the client with no predicate at
  all. Spent silently, and permanently uncreditable if the flag is ever
  cleared.
- Also filtered by 375: `update_solo_challenge_progress` (twice — the
  session count is the CLAMP on a client-supplied `p_prs_hit`),
  `gym_rival_user_stats`, `crew_match_cadence`, `crew_match_strength`.
- **Three deliberate abstentions, with reasons, so they are not
  rediscovered as bugs**: `gym_rival_void_stale`/`_all` ask a PRESENCE
  question for the 48h AFK void, and filtering there voids the match of
  someone whose honest heavy session tripped the model;
  `sweep_stale_guest_accounts` asks whether an account has ANY data
  before DELETING it; `get_crew_weekly_stats` / `_crew_member_week_stats`
  is the crew's own panel, pays nothing and ranks only inside a group you
  already belong to.
- **`gym_rival_user_stats` is the case for reading the installed body.**
  Written from memory it came out with a different `RETURNS TABLE` column
  order AND different names — `level, strength, age_years` against the
  real `strength, lifter_age, lifter_level` — which `CREATE OR REPLACE`
  would have pushed onto every caller. Read it with `pg_get_functiondef`;
  never retype one.

Not done, and a deliberate scope line: nothing gates the log at write
time beyond the flag, and XP granted through `increment_user_xp` is a
client-supplied (clamped) amount rather than something derived from
`workout_logs`, so it is untouched by any of this.

## A guest's email: NULL is not the only wrong value (migration 376)

`auth.users.email` is NULL for every `signInAnonymously()` account — 27 of
56 measured — while `user_profiles.email` is populated for all 56
(`guest_<uuid>@flexyn.guest`). Migration 366 fixed that for
`notifications` with one BEFORE INSERT trigger. 376 does the same for
`user_trophies`, `user_capsules` and `user_inventory`.

- **`COALESCE(auth.email(), '')` is not a fix, it is a quieter bug.** It
  satisfies a NOT NULL column with an empty string. `user_trophies` is
  read BY EMAIL on two live paths (`leaderboardStats.js`,
  `ProfileBadgeShowcase.jsx`, both falling back to the address when no
  user id is to hand), so a guest's trophies were **unfindable** rather
  than missing. 12 rows across 9 users.
- **A NULL-only guard would have been a silent no-op**, and the probe
  proves it: `WHERE user_email IS NULL` matched **0** of the 12. 366's
  trigger tests `IS NULL`; 376's tests NULL *or* `''`. If you copy that
  pattern to a fourth table, copy the newer one.
- **Fix the writers or fix the table, not both.** 376 leaves
  `grant_eligible_trophies` and `award_league_season_internal` writing
  `''` on purpose — the trigger corrects them and immunises whatever is
  written next, which is 366's reasoning applied consistently.
- **And the reason this was found late**: I reported it as a 23502 crash
  after reading migration 167, which shipped a bare `auth.email()`. It
  was a crash, until migration **293** wrapped it when guest mode landed.
  Read the INSTALLED body before reporting a bug, not just before
  editing one.

## The food catalogue — a moderation queue nothing enforced (2026-08-12)

`public.food_items` is the shared food database a barcode scan resolves
against. Migration 343 moved a barcode miss from "write straight into it" to
"file a `food_item_requests` row an admin approves". **343 changed the client
and left the table's INSERT policy alone**, so until migration 345 the door it
exists to close was open at the database:

- Executed as a real non-admin authenticated user against production:
  `INSERT INTO public.food_items (…, is_verified, source) VALUES (…, TRUE,
  'member_request')` — the exact shape `approve_food_item_request` produces —
  was **accepted**, and a third authenticated user read it by barcode. The
  owner could also flip `is_verified` FALSE→TRUE on their own row. This is the
  `equipment_models` hazard documented above as deliberately closed there.
- **Migration 345 splits the `ALL` policy**: constrained INSERT (`is_verified`
  must be false, `source` must be null or `'user_submitted'`), **no client
  UPDATE**, DELETE only while unreviewed. The approval RPC is SECURITY DEFINER
  and runs as the table owner, so it bypasses all of this and keeps writing
  both columns.

Three things worth carrying to any other table with this shape:

- **A `TO PUBLIC` policy plus a role that lacks EXECUTE on a helper is not two
  layers, it is one accident.** `food_items`' verified-read policy is
  `TO PUBLIC` and `anon` DOES hold SELECT. `anon` reads still fail — with
  `42501 permission denied for function current_user_email`, because a
  *different* `TO PUBLIC` policy on the same table calls it. Permissive
  policies are OR'd and one of them throwing takes the whole SELECT with it.
  **The trap: scoping only the owner policy to `authenticated` REMOVES the
  throwing expression from anon's evaluation and lets the verified-read
  succeed** — opening the hole while looking like the fix. Scope both, in one
  migration.
- **`is_verified` and `source` have zero readers**, in `src/` and in `pg_proc`.
  `lookupCommunity` does not filter on `is_verified`, so an approved record and
  an unreviewed one are served to a scanner identically. Filtering the
  waterfall becomes right only once approvals exist — today it would hide both
  catalogue rows from the person who contributed them.
- **A blank submission field must not become a zero on the way back out.**
  The submission form writes `parseFloat('')` → null into the `nutrition`
  jsonb, which is honest; the six flat columns carry `DEFAULT 0`, and
  `json[key] ?? flatNum(record[key])` turned that null into a hard 0. Measured:
  four nutrients on the catalogue's `White Claw Surge` row were being served to
  every scanner as manufacturer-grade zeros. `pick()` is now
  `key in json ? json[key] : flat` — an explicit null wins, and the flat column
  answers only when the jsonb does not carry the key, which is the legacy row
  the fallback was written for.

**Search does NOT search this table.** `listMineForSearch` is scoped
`created_by = <the caller>` on purpose and merges three local sources (own
`food_items`, own recipes, own diary), which is what lets it filter on every
keystroke with no network call. No user can find another user's food by name.
Full write-up: `docs/nutrition-food-database-audit.md`.

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
- ~~The `is_active` regimen column is dormant — schema is there but
  nothing reads/writes it.~~ **False as of 2026-08-12 — retracted, not
  deleted, so the shape of the mistake stays visible.** It is written by
  `toggleActive()` behind the Zap icon in `RegimensSection.jsx` (~:199,
  which optimistically enforces a single active row client-side, since no
  DB constraint does), read for the "Active" chip and the icon's own fill
  (~:326, ~:379), and read again in `routines/MyRoutineSheet.jsx:204,210`.
  **4 of 33 production rows are true.** Line numbers drift — grep
  `is_active`; the point is that it has a writer and four readers. The
  claim was correct when written; it decayed silently because
  nothing re-checks a claim in this file against the database.
  Two lessons worth more than the correction:
  - **A verdict is a measurement with a timestamp, not a fact.** The
    meal-logging audit made the same error from the other direction —
    it declared search "absent, never built" and search shipped a week
    later. Date every claim of this kind.
  - **`updated_at` on `regimens` proves nothing, and this file nearly
    inherited a second wrong claim from it.** There are **zero triggers on
    `public.regimens`** and `makeEntity().update()` sends only the caller's
    payload, so *nothing anywhere stamps `updated_at` on a regimen*. It
    equals `created_at` on 33 of 33 rows because it has no writer — NOT
    because nobody has ever edited a regimen. Do not read that column as
    an edit signal. (Measured 2026-08-12; see `docs/regimens-audit.md`.)
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

  **The cron is scheduled and WORKING as of 2026-08-10** — `cron.job` id 26,
  `weekly-reviews-generator`, `0 20 * * 0`, calling `kick_weekly_reviews()`
  (migration 332). Proven end to end, not inferred: a live run returned
  `{"ok":true,"week_start":"2026-08-03","considered":3,"generated":3,
  "skipped":0,"failed":0}`.

  **`supabase secrets set` is how Edge Function secrets get set here, and the
  CLI is already authenticated.** This is worth knowing because the obvious
  conclusion is the wrong one: there is no MCP tool for function secrets
  (deploy/get/list are all that exist), `SUPABASE_ACCESS_TOKEN` is unset and
  there is no `~/.supabase/access-token` — from which it is easy to conclude,
  wrongly, that only the dashboard can do it. `supabase login` stores its
  token in the **macOS keychain**, so `supabase projects list` works and so
  does `secrets set --project-ref ebvqxuwfiptcmlkhflfj`. Check whether the
  CLI is authenticated before declaring something dashboard-only.

  The same route gives SQL without the MCP tool: `supabase link --project-ref
  <ref> --yes` in a scratch dir (no DB password — it goes through the
  Management API), then `supabase db query --linked "<sql>"`. Chaining the
  two lets a secret move from the Vault into a function secret without ever
  being printed:

  ```bash
  S=$(supabase db query --linked "select decrypted_secret from vault.decrypted_secrets \
        where name='debrief_cron_secret'" \
      | python3 -c "import sys,json;print(json.load(sys.stdin)['rows'][0]['decrypted_secret'])")
  supabase secrets set DEBRIEF_CRON_SECRET="$S" --project-ref ebvqxuwfiptcmlkhflfj
  ```

  To verify any future change to this chain:

  ```sql
  SELECT public.kick_weekly_reviews();   -- wait ~10s
  SELECT status_code, content FROM net._http_response ORDER BY id DESC LIMIT 1;
  ```

  `200 {"ok":true,…}` is working; `401` means the Vault value and the function
  secret differ; `404` means the URL is wrong. **`net._http_response` is the
  only place this shows** — `net.http_post` queues, so the job records
  'succeeded' either way. That is the precise mechanism by which the previous
  incarnation of this job failed every Sunday for ten weeks unnoticed.

  One scheduling trap: the handler defaults to the CURRENT ISO week, so
  Sunday 20:00 generates the week that is ending. Running it on a Monday
  yields `no_active_users` for the new empty week — observed while testing.
  Do not move the schedule without passing an explicit `week_start`.

  **There is now ONE implementation of the review, and this is the thing to
  preserve.** The Edge Function used to compute the whole thing itself in
  TypeScript while the RPC computed it again in SQL, differently — whichever
  ran last won, so the cron would have overwritten a correct review with worse
  numbers. That is why it was left unscheduled rather than simply re-added.
  Migration 331 collapsed both onto one body:

  | | |
  |---|---|
  | `generate_weekly_review_for(p_user_id, p_week_start)` | the body — **edit this one** |
  | `generate_my_weekly_review(p_week_start)` | wrapper, binds `auth.uid()` |
  | `generate_my_weekly_debrief(p_week_start)` | v1 name, forwards |
  | `generateWeeklyDebriefs` (v3) | calls the RPC once per active user |

  The Edge Function contains **no arithmetic on purpose**. If a number is
  wrong it is wrong in the SQL and wrong identically on both paths; do not add
  a calculation there to fix it. And `generate_weekly_review_for` is REVOKED
  from `anon` and `authenticated` — it takes the user as a parameter and
  writes `weekly_debriefs`, so without that REVOKE any signed-in user could
  overwrite anyone else's review.

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
