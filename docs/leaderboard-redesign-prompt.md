# Prompt — leaderboard UI redesign

Self-contained brief for executing the redesign proposed in
[leaderboard-ui-research.md](leaderboard-ui-research.md). Paste into a fresh
session; it assumes no memory of the one that wrote it.

---

## Task

Redesign the global leaderboard UI in `~/flexyn2` (Flexyn, React + Vite +
Supabase + Tailwind + Radix). The surface is
`src/components/LeaderboardsContent.jsx`, rendered inside
`src/components/LeaderboardsModal.jsx`, reached from Stats Hub → Leaderboards.

Read `docs/leaderboard-ui-research.md` and `docs/gamification-ui-research.md`
first — the research is done, don't redo it. Re-verify any measurement you
intend to quote.

## Where it stands

Already shipped, do not rebuild:

- Windowed list — podium · collapsed gap · your neighbours
  (`windowRanked` in `LeaderboardsContent.jsx`, tested in
  `src/components/__tests__/leaderboardWindowing.test.js`)
- Server-side ranking with deterministic tie-breaks (migrations 257–260, all
  applied to production)
- `useGlobalRank` hook + rank on the level badge and Dashboard league card
- Compact locale-aware value formatting, rank-delta arrows

## Build this

**1. Collapse the filter chrome from two axes to one row.**

Today: three stacked rows, seven pills — `All-time / This month / This week`
then `Level / Achievements` then `Volume Lifted / Distance Logged`.

Target: one row. Metric as a segmented control using short labels
(`Level · Awards · Volume · Distance`) with the existing lucide icons — the
current labels are why the row wrapped. Period renders **only when the active
board supports it** (Level and Volume). On Achievements and Distance it is
absent, not disabled.

The current code disables those pills instead:

```js
const disabled = p.id !== 'alltime' &&
  (activeBoard === 'achievements' || activeBoard === 'distance');
```

Four of twelve board×period combinations are dead. After this change: zero.

If four segments genuinely cannot fit at 375 px after trying icon + short
label, fall back to a dropdown for the metric and say so — do not ship a
wrapped or horizontally-scrolling segmented control.

**2. Cut the hero from 213 px to roughly 60.**

Title, one line of context, the selector. Keep the gradient as a thin accent
rather than a block. Fold the "Top 100" badge into the existing footer text
that already says it. Delete the animated `radial-gradient` pulse.

**3. Add a real podium.**

Lift `apps/www/registry/trophy/ui/leaderboard-podium.tsx` from
[`trophyso/ui`](https://github.com/trophyso/ui) (**MIT** — keep the licence
header or record the derivation in `ATTRIBUTIONS.md`, which already tracks
this kind of thing). Port TS → JSX to match the codebase. Render it above the
windowed list and **remove `PODIUM_STYLE` ring/glow from the rows**, so the
top three are styled once, not twice.

Rank colours reference `text-rank-1/2/3` tokens that don't exist here — map
them to the existing palette (gold / slate / orange, as `PODIUM_STYLE`
already does) rather than adding new tokens.

## Constraints

From `CLAUDE.md` — read it, these are not optional:

- **TDZ trap.** Declare every `const` before first use, including inside
  `useEffect`/`useMemo` deps arrays. A production crash came from exactly this.
- **i18n.** `tFallback('key', 'English fallback')` at call sites. English keys
  go in `src/lib/i18n-leaderboards.js` with a `TODO(i18n)` comment. Never ship
  machine-translated copy for the other 14 locales.
- **Build guard.** `vite.config.js` turns `MISSING_EXPORT` /
  `UNRESOLVED_IMPORT` into build failures. If it fires, fix the import — never
  disable the guard.
- **Gate before every push:** `npm run lint` (must be clean),
  `npm run test`, `npm run build`.
- **Push convention:** feature branch first, then fast-forward `main`. Never
  force-push `main`. Fetch and rebase before starting.
- **After every push, post the SQL inline in chat** in a ```sql block, or say
  "No SQL needed — frontend only". Never point at a file path — the user is on
  mobile. This change should need no SQL; say so explicitly.

## Traps that cost time last session

- **`h-full` inside modals.** `LeagueCard` rendered as a 704 px slab in Stats
  Hub because `height: 100%` resolved against a fixed-height modal body. Any
  `h-full` you add must be opt-in via prop and justified by a bounded parent.
- **`grid-cols-3` at 375 px.** A tile of icon + label + chevron gets ~35 px of
  label and wraps to one character per line. Two columns is the ceiling.
- **Two `ProfileMenu` mounts exist in the DOM**; on mobile the sidebar one is
  0×0. `querySelector('button[aria-label^="Profile"]')` grabs the invisible one
  and silently does nothing. Filter by `getBoundingClientRect().width > 0`.
- **Dev server:** `preview_start` reports a port that vite may not honour when
  5173 is taken. Confirm the real port with `curl` before driving the browser.
- The modal is behind auth. Drive it: profile avatar → `Lv N` pill → Stats Hub
  → Leaderboards.

## Verification — required, not optional

Do not report done on tests alone. Verify in the browser at **375×812**:

1. Screenshot each board (Level, Awards, Volume, Distance) and confirm the
   period control appears only on Level and Volume.
2. Re-measure and report the before/after numbers the research quotes:
   header height in px, count of filter controls, count of dead board×period
   combinations. Before was 213 px / 7 / 4.
3. Confirm the podium renders for the top three and that no row carries a
   duplicate ring.
4. `read_console_messages` clean.
5. Confirm the windowed list still behaves — the user appears exactly once,
   and the ellipsis still collapses the gap.

Add tests for any new pure logic. Existing suite is 1972 passing across 146
files; it must stay green.

## Done means

Chrome ~90 px or less, two filter controls, zero dead combinations, podium
rendering, suite green, lint clean, build clean, screenshots posted, pushed to
`main`, and an explicit "No SQL needed — frontend only".

If any of the three changes turns out to be wrong once you see it on screen,
say so and stop rather than shipping something worse than what's there. State
what you'd do instead.
