# Prompt — the Crews Hub: public directory + Top board

Self-contained brief. Paste into a fresh session; it assumes no memory of the
one that wrote it.

Read [crews-hub-research.md](crews-hub-research.md) first — the research is
done, don't redo it. Re-verify any measurement you intend to quote; the
numbers in it were taken on 2026-08-08 and production moves.

> **Status: BUILT 2026-08-08.** Migration `308_crew_directory_and_top_board.sql`,
> `src/lib/data/crewDirectory.js`, `CrewTopBoard.jsx`, and the reworked
> `CrewDiscovery.jsx` / `CrewsSection.jsx` are on `main`. The Battles tab was
> dropped, per the recommendation in §5. **The SQL still has to be applied by
> hand** — until it is, both surfaces render their not-deployed empty states.
> The two open items are at the bottom under "Still to verify".

---

## Task

Build the Crews landing surface in `~/flexyn2` (Flexyn — React + Vite +
Supabase + Tailwind + Radix, mobile-only, ships to the iOS and Android
stores).

Two things that don't exist today:

1. **A public crew directory** — every crew that has opted into
   `is_public`, each row carrying its member count, its combined volume
   lifted (the sum of every member's lifetime volume), its level, trophies
   and war record, with Join on the row.
2. **A Top tab** — crews ranked against each other.

The surface is `src/components/crews/CrewsSection.jsx`, rendered from
`src/pages/Hub.jsx` when the feed sub-tab is `crews`
([Hub.jsx:434](../src/pages/Hub.jsx#L434)).

## Where it stands

Already built, do not rebuild:

- **The Crew page.** Tapping a crew opens `CrewPage.jsx` — header with crest
  over the banner seam, one text metric row, tabs Home · Roster · Chat ·
  League. Built to `docs/crew-page-research.md`. The directory row and the
  page it opens must read as the same object; copy the header's idiom, one
  step down the type scale, the way `CrewCard` in `CrewsSection.jsx` already
  does.
- **Division standings.** `CrewLeaguePanel.jsx` +
  `get_crew_division_standings` render a crew's own division table with
  promotion and relegation zones. The Top board is a *global* board and must
  not duplicate this.
- **Crew progression state.** `crews` already carries `crew_level`,
  `crew_xp`, `trophies`, `wars_won/lost/drawn` (mig 248) and
  `treasury_coins` (mig 251). `crew_season_stats` carries per-season
  `points` and `division`, readable by any authenticated user.
- **`crewLevelProgress` / `xpForCrewLevel`** in `src/lib/data/crewSeasons.js`
  mirror the server curve. Reuse them; don't re-derive.

Three things are broken or missing, verified against production:

- **`get_suggested_crews` returns zero rows for every caller, always.**
  Migration 159 redefined it against a `crews.member_count` column that has
  never existed. `member_count` binds to the `RETURNS TABLE` OUT parameter
  (NULL), so `member_count < max_capacity` is NULL and every row is filtered.
  `CrewSuggestionRail.jsx` is its only consumer and has therefore never
  rendered. Migration 090 has the correct body.
- **`CrewDiscovery.jsx` can never show a member count.** `crew_members`
  SELECT is `is_crew_member(crew_id)` — members only. `CrewResult` branches
  on `crew._memberCount`, and `searchPublicCrews` never sets it, so every row
  reads "up to 16" and the `full` / "Full" branch is unreachable.
- **Nothing aggregates volume per crew.** The ingredient is
  `user_profiles.total_volume_lbs`, which migration 173 makes RPC-only
  (a direct client UPDATE raises `42501`), so a `SUM` over it is not
  forgeable.

## Build this

### 1. Migration `308_crew_directory_and_top_board.sql`

Next free number is 308 (307 is the highest in `supabase/migrations/`) —
**re-check before you start**, a parallel session may have taken it.

Four things in one migration:

**a. `get_public_crews(p_query text, p_sort text, p_limit int, p_offset int)`**

SECURITY DEFINER, `STABLE`, raises `42501` when `auth.uid()` is NULL.
Returns one row per crew where `is_public = true`, with:

```
id, name, tag, description, avatar_url,
member_count, max_capacity,
total_volume_lbs, crew_level, trophies, wars_won, wars_lost,
is_member          -- caller already in this crew
```

- `member_count` is `COUNT(*)` over `crew_members`, **recounted, never a
  stored counter**. Habitica has spent six years on the other choice
  (research §1). Revisit only when public crews pass ~1,000.
- `total_volume_lbs` is `SUM(COALESCE(total_volume_lbs, 0))` over the
  members' `user_profiles` rows.
- `p_sort` is a **whitelist** — `'volume' | 'members' | 'level' | 'new'` —
  resolved with a `CASE`, never interpolated into the query text.
- `p_query` matches name and tag, case-insensitively. Strip `,()%*` and cap
  the length the way `searchPublicCrews` already does
  ([crews.js:606](../src/lib/data/crews.js#L606)) — that sanitising exists
  for PostgREST's `.or()` parser, but keeping the shape means one rule for
  both paths.
- `p_limit` clamped to `LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)`.
- Do **not** exclude the caller's own crew. Seeing your crew ranked among
  the others is the point; mark it with `is_member` and let the client
  style it.

**b. `get_top_crews(p_metric text, p_limit int)`**

Same gating. `p_metric` whitelisted to `'volume' | 'trophies' | 'points'`,
where `points` reads `crew_season_stats` for the active season
(`current_crew_season()`). Returns the directory columns plus a server-computed
`rank` and the metric's `value`.

Rank must be computed server-side and returned — the client must never derive
it, or a filtered list renumbers itself.

**c. Fix `get_suggested_crews`.** Restore migration 090's `COUNT`-based body
inside 159's signature, keeping the `is_public = TRUE` filter 159 correctly
added and 090 lacked. Same file — a permanently-empty rail beside a new
directory makes the new thing look broken too.

**d. Indexes and grants.** `crew_members (crew_id)` if absent;
`user_profiles (total_volume_lbs)` already exists from mig 257;
`crews_trophies_idx` already exists. `REVOKE ALL ... FROM PUBLIC` then
`GRANT EXECUTE ... TO authenticated` on both new functions — a new function
is PUBLIC-executable until you revoke it, and every public-schema function is
a PostgREST endpoint.

**Ordering is a full key.** Metric DESC, then `member_count` DESC, then `id`.
Nakama terminates every group-listing order in the id for exactly this
reason, and migration 257 already set the precedent for Flexyn's player
boards. A list ordered on the metric alone reshuffles between refetches with
nothing having happened.

**Paste-safety is mandatory** (CLAUDE.md §7). No `alias.column` tokens, no
record-field `.id` access. Use CTEs with renamed join keys and `USING()`, and
`#variable_conflict use_column` where a `RETURNS TABLE` OUT param shadows a
real column. The failure that broke `get_suggested_crews` was a
`RETURNS TABLE` OUT param shadowing a column that *didn't* exist — after you
write this, grep every bare identifier in a SELECT list against
`information_schema.columns` for the table it reads from.

### 2. Data layer — `src/lib/data/crewDirectory.js`

New module, named exports, `supabase` from `@/api/supabaseClient`. Do **not**
import `@/api/db` (it registers an auth listener at module scope and breaks
any test that stubs the client).

```js
listPublicCrews({ query, sort, limit, offset })  // → []
getTopCrews({ metric, limit })                   // → []
```

Both return `[]` on `42883` / `42P01` so the surface degrades to its empty
state during the window between the Netlify deploy and the SQL being applied,
rather than erroring the whole Crews tab. `getSuggestedCrews`
([crews.js:99](../src/lib/data/crews.js#L99)) is the pattern.

### 3. The Discover tab becomes the directory

Rework `CrewDiscovery.jsx` onto `listPublicCrews`. Per row:

- crest · name · `#tag`
- one identity line: `12 of 16 · Lvl 8`
- one metric line: combined volume, trophies, war record — text, hierarchy
  from weight and colour
- **Join on the row**, swapping by state: `Join` → `Requested` (private crew,
  mig 250 queues you) → `Full` → `Your crew` when `is_member`. Habitica's
  `publicGuildItem.vue` swaps the action by membership rather than greying
  it; a disabled button is a dead end, a swapped one is information.
- Keep the three-outcome join messaging already in the file — `requested` /
  `pending` / joined are genuinely different and each gets its own sentence.

Sort control: `Volume · Members · Level · New`. One row, segmented, four
short labels — do not wrap and do not horizontally scroll it at 375 px.

Delete the dead `_memberCount` branch. `known` has always been `false`.

### 4. The Top tab — `src/components/crews/CrewTopBoard.jsx`

Global crew leaderboard off `getTopCrews`. Metric switch:
`Volume · Trophies · Points`.

Reuse the shape the player leaderboard settled on
(`docs/gamification-ui-research.md` §2, already shipped in
`LeaderboardsContent.jsx`): **top 3 · `…` · your crew and its neighbours**,
with server rank and compact values. Your own crew's row is highlighted the
way `StandingRow` in `CrewLeaguePanel.jsx` does it — `bg-primary/[0.07]`, no
extra border.

If the user is in no crew, the board still renders; the "your neighbours"
window collapses to just the top, and the footer says how to join one.

### 5. Tabs

`CrewsSection.jsx` currently has three: `My Crews · Discover · Battles`. Top
makes four, which is tight at 375 px with the current icon + label pills.

**Recommendation: drop the Battles tab and ship `My Crew · Discover · Top`.**
Battles is per-crew, and both halves already live on the Crew page —
`CrewBattleEntry` on Home, `CrewLeaguePanel` on League. The tab is a second
route to surfaces the user reaches by tapping their crew.

This is a product call, not a mechanical one. If Kegan wants Battles kept,
ship four tabs with labels only (no icons) and verify the row at 375 px
before pushing.

---

## The competitive-app style rules

This app is a competitive product before it is a fitness product. Crews are
the social ladder. These are the rules that make a ranked surface feel like
one, drawn from what the references do and from what this repo has already
learned the hard way. Treat them as constraints, not suggestions.

**1. A rank is a number, and the server owns it.** Position in a list is not
a rank. Return `rank` from the RPC. A client that derives rank from array
index renumbers itself the moment anything is filtered, and it is forgeable
the moment anything is ranked on a column the client can write.

**2. A board ranked on a forgeable column is not a board.** Every metric here
has to be server-authoritative. `total_volume_lbs`, `trophies` and
`crew_season_stats.points` all are — migrations 173, 248 and 248
respectively. If you reach for a fourth metric, prove it is locked before you
rank on it. Migration 248's own header says why: `authenticated` legitimately
holds UPDATE on `crews` for the rename path, so every trust-bearing column
there is guarded by a trigger rather than by the policy.

**3. Ties break deterministically or the ladder is noise.** Full ordering key,
terminating in `id`. Two crews on equal volume must not swap places on a
refetch.

**4. Every number needs something to compare against.** CLAUDE.md's rule is
"data must be earned" — a bare figure in a box is decoration. `2.4M lbs`
means nothing; `2.4M lbs · 4th of 12` means something. Rank, division,
capacity, a delta since last week — one of those has to ride with the number.

**5. The action is on the row.** Join, Request, Full, Your crew. Swapping the
control by state is information; disabling it is a dead end. This is the one
place Habitica is unambiguously ahead of us.

**6. Abbreviate.** `fmt(n, { notation: 'compact', maximumFractionDigits: 1 })`
via `useNumberFormatter` from `@/lib/intl` — no new helper needed. A volume
row that prints `2,417,650 lbs` next to a name and a rank overflows at 375 px.

**7. Show the loser's path, not just the winner's crown.** The windowed board
exists so a crew in 40th place can see who is 12th ahead of them. A top-100
list that a crew doesn't appear in can only ever tell them "not ranked",
which is the one message that makes people stop opening a leaderboard.

**8. Losing must not subtract.** Migration 248 made this call explicitly and
it holds for anything you add: a crew that trained all week and lost by 400
XP should not watch its number go backwards. Decline is expressed through
relative position — relegation, being passed — never by punishing the act of
exercising.

**9. Design the zero state first, because it is the launch state.** Measured
2026-08-08: **0 public crews, 1 user with any volume at all, 4,995 lbs across
the entire app, 0 crew wars ever run.** A directory sorted by combined volume
ships as a list of zeros, if it isn't empty outright. So:

- The Discover empty state is not "No public crews found" — that is a dead
  end at a moment when it is *always* true. It should name what a crew is and
  offer the two things that fix it: create one, or make yours public.
- Every crew's volume will be `0 lbs`. Render that as `—` or "no volume
  logged yet", never as a proud zero, and default the Top board's metric to
  one that isn't universally zero.
- Both surfaces need a real screenshot against real data before they ship. A
  ladder that looks good with seeded numbers and empty in production is the
  failure mode here.

**10. No new chrome.** Everything in CLAUDE.md's "UI composition" section
applies and is not negotiable: four type sizes with an 11 px floor, two
spacing registers (`gap-1`/`gap-2` and `gap-6`, nothing between), one
dominant element per screen, hairlines instead of bordered cards for
read-only rows, radius from `sm`/`lg`/`2xl`/`full` only, four hues, no
gradient as decoration, no glassmorphism, no coloured shadows. The Crews area
was already measured at 102 border utilities, 38 rounded containers, 16
uppercase micro-labels and 8+ type sizes across six files
(`crew-page-research.md`) — do not add to that count. Habitica's directory row
is a name, a summary, a count and a button.

**11. `mix-blend-mode` does not survive iOS Safari.** If a rank badge or a
podium tempts you into a blend mode, it will render as a warm box with a hard
edge on a real iPhone. This app ships to phones only.

---

## Constraints

From `CLAUDE.md` — read it, these are not optional:

- **The client never computes XP, coins, ranks or achievements.** Server is
  authoritative and enforced in the database.
- **Read the installed artefact, not the migration that created it.**
  `pg_get_functiondef()` is the source of truth. This whole brief exists
  partly because a migration lied about a live function.
- **Every `CREATE POLICY` guarded with `DROP POLICY IF EXISTS`.** Same for
  triggers.
- **Run `get_advisors` after adding any SECURITY DEFINER function.**
- **`tFallback(key, 'English')` at every call site.** Never `t(key) ||
  'English'` — `getTranslation` returns the key on a total miss, which is
  truthy, so `||` never reaches the fallback. New keys go in a part file with
  English at minimum.
- **Logical properties** — `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/
  `text-start`, never `ml-`/`pl-`/`left-`. Arabic ships RTL.
- **`npm run lint` clean and `npm run build` green before any push.** The
  build guard turns `MISSING_EXPORT` / `UNRESOLVED_IMPORT` into failures —
  don't disable it, fix the import.
- **Declare `const`/`let` before first use**, including inside a `useEffect`
  deps array.
- **Direct push to main** on this repo (Kegan's convention): push the feature
  branch first, then fast-forward `main`. Fetch and rebase before any
  non-trivial edit — a second Claude session edits this tree concurrently.

## Still to verify

Both survived the build and neither could be closed from this session:

1. **The installed SELECT policy on `crews`** — see layer 2 below. Every
   `pg_policies` read was refused by the tool sandbox, so whether
   `crews_select_merged` is `TO public` (exposing public crew rows to `anon`)
   is still unknown.
2. **A screenshot of both tabs at 375 px.** Hub wraps its sub-tabs in an
   `AnimatePresence mode="wait"`, and with the browser pane hidden `rAF` is
   throttled so the exit animation never completes and the entering tab never
   mounts — `document.visibilityState` reads `hidden`. That is a harness
   artefact, not an app defect (the same click works when the pane is
   visible), but it means the surfaces were proved by render tests
   (`CrewTopBoard.test.jsx`, `CrewDiscovery.test.jsx`) rather than by eye.
   Look at them on a phone before calling this done.

## Verify

Three layers, and the top one is the only one that proves RLS:

1. **SQL as `authenticated`.** MCP and the SQL editor run as `postgres` and
   bypass RLS entirely, so a query that looks fine there proves nothing.
   ```
   BEGIN;
   SET LOCAL role authenticated;
   SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
   -- …
   ROLLBACK;
   ```
   Prove specifically: a private crew never appears in `get_public_crews`; a
   caller in no crew gets rows; `anon` gets `42501` from both new functions.

2. **Confirm the installed policy on `crews`.** I could not read it —
   every `pg_policies` query in the research session was refused by the tool
   sandbox. `crews_select_merged` was generated by migration 217 from
   whatever was installed then, OR-combining 048's `is_crew_member(id)` with
   065's `is_public = true OR created_by = auth.uid() OR EXISTS(member)`.
   065's policy carried **no `TO` clause**, which means PUBLIC. Check whether
   the merged policy is `TO public`; if it is, public crew rows are readable
   by `anon` — the same shape migration 303 closed on the hub feed — and it
   should be scoped with `ALTER POLICY … TO authenticated` (which changes
   roles without restating the expression, and this expression is exactly the
   `alias.column` shape the paste pipeline mangles).

3. **A node probe** with the anon key from `.env.local` plus
   `signInAnonymously()`, invoking both RPCs through the real HTTP API.
   Clean up whatever it writes.

Then screenshot the Discover and Top tabs at **375 px** in the browser pane —
against real production data, zeros and all — and check the sort/metric row
doesn't wrap.

Tests: `src/lib/data/__tests__/crewDirectory.test.js` following the
chainable-mock shape in `crewSeasons.test.js` / `crewsLeaveJoin.test.js`, and
a component test for the row's four action states.

## Deliver

Push the branch, fast-forward `main`, then — per Kegan's standing instruction
— **paste migration 308 inline in chat inside a ```sql fence** so it has a
one-tap copy button. He is on mobile and cannot open files. If it is long,
split it across several ```sql blocks in the same reply and give the run
order. A file path is never an acceptable substitute.
