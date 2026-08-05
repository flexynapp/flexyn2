# Acceptance review — S-tier features #26–50

Run 2026-08-05 against `main`, production database, Chromium 1194 at 375×812.

**This band is not a design review, and pretending otherwise would waste it.**
Of the 25 features here, **four have any UI at all** (#26–29). The other 21 are
13 backend/security guarantees and 8 design-system primitives. So the method is
the same — verify it exists, exercise it, probe the edges — but "exercise it"
means executing SQL as `anon` and `authenticated` against production rather
than tapping a button.

Every security claim below was tested by **executing the attack**, inside a
transaction, under `SET LOCAL role` with real JWT claims. Nothing is graded
from reading a migration.

---

## Shell & Dashboard (#26–29)

### #26 `SH30` — Launch splash + splash screen route
**GRADE: A** — Renders at `/`, full marketing screen with the 5-slide feature
carousel, "Get started" (327×56) and "I already have an account" (327×44).
Reached the sign-in gate cleanly. No console errors beyond the blocked font CDN.

### #27 `SH4` — Bottom nav auto-hides on scroll
**GRADE: A** — Measured directly: `transform: matrix(1,0,0,1,0,67)` after
scrolling down (translated by exactly its own 67px height),
`matrix(1,0,0,1,0,0)` after scrolling up. Behaves as described.

### #28 `SH5` — Nav visibility resets on route change
**GRADE: B** — Nav was visible on arrival at every route navigated
(Dashboard → Workout → Dashboard). **Not** tested in its actual failure mode:
scroll down to hide the nav, *then* change route, and confirm it returns.
Observed consistent with the claim; not proven.

### #29 `D19` — Login streak banner
**GRADE: B** — Renders inside the hero as a pill: 🔥 "1 day streak" with a
chevron. The chevron expands a calendar; its hit box was widened in an earlier
pass. The pill's label is a tap-to-copy target, not an expander, so the chip
reads as one control and behaves as two.

---

## Backend & security (#30–42)

### #30 `BE1` — "279 SQL migrations with a documented runbook + state-check query"
**GRADE: B**
**EVIDENCE:** 319 `.sql` files in `supabase/migrations/` (the 279 figure is
stale — it has grown). `docs/migrations-runbook.md` exists, 249 lines, with the
state-check query at the bottom as described.
**GAP:** `public._migration_log` exists, has 3 columns and **0 rows**. Nothing
writes to it, so there is no in-database record of what has been applied. The
runbook's state-check works by inspecting objects, which is a good design — but
the log table is dead weight that implies a tracking mechanism that isn't there.
**FIX:** Either populate it from each migration or drop it. **S**

### #31 `BE10` — FK indexing + hot-path indexes
**GRADE: C**
**EVIDENCE:** 203 foreign keys in `public`; **16 have no covering index**.
**GAP:** Every one of the 16 belongs to a late-arriving feature —
`crew_bans` (×2), `crew_challenge_contributions`, `crew_invites` (×2),
`crew_join_requests` (×2), `crew_perk_purchases` (×2), `crew_season_stats`,
`crew_treasury_ledger`, `equipment_models`, `equipment_photos`,
`space_equipment` (×2), `training_spaces`. The crew system and the July
equipment picker. **The indexing was a sweep, and everything added after the
sweep missed it** — the same structural pattern as migration 213's one-time
anon sweep.
**FIX:** Index the 16, and add the check to the schema-drift audit so the next
feature can't silently skip it. **S**

### #32 `BE15` — Vault-stored secrets for push + cron
**GRADE: B**
**EVIDENCE:** `vault.decrypted_secrets` holds exactly four:
`send_push_secret`, `send_push_url`, `storage_gc_secret`, `storage_gc_url`.
17 cron jobs registered.
**GAP:** The weekly-debrief secrets (`debrief_cron_secret`, `debrief_func_url`)
are **absent** — matching the known gap in CLAUDE.md. The pattern is right and
correctly applied to push and storage-gc; it is not applied to everything.
**FIX:** Add them when the debrief cron is re-scheduled. **S**

### #33 `BE19` — Anti-cheat suite
**GRADE: B**
**EVIDENCE — the important ones, tested by attacking them as `authenticated`:**
- Minting a legendary into the loot catalog:
  `INSERT INTO loot_catalog(item_id,item_name,item_type,item_rarity)
   VALUES ('__pentest__','Pentest Crown','title','legendary')`
  → **blocked, 42501, "new row violates row-level security policy"**. Zero rows
  left behind. The server-authoritative claim holds.
- Writing to the XP audit ledger: `INSERT INTO xp_grant_log` → **blocked 42501**.
- 16 functions implement coin ceiling / cap logic; 3 reference a referral cap.
**GAPS:**
1. `loot_catalog` grants `INSERT` to `authenticated`. RLS denies it (proven
   above), so this is safe — but it is braces with no belt. The grant is
   redundant and should be revoked so the table is protected by two independent
   mechanisms rather than one.
2. **Bounty escrow could not be located** — no function body matches
   escrow/hold/deduct near a bounty. Either it lives under a name I did not
   guess or the claim is loose. Not asserting it is missing.
**FIX:** `REVOKE INSERT ON loot_catalog FROM authenticated`. Point me at the
escrow function and I will verify it. **S**

### #34 `BE20` — Atomic RPCs for every economy-touching write
**GRADE: B** — 41 SECURITY DEFINER functions match the economy surface
(purchase / capsule / grant / award / claim / complete_goal / resolve /
contribute). Ledger tables are live: `flex_coin_ledger` 120 rows,
`xp_grant_log` 29. **Not verified:** actual atomicity under concurrency. That
needs two sessions racing the same RPC, which I did not run against production.

### #35 `BE22` — TanStack Query cache with a shared query client
**GRADE: A** — One `queryClientInstance` exported from `src/lib/query-client.js`
and imported by `App.jsx`. Deliberate `staleTime` of 60s with a long comment
explaining why `refetchOnWindowFocus` stays true. Considered, not accidental.

### #36 `BE3` — RLS on every user table
**GRADE: A**
**EVIDENCE:** **139 of 139** public tables have `relrowsecurity` set. Zero
disabled. Verified in practice: `anon` selecting `flex_coin_ledger` → blocked
42501.
**NOTE, not a gap:** 10 tables have RLS enabled with **zero policies** —
`_migration_log`, `action_xp_ledger`, `flex_coin_ledger`, `loot_catalog`,
`memory_reengagement_log`, `storage_cleanup_queue`, `user_stat_grant_ledger`,
`weekly_gauntlet_notifications`, `xp_grant_log`, `xp_level_thresholds`. That is
deny-all to every client role while `service_role` bypasses — correct for
ledgers and catalogs. Four of them additionally carry an `anon` SELECT grant;
tested `_migration_log` as `anon` and it **returned 0 rows**, so the grant is
inert. Still worth revoking for the same belt-and-braces reason as #33.

### #37 `BE4` — SECURITY DEFINER RPC layer for cross-user work
**GRADE: A** — 244 SECURITY DEFINER functions in `public`. The layer exists and
is the dominant pattern.

### #38 `BE5` — `auth.uid()`-gated RPCs, never trusting client identifiers
**GRADE: B**
**EVIDENCE:** Of the 13 anon-executable SECURITY DEFINER functions, 6 gate on
`auth.uid()`. The other 7 are: four trigger functions
(`dm_accept_conversations_on_follow`, `fill_weekly_debrief_email`,
`flex_coin_ledger_and_cap`, `sync_conversation_participant_ids`,
`sync_post_collaborator_ids`) which PostgREST will not route; and two
deliberately public endpoints (`get_pending_duel_invite_public`, token-gated,
and `get_gym_vs_gym_leaderboard`).
**GAP:** `is_blocked(p_viewer_id, p_author_email)` still takes a
**client-supplied viewer id** rather than reading `auth.uid()`. It cannot be
revoked from `anon` — it is called inside the `hub_posts` and `hub_comments`
SELECT policies, and anon holds SELECT on `hub_posts` for public profile pages,
so revoking turns filtered reads into `permission denied`. The correct fix is
to rewrite it to ignore its parameter and use `auth.uid()`, which keeps it
policy-safe and closes the parameter-trust hole in one move. **M**

### #39 `BE6` — Privileged-column lockdown
**GRADE: A** — The strongest result in this band. As `authenticated`, with
valid JWT claims, against my own row:
- `UPDATE user_profiles SET flex_coins = flex_coins + 999999` → **42501**
- `UPDATE user_profiles SET total_xp = 999999` → **42501**
- `UPDATE user_profiles SET bio = 'legit edit'` → **allowed** (control passes)
Rejects privilege escalation, permits legitimate edits.

### #40 `BE7` — Anon RPC surface lockdown
**GRADE: B** — 67 of 321 public functions are anon-executable; 13 of those are
SECURITY DEFINER. Most of the 67 are non-routable trigger functions. The
genuinely reachable anon surface is small and intentional. Not zero, and the
sweep that produced it was one-time — see #38.

### #41 `BE8` — Function `search_path` hardening
**GRADE: A** — **244 SECURITY DEFINER functions, 0 without a pinned
`search_path`.** 100% coverage. Nothing to fix.

### #42 `BE9` — RLS initplan optimization
**GRADE: B**
**EVIDENCE:** 272 policies total, 205 reference `auth.uid()`/`auth.email()`/
`auth.jwt()`, and **11 do not wrap the call in `(SELECT …)`** — so those
re-evaluate per row instead of once per query.
**GAP:** The 11 are on `crew_challenges`, `crew_invites`, `crew_join_requests`,
`dm_request_blocks` (×3), `gym_rival_assignments`, `scheduled_workouts` (×3)
and `trade_offers`. **Same pattern as #31** — the optimization was a sweep, and
`scheduled_workouts` (August) and the crew tables landed after it.
**FIX:** Wrap the 11. Mechanical. **S**

---

## Design system (#43–50)

### #43 `UI1` — "45+ Radix-based UI primitives"
**GRADE: F — the claim is false.**
`src/components/ui/` contains **14 files**, not 45+. 32 were deleted on
2026-08-05 after a transitive-reachability check found zero consumers, along
with 22 unused Radix dependencies. The cell in the ranking sheet names
components that no longer exist (accordion, avatar, chart, table, tabs, toast,
tooltip and others).
**FIX:** Rewrite the row as "14 Radix-based UI primitives (alert-dialog, badge,
button, card, dialog, drawer, dropdown-menu, input, select, skeleton, textarea,
BottomSheet, CharCountIndicator, FormattedNumberInput)". **S**

### #44 `UI11` — PageHeader
**GRADE: B** — Exists, 5 consumers. Real but modestly adopted for a component
ranked at 95% reach; most pages roll their own header.

### #45 `UI13` — Flexyn logo component
**GRADE: A** — Exists, 4 consumers, renders on splash and header.

### #46 `UI14` — Skeleton loaders
**GRADE: A** — Exists with **21 consumers**. Genuinely used throughout.

### #47 `UI16` — Intl helpers
**GRADE: A** — `useNumberFormatter`, `useDateFormatter`, `formatNumber`,
`formatDate` all exported. **60 consumers.** Covered by `intl.test.js`. The
best-adopted helper in this band.

### #48 `UI17` — Relative-date formatting + per-locale date-fns locales
**GRADE: C**
**EVIDENCE:** `getDateLocale()` maps **11 of the 15 supported languages** —
de, en, es, fr, it, ja, nl, pl, pt, ru, zh. It also maps sv, da, nb and fi,
which the app does not support.
**GAP:** **ko, ar, hi and tr fall through to the English locale**, so a Korean,
Arabic, Hindi or Turkish user gets English month names and English relative
dates while the rest of the UI is translated. Meanwhile four locales are
imported for languages the app doesn't ship.
**FIX:** Add `ko`, `ar`, `hi`, `tr` from `date-fns/locale`; drop sv/da/nb/fi.
**S**

### #49 `UI18` — Pluralization helper
**GRADE: C** — `pluralize()` and `pluralForm()` exist in `src/lib/pluralize.js`
and are covered by `pluralize.test.js`. **But only 2 files import them.** A
correct, tested helper at ~2% adoption is not a 90%-reach feature; everywhere
else is presumably doing `count === 1 ? 'x' : 'xs'` inline, which is wrong in
Russian, Polish and Arabic — all supported languages with non-binary plural
rules.
**FIX:** Adoption pass, or accept it and re-tier the row. **M**

### #50 `UI6` — AnimatedNumber (count-up)
**GRADE: C** — The shared component exists with 4 consumers, **and two other
surfaces reimplement it locally**: `HeroSlideshow.jsx` and `LiveVolumePill.jsx`
each define their own `function AnimatedNumber`. Three implementations of one
primitive, which is how reduced-motion handling and easing drift apart.
**FIX:** Delete the two local copies and import the shared one — checking first
that the shared version honours `prefers-reduced-motion`, which the
HeroSlideshow copy explicitly does. **S**

---

## Summary

**Grades:** A ×9 · B ×10 · C ×5 · F ×1.

The security band is genuinely strong, and it is strong where it counts.
`search_path` hardening is at **100%** (244/244). RLS is at **100%** (139/139)
and holds when attacked. The privileged-column lockdown **rejected a live
privilege-escalation attempt** and still allowed a legitimate edit. Minting a
legendary into the loot catalog as a normal user was **blocked by RLS**. These
are the four claims most worth being true, and all four are.

**One pattern explains most of the gaps.** #31 (16 unindexed FKs) and #42 (11
unwrapped policies) are the same defect wearing different clothes: both
optimizations were applied as a one-time sweep, and every feature added
afterwards — the crew system, the July equipment picker, August's
`scheduled_workouts` — missed them. This is the third instance of it in this
codebase; migration 213's anon sweep was the first. **The fix that matters is
not the 27 individual items, it is adding both checks to
`_audit_schema_drift.sql` so the next feature cannot skip them silently.**

**Best improvement-per-hour:**
1. Add the FK-index and unwrapped-policy checks to the drift audit, then clear
   the 27 items they find. One session, and the class stops recurring.
2. Rewrite `is_blocked` to read `auth.uid()` instead of trusting its parameter
   (#38) — the last client-supplied-identifier hole, and it cannot be closed by
   revoking.
3. Add the four missing date locales (#48) — ko/ar/hi/tr users currently get
   English dates inside a translated UI.
4. `REVOKE INSERT ON loot_catalog FROM authenticated` (#33) and the anon SELECT
   grants on the four zero-policy tables (#36). Both are inert today; both
   remove a single point of failure.
5. Collapse the three `AnimatedNumber` implementations (#50).

**One row is factually wrong and should be corrected in the sheet:** #43 claims
45+ UI primitives; there are 14.

**Could not verify:** atomicity of the economy RPCs under real concurrency
(#34), the nav-reset failure mode (#28), and the bounty escrow mechanism (#33),
which I could not locate by name.
