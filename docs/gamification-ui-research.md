# Leaderboards, XP curves, coins & shops — what shipping apps do

Research pass over open-source apps and component libraries that are good at
the four mechanics Flexyn leans on: **leaderboard UI, level↔XP ratio, coin
balance, coin shop**. Read as *source*, not screenshots.

Read on 2026-07-28. Licence column is the gate — anything not
permissive is a **design reference only**; we don't lift code from it.

| Repo | Licence | Commercial lift? | Stars | Read for |
|---|---|---|---|---|
| [`trophyso/ui`](https://github.com/trophyso/ui) | MIT | ✅ yes | 123 | Leaderboard rankings / podium / card, points-levels timeline |
| [`heroiclabs/nakama`](https://github.com/heroiclabs/nakama) | Apache-2.0 | ✅ yes | 13.0k | Leaderboard rank semantics, tie-breaks, wallet ledger |
| [`runelite/runelite`](https://github.com/runelite/runelite) | BSD-2 | ✅ yes | 5.4k | The canonical XP→level curve (`Experience.java`) |
| [`ppy/osu`](https://github.com/ppy/osu) | MIT | ✅ yes | 18.8k | Score/rank presentation |
| [`HabitRPG/habitica`](https://github.com/HabitRPG/habitica) | GPL-3.0 | ❌ **ideas only** | 14.0k | Shop UI structure, dual currency, purchase confirm |
| [`isuru89/oasis`](https://github.com/isuru89/oasis) | Apache-2.0 | ✅ yes | 76 | PBML engine — stale (last push 2024-08) |
| [`ActiDoo/gamification-engine`](https://github.com/ActiDoo/gamification-engine) | MIT | ✅ yes | 470 | Rule engine — stale (2023) |

Files actually read:

- `trophyso/ui` → `apps/www/registry/trophy/ui/{leaderboard-rankings,leaderboard-podium,leaderboard-card,points-levels-timeline,points-levels-list,points-badge}.tsx`
- `nakama` → `server/core_leaderboard.go`, `server/core_wallet.go`
- `runelite` → `runelite-api/src/main/java/net/runelite/api/Experience.java`
- `habitica` → `website/common/script/statHelpers.js`, `website/client/src/components/shops/{shopItem,purchaseConfirmModal,balanceInfo,countdownBanner}.vue`

`trophyso/ui` is the closest technical analogue: MIT, React, Tailwind,
shadcn registry, lucide icons — the exact stack we already run. Its
components install via the shadcn CLI, so they're drop-in.

---

## 1. The XP curve is broken (and it's the biggest finding here)

`src/lib/xpSystem.js` says, in a comment:

> New target: level 50 in ~3 months, level 100 in ~1 year of dedicated
> training.

The actual curve it implements:

| Level | Total XP required (as shipped) |
|---|---|
| 10 | 1,651 |
| 30 | 12,903 |
| 50 | 105,546 |
| 70 | 1,398,636 |
| 90 | 46,101,123 |
| **100** | **192,438,890** |

At a steady 800 XP/day (one solid workout plus hydration logging), level
100 takes **659 years**. Even pinned at `DAILY_XP_CAP = 2500` every single
day forever, it's **211 years**. The comment in the file notes the previous
curve was rejected for putting level 100 at "~11M total XP (~12 years of
play)" — the replacement is **17× worse than the thing it replaced**.

### Why

`getLevelMultiplier(level)` picks a different base per tier, but
`getXpForNextLevel` always raises it to `level - 1`, measured from level 1:

```js
Math.floor(150 * Math.pow(multiplier, Math.max(0, currentLevel - 1)))
```

So crossing a tier boundary retroactively re-bases every level below it.
The cost per level doesn't step up — it **cliffs**:

| Boundary | XP for that level → next | Jump |
|---|---|---|
| L10 → L11 | 232 → 295 | 1.3× |
| L30 → L31 | 1,067 → 1,990 | **1.9×** |
| L60 → L61 | 24,224 → 78,608 | **3.2×** |
| L80 → L81 | 570,961 → 2,644,641 | **4.6×** |

The intent was piecewise-tiered growth. The implementation restarts the
exponent at level 1 with a new base each tier instead of compounding
forward from the boundary value.

### The consequence for the tier art

`src/lib/xpTier.js` has ten hand-tuned tiers with bespoke gradients,
particle systems and a `wear` parameter. Distribution of the ladder under
the shipped curve:

| Levels | Share of total XP to 100 |
|---|---|
| 1–10 (Bronze) | 0.0% |
| 11–30 (Silver, Gold) | 0.0% |
| 31–60 (Sapphire, Emerald, Ruby) | 0.1% |
| 61–80 (Amethyst, Platinum) | 2.3% |
| **81–100 (Diamond, Legendary)** | **97.2%** |

Amethyst upward is decorative. Nobody reaches it. Meanwhile Bronze through
Gold blur past in under a fortnight.

### What the references do

**RuneLite** (`Experience.java`) — one continuous exponential, no tiers:

```java
int difference = (int) ((double) level + 300.0 * Math.pow(2.0, (double) level / 7.0));
xp += difference;
XP_FOR_LEVEL[level - 1] = xp / 4;
```

Growth factor is `2^(1/7) = 1.1041`, constant for all 99 levels. Total to
99: 13,034,431. It has survived 25 years and is the most-copied curve in
games precisely because it has **no discontinuities**.

**Habitica** (`statHelpers.js`) — quadratic, deliberately gentle, because
the game is a habit tracker and not a grind:

```js
Math.round(((lvl ** 2) * 0.25 + 10 * lvl + 139.75) / 10) * 10
```

Total to level 100: **144,950**. Three orders of magnitude below ours.

| Level | Flexyn (shipped) | OSRS | Habitica | Mee6 |
|---|---|---|---|---|
| 25 | 8,529 | 7,842 | 7,110 | 41,900 |
| 50 | 105,546 | 101,333 | 28,740 | 268,275 |
| 75 | ~2.8M | 1,210,421 | 71,300 | 855,000 |
| 100 | **192,438,890** | — (99: 13.0M) | 144,950 | 1,899,150 |

Flexyn tracks OSRS almost exactly up to level 50, then detonates.

### Recommendation — continuous tiers, decelerating

Keep the tier idea, fix the compounding, and **decelerate** the growth
rate rather than accelerating it. Steep early percentages on tiny numbers
feel fast; gentle late percentages on large numbers stay reachable.

```
base 100, growth 1.110 / 1.085 / 1.050 / 1.040 / 1.030
```

applied *continuously* — each level's cost is the previous level's cost
times the growth factor for that band.

| Level | Total XP | Days @ 800 XP/day |
|---|---|---|
| 10 | 1,412 | 2 |
| 25 | 8,786 | 11 |
| 50 | 59,712 | 75 (≈2.5 months) |
| 75 | 226,562 | 283 |
| 90 | 438,257 | 548 |
| 100 | 643,859 | 805 (≈2.2 years) |

Largest boundary jump: **1.11×** (was 4.6×). Ladder share by tier band:
0.3% / 2.1% / 15.0% / 29.0% / 53.6% — every one of the ten cosmetic tiers
is now somewhere a real person passes through.

Level 99 → 100 costs 23,401 XP, about a month of dedicated training. A
real final push, not a wall.

**This is safe to change right now.** Production has 38 users, 8 with any
XP at all, and a maximum of 559 total XP — level 4. Nobody has a level
that a recalibration would take away. That window closes the moment the
app gets traction.

---

## 2. Leaderboards

### The windowing problem

`LeaderboardsContent.jsx` renders a flat list of up to 100 rows, then
patches over the consequences:

- a sticky "Your rank #N" pill pinned to the top (lines 312–338)
- logic to *suppress* the user's real row so they don't appear twice
  (lines 339–349)

`trophyso/ui`'s `leaderboard-rankings.tsx` solves this at the data layer
instead. Each row carries `displayed?: boolean`; the renderer folds runs of
hidden rows into a single ellipsis:

```tsx
pagedRankings.forEach((ranking, index) => {
  const isDisplayed = ranking.displayed !== false
  if (!isDisplayed) { hiddenRunCount += 1; return }
  if (hiddenRunCount > 0) { nextRows.push({ type: "ellipsis", ... }); hiddenRunCount = 0 }
  nextRows.push({ type: "ranking", ranking })
})
```

That gives the standard shape — **top 3, `…`, the three rows above you,
you, the three rows below you** — where the user sees their actual
neighbours and knows exactly who to pass next. A pinned pill tells you the
number but hides the only thing that makes a rank actionable: who is 40 XP
ahead of you.

### Rank deltas

Trophy's row renders a `rankChange` with a trend arrow:

```tsx
{ranking.rankChange > 0 ? <TrendingUp/> : <TrendingDown/>}
{Math.abs(ranking.rankChange)}
```

We already compute exactly this on the Dashboard — `LeagueCard.jsx` has
`prevRankRef` / `rankDelta` — but the main leaderboard shows nothing.
Movement is the reason people re-open a leaderboard.

### Value formatting

Trophy: `formatLeaderboardValue` → `1.2k` / `3.4m`. We render
`useNumberFormatter` on raw values, so the volume board shows
`1,284,650 lbs` in a row that also has to fit a name and a rank. Compact
notation is what every reference does.

### Tie-breaks and scale (Nakama)

`core_leaderboard.go` always orders on a **full deterministic key**:

```sql
ORDER BY score DESC, subscore DESC, owner_id DESC
```

…and paginates with a keyset cursor on `(leaderboard_id, expiry_time,
score, subscore, owner_id)`, backed by a dedicated rank cache
(`leaderboard_rank_cache.go`).

Ours sorts in memory on a single value:

```js
.sort((a, b) => valueOf(b) - valueOf(a))
```

Two users on equal XP get whatever order `Array.prototype.sort` produced
that render — they can visibly swap places on a refetch with nothing
having happened. A `subscore` tie-break (earliest to reach the value wins,
then id) makes it stable and is also *fairer*: first to get there ranks
higher.

The all-time path also still calls `db.entities.User.list()` and ranks the
entire user table client-side — already tracked in the performance notes,
but worth restating: Nakama's answer is a server-side rank cache, and our
`get_period_leaderboard` RPC is already the right shape. All-time should
move behind the same RPC.

---

## 3. Coins and the shop

### The dead end

`CoinShopModal.jsx` renders four flat rows. When you can't afford one you
get a `Lock` icon and a `disabled` button. That's the whole interaction.

Production numbers make this the common case, not the edge case:

| | Value |
|---|---|
| Median coin balance | **5** |
| Cheapest SKU | **100** (Standard Capsule) |
| Most expensive SKU | 1,000 (Elite Capsule) |

The median user opens the shop and sees **four locked rows and no path
forward**. There is no "here's how to earn coins", no progress toward the
cheapest item, no indication of how far off they are.

### What Habitica ships (design reference — GPL, don't lift code)

The component list alone is the finding. `website/client/src/components/shops/`:

| File | What it does that we don't |
|---|---|
| `balanceInfo.vue` | Persistent balance strip; flags **which** currency is short (`notEnough`) rather than just greying the button |
| `purchaseConfirmModal.vue` | Promise-resolving confirm step before any spend |
| `countdownBanner.vue` | Live per-second countdown on limited-availability stock |
| `featuredItemsHeader.vue` | A hero slot — one item gets the visual weight |
| `shopItem.vue` | Item state: `owned`, `emptyItem`, `highlightBorder`, `showEventBadge`, attribute popover |
| `sellModal.vue` | Sell path lives in the same surface as buy |

`balanceInfo.vue` is the one to copy in spirit:

```js
if (currency.type === this.currencyNeeded
  && !this.enoughCurrency(this.currencyNeeded, this.amountNeeded)) {
  currency.notEnough = true;
}
```

Insufficient funds is treated as *information about a gap*, not as a
disabled state.

### Missing value math

Our three capsules are 100 / 350 / 1000 coins with prose descriptions
("Better odds at rare and epic drops"). No tier is marked as the good
deal, and nothing quantifies the odds the copy alludes to. Every shipping
F2P shop marks a "best value" tier — it's the single highest-converting
element in a currency store, and it also makes the ladder legible.

### Rarity colour

`UserBag.jsx` and `MarketplaceFeed.jsx` colour items by rarity. The shop
sells the *sources* of those items in flat neutral rows with an emoji.
Elite Capsule should look elite in the place you buy it.

---

## 4. What's worth doing, ranked

| # | Change | Where | Why now |
|---|---|---|---|
| 1 | Continuous decelerating XP curve | `src/lib/xpSystem.js` | Correctness bug. 8 users have XP; the window to recalibrate is open and closing |
| 2 | Windowed leaderboard (top 3 · `…` · neighbours) | `LeaderboardsContent.jsx` | Makes rank actionable; removes the pill/suppression hack |
| 3 | Deterministic tie-break | `LeaderboardsContent.jsx` | Rows visibly swap on refetch today |
| 4 | Compact value format (`1.2k`) | `LeaderboardsContent.jsx` | Rows overflow on the volume board |
| 5 | Rank delta arrows | `LeaderboardsContent.jsx` | Logic already exists in `LeagueCard.jsx` |
| 6 | Shop: affordability gap + earn path | `CoinShopModal.jsx` | Median user (5 coins) currently hits a dead end |
| 7 | Shop: confirm step on ≥350-coin SKUs | `CoinShopModal.jsx` | One mistap currently spends 1,000 coins |
| 8 | Shop: "best value" marker + rarity colour | `CoinShopModal.jsx` / `coinShop.js` | Makes the price ladder legible |
| 9 | All-time board → server RPC | `periodLeaderboard.js` | `User.list()` doesn't scale; RPC shape already exists |

Items 1–8 are client-side only. Item 9 needs a migration.

---

## Licence notes

- `trophyso/ui` is MIT and distributed through the shadcn registry —
  components are copied into your tree, so keep the MIT header when we
  lift a file wholesale, or note the derivation in `ATTRIBUTIONS.md`.
- `runelite` is BSD-2. The formula itself isn't copyrightable; the
  implementation is. We derive our own.
- **Habitica is GPL-3.0.** Read it for ideas, write our own code. Its
  assets are CC-BY-SA and are not usable here at all.
