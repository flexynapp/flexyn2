# Prompt — Trophies surface audit

Self-contained brief. Paste into a fresh session; assumes no memory of the
one that wrote it. Written 2026-08-12 against `origin/main` @ `4ff63aa7`.

Companion to [docs/achievements-audit-prompt.md](achievements-audit-prompt.md)
and its result, [docs/achievements-audit.md](achievements-audit.md). **Read the
result first** — it measured the catalog, the production trophy rows and the
count on four surfaces, and one of its findings lands squarely inside this
one's scope. Re-deriving that is wasted time; contradicting it without saying
so is worse.

---

## Task

Audit **four named sub-features of the Trophies surface** in `~/flexyn2`
(Flexyn — React + Vite + Supabase, mobile-only, ships to the iOS/Android
stores):

| # | Sub-feature | The user-facing claim being tested |
|---|---|---|
| 1 | **Trophy case** | "Pick five trophies to display; slot 1 is your primary." |
| 2 | **Collection** | "Here is everything you've earned, out of everything there is." |
| 3 | **Sort by rarity** | "You can order the collection by how rare a trophy is." |
| 4 | **Filter locked / unlocked** | "You can narrow the collection to what you have, or what you don't." |

The goal is release readiness. For each sub-feature, decide which of these
it is, and prove it:

- **(a) exists and works** — renders, is reachable, and is correct
- **(b) exists and is wrong** — renders, but shows a wrong number, a wrong
  set, or a control that does not do what its label says
- **(c) partially wired** — the code exists but nothing reaches it, or it
  reaches only some of the surfaces that need it
- **(d) absent** — no implementation anywhere in `src/`

**This is an audit, not a redesign.** A one-defect / few-line fix with an
obvious blast radius may be applied; say explicitly which ones you took and
which you only wrote up. Everything else is a finding with a recommendation.

## Where the surface actually lives — read this before grepping

Trophies is **not a page and not a route.** It is the third tab on the Hub
profile, and its host file is 2,400 lines long. Take this as given and confirm
it in one command rather than discovering it:

```
src/components/hub/profile/ProfileTrophies.jsx   the entire tab UI (186 lines)
src/components/hub/HubProfile.jsx                the host — data, handlers, the picker
  :254    TROPHY_LABELS            emoji → English noun, ~120 entries
  :861    handleTrophySlotSet      writes user_profiles.trophy_case
  :881    handleTrophyVisibility   writes user_profiles.trophy_case_visible
  :893    handleSetSignature       writes user_profiles.signature_trophy
  :1199   trophyCase / trophyVisible read (self vs. foreign profile differ)
  :1221   earnedTrophies query  →  listEarned()
  :1348   primaryTrophy → the banner crest
  :1977   signature-trophy picker, inside the edit panel
  :2098   the tab itself; its count is earnedTrophies.length
  :2328+  "Choose Trophy" bottom sheet — a hardcoded ~120-emoji grid
src/lib/trophyDefinitions.js    TROPHIES, TROPHY_TIERS, TROPHY_CATEGORIES, getTrophy()
src/lib/data/trophies.js        listEarned() — ORDER BY earned_at DESC
src/components/loot/CollectionModal.jsx   the in-repo precedent for #3 and #4
supabase/migrations 167, 323, 324         user_trophies + the grant / progress RPCs
```

```
grep -rn "ProfileTrophies\|trophy_case\|signature_trophy" src/
```

Line numbers drift — the file is edited by a second session. Grep the symbol.

### The thing that decides this whole audit

**Two different objects are both called "a trophy" on this one screen, and
nothing connects them.**

| | Trophy case (top) | Collection (below) |
|---|---|---|
| What it holds | an emoji you picked | a `user_trophies` row |
| Where it comes from | a hardcoded list in `HubProfile.jsx` | `grant_eligible_trophies()`, SECURITY DEFINER |
| Where it is stored | `user_profiles.trophy_case` jsonb | `public.user_trophies` |
| What earns it | nothing | meeting a criterion |
| Catalog membership | none — 🎰 and 🃏 are options | `TROPHIES` (120 named rungs) |

Establish this before you write a word about either. Every sub-feature below
reads differently depending on which of the two the claim is about, and a
finding that mixes them up will be wrong in a way that reads as plausible.

## Method

Four stages. Each one's output is the next one's input.

### Stage 0 — Inventory before opinion

Two tables before forming a view on anything.

**Table A — every surface that renders a trophy.** The case emoji leaks onto
several; the earned rows onto others:

```
grep -rn "trophy_case\|signature_trophy\|primaryTrophy\|user_trophies\|listEarned" src/
```

For each hit: file, which of the two objects it renders, and whether it
gates on `trophy_case_visible`.

**Table B — the catalog's shape as this surface uses it.** `TROPHIES.length`,
the five `TROPHY_TIERS` and how many rungs sit on each, how many distinct
tiers a real production account actually holds. Tier is the only rarity-like
axis a trophy has — **there is no `rarity` field on a trophy**; that word
belongs to the loot catalog. Say so once, then use "tier".

### Stage 1 — Establish ground truth in production, read-only

Supabase project `ebvqxuwfiptcmlkhflfj`. Everything you claim about live
behaviour is checked here, not inferred. At minimum:

```sql
SELECT count(*) AS rows, count(DISTINCT user_id) AS users FROM public.user_trophies;
SELECT count(*) AS profiles,
       count(*) FILTER (WHERE jsonb_typeof(trophy_case) = 'array')      AS has_array,
       count(*) FILTER (WHERE trophy_case::text ILIKE '%"value"%')      AS has_any_pick,
       count(*) FILTER (WHERE signature_trophy IS NOT NULL)             AS has_signature,
       count(*) FILTER (WHERE trophy_case_visible IS FALSE)             AS hidden
FROM public.user_profiles;
```

**Three traps that have already caught sessions on this repo:**

- **Production carries seeded test rows** written by parallel sessions.
  Check `created_at` before reading a count as organic.
- **MCP and the SQL editor run as `postgres` and bypass RLS entirely.** Any
  claim about what a *viewer* can see must be executed as one:
  `BEGIN; SET LOCAL role authenticated; SET LOCAL request.jwt.claims =
  '{"sub":"<uuid>","role":"authenticated"}'; … ROLLBACK;` — and assert the
  probe identity is who you think it is, because a wrong `sub` looks exactly
  like an RLS leak.
- **A denormalised column can be NULL on every row.** `count(col)` against
  `count(*)` before trusting one, and `FILTER (WHERE col > 0)` on top of that
  — non-null is not non-zero, and this repo has been bitten by the gap twice.

Then check the *installed* artefacts, not the migration files:
`pg_get_functiondef('public.grant_eligible_trophies'::regproc)`, and the
`public_profiles` view definition — `trophy_case` is one of the columns its
`full_view` predicate gates, so what a stranger sees is decided there and not
in any component.

### Stage 2 — Exercise, don't infer

jsdom paints nothing, so a green test is not evidence that a layout is right;
a Vite stub-alias render harness found two visible defects behind 4,117
passing tests on this repo. Render this surface at 390×844, dark, in these
states, and measure rather than reason:

- **zero earned trophies, empty case** — the first-run screen
- **one earned trophy**
- **a real production account's row set** (21 is the live maximum; use it)
- **all five case slots filled**, viewed as **self** and as a **stranger**
- **`trophy_case_visible = false`**, viewed as a stranger
- a set containing a **generated tail id** (`sessions_x2`) and a **league
  season trophy** — both resolve through `getTrophy()` rather than
  `TROPHY_BY_ID`, and both are deliberately outside `TROPHIES`

Two mechanical notes that will otherwise cost you an hour: the browser pane
pauses `requestAnimationFrame` while hidden, so verify framer-driven state
with the `computer` tool and not `javascript_tool`; and `npx vitest` in a
fresh worktree runs with **zero translations** — run
`node scripts/split-i18n.mjs` first, or an i18n assertion passes for the
wrong reason.

### Stage 3 — Rank and report

One section per sub-feature — claim / proof / what-failure-looks-like — then
one severity-ranked findings table across all four. Each finding: what is
wrong, the concrete failure (inputs → the wrong thing a user sees), the
`file:line` evidence, and the fix with its blast radius. Separate **defects**
(provably wrong) from **product calls** (pacing, taxonomy, what belongs on
the surface) — do not decide the second kind unilaterally.

---

## Sub-feature 1 — Trophy case

Five slots at the top of the tab (`ProfileTrophies.jsx:57-133`), each opening
the "Choose Trophy" sheet at `HubProfile.jsx:2328`.

1. **What can actually go in a slot?** Read the emoji array in that sheet
   before assuming. If a user can pin 🎰, 🃏 or 🪗 having earned nothing,
   then a "trophy case" on a fitness app is a sticker board, and every other
   surface that renders slot 1 — the banner crest, the signature pin beside
   the username in the feed — is showing an unearned decoration in a place
   that reads as an achievement. **Decide whether that is the product or a
   defect, and say which**; it is a genuine product call, and it is the
   single most consequential question on this surface.
2. **Does the case agree with the collection?** They sit 24px apart. Check
   whether anything cross-references them at all.
3. **Slot 1's three markers.** Amber ring, pin badge, "Primary" caption
   (`:98-103`, `:114-118`). Confirm all three render, and that
   `primaryTrophy` reaches the banner (`HubProfile.jsx:1348`) — and what the
   banner does when `trophy_case_visible` is false.
4. **The write path.** `handleTrophySlotSet` calls `me.update()` then
   `checkUserAuth()`; the comment at `:867` explains why the invalidate alone
   was not enough. Verify the fix still holds — pick a slot, confirm the row,
   the banner and the signature list all move without a reload. Note that
   `trophy_case` is NOT on migration 142's immutable list, so this is a
   legitimate direct client write; confirm that against the installed policy
   rather than assuming either way.
5. **Failure and empty states.** The catch raises `toast.error('Could not
   update trophy case')` — an English literal, and the only feedback. What
   does a stranger see on a profile with an empty case? (`showCase` at `:53`
   answers this; check the answer is the one you'd want.)
6. **a11y and i18n.** Slot `aria-label`s are composed from `tFallback` keys;
   the sheet's own chrome — "Choose Trophy", "Remove", "Signature trophy",
   "Tap the active one to remove it." — is hardcoded English. Count them.
   **Do not machine-translate** — that is a standing rule here.

## Sub-feature 2 — Collection

The earned grid plus its locked frames (`ProfileTrophies.jsx:135-183`),
headed `{earnedIds.size} / {TROPHIES.length}`.

1. **The count is already a known defect — establish its CURRENT state, do
   not re-report it as new.** `docs/achievements-audit.md` finding **D1**:
   this header uses the achievements vault's denominator with an unfiltered
   numerator, so an account holding 21 rows reads `21 / 120` here and
   `20 / 120 +1` in the vault, and the vault is the careful one (it excludes
   `isTail`, `season` and `isXpMilestone` because a numerator that can exceed
   its denominator reads as a broken counter). Check whether the one-line fix
   landed. If it did, say so and move on. If it did not, it belongs in this
   audit's table as an inherited finding with its origin named.
2. **Is this the same set the Progress-side surface shows?** The achievements
   vault (`src/components/progress/AchievementsTab.jsx`, hosted by
   `AchievementsVault`) renders the same underlying rows through a different
   component. Two renderings of one set is the classic drift bug here.
   Compare: the same account, both surfaces, same session — same members,
   same order, same total? Any row this grid drops silently (`getTrophy(id)`
   falsy → `return null` at `:152`) is dropped from the count's numerator
   too, which is a different kind of wrong from a miscount.
3. **The locked frames.** `MAX_LOCKED_FRAMES = 10` (`:48`) caps them, and
   each is `aria-hidden` with a 🔒 at 25% opacity. So a user with 21 of 120
   sees ten padlocks, not 99. Decide whether ten is a *shape* or a *lie* —
   the comment at `:42-47` argues the case for the cap and it is a good
   argument; the question is whether the header's `21 / 120` is doing enough
   work beside it.
4. **`grid-cols-5` on a data-driven count.** `CLAUDE.md`'s UI rule: a
   collection whose item count comes from data uses `tileRow()` from
   `src/lib/tileRows.js`, never `grid-cols-N`, because a grid packs a partial
   last row into its leading columns. Both this grid's halves are
   data-driven. Confirm the defect by rendering a count that is not a
   multiple of five, and check `col-span-*` is absent before recommending the
   conversion.
5. **Empty state.** `:140-147` covers zero earned, with different copy for
   self and stranger. Does it read right on a brand-new account, next to a
   header that says `0 / 120`?
6. **A trophy's identity in the grid.** Emoji + a 2px tier stripe + a `title`
   attribute + an `sr-only` name. `title` does not open on touch. So on the
   device this app ships to, a trophy is an emoji and a coloured line —
   nothing names it. Weigh that against the deliberate removal of the 7px
   tier caption documented at `:10-13`; the caption was correctly removed and
   that does not mean nothing should replace it.

## Sub-feature 3 — Sort by rarity

**Start from the null hypothesis that this control does not exist.**
`listEarned()` orders `earned_at DESC` and `ProfileTrophies` maps that array
straight out. Prove or refute in one grep before writing anything else.

1. Is there **any** ordering control on this surface — a select, a segmented
   control, a long-press, anything? Grep the retired generation too.
2. If absent: **what would it sort on?** There is no rarity field. The
   candidates are `TROPHY_TIERS[trophy.tier].order` (bronze → legendary, a
   five-step ramp the stripe already colours), `TROPHY_CATEGORIES` order, or
   scarcity derived from `user_trophies` — **how many users hold this
   trophy**, which is the only measure of rarity that is actually true, and
   which nothing computes today. Say what each would cost and which one the
   word "rarity" should mean here.
3. **Is it worth building?** A grid of 21 tiles, five per row, is four rows.
   Sorting four rows is not obviously a feature. Give a recommendation with
   the number: median and maximum earned-trophy count in production, and the
   count at which an ordering control starts earning its place. Recommending
   **against** building it is a valid, useful outcome.
4. If recommended, name the constraints it must respect: `tileRow()` over
   `grid-cols-N`, the two spacing registers, no gradient, no glassmorphism,
   no coloured shadow, radius from the four-value scale. And look at
   `src/components/loot/CollectionModal.jsx` first — it already groups a
   collection by rarity tier and has been through a redesign pass; a second,
   different treatment of the same idea is worse than either.

## Sub-feature 4 — Filter locked / unlocked

Also start from the null hypothesis. The grid renders earned tiles then
locked frames, unconditionally, with no state between them.

1. Is there **any** filter control? The only state `ProfileTrophies` holds is
   none — it is a pure function of props. Confirm that.
2. **Note what the locked frames are not.** They are `aria-hidden`,
   identical, capped at ten, and carry no identity — so "show me what's
   locked" is not answerable on this surface even in principle today. That is
   a different finding from "there is no filter button".
3. **The precedent already exists in-repo**, and this is the whole point of
   the sub-feature: `CollectionModal.jsx` ships All / Owned / **Missing** over
   113 items, plus a search box, and its head comment explains why the
   Missing filter is the one that matters — *"the chase list, which is the
   whole point and was previously unreachable"*. If the same argument holds
   for trophies, say so and reuse the pattern. If it does not — because the
   locked half here is 99 items the user cannot browse, only complete — say
   that instead, and note where the user IS meant to go for that view (the
   achievements vault's "In progress" tab). **Two surfaces answering the same
   question differently is a finding in itself.**
4. If recommended, the same UI constraints as #3 apply, plus: a filter that
   can empty the grid needs its own zero case, distinct from the
   no-trophies-yet empty state.

---

## Constraints — from `CLAUDE.md`, read it first

- **The client never computes XP, coins, or achievements.** Trophies are
  granted by `grant_eligible_trophies()` SECURITY DEFINER against
  `auth.uid()`. Migration 189 removed a client INSERT policy precisely
  because it allowed badge forgery. Nothing proposed here may reintroduce a
  client-side grant — note that this is exactly why the *case* is a free
  emoji picker and the *collection* is not, and weigh that when you write
  finding 1.
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
- The tree is shared with a second Claude session and the local checkout runs
  behind. **Work in a `git worktree` branched off `origin/main`, and never
  `git stash`** — the other session stages the whole tree.

## Done means

A written audit at `docs/trophies-audit.md`: the two inventory tables, a
verdict (a/b/c/d) per sub-feature with claim / proof / what-failure-looks-like,
production ground truth with the date it was measured, and one severity-ranked
findings table separating defects from product calls.

Then **one PNG per sub-feature**, matching the achievements set: dark
`#0d0d0f` ground, mono eyebrow reading `NN / 04 · TROPHIES AUDIT`, the claim
as the headline, a verdict chip, a two-column hypothesis / verified split, a
numbered "what the audit established" list, and a four-cell footer (migration ·
tests · i18n · visible change). 1098px wide. They are the artefact Kegan
actually reads — the markdown is the working record behind them.

**A clean sub-feature is a valid result.** Say so plainly and show the
evidence rather than manufacturing a finding to justify the pass.
