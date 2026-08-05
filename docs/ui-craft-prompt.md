# PROMPT — UI craft pass: Dashboard + Nutrition

> Self-directed execution prompt. Read
> [`ui-craft-research.md`](./ui-craft-research.md) first — it holds the measured
> baseline, the verified file anchors, and the composition rules this plan
> depends on. Every number below is re-measurable; re-run the greps before
> trusting them.

---

## The ask

Make the Dashboard and Nutrition pages feel **clean, polished, and deliberately
designed** — not generated. This is a polish pass on UI that is already better
than most AI-built apps, not a redesign and not a rescue.

## The one thing that shapes the whole design

**The design system in `src/index.css` is already good. The component code
mostly obeys it. The gap is rhythm, not tokens.**

Both pages measure **zero** section-level spacing — 161 tight gaps on Dashboard,
229 on Nutrition, and not one `gap-6` or larger between them. Every element sits
4–12px from its neighbour whether or not the two things are related, so nothing
groups and nothing separates. Per the research, spacing contrast moves perceived
hierarchy more than any other lever, and generous inter-section space is
specifically what reads as premium rather than generated.

Fixing that is additive, low-risk, and will do more than everything else here
combined. Do it first. Everything after is subtraction.

**Do not touch the token values in `index.css`.** The contrast ratios are
WCAG-verified with the arithmetic written into the comments. Consume the tokens;
do not re-tune them.

## Scope — exactly two pages

| In scope | Out of scope |
|---|---|
| `src/pages/Dashboard.jsx` | Every other page |
| `src/components/dashboard/**` | The 931 off-token utilities elsewhere |
| `src/pages/Nutrition.jsx` | `text-[10px]` in ComingSoon / SignInToContinue |
| `src/components/nutrition/**` | Any schema or data-layer change |

Do **not** fan out. A tempting adjacent fix in another page is a separate pass.

## Non-negotiable constraints

- **Mobile-only.** Flexyn ships to iOS/Android app stores only. Mobile-first,
  ≥44px tap targets, no hover-only affordances. `MobileSelect` (bottom Drawer
  under 768px), never a bare shadcn `Select`.
- **i18n**: every user-facing string via `tFallback('key', 'English')`, English
  fallback inline. Never machine-translate the other 14 locales. This pass is
  visual — **if you find yourself rewriting copy, stop.**
- **No new hues.** Four hues and the neutral ramp. A new state replaces an
  existing hue; it does not extend the list.
- **Type ramp is six steps with an 11px floor.** If something needs to recede,
  change weight or colour — never add a size.
- **Push straight to `main`** (fast-forward), no per-change PRs. Check `git log`
  before claiming work is uncommitted — a parallel session stages the whole tree.
- **Never `git stash`** on this repo. To test against a clean tree, use a git
  worktree — stashing has already cost a parallel session an edit.
- Report progress as short one-line notes, not detailed summaries.

---

## Phase 1 — Spacing rhythm (both pages)

The highest-leverage change. Purely additive; no elements move or disappear.

Adopt **two registers and nothing between them.** Tuned for Flexyn's density —
this app is deliberately information-dense, so the section register is 24/32
rather than the 32/40 the general literature suggests:

- **Intra-group**: `gap-1`/`gap-2` (4–8px). Things that belong to one another.
- **Inter-section**: `gap-6` (24px), `gap-8` (32px) at a major break.

The middle is banned. If a gap wants to be `gap-3`/`gap-4`/`gap-5` (12/16/20px),
the grouping is wrong — either those elements are one group (tighten to `gap-2`)
or they are two (separate to `gap-6`). 8→24 keeps a 3× separation, which is what
makes the two registers readable as distinct.

**Measured cost of the ban:** Dashboard `gap-3` ×25 + `gap-4` ×5 + `gap-5` ×2 =
**32 edits**. Nutrition `gap-3` ×30 + `gap-4` ×10 = **40 edits**. The bulk of
existing spacing is already `gap-1`/`gap-2` (136 and 200 respectively) and stays
untouched.

1. Read each page top to bottom and mark the genuine **section boundaries** —
   the points where the subject changes (header → today's plan → progress →
   quests → history).
2. Apply `gap-6` (24px) at those boundaries only.
3. **There is exactly one `gap-8` (32px) per page, and on Dashboard it sits
   directly below TODAY'S PLAN.** That is the seam between *action* and *state*:
   above it is what the user is about to do, below it is what they have already
   done. One break per page — a second one means neither reads as the break.
4. Leave every existing tight gap alone unless it spans a boundary you just marked.

Find Nutrition's equivalent seam before applying it. The likely candidate is
between today's intake and the historical/trend surfaces, but confirm against
the real page rather than assuming the Dashboard's structure repeats.

**Expect the pages to get taller.** That is the point. Do not compensate by
shrinking type or padding.

## Phase 2 — Nutrition colour pass (140 utilities, 6 files)

> **Count corrected 2026-08-05.** An earlier pass reported 75 because the grep
> pattern omitted `red`, `blue`, `green` and `orange`. The true figure is **156**
> — 140 in always-visible components, 16 in modals. Use this pattern:
> ```
> (bg|text|border|stroke|fill|from|to|via)-(red|blue|green|orange|purple|violet|fuchsia|pink|indigo|sky|cyan|teal|emerald|lime|yellow|amber|rose)-[0-9]{2,3}
> ```
> Dashboard measures **0** even under the corrected pattern — it genuinely had
> the full pass, and is the proof this is achievable.

Nutrition's page shell is also 0. The debt is entirely in components, and three
files carry 133 of the 140:

| File | Count | |
|---|---|---|
| `LogMealForm.jsx` | 57 | always-visible |
| `MacroNutrientBox.jsx` | 41 | always-visible — **see the macro decision below** |
| `MineralsVitaminsBox.jsx` | 35 | always-visible |
| `FastingTrackerCard.jsx` | 3 | always-visible |
| `NutritionTrendsChart.jsx` | 3 | always-visible |
| `CalorieTopBar.jsx` | 1 | always-visible |
| 4 × `*Modal.jsx` | 16 | defer |

`NutrientRing.jsx`, `NutrientIcon.jsx`, `WaterTracker.jsx` and
`MealTypePicker.jsx` measure **0** — leave them alone. `NutrientRing` inherits
`currentColor` from its caller, which is the pattern the others should follow.

Route every `amber`/`emerald`/`rose`/`yellow`/`purple`/`violet`/`cyan` utility to
the budget:

| Currently | Means | Route to |
|---|---|---|
| amber, yellow | effort, progress, streaks, CTA | `primary` |
| emerald, teal, lime | earned, on-track, complete | `success` |
| cyan, sky, indigo | hydration, rest, recovery | `info` |
| rose, pink | over-target, broken, destructive | `destructive` |
| purple, violet, fuchsia | — no semantic role — | nearest of the four |

### The macro decision — do not substitute mechanically

`MacroNutrientBox.jsx:12–14` assigns **protein = red, carbs = blue, fat =
yellow**, as gradients plus text and background classes. Run through the table
above, protein becomes `destructive` ("broken, danger") and carbs becomes `info`
("recovery"). Neither is true, and shipping that would make a healthy protein
figure render as an error state.

Macros need **mutual distinguishability, not state meaning**, so they belong on
the `--chart-*` ramp, which carries no semantics by design:

| Macro | Token | Hex |
|---|---|---|
| Protein | `--chart-1` | `#F2700D` |
| Carbs | `--chart-2` | `#495969` |
| Fat | `--chart-3` | `#E49D67` |

Also drop the `from-*`/`to-*` gradients here — gradient fills on macro bars are
on the tell list, and a flat token fill is what the rest of the system uses.

See the Penpot board **Colour Budget — Nutrition migration** for the rendered
comparison against the two rejected alternatives.

Do the 16 modal instances only if the always-visible 140 land cleanly.

## Phase 3 — Radius aliases and elevation (Nutrition mostly)

> **Corrected 2026-08-05.** An earlier draft of this phase said "Dashboard runs 6
> distinct radii, Nutrition 11 — reduce both to two, collapsing into
> `rounded-xl`." **All three claims were wrong.** It counted class *names* rather
> than resolved values, counted `rounded-card` (prose in a comment at
> `HeroSlideshow.jsx:938`) and directional modifiers like `rounded-t` as radii,
> contradicted the deliberate system already documented in `tailwind.config.js`,
> and named the alias as canonical. Do not follow that guidance.

`tailwind.config.js:48–71` already defines the system, with the rationale in the
comment. **Three steps plus `full`, all derived from `--radius`:**

| Class | Value | Role |
|---|---|---|
| `rounded-sm` | 8px | inner chrome — icon tiles, chips, small controls |
| `rounded-lg` | 12px | the default surface — cards, buttons, inputs |
| `rounded-2xl` | 16px | large surfaces — hero, sheets, modals |
| `rounded-full` | pill | pills, avatars, rings. Nothing else. |

`xl` is pinned to `var(--radius)` — **identical to `lg`** — and `md` is kept, both
purely so existing call-sites on other pages keep working. They are compatibility
aliases, not tiers.

**Dashboard is already compliant**: `full` 47 · `lg` 41 · `sm` 24 · `2xl` 12.
That is exactly the four tiers. **Do not touch Dashboard's radii.**

Nutrition carries **61 alias call-sites**:

- `rounded-xl` ×37 → `rounded-lg`. Identical resolved value, so this is a pure
  rename with **zero visual change**. Safe to do mechanically.
- `rounded-md` ×24 → `rounded-sm` or `rounded-lg` **by role**. This one moves
  pixels (10px → 8px or 12px), so judge each: inner chrome takes `sm`, surfaces
  take `lg`.
- `rounded-[2rem]` ×1 in `FoodPhotoCaptureModal.jsx:150` — arbitrary; defer with
  the modals.

### Elevation — two levels

Your config has **no `boxShadow` override**, so these are Tailwind defaults.
Reduce to resting and raised:

- **Resting** — no shadow, `border border-border` hairline.
- **Raised** — `shadow-md`. Interactive or genuinely floating surfaces only.

| Currently | Count | → |
|---|---|---|
| `shadow-sm` | 23 | resting. A barely-visible shadow adds nothing a hairline doesn't |
| `shadow-md` | 6 | raised — keep |
| `shadow-xl` | 4 | raised |
| `shadow-2xl` | 6 | raised. A 2xl shadow on a 390px viewport is a tell, not depth |

Coloured shadows are banned outright.

Also remove the gradients — 1 on Dashboard, 5 on Nutrition (four in
`NutritionPlansModal.jsx`, one in `PhotoMealResultModal.jsx`) — and the
`backdrop-blur` glassmorphism (8 / 7). Both are on the published list of
signals designers use to identify generated UI.

## Phase 4 — Tier the widget grid (NOT "de-card")

> **Corrected 2026-08-05.** An earlier draft said "34 `<Card>` on one page —
> convert stat readouts and quest lists to background content, target ≤20."
> **The premise was wrong.** The Dashboard is a *user-configurable widget grid*
> (16 definitions in `src/lib/widgetDefinitions.js`), and in a grid the user
> arranges, a card is the correct container — it is what makes a widget a
> discrete, reorderable object. Deleting them would remove the affordance.
>
> The split: **2 Cards are page chrome** (`Dashboard.jsx`), **31 are widget
> shells**, one per widget component. And the nested-card antipattern this phase
> was aimed at **was already fixed** — see the comment at `Dashboard.jsx:1231`,
> which diagnoses it as "a surface inside a surface" and replaces it with a
> semantic `<section aria-labelledby>`. Do not redo that work.

The real defect is **uniform elevation**: 16 widgets that all carry the same
weight, so the grid has no focal point. The fix is differentiation, not deletion.

**The rule, restated for a grid:**

1. **A card marks a discrete, user-arranged object.** In a configurable grid that
   is every widget. Leave the 31 widget shells alone.
2. **Read-only data that is not a widget gets no surface.** Hairline dividers
   instead. The 2 page-chrome Cards in `Dashboard.jsx` are what gets judged here.
3. **Elevation must differ across the grid:** one hero at `rounded-2xl`,
   supporting widgets at `rounded-lg`, non-widget data at no surface at all.

Then check `WidgetRenderer.jsx` (8 Cards) — it is the dispatcher, so it is the
one place a hero/supporting distinction can be introduced once rather than per
widget.

See the Penpot board **Widget Grid Hierarchy** for the rendered comparison.

**No count target.** "≤20" was chasing the wrong quantity; hitting it would mean
breaking the grid.

## Phase 5 — Personality (one committed move per page)

Everything above is subtraction. This is the part that makes the pages *yours*.

A gamified fitness app should read closer to a sports broadcast or a game HUD
than a SaaS dashboard. Nothing currently commits to that. **One decisive move per
page** — not a redesign:

### Move 1 · Dashboard — let the existing hero bleed

**Do not add a hero.** `HeroSlideshow` already holds the first slot
(`Dashboard.jsx:190`). The defect is that it has **no bleed handling** — no
`-mx-*`, no `w-screen` — so it renders inside the page's `px-4 md:px-6`
(`Dashboard.jsx:218`) exactly like every other surface, and reads as one card
among many.

The move is to break that inset for this one element: bleed to the left, right
and top edges, keep `rounded-2xl` on the bottom corners only. Mixed weight in the
headline — noun heavy, qualifier light. **Nothing else on the page may bleed**,
or the move means nothing.

### Move 2 · Nutrition — break the equal grid

`MacroNutrientBox.jsx:73` renders `grid grid-cols-2 md:grid-cols-4 gap-3` — on
mobile that is calories, protein, carbs and fat as four identical tiles. Four
equal siblings give no answer to the only question the screen exists to answer:
*am I on track?* (Note `gap-3` is also the banned middle from phase 1.)

One element dominates — calories remaining, with its progress bar and an "on
track" read. Protein / carbs / fat recede to a supporting row with **no
surfaces**, keyed to `chart-1/2/3` from phase 2 and separated by hairlines.

**Open question for the author, not for the implementer:** `CalorieTopBar` is
already pinned above the reorderable widgets and deliberately excluded from the
widget list (`Nutrition.jsx:355–357`). If it already carries the calorie read,
then promoting a calories tile inside `MacroNutrientBox` duplicates it — and the
right move may be to drop calories from the box entirely and let the three macros
be three, with the top bar as the dominant element. Decide this before building.

A number earns screen space only with trend, history, or comparison attached. A
bare figure in a box is decoration.

Both moves are rendered before/after on the Penpot board **Personality — one move
per page**. Wider reference: `Dashboard — iPhone 390×844` (the generated-looking
version, kept deliberately) against `Dashboard v2 — composed` — same content,
same tokens, different composition. The diff between those two *is* this phase.

These are proposals. Phase 5 is the one phase where measurement does not settle
the answer, so treat the boards as something to react to rather than adopt.

## Phase 6 — Write the rules down

Add a **UI composition** block to `flexyn2/CLAUDE.md` with rules 1–9 from §5 of
the research file. This is the phase that stops the next generated component from
reverting. Without it, phases 1–5 decay.

## Phase 7 — Verify

Run the acceptance greps below. Then run the app and screenshot both pages at
390×844 — visual verification is required, not optional. Compare against the
Penpot boards.

---

## Definition of done

From `~/flexyn2/src`. **Quote path lists** — unquoted `$var` does not word-split
in zsh, and the greps will silently report clean.

```bash
# 1. Section rhythm exists (was 0/0 — this is the primary gate)
grep -rohE '(gap|space-y)-(6|8)([^0-9]|$)' pages/Dashboard.jsx components/dashboard | wc -l
grep -rohE '(gap|space-y)-(6|8)([^0-9]|$)' pages/Nutrition.jsx components/nutrition | wc -l

# 1b. The banned middle is gone (was 32 / 40)
grep -rohE '(gap|space-y|space-x)-(3|4|5)([^0-9]|$)' pages/Dashboard.jsx components/dashboard | wc -l
grep -rohE '(gap|space-y|space-x)-(3|4|5)([^0-9]|$)' pages/Nutrition.jsx components/nutrition | wc -l

# 2. Nutrition off-token hues (was 156 — note red/blue/green/orange are included)
grep -rohE '(bg|text|border|stroke|fill|from|to|via)-(red|blue|green|orange|purple|violet|fuchsia|pink|indigo|sky|cyan|teal|emerald|lime|yellow|amber|rose)-[0-9]{2,3}' pages/Nutrition.jsx components/nutrition | wc -l

# 3. Radius aliases gone from Nutrition (was xl 37 + md 24 = 61; Dashboard already 0)
grep -rohE 'rounded-(xl|md)\b' pages/Nutrition.jsx components/nutrition | wc -l
# Dashboard must stay exactly sm/lg/2xl/full — this should not change
grep -rohE 'rounded-(sm|md|lg|xl|2xl|3xl|full)\b' pages/Dashboard.jsx components/dashboard | sort | uniq -c

# 4. Tells (was 1+5 gradients, 8+7 blur, 6 shadow variants)
grep -roh 'bg-gradient-to-\|backdrop-blur' pages/Dashboard.jsx components/dashboard pages/Nutrition.jsx components/nutrition | wc -l
grep -rohE 'shadow-[a-z0-9]+' pages/Dashboard.jsx components/dashboard pages/Nutrition.jsx components/nutrition | sort -u

# 5. Cards (was 34)
grep -roh '<Card' pages/Dashboard.jsx components/dashboard | wc -l
```

| Gate | Baseline | Target |
|---|---|---|
| Section gaps (`6`/`8`), Dashboard | 0 | ≥ 6 |
| Section gaps (`6`/`8`), Nutrition | 0 | ≥ 8 |
| Banned middle (`3`/`4`/`5`), Dashboard | 32 | 0 |
| Banned middle (`3`/`4`/`5`), Nutrition | 40 | 0 |
| Nutrition off-token hues | 156 | ≤ 16 (modals only) |
| Radius aliases (`xl`/`md`), Nutrition | 61 | 0 |
| Dashboard radii — must not change | sm/lg/2xl/full | sm/lg/2xl/full |
| Gradients + blur, both | 21 | 0 |
| Shadow variants, both | 6 | ≤ 2 |
| `<Card>`, Dashboard | 34 | **34** — count must not drop; tier them instead |
| Build + tests | green | green |

Plus, not grep-checkable and therefore stated explicitly:

- Both pages screenshot at 390×844 and reviewed against the Penpot boards.
- Each page has exactly **one** dominant element.
- `CLAUDE.md` carries the composition rules.

---

## What NOT to do

- **Do not touch `index.css` token values.** WCAG-verified; the arithmetic is in
  the comments.
- **Do not add a font size.** Six steps. Use weight and colour.
- **Do not fan out** to other pages, however tempting the adjacent fix.
- **Do not rewrite copy.** This is a visual pass; copy changes mean 15 locales.
- **Do not compensate for added spacing** by shrinking type or padding. Taller
  pages are the intended outcome.
- **Do not delete cards to hit a number.** Dashboard's 34 should stay 34 — it is
  a user-configurable widget grid and each card is a discrete object the user
  placed. Tier their elevation instead.
- **Do not redo work already done.** `Dashboard.jsx:1231` and the
  `tailwind.config.js` radius rhythm are both prior passes with the reasoning in
  the comments. Read comments before treating a grep hit as debt.
- **Do not reach for a gradient, glow, or blur** to make something feel
  "designed." Those are the exact signals being removed.
