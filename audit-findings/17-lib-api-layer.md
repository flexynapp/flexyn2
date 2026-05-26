# Audit 17 — lib + api layer

Deep code-audit of `src/api/*` and `src/lib/**`. These bugs have wide
blast radius — anything wrong here affects every consumer.

Severity legend: **HIGH** = silent data loss / wrong behavior at scale;
**MED** = noticeable in specific paths; **LOW** = cosmetic / edge-case.

---

## TOP 8 (read these first)

### T1 — HIGH: `db.js` _create() injects `created_by` as a SECOND-CHANCE fallback, not an enforced default

`src/api/db.js:90-103`. The enrichment is:
```js
const enriched = {
  ...(authUser?.email ? { created_by: authUser.email } : {}),
  ...(authUser?.id    ? { user_id:    authUser.id    } : {}),
  ...data, // caller values win if explicitly provided
};
```
Because caller values override the auth-derived values, a malicious or
buggy caller passing `created_by: 'somebody-else@x.com'` will have it
written verbatim (subject to RLS). The comment says "caller values win
if explicitly provided" — which is the bug: client code should NEVER
be able to set `created_by` to another user's email. Currently RLS on
some tables (e.g. `marketplace_listings`, `hub_posts`) enforces this,
but `food_items`, `workout_templates` (community), and
`exercise_forms` accept any author. Recommended fix: invert the spread
so auth-derived values always win.

### T2 — HIGH: `crews.js` getCrewFirstAchievers filters on the wrong column

`src/lib/data/crews.js:688-696`. Filters by `a?.unlocked && a?.unlocked_date`,
but the `achievements` table doesn't have an `unlocked` boolean OR an
`unlocked_date` column — `src/api/db.js:411-416` and the XP grant path
write `unlocked_at` (TIMESTAMPTZ) and no `unlocked` flag. Every
filtered row's `a?.unlocked` is `undefined`, so the array is silently
empty. The crew "first-to-achieve" leaderboard has been showing zero
rows since shipped. Fix: drop the `unlocked` predicate, sort/filter
by `unlocked_at`.

### T3 — HIGH: `weightUnit.js` formatWeight / formatWeightNumber test `lbs == null` BEFORE coercion check

`src/lib/weightUnit.js:34-49`. The intent is to coerce, but:
```js
const n = Number(lbs);
if (lbs == null || !Number.isFinite(n)) return '—';
```
A weight of `0` is finite — fine. But a Supabase-returned string `"0"`
coerces to `0`, finite — also fine. The bug is more subtle: `lbs ==
null` only catches `null/undefined`. If `lbs` is the string `""`
(empty), `Number("")` is `0` → returns `"0 lbs"`. That's the wrong
display for "no value entered." Workout edit / body-metric edit
screens may show `0 lbs` instead of `—` when a field is empty. Add an
explicit empty-string guard.

### T4 — HIGH: `notifications._create` cross-user fallback is a phishing surface on pre-migration-026 hosts

`src/lib/data/notifications.js:155-205`. When the
`create_notification_for` RPC returns 42883/42P01, code falls through
to a direct `INSERT INTO notifications` with whatever `user_id` the
caller passed. The comment explicitly acknowledges this:
"Pre-migration: function not found. Fall through to the legacy
direct-insert path, which will hit the new RLS check and fail." But
if RLS is missing too (very old host), this would let any
authenticated user spam any other user's inbox with arbitrary title /
body. Mig 026 has been deployed; the fallback should be removed.

### T5 — HIGH: `db.js` _invokeDeleteAccount: `tables_with_user_id_only` skipped on environments that already have working schema

`src/api/db.js:589-606`. If a delete for ANY of the listed tables
returns a non-schema-skew error (RLS deny 42501, FK violation 23503,
network), it's reported as a failure — BUT only AFTER `Promise.allSettled`.
The final code at line 698-703 only throws if `failures.length > 0`.
Good. However: deletions are run completely in parallel with no
ordering — `hub_comments` rows reference `hub_posts` via FK; deleting
posts first while comments still reference them will raise 23503 on
the comments delete. The current code may produce non-deterministic
failures depending on which Promise resolves first. Recommend
sequencing or relying on `ON DELETE CASCADE` at the DB level.

### T6 — HIGH: `hubMessages.unreadCountFor` is globally scoped, not per-user

`src/lib/data/hubMessages.js:308-313`. Fetches the 100 most recent
messages across the WHOLE table:
```js
const recent = await msg().filter({}, '-created_date', 100).catch(...);
return recent.filter(m => _isUnread(m, myEmailLc)).length;
```
RLS limits the rows returned to messages the user can see (conversations
they participate in). But the comment ABOVE acknowledges: "Inbox badges
over 99+ are capped anyway, so the only loss is precision past that
cap." That's misleading — if the user has 200+ unread messages, the
window of 100 most recent is unlikely to all be unread; the badge will
under-count by a wide margin. Worse: on a popular user with a deep DM
history, the 100 most recent might be entirely from one conversation
they just opened (read), and other-conversation unread messages get
counted as 0. Replace with the suggested `unread_message_count_for(p_email)`
RPC.

### T7 — MED: `leagues._resolveLeague` recursion via `getMyLeague` → `_resolveLeague` → `getMyLeague`

`src/lib/data/leagues.js:244-248`:
```js
if (!ctx.league.is_resolved && weekEnd < new Date()) {
  await _resolveLeague(ctx.league.id);
  // Re-place into a fresh league
  return getMyLeague(user);
}
```
After `_resolveLeague` runs, the league row's `is_resolved` is true
(claim_league_resolution flips it). `ensureCurrentLeague(user)`
finds NO active membership for the current week (the user is in the
old league which is now resolved) so it goes to `_findOrCreateLeague`
and creates a new league + new member row. So far so good. But if
`_resolveLeague` failed AND the league row didn't flip is_resolved
(pre-067 host or RPC error returns without claiming), then
`getMyLeague` recurses indefinitely — the same league row keeps
appearing as `is_resolved=false AND past`. Add a recursion guard.

### T8 — MED: `nemesis.assignNemesis` falls back to a random user including users at radically different levels

`src/lib/data/nemesis.js:73-89`. When the XP-range candidate pool is
empty, the fallback queries ANY non-opted-out user with a username,
limit 20. Then sorts by `Math.abs(a.total_xp - me.total_xp)` and
picks from the top 3. For a new user with 50 XP, this returns the
20 oldest active users (no ORDER BY), then sorts by XP-distance —
the result is deterministically the 3 lowest-XP users, but those
could be at level 50 vs the new user's level 1. The result: a
nemesis card showing a 250k-XP veteran as a "rival" for a brand-new
user. Cap the fallback to within 5× the user's XP, and explicitly
ORDER BY total_xp ASC in the fallback query.

---

## ADDITIONAL FINDINGS

### F9 — MED: `xpSystem.calculateLevelFromXp` returns `progressPercent: 100` at exactly-the-threshold

`src/lib/xpSystem.js:50-64`. The loop uses `cumulativeXp + xpNeeded >
totalXp` (strict greater). At the exact threshold (totalXp ==
cumulativeXp+xpNeeded), this is false, so the loop advances. At the
next iteration the user is "in level N+1 with 0 XP." That's the
intended behavior. BUT: if `totalXp` is `Number.MAX_SAFE_INTEGER` or
near it, the loop will only break at the MAX_LEVEL fallback because
the cumulative sum can exceed `totalXp` only after a huge number of
iterations. Test passes because MAX_LEVEL fallback handles it. Note:
no off-by-one in the boundary path tested, but the integer truncation
in `getXpForNextLevel` (via `Math.floor`) means `getTotalXpForLevel(N)
+ getXpForNextLevel(N) ≠ getTotalXpForLevel(N+1)` in edge cases —
negligible drift but real.

### F10 — MED: `xpSystem.calculateCardioXp` does NOT validate negative inputs

`src/lib/xpSystem.js:159-178`. If `distance_meters` is `-100` (a
client-side bug, GPS noise), `distanceXp` becomes negative and offsets
the duration XP. Same for `calories`. The min/max clamps only apply
at the end. Easy fix: `Math.max(0, distance_meters || 0)`.

### F11 — MED: `loginStreak.recordLogin` and `workoutStreak.recordWorkoutDay` DST-fragile

Both use `differenceInCalendarDays(new Date(today), new Date(lastDate))`.
`format(new Date(), 'yyyy-MM-dd')` is local-time. If the user crosses
a DST boundary (spring forward) on the night of day N, `new
Date('2026-03-08')` for `today` and `new Date('2026-03-07')` for
`lastDate` are interpreted in the current local DST offset, and
`differenceInCalendarDays` is supposed to handle this — but if the
device's timezone changes (traveler) the streak math may show diff=0
or diff=2 for what was actually a 1-day gap, breaking the streak
unfairly or doubling it. Document and test.

### F12 — MED: `loginStreak` / `workoutStreak` fallback RMW writes stale flex_coins

`src/lib/data/loginStreak.js:147-151` and `workoutStreak.js:122-127`.
The fallback path computes
`const fallbackCoins = (profile.flex_coins ?? 0) + coinsAwarded` —
but `profile.flex_coins` was read at the start of the function. Any
concurrent coin grant (capsule open, marketplace credit) that landed
between the initial read and this fallback write will be OVERWRITTEN.
Same race the RPC was added to fix. Acceptable because the fallback
path only runs pre-030, but worth flagging.

### F13 — MED: `db.js` _invokeXp double-spend on bonus XP

`src/api/db.js:425-440`. Bonus XP is granted via
`increment_user_xp`, then `projectedTotal += ach.xp_awarded`. If the
bonus RPC succeeded BUT `_invokeXp` is called again (the outer
function's wrapper retries), the previous bonus already landed on
total_xp, and the loop walks the same milestones again — finds
`existing` row exists, skips insert, and doesn't credit bonus. Good.
But the `projectedTotal` here is a stale snapshot — if a concurrent
grant from elsewhere lands during this loop, the projection diverges
from reality. Low-impact but real.

### F14 — MED: `nemesis.checkOverthrow` ignores draws

`src/lib/data/nemesis.js:208-227`. "Wins on 2 of 3: volume, sessions,
XP." Each comparison is `>` not `>=`, so a tie on volume + win on
sessions + tie on XP = 1 win (not enough). A user who exactly matches
their nemesis on 2 of 3 metrics with a clear win on the third still
gets overthrown=false. Probably intended, but worth confirming —
"matches their nemesis exactly" is a meaningful achievement.

### F15 — MED: `gauntlet.checkChallenge1` swallows ALL errors silently

`src/lib/data/gauntlet.js:264-313`. `try { ... } catch { return null; }`.
Network error → user doesn't get their First Blood completion. Not
reported. Add `reportError` so the silent failure surfaces.

### F16 — MED: `safeSelect.js` retry guard caps at 20 but doesn't terminate on repeated identical column

`src/api/safeSelect.js:104-118`. If `identifyMissingColumn` somehow
returns a column that's not in `active` (impossible per the guard, but
defensive code), the filter would no-op, the loop would run again with
the same active list, same error — wasting the retry budget. Bounded
by 20 so it terminates, but inefficient. Low-risk because the
`if (active.length === 1) return result` guard handles single-column
case.

### F17 — LOW: `intl.formatNumber` returns `''` for `0`?

`src/lib/intl.js:88-96`. `Number.isNaN(Number(n))` on `0` is false, so
`0` passes. Returns `"0"`. Good. But `Number.isNaN(Number(""))` is
also false — `Number("")` is `0`. So `formatNumber("", "en")` returns
`"0"` not `""`. Probably never invoked with `""`, but the contract is
inconsistent: `null/undefined → ""`, `"" → "0"`.

### F18 — LOW: `intl.formatDate` accepts `0` (epoch) as a valid date

`src/lib/intl.js:98-108`. `new Date(0)` is 1970-01-01 — finite. If
any caller passes a raw `0` for a missing timestamp, it'll render
"1/1/1970" instead of empty. Most call sites have already-fetched
ISO strings or Date objects so this is rarely triggered.

### F19 — LOW: `weightUnit.fromLbs` doesn't validate `unit` arg

`src/lib/weightUnit.js:16-22`. Unknown unit (`"oz"`) falls through to
the `return n;` line — i.e., returns lbs unchanged. Caller renders
"123 oz" but the number is in lbs. Validate unit against a whitelist
or warn.

### F20 — MED: `conversationRequests.partitionConversations` loses conversations with empty `participant_emails`

`src/lib/data/conversationRequests.js:54-67`. If `participant_emails`
is null or empty array (group-DM creation midway, schema drift), the
`otherEmails` array is empty, `followsAny` is false, `accepted_by_me`
is whatever's on `accepted_emails`. If neither, the conv is silently
routed to `requests` — possibly leaving a user-created/owned
conversation in the Requests folder forever. Add a guard: when there
are no other participants AND the viewer is a participant, route to
inbox (it's a one-person/self conv).

### F21 — MED: `hubMessages.listMyConversations` participant case-folding asymmetry

`src/lib/data/hubMessages.js:101-105`. Uses
`(c.participant_emails || []).some(e => e?.toLowerCase() === myEmailLc)`.
Good. But `buildKey(a, b) = [a.toLowerCase(), b.toLowerCase()].sort()`
— uses lowercase. The findOrCreateConversation reads
`participant_emails: [myEmail, otherEmail].sort()` — NOT lowercased.
So `participant_key` ('alice|bob') and `participant_emails`
(['Bob@x.com', 'alice@x.com']) drift on case. Filter probes on
`participant_key` may miss conversations created with different case.

### F22 — MED: `hubFollows.getMutualFollowSince` string-compares ISO dates

`src/lib/data/hubFollows.js:62-74`. `return dateA < dateB ? dateA :
dateB;` — string compare on ISO 8601 timestamps. Works for full ISO
strings ("2026-05-25T..." comes before "2026-05-26T..."), but if one
side is `"2026-05-25"` (date-only) and the other `"2026-05-25T00:00:00Z"`,
the string compare returns the shorter one as earlier even when they
represent the same moment. Use `new Date(a) < new Date(b)`.

### F23 — MED: `hubComments.incrementCounter` is read-modify-write, race-prone

`src/lib/data/hubComments.js:28-35`. No atomic RPC. Two simultaneous
likes on the same comment both read the same `current` value, both
write `current+1`. One like silently dropped. There's an RPC pattern
in `hubPosts.incrementCounter` (mig 077) but no equivalent for
comments. Add `increment_hub_comment_counter` or reuse the same RPC
with a `p_table` arg.

### F24 — LOW: `xpSystem.getLevelMultiplier` discontinuity at tier boundaries

`src/lib/xpSystem.js:23-29`. The multiplier jumps from 1.05 → 1.07 at
level 11, from 1.07 → 1.09 at 31, etc. Because the EXPONENT is
`currentLevel - 1` and the BASE changes at the boundary, the curve
has discontinuities — level 11's XP-to-12 cost is roughly 295, level
10's cost to 11 was 232. That's a 27% jump for a single level
boundary. Players hitting level 11 will feel the wall. Either smooth
the transitions or document.

### F25 — MED: `bounties.checkAndCompleteBounty` `single_lift_weight` doesn't reset achieved per exercise

`src/lib/data/bounties.js:219-227`. The loop:
```js
for (const ex of workoutLog.exercises || []) {
  if (ex.name?.toLowerCase() === exercise_name.toLowerCase()) {
    for (const s of ex.sets || []) {
      if ((Number(s.weight) || 0) > (achieved ?? 0)) achieved = Number(s.weight);
    }
  }
}
```
If the user logged the same exercise twice in one workout (warmup +
working sets), `achieved` correctly takes the max across both. OK.
The bug: `achieved` is initialized to `null` (line 208) and the
comparator `(Number(s.weight) || 0) > (achieved ?? 0)` works. Fine.
But the lower-bound test at line 239 is `achieved <= target_value` —
when `achieved` is exactly the target value (you tied your record),
it's NOT counted as a beat. Should it be `<`? The wording "beat
{target}" suggests exclusive, so OK — but a user matching their
nemesis's max weight gets nothing.

### F26 — MED: `reportError` is not failure-aware about Sentry rate limits

`src/lib/reportError.js:36-76`. If Sentry rate-limits or fails, the
inner try/catch swallows it and logs in dev only. In prod, that
failure is invisible. Add a small backoff / counter so an outage
where Sentry is rejecting calls doesn't get re-tried hundreds of
times per minute.

### F27 — LOW: `conversationArchive.partitionByArchive` mutates localStorage during read

`src/lib/conversationArchive.js:60-79`. Inside the loop it calls
`unarchive(c.id)` — that's a write to localStorage on every read of
the inbox. Each call serializes the whole map. For a user with 50
archived conversations, that's 50 unnecessary writes. Buffer the
unarchives and write once at the end.

### F28 — LOW: `regimens.copyTemplate` writes user_profiles' email-prefix as author name

`src/lib/data/regimens.js:48-49`. Falls back to
`original.created_by?.split('@')[0]` — that's the original user's
EMAIL local-part, exposed verbatim in the copy. If the original user
had email `firstname.lastname@gmail.com`, every copy now displays
"firstname.lastname" as the author. Privacy concern. Use the
original's username if known, else "Unknown".

### F29 — MED: `inventory.removeItem` doesn't unlist before delete

`src/lib/data/inventory.js:49-56`. If a marketplace listing is
referencing this inventory row via FK with ON DELETE RESTRICT, the
delete fails. Should check `is_listed` first and either fail with a
helpful message or call `cancel_marketplace_listing` first.

### F30 — LOW: `bounties.bountyDescription` hardcodes "lbs" for weekly_volume bounties

`src/lib/data/bounties.js:81-88`. The metric is `weekly_volume` —
that's lbs in the user's stored units. But if the user prefers `kg`,
the description still says "lbs". Use `weightUnit` to render
unit-aware.

### F31 — MED: `streakRescue.shouldShowStreakRescue` evaluates time AFTER all gates, so card flashes after 6pm crossing

`src/lib/streakRescue.js:44-55`. Pure function — fine. But: the
caller likely re-renders on a 15-minute timer. At 5:59pm the card
isn't shown (TRIGGER_HOUR check); at 6:01pm it is. No DST guard.
On the DST spring-forward day, `now.getHours()` skips an hour — the
card never appears at 6pm if 6 doesn't exist that day. Edge case.

### F32 — LOW: `hubMessages.markRead` sends one RPC per unread message

`src/lib/data/hubMessages.js:285-294`. `Promise.all` of N
`mark_message_read` RPCs. For a conversation with 200 unread (returning
user), that's 200 round-trips. Add a `mark_conversation_read_for`
RPC that takes the conversation_id and flips all in one statement.

### F33 — LOW: `duels.cancelDuel` uses 'declined' status — duel history confusion

`src/lib/data/duels.js:299-309`. Cancelled and declined duels share
the same `'declined'` status. The history view can't tell whether
the OPPONENT declined or the CHALLENGER cancelled. Add a `'cancelled'`
enum value (requires a migration).

### F34 — MED: `bounties.generateDemoBounties` is exposed publicly

`src/lib/data/bounties.js:267-360`. Comment says "beta / client-side"
— but if the function is callable from any user account, anyone can
spam the bounty board with up to 3 bounties per call. There's no
rate-limit on the client; only the RLS policy on `bounties` table
constrains the insert. Server-side check should reject for non-admin
users in production.

### F35 — LOW: `notifications.markRead` swallows errors silently

`src/lib/data/notifications.js:82-95`. Errors are reported but the
function returns `undefined` either way — caller can't distinguish
success from failure. Return `{ ok: bool }`.

### F36 — MED: `weeklyRecap.computeWeeklyRecap` mistakes weight format

`src/lib/data/weeklyRecap.js:88-97`. `Number(set.weight) || 0` —
Supabase numeric columns often return strings. `Number("0") === 0`,
`Number(null) === 0`. Fine. But Stone/kg unit drift: weeklyRecap is
in LBS (the storage unit), but if a `weight_kg` field ever leaks in
because a caller renamed the field, the volume rolls up in mixed
units silently. Test for unit invariants.

### F37 — LOW: `prestige.getPrestigeProfile` uses `.single()` which errors for missing rows

`src/lib/data/prestige.js:50-58`. New users without a profile row
yet (unlikely but possible mid-onboarding) get error from `.single()`
— returns null via `error ? null : data`. Use `.maybeSingle()`.

### F38 — MED: `gauntlet.completeCommunityGauntletAttempt` non-atomic counter bumps

`src/lib/data/gauntlet.js:207-220`. Two atomic writes: one to
update the attempt, one to update the gauntlet counters. Race
window between them — concurrent completions can both read the same
`attempt_count` and both write +1, losing one increment. Use an
`increment_gauntlet_counter` RPC or `UPDATE ... SET attempt_count =
attempt_count + 1` in one statement.

### F39 — LOW: `marketplace.listActive` filters on `available_from` / `available_until` using `.or()` clauses but with implicit AND across the two `.or` calls

`src/lib/data/marketplace.js:12-29`. Two consecutive `.or()` calls
become AND between them at the supabase-js level. That's the intent.
But this is brittle — a future maintainer changing one `.or()` could
break the seasonal-window logic in non-obvious ways. Refactor as a
single `.and()` of two `.or()` groups.

### F40 — LOW: `crews.getRegimenCloneCount` doesn't validate the regimen exists

`src/lib/data/crews.js:303-316`. Returns 0 for missing regimen OR
for regimen with copy_count=0. Caller can't distinguish "deleted"
from "nobody's copied it." Probably OK, but a follow-up "is this
deleted?" check could prevent stale UI.

### F41 — LOW: `bounties.checkAndCompleteBounty` `single_lift_reps` ignores weight

`src/lib/data/bounties.js:228-237`. "Max reps on a specific
exercise" only counts the reps, not the weight at those reps. So
20 reps at 0lbs (warmup / form practice) beats 12 reps at 225lbs.
This is technically per-spec but arguably should require weight >=
some baseline.

### F42 — MED: `db.js` updateMe doesn't preserve `created_at` on profile row insert

`src/api/db.js:218-260`. Upsert payload doesn't set `created_at`.
For a brand-new user where the row doesn't exist yet, the trigger /
default handles it. But if the trigger isn't applied (some hosts
have only some triggers), `created_at` lands as NULL. Defensive:
include `created_at: existing?.created_at || new Date().toISOString()`.

### F43 — LOW: `safeSelect` accepts unbounded retry budget for partial misses

`src/api/safeSelect.js:104`. 20 retries is plenty for normal use,
but combined with the OUTER retry on `db.js` create (15 retries) +
the safeSelect retry could compound to 300 attempts. Document the
maximum compound attempt count.

### F44 — MED: `xpSystem.calculateWorkoutXp` weights bodyweight reps at 0.5 XP each

`src/lib/xpSystem.js:130-133`. Bodyweight set: `Math.min(reps * 0.5,
20)` — caps at 40 reps. So 100 push-ups gives same XP as 40 push-ups.
At scale, dedicated bodyweight athletes get under-rewarded. Document
the cap.

### F45 — LOW: `stories.sendStoryReply` doesn't gate on viewer being blocked by recipient

`src/lib/data/stories.js:281-305`. The `_recipientAllowsDmReplies`
check only validates `story_dms_disabled`. A user who story-blocked
the viewer could still receive their story reply via the find-or-
create-conversation path. Cross-check `story_blocks`.

### F46 — LOW: `duels.acceptDuel` / `declineDuel` don't validate caller is the OPPONENT

`src/lib/data/duels.js:269-289`. Server-side RLS may enforce it, but
this is unclear from the code. If RLS allows any participant, the
CHALLENGER could "accept" their own duel and bypass the opponent's
consent. Add a status precondition + RLS check.

### F47 — LOW: `personalRecords.bestPRForExercise` filters case-insensitively but doesn't normalize whitespace

`src/lib/data/personalRecords.js:38-42`. `"bench press"` and `"bench  press"`
(double space) and `"bench-press"` produce different keys. A user
who renamed their exercise loses their PR history. Normalize to a
canonical form (`replace(/\s+/g, ' ').trim()`).

### F48 — LOW: `db.js` _invokeXp doesn't await the milestone capsule grant

`src/api/db.js:464-471`. `grantForAchievementMilestone(...)` is
awaited inside the try, but the function returns the result of step 4
which doesn't include the milestone capsules in the outer result.
The caller (Workout.jsx, etc.) gets `{ ok: true }` and doesn't know
which milestone capsules were just granted. Currently a `window`
event fires, but a return-shape with the granted milestones would
let the caller render a richer toast.

### F49 — LOW: `conversationArchive.partition` doesn't filter by sender — auto-unarchives on YOUR OWN message

`src/lib/conversationArchive.js:65-77`. If you archive a conversation
then send a message into it, `last_message_at` updates → archive
state cleared. So you can't archive a conversation and still write
in it. Maybe intentional (you re-engaged so it shouldn't be hidden),
but worth documenting.

### F50 — LOW: `reportError` includes `userEmail` in tags by default — GDPR concern

`src/lib/reportError.js:56`. `scope.setUser({ email: userEmail })`
ships the email to Sentry on every call. For EU users this needs an
explicit consent gate. Either anonymize (hash the email) or require
opt-in from the user before passing it.

---

## File coverage

Read in full: `src/api/db.js`, `src/api/safeSelect.js`,
`src/api/supabaseClient.js`, `src/lib/xpSystem.js`,
`src/lib/intl.js`, `src/lib/weightUnit.js`,
`src/lib/workoutVolume.js`, `src/lib/achievementDefinitions.js`,
`src/lib/conversationArchive.js`, `src/lib/reportError.js`,
`src/lib/recoveryScore.js`, `src/lib/workoutMemories.js`,
`src/lib/oneRepMax.js`, and ~30 files under `src/lib/data/`.
Did not deep-read every data file; spot-checked
`hubMessages`, `loginStreak`, `workoutStreak`, `quests`, `goals`,
`regimens`, `nemesis`, `hubFollows`, `leagues`, `notifications`,
`crews`, `inventory`, `marketplace`, `gauntlet`, `bounties`,
`duels`, `stories`, `weeklyRecap`, `userBlocks`, `userMutes`,
`cycleLogs`, `sleepLogs`, `moodLogs`, `crewWars`, `crewChallenges`,
`hubComments`, `hubCommentLikes`, `hubPosts`, `dataExport`,
`me`, `capsules`, `serverFunctions`, `organizations`,
`personalRecords`, `journal`, `prestige`, `useAuthors`,
`debriefs`, `streakRescue`, `coinShop`, `coinGifts`,
`duelInvites`, `nutrition`, `cardio`, `workouts`, `bodyMetrics`,
`achievements`, `foodItems`, `periodLeaderboard`,
`trainingPatterns`, `conversationRequests`, `calorieCycling`.
