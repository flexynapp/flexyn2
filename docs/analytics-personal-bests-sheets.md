# Advanced Analytics + Personal Bests — as sheets

Board spec for the Penpot page, written while the Penpot MCP plugin was
unreachable. Everything here is decided; building the boards from it is
mechanical.

**The ask** (kegan, 2026-08-10): audit and revamp both surfaces, and make
them open and appear the way the Daily Quests and Readiness menus do.

**Status:** spec only. Nothing below exists in code. The one thing already
shipped is unrelated to layout — see *The bug found on the way in*.

---

## Where the two surfaces actually are today

They are in different places, and only one of them is far away.

| | presentation | distance from the target |
|---|---|---|
| **Advanced Analytics** | centered Radix `Dialog`, `max-w-2xl max-h-[80vh]` | far — no slide-up, no handle, no safe-area padding, queries not gated on `open` |
| **Personal Bests** | generic `BottomSheet` (`src/components/ui/BottomSheet.jsx`) | close — already slides up and swipe-dismisses; it is just not the bespoke shape |

So this is not one job twice. Advanced Analytics changes presentation
*and* content; Personal Bests mostly changes content and adopts the
bespoke chrome.

---

## The pattern being adopted

Read off `QuestsSheet.jsx` and `ReadinessSheet.jsx`, which are the two
surfaces the ask points at. The shell is identical between them:

```
fixed inset-0 z-50 flex items-end justify-center     role="dialog" aria-modal="true"
├── backdrop   motion.div  opacity 0→1, 0.2s, bg-black/55, onClick=close
└── panel      motion.div  y '100%'→0, 0.32s, ease [0.22, 1, 0.36, 1]
    class: relative z-10 w-full max-w-md max-h-[88vh] overflow-y-auto
           rounded-t-2xl bg-card border-t border-border
           pb-[max(1rem,env(safe-area-inset-bottom))]
    ├── sticky grab handle   w-10 h-1 rounded-full bg-foreground/20
    ├── header row           micro kicker (primary, tracking-[0.04em])  +  close button
    │                        close: w-8 h-8 rounded-full bg-foreground/[0.08]
    └── body
```

Behaviours that come with it, all of which both new sheets inherit:

- `useBodyScrollLock(open)` — pins the page behind the overlay.
- Escape closes, matching every other dismissible surface.
- `if (!open) return null`.
- Queries carry `enabled: open`. **`React.lazy` defers the chunk, not the
  query** — a mounted-but-closed sheet would still fire its RPC.
- Lazy-loaded from the surface that opens it, per the lazy-loading rule.

**The close button uses a resting fill, not a hover-only one.** QuestsSheet
says why in a comment and it applies here: there is no hover on the phones
this ships to, so a hover-revealed control is invisible until tapped.

### One deliberate deviation, and the precedent for it

Both reference sheets **lead with a dial** — `ReadinessRing`, wound by a
recovery score or by quests claimed. Neither of these two surfaces has a
number that belongs in a ring: Advanced Analytics is lifetime reference
data, and Personal Bests is a list. Forcing a dial would be cargo-culting
the shape.

The precedent for differing below the chrome is in QuestsSheet's own head
comment — Quests is "a reading surface" that routes work elsewhere, while
"Readiness is the opposite case: its three signals have nowhere else to be
logged, so the sheet owns their forms." The two already diverge in body
while sharing the shell. These two do the same: **adopt the shell exactly,
fill the dial's slot with one hero figure instead.**

---

## Audit — what the redesign has to fix

### Advanced Analytics

1. **Wrong presentation.** Centered dialog. This is the ask.
2. **Ten identical rows, no hierarchy.** Each is a card with a 40px icon
   tile, a label and a value, so "Total Workouts" reads exactly like "Most
   Reps". Ten bare figures in ten identical boxes is the definition of
   "data must be earned" being unmet.
3. **Hue used as a palette, not as state.** `text-primary` ×4,
   `text-accent`, `text-success`, `text-info` ×3, `text-destructive` ×1 —
   assigned per row with no meaning behind the assignment. **`text-destructive`
   on "Top Muscle"** renders a neutral fact as a warning. Against "four
   hues, no exceptions".
4. **`shadow-sm` plus `hover:shadow-md` on every row.** Banned by the
   elevation rule, and the hover half cannot fire on a touch device.
5. **`'N/A'` hardcoded English, four times.**
6. **`Math.max(...spread)`** over every exercise (audit 11 #32).
7. **Two rows were permanently `0 min`** — fixed, see below.

### Personal Bests

1. **Generic `BottomSheet`, not the bespoke shape** — no kicker, no hero
   slot, no resting-fill close.
2. **Sorted alphabetically.** Wrong order for a list someone opens to see
   their heaviest lifts. `bests` sorts on `name.localeCompare`.
3. **A pulsing trophy on every row** — `animate={{ scale: [1, 1.15, 1] }}`
   with `repeat: Infinity`, one per exercise, plus a staggered spring on
   mount and a `whileHover` scale a phone can never trigger.
4. **Two stat boxes per row** (`bg-primary/5` / `bg-accent/5`) inside a
   card — surfaces inside a surface for read-only data.
5. **No way to find anything.** A lifter with 60 exercises scrolls.

### The bug found on the way in — already shipped

`workout_logs` has a column `duration_min`; the client wrote
`duration_minutes`, which does not exist, so `db.js`'s strip-and-retry
dropped it on every save. Advanced Analytics rendered "Total Time 0 min"
and "Avg Duration 0 min" for every user, permanently. Fixed in
`d0a15d2b` — `src/lib/workoutDuration.js` now owns the column name.

**This changes the design.** Those two rows are no longer structurally
dead, so they stay in the layout below — but only for users who have
duration data. Historical rows have none and cannot be backfilled, so the
zero-state rule still applies to them: **drop the row, do not render 0.**

---

## Boards

Five, at 390×844 (true iPhone 14/15), in the house style already used by
the Injuries and Progress pages: `#13171b` page, `#191f24` card, `#2a333c`
rule, `#f5f2f0` foreground, `#89949f` muted, `#f37616` primary, Work Sans.

### A · Advanced Analytics — as shipped

Draw it honestly and mark the audit numbers. Centered dialog inset from
all four edges (**not** a bottom sheet — the point of the board is that it
does not touch the bottom of the screen). Four hero tiles in a row, then
ten identical icon-tile rows, clipping at the fold.

### B · Advanced Analytics — proposed

The shell above, then:

**Hero slot** — lifetime volume as one large figure with a single line of
context under it (`148 workouts · since March`). This is the dial's
position, holding the number someone opens this sheet to see.

**Three groups, not ten rows.** Each group is a micro uppercase label and
then rows on hairlines — no cards, no icon tiles.

| group | rows |
|---|---|
| `LOAD` | Strongest lift · Most reps · Total volume |
| `CONSISTENCY` | Total workouts · Total time · Avg duration |
| `RANGE` | Unique exercises · Most performed · Top muscle group |

Grouping is what supplies the hierarchy the flat list never had: three
labels tell you what kind of question each number answers, which no amount
of restyling ten identical rows can do.

**Colour discipline.** Only the hero figure takes `primary`. Every row
value is `foreground`, every label `muted-foreground`. That resolves
finding 3 by removing the decision rather than re-making it — there is no
per-row hue to assign wrongly.

**Empty rows are dropped, not zeroed.** A user with no duration data sees
a `CONSISTENCY` group of one row, not three rows two of which say 0.

**Charts stay**, below a rule at the end — the `children` prop already
carries `AnalyticsTab` and that does not change.

### C · Personal Bests — as shipped

Generic BottomSheet chrome, alphabetical order, one card per exercise with
two nested stat boxes and a trophy. Mark the audit numbers.

### D · Personal Bests — proposed

The shell, then:

**Hero slot** — the heaviest lift in the list, named, with its weight. The
single fact the sheet exists to report.

**A filter field** when the list exceeds ~12 exercises. Client-side, no
network — it filters rows already in hand.

**Rows on hairlines, heaviest first.** Each row:

```
Bench Press                                    185 lb
best 5 reps · 12 Aug                                ›
```

Name and weight on the baseline, reps and date as micro underneath,
whole row tappable through to `PRHistoryModal` (already wired via
`onViewHistory`). No trophy, no per-row animation, no nested boxes.

**Sort order is heaviest-first and not configurable.** A toggle is the
obvious ask and it is the wrong first move — it adds a control to a list
that has never had a defensible order at all. Ship one good order, see if
anyone asks for another.

### E · Ledger

Every numbered change against the rule that asks for it, in the shape
board C of the Progress page uses, then a DECISIONS block.

---

## Decisions worth re-opening

1. **No dial on either sheet** — reasoning above. If you want the shape
   held exactly, Analytics could wind a ring on "exercises trained / 
   exercises in your regimens", but that is a number nobody asked for.
2. **Ten stats become nine rows in three groups.** "Favorite exercise" and
   "Most performed" were the same number under two labels until audit 11
   #14 split them; the proposal keeps `Most performed` and drops
   `Favorite`, because the distinction still does not survive being said
   out loud.
3. **Personal Bests loses the per-exercise rep record from the row.** It
   moves to the micro line rather than getting equal billing with weight.
   The two-box layout gave reps the same weight as load, and they are not
   the same kind of achievement.
4. **Neither sheet gets a "share" affordance**, though both are plausible
   places for one. Out of scope; flagging so it is a decision rather than
   an oversight.

## Open

- Build the boards. This spec is written so that is mechanical.
- The repo stores Penpot boards as runnable scripts (`docs/penpot-*-board.js`);
  this one should get the same treatment when it is built, so it can be
  re-run rather than re-drawn.
- Neither sheet has been checked at 375×667. The Progress work found that
  measuring first changes what is worth converting.
