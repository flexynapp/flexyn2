# Flexyn — total app critique, 2026-08-04

Executed against the brief in [app-critique-prompt.md](app-critique-prompt.md).
Every number below was measured today; nothing is carried over from a prior
audit without re-checking.

**Scope warning, stated up front:** Pass 1 (the four browser journeys) could
**not** be completed. The headless browser in this environment has no network
route to Supabase — `fetch()` to the project REST API returns `TypeError:
Failed to fetch` even through the session proxy, and installing the proxy CA
into Chromium's cert store was not possible (no `certutil`). I would not
disable TLS verification to work around it. So there are no screenshots, no
first-run timings, and no observations that depend on the app rendering real
data. Everything below is from the production database, the production build,
the source, and HTTP probes against the real API. Section 6 lists exactly what
that leaves unverified — it is a lot, and it includes most of the visual and
interaction critique the brief asks for.

---

## 1. Verdict

Flexyn is a well-engineered gamification platform that is not being used as a
fitness app: in three months of production it has accumulated **3 workout logs
from 2 users** against **366 auto-generated daily-quest rows**, and the single
heaviest user has 20,075 coins at level 5. The engineering is genuinely
careful — 2,578 passing tests, layered error boundaries, RLS on every table I
probed, three of the June blockers verifiably fixed — but that care is
distributed evenly across 32 pages and ~140 tables, most of which nobody has
ever touched. There is one live S0: an unauthenticated endpoint that converts
any username into that user's email address, verified over plain HTTP with the
public key. Two more S0-class problems are structural rather than exploitable —
"delete account" does not delete the account and misses 54 user-owned tables,
and there is still no privacy policy or terms surface anywhere in the app,
eight weeks after both were filed as launch blockers. **If I could change one
thing it would not be any of those: it would be to find out why 26 people
finished a 14-step onboarding and then 24 of them never logged a single
workout**, because every other number in this document is downstream of that.

---

## 2. Ground truth

| Measure | Value | Note |
|---|---|---|
| Auth users / profiles | 34 / 34 | first signup 2026-05-03 |
| Completed onboarding | 26 | 76% of signups |
| **Workout logs, all time** | **3** | from **2** distinct users |
| Last workout logged | 2026-07-26 | 9 days ago |
| Cardio logs | 3 | — |
| Nutrition logs | 105 / 6 users | current — last one today |
| Daily-quest rows | 366 / 26 users | **122× the workout count** |
| Capsules / inventory / notifications | 286 / 276 / 268 | auto-generated |
| Max total XP / level | 559 / 5 | across all users |
| Max flex coins | 20,075 | at level 5 |
| Signed in last 30d / 7d | 14 / 4 | — |
| `push_subscriptions` | 0 | unchanged |
| Tests | **2,578 passing / 180 files**, 79.6s | CLAUDE.md said 2366/167 — stale |
| ESLint (no `--quiet`) | **215 warnings, 0 errors** | CLAUDE.md said 141; June said 192 |
| Production build | clean | 159 JS chunks, 11 MB raw, ~2.5 MB gz |
| **Eager critical path** | **556 KB gzipped** | before any page chunk |
| Migrations in tree | 304 | — |
| Edge functions deployed | **4 of 6** | `checkout-session`, `friendRecapEmail` absent |
| Security advisors | 362 lints | 1 ERROR · 351 WARN · 10 INFO |
| Anonymous sign-ins | **enabled** | makes `anon` trivially reachable |

The first three rows are the whole critique. A fitness app with 26 onboarded
users and 3 workouts is not a fitness app yet.

---

## 3. Top 10

### F1 — Any username can be converted to that user's email address, unauthenticated · S0 · everyone · fix XS

**Claim.** `public.resolve_profile_email` is `SECURITY DEFINER`, has no
`auth.uid()` gate of any kind, and is `EXECUTE`-able by `anon`. It returns the
email address for any `p_username` or `p_id`.

**Evidence.** Verified over real HTTP with only the anon key — which is baked
into the production JS bundle and therefore public — and **no** `Authorization`
header:

```
POST /rest/v1/rpc/resolve_profile_email   {"p_username":"kegan"}
→ 200  "<redacted>@gmail.com"
```

Control, same key, same request signature: `GET /rest/v1/user_profiles?select=email`
→ `200 []`. So RLS on the table is correct and the function is the hole.
Confirmed a second way in-database: `SET LOCAL role anon` returns the address
while a direct `SELECT count(*) FROM user_profiles` under the same role returns 0.

**Cost.** Every user's email is harvestable by anyone who can see a username,
and usernames are public by design — they are the `/@username` URL, they are on
the Hub and the leaderboards. 34 addresses today; the enumeration cost is one
request each and does not grow.

**Fix.** `REVOKE EXECUTE ON FUNCTION public.resolve_profile_email(uuid, text)
FROM anon, PUBLIC;` and add an `auth.uid() IS NULL → RAISE` guard inside. The
three client call sites (`HubProfile.jsx:458`, `hubMessages.js:111`, and the
`duels.js` path) all run authenticated, so nothing breaks. SQL is at the bottom
of this document.

**Confidence.** `verified`.

**This is not an oversight — it is a documented decision that aged badly.**
Migration 213 swept `anon` EXECUTE off ~190 SECURITY DEFINER functions and
explicitly *excluded* this one, with the reasoning written in the file head:

> *"resolve_profile_email returns email to anon one row at a time; it's the
> documented single-row accessor from mig 195 and its removal is bound to the
> tracked email-off-public_profiles refactor — left as-is here on purpose."*

"One row at a time" is not a mitigation when the input is a public, enumerable
identifier — it is a loop. And the refactor it was waiting on has since landed
(mig 220 dropped email from `public_profiles`), so the condition that justified
the exception is gone and the exception stayed.

---

### F2 — "Delete account" does not delete the account, and misses 54 user-owned tables · S0 · everyone who tries · fix M

**Claim.** `_invokeDeleteAccount` (`src/api/db.js:604`) is a client-side
cascade that deletes from a hand-maintained table list, resets the
`user_profiles` row, and stamps `account_reset_at`. It never deletes
`user_profiles` and never deletes `auth.users` — a client cannot. The auth
identity survives, so a magic link to the same address re-enters the account.

**Evidence.** Read end to end (`db.js:604-850`). The final step is
`auth.updateMe({...})` setting fields to null — a reset, not a deletion. There
is no `delete-account` Edge Function deployed (only `send-push`,
`recognize-meal`, `storage-gc`, `generateWeeklyDebriefs` are ACTIVE), so there
is no service-role path that could do it either.

Separately, I diffed the cascade's table list against every `public` table
carrying a user-ownership column in the live schema. **54 tables are not
covered; 28 of them currently hold rows.** The ones that are unambiguously
personal:

| Table | Rows | What it is |
|---|---|---|
| `journal_entries` | 9 | private journal text — flagged in June, still missed |
| `weekly_debriefs` | 7 | generated personal summaries |
| `status_notes` | 6 | user-authored |
| `crews` / `crew_members` | 4 / 6 | — |
| `user_trophies` | 7 | — |
| `meal_plans` | 8 | — |
| `roll_call_responses` | 7 | — |
| `dm_message_reactions` | 6 | — |
| `hub_saved_posts` | 4 | — |
| `bug_reports` | 3 | free-text, often identifying |
| `routines` · `step_logs` · `nutrition_recipes` · `custom_quotes` · `story_highlights` | 1 each | — |

I excluded the ledgers (`flex_coin_ledger` 110, `xp_grant_log` 29,
`action_xp_ledger` 8) and shared catalogs (`food_items`, `admin_users`,
`recognize_meal_quota`) from that judgement — keeping those is defensible.

**Cost.** Apple 5.1.1(v) requires real deletion for any account-creating app;
GDPR Art. 17 requires erasure. The app collects weight, body photos, injuries,
mood, sleep and cycle logs. This is the single item most likely to fail review
outright, and it is also the one a user is most entitled to be angry about,
because the UI tells them it worked.

**Fix.** A `delete-account` Edge Function running under service role: the
cascade, `auth.admin.deleteUser(uid)`, and `storage.remove('<uid>/*')`. Derive
the table list from `information_schema` at runtime rather than maintaining it
by hand — the hand-maintained list is *why* it drifted by 54.

**Confidence.** `traced` for the code path; `verified` for the 54-table gap
(computed against the live schema).

---

### F3 — The app's core action has been performed 3 times in 3 months · S0 (product) · everyone · fix L

**Claim.** Flexyn is a workout app in which almost nobody logs a workout. The
gamification layer, which generates its own data, is 100× more active than the
fitness layer, which requires a user to do something.

**Evidence.** Exact counts, today:

| | Count | Users |
|---|---|---|
| `workout_logs` | **3** | 2 |
| `cardio_logs` | 3 | — |
| `nutrition_logs` | 105 | 6 |
| `user_daily_quests` | **366** | 26 |
| `user_capsules` | 286 | — |
| `notifications` | 268 | — |

26 users completed onboarding. 2 have ever logged a workout: a **7.7%
activation rate on the primary action**. The most recent workout is 2026-07-26,
nine days ago, and 4 users signed in during the last 7 days — so people are
still opening the app and still not logging.

Nutrition is the outlier in the good direction: 105 logs, 6 users, one logged
today. **Nutrition is 35× more used than workouts.** That is the most
interesting fact in this document and nothing in the product's structure
reflects it — Nutrition is the fifth tab.

**Cost.** Every feature built on top of workout data — PRs, progress charts,
volume leaderboards, duels, bounties, the gauntlet, crew wars, the AI coach's
history-aware programming — is running on 3 rows. The gym equipment picker
(6 migrations, July) has 0 rows in all four of its tables. `scheduled_workouts`
(August) has 0. `stories`, `training_spaces`, `referrals`, `crew_challenges`,
`crew_wars`, `trainer_listings`, `organizations`, `gym_checkins` — all 0.

**Fix.** Not a code fix. This is the product question in §5.

**Confidence.** `verified`.

---

### F4 — 95% of the app's success confirmations are invisible · S1 · everyone, every action · fix S

**Claim.** `src/lib/toast.js` suppresses every non-error toast that does not
carry an `action`. 271 of 283 `toast.success/info/message/warning` call sites
across the app do not carry one, so they render nothing at all. A successful
save is visually identical to a dead button.

**Evidence.** Parsed every call site's full argument span:

```
toast.success/info/message/warning calls : 283
  carry an `action` (user SEES it)       :  12
  silently suppressed (NO feedback)      : 271  (95%)
```

Worst offenders: `Workout.jsx` (13), `SettingsPanel.jsx` (10),
`HubMessages.jsx` (9), `HubPostCard.jsx` (9), `CrewChat.jsx` (8).

**Cost.** This is deliberate — the header comment says *"only ERROR toasts
surface … suppressed until we ship the new subtle press/completion cues"*
(kegan, Jul 2026). But the replacement cues were never shipped, so the app has
spent a month in a state where 271 user actions complete with zero
confirmation. CLAUDE.md already records this eating four rounds of work on the
My Gym feature — *"a working save produced no feedback whatsoever and looked
identical to a dead button"* — and treats that as a one-off trap. It is not a
trap; it is the default for 95% of the app. Given F3, "I tapped save and
nothing happened" is a live candidate explanation for why workouts aren't
getting logged.

**Fix.** Either ship the subtle cues or un-no-op `toast.success` for the ~30
call sites on primary flows (save workout, log meal, save regimen, complete
goal). One line in `toast.js` to unblock, plus triage.

**Confidence.** `verified` by static analysis of every call site. Not verified
on screen — see the scope warning.

---

### F5 — No privacy policy, no terms, no consent surface · S0 (legal) · everyone · fix S

**Claim.** There is no `/privacy` route, no `/terms` route, and no legal link
anywhere in `App.jsx`.

**Evidence.** `grep` for `path="/privacy"` / `path="/terms"` in `src/App.jsx`:
no matches. The only `privacy` hits in `src/` are `src/lib/privacy.js`, which
is profile-visibility logic, and one Hub component.

**Cost.** Blocker **C1** in the June audit, unchanged after eight weeks. The
app collects health and sensitive-category data (weight, body photos,
injuries, mood, sleep, cycle logs), hosts UGC and DMs. Apple 5.1.1(i) and
Google Play's Health policy both hard-require this; GDPR Art. 13 requires it
independently of any store.

**Fix.** Two static routes and a line of copy on the sign-in screen. Hours, not
days. It is the cheapest launch blocker on the list and it has not moved.

**Confidence.** `verified`.

---

### F6 — 14-step onboarding in front of a 7.7% activation rate · S1 · every new user · fix M

**Claim.** `Onboarding.jsx:2822` defines 14 steps before a user reaches the
app: `welcome, goal, sharpen, experience, age, height, weight, body_baseline,
days, assessment, injury_history, home_gym, loading, reveal`. The file is 3,682
lines.

**Evidence.** The step array above, plus F3's funnel: 34 signups → 26 completed
onboarding → 2 ever logged a workout.

**Cost.** Onboarding is not where users are dropping — 76% finish it. They drop
*after*. That inverts the usual read: the cost of the 14 steps is not
abandonment, it is that the app spends its entire first impression collecting
data and then, having asked for age, height, weight, experience, training days,
an assessment and an injury history, apparently fails to convert any of it into
a reason to log a workout on day one. Whatever the 12 questions promise, the
next screen isn't delivering it.

**Fix.** Not "cut steps". Instrument the first session after `reveal` and find
out what the 24 non-loggers saw. Then decide. Cutting onboarding without that
data would be guessing.

**Confidence.** `traced`. The funnel numbers are `verified`; the interpretation
is not, because I could not run the journey.

---

### F7 — The trainer marketplace calls an Edge Function that is not deployed · S1 · anyone who taps buy · fix XS

**Claim.** `src/lib/data/trainerMarket.js:136` invokes
`supabase.functions.invoke('checkout-session', ...)`. `checkout-session` is not
among the deployed functions.

**Evidence.** `list_edge_functions` returns exactly four ACTIVE:
`send-push` (v18), `recognize-meal` (v9), `storage-gc` (v6),
`generateWeeklyDebriefs` (v2). The repo has six under `supabase/functions/` —
`checkout-session` and `friendRecapEmail` have never been deployed.

**Cost.** Bounded today: `trainer_listings` and `trainer_purchases` both have 0
rows, so no user has hit it. But the surface is reachable and a tap produces a
failed function invocation. It was blocker **C3** in June for a different
reason (Apple 3.1.1 / IAP), and that reason still stands.

**Fix.** Feature-flag the paid trainer surface off for v1 — the "Coming Soon"
pattern already exists in `Market.jsx`. Do not deploy `checkout-session` to fix
this; selling digital goods through Stripe inside an iOS wrapper is the
rejection, not the missing function.

**Confidence.** `verified`.

---

### F8 — Pinch-zoom is still disabled app-wide, 8 weeks after being filed as a one-line blocker · S1 · everyone · fix XS

**Claim.** `index.html:62` still carries `maximum-scale=1.0, user-scalable=no`.

**Evidence.**

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0,
      maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
```

**Cost.** WCAG 1.4.4 failure, a known App Review accessibility flag, and it
compounds with F11 (818 uses of 9–11px text — a user who cannot read the
smallest type in the app also cannot zoom it). Blocker **C5** in June,
described then as a one-line fix.

**Fix.** Delete `maximum-scale=1.0, user-scalable=no`. There is a comment above
it explaining the intent was to kill accidental pinch-zoom; the correct fix for
that is `touch-action`, not disabling zoom globally.

**Confidence.** `verified`.

---

### F9 — 556 KB gzipped before the first page chunk · S2 · everyone, every cold load · fix M

**Claim.** The eager critical path — the scripts `index.html` loads or
modulepreloads — totals 556 KB gzipped (~1.9 MB raw) before any route chunk
starts downloading.

**Evidence.** Measured on a real production build:

| Chunk | gzip |
|---|---|
| `vendor-misc` | **268 KB** |
| `index` | 135 KB |
| `vendor-supabase` | 50 KB |
| `vendor-motion` | 40 KB |
| `vendor-dates` | 27 KB |
| `vendor-icons` | 19 KB |
| `vendor-query` | 12 KB |
| `vendor-sentry` | 4 KB |
| **total eager** | **556 KB** |

Then `Dashboard` (53 KB) on top. The lazy-loading discipline is otherwise
working — `vendor-tfjs` (361 KB), `maplibre-gl` (277 KB), `jspdf` (108 KB),
`html2canvas` (46 KB) are all correctly out of the critical path, and I
confirmed tree-shaking works by checking the built `vendor-misc` for Radix
primitives that nothing imports (`Menubar`, `NavigationMenu`, `HoverCard`: 0
occurrences).

**Cost.** On a throttled connection this is the difference between an app that
opens and one that doesn't. I could not measure real TTI (see scope warning),
so I am not quoting a seconds figure — the KB number is measured, the
user-facing consequence is inferred.

**Fix.** `npm run analyze` and attribute `vendor-misc`. React + ReactDOM +
Router account for roughly 55–60 KB gz of it; the other ~200 KB is unattributed
and is the lever. I did not identify what it is — see §6.

**Confidence.** `verified` for the byte counts; `suspected` that ~200 KB is
recoverable.

---

### F10 — Three competing user-identity columns, and the drift is already causing bugs · S2 · engineering · fix M

**Claim.** User ownership is expressed three different ways across the schema —
`created_by` (email), `user_id` (uuid), and `user_email` (email) — with no rule
about which applies where. `workout_logs` uses `created_by` + `user_id`;
`user_daily_quests` uses `user_id` + `user_email`; `user_blocks` uses
`blocker_id` + `blocker_email`; `user_mutes` uses `muter_id` + `muter_email`.

**Evidence.** Directly observable in `information_schema`. Three concrete
consequences, all already real:

1. F2's delete cascade has to enumerate `[table, idCol, emailCol]` triples by
   hand, which is exactly why it drifted by 54 tables.
2. `db.js:718` carries a comment recording a past production bug from assuming
   the convention — *"the previous bug … was caused by adding
   user_mutes/user_blocks to the user_id list when their actual columns are
   muter_id / blocker_id"*.
3. I hit it myself in the first five minutes of this audit: my initial
   ground-truth query failed with `42703: column "user_email" does not exist`
   on `workout_logs`. CLAUDE.md names referencing nonexistent columns as the
   repo's single most common defect class — this is the reason why.

**Cost.** Every new table is a coin flip, every cross-table query needs a
lookup, and the delete cascade silently rots with each migration. 304
migrations in, this compounds.

**Fix.** Pick `user_id uuid` as canonical, add it where missing, backfill,
and make the delete path derive its list from `information_schema` instead of a
literal array. Incremental — no big-bang migration needed.

**Confidence.** `verified`.

---

## 4. By severity — remaining findings

| # | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| F11 | S2 | **818 uses of 9–11px text** — June counted 817, so eight weeks of work moved it by one. Plus 1,219 `text-xs`. ~2,000 sub-14px instances, unzoomable because of F8. | `grep -o 'text-\[\(9\|10\|11\)px\]'` | Set a floor at 12px; audit the 9px tier |
| F12 | S2 | `public.public_profiles` view is `SECURITY DEFINER` — the only **ERROR** from the security advisor. Runs as owner, bypassing the caller's RLS. | `get_advisors(security)` | `ALTER VIEW … SET (security_invoker = on)` |
| F13 | S2 | `is_blocked(p_viewer_id, p_author_email)` is anon-executable and gates on a **client-supplied** viewer id, not `auth.uid()`. Leaks whether A blocked B. Same class as F1, much lower reach (needs a uuid *and* an email). | advisor + `pg_get_functiondef` | Revoke anon; gate on `auth.uid()` |
| F14 | S3 | Migration 213's anon sweep is a **one-time pass, not a policy**. 7 SECURITY DEFINER functions created after it (migs 216, 219, 221, 235, 243, 250, 264) are anon-executable today via the default PUBLIC grant. | `has_function_privilege('anon', …)` | `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` |
| F15 | S3 | **Not exploitable** — I probed all 7 over HTTP and PostgREST refuses to route them (`PGRST202`, wrong signature / trigger functions). Recording this so nobody re-raises F14 as a breach. | HTTP probes | none |
| F16 | S3 | ~25 dead `src/components/ui/*` wrappers with **zero** consumers (`avatar`, `tabs`, `popover`, `checkbox`, `select`, `table`, `sidebar`, `form`, `chart`…). `@radix-ui/react-toast` is an unused dependency. | consumer grep per wrapper | Delete; drop the dep |
| F17 | S3 | ESLint warnings grew 141 → 192 (June) → **215**, including `no-use-before-define` on `resetWorkout` in `Workout.jsx:884,904` — the exact TDZ pattern that caused the 2026-05-23 production crash, in the app's hottest file. | `npx eslint .` | Fix the TDZ hits; hold the line at 215 |
| F18 | S3 | Under an identical network failure, three public routes degraded gracefully ("Invite not found", "Profile not found", "Sign in to check in") and `/p/gym/:id` rendered a **completely blank page** — 8 DOM nodes, 0 characters. Controlled comparison; the failure was the same for all four. | browser probe | Add a failure/empty state to `PublicGymLanding` |
| F19 | S3 | `user_profiles` has **100+ columns**, carrying identity, gamification state, streaks, preferences, notification config, trainer status, gym, and cycle tracking in one row. | `information_schema` | Split the volatile gamification columns out |
| F20 | S3 | `.env.example` documents Base44 variables but **not** `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — the two the app cannot start without. A new contributor copying it gets a dead app with a console error. | `.env.example` vs `supabaseClient.js` | Add both |

---

## 5. Product calls — recommendations, not decisions

**P1. The data says this is a rewards app, not a fitness app. Decide whether
that's the product.** 366 quest rows / 3 workouts is not a ratio you tune your
way out of. Someone holds 20,075 coins at level 5 — the economy has fully
decoupled from the activity it was meant to reward. Either the gamification is
the product (in which case the fitness logging is a vestigial input and should
be radically simplified), or the fitness logging is the product (in which case
the gamification is actively crowding it out and should be demoted). Right now
it is being built as both, and the gamification is winning because it does not
require the user to do anything.

**P2. What I would cut.** The brief demands a specific answer, so: cut the
**corporate portal** (`organizations` 0 rows), the **trainer marketplace**
(`trainer_listings` 0, `trainer_purchases` 0, and it is an App Store rejection
risk), **crew wars and crew challenges** (0 and 0), the **gym equipment picker**
(6 migrations, 4 tables, all 0 rows), **stories** (0 rows, 6 tables), and
**scheduled workouts** (0 rows, shipped in August). That is roughly 20 tables
and a meaningful share of the last three months of work. Also collapse **duels,
bounties, gauntlet and crew wars** into one "challenge" concept — they are four
framings of "compete against someone", and the combined evidence for all four is
17 duels, 14 bounties, 10 gauntlet challenges and 0 crew wars.

What the app becomes: a workout and nutrition logger with streaks, quests,
levels, a Hub feed, and DMs. Roughly five surfaces instead of thirty-two. That
is a product 26 people could plausibly use, and it is testable against the one
signal that is actually positive.

**P3. Follow the nutrition signal.** Nutrition has 105 logs across 6 users and
one logged today; workouts have 3 across 2 users and nothing in nine days.
Nutrition is a daily, low-friction, low-commitment action; logging a workout
requires being at a gym mid-session with your phone out. The app's structure
treats nutrition as the fifth tab. Consider whether the wedge is food.

**P4. F4 (invisible confirmations) is a product call that expired.** The
suppression was deliberate and temporary. It has been a month. Either ship the
replacement cues or revert the policy for primary actions — the current state
is worse than either endpoint.

**P5. Gamification vs. the fitness outcome.** I did not find rewards that push
unsafe training (the AI Coach's clamps and the deficit-cuts-volume rule are
genuinely thoughtful). But the daily-quest generator manufactures 366 rows of
obligation against 3 rows of actual training, and a user returning after 30 days
meets expired quests, a broken streak and a league demotion. I could not walk
that journey (§6), so I am flagging it as the thing to look at first when the
browser pass is possible.

---

## 6. Questions — unverified, and what would settle each

1. **Everything the brief's Pass 1 and Pass 2 asked for.** No first-run, day-7,
   power-user or lapsed journey. No screenshots, no layout-shift, empty-state,
   dead-end, tap-target, focus-order, contrast or density observations. No
   per-surface verdicts for the 32 pages. *Settles it:* run the brief in an
   environment where the browser can reach Supabase.
2. **Is F4 as bad on screen as it is in the source?** Some flows may have
   inline confirmation (a checkmark, a state change) that makes the missing
   toast irrelevant. *Settles it:* save a workout and watch.
3. **What is the other ~200 KB of `vendor-misc`?** *Settles it:* `npm run
   analyze`, which needs a full build with `ANALYZE=true` and a treemap read.
4. **Why do `is_blocked` (mig 106) and `is_crew_admin` (mig 064) still have
   anon EXECUTE** when both predate the 213 sweep and neither is on its
   exclusion list? Either 213 was applied before they were redefined, or
   something re-granted. *Settles it:* check whether a later migration DROPs and
   re-CREATEs them.
5. **Does Storage get cleaned up on account deletion?** `storage-gc` is
   deployed and `storage_cleanup_queue` has 2 rows, so something exists, but I
   did not trace whether the delete path enqueues avatars and body photos.
6. ~~**Is the 3-workout number a wipe artifact?**~~ **Answered — it is not.**
   Exactly **1** of 34 profiles has a non-null `account_reset_at`, stamped
   2026-05-25, which predates the earliest surviving workout log (2026-07-12).
   At most one user's history was wiped, two and a half months before any of
   the current data. F3 stands as measured.
7. **Push end-to-end.** `push_subscriptions` is still 0, so delivery to a real
   device remains unproven, exactly as CLAUDE.md says.
8. **i18n, RTL, motion timing, and the notification-volume ceiling** — lenses
   D, F, M in the brief. Not run. F11 is the only type/density number I have.

---

## 7. What works — with evidence

Not padding, and not comfort. These were checked and they hold:

- **Three June blockers are genuinely fixed.** **C6** (nested `<Router>` killing
  all four public routes) — `App.jsx` now has one Router and a comment
  explaining why, and three of four routes rendered their own content in my
  probe. **C7** (workout draft lost on refresh) — `pagehide` and
  `visibilitychange` flush handlers now exist at `Workout.jsx:408-419`.
  **C8** (bodyweight sets silently dropped) — the save filter now exempts
  bodyweight, per the comment at `Workout.jsx:1560`.
- **RLS on tables is solid.** Every direct-table probe I ran as `anon` returned
  `[]` or 0 rows. The failure in F1 is a function grant, not a policy gap.
- **`get_public_profile_by_username` gets it right** — it returns `email` only
  when `auth.uid() IS NOT NULL`, and returned `"email": null` to my
  unauthenticated call. Someone thought carefully about exactly the problem F1
  represents, on the function next door.
- **2,578 tests across 180 files, all passing in 80 seconds**, up from 2,366.
  For a solo-built 206k-line codebase that is unusual.
- **Lazy-loading discipline holds.** TF.js (361 KB gz), maplibre (277 KB),
  jspdf, html2canvas, zxing are all out of the critical path, and I verified by
  inspecting the built chunk that unused Radix primitives are tree-shaken out
  rather than shipped. My initial suspicion that they were bloating the bundle
  was wrong.
- **The build guards and the AI Coach clamps are real engineering.** The
  `onwarn` hook turning `MISSING_EXPORT` into a build failure, and the bounded
  `buildTrainingModifiers` with its notes-on-the-card requirement, are both the
  kind of thing most codebases this age don't have.

---

## 8. Where I might be wrong

- **F3 is the load-bearing claim.** Its one alternative explanation — that
  "delete account" wiped real history — I chased down and ruled out: 1 of 34
  profiles was ever reset, on 2026-05-25, before the oldest surviving workout
  log. The claim survives the only test I could think of to break it. The
  residual risk is a wipe path that doesn't stamp `account_reset_at`, which I
  did not look for.
- **F6's interpretation is the weakest thing here.** The funnel numbers are
  solid; "onboarding promises something the next screen doesn't deliver" is a
  story I constructed from a step list and a drop-off, without seeing either
  screen. Treat it as a hypothesis to test, not a finding.
- **F4 could be overstated.** 95% is a real count of call sites, but call sites
  are not screens. If the primary flows happen to be among the 12 with actions,
  or have inline confirmation, the user-facing impact is much smaller than the
  number suggests.
- **F9's cost is inferred, not measured.** 556 KB is measured. "Users abandon"
  is not — I never loaded the app over a throttled connection.
- **F2's 54-table count involves judgement.** I excluded ledgers and shared
  catalogs as defensibly retained. A stricter GDPR reading would count some of
  those, a looser one would drop a few more of mine.
- **I did not run 11 of the brief's 17 lenses.** Copy, motion, i18n/RTL,
  notifications, offline/PWA, IA, visual design, and most of accessibility are
  simply absent. This document should not be read as "these are the problems" —
  it is "these are the problems findable without running the app."

---

## SQL — F1 only

The one S0 with an isolated fix. The brief permits fixing it during the
critique; I have **not** applied it, because production DB changes here go
through you pasting them, and I would rather you see it first. Everything else
in this document waits.

```sql
-- F1: close the unauthenticated email-harvest endpoint.
-- resolve_profile_email is SECURITY DEFINER with no auth gate and was
-- deliberately excluded from migration 213's anon sweep. The refactor that
-- exclusion was waiting on (mig 220) has since landed.
-- Idempotent. Safe to re-run.

REVOKE EXECUTE ON FUNCTION public.resolve_profile_email(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_profile_email(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.resolve_profile_email(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_profile_email(
  p_id       uuid DEFAULT NULL,
  p_username text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_email
    FROM public.user_profiles
   WHERE (p_id IS NOT NULL AND id = p_id)
      OR (p_username IS NOT NULL AND username = p_username)
   LIMIT 1;

  RETURN v_email;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolve_profile_email(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_profile_email(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.resolve_profile_email(uuid, text) TO authenticated;
```

Verify afterwards — this must return `401`/`42501`, not an address:

```sql
BEGIN;
SET LOCAL role anon;
SELECT public.resolve_profile_email(NULL, 'kegan');
ROLLBACK;
```
