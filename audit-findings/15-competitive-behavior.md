# 15 — Competitive features user-visible behavior audit

Scope: Duels, Bounties, Gauntlet (personal path + weekly community),
Nemesis, Leagues (weekly), Crew Wars, Crew Challenges, duel-invite-link
flow. Read-only audit — no code changes. Findings ordered by severity.

Severity: **HIGH** (security / economy / correctness), **MED** (visible
UX bug or i18n), **LOW** (cosmetic, edge-case, polish).

---

## HIGH

### H1 — Crew War XP contribution amount is fully client-controlled
`src/lib/data/crewWars.js:74` `supabase/migrations/076_crew_war_contribute_atomic.sql:51`
The atomic RPC `contribute_crew_war_xp(p_war_id, p_crew_id, p_xp)` only
validates `p_xp > 0`. The actual amount is passed from the client
(`src/pages/Workout.jsx:840` passes `xpGained`), so any authenticated
crew member can call the RPC directly with an arbitrary positive integer
and pump their crew's score to a guaranteed win. There's no server-side
correlation between the contributed XP and a real workout log, league
delta, or any other ground-truth signal. Combined with the fact the RPC
fans out to opponents' notifications on resolution, this is the most
exploitable competitive surface in the app.

### H2 — Crew-challenge `updateChallengeProgress` writes client-controlled value
`src/lib/data/crewChallenges.js:95` Admins can call
`updateChallengeProgress(id, currentValue)` with any number — RLS gates
admin-only writes but doesn't gate the *value*. A crew admin can mark
their own challenge as "100% complete" instantly, firing the celebration
push (`notify_crew_challenge_completed_for`) for every crew member.
Same shape for `setChallengeStatus(id, 'completed')` at line 106.

### H3 — `checkAndCompleteBounty` uses strict `>` against target_value
`src/lib/data/bounties.js:239` Condition `achieved <= target_value`
fails the user when they hit EXACTLY the target. Every bounty says "beat
X" so equality should arguably win — at minimum the UI says "beat 315"
and a 315 lift won't qualify. Subtle but reproducible.

### H4 — `weekly_volume` bounties only count the current session's volume
`src/lib/data/bounties.js:210-218` The client-side completion check sums
volume from the single `workoutLog` passed in. A `weekly_volume` bounty
with a 50,000 lb target is only winnable in one single workout that
exceeds 50K — there's no rolling 7-day aggregation. Same bug for the
`bountyDescription` helper at line 87 which slaps "lbs" on weekly_volume
descriptions regardless.

### H5 — League standings expose email local-parts to all league members
`src/components/dashboard/LeagueStandingsModal.jsx:163` Display name
falls back to `m.user_email?.split('@')[0]`. If my email is
`john.smith.real@gmail.com`, the other 29 members of my league see
`john.smith.real`. This is a meaningful PII leak — the username should
be looked up from `user_profiles` and the email local-part should never
appear in any user-visible string. CrewWarPanel has the same issue
(line 51: `'Member'` is at least anonymous, but the ContribRow renders
no name at all → confusing UX even if not a privacy leak).

### H6 — `assignNemesis` doesn't filter blocked / muted users
`src/lib/data/nemesis.js:63-83` Candidate query filters by
`nemesis_opt_out=false` and `total_xp` range but never consults the
caller's `hub_blocks` or `hub_mutes`. A user who has blocked someone
can still get them assigned as their nemesis, with a celebratory
"Meet your nemesis: @Blocked-Person" push (line 133). The fallback
random-pool path (lines 75-84) is even more permissive — no XP filter
at all, so a brand-new user can be paired with a top-XP user they
will never overthrow.

### H7 — `assignNemesis` archive+insert is not atomic
`src/lib/data/nemesis.js:91-109` Steps: archive old → insert new. If
the insert fails (network blip, RLS issue) after the archive succeeds,
the user is left with NO active nemesis until they re-trigger assign.
The reroll button (`NemesisCard.jsx:167`) appears to work on tap but
silently drops their nemesis assignment when it half-fails.

### H8 — `createDuel` accepts opponentId === user.id (self-duel)
`src/lib/data/duels.js:197` No client-side check that
`opponentId !== user.id`. The CreateDuelModal search excludes self
(`.neq('id', currentUserId)`) but other entry points (the Nemesis
challenge button passes `assignment.nemesis_id`, the duel-invite landing,
external claim flow) don't. A nemesis assigned to your own account
(can happen if assignNemesis returns yourself via the unrestricted
fallback pool in a tiny user base) would let you duel yourself. Self-
duel rows confuse `resolveDuelWinner` because `challenger_id ===
opponent_id`.

### H9 — Weekly gauntlet counter bump is a client-side read-modify-write race
`src/lib/data/gauntlet.js:207-213` After
`distribute_league_rewards`/`completeCommunityGauntletAttempt`, the
client reads the gauntlet's `attempt_count` + `completion_count`, adds
1, and writes back. Two users finishing simultaneously both read 5,
both write 6 — one attempt lost. Trivial repro at any moderate scale.

### H10 — `submitDuelResult` legacy fallback path silently allows submitting twice
`src/lib/data/duels.js:376-388` The legacy non-atomic path doesn't check
that `result` field isn't already populated for the caller before
overwriting. If you call `submitDuelResult` twice (slow network → user
taps Submit twice), the second call overwrites your first result. The
RPC path (079) takes a FOR UPDATE lock so it's safe, but
hosts/deployments without 079 still execute the legacy code on 42883/
42P01.

---

## MED

### M1 — `Duels.jsx` references `tFallback` without destructuring it
`src/pages/Duels.jsx:81` `const { user } = useAuth();` but the JSX
uses `tFallback('duels.title', 'Duels')` at line 146 and many others.
`useLanguage()` is never called, so every `tFallback` reference in the
file is a ReferenceError. The Duels page is currently render-throwing
in production unless tree-shaking eliminates the bindings. Adjacent:
the `t` import is also missing.

### M2 — DuelDetailSheet header says "@Opponent Won" when profile fails to load
`src/components/duels/DuelDetailSheet.jsx:32,81` `opponentName` defaults
to the string `'Opponent'`, so the literal "@Opponent Won" renders
whenever `opponentProfile` is null (deleted account, RLS scoping,
network blip). Should fall back to "Your rival won" or similar.

### M3 — NemesisCard infinite-skeleton when nemesis username is null
`src/components/nemesis/NemesisCard.jsx:107` Condition
`profileLoading || !name` returns the skeleton card. If the nemesis
account has a null username (deleted-but-not-cascaded, or a profile
with avatar but no username), `profile?.username` is null, `name` is
falsy, and the user sees a perpetual loading skeleton forever. There's
no "your nemesis is no longer available — reroll" branch.

### M4 — `getActiveDuel` and `DuelBanner` rely on `expires_at` but `acceptDuel` doesn't push it
`src/lib/data/duels.js:269` Pending duel has `expires_at = createdAt +
windowHours`. When the opponent accepts, status flips to 'active' but
`expires_at` isn't extended — the window started ticking the moment
the challenger created the duel. If an opponent sits on a 24h pending
duel for 23h then accepts, they have 1h to complete, not 24h. The
DuelBanner countdown reads as a normal 1h window with no indication
this is unusual.

### M5 — `cancelDuel` reuses 'declined' status, losing intent
`src/lib/data/duels.js:299-309` Comment acknowledges the duel_status
enum has no 'cancelled'. Result: the opponent's history shows your
withdrawn duel under "Declined" with no signal it was withdrawn by
you. The opponent can't distinguish "they backed out" from "I declined".

### M6 — CrewWarPanel marks ties as "Leading"
`src/components/crews/CrewWarPanel.jsx:220`
`winning = myScore >= theirScore` — a tie (e.g. 1000 vs 1000) renders
the "Leading" badge AND the primary-color score bar. Should be `>`,
with a separate "Tied" state.

### M7 — CrewWarPanel keeps "Xh left" header on completed wars
`src/components/crews/CrewWarPanel.jsx:240,275` When `war.status ===
'completed'`, the panel still renders the "5h left" / "Ending soon"
header AND the "Victory!"/"Defeated" footer simultaneously. The
top-line countdown should hide for completed wars.

### M8 — `formatDistanceToNow` and `formatDistanceToNow` calls hardcode English
Multiple files: `BountyCard.jsx:28`, `BountyBoard.jsx:58`,
`CrewWarPanel.jsx:270`, `CrewChallengeCard.jsx:198`,
`DuelInviteCard.jsx` (where used). `date-fns/formatDistanceToNow`
takes an optional `{ locale }` param — none of these pass it, so
"5 days ago" stays English across all 15 supported languages. Violates
the project's i18n discipline.

### M9 — `WeeklyGauntletCard` string-concatenates `week_end + 'T23:59:59'`
`src/components/gauntlet/WeeklyGauntletCard.jsx:35` Assumes `week_end`
is a plain `YYYY-MM-DD` (no time, no TZ). If the column is ever an ISO
timestamp the concatenation produces `2026-05-25T00:00:00ZT23:59:59`
which parses to NaN. Also: no timezone applied, so "5 days left" can
disagree with what the server thinks the end is by up to ±1 day.

### M10 — `WeeklyGauntletCard` always labels target as "lbs"
`src/components/gauntlet/WeeklyGauntletCard.jsx:87` Renders
`formatVolume(passing_threshold) lbs` regardless of the gauntlet's
metric. If a weekly gauntlet uses `consecutive_days` or `sessions_in_7_days`
the goal reads "7 lbs" which is nonsense.

### M11 — Failed weekly-gauntlet attempts lock you out for the rest of the week with no message
`src/components/gauntlet/WeeklyGauntletCard.jsx:62-65,105` On
`attempt.status === 'failed'` the card shows a small "Failed" pill and
hides the CTA. No retry guidance, no "comes back next Monday" copy.

### M12 — CreateBountyModal disclaimer wrong about who pays what
`src/components/bounties/CreateBountyModal.jsx:179` Tooltip reads
"When someone beats your target, they claim the reward and you lose
the entry fee." But per `DIFFICULTY_CONFIG`, the CLAIMER pays the
entry fee at claim time; the TARGET pays the *reward* when beaten.
The disclaimer inverts the economy. Real cost to the bounty-poster
is the reward (60-175 coins), not the entry fee (10-20 coins).

### M13 — `checkOverthrow` third condition (XP) is structurally dead
`src/lib/data/nemesis.js:219-224` Nemesis was assigned because their
total_xp is 10-20% higher than mine. The third overthrow condition is
`userXp > nemesisXp` (total, not weekly). For me to satisfy it, I'd
need to earn enough XP this week to overtake them in *total* — an
order of magnitude more than what the volume/sessions conditions need.
In practice, overthrow always requires winning the two achievable
conditions (volume + sessions), so it's effectively a 2-of-2, not 2-of-3.

### M14 — DuelInviteLanding `isOwnInvite` check never triggers
`src/pages/DuelInviteLanding.jsx:168-169` Checks `user.username` —
but `useAuth().user` is the Supabase auth user, which has no
`username` property (that's on `user_profiles`). The check always
yields false, so a challenger opening their own invite link sees the
"Accept" button. Server-side `cannot_claim_own_invite` then errors,
which the UI handles correctly (line 86), but the better UX (show the
copy-link affordance) never fires.

### M15 — League "Top N promoted" / "Bottom N demoted" can overlap in small leagues
`src/components/dashboard/LeagueStandingsModal.jsx:96-111` Silver
league with 10 members shows "Top 10 promoted · Bottom 5 demoted" —
but with promote-first resolution, all 10 promote and none demote.
The user sees both promo + demo highlights on the same row and gets
confused about what tier they'll be in next week.

### M16 — DuelInviteCard renders the challenger's stale username from the DM payload
`src/components/duels/DuelInviteCard.jsx:113-119,60` The shown
`@challengerUsername` and avatar come from `payload` parsed out of
the DM body. The payload is stamped at duel-creation time
(`sendDuelDM` in `duels.js:107`). If the challenger updates their
username after sending, the recipient still sees the old @-handle.
Plus: anyone with insert access to that conversation could spoof
`challengerUsername` to phish the recipient. Better to re-fetch via
`duelId` after parsing.

### M17 — `notify_duel_invite_for` swallowed on `42883/42P01` leaves opponent with no signal
`src/lib/data/duels.js:230-235` On pre-migration hosts the
notification RPC errors with 42883/42P01 and is silently swallowed.
`sendDuelDM` is also fire-and-forget. Combined, an opponent on a
stale-deployment server can receive a duel they never see — no DM,
no push, no in-app row. The duel sits as pending until it expires.

### M18 — Gauntlet stats modal's "Less than 5%" threshold can show 0% as "Less than 5%"
`src/components/gauntlet/GauntletStatsModal.jsx:178-184` If
`completion_rate_pct === 0` (you're literally the first to clear
this challenge), the copy reads "Less than 5% of athletes have done
this. Rare." — but the truthful copy would be "You're the FIRST."
Slightly cooler moment lost.

### M19 — DuelBanner expires_at countdown updates every 60s — last minute jumps from "1m" to "Expired"
`src/components/duels/DuelBanner.jsx:31` `setInterval(... 60_000)`.
A user finishing a duel in the last minute of the window sees
"1m remaining" frozen until the interval fires and the banner
disappears entirely. Should refresh more frequently in the last few
minutes, or render a real `<time>` with a seconds-precision tick.

### M20 — `getActiveCommunityGauntlet` returns most-recent active without uniqueness guarantee
`src/lib/data/gauntlet.js:123-132` If two `weekly_gauntlets` rows are
ever `status='active'` simultaneously (cron misfire, manual seed),
the page silently shows only one — and `getCommunityGauntletAttempt`
will join against a different gauntlet than the user thinks they're
attempting.

---

## LOW

### L1 — `Duels.jsx` Wins / Losses tile only renders when wins>0 OR losses>0
`src/pages/Duels.jsx:170` A user with only ties (TIE outcomes) sees
no record block at all. Edge case but visible.

### L2 — `Duels.jsx` Wins counts pending duels with non-null winner_id as wins
`src/pages/Duels.jsx:135` `duels.filter(d => d.winner_id === user?.id)`
omits the `status === 'completed'` filter. If `winner_id` is ever
preemptively set (e.g. by the legacy submit fallback on the first
write), the user's W count includes in-flight duels.

### L3 — `frequentOpponents` counts declined / expired duels in the H2H
`src/lib/data/duels.js:14-51` `getFrequentOpponents` increments
`stats[opId].count++` for every duel row regardless of status. A user
who's been challenged and declined 5 times by the same person shows
up as "5x rival" in the suggested list. Should probably only count
`completed` duels.

### L4 — Bounty `Already-claimed` UI says "Someone else already claimed this bounty"
`src/components/bounties/BountyCard.jsx:48` Toast doesn't include
which user claimed. Fine, but the same card visually goes "dimmed +
Lock + Claimed" — the Claim button stays interactive momentarily
while the dim transition runs. Brief flash of stale state.

### L5 — `GauntletPath` slices title at 14 chars (`.slice(0,13)+'…'`)
`src/components/gauntlet/GauntletPath.jsx:240` Naive byte slice
breaks multi-codepoint emoji (flag emoji sequences are 2+ code units).
Also: German `Wöchentliches Volumen` gets cut to "Wöchentlich…" —
loses meaning.

### L6 — `getMyDuels` limit=50 silently caps history
`src/lib/data/duels.js:252` After 50 duels (status in
pending/active/completed), older completed rows fall off the list
without pagination affordance. Heavy users hit this within months.

### L7 — `formatVolume` in WeeklyGauntletCard uses `K`/`M` suffix without `tFallback`
`src/components/gauntlet/WeeklyGauntletCard.jsx:17-21` Hardcoded
"K"/"M" suffixes. Most locales accept these but Japanese/Korean
typically expect 万/억. Low impact.

### L8 — Crew Wars contributions show "Member" placeholder for every other contributor
`src/components/crews/CrewWarPanel.jsx:51` Generic "Member" text on
every non-self row. Even resolving username via a single
`user_profiles.in('id', userIds)` lookup (the same pattern crews.js
uses on line 95-105) would dramatically improve the panel.

### L9 — `BountyCard` time-left "less than a minute" rounds to "less than a minute" via date-fns default
Same `formatDistanceToNow` chain as M8 — when timeLeft is 30s,
date-fns says "less than a minute" rather than "<1m". Minor wording
issue across competitive countdowns.

### L10 — Nemesis fallback pool picks top-XP users for new users
`src/lib/data/nemesis.js:75-84` If a brand-new user's xpHigh < 50,
`effectiveLow=0`, `effectiveHigh=5000` — pool is anyone with
`total_xp ∈ [0, 5000]`. The sort by `|a.total_xp - me.total_xp|`
then picks the lowest-XP candidates, which for a fresh user with 0
XP means other fresh users. OK in spirit, but the empty-pool fallback
path on line 76 has NO XP filter — purely random from the full user
base.

### L11 — `assignNemesis` picks randomly from "top 3" by XP distance
`src/lib/data/nemesis.js:89` On a pool of 1, `Math.random()*1=0` picks
that one. On a pool of 2, picks 0 or 1. Fine, but the comment says
"closest XP match (or random from fallback pool)" — actual behavior
is "random from top 3 closest" which biases against the closest.

### L12 — LeagueStandingsModal `days left` clamps to 0 but doesn't say "Resolves now"
`src/components/dashboard/LeagueStandingsModal.jsx:73` On Sunday after
midnight (in user TZ but before server cron rolls), `daysLeft = 0`
shows "Days left: 0" rather than "Resolving soon" / "Awaiting rollover".

### L13 — `CrewChallengeCard.ends_at` description uses `formatDistanceToNow` future-tense
`src/components/crews/CrewChallengeCard.jsx:198,204` Future date →
"ends in 5 days" reads fine. Past date (expired challenge in
`includeExpired` mode) → "ends 5 days ago" reads nonsensical for
a state called "expired". Need a status-aware label.

### L14 — `DuelBanner.timeRemaining` shows "Xm remaining" with no zero-pad
`src/components/duels/DuelBanner.jsx:13-20` `{h}h {m}m remaining`
renders `5h 7m remaining` and `5h 0m remaining` — the latter looks
buggy. Convention is to drop the minutes when zero or pad to two
digits.

### L15 — `acceptDuel` doesn't refresh `expires_at` (linked to M4) and DuelInviteCard auto-accepts without confirmation
`src/components/duels/DuelInviteCard.jsx:65-78` Single-tap Accept,
no confirm. Combined with stale expires_at + 24h window, an opponent
who taps Accept on a duel sent 23h ago is committed to a 1h duel
without warning.

### L16 — `BountyBoard` "Generate Bounties (Beta)" button visible in production
`src/components/bounties/BountyBoard.jsx:182-192,204-216` The
"Generate sample bounties" affordance is shown in the empty-state
and as a "Generate more" link after every list. The comment in
`generateDemoBounties` says "Production: this logic runs server-side
in the daily Edge Function cron." End users currently see the beta
seeder.

### L17 — `Bounties.jsx` Post-bounty button enabled even when user has no flex_coins
`src/pages/Bounties.jsx:49-56` The "Post" button is always
clickable; only when the CreateBountyModal submits does the user
see the validation. UX nit: would be nicer to disable + hint.

### L18 — Crew War "ending soon" threshold is "< 1 day"
`src/components/gauntlet/WeeklyGauntletCard.jsx:36` (similar
patterns elsewhere) Anything with hours instead of days shows
"ending soon" red badge. A war with 23h59m left has been "ending
soon" since the moment it started — the threshold should probably
be a smaller window like <6h.

### L19 — `getMyLeague` recursion can loop if `_resolveLeague` throws and skips state update
`src/lib/data/leagues.js:247` After resolving, calls `getMyLeague(user)`
again. If the resolve silently returns without flipping `is_resolved`
(pre-migration host on line 336-341 explicitly `return`s without
touching the row), the next call re-enters the same branch. Stable
state, but extra round-trip every render.

### L20 — DuelDetailSheet "Won by X lbs" caption only shows for `won && volumes both present`
`src/components/duels/DuelDetailSheet.jsx:110-114` Tied / lost
results never get the "Won by X / Lost by X" caption. Lost-by-3
duels feel symmetrical to lost-by-3000 to the loser — useful info
to surface.

---

## Out-of-scope but worth a follow-up

- The Nemesis/Duels/Bounties/Leagues/Crew-Wars systems all have
  notification-fan-out paths through SECURITY DEFINER RPCs. Did not
  audit RLS gaps on those RPCs — see audit 02 (rpc-auth-gating).
- No tests exist for: nemesis flow, crew wars contributions math,
  bounty completion checks across all 4 metrics, league resolution
  with N=1/2/30 members.
- The "League Standings" UI doesn't tell you which tier you'll be
  promoted/demoted to. Just shows green/red bands. Worth a one-line
  "Promote to Silver" / "Demote to Bronze" inline.
