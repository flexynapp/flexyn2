# Capsule / loot system audit — 2026-07-29

Same method as the [XP](xp-audit-2026-07-29.md) and
[coin](coin-economy-audit-2026-07-29.md) audits. Nothing changed. Measured
against the live database (`ebvqxuwfiptcmlkhflfj`).

Findings are split by **reachability**, because the XP audit's F1 was a false
positive from assuming a bad grant meant a live exploit. Here each one says
whether it is reachable through PostgREST — the only surface a client actually
has — or latent.

---

## Stage 0 — Inventory

### Three generations of the open API, all live and client-callable

| RPC | Who picks the item | Pity? | Verdict |
|---|---|---|---|
| `finalize_capsule_claim(capsule, item_id, name, emoji, rarity, type, variant)` | **client** | no | oldest; rarity/variant args silently discarded |
| `open_capsule_atomic(capsule, candidates jsonb)` | **client-supplied pool**, server keys into it | ✅ yes | current |
| `claim_capsule_loot(capsule)` | server rolls rarity/category/variant only | ❌ no | roll-only, no item |

All three are `SECURITY DEFINER` and `EXECUTE`-able by `authenticated`. Security
is defined by the weakest.

### What is correctly server-authoritative

- **Rarity, category and variant are rolled server-side** in
  `claim_capsule_loot` and `open_capsule_atomic`, via `_weighted_pick`, with the
  odds hardcoded in SQL.
- **`finalize_capsule_claim` ignores the client's `p_item_rarity` and
  `p_variant`** — it inserts `v_rolled_rarity` / `v_rolled_variant` off the
  capsule row and refuses if the roll is missing. The parameters are vestigial.
- **Pity is server-side** — `open_capsule_atomic` holds `pity_since_epic` /
  `pity_since_legendary` under `FOR UPDATE`, guarantees epic at 30 and
  legendary at 90, and soft-ramps from 61.
- **The published odds are honest.** `CAPSULE_ODDS` in `lootCatalog.js` matches
  the SQL weights exactly for all three capsule types — so the disclosure now
  rendered in the shop (App Store 3.1.1) is accurate.
- **`user_inventory` INSERT and UPDATE are revoked** from `authenticated`. The
  INSERT/UPDATE *policies* still exist but are moot without the grant. Items
  can only be created by the definer RPCs.

---

## Findings

### L1 — CRITICAL, REACHABLE: anyone can mint unlimited Elite Capsules

`authenticated` holds **INSERT on `user_capsules`**, and there is an INSERT
policy allowing own rows. So this is a normal PostgREST call:

```
POST /rest/v1/user_capsules
{ "user_id": "<own id>", "user_email": "<own email>", "capsule_type": "elite" }
```

**Verified against production** in a rolled-back transaction: assuming the
`authenticated` role with a real user's JWT, two Elite Capsules inserted
successfully.

The capsules are then opened through the *legitimate* server-rolled path, so
the roll is fair — the theft is upstream of it. An Elite Capsule costs **1,000
coins** in the shop, the most expensive item in the game. This bypasses that
price, the coin economy hardened across migrations 197–207 and 264–265, and
every faucet limit in this session's work.

Nothing legitimate needs the grant: capsules are created by
`purchase_shop_item`, `grant_level_up_rewards`, `claim_daily_chest`,
`grant_achievement_milestones` and friends — all `SECURITY DEFINER`, all
unaffected by what `authenticated` holds.

### L2 — HIGH, REACHABLE: item identity is client-chosen on every path

The server decides *what rarity you rolled*. The client decides *which item
that is*.

- `open_capsule_atomic` builds `v_key := category || ':' || rarity` and then
  does `p_candidates -> v_key` — **the candidate pool comes from the client.**
  A crafted pool can map every key to the same item.
- `finalize_capsule_claim` takes `p_item_id`, `p_item_name`, `p_item_emoji`,
  `p_item_type` verbatim.
- Neither validates `item_id` against any catalogue, and neither checks
  `p_item_type` against the server's `rolled_category`.

Two consequences:

1. **Any cosmetic in the game is obtainable from a single common pull.** The
   inventory row records the honest rolled rarity, but `item_id` points at
   whatever the client asked for — and the UI renders artwork by `item_id`. The
   collection loop, which is the entire point of the system, is optional.
2. **`item_name` is an unvalidated client string** that lands in
   `user_inventory` and surfaces in marketplace listings other users see.

### L3 — MEDIUM, REACHABLE: which RPC you call changes your odds

Pity exists only in `open_capsule_atomic`. `claim_capsule_loot` rolls the same
base weights with **no pity counters at all** — it neither reads nor increments
them. A client that opens via `claim_capsule_loot` + `finalize_capsule_claim`
gets no epic-at-30 or legendary-at-90 guarantee, and its pulls don't advance
the counters for later `open_capsule_atomic` pulls either.

That is a fairness bug in both directions and it makes the pity promise in
migration 256 conditional on client behaviour.

### L4 — MEDIUM, LATENT: TRUNCATE is granted on both tables

| Role | Table | TRUNCATE |
|---|---|---|
| `authenticated` | `user_capsules` | ✅ granted |
| `authenticated` | `user_inventory` | ✅ granted |
| **`anon`** | `user_capsules` | ✅ granted |

`TRUNCATE` **bypasses RLS entirely** — policies do not apply — so the privilege
implies "delete every user's capsules", not just your own.

**It is not reachable through PostgREST**, which has no REST verb that maps to
TRUNCATE; `DELETE` maps to SQL `DELETE`, which is RLS-bound. Exploiting it needs
a direct Postgres connection as that role, i.e. the database password, not the
publishable key. So this is a misconfiguration to clean up rather than a live
hole — but it is exactly the kind of grant that becomes live the moment
something else changes, and Supabase's own advisor flags it.

Almost certainly the Supabase default `GRANT ALL` on new public tables, never
narrowed.

### L5 — LOW: dead policies on `user_inventory`

`user_inventory` has INSERT and UPDATE policies but no matching grants, so they
can never fire. Harmless today, but they read as if client writes are supported
and would silently become live if someone re-granted.

---

## Status

| | Finding | State |
|---|---|---|
| L1 | Anyone could mint unlimited Elite Capsules | ✅ **fixed** — migration 266 |
| L2 | Item identity was client-chosen on every path | ✅ **fixed** — migration 267 |
| L3 | Pity existed on only one of the two roll paths | ✅ **fixed** — migration 267 |
| L4 | TRUNCATE granted to `authenticated` / `anon` | ✅ **fixed** — migration 266 |
| L5 | Dead policies on `user_inventory` | ✅ **fixed** — migration 266 |

### Correction the audit got wrong about L1

The audit said L1 was "one statement, nothing legitimate breaks". Wrong —
**three** client paths inserted into `user_capsules`, two of them real features
(login and workout streak milestone capsules). A bare revoke would have stopped
milestone capsules being granted at all, silently, because both sites swallow
the error into a `console.warn`. Migration 266 adds a server-validated
`grant_streak_capsule` first. The third path was an "admin sandbox" in
`CoinShopModal` that keyed off the email local part, so `admin@anything.com`
qualified — deleted rather than ported.

### Note on the L2/L3 fix

`loot_catalog` holds the 75-item drop pool, generated from the four client
modules and asserted against them by
`src/lib/__tests__/lootCatalogParity.test.js`. Both `open_capsule_atomic` and
`finalize_capsule_claim` now derive the item from that table plus the capsule's
own stored roll; every client-supplied item argument is accepted and ignored.
Signatures are unchanged on purpose — capsule opening has a legacy fallback and
a stranded-capsule recovery path, and changing arities would have broken
recovery.

`_roll_capsule_rarity` is now the single roller both open paths call, so pity is
identical whichever runs. Same "exists once" rule migration 261 applied to the
level curve.

**A mistake worth recording:** the first cut of the seed included
`BRANDED_ITEMS` — the 38 purchasable `flx_*` Daily Drop cosmetics — which would
have quietly made them free capsule drops. `getItemsByRarity` is documented
"stickers only for drops" and filters `ITEMS` alone, so branded items have never
been loot. `CapsuleOpener` *does* fold them into the spinning reel for visual
variety, which is what makes the two easy to conflate: **the reel is not the
drop pool.** The parity test now asserts no `flx_*` or `cap_*` id is ever
seeded.
