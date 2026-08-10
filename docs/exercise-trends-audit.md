# Exercise Trends — audit, 2026-08-10

Scope: Progress → Trends tab. Three files —
`src/components/progress/GroupedExerciseTrends.jsx`,
`src/components/progress/ExerciseProgressCard.jsx`,
`src/components/progress/FilterDropdown.jsx` — plus the block that renders
them at `src/pages/Progress.jsx:1343–1403`.

Untouched for months. Checked against three references: the production
rows, the `dataviz` skill's chart rules, and CLAUDE.md's composition
section.

---

## 0. What the data actually is

Everything below is downstream of this, so it comes first.

```sql
select count(*) logs, count(title) with_title,
       count(*) filter (where jsonb_array_length(coalesce(exercises,'[]'::jsonb))>0) with_ex
from public.workout_logs;
--  logs=3   with_title=0   with_ex=2
```

Two exercise rows exist in the entire database:

| date | exercise | muscle_groups | sets |
|---|---|---|---|
| 2026-07-25 | Bench Press | Chest, Triceps, Shoulders | `[{reps:45, weight:111}]` |
| 2026-08-07 | Push-Up | Chest, Triceps, Shoulders | `[{reps:5, weight:0}]` |

Three consequences that decide the design:

- **The chart needs two points and there is never more than one per
  exercise.** So the one-point and zero-point states are not edge cases
  here — they are the *only* states a real user sees today. They get
  designed, not defaulted.
- **`epleyOneRepMax` returns 0 for both rows** — 45 reps is outside its
  `[1,12]` accuracy window, and Push-Up is weight 0. So "estimated 1RM"
  as a fixed default metric would draw a flat zero line on 100% of
  production data. CLAUDE.md: *a section with no data must not render as
  zeros.*
- **Push-Up is weight 0.** A weight-based trend is meaningless for it.
  Bodyweight work needs a rep-based metric or nothing.

---

## 1. Correctness

### 1.1 The Regimen filter cannot ever return a row · **broken**

`Progress.jsx:742`

```js
const regimenLogs = useMemo(() =>
  selectedRegimen === 'all' ? logs : logs.filter(l => l.regimen_name === selectedRegimen), …);
```

`workout_logs` has no `regimen_name` column, and no migration ever added
one — it is a base44 field name that never made the trip to Supabase. The
real column is `title`. So `l.regimen_name` is `undefined` on every row and
any regimen selection filters to `[]`.

`exerciseNames` is derived from `regimenLogs`, so the tab then falls into
its `exerciseNames.length === 0` branch: **picking your own regimen tells
you "No exercise data yet" and shows the four-step how-to-log
instructions.** The dropdown offers all 27 of the user's regimen names and
every one of them does this.

### 1.2 Upstream of that: workout names were never saved · **fixed in `b5043ac5`**

`Workout.jsx:1777–1791` builds its save payload with `regimen_id` and
`regimen_name`. Neither is a column, so `db.js`'s write strip-and-retry
drops both and the insert succeeds without them. The user types a name for
their workout and it is discarded.

This is the same defect the comment **four lines below it** describes for
`duration_minutes` (see `src/lib/workoutDuration.js`) — found, fixed for
duration, and left standing for the name.

Not fixed *here*: `Workout.jsx` was open in the parallel session's working
tree, and `regimen_name` was read by nine other components
(`WorkoutSavedList`, `InsightsTab`, `HubComposer`, `PostActivityBlock`,
`ProfileLiftStats`, `ProfileShareCard`, `EditWorkoutModal`,
`CreateDuelModal`, `TodaysPlanCard`) which all silently rendered
"Freestyle". That is one coherent change and it was not this one, so it
was filed separately — and the parallel session shipped it the same day
as `b5043ac5`, by the same method that found the `duration_minutes` bug:
compare what the client writes against what `information_schema` says the
table has.

Trends handles it defensively regardless: read `title ?? regimen_name`,
and derive the filter's options **from the logs** rather than from the
regimens table — so an option that cannot return a row is never offered.
That is what makes the workout chip correct both before and after
`b5043ac5`: while no log carried a name the chip did not render at all,
and it starts appearing as saves land with one.

### 1.3 `new Date(log.date)` shifts the date west of UTC · **broken**

`ExerciseProgressCard.jsx:48, 49, 59`. `date` is a Postgres `DATE`,
delivered as `'YYYY-MM-DD'`, which `new Date()` reads as **UTC midnight**.
For any user west of UTC that is the previous local day, so every point on
the chart is labelled one day early. `src/lib/dateUtils.js` exists for
exactly this and its header names this bug class; `PRHistoryModal` already
imports `parseLocalDate`, this file does not.

### 1.4 Filtering the muscle group collapses every accordion · **broken**

`GroupedExerciseTrends.jsx:110–114`

```js
const [expandedGroups, setExpandedGroups] = useState(() => { … });
```

A `useState` initialiser runs **once**. Every group present at mount is
seeded `true`; a group label that appears later — which is exactly what
changing the muscle-group filter produces — is `undefined`, therefore
falsy, therefore collapsed. So the filter's payoff is a screen of shut
drawers, and the component then force-scrolls you to it.

### 1.5 "No sets recorded" for a session that recorded sets

`ExerciseProgressCard.jsx:128–131` branches on `chartData.length < 2` and
then says `noData` at 0 and **`noSetsRecorded` at 1**. One session is not
"no sets recorded"; it is one session. Given §0 this is the string most
production users see.

### 1.6 An exercise's group depends on which log is newest

`GroupedExerciseTrends.jsx:89–95` takes the group label from the *most
recent* log's `muscle_groups[0]`. Log the same lift with a different
first-listed muscle and it silently moves to another accordion.

---

## 2. The chart

Checked against `dataviz`. Five of its rules are broken and the first is
the one it names as the single most common chart mistake.

### 2.1 Dual y-axis · **the #1 anti-pattern**

`ExerciseProgressCard.jsx:137–142` — weight on the left scale, reps on the
right. Two measures of different scale on one plot means the crossings,
the gaps and the relative slopes are all artefacts of two arbitrary
domains. `dataviz`: *"Never a dual-axis chart. Two measures of different
scale → two charts, small multiples, or indexed to a common base."*

The fix taken: **one series at a time on one axis**, with the metric
chosen from what the exercise's own data supports (§5.2).

### 2.2 The x axis is a category axis of formatted strings

`dataKey="date"` where `date` is already `format(d,'MMM d')`. Recharts
spaces categories **evenly**, so three sessions spread across 90 days draw
as three equidistant points and the line's slope says nothing about
tempo — a lift you touched twice in January and once in March looks like
steady weekly progress. `'MMM d'` also drops the year, so on the 365-day
range last August and this August are the same tick.

### 2.3 `--accent` is not a chart colour

The reps line is `hsl(var(--accent))` = `210 18% 30%` (light) / `32%`
(dark) — a dark desaturated slate. In dark mode that is a near-black line
on a near-black card. It was never run through a contrast or CVD check,
and `--chart-1…5` exist in `index.css` precisely so charts don't reach
into the state hues.

### 2.4 Mark and chrome specs

| | current | spec |
|---|---|---|
| line | `strokeWidth={3}` | 2px |
| grid | `strokeDasharray="0"`, solid `--border` | recessive |
| legend | present, ~20px of a 200px plot | none for a single series |
| tooltip | recharts default, raw `Max Weight (lbs)` key | labelled, formatted, localised date |

The legend is the clearest waste: on a 390pt phone it spends a tenth of
the plot restating two names the card could carry in text.

---

## 3. Performance

`AccordionPanel` renders its children **always** — deliberately, so a
`ResizeObserver` can measure the height it animates to. Both levels of
accordion then default to **open**: groups at
`GroupedExerciseTrends.jsx:110–114`, cards at
`ExerciseProgressCard.jsx:30`.

So entering the Trends tab mounts one `ResponsiveContainer` +
recharts `LineChart` **per exercise the user has ever logged**, plus two
`ResizeObserver`s each, whether or not anything is on screen. recharts is
the heaviest thing in the bundle (`vendor-charts`). At 40 exercises that
is 40 charts and 80 observers for a screen showing about three rows.

---

## 4. Composition, against CLAUDE.md

- **`Card className="border-none shadow-sm"`** (`ExerciseProgressCard:78`)
  — elevation has two levels, hairline or `shadow-md`, and *"`shadow-sm`
  adds nothing a hairline doesn't"*. This is neither: the border is
  removed and replaced with the shadow that was called out as pointless.
- **Cards for read-only data.** *"Cards mark discrete, user-arranged
  objects. Read-only data that is not a widget gets no surface: hairline
  dividers instead."* Every exercise is a card, so a 40-exercise list is
  40 identical surfaces — the literal description of the generated look
  Kegan is trying to remove. Group headers are also filled
  (`bg-secondary/40` + border + radius), a second surface wrapping the
  first.
- **Banned middle register.** `gap-3` ×2, `space-y-3`, `mt-3`, `pt-3`,
  `mb-4`, `mb-6` — this surface is not fluid-converted, so the ban stands
  in full.
- **`rounded-md`** (`:153`) is a compatibility alias, explicitly *"never
  reach for them in new code"*.
- **No focal point.** Nothing on the tab is dominant; 40 rows of equal
  weight.
- **"Data must be earned."** A collapsed card shows max weight and max
  reps with no history attached — the thing the rule calls decoration.
  Meanwhile the actual history is one tap away and costs a chart mount.

---

## 5. The filter button

### 5.1 The selected state is invisible

To learn what the Trends tab is currently showing you must tap **Filter**,
then tap open one of three sub-accordions, per dimension. The trigger
shows a count badge — "2" — which says how many things are filtered and
nothing about what. A filter whose state can only be read by operating it
is not a filter, it is a quiz.

### 5.2 It is the page's second control for the same two dimensions

`Progress.jsx:1094–1111` already has a **Wk / Mo / Yr / All** segmented
control governing the hero stats, and `:1044–1082` already lists the
muscle groups trained. The Trends tab then ships its own **7 / 30 / 90 /
365** time range and its own muscle-group picker, in a dropdown, with a
different vocabulary and a different default (`statsFrame` starts at
`week`, `timeRange` starts at `90`). One page, two answers to "what
period am I looking at", neither aware of the other.

The same file already resolved this exact conflict once — see the comment
at `:1116–1130` folding the Weekly Review in, *"one period section, one
place."* The filter's time range is the last thing still disagreeing.

### 5.3 It is above the heading it filters

`:1346` renders the filter row, `:1377` renders `<h2>Exercise Trends</h2>`.

### 5.4 Accessibility

`FilterDropdown` hand-rolls a popover with no `aria-expanded`, no
`aria-controls`, no `role`, no Escape handler, no focus trap and no focus
restore on close. Dismissal listens to `mousedown` only. Radix is already
a dependency and `BottomSheet` already exists in this repo.

### 5.5 Scroll-jacking

`GroupedExerciseTrends.jsx:64–74` scrolls the window on **every** muscle
filter change, and `:124–129` schedules a second `window.scrollTo` 450ms
after any group is opened — after the animation, so it arrives once the
user has already started reading. Neither is user-initiated scrolling.

---

## 6. What shipped

One-line-per-decision; the reasoning is in the code comments and on the
Penpot board `Exercise Trends — resolved` (Page 2).

1. **One axis, always.** The metric is picked per exercise from what its
   sets can support: all-zero-weight → **Reps**; otherwise **Weight**,
   with **Volume** and **Est. 1RM** offered only when they resolve to a
   real number on at least two sessions. A metric that would draw zeros
   is not offered.
2. **A real time axis** — epoch ms, `scale="time"`, domain pinned to the
   selected window — so gaps between sessions are gaps.
3. **`parseLocalDate`** everywhere a `date` column becomes a `Date`.
4. **Collapsed rows earn their data**: name, current value, delta, and a
   hand-rolled SVG sparkline (~1kB, no dependency). recharts mounts on
   first expand and never before.
5. **Hairlines, not cards.** Group headers are section labels; exercise
   rows are separated by rules.
6. **The Filter dropdown is gone.** The time range binds to the page's
   existing frame, the muscle group becomes an inline control that shows
   its own value, and the regimen filter renders only when a log actually
   carries a name.
7. **No scroll-jacking.**
8. **One point and zero points are designed states**, and they say what
   is true: one session is one session.
