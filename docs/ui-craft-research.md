# RESEARCH — UI craft: what "professional" means, and where Flexyn actually stands

> Evidence file for [`ui-craft-prompt.md`](./ui-craft-prompt.md). Audit numbers
> below were measured against `src/` on 2026-08-05. Re-run the commands in
> §3 before trusting them — they are the acceptance test, not decoration.

---

## 1. What a professional UX/UI designer actually does

The job is **decision-making under constraint**, not decoration. The output that
separates a professional from a capable amateur is not a prettier screen — it is
a *system of decisions* that other people can apply consistently without the
designer in the room.

### The process (structure before style)

1. **Research** — who the user is, what they are trying to finish, where they fail.
2. **Define** — reduce to the one job the screen must do.
3. **Wireframe at low fidelity** — decide *structure* with no color and no type
   choices. This is the step generated UI always skips, and skipping it is why
   generated screens have no hierarchy.
4. **Systematize** — tokens, components, states, and the rules governing them.
5. **Prototype and test** — with real content and real data volumes.
6. **Spec for handoff** — measurements, states, edge cases, motion.
7. **Iterate** against observed behaviour, not taste.

### The craft dimensions professionals are judged on

| Dimension | What good looks like | The amateur failure |
|---|---|---|
| **Hierarchy** | One primary element per view; everything else visibly recedes | Everything equally weighted, so nothing leads |
| **Spacing** | Dramatic contrast — tight inside a group, generous between sections | One uniform gap everywhere |
| **Typography** | Few sizes; differentiate with weight and colour | Many sizes; a new size for every nuance |
| **Colour** | Fixed budget, semantic meaning per hue | Decorative hues added per-component |
| **Elevation** | Shadow encodes depth *meaning* | Shadow as garnish, many variants |
| **Personality** | The product could not be mistaken for a different category | Category-neutral; could be any app |

Two findings from the literature are worth stating plainly because they contradict
what generated code optimises for:

- **Contrast and spacing move hierarchy more than anything else** — more than
  colour, more than size. ([IxDF](https://ixdf.org/literature/topics/visual-hierarchy),
  [Sessions College](https://www.sessions.edu/notes-on-design/visual-hierarchy-key-ux-principles-that-drive-results/))
- **Increasing padding and inter-section space is what reads as "premium" and
  "trustworthy."** Generous whitespace is not wasted space; it is the signal.
  ([Medium — 10 Little UI Design Tips](https://medium.com/@reviewraccoon/10-little-ui-design-tips-that-make-a-big-impact-001fde84a662))
- **Too many font sizes, inconsistent line heights, and weak contrast are the
  specific things that read as unprofessional.**
  ([Toptal](https://www.toptal.com/designers/typography/typographic-hierarchy),
  [Pimp my Type](https://pimpmytype.com/hierarchy/))

---

## 2. Why AI-generated UI looks generic

The mechanism is **distributional convergence**: a model predicts from the
statistical centre of its training data, so the safe choices that work
universally and offend no one dominate. A coding agent narrows it further to
whatever is *easy to build*. Critically — **"looks designed" is not in the
objective function.** Absent explicit direction, the model reaches for the most
statistically common pattern.
([Superdesign](https://superdesign.dev/blog/why-ai-design-looks-generic),
[SmoothUI](https://smoothui.dev/blog/ai-design-slop))

### The named tells

Designers identify generated UI by a short, stable list:

- Purple→blue / purple→cyan gradients
- Glassmorphism, often with a neon glow
- A 1px grey border on **every** card
- N identical cards in a row, each icon + heading + two lines
- Bounce or scale on every hover
- Dark mode nobody asked for
- Inter (or the era's default) for everything

### The root cause worth internalising

> A healthcare app, a finance app, a learning app, and a project management app
> should not all feel the same.

Flexyn is a **gamified fitness app**. It should feel closer to a sports broadcast
or a game HUD than to a SaaS dashboard. Nothing in the current UI commits to that.

---

## 3. Where Flexyn actually stands (measured)

Run from `~/flexyn2/src`. These are the acceptance tests.

> **zsh caveat:** unquoted `$var` does *not* word-split in zsh. Quote path lists
> or the greps below silently measure nothing and report clean.

### 3.0 The two pages in scope — Dashboard and Nutrition

The app-wide numbers in §3.1 are context. **These are the target.**

| Signal | Dashboard | Nutrition | Read |
|---|---|---|---|
| Tight gaps (`1/2/3`) | 161 | 229 | — |
| **Section gaps (`6+`)** | **0** | **0** | **The finding.** No breathing room on either page |
| `<Card>` | 34 | 14 | Dashboard over-cards |
| Off-token hues | **0** | **156** | Dashboard is clean; Nutrition never got the pass |
| Gradients | 1 | 5 | Minor |
| `backdrop-blur` | 8 | 7 | Minor |
| Radius aliases (`xl`/`md`) | **0** | **61** | Dashboard already on the 4 documented tiers |
| Shadow variants | 3 | 4 | Collapsible to 2 |

Two things follow, and they set the whole scope:

1. **Dashboard has already had the colour pass.** Zero off-token hues against
   the app-wide 764 means the discipline in `index.css` *was* applied here. This
   page does not need rescuing — it needs spacing rhythm and fewer cards.
2. **Nutrition is one pass behind.** 156 off-token utilities and 11 radii are the
   same debt Dashboard already cleared. Mostly mechanical — with one genuine
   design decision inside it (the macro palette, §3.2).

The one signal common to both — and the highest-leverage change available — is
**zero section-level spacing**. 390 tight gaps across the two pages and not a
single `gap-6` or larger. Every element sits 4–12px from its neighbour whether or
not the two things are related, so nothing groups and nothing separates.

### 3.1 App-wide context

### Spacing contrast — the worst finding

```bash
grep -rohE '\b(gap|space-y|space-x)-[0-9]+' . | sort | uniq -c | sort -rn
```

| Bucket | Count |
|---|---|
| Tight (`gap-1/2/3`, 4–12px) | **1,934** |
| Section-level (`gap-6/8/10/12/16`) | **16** |

**A 121:1 ratio.** There is effectively no section-level breathing room anywhere
in the app. Every element sits 4–12px from its neighbour regardless of whether
they are related. This is simultaneously the single loudest "generated" signal
and, per §1, the highest-leverage fix available.

### Radius — a real system already exists; the aliases blur it

> **Correction.** This section originally read "seven values, no system," derived
> from counting class *names*. That was wrong. `tailwind.config.js:48–71` defines
> a deliberate scale with the reasoning in the comment, and `rounded-lg` and
> `rounded-xl` resolve to the **same value**. Counting names also swept in
> directional modifiers (`rounded-t`, `-bl`) and one comment false positive
> (`rounded-card`, `HeroSlideshow.jsx:938`).

The documented system is **three steps plus `full`**, all derived from
`--radius`: `sm` 8px (inner chrome), `lg` 12px (default surface), `2xl` 16px
(large surfaces), `full` (pills, avatars, rings).

`xl` is pinned to `var(--radius)`, identical to `lg`; `md` is likewise retained.
Both exist only so call-sites on other pages keep working — they are
**compatibility aliases, not tiers**. App-wide, `rounded-xl` ×464 and `md` ×171
are the drift the aliases were meant to absorb.

### Shadows — eight variants, decorative

`shadow-sm` ×104, `lg` ×57, `md` ×41, `2xl` ×40, `xl` ×23, plus coloured
`shadow-primary`/`rose`/`slate`. **290 uses.** `shadow-2xl` appears 40 times in a
mobile app. Elevation currently carries no meaning.

### Colour budget — blown roughly 3× over

```bash
grep -rohE '\b(bg|text|border)-(purple|violet|fuchsia|pink|indigo|sky|cyan|teal|emerald|lime|yellow|amber|rose|slate|gray|zinc)-[0-9]{2,3}' . | wc -l
```

**764 off-token colour utilities across 13 hue families** — amber 230, emerald
121, rose 113, yellow 75, purple 42, violet 29, cyan 22, pink 10, plus fuchsia,
sky, teal, lime, indigo.

`index.css` states the app gets **four hues and the neutral ramp**, and that
"nothing outside this block gets to introduce a hue." The dashboard was cleaned
(the CSS comment records 232 utilities across 14 families removed); the rest of
the app was not.

### Everything is a card

`<Card>` appears **133 times across 64 files**. Uniform elevation across every
surface is precisely the "no hierarchy" failure from §1.

### The named tells are present

- **57** `bg-gradient-to-*`
- **100** `backdrop-blur*` (glassmorphism)

### Type ramp — violated above, holding below

Six display sizes sit above the 32px cap: `text-[52px]`, `[44px]`, `[40px]`,
`[38px]`, `[30px]`, `[26px]`.

The **11px floor is holding.** A grep hit for `text-[5px]` is a false positive —
it is prose inside a comment at `src/components/Layout.jsx:130` documenting a fix
already made, not live code. The only live sub-floor values are two `text-[10px]`
instances, at `pages/ComingSoon.jsx:30` and `pages/SignInToContinue.jsx:293` —
**both outside the Dashboard/Nutrition scope.**

### 3.2 Where Nutrition's 156 off-token utilities actually live

> **Correction.** This section first reported 75. That grep omitted `red`,
> `blue`, `green` and `orange`, and also missed `stroke`/`fill`/`from`/`to`
> prefixes. The corrected pattern is in the prompt's acceptance block. Dashboard
> re-measures at **0** under the corrected pattern too — that result holds.

- `pages/Nutrition.jsx` itself: **0**. The page shell is as clean as Dashboard.
- Modals: **16** across 4 files — lower priority, not on screen by default.
- **Always-visible components: 140**, and three files carry 133 of them:

| File | Count |
|---|---|
| `LogMealForm.jsx` | 57 |
| `MacroNutrientBox.jsx` | 41 |
| `MineralsVitaminsBox.jsx` | 35 |
| `FastingTrackerCard.jsx` | 3 |
| `NutritionTrendsChart.jsx` | 3 |
| `CalorieTopBar.jsx` | 1 |

`NutrientRing`, `NutrientIcon`, `WaterTracker` and `MealTypePicker` measure
**0**. `NutrientRing` takes its colour from the caller via `currentColor` — that
is the pattern the other four should converge on.

### The macro palette — the one real design decision here

`MacroNutrientBox.jsx:12–14` sets protein = red, carbs = blue, fat = yellow, as
gradients plus text and background classes. Substituting mechanically through the
hue map turns protein into `destructive` and carbs into `info` — i.e. a healthy
protein figure renders as an error state.

Macros need **mutual distinguishability, not state meaning.** They belong on the
`--chart-*` ramp, which is semantically neutral by design: protein `--chart-1`
`#F2700D`, carbs `--chart-2` `#495969`, fat `--chart-3` `#E49D67`. Rendered
comparison against two rejected alternatives is on the Penpot board
**Colour Budget — Nutrition migration**.

---

## 4. The conclusion that shapes the work

**The design system in `index.css` is genuinely good.** The colour budget, the
six-step ramp, the 11px floor, the WCAG-verified contrast values, and the
reasoning written into the comments are better than most production apps carry.

**The component code does not obey it.** Every number in §3 is a gap between the
documented system and the implementation.

So this is **not a redesign, and not a rescue.** Dashboard's zero off-token hues
prove the discipline lands when it is applied. The work is polish:

1. A **rhythm** problem — zero section-level spacing on both pages. Highest
   leverage, affects both, purely additive.
2. An **adherence** problem, Nutrition only — 156 off-token colours, 11 radii.
   The same pass Dashboard already had, plus one design call (the macro palette).
3. A **hierarchy** problem, Dashboard mainly — 34 cards at one elevation. Note
   this is *not* a count problem: the Dashboard is a user-configurable widget
   grid, only 2 of the 34 are page chrome, and the nested-card antipattern was
   already fixed at `Dashboard.jsx:1231`. The widgets need tiering, not deleting.
4. A **personality** problem — nothing yet commits to fitness/game feel.

1–3 are mechanical and verifiable by grep. 4 requires composition decisions,
which is what the Penpot file is for.

**Scope discipline:** the app-wide numbers in §3.1 are deliberately *out of
scope*. Do not fan out beyond Dashboard and Nutrition. Under the corrected
pattern the app carries **1,087** off-token utilities in total; 156 are in scope
and the remaining **931 are a separate, later pass**. Resist them.

---

## 5. Composition rules derived from the above

These are the rules that should govern new UI. They are stated as constraints so
they can be checked, and they are the intended content of the `CLAUDE.md` block
in phase 6 of the prompt.

1. **One dominant element per screen.** It may bleed to the screen edges. Nothing
   else on that screen may.
2. **Two spacing registers, and nothing between them.** Intra-group 4–8px
   (`gap-1`/`gap-2`); inter-section 24–32px (`gap-6`/`gap-8`). If a gap wants to
   be 12–20px, one of the two groups is wrong.

   The general literature points at 32–40px for the section register. Flexyn is
   deliberately information-dense, so it runs one step tighter at 24/32. The
   principle that matters is the **ratio, not the absolute** — 8→24 is 3×, which
   is what makes the two registers read as distinct rather than as drift.
3. **Cards are for elevated or interactive surfaces only.** Read-only data sits
   directly on the background, separated by hairlines.
4. **Hierarchy by weight and colour before size.** The ramp has six steps; if a
   seventh is wanted, the answer is a weight change.
5. **Two radii total** — one for surfaces, one for pills. `rounded-full` is for
   pills and avatars, not for cards.
6. **Two elevations total** — resting and raised. Coloured shadows are banned.
7. **Four hues, no exceptions.** A new state replaces an existing hue; it does not
   extend the list.
8. **No gradient as decoration, no glassmorphism.** Both are on the tell list.
9. **Data must be earned.** A number gets screen space only with trend, history,
   or comparison attached.

---

## Sources

- [Why AI Design Looks Generic — Superdesign](https://superdesign.dev/blog/why-ai-design-looks-generic)
- [AI Design Slop: Why AI-Generated UI Looks Generic — SmoothUI](https://smoothui.dev/blog/ai-design-slop)
- [How to Make AI UI Look Less Generic — Superdesign](https://superdesign.dev/blog/how-to-make-ai-ui-look-less-generic)
- [Why AI-Generated UI Looks Good But Often Feels Generic — Medium](https://medium.com/@cssamithpitigala/why-ai-generated-ui-looks-good-but-often-feels-generic-020a9b1b8492)
- [What is Visual Hierarchy? — IxDF](https://ixdf.org/literature/topics/visual-hierarchy)
- [Visual Hierarchy: Key UX Principles That Drive Results — Sessions College](https://www.sessions.edu/notes-on-design/visual-hierarchy-key-ux-principles-that-drive-results/)
- [How to Structure an Effective Typographic Hierarchy — Toptal](https://www.toptal.com/designers/typography/typographic-hierarchy)
- [Typographic Hierarchy in Print, Web & App Design — Pimp my Type](https://pimpmytype.com/hierarchy/)
- [10 Little UI Design Tips That Make a Big Impact — Medium](https://medium.com/@reviewraccoon/10-little-ui-design-tips-that-make-a-big-impact-001fde84a662)
