# Leaderboard UI — how shipping apps handle multiple boards

Follow-up to [gamification-ui-research.md](gamification-ui-research.md), focused on
one question: **we have four boards and three time windows. How do apps that do
this well avoid drowning the screen in filters?**

Read on 2026-07-29. Licence gates the same way as before — permissive means we
can lift code, copyleft means read for ideas only.

| Repo | Licence | Lift? | Read for |
|---|---|---|---|
| [`trophyso/ui`](https://github.com/trophyso/ui) | MIT | ✅ | `leaderboard-card`, `leaderboard-podium`, `leaderboard-rankings` |
| [`ppy/osu-web`](https://github.com/ppy/osu-web) | AGPL-3.0 | ❌ ideas | `RankingController`, `views/rankings/*`, `ranking-filter.less` |
| [`lichess-org/lila`](https://github.com/lichess-org/lila) | AGPL-3.0 | ❌ ideas | `ui/tournament/css/_leaderboard.scss` |
| [`heroiclabs/nakama`](https://github.com/heroiclabs/nakama) | Apache-2.0 | ✅ | rank/cursor semantics (already applied, migs 257–259) |

---

## The measured problem

Numbers taken from the running app at 375×812, not eyeballed.

| | Value |
|---|---|
| Dialog height | 715 px |
| Header + filters before the first row of data | **213 px** |
| Share of the surface spent on chrome | **30%** |
| Filter controls on screen at once | **7** |
| Filter rows stacked | **3** |
| Board × period combinations offered | 12 |
| Combinations that actually work | **8** |

That last pair is the real defect. `LeaderboardsContent` disables the two
period pills whenever the board is Achievements or Distance:

```js
const disabled = p.id !== 'alltime' &&
  (activeBoard === 'achievements' || activeBoard === 'distance');
```

So on half the boards, two thirds of the period control is rendered, occupies
prime vertical space, and does nothing. A disabled control is a control the
user has to read, evaluate and dismiss before they get to the content.

---

## What the references actually do

### Nobody puts every axis on the page as pills

**osu-web** has *more* dimensions than we do — eight ranking types
(`RankingController::TYPES`):

```php
const TYPES = [
    'global', 'country', 'top_plays', 'team',
    'playlists', 'matchmaking', 'daily_challenge', 'kudosu',
];
```

…plus four rulesets, plus a country filter. It never stacks them. Each axis
lives at a different altitude:

| Axis | Where it lives | Why |
|---|---|---|
| Ruleset (osu/taiko/catch/mania) | **Global nav**, shared app-wide | It's a property of the whole session, not this page |
| Ranking type (8 of them) | **Page-header links** | Primary navigation for this page |
| Country | **Dropdown** (`select-options--ranking`) | Long tail — a list, not a row of buttons |

`_country_filter.blade.php` is a labelled `<select>`, not pills, precisely
because the option count is unbounded.

**Trophy's `leaderboard-card`** — the composed, opinionated version of their
kit — does the same thing at small scale:

```tsx
{runOptions && runOptions.length > 0 ? (
  <select aria-label="Select leaderboard run" ... >
```

Title and date range on the left, a single `<select>` on the right. One row of
chrome, roughly 60 px. That is the whole header.

### The rule the references agree on

> Segmented controls are for a **small number of mutually exclusive options**
> that change the current view. When the option count grows, or when a second
> axis appears, the second axis becomes a dropdown — it does not become a
> second row of pills.

We have two axes and put both on screen as pills, which is exactly the case
the pattern warns against.

### Duolingo's answer is more radical

Worth naming because it's the most successful gamified-habit leaderboard
shipping: it offers **no dimension choice at all**. One metric (XP), one
window (this week), one cohort (your league of 30). Zero filter chrome. The
constraint is the feature — everyone is comparing the same number over the
same period, so a rank is unambiguous.

Ours can't go that far (four metrics is a real product decision), but it's the
direction the good examples lean.

---

## What we're missing visually

The current top three are ordinary rows with a coloured ring and a small icon.
Trophy ships `leaderboard-podium.tsx` (MIT, drop-in for our stack) which gives
1st/2nd/3rd genuine visual weight — reordered 2·1·3, graduated block heights,
crown badges:

```tsx
const podiumOrder = [
  top3.find((r) => r.rank === 2),
  top3.find((r) => r.rank === 1),
  top3.find((r) => r.rank === 3),
].filter(Boolean)
```

This is the single largest "make it beautiful" lever available, and it's a file
we're licensed to copy.

---

## Recommendation

Three changes, in order of payoff.

### 1. One axis on screen, not two

Replace three stacked rows with a single row:

```
[ ⚡ Level ▾ ]                              [ All-time ▾ ]
```

- **Metric** becomes a compact segmented control or dropdown. Four options with
  short labels (Level · Awards · Volume · Distance) fit one row at 375 px; the
  current labels ("Volume Lifted", "Distance Logged") do not, which is why they
  wrapped to a third row in the first place.
- **Period** renders *only when the active board supports it*. Achievements and
  Distance simply don't show it, instead of showing it greyed out. Dead controls
  disappear rather than being disabled.

Saves roughly 90 px — about two extra rows of athletes above the fold.

### 2. Cut the hero

213 px for a title, a subtitle, a "Top 100" badge and an animated gradient. The
references spend ~60 px: title, one line of context, the selector. Keep the
gradient as a thin accent rather than a block, fold "Top 100" into the footer
text that already says it.

### 3. Add the podium

Lift `leaderboard-podium.tsx` from `trophyso/ui` (MIT — keep the header or note
it in `ATTRIBUTIONS.md`), render it above the windowed list, and drop the
podium ring styling from the rows so the top three aren't styled twice.

Net effect: chrome goes from ~213 px to ~90 px, filter controls from 7 to 2,
dead controls from 4 combinations to 0, and the part everyone actually looks
at — who's winning — gets a real visual treatment.

---

## Not recommended

- **Don't move the metric selector into global nav** the way osu does with
  rulesets. That works there because the ruleset genuinely scopes the entire
  site. Our metric only scopes this one surface.
- **Don't paginate.** Trophy's `showPagination` is built for desktop. We already
  window (podium · gap · your neighbours), which is the better mobile answer and
  is already shipped.
- **Don't add more boards.** Four is already past what the layout supports at
  375 px. If a fifth is ever wanted, the metric control has to become a sheet
  first.
