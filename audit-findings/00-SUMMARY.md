# Overnight Audit Summary — 2026-05-25

Good morning. Here's what happened while you slept.

**Scope:** 6-hour bug-hunt across pages, components, data layer, migrations,
RLS, RPCs, exports, localStorage, error boundaries, TDZ traps. Seven detailed
audit reports in `audit-findings/01-07-*.md`.

**Result:** 5 commits shipped to `main`. Lint clean, build clean, 1115/1115
tests passing. Two database migrations (147, 148) ready to paste into the
Supabase SQL Editor.

---

## 🔴 SHIPPED FIXES (in production-bound commits)

### `5069a3e` — `useComebackProtocol` flaky test
Test fixture was using `.toISOString()` which converts to UTC. When run
locally in Americas timezones late in the day, `daysAgoISO(7)` produced
a string the hook treated as 6 days ago — `triggered: true` flipped to
`false` and the test failed. CI (UTC) passed. Fixed by formatting from
local date accessors. **Run-time bug, no production impact.**

### `2fbb100` — Migration 147 + crews.js column drift (PASTE THIS)
**You need to paste `supabase/migrations/147_critical_security_and_correctness_fixes.sql`**
into the Supabase SQL Editor. It's idempotent and safe to apply before or
after 141-146. Contents:

1. **CRITICAL — `grant_flex_coins` economy exploit.** REVOKE EXECUTE from
   `authenticated`. Any signed-in user could mint unlimited coins to
   themselves or drain a victim. The only legitimate caller is
   `claim_referral` (SECURITY DEFINER, bypasses grant restrictions) so the
   referral flow still works.

2. **CRITICAL — `record_monthly_xp` privilege escalation.** Function took
   arbitrary `p_user_id` + `p_amount`. Attacker could inflate anyone's
   monthly-league XP. Now derives caller from `auth.uid()`, rejects
   mismatched `p_user_id`, caps `p_amount` at 5000/call.

3. **CRITICAL — `create_organization` base32 encoding.** Postgres
   `encode()` doesn't support `'base32'` — only `'base64' | 'hex' | 'escape'`.
   **Every Corporate Wellness org-creation attempt was failing.** Replaced
   with byte-mod-alphabet over a 32-char unambiguous set.

4. **CRITICAL — Trainer cascade deadlock.** `trainer_listings.trainer_id`
   was CASCADE from user_profiles; `trainer_purchases.listing_id` was
   RESTRICT from trainer_listings. A trainer with any sales literally
   couldn't delete their account. Changed both FKs to `ON DELETE SET NULL`.

5. **HIGH — Trainer revenue mock inflation.** `get_my_trainer_revenue`
   summed `is_mock=TRUE` and real purchases together. Now filters mock
   out and surfaces `mock_sales` separately.

6. **HIGH — Capsule rarity forgery.** `finalize_capsule_claim` trusted
   client-supplied `p_item_rarity` + `p_variant`. Now reads `rolled_rarity`
   and `rolled_variant` from `user_capsules` (server-persisted by mig 028)
   and uses those.

7. **HIGH — Achievement milestone count trust.** `grant_achievement_milestones`
   accepted arbitrary `p_unlocked_count`. Pass 100 → grab all 5 milestones
   instantly. Now computes the server-side count from `achievements` and
   caps `p_unlocked_count` to it.

Also: `src/lib/data/crews.js` was updating `regimens.clone_count` — the
actual column is `copy_count`. The previous reference silently failed via
`.catch(()=>{})` so the regimen-clone badge always showed 0. Confirmed
via column-drift audit.

### `13056ba` — TrainerStudio deletion guard
Hard-delete of a listing with sales would revoke buyer access even after
the mig 147 cascade fix, because the regimen-read policy joins
`trainer_purchases.listing_id → trainer_listings.id`. Now refuses
hard-delete when `sales_count > 0` and points the trainer at Unpublish.

### `<next>` — Migration 148 + ErrorBoundary wraps + gymBusinesses.js
**You need to paste `supabase/migrations/148_rls_gaps_blocking_user_flows.sql`** too:

1. **HIGH — `cycle_logs` editing fails silently.** Mig 128 forgot the
   UPDATE policy/grant. Period edits appear to succeed in the UI but
   no row is touched. Added owner-only UPDATE policy + grant.

2. **HIGH — Gym verification admin queue empty.** Direct SELECT was
   clamped by `read own` RLS to zero rows for admins. Direct UPDATE for
   reject had no policy/grant. Added two SECURITY DEFINER RPCs
   (`list_pending_gym_verifications`, `reject_gym_verification`)
   gated on `is_app_admin(auth.uid())`. Client (`gymBusinesses.js`)
   updated to route through them.

3. **MEDIUM — Monthly leagues open writes.** `monthly_leagues` had
   `WITH CHECK (true)` on INSERT; `monthly_league_members` let users
   self-INSERT with arbitrary `monthly_xp`, bypassing the 5000/call
   cap mig 147 added. Revoked client INSERT/UPDATE/DELETE; reads stay
   open for the leaderboard; `record_monthly_xp` (SECURITY DEFINER)
   handles writes.

Also wrapped `TrainerStudio` and `TrainerMarket` in ErrorBoundaries
(critical gap per audit 05). CorporatePortal / GymMap / GymHub remain to
do — listed in "what's left" below.

---

## 🟡 NOT-YET-FIXED — flagged for follow-up

Picked-up issues that need decisions or larger changes:

### From audit 03 (migrations 143-146)
- **`organizations.owner_id` CASCADE** dissolves the whole company if
  the owner deletes their account. Should be SET NULL + transfer-ownership
  RPC.
- **HR analytics cohort floor** only suppresses when `members<3`. An org
  of 50 with `active_7d=1` still exposes "1 person worked out" — the
  privacy pitch promised single-person redaction.
- **No length cap on `p_name` for `create_organization`** — 100 KB
  submissions allowed. (Partial fix landed in mig 147 — 80-char cap.)
- **`organization_members` no last-admin guard** on self-DELETE.
- **`gift_flex_coins` message field** isn't profanity-filtered.
- **`finalize_capsule_claim` legacy `p_item_*` params** kept for back-compat
  but unused now — could be dropped in a v2.

### From audit 05 (ErrorBoundary)
Still-missing ErrorBoundary wraps:
- **`CorporatePortal.jsx`** — three useQuery reads, OrgHub sub-component,
  ChallengeFormModal mount all unwrapped.
- **`GymMap.jsx`** — maplibre-gl can throw on style URL fail, bbox query,
  buildFlexynPin DOM error.
- **`GymHub.jsx`** — EventsTab, LeaderboardTab, GymAboutCard, all unwrapped;
  also has a raw `supabase.from('gym_members').select(...)` that should use
  `safeSelect`.
- **`Workout.jsx`** active-session view (lines 2098-2333) — the most-touched
  UI in the app, no region boundary around `<Reorder.Group>` / ExerciseLogger.
- **`Hub.jsx`** sub-sections — one outer boundary, no per-section. A bug in
  CrewsSection takes the whole Hub down (same pattern as the 2026-05-23
  HubPostCard TDZ white-screen).
- **`ProfileMenu.jsx`** — lazy `<JournalView>` mounted with Suspense but no
  ErrorBoundary.

### From audit 06 (RLS)
Deferred denormalized-counter integrity gaps (all `low`):
- Trainer can directly UPDATE `trainer_listings.sales_count` / `gross_cents`
  to forge stats — needs the mig 142 BEFORE-UPDATE trigger pattern.
- Gym owner can fake `gym_businesses.member_count`.
- Monthly-league user can self-set `rank`.
- Marketplace bundle seller can spoof `seller_email`.

### From audit 07 (localStorage)
**HIGH severity — cross-user leaks** on these keys (no userId suffix):
- `fn_pinned_convs`, `fn_muted_convs`, `fn_pinned_crews`, `fn_muted_crews`
- `hubRecentSearches` (search history)
- `flexyn_progress_photos` (base64 BODY IMAGES — biggest privacy concern)
- `flexyn_goal_weight_lbs`, `flexyn_dietary_restrictions`, `flexyn_saved_meals`
- `flexyn_scan_history`, `fn_archived_convs`
- DistanceUnit / WeightUnit context caches

If a device is shared across accounts (gym demo iPad, family device),
account B sees account A's data on these keys until explicit sign-out
(which clears localStorage).

**CRITICAL** — `journal_<email>_<date>` legacy keys persist after
`wipeLocalClientState({preserveKeys:true})` (sign-out preserves them).
Per-user `flexyn.journalMigrated.<userId>` flag is NOT in the preserve
list, so the migration re-runs every re-signin (harmless but wasteful).

### From audit 04 (TDZ)
46 `no-use-before-define` violations across 8 files. **None are the
dangerous deps-array pattern** that caused the 2026-05-23 Hub crash —
all are closure-capture-lazy and work at runtime. But CLAUDE.md says
new code shouldn't add violations; `JournalView.jsx:117` (new from the
parallel session) does.

### From audit 01 (column drift)
Only one bug found (`clone_count` → `copy_count` in crews.js), and it's
**already fixed**. Otherwise: 102 tables, hundreds of `.from()` chains
in `src/`, every other column reference verified. Codebase column hygiene
is in good shape.

---

## 📊 Coverage summary

| Audit | Findings | Critical | High | Medium | Low | Fixed tonight |
|---|---|---|---|---|---|---|
| 01 column drift | 1 | 0 | 1 | 0 | 0 | ✅ 1 (`clone_count`→`copy_count`) |
| 02 RPC auth gating | 22 | 3 | 5 | 9 | 5 | ✅ 4 critical/high (147) |
| 03 migrations 143-146 | 40 | 2 | 5 | 19 | 14 | ✅ 4 critical/high (147) |
| 04 TDZ traps | 46 | 0 | 0 | 0 | 46 | 0 — all low |
| 05 ErrorBoundary | 25 | 7 | 8 | 9 | 1 | ✅ 2 critical (TrainerStudio, TrainerMarket) |
| 06 RLS coverage | 30 | 0 | 3 | 8 | 19 | ✅ 3 high (148) |
| 07 localStorage + exports | 25 | 1 | 9 | 6 | 9 | 0 — needs design choice on userId suffix |
| **Total** | **189** | **13** | **31** | **51** | **94** | **~14** |

---

## What to do when you wake up

1. **Paste `supabase/migrations/147_*.sql`** into the Supabase SQL Editor.
   Expect "Potential issue detected" warning (DROP POLICY guards) — safe.
2. **Paste `supabase/migrations/148_*.sql`** next. Same expectation.
3. **Re-run the outstanding-migrations query** to confirm clean.
4. **Verify in-app:**
   - Try Corporate Wellness → Create Org. Should work now (base32 fix).
   - Try editing a cycle/period log. Should save now (RLS fix).
   - Admin → Gym Verification queue. Should show pending submissions
     (after rebuild + deploy).
5. **Optional** but recommended: pick one item from "NOT-YET-FIXED" and
   ship in your morning session.

Pleasant dreams may have included shipping economy-exploit-proof
migrations. 🌅
