# Trophies Audit — 2026-08-12

**Scope:** four named sub-features — Trophy case · Collection · Sort by rarity ·
Filter locked/unlocked
**Measured against:** `origin/main` @ `4ff63aa7` + production `ebvqxuwfiptcmlkhflfj`, 2026-08-12
**Method:** claim / proof / what-failure-looks-like. Every layout figure was **rendered
and measured** in a Vite harness at 390 px, dark — never derived from Tailwind classes.
Every production figure was queried.
**Brief:** [docs/trophies-audit-prompt.md](trophies-audit-prompt.md)
**Predecessor:** [docs/achievements-audit.md](achievements-audit.md) — its finding D1
lands inside sub-feature 2 and is carried here rather than re-derived.

---

## HEADLINE

Two of the four sub-features do not exist. One works and is the wrong idea. One is
wrong three separate ways.

| # | Sub-feature | Verdict | One-line reason |
|---|---|---|---|
| 1 | Trophy case | **(a) exists and works** | Every mechanism verified. It is an emoji picker called a trophy case — **0 of the 7 picks in production is a trophy the picker earned**, and 61 of 63 people have never touched it. |
| 2 | Collection | **(b) exists and is wrong** | The header disagrees with the grid beneath it in three independent ways, one of which can print `121 / 120`. |
| 3 | Sort by rarity | **(d) absent** | No ordering control anywhere. The default order is **undefined for 17 of one account's 21 tiles**, and a tier sort would sort 71% of them into one block. |
| 4 | Filter locked / unlocked | **(d) absent** | No filter, and not answerable as built: the locked half is ten identical `aria-hidden` padlocks with no identity. |

---

## GROUND TRUTH — production, queried 2026-08-12

| Fact | Value |
|---|---|
| `user_trophies` rows | **56** across **16** users |
| distinct `trophy_id`s held | **24** — all 24 resolve through `getTrophy()` |
| ids held by exactly one user | **9** |
| most-held id | `regimen_1`, **9** holders |
| profiles | **63** |
| profiles with any trophy-case pick | **2** (kegan, sean) |
| picks that match a trophy the owner earned | **0 of 7** |
| profiles with `signature_trophy` set | **0** — the feature has never been used once |
| profiles with `trophy_case_visible = false` | **0** |
| private profiles | **0** — so `public_profiles.full_view` has never once been false |
| `CHECK` constraints or triggers on `trophy_case` | **none** |

**Catalog shape** (`src/lib/trophyDefinitions.js`): 120 named rungs · 10 categories ·
five tiers — bronze 31, silver 29, gold 32, platinum 13, legendary 15.

**Tier spread of what people actually hold** (all 24 live ids): bronze 17, silver 5,
gold 1, platinum 1, **legendary 0**. This number decides sub-feature 3.

**Rendered measurements** — harness at 390 px, dark, `origin/main` source:

| Panel | State | Header | Tiles | Row shape |
|---|---|---|---|---|
| A | brand-new account | `0 / 120` | 0 | — (empty state; **no locked frames at all**) |
| B | one trophy | `1 / 120` | 11 | 5+5+**1** |
| C | sean's real 21 rows | `21 / 120` | 31 | 5+5+5+5+5+5+**1** |
| D | C seen by a stranger | `21 / 120` | 31 | identical |
| E | case hidden, stranger | `21 / 120` | 31 | case section correctly absent |
| F | tail + season + one unresolvable id | **`6 / 120`** | 15 | **5 earned tiles rendered** |

---

## The thing that decides this audit

Two different objects are both called "a trophy" on this one screen, 24 px apart.

| | Trophy case (top) | Collection (below) |
|---|---|---|
| Holds | an emoji you picked | a `user_trophies` row |
| Comes from | a hardcoded list at `HubProfile.jsx:2328` | `grant_eligible_trophies()`, SECURITY DEFINER |
| Stored in | `user_profiles.trophy_case` jsonb | `public.user_trophies` |
| To get one | tap it | meet a criterion |
| Validated by | nothing — no constraint, no trigger | migration 189, which removed a client INSERT policy because it allowed badge forgery |

**This split is deliberate and documented.** `trophyDefinitions.js:3-6` says so in the
file header: *"AUTO-AWARDED milestones — distinct from the decorative emoji picker on
the profile"*. So the split is not drift, and the emoji picker is not a security hole —
it mints nothing. What follows from it is a naming problem, not a data one, and it is
the first product call below.

---

## 1 · TROPHY CASE — (a) exists and works

### CLAIM
Pick five trophies to display; slot 1 is your primary.

### PROOF
Every mechanism does what it says. Five slots render, the picker sheet opens, a pick
persists to `user_profiles.trophy_case`, `handleTrophySlotSet` calls `checkUserAuth()`
after the write so the banner crest and the signature list move without a reload
(`HubProfile.jsx:867` documents why the invalidate alone was not enough — that fix
holds). Slot 1 carries all three of its markers — amber ring, pin badge, "Primary"
caption. `showCase` (`ProfileTrophies.jsx:53`) correctly hides the whole section from a
stranger when `trophy_case_visible` is false; panel E confirms it, and the banner drops
the crest on the same flag.

**What it does not do is let you pick a trophy.** The sheet offers ~120 hardcoded emoji
— 🎰 🃏 🪗 🛸 🎬 among them — and nothing checks them against `user_trophies`. Measured
against the only two people who have ever used it:

| User | Case | Emoji of the trophies they earned | Overlap |
|---|---|---|---|
| kegan (15 earned) | 🎬 🦁 | 🥉 🏗️ 🛡️ 👋 📓 💬 🎁 🏃 🪙 💭 🤝 🥗 🌟 💫 📈 | **none** |
| sean (21 earned) | ☀️ 🥋 🎉 ⚔️ 🎖️ | 💬 🎯 🏗️ 🪙 👋 📆 📈 💭 🏷️ 📓 🍽️ 🥗 📣 📚 🤝 🌟 💫 🛡️ 🏃 🔰 | **none** |

Slot 1 is struck into the profile banner as a crest (`HubProfile.jsx:1348`). So the
crest on kegan's banner — the single most prominent achievement-shaped thing on his
profile — is a clapperboard, chosen from a menu, sitting directly above fifteen
trophies he actually earned.

### WHAT FAILURE LOOKS LIKE
Nothing breaks. The failure is that **61 of 63 people have never opened it**, and
`signature_trophy` — the feature downstream of it, which pins a case emoji beside your
name in the feed — is set on **0 of 63 profiles**. A decoration nobody can lose and
nobody earned is a decoration nobody bothers with.

### PRODUCT CALL — this is kegan's, not mine
Three options, in ascending cost:

1. **Rename it.** "Showcase" / "Flair", and the claim stops being false. Free.
2. **Constrain the picker to earned trophy emoji**, falling back to the current list
   while a user has none. Turns the case into a reward for collecting — which is what
   the collection below it is for — at the cost of an empty case for most accounts.
3. **Delete it and promote five collection tiles** into the case. Slot 1 becomes "pin
   your best real trophy". This is the only version where the banner crest means
   something.

I have applied none of them. Note that option 2 or 3 makes the case a *second* reader
of `user_trophies` and both would then need the count fix from sub-feature 2.

### SMALLER ITEMS
- **The sheet's chrome is hardcoded English** — "Choose Trophy", "Remove", "Signature
  trophy", "Tap the active one to remove it.", and the failure toast "Could not update
  trophy case". Five literals on a surface whose slot `aria-label`s all go through
  `tFallback`, i.e. an inconsistency inside one component. **Not machine-translated** —
  standing rule.
- **`trophy_case` has no CHECK constraint and no trigger.** The client is the only thing
  guaranteeing five slots and a `{type, value}` shape. Harmless today (the column mints
  nothing and React escapes the string) but it is the sort of column a later reader will
  assume is validated.
- **The write is a legitimate direct client update** — `trophy_case` is correctly absent
  from migration 142's immutable list. Verified against the installed triggers, not the
  migration file.

---

## 2 · COLLECTION — (b) exists and is wrong

### CLAIM
Here is everything you've earned, out of everything there is.

### PROOF
The set is right. The number above it is wrong three separate ways, and they compound.

**(i) The inherited one.** `ProfileTrophies.jsx:136` computes
`earnedIds.size / TROPHIES.length`. The achievements vault computes the same fraction
with a filtered numerator — it drops `isTail`, `season` and `isXpMilestone` with the
comment *"a numerator that can exceed its denominator reads as a broken counter"*
(`AchievementsTab.jsx:304-309`). **That fix has still not been applied here.**
`docs/achievements-audit.md` D1 reported this on 2026-08-12; re-verified today at
`4ff63aa7`: sean's 21 rows read **`21 / 120`** on this surface and **`20 / 120 +1`** in
the vault, and one of the two is above a list of 21 tiles.

**(ii) A row the catalog cannot resolve inflates the header and renders nothing.**
`earnedIds` is built from every row (`:41`); the grid drops any row where
`getTrophy(id)` is falsy (`:152`). Harness panel F, six rows in — one of them a junk id:

```
header:  6 / 120
tiles:   5
```

Production is clean today (**0 of 24 ids fail to resolve**), so this is latent — but it
is exactly the shape that a renamed ladder id produces, and it fails *silently and
upward*, which is the worst direction for a completion counter.

**(iii) The numerator has no ceiling.** Panel F also renders `sessions_x2`
("Centurion III", Legendary) and `league_s1_gold` ("Season 1 Gold") — both resolve,
both render, both count, and **neither is in `TROPHIES`**, by design. A user holding
all 120 named rungs plus one infinite-tail rung renders **`121 / 120`**. No season
trophy has been minted yet, but `league_seasons`, `award_league_season_internal` and
two crons are live on 28-day seasons, so the first resolution puts a season row on
every participant.

All three close with the same edit — apply the vault's filter, and drop rows that fail
to resolve from the numerator as well as the grid.

### WHAT FAILURE LOOKS LIKE — rendered, not argued
Panel C, sean's real rows at 390 px: header reads `21 / 120`, the vault one tap away
reads `20 / 120 +1`, and the app has told the same person two different numbers about
the same 21 objects inside ten seconds.

### THREE MORE, ALL VISIBLE
- **`grid-cols-5` on a data-driven count.** `CLAUDE.md`'s rule is that a collection
  whose item count comes from data uses `tileRow()`, never `grid-cols-N`, because a grid
  packs a partial last row into its leading columns. Both halves here are data-driven
  and both measured with an orphan: panel B is **5+5+1**, panel C is **5+5+5+5+5+5+1**.
  A single padlock hard against the left edge with four empty columns beside it. No
  `col-span-*` is present, so the conversion is clean.
- **A brand-new account gets no locked frames at all.** The `earnedIds.size === 0`
  branch (`:140`) returns the empty-state card instead of the grid, so panel A renders
  **zero** padlocks. The frames exist to show "the shape of what's left" — and the one
  person who has nothing but what's left never sees them.
- **On a phone, a trophy has no name.** A tile is an emoji, a 2 px tier stripe, a
  `title` attribute and an `sr-only` string. `title` does not open on touch, and this app
  ships to iOS and Android only. So 🌟 and 💫 sit side by side in sean's grid as
  "Legendary Find" (Gold) and "Legend Collector" (Platinum) with nothing on screen
  distinguishing them but two colours of hairline. The 7 px tier caption was removed for
  good reasons (`:10-13`) and removing it was right; nothing replaced it.

---

## 3 · SORT BY RARITY — (d) absent

### CLAIM
You can order the collection by how rare a trophy is.

### PROOF
There is no ordering control on this surface. `ProfileTrophies` holds no state at all —
it is a pure function of props — and `listEarned()` (`src/lib/data/trophies.js:32`)
orders `earned_at DESC`, which the component maps straight out.

**There is also no `rarity` field.** A trophy has a `tier` (bronze → legendary); rarity
belongs to the loot catalog. Two candidate meanings, and they give opposite answers:

| Sort key | What it would produce for sean's 21 |
|---|---|
| `TROPHY_TIERS[tier].order` | one **15-tile bronze block**, a 4-tile silver block, and two singletons |
| holders across `user_trophies` — real scarcity | meaningful: **9 of 24 live ids are held by exactly one user**, and the most-held is `regimen_1` at 9 of 16 |

Tier is the axis the UI already shows (the stripe), and it is the one that barely
sorts: **71% of everything anyone holds is bronze**, and nobody in production holds a
single legendary. Scarcity is the axis that would mean something, and nothing computes
it — it needs a cross-user aggregate this surface has never asked for.

### THE DEFECT UNDERNEATH — the current order is undefined
This is the finding worth acting on, and it is not the missing control.
`grant_eligible_trophies()` grants in sweeps, so **17 of sean's 21 rows share one
identical `earned_at`** (`2026-08-11 06:44:09.510972+00`). `ORDER BY earned_at DESC` is
a total order over three timestamps and says nothing about the 17 inside the largest
group — Postgres returns them in whatever order the plan produces. Today that is
physical row order:

```
post_1 > bounty_1 > regimen_1 > coin_1k > follower_1 > nday_7 > debrief_1 > …
```

— neither alphabetical, nor insertion order, nor anything a user could name. **81% of
that grid is in an order nothing guarantees**, and any row rewrite reshuffles it.

The visible consequence: sean's two rarest trophies — the only Gold and the only
Platinum he owns — land at positions 16 and 17, in the middle of row four, with four
more bronzes after them.

### RECOMMENDATION — do not build the control; fix the default
A tier *sort control* on 21 tiles that are 71% one tier is a control that does almost
nothing, and this grid is four rows. Instead give `listEarned()` a deterministic
secondary sort and make it the one that flatters the collection:
`ORDER BY earned_at DESC, <tier order> DESC, trophy_id`. That closes the undefined
order, puts the rarest thing a user owns in the first row where the case sits beside
it, and adds no UI. If a sort control is ever wanted, the honest key is holder count,
which is a new server-side aggregate and a different piece of work.

Constraints if it is built anyway: `tileRow()` over `grid-cols-N`, the two spacing
registers, no gradient, no glassmorphism, no coloured shadow — and read
`src/components/loot/CollectionModal.jsx` first, which already groups a collection by
rarity tier and has been through a redesign pass.

---

## 4 · FILTER LOCKED / UNLOCKED — (d) absent

### CLAIM
You can narrow the collection to what you have, or what you don't.

### PROOF
No filter control exists. The grid renders earned tiles, then locked frames,
unconditionally, with no state between them.

**And as built, "show me what's locked" is not answerable even in principle.** The
locked half is:

- **capped at ten** — `MAX_LOCKED_FRAMES = 10` (`:48`), so a user with 21 of 120 sees
  ten padlocks, not 99;
- **identical** — every frame is the same 🔒 at 25% opacity;
- **`aria-hidden="true"`** — so it does not exist for a screen reader at all;
- **absent entirely at zero earned** (panel A, above).

There is nothing to filter *to*. A "Locked" tab on this surface would show ten
anonymous padlocks.

The cap itself is right and the comment defending it (`:42-47`) is a good argument —
65 padlocks was a wall of grey that buried the earned tiles. The problem is that
capping the frames also capped what they could ever mean.

### THE PRECEDENT, AND WHY IT DOES NOT TRANSFER
`CollectionModal.jsx` ships exactly this control for loot — All / Owned / **Missing**
over 113 items plus a search box — and its head comment says the Missing filter is
*"the chase list, which is the whole point and was previously unreachable"*. The
argument is sound there because every missing loot item has a name, an image, a rarity
and a drop source: the chase list is browsable.

The trophy equivalent already exists and it is not on this surface. The achievements
vault's **"In progress"** tab renders every unearned ladder with its live progress bar
— the real chase list. So Trophies and Achievements answer the same question in two
places, and only one of them can.

### RECOMMENDATION
Do not build a filter here. Make the locked frames **a link to the vault's In-progress
tab** — the row of padlocks is already the visual promise of "there is more", it just
currently goes nowhere — and render them on a zero-trophy account too, where the promise
matters most. That is a few lines and it removes the duplicate rather than adding a
second answer.

---

## FINDINGS — severity ranked

### Defects

| # | Sev | Finding | Concrete failure | Evidence | Fix |
|---|---|---|---|---|---|
| T1 | **High** | Collection count disagrees with the vault and with its own grid | sean sees `21 / 120` here and `20 / 120 +1` in the vault, one tap apart, for the same 21 rows | rendered panel C; `ProfileTrophies.jsx:136` vs `AchievementsTab.jsx:304-309` | apply the vault's `isTail / season / isXpMilestone` filter — the same one-line fix D1 asked for and did not get |
| T2 | **High** | An unresolvable `trophy_id` counts in the header and renders nothing | header `6 / 120` above 5 tiles | rendered panel F | build `earnedIds` from rows that resolve, not from all rows (`:41`) |
| T3 | **Med** | The numerator has no ceiling | one infinite-tail rung on a full catalog renders `121 / 120` | panel F resolves `sessions_x2` and `league_s1_gold`, both outside `TROPHIES` | same edit as T1 |
| T4 | **Med** | Earned-trophy order is undefined for most of the grid | 17 of sean's 21 share one `earned_at`; order is whatever the plan returns | prod query, three distinct timestamps | deterministic secondary sort in `listEarned()` |
| T5 | **Med** | `grid-cols-5` on a data-driven collection | one orphan tile packed left with four dead columns, on every count that is not a multiple of 5 | measured 5+5+**1** and 5+5+5+5+5+5+**1** | `tileRow()` from `src/lib/tileRows.js`; no `col-span-*` present |
| T6 | **Low** | A brand-new account sees no locked frames | the "shape of what's left" is hidden from the only user who is all "left" | panel A, 0 tiles | render the frames in the empty-state branch too |
| T7 | **Low** | A trophy has no name on a touch device | 🌟 Gold and 💫 Platinum are two emoji and two hairlines | `title` + `sr-only` only, `:157-161` | a name on tap, or reinstate a legible caption |
| T8 | **Low** | Five hardcoded English literals in the picker sheet | non-English users get "Choose Trophy" / "Remove" | `HubProfile.jsx:2345-2360`, `:1979` | `tFallback` keys; **do not machine-translate** |

### Product calls — kegan's, not mine

| # | Call | The number behind it |
|---|---|---|
| P1 | **"Trophy case" is an emoji picker.** Rename, constrain to earned, or replace with real trophies | 2 of 63 profiles used it; **0 of 7 picks is a trophy the owner earned**; `signature_trophy` is 0 of 63 |
| P2 | **Sort by rarity is not worth building as a control** | 71% of everything held is bronze; nobody holds a legendary; the grid is four rows |
| P3 | **Filter locked/unlocked duplicates the vault's In-progress tab** | the locked half is 10 identical `aria-hidden` frames with no identity |

### Not defects — checked and clean

- The set is right: **all 24 production ids resolve**, no duplicates (`earnedIds` is a
  Set), and the grid and the vault read the same rows from the same `listEarned()`.
- `trophy_case_visible` gates the case correctly for a stranger and drops the banner
  crest with it (panel E).
- The write path's `checkUserAuth()` fix holds — the banner and signature list move
  without a reload.
- `trophy_case` is correctly *not* on migration 142's immutable list; this is a
  legitimate client write, verified against the installed triggers.
- The `MAX_LOCKED_FRAMES = 10` cap is a good decision with a good comment. Its
  consequence is a finding; the cap is not.

---

## WHAT I CHANGED

**Nothing.** No code was modified, no migration written, no production row touched. The
render harness was a throwaway Vite entry that mounts `ProfileTrophies` against six
fixtures and is not committed; the SQL was `SELECT` only. Every
fix above is described with its blast radius and left for a decision — T1/T2/T3 are one
edit and should go together, and P1 changes what the surface is *for*, so it comes
first.
