# The Crews Hub — a public directory and a Top board

Research for the Crews landing surface on the Hub: a browsable list of every
public crew with member count and combined volume, plus a **Top** tab
ranking crews against each other.

Two halves. First, what shipping competitive apps do with a **group
directory** and a **group leaderboard**, read as source. Second, what
Flexyn's own database and components can actually support today — measured
against production on **2026-08-08**, not assumed.

The companion brief is [crews-hub-prompt.md](crews-hub-prompt.md).
The Crew *page* (what tapping a crew opens) was researched separately in
[crew-page-research.md](crew-page-research.md) and is already built.

| App | Repo | Licence | Read for |
|---|---|---|---|
| **Nakama** | `heroiclabs/nakama` | Apache-2.0 | `server/core_group.go` — group listing, member count, cursor ordering |
| **Habitica** | `HabitRPG/habitica` | GPL-3.0 — **ideas only** | `website/client/src/components/groups/{discovery,publicGuildItem}.vue`, issue #12286 |
| **trophyso/ui** | `trophyso/ui` | MIT | Already the reference for the player leaderboard (see gamification-ui-research.md) |

---

## Part 1 — what the references do

### 1. The member count is a column, not a `COUNT(*)`

Nakama's `ListGroups` selects a denormalised counter straight off the group
row:

```
SELECT id, creator_id, name, description, avatar_url, state,
       edge_count, lang_tag, max_count, metadata, create_time, update_time
```

`edge_count` is maintained incrementally at the membership boundary —
`JoinGroup` runs `UPDATE groups SET edge_count = edge_count + 1`, `LeaveGroup`
and `KickGroupUsers` decrement. A directory listing therefore never joins to
the membership table at all.

**And that exact design is Habitica's longest-running data bug.** Issue
#12286, open since 2020-06-09 and inherited from an older ticket, describes
`memberCount` as a stored computed value "that we currently attempt to keep
up to date by incrementing and decrementing as members join and leave" — and
it drifts far enough that users are told to post in the Report a Bug Guild to
get their guild fixed by hand. The accepted fix is to stop incrementing:
"count all existing members, rather than add or subtract one", made safe by
multi-document transactions.

The transferable rule is not "denormalise" and not "always recount" — it is
**pick one and make the write path atomic**. An increment that can be missed
by any code path (a cascade delete, an admin removal, a failed transaction)
produces a directory that lies about the thing people use to choose.

### 2. Ordering is a full key, ties are never left to the planner

Nakama orders on every column in the cursor, in the same direction, always
terminating in the id:

```
ORDER BY disable_time DESC, edge_count DESC, update_time DESC, id DESC
```

and the cursor struct carries `EdgeCount, Lang, Name, Open, UpdateTime, ID`
so a resumed page can't repeat or skip a row. This is the same finding
migration 257 already applied to Flexyn's player leaderboards, arrived at
from a different direction: **a ranked list ordered on the metric alone will
visibly reshuffle between refetches with nothing having happened.**

### 3. Scale is expressed through the object's own scale

`publicGuildItem.vue` renders the member count inside a badge whose tier is
chosen by that count: bronze under 100, silver 100–999, gold at 1000+. No
extra chrome, no separate label — the number and its meaning are one element.

The row itself is short: name as an `h3`, a truncated summary, the member
count, category tags, and the guild bank if it has one. The action —
**Join**, or **Leave** if you are already in — sits in its own column at the
end of the row and swaps by membership state rather than greying out.

### 4. Discovery filters on what you'd actually choose by

Habitica's `discovery.vue` filters by category, by your role in the guild,
and by **size tier** (bronze / silver / gold — the same buckets as the
badge). Results are infinite-scrolled with a debounce; the empty state is a
single centred `noGuildsMatchFilters` string.

Notably its sort dropdown is **defined and commented out**, with
`@TODO: Add when we implement recent activity`. A directory with no activity
signal has nothing worth sorting by, and they chose to ship no sort rather
than a meaningless one.

---

## Part 2 — what Flexyn can support today

Everything below was checked against the production database and the
installed function bodies, per CLAUDE.md's rule that the migration file is
not the source of truth.

### The blocking finding: `get_suggested_crews` cannot return a row

The installed body (`pg_get_functiondef`, read 2026-08-08) is **not**
migration 090's. Migration 159 redefined it against a `crews.member_count`
column that has never existed:

```sql
SELECT id, name, description, member_count, max_capacity, is_public
  FROM public.crews
 WHERE is_public = TRUE
   AND id NOT IN (SELECT m_crew_id FROM my_crews)
   AND member_count < max_capacity
 ORDER BY member_count DESC, id
```

`SELECT member_count FROM public.crews` returns `42703: column
"member_count" does not exist` — verified directly. The function still
compiles because `member_count` is also a `RETURNS TABLE` OUT parameter, and
`#variable_conflict use_column` only redirects names that are **ambiguous**;
with no column of that name there is no ambiguity, so it binds to the
variable, which is NULL. `NULL < max_capacity` is NULL, the row is filtered,
and the function returns zero rows for every caller.

Downstream, `CrewSuggestionRail.jsx:105` is the only consumer, and it reads
`crew.member_count || 0` — so even if the predicate passed, every rail card
would show 0 members and a 0% fullness bar. **The rail has never rendered.**

Migration 090's original body was correct (`COUNT(cm.id)::INT AS
member_count` over a join). 159 also wrote `UPDATE public.crews SET
member_count = member_count + 1` into `join_crew_atomic` — that one was
overwritten by a later migration and the installed body is clean, so joining
works. Only the read path is still broken.

This is the exact trap CLAUDE.md opens with, hit a second time: a later
migration redefining a function from a stale template, invisible in the file
that owns the feature.

### Member counts are not computable from the client

`crew_members` SELECT is `is_crew_member(crew_id)` (mig 048) — you can read
the roster of a crew you belong to and no other. So a directory row's member
count **must** come from a SECURITY DEFINER RPC. It cannot be a second
client query.

`CrewDiscovery.jsx` already assumes otherwise. `CrewResult` branches on
`typeof crew._memberCount === 'number'`, but `searchPublicCrews` selects
`id, name, description, tag, max_capacity, created_at` and never sets
`_memberCount`. `known` is therefore always `false`, and every discovery row
in production reads **"up to 16"** — never "5 of 16", never "full". The
`full` state and the "Full" button label are unreachable.

### There is no crew volume anywhere, but the ingredient is safe

No table, column or function aggregates volume per crew. The building block
is `user_profiles.total_volume_lbs`, and it is **server-authoritative**:
migration 173 raises

```
total_volume_lbs is RPC-only (use increment_user_volume / reconcile_my_workout_volume)  [42501]
```

on any direct client UPDATE. So `SUM(total_volume_lbs)` over a crew's members
is a number a competitor cannot forge, which is the whole precondition for
ranking crews by it.

(Worth noting separately: CLAUDE.md's "Do NOT patch these" list omits
`total_volume_lbs`, `total_distance_meters`, `last_workout_date`,
`streak_freezes_available`, `level_capsules_awarded_through` and
`overthrow_count`, all of which migration 173 locks the same way. The list is
under-inclusive, not wrong.)

### What a crew already carries

`public.crews` — `crew_xp`, `crew_level`, `trophies`, `wars_won`,
`wars_lost`, `wars_drawn` (mig 248), `treasury_coins` (mig 251), plus
`is_public`, `tag`, `description`, `avatar_url`, `max_capacity`. There is
already a `crews_trophies_idx ON (trophies DESC)`.

`crew_season_stats` — `(season_id, crew_id)` with `division`, `points`,
`wars_played`, `wars_won`, `challenges`, readable by any authenticated user
(`USING (true)`, mig 248) and written only by SECURITY DEFINER functions.

So a **Top** board has three defensible metrics with no new state at all:
trophies (lifetime), season points (current season), and combined volume (the
one that needs the new aggregate).

### The metric the product wants is currently zero

| Measured 2026-08-08 | |
|---|---|
| Crews | 4 |
| Crews with `is_public = true` | **0** |
| Crew members total | 6 |
| Users | 35 |
| Users with any volume at all | **1** |
| Total volume across the entire app | **4,995 lbs** |
| `workout_logs` rows | 3 |
| Crew wars ever run | 0 |

A directory keyed on combined volume, shipped against this data, is a list of
crews reading **0 lbs** — and the list is empty anyway, because no crew has
opted into being public. This does not mean don't build it. It means the
empty state and the zero state are not edge cases here, they are **the
launch experience**, and they have to be designed first rather than last.

It also means the volume aggregate can be computed live for now. 6
memberships against 35 profiles is nothing; a `SUM` over a join is correct
and cheap until crews number in the thousands. Denormalising a counter this
early buys nothing and inherits Habitica's bug.

### Unverified, and must be checked before shipping

`crews` carries a merged SELECT policy (`crews_select_merged`, built by
migration 217 from whatever was installed at the time) that should
OR-combine 048's `is_crew_member(id)` with 065's `is_public = true OR
created_by = auth.uid() OR EXISTS(member)`. **I could not read the installed
policy** — every `pg_policies` query in this session was refused by the tool
sandbox. Two things follow that the implementer has to confirm rather than
inherit:

- whether the merged policy is `TO authenticated` or `TO public`. 065's
  original carried no `TO` clause, which means PUBLIC, and 217 preserved
  whatever roles it found. If it is PUBLIC, public crew rows are readable by
  `anon` — the same shape as the hub-feed hole migration 303 closed.
- whether `is_public` is actually in the installed expression at all.

---

## What this points at

1. **Fix `get_suggested_crews` in the same change.** It is four lines, it is
   the same query the directory needs, and leaving a permanently-empty rail
   next to a new directory makes the new thing look broken too.
2. **One RPC owns the directory.** Member count, combined volume, level,
   trophies and war record in one server-side read, gated on
   `is_public = true`. The client cannot compute two of those five.
3. **Recount, don't increment.** Habitica has spent six years on the other
   choice. At Flexyn's scale the counter buys nothing yet.
4. **Full ordering keys.** Metric DESC, then a stable tiebreak, then `id` —
   migration 257 already set this precedent for players.
5. **Rank crews on something that isn't zero yet.** Volume is the metric the
   product wants and the right one long-term; today it is 0 for 34 of 35
   users. Ship the board with a metric switch so Top has something true to
   say on day one.
6. **The Join action belongs on the row**, swapping by state, the way
   `publicGuildItem.vue` does it — not behind the row.

---

## Sources

- [heroiclabs/nakama](https://github.com/heroiclabs/nakama) — Apache-2.0,
  `server/core_group.go`
- [HabitRPG/habitica](https://github.com/HabitRPG/habitica) — GPL-3.0, read
  for mechanics and layout only; no code lifted
- [habitica#12286 — Member count inaccurate in Guilds and Parties](https://github.com/HabitRPG/habitica/issues/12286)
- [trophyso/ui](https://github.com/trophyso/ui) — MIT
