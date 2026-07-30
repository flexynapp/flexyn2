# Coin economy audit — 2026-07-29

Same method as [xp-audit-2026-07-29.md](xp-audit-2026-07-29.md): map, model,
compare, rank. Nothing changed. All numbers measured against the live database
(`ebvqxuwfiptcmlkhflfj`) or computed from shipped code.

---

## First: a correction to the XP audit

**F1 in the XP audit was wrong, and my fix for it was redundant.**

I reported that `authenticated` holding column-level `UPDATE` on `total_xp` /
`flex_coins` / `current_level` meant the capped path could be bypassed by a
direct PostgREST write. The grants are real and RLS genuinely has no column
dimension — both true. But **migration 142 already installed a trigger**,
`user_profiles_block_privileged_updates`, extended in 173, which rejects
exactly those writes using exactly the `current_user` technique I later used,
across **twenty** protected columns rather than my three.

So the vulnerability was not live. What went wrong in my reasoning:

- I checked the *grants* and the *RLS policy* and concluded from their absence
  of column scoping that nothing stopped the write. I never enumerated triggers
  on `user_profiles`.
- My adversarial test ran **after** migration 261. Triggers fire in name order,
  `trg_guard_profile_economy_columns` sorts before
  `user_profiles_block_privileged_updates`, so my trigger raised first and I saw
  my own error message. That told me the write was blocked; it could not tell me
  *who* blocked it. Testing before the fix would have shown the same refusal.
- The "evidence it is already happening" — four users with `total_xp` and no
  `xp_grant_log` rows — has other explanations I didn't rule out: data written
  before 142 landed, a `service_role` path, or `reset_my_profile_stats`.

**Consequence:** migration 261's trigger should be dropped. Two triggers
enforcing the same rule on every profile update is redundant work and a
maintenance trap — a future author fixing one will not know to look for the
other. The threshold table and lookup half of 261 (which fixed F2, a real and
independently confirmed defect) stays.

```sql
DROP TRIGGER IF EXISTS trg_guard_profile_economy_columns ON public.user_profiles;
DROP FUNCTION IF EXISTS public.guard_profile_economy_columns();
```

F2, F3, F4 and F5 stand. F2 was verified by reading the old curve out of
`increment_user_xp` and watching the backfill move sean from level 1 to 5.

---

## Stage 0 — Inventory

21 coin-touching functions are callable by `authenticated`; 4 more are
server-only. Direct client writes are blocked (migration 142).

### Faucets

| Function | Routes through the capped mint? |
|---|---|
| `claim_daily_chest` | ❌ writes `flex_coins` directly |
| `claim_quest_atomic` | ❌ direct |
| `claim_referral` | ❌ direct (+200) |
| `complete_bounty_claim` | ❌ direct |
| `complete_gauntlet_challenge` | ❌ direct |
| `complete_solo_challenge` | ❌ direct |
| `distribute_league_rewards` | ❌ direct |
| `grant_level_up_rewards` | ❌ direct |
| `gym_rival_settle_week` | ❌ direct |
| `perform_prestige` | ❌ direct |
| `purchase_bundle` / `purchase_listing` | ❌ direct (seller credit) |
| `sweep_expired_bounties` | ❌ direct (refund) |
| `increment_flex_coins` | ✅ **is** the capped mint |

`increment_flex_coins` (migration 176) enforces 2,500 per call and 25,000 per
day against `flex_coin_grant_ledger`. Its only callers are three client paths:
login streak, workout streak, and capsule coin drops.

### Sinks

`purchase_shop_item` (100–1000), `purchase_branded_item`, `purchase_crew_perk`,
`purchase_listing` (player-priced), `create_user_bounty` (entry fee),
`claim_bounty`, `gift_flex_coins` (transfer, not a sink).

---

## Findings

### C1 — HIGH: the mint ceiling governs 1.3% of minting

| | Coins |
|---|---|
| In circulation (`sum(flex_coins)`) | **62,788** |
| Minted through the capped path (`flex_coin_grant_ledger`) | **802** |
| Share actually subject to the 25,000/day ceiling | **1.3%** |

Migration 176 added a mint guard with a per-call limit, a per-day limit and a
ledger — and then thirteen other faucets kept writing `flex_coins` directly
inside their own SECURITY DEFINER bodies. **There is no global per-user daily
coin cap.** Each faucet has its own internal limit (chest once/day, quests
capped, league weekly), so coins aren't unbounded — but nothing bounds the
*sum*, and nothing stops a new faucet from being added without one.

This is the same shape as F3 in the XP audit — a cap that caps nothing — except
it's server-side, so it reads as authoritative to anyone auditing after me.

### C2 — HIGH: 98.7% of coins have no provenance

`flex_coin_grant_ledger` holds 32 rows totalling 802 coins against 62,788 in
circulation. For the other 61,986 there is no record of which faucet issued
them, when, or to whom.

Nakama's `core_wallet.go` — the reference this codebase's `xp_grant_log`
already imitates for XP — writes a ledger row for **every** wallet change,
because that is the only way to answer "where did this balance come from" after
the fact. Ours can answer it for one twentieth of the currency.

Practical cost: the max balance is 20,075 coins against a median of 5. There is
currently no way to determine whether that is legitimate accumulation, an admin
grant, or a bug.

### C3 — MEDIUM: income outruns the sinks

Dedicated user, all three daily quests, unbroken login streak, gold-tier league,
800 XP/day:

| Window | Quests | Login streak | League | Level-ups | **Total** | Elite Capsules' worth |
|---|---|---|---|---|---|---|
| Week 1 | 1,085 | 175 | 200 | 675 | **2,135** | 2.1 |
| Month 1 | 4,650 | 2,475 | 800 | 1,175 | **9,100** | 9.1 |
| 3 months | 13,950 | 14,295 | 2,400 | 1,800 | **32,445** | 32.4 |
| 6 months | 27,900 | 32,295 | 5,000 | 2,200 | **67,395** | 67.4 |

The most expensive thing in the shop costs 1,000. By month six a committed user
can buy the entire catalogue sixty-seven times over. The login-streak curve is
the compounding culprit — `5 + 5×day` capped at 200 means every day past day 39
mints 200 coins in perpetuity.

### C4 — MEDIUM: the F5 fix targeted the smallest faucet

Share of month-1 coin income:

| Faucet | Coins | Share |
|---|---|---|
| Daily quests | 4,650 | **51.1%** |
| Login streak | 2,475 | **27.2%** |
| Level-ups | 1,175 | 12.9% |
| League | 800 | 8.8% |

Migration 263 cut level-up coins from 2,450 to 1,175 — a real improvement, but
level-ups are only an eighth of the faucet. **Quests and the login streak are
78% of it and were not touched.** If the intent was to make the shop matter,
263 moved about 13% of the problem.

### C5 — LOW: the distribution makes the shop unusable for most

| | Coins |
|---|---|
| Median balance | **5** |
| Mean balance | 1,652 |
| Max balance | 20,075 |
| Cheapest SKU | 100 |

26 of 38 users hold any coins at all. The median holder cannot afford the
cheapest item while the top holder could buy twenty Elite Capsules. Mean 330×
median is not a functioning economy; it's two economies.

### No defect found

- **`gift_flex_coins` is zero-sum** — it debits the sender before crediting the
  recipient. Verified against the function body. Not a money printer.
- **Direct client writes to `flex_coins` are blocked** — migration 142, as
  above.
- **Purchases are atomic and server-side** — `purchase_shop_item` owns the
  price table, so a tampered client can't set its own price (already hardened
  in migration 031).

---

## Status

| | Finding | State |
|---|---|---|
| C1 | Mint ceiling governed 1.3% of minting | ✅ **fixed** — migration 264. Enforced at the column (the chokepoint) rather than by rewriting 22 faucets. Clamp verified firing at 50,000/24h. |
| C2 | 98.7% of coins had no provenance | ✅ **fixed** — migration 264. `flex_coin_ledger` reconciles exactly to circulation; credits and debits both log with the originating RPC name. |
| C3 | Income outran the sinks | ✅ **fixed** — migration 265 + client. Month 1 9,730 → 5,400; 6 months 69,875 → 24,575. |
| C4 | The F5 fix targeted the smallest faucet | ✅ **fixed** — the two that mattered (quests 51%, login streak 27%) are both retuned. No faucet is now above 43%. |
| C5 | Median 5 vs mean 1,652 | ⬜ open — downstream of C3/C4. Re-measure once real users accumulate under the new rates rather than treating it directly. |

### Note on the C3/C4 fix

Quests halved (15/40/100 → 8/20/50) and the login streak made milestone-only.
The streak's `min(5 + day × 5, 200)` fallback was the only compounding faucet
in the economy — past day 39 it minted 200 coins a day forever, 32,295 over
six months, more than every other source combined. Milestone payouts are
untouched (day 30 still 500, day 100 still 1,500); what's gone is the drip
between them. That also makes it consistent with `coinsForWorkoutStreakDay`,
which was always milestone-only — the asymmetry between the two streak systems
is what hid this.

| Faucet | Before | After | Share after |
|---|---|---|---|
| Daily quests | 4,650 | 2,340 | 43.3% |
| Level-ups | 1,175 | 1,175 | 21.8% |
| Login streak | 2,475 | 1,085 | 20.1% |
| League | 800 | 800 | 14.8% |
| **Month-1 total** | **9,730** | **5,400** | |

An Elite Capsule now costs ~5.5 days of income instead of ~3, so buying one is
a decision. Not a clawback: quest rows already stamped today keep their old
`coin_reward` — the trigger only sets it on INSERT.

The generosity dial, if this still reads high, is the quest CASE in migration
265 and `QUEST_DIFFICULTY` in `questCatalog.js` — change both together, the
server is authoritative.
