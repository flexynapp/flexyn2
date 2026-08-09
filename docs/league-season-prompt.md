# PROMPT — League seasons, promotion, demotion, activity gating, rewards

> Self-directed execution prompt. Written 2026-08-08 against production
> (`ebvqxuwfiptcmlkhflfj`) and the working tree at that date. Every claim in
> "What is actually broken" was verified by query or by reading the installed
> function body — not inferred from migration files. Re-verify before building;
> a parallel session may have moved things.

---

## The ask

> "We need to create league rewards and finish out the league system in general.
> Currently I think it has no direction. I see a Bronze league, however the
> season end date comes and goes, no promotion occurs, neither are there rate
> limits — as in, if a user gets positioned into a league and they're AFK all
> season they should not be promoted unless they logged at least one workout
> during the season."

Three separate problems in that sentence, and they need to be fixed in this
order, because the later ones are invisible until the earlier ones work:

1. **The rollover never runs.** Nothing resolves a weekly bracket. Ever.
2. **The ranking has no activity floor.** When rollover *does* run, a Bronze
   bracket of ≤10 people promotes all of them, at 0 XP.
3. **There is no season and no reward worth having.** Coins and a capsule for
   the top few, nothing for anyone else, no identity, no trophy, no ceremony.

---

## What is actually broken — verified, not guessed

### 1. No weekly bracket has ever resolved. Not once, in three months.

```
leagues_total            8
leagues_resolved         0
leagues_past_unresolved  7      -- week_end < today, still is_resolved = false
members_total           35
members_ranked           0      -- rank IS NOT NULL: zero rows, ever
members_zero_xp         32
first_week      2026-05-04
last_week       2026-08-03
```

Every one of the 8 brackets is `bronze`. Nobody has ever been promoted,
demoted, or paid, because `league_members.rank` has never been written.

**The cause is a dead code path**, and it is a clean one to point at.
[`getMyLeague`](../src/lib/data/leagues.js:258) is the only thing in the app
that triggers resolution:

```js
const ctx = await ensureCurrentLeague(user);              // → ensure_my_league()
const weekEnd = new Date(ctx.league.week_end + 'T23:59:59');
if (!ctx.league.is_resolved && weekEnd < new Date()) {    // ← never true
  await _resolveLeague(ctx.league.id);
}
```

Migration 242 moved find-or-create into `ensure_my_league()`, which computes
`v_week_start := date_trunc('week', CURRENT_DATE)` and **always returns a
bracket for the current week**. A current-week bracket's `week_end` is this
coming Sunday, so `weekEnd < new Date()` cannot be true. The branch has been
unreachable since 242 landed. `_resolveLeague`, `claim_league_resolution`
(mig 027) and `distribute_league_rewards` (mig 067) are all correct, tested,
idempotent code that nothing calls.

**And there is no cron to call it either.** Live `cron.job` has 18 active jobs.
The only league-related one is `monthly-league-resolve` (jobid 8, `5 0 1 * *`),
and its whole body is:

```sql
UPDATE public.monthly_leagues SET is_resolved = true
 WHERE is_resolved = false AND month_end < CURRENT_DATE;
```

It flips the flag and distributes nothing — no ranking, no tier change, no
payout. It is worse than absent: it burns the `is_resolved = false` state that
a future distributor would key off, so any month it touches is unrecoverable.

Contrast with what the codebase already does correctly elsewhere:
`gym-rival-settle` (`5 0 * * 1`), `resolve-crew-wars` (`*/15 * * * *`),
`roll-crew-seasons` (`20 3 * * *`). The pattern exists. Leagues just never got
one.

> **Corollary for the fix:** both `claim_league_resolution` and
> `distribute_league_rewards` open with `IF auth.uid() IS NULL THEN RAISE`.
> pg_cron has no `auth.uid()`. You cannot simply schedule the existing
> functions — see Phase 2.

### 2. AFK users would be promoted, exactly as suspected

[`leagueTiers.js`](../src/lib/leagueTiers.js:13) and the mirrored VALUES table
in [mig 067](../supabase/migrations/067_league_rewards_atomic.sql) both say
Bronze is `promote: 10, demote: 0`, with `MAX_LEAGUE_SIZE = 30`.

`distribute_league_rewards` ranks by `weekly_xp DESC NULLS LAST, joined_at ASC`
and promotes `rank <= 10` **with no reference to activity of any kind**. So:

- A Bronze bracket with ≤10 members promotes *every member*, including everyone
  on 0 XP. Live brackets have held 1, 2, 4, 4, 5, 6 and 11 members.
- Even a full 30-person bracket promotes 0-XP users whenever fewer than 10
  people logged anything — which is every bracket in production. The current
  week has 6 members and **1** with XP above zero.
- Five weeks of that and an account that has never opened the app is in Legend.

There is no `min_xp`, no workout check, no `is_active` concept anywhere in the
league path. Nothing to tune — it has to be added.

### 3. Weekly XP is client-asserted; monthly XP is server-derived

This is the "rate limits" half of the ask, and the answer is subtler than
"there aren't any."

`increment_league_xp` **is** clamped (verified against the installed body,
post-mig 197):

```sql
v_call_cap CONSTANT integer := 2000;
v_week_cap CONSTANT integer := 150000;
...
UPDATE public.league_members
   SET weekly_xp = LEAST(v_week_cap, COALESCE(weekly_xp,0) + LEAST(p_amount, 2000))
 WHERE id = p_league_member_id AND user_id = v_uid;
```

So it is bounded and correctly scoped to the caller. **But `p_amount` still
comes from the client**, and `weekly_xp` is an independent counter rather than a
projection of anything real. A signed-in user can POST
`/rest/v1/rpc/increment_league_xp` in a loop and reach 150,000 weekly XP without
completing a single set. That is 75 calls.

Migration 297 already solved this shape for the monthly board:
`sync_my_monthly_league()` takes **no amount** and derives the standing from
`SUM(xp_grant_log.amount)` for the month, which is why its head comment says
"there is no number here for a client to inflate." The weekly board never got
the same treatment. It should — and the same rewrite is what makes the activity
gate trustworthy, because both then read from the same ledger.

`xp_grant_log` is `(id, user_id, amount, granted_at)`. Activity sources are
`workout_logs (user_id, date, created_at)` and `cardio_logs`.

### 4. Brackets are fragmented by the join rule

`ensure_my_league()` picks the open bracket with `ORDER BY created_at DESC` —
the *newest*. At Flexyn's current scale that scatters a handful of users across
several near-empty brackets instead of concentrating them into one that feels
like a competition. Six members this week; the ceiling is 30.

### 5. There is no season, and no reward with identity attached

- No season number, no season name, no season dates for individual leagues.
  `src/lib/i18n-leagues.js` (305 lines) contains **zero** occurrences of
  "season". The only thing the UI counts down is `week_end`, rendered as
  "6d Left" on [`LeagueCard`](../src/components/dashboard/LeagueCard.jsx:222).
  Crews *do* have seasons (`crew_seasons`, mig 248, 28-day, numbered,
  `roll_crew_seasons()` on cron). Individual leagues have nothing equivalent.
- Rewards are coins + an optional capsule, for the promote zone only. A
  mid-table finisher gets `coins: 0, capsule: null` and a suppressed
  notification. That is ~90% of a full bracket receiving literally nothing.
- Legend is `promote: 0` — a dead end. You arrive and then there is no game.
- Nothing persistent is ever awarded. No title, no trophy, no profile mark.

**Primitives that already exist and are unused by leagues:**

| Primitive | Where | Note |
|---|---|---|
| `user_trophies (user_id, trophy_id, earned_at)` | mig 167 | UNIQUE(user_id, trophy_id), read-all RLS, grant RPC pattern |
| `user_profiles.signature_trophy` | mig 151 | user pins one trophy to their profile |
| `equipped_title_id` / `equipped_frame_id` | mig 019 | rendered in HubPostCard, HubProfile, leaderboard rows |
| `LOOT_TITLES` (19 titles, 5 rarities) | `src/lib/lootTitles.js` | capsule-drop catalog; no earned-title path |
| `notify_league_resolution_for` | mig 040 | 15-language league notification, already wired |
| capsules `standard` / `premium` / `elite` | — | already granted by 067 |

A season reward system does not need new cosmetics infrastructure. It needs to
*use* this.

---

## Research — how other apps solve each piece

Sourced 2026-08-08. Take the shapes, not the numbers; Flexyn's user base is two
orders of magnitude smaller than any of these and several rules invert at small
N.

### Duolingo — the closest analogue (weekly XP cohorts)

- **10 divisions**, weekly Monday→Monday, ~30 users per bracket.
- **Promotion is proportional and tightens as you climb**: Bronze promotes
  roughly the top two-thirds, Gold the top third, Sapphire ~23%, Obsidian ~17%,
  Diamond nobody. Flexyn uses *absolute counts* (10/10/7/5/3/0), which is what
  makes a 6-person Bronze bracket promote everyone. **Proportions degrade
  gracefully at small N; absolute counts do not.**
- **Bottom five demote** in every division above the floor.
- **Demotion protection is purchasable** — spend 2,000 XP to hold rank. A
  designed-in second chance, and a currency sink.
- **Diamond is terminal but not pointless**: four consecutive Diamond
  promotions qualify you for a monthly **Diamond Tournament**, and winning it
  pays *no currency at all* — only medals shown on your profile. Worth
  underlining, since it is the direct answer to "what reward does the top tier
  get": at the top of a ladder, **status is the reward**.

Sources: [Duolingo Leagues explained](https://happilyevertravels.com/duolingo-leagues-explained/) ·
[Divisions & the Diamond Tournament](https://www.spliiit.com/en/blog/divisions-duolingo-explication) ·
[Deconstructor of Fun: Leagues](https://duolingo.deconstructoroffun.com/mechanics/leagues) ·
[What happens if you win the Diamond Tournament](https://duolingoguides.com/what-happens-if-you-win-the-diamond-tournament-duolingo/)

### Clash of Clans — the inactivity model, and it is the one to copy

Ranked play demotes for *inactivity* rather than for losing, and it is
deliberately slow: **no demotion for the first 4 weeks of inactivity, then one
rank per additional 4 weeks, down to a floor.** The decay is a ratchet with a
grace period, not a cliff.

For a fitness app this matters more than it does for a game. A user who takes a
rest week, gets ill, or travels is not a cheater, and punishing week one of
absence is the fastest way to make someone not come back. Grace first, decay
after.

Source: [Ranked mode: leagues, floors, demotion](https://boostroom.com/blog/clash-of-clans-ranked-mode-explained-leagues-floors-demotion)

### Rocket League — season identity and reward tiers

- Seasons are numbered and named, and **season rewards are determined by the
  rank you reached**, not your final-day position.
- Rewards are **titles and banners** — cosmetic, permanent, visible to others.
  Grand Champion titles render red, Super Sonic Legend white. The colour *is*
  the flex.
- **You must actually play to collect**: ten placement matches to get a rank,
  then a reward level requiring ten wins at that rank. Reaching a rank is not
  enough — participation is a separate, explicit gate. This is the mechanic
  Kegan is describing, already solved.

Sources: [Season Rewards](https://www.epicgames.com/help/en-US/c-202300000001622/c-202300000001682/what-are-season-rewards-in-rocket-league-a202300000017950) ·
[Titles](https://www.epicgames.com/help/c-202300000001622/c-202300000001682/what-are-rocket-league-titles-and-how-do-i-get-them-a202300000013269)

### Zwift — the fitness-specific warning

Zwift replaced its A–D categories with a 0–1000 **Racing Score** seeded from the
rider's own recent power data, precisely because self-selected/static categories
produced unfair fields. The lesson for Flexyn is not to build an Elo — it is
that **in fitness, raw output ranks by bodyweight and training age**, which is
why `get_gym_consistency_leaderboard` ranks by *active days*, per CLAUDE.md's
note that ranking a gym floor by volume "tells a beginner they're last, which is
exactly the person this feature needs to keep."

XP is already the right currency here — it is effort-shaped, not
strength-shaped. Do not "improve" league ranking to volume or 1RM.

Sources: [Zwift introduces Racing Score](https://www.cyclingweekly.com/news/zwift-introduces-racing-score-to-make-platform-more-competitive-fairer-and-accessible) ·
[Zwift revamps race categories](https://escapecollective.com/zwift-revamps-race-categories-with-racing-score/)

### Leaderboard design research — why the middle 90% matters

Yu-kai Chou's analysis is that leaderboards demotivate as often as they
motivate, and the deciding variables are **reference-group size, reset
frequency, and whether rank can be lost**. The general finding across health
gamification: relative rank within a small, relevant peer group is what drives
behaviour — and being ranked first drives large activity increases in both
sedentary and highly active users.

The practical implication for Flexyn: **a bracket of 6 is not a competition, and
a reward structure that pays only the top 10 pays nobody in a bracket of 6.**
Fix bracket density and pay the qualified middle something.

Sources: [Designing effective leaderboards](https://yukaichou.com/advanced-gamification/how-to-design-effective-leaderboards-boosting-motivation-and-engagement/) ·
[Leaderboard design guide](https://yukaichou.com/gamification-analysis/leaderboard-design-definitive-guide-octalysis/) ·
[When to use leaderboards](https://medium.com/design-bootcamp/gamification-strategy-when-to-use-leaderboards-7bef0cf842e1) ·
[Health wearables, gamification and activity (arXiv)](https://arxiv.org/pdf/2301.02767)

---

## The design

### Time structure — three grains, each with a job

| Grain | Length | Job |
|---|---|---|
| **Week** (Mon–Sun, DB clock) | 7d | The bracket. Promotion / demotion / weekly payout. Exists today. |
| **Season** | 28d = 4 weeks | Identity, titles, trophies, ceremony, soft reset. **New.** |
| **Monthly board** | calendar month | Global XP board, no tiers. Exists; leave alone beyond fixing its cron. |

28 days deliberately matches `crew_seasons` (mig 248) so "Season 7" means the
same thing in both surfaces and the two ceremonies can share a cadence. Do not
invent a second season length.

### Tier ladder — proportions, not counts

Keep the six tiers. Replace absolute promote/demote counts with **percentages of
the qualified field, with absolute floors**, and add a qualification gate.

Starting values — **tune these with Kegan before shipping**, they are a
defensible first draft, not a finding:

| Tier | Promote | Demote | Min workouts/wk | Min weekly XP |
|---|---|---|---|---|
| Bronze | top 50% | — (floor) | 1 | 0 * |
| Silver | top 40% | bottom 10% | 1 | 0 * |
| Gold | top 30% | bottom 15% | 2 | 0 * |
| Platinum | top 25% | bottom 20% | 2 | 0 * |
| Diamond | top 20% | bottom 20% | 3 | 0 * |
| Legend | — (season board) | bottom 20% | 3 | 0 * |

> **\* `min_xp` ships at 0, and this is a correction to an earlier draft of this
> document, which proposed 150 → 1000.** Those numbers cannot be shipped. The
> production ledger will not support them: `xp_grant_log` holds **10 user-weeks
> in total**, median **23 XP**, p75 **50 XP**. Thirty-five of its thirty-six
> grants are 3–65 XP micro-actions — 24 of them water logs at 3 XP each — and
> the mean of 5,025 is one 50,000 XP test grant dragging the average. A 150 XP
> Bronze floor would disqualify **every user in the database, including the
> active ones**, which converts the qualification gate from "stops AFK
> promotion" into "stops all promotion."
>
> The workout-count column alone does what was actually asked. Ship the gate on
> workouts, leave `min_xp` at 0 as a live knob, and revisit once a month of real
> weeks exists. **Do not set an XP floor from a guess** — that is how this
> feature gets a second silent failure mode on top of the one being fixed.

`promote_count = max(1, ceil(qualified_count * pct))`, and **promotion slots are
computed over qualified members only** — an unqualified member never occupies
one.

### The qualification gate — the core of the ask

```
qualified  ⟺  workouts_this_week >= tier.min_workouts
              AND weekly_xp      >= tier.min_xp
```

`workouts_this_week` counts distinct days with a `workout_logs` **or**
`cardio_logs` row inside the bracket's week — matching how `workout_streak` is
defined in mig 016/173 (strength OR cardio).

Consequences, all of them intentional:

- Unqualified members **sort below every qualified member** regardless of XP,
  and render as **Unranked** rather than as rank 27 of 30.
- Unqualified members are **never promoted**, and never consume a slot.
- Unqualified members are **not immediately demoted either** — see decay below.
- Qualified-but-mid members get a **participation payout**. Today they get zero,
  which is the single biggest reason the feature reads as pointless.

### Inactivity decay — graceful, Clash-of-Clans shaped

Track consecutive unqualified weeks per user.

| Consecutive unqualified weeks | Outcome |
|---|---|
| 1 | Nothing. This is a rest week. |
| 2 | Nothing, plus a nudge notification. |
| 3+ | Demote one tier per unqualified week, floor Bronze. |

Plus **one Shield per season**, which holds tier for one week that would
otherwise demote. Duolingo sells this for XP; Flexyn should price it in
`flex_coins` (a currency sink the coin-economy audit will like) or grant it free
each season. Decide with Kegan.

Storage: a counter column on `user_profiles` (e.g. `league_inactive_weeks`,
`league_shield_used_season`). **These must be added to the privileged-immutable
column blocklist** alongside `league_tier` — see mig 142/173 — or a client can
zero its own decay counter.

### Bracket density — a one-line fix with real impact

In `ensure_my_league()`, change the open-bracket pick from newest to fullest:

```sql
-- was: ORDER BY created_at DESC
   ORDER BY member_count DESC, created_at ASC
```

Concentrates the current 6 users into one bracket instead of scattering them.
Combine with a **minimum viable bracket rule**: a bracket with fewer than **5
qualified members** resolves to *participation payouts only* — no promotion, no
demotion, everyone holds tier. This is what stops a solo Bronze bracket from
escalating one person to Legend in five weeks.

Do **not** backfill with bots. Duolingo does; a fitness app with a real social
graph should not put fake people on a leaderboard next to the user's gym mates.

### Rewards

**Weekly**, per bracket:

| Placement | Reward |
|---|---|
| 1st (qualified) | Tier coins ×1.5 + capsule + `week_wins` counter increment |
| Promote zone | Tier coins + tier capsule *(existing 067 amounts)* |
| Qualified, mid-table | Participation coins (~25% of tier coins) — **new** |
| Unqualified | Nothing |
| Demote zone | Nothing (unchanged) |

**Season-end**, every 28 days:

- **Season rank** = the *highest tier held at any point* during the season,
  gated on having qualified in at least **2 of the 4 weeks**. This is the
  Rocket League rule: reaching the rank is not enough, you have to have played.
- **Title** — `Season {n} {Tier}`, granted into the existing
  `equipped_title_id` system. Needs an earned-title path; `LOOT_TITLES` is
  currently capsule-drop only.
- **Trophy** — a `user_trophies` row, `trophy_id = 'league_s{n}_{tier}'`,
  pinnable via `signature_trophy`.
- **Champion trophy** — the #1 Legend finisher for the season gets a
  **season-unique** trophy (`league_s{n}_champion`) with its own artwork, minted
  once and never re-issued. This is the "custom league trophy for the winner."
  Follow Duolingo here: make it **status, not currency**. Give it a distinct
  visual per season so a profile carrying three of them reads as a history.
- **Capsule** — elite (Legend) / premium (Diamond, Platinum) / standard (Gold).
- **Season name** — number plus a theme word, mirroring how crews present
  seasons. Ship English via `tFallback` at minimum; these are short and
  translatable.

**Legend needs an endgame.** With `promote: 0` it is currently a room with no
exits. Give Legend a **season-long cumulative XP board** running in parallel
with its weekly brackets; the top 3 at season end take the champion trophies.
That is the Diamond Tournament shape, and it costs one query, not a new system.

### Soft reset — a decision for Kegan

Ranked games drop everyone a tier at season start (floor Bronze) so the ladder
does not ossify. Duolingo does not reset at all. A soft reset makes seasons mean
something and gives returning users a reachable climb; it also takes something
away from people who earned it. **Recommend a one-tier soft reset with the
season title/trophy already banked** — the permanent reward is the title, the
tier is the current standing. Confirm before building.

---

## Decisions (kegan, 2026-08-08)

| Question | Answer |
|---|---|
| Season length | **28 days**, matching `crew_seasons`. |
| Shield | **Paid, $2.99, three per account for life.** |
| Stranded brackets | **Void them.** Confirmed. |
| XP thresholds | `min_xp = 0`; gate on workout count. Forced by the ledger. |
| Champion artwork | Generative plate — season numeral + tier colourway. |
| Soft reset | **Still open.** Only blocks Phase 3. |

### The Shield is priced in real money, and there is no way to take it yet

`package.json` has no Stripe, no RevenueCat, no Capacitor or Cordova; there are
no `ios/` or `android/` directories, and the entire Market runs on `flex_coins`.
Flexyn is a PWA, and per the mobile-only constraint it ships to the Apple and
Google stores — which means a digital consumable must go through StoreKit or
Play Billing, behind a native wrapper that does not exist. That is a payments
epic, plausibly larger than this whole feature, and the league must not wait on
it.

So migration 310 ships the Shield **mechanic** complete and the **purchase**
not at all:

- `grant_league_shield(uuid)` is **`service_role` only** — no client path, no
  coin path. The intended caller is a receipt-validating Edge Function.
- The **3-per-lifetime cap lives in the database**, not in the caller, so
  replaying a receipt cannot mint a fourth.
- `my_league_shields()` is the read the store UI needs.
- The resolver already spends a shield when one exists, in both the
  zone-demotion and the decay path.

When payments land, the only new code is the receipt check that calls
`grant_league_shield`. Until then the entitlement is grantable by an operator
and the whole path is testable.

## Build plan

**Phases 0, 1 and 2 shipped together as migration 310.** The original ordering
below was wrong and is kept only for the record: scheduling the cron before the
activity gate existed would, on the first Monday, have promoted every 0-XP
member of the live bronze bracket — the exact bug being fixed. There is no safe
window between those two phases.

**Do not start Phase 3 before 310 is applied and has run once.**

### ✅ SHIPPED — migration 310 (Phases 0–2)

Verified before handover by running the whole migration plus a seeded 16-member
gold bracket inside `BEGIN … ROLLBACK` against production. Twelve members given
two training days each, four given none — and the highest-XP member in the
bracket (999,999 XP) deliberately among the idle four:

| Assertion | Result |
|---|---|
| `qualified_count` | 12 |
| promoted | 4 — `ceil(12 × 0.30)` |
| demoted | 1 — `floor(12 × 0.15)` |
| held | 7 |
| unranked | 4 |
| **unqualified promoted** | **0** |
| top unranked XP | 999,999 — idle, not promoted |
| first-place coins | 300 (200 × 1.5) |
| mid-table coins | 50 (was 0) |
| current-week bracket | untouched |

Rollback confirmed clean afterwards: no columns, functions, seed rows or
resolutions leaked into production.

Client side: `recordWeeklyXp` now calls `sync_my_weekly_league` and ignores its
`amount`; `_resolveLeague` and the unreachable resolve-on-read branch are
deleted; `leagueTiers.js` carries proportions plus `promoteCount` /
`demoteCount` / `isQualified`; the card and standings render qualification.
3,179 tests pass, lint and build clean.

### Phase 0 — Decide the stranded data

7 past-week brackets sit unresolved, oldest from 2026-05-04, with 32 of 35
memberships at 0 XP.

**Recommendation: void them.** Mark `is_resolved = true`, write no ranks, change
no tiers, pay nothing, send no notifications. Resolving them under any ruleset
promotes AFK accounts — precisely the outcome being fixed. Write it as an
explicit one-shot statement in the migration with a comment saying why, so it
does not read later as a bug.

Same for `monthly_leagues`: 1 league, 1 member. Void, then fix the cron.

### Phase 1 — Make the rollover actually run *(migration 312)*

1. **`sync_my_weekly_league()`** — mirror mig 297. No amount parameter; derives
   `weekly_xp` from `SUM(xp_grant_log.amount) WHERE granted_at` inside the
   bracket week. SET, not increment, so double-calling is harmless. Call it from
   `recordWeeklyXp` alongside the existing monthly sync.
2. **Deprecate `increment_league_xp`.** Once weekly XP is derived, the
   client-supplied amount is a forgeable input with no remaining purpose.
   Revoke from `authenticated` in the same migration.
3. **`roll_weekly_leagues()`** — SECURITY DEFINER, **no `auth.uid()` guard**,
   `REVOKE ALL … FROM PUBLIC, anon, authenticated`. For each bracket with
   `week_end < CURRENT_DATE AND NOT is_resolved`: claim it with the same
   single-winner `UPDATE … WHERE is_resolved = false` pattern
   `roll_crew_seasons()` uses, then rank and distribute.
   - Refactor 067's body into an internal `_distribute_league_rewards(uuid)`
     without the `auth.uid()` check; the cron calls that. Drop the authenticated
     wrapper — client-triggered resolution *is* the bug.
4. **Cron**: `SELECT cron.schedule('roll-weekly-leagues', '10 0 * * 1',
   'SELECT public.roll_weekly_leagues();')` — Monday 00:10 UTC, ten minutes
   after `gym-rival-settle`.
5. **Fix `monthly-league-resolve`** to distribute rather than flag-flip, or
   unschedule it until it does. Leaving it as-is keeps destroying state.
6. **Delete the dead client path** — the `weekEnd < new Date()` branch in
   `getMyLeague` and `_resolveLeague`. Leave a comment saying rollover is
   cron-owned now.
7. `ensure_my_league()`: `ORDER BY member_count DESC, created_at ASC`.

**Verify before moving on:** seed a past-week bracket with known members, run
`SELECT public.roll_weekly_leagues();`, assert ranks and tier changes. Then
confirm as role `authenticated` that the function is *not* callable.

### Phase 2 — Activity gating *(migration 311)*

1. `league_weekly_activity(p_user_id, p_week_start, p_week_end)` → distinct
   active days across `workout_logs` + `cardio_logs`.
2. Tier config table in SQL carrying `promote_pct`, `demote_pct`,
   `min_workouts`, `min_xp` — **and mirror it in `src/lib/leagueTiers.js`.**
   067's head comment already warns these two must move in lockstep; that
   coupling is a standing hazard, so consider having the client read the config
   from an RPC instead of duplicating it a third time.
3. Rank qualified members first, unqualified after, and compute promote/demote
   slots over the qualified count only.
4. Minimum-viable-bracket rule (<5 qualified → participation only).
5. Decay counters + Shield, with new `user_profiles` columns added to the
   privileged blocklist.
6. Participation payout for qualified mid-table.

**Verify:** synthetic brackets covering all-AFK, all-active, mixed, 1-member,
30-member, and exactly-5-qualified. Assert no 0-XP member is ever promoted in
any of them.

### Phase 3 — Seasons, titles, trophies *(migration 312)*

1. `league_seasons (id, season_number, name, starts_at, ends_at, status)` —
   copy the `crew_seasons` shape and its single-winner roll pattern verbatim.
2. `league_season_stats (season_id, user_id, best_tier, weeks_qualified,
   season_xp, final_rank, awarded_at)`.
3. `roll_league_seasons()` + cron, offset from `roll-crew-seasons` (`20 3 * * *`)
   so the two ceremonies do not land in the same minute.
4. Award titles + `user_trophies` rows; mint the season-unique champion trophy
   for the top Legend.
5. Earned-title path into `equipped_title_id` (today only capsules grant
   titles).
6. Legend season board query.
7. Soft reset at season roll, **if** confirmed.

### Phase 4 — UI

**The design exists.** Penpot page **"League seasons — slots to draw"**, four
boards. Build from it rather than inventing screens:

| Board | Covers |
|---|---|
| **A · League card — Dashboard states** | 6 card states at 343pt: promote zone, safe/mid, **not qualified**, demote zone, decay warning, season finale. Status strip under a hairline is the new element. |
| **B · Standings — the full board** | Header (tier + season + both clocks), 48pt rows, promotion line, demotion line, **NOT QUALIFIED cut** with unranked rows. |
| **C · Season end — ceremony, trophies, titles** | Standard ceremony sheet, champion sheet, the trophy ladder, title pills, three edge states. |
| **D · The ruleset** | Ladder table, 4-week season timeline, the qualification rule with its evidence, decay steps. |

Conventions held: tier colour confined to the 32/40pt medal chip (four-hue rule
intact everywhere else), hairline borders with no shadows, radius 8/12/16, type
on the six steps with an 11px floor, no gradients and no glass.

- **`LeagueCard`** — qualification state ("Log a workout to qualify"),
  promote/demote zone indicator (the dead locals removed at
  [LeagueCard.jsx:119](../src/components/dashboard/LeagueCard.jsx:119) can come
  back with real meaning now), season badge.
- **`LeagueStandingsModal`** — Unranked section, qualification pill per row,
  season header, days-to-season-end alongside days-to-week-end.
- **Season End ceremony** — the payoff. Per CLAUDE.md this is an **8th
  celebration helper and needs its own haptic + confetti signature**; all seven
  existing ones are distinct and that must hold. Route through
  `src/lib/rewardQueue.js` — a season roll can land coins, a capsule, a title
  and a trophy at once.
- Trophy + title display on `HubProfile`.

### Phase 5 — Notifications & i18n

`notify_league_resolution_for` (mig 040) already renders 15 languages and
`league` is already a valid preference category (mig 083). Add:

- season-end result
- qualification warning — "2 days left, you haven't qualified this week"
- demotion warning at 2 consecutive unqualified weeks

Follow the `notify_X_for(p_user_id, …)` cross-user pattern from mig 041 with
server-side text branches for all 15 languages. New UI keys go in
`src/lib/i18n-leagues.js` with `tFallback(key, 'English')`.

---

## Non-negotiable constraints

Straight from `CLAUDE.md` — these are the ones this feature is most likely to
trip over:

- **The client never computes XP, coins, tiers, or trophies.** Every award is a
  SECURITY DEFINER RPC deriving the user from `auth.uid()` — or, for cron
  functions, from nothing at all and revoked from every client role.
- **`league_tier` is already in the privileged-immutable column list** (mig
  142/173). Any new league column on `user_profiles` goes in it too.
- **`REVOKE ALL … FROM PUBLIC` on every new function, then run `get_advisors`.**
  Every public-schema function is a PostgREST endpoint the moment it exists.
  Mig 276's `fire_scheduled_workout_reminders` is the cautionary tale: without
  the revoke, `anon` could fire every user's reminders. A cron rollover function
  left exposed lets anyone resolve a bracket early.
- **Paste-safe SQL.** No short `alias.column`, no record-field `.id`. Scalar
  `SELECT … INTO`, `public.<table>`, bare columns in single-table statements.
  Kegan pastes this into the SQL editor from a phone.
- **`DROP POLICY IF EXISTS` before every `CREATE POLICY`**, same for triggers.
- **Migration numbering: 310 is taken by this work** (the parallel session holds 308 and 309). Fetch and
  rebase first — a parallel session may have claimed it.
- **Grep for real column and function names before referencing them.**
  CLAUDE.md names this as the repo's single most common defect class.
- **Mobile-only.** ≥44px targets, no hover-only affordances, verify at 667px
  height as well as 932.
- **Two spacing registers** (`gap-1`/`gap-2`, `gap-6`), no `gap-3/4/5`. No
  gradients-as-decoration, no glassmorphism, no coloured shadows. A season
  ceremony is exactly the surface that invites all three.
- **After every push, paste the SQL inline in chat in a fenced ```sql block.**
  Never a file path.

---

## Verification

Per CLAUDE.md's three layers — and note that layer 1 is the only one that proves
the security properties here:

1. **SQL as `authenticated`** — `BEGIN; SET LOCAL role authenticated; SET LOCAL
   request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'; … ROLLBACK;`
   Prove: `roll_weekly_leagues()` → `42501`. `_distribute_league_rewards()` →
   `42501`. `increment_league_xp` → revoked. A direct `UPDATE league_members SET
   weekly_xp` → blocked. MCP and the SQL editor run as `postgres` and prove
   nothing.
2. **Node probe** with the anon key + `signInAnonymously()` — exercise
   `ensure_my_league` and `sync_my_weekly_league` over real HTTP. Clean up rows
   it writes.
3. **The deployed site** — the card, the modal, the ceremony.

Plus a **fixture suite** for the resolver, which is where the actual logic
risk is. `src/lib/__tests__/leagueTiers.test.js` exists; extend it, and add SQL
fixtures for:

- all-AFK bracket → nobody promoted, nobody demoted, nothing paid
- 1-member bracket → held, participation only
- exactly 5 qualified → promotion runs
- exactly 4 qualified → participation only
- mixed bracket → unqualified sort below qualified regardless of XP
- 3 consecutive unqualified weeks → one tier drop, not three
- Bronze at 0 workouts → **never** promoted *(the headline case)*
- double cron firing → no double payout
- season roll with `weeks_qualified = 1` → no title, no trophy

---

## Open questions for Kegan

Answer these before Phase 2; each changes the build.

1. **Season length** — 28 days to match crews, or something else?
2. **Soft reset** — drop everyone one tier at season start, or carry standing
   forward Duolingo-style?
3. **Shield** — free once per season, or bought with `flex_coins`? If bought,
   what price?
4. ~~**Thresholds**~~ — **answered.** The `xp_grant_log` distribution was pulled:
   10 user-weeks, median 23 XP, p75 50 XP. Ship `min_xp = 0` and gate on the
   workout count alone. Revisit after a month of real data. See the note under
   the ladder table.
5. ~~**Champion trophy artwork**~~ — **answered in the design.** Board C
   proposes one plate geometry with two variables: season numeral and tier
   colourway. No new artwork per season, and a profile carrying four of them
   reads as a history. Confirm you like the treatment, or overdraw it.
6. **Stranded brackets** — confirm voiding rather than retro-resolving.
