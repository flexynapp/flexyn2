# Flexyn — app reviewer teardown, 2026-08-04

Run against [app-reviewer-prompt.md](app-reviewer-prompt.md). Screenshots in [review-shots/](review-shots/). Driven in a real
browser at 375×812 with a live anonymous account, seeded with a workout, a meal
and a goal so data-dependent screens rendered properly.

**Coverage, honestly:** onboarding walked end to end (all 11 steps, screenshots
of each); all 23 authenticated routes visited and instrumented. **Not** done:
an exhaustive click of every control on every screen (I sampled, and
instrumented all 700+ controls for geometry rather than clicking each), modals
and sheets, 320px, and desktop. Two measurements are unavailable in this
environment and are marked as such rather than guessed: **typography** (Google
Fonts is blocked here, so every face rendered in fallback) and **load times**
(dev server, unbundled — the ~17s figures are meaningless for production).

One process caveat: Stage 1 asks you to discover features blind, then compare
against the route table. I had read `App.jsx` in a previous session, so my
blind-discovery gap is compromised. The taps-from-Dashboard numbers below are
still measured honestly, and they're the more actionable half.

---

## 1. The verdict

Flexyn looks considerably better than it has any right to — the palette is
disciplined (one orange, one ink, one muted grey, two surfaces), the Workout
screen's dark hero is genuinely good, and onboarding is more polished than most
shipped fitness apps. The problem is not craft, it's **hierarchy and wiring**:
the biggest element on the home screen is an advertisement for a feature
(Duels), the Hub tab's icon is permanently highlighted so two tabs always look
selected, and two entire features — the weekly league leaderboard and the gym
member roster — are dead at the data layer and return nothing, every time, for
everyone. The app is also carrying five web fonts and three separate font
stacks, which is why parts of it feel subtly unrelated to other parts. **If I
fixed one thing: the two broken queries.** If I fixed one thing about how it
*feels*: delete the Feature of the Day carousel and give that space to
training.

---

## 2. Feature census

Instrumented across 23 authenticated routes. "Controls" = interactive elements
detected on first paint; "tiny" = those under 44×44 px.

| Screen | Taps from Dashboard | Controls | Tiny | Verdict |
|---|---|---|---|---|
| Dashboard | 0 | 65 | — | needs polish |
| Workout | 1 | 35 | 13 | **ship it** |
| Hub | 1 | 112 | 73 | needs polish |
| Progress | 1 | 212 | 193 | needs polish |
| Nutrition | 1 | 52 | 28 | needs polish |
| Coach | 2 | 19 | 11 | needs polish |
| Messages | 2 | 13 | 5 | ship it |
| Market | 2 | 45 | 33 | needs polish |
| Profile | 2 | 29 | 16 | ship it |
| Notifications | 2 | 17 | 7 | ship it |
| Duels | 3+ | 12 | 1 | ship it |
| Bounties | 3+ | 14 | 4 | ship it |
| Gauntlet | 3+ | 12 | 0 | ship it |
| My Gym | 3+ | 10 | 1 | half-built |
| My Gyms | 3+ | 15 | 4 | half-built |
| Gym Map | 3+ | 15 | 6 | half-built |
| Register Gym | 3+ | 21 | 8 | half-built |
| Trainer Studio | 3+ | 11 | 2 | half-built |
| Trainer Market | 3+ | 12 | 3 | half-built |
| Corporate Portal | 3+ | 13 | 4 | half-built |
| Trade History | 3+ | 15 | 6 | half-built |
| Admin Reports | URL only | 10 | 1 | correctly gated |
| Admin Gyms | URL only | 9 | 0 | correctly gated |

Both admin routes render a clean "Admin only / Not authorized" screen rather
than crashing or leaking. That's right, and it's worth saying.

---

## 3. Hidden features — ranked

The bottom nav has **5 slots**. The app has **23 authenticated screens**. So 18
features live off-nav, and the app knows it — which is why the Dashboard has a
9-slide carousel advertising them (see §4). **A carousel that advertises your
own navigation is the app telling you the navigation is broken.**

| Rank | Feature | Where it is now | Where it should be |
|---|---|---|---|
| 1 | **Coach** (the AI coach — arguably the product's differentiator) | not in the nav; reached via Hub or a Dashboard card | a nav slot. This is the thing no competitor has. |
| 2 | **Progress / PRs** | nav slot 4, but 212 controls deep | keep the slot, cut the density (§9) |
| 3 | **Duels · Bounties · Gauntlet** | 3+ taps, off-nav, promoted by carousel | one "Compete" destination — see §10 |
| 4 | **Gym Map / My Gym / My Gyms** | three separate off-nav routes | one "Gym" screen with tabs |
| 5 | **Trainer Studio / Trainer Market** | off-nav, half-built, no payment path | hide behind a flag until real |
| 6 | **Corporate Portal** | off-nav, half-built | hide behind a flag |
| 7 | **Trade History** | off-nav, reachable only from Market | fold into Market as a tab |

The nav's fifth slot is **Nutrition**, which is a defensible daily-use choice.
The one I'd contest is **Hub** occupying the elevated centre slot — in a
fitness app, the centre slot is where "start a workout" belongs.

---

## 4. Over-exposed — prime space spent badly

**1. "Feature of the Day: Duels" owns the home screen.** On a 375×812 viewport
it is the single largest element, roughly 45% of the visible Dashboard, sitting
directly under the greeting and *above* any training content. It carries **9
carousel dots** — nine features being advertised in rotation. It is an
internal ad unit in the most valuable space in the product.

**2. The story rail is above everything**, including the greeting and the
training cards. The first thing a fitness app shows on open is "Add Story".

**3. Onboarding step 3 gives its top third to an inert placeholder.** A large
white card containing four grey bars and the words "Choose below" — a chart
that renders nothing until you answer. It pushes the actual options below the
fold.

**4. The age picker on step 4 is more than a full screen** for one number: a
giant "26", a draggable ruler with two scales, five stepper buttons, and *two*
separate instruction lines ("TAP TO TYPE" and "DRAG OR USE BUTTONS"). The value
"26 yrs" is also printed twice — once huge, once on the middle stepper.

---

## 5. Buttons that don't work

Two are dead at the data layer — not a styling problem, the query itself cannot
succeed. Both reproduce 100% of the time, for every user.

| # | What | Where | Expected | Actual |
|---|---|---|---|---|
| B1 | **Weekly league leaderboard** | `src/lib/data/leagues.js:154` | list of league members | **HTTP 400, `PGRST200`** |
| B2 | **Gym member roster** | `src/lib/data/gymBusinesses.js:449` | list of gym members | **HTTP 400, `PGRST200`** |

Both use a PostgREST embed against a foreign key that does not exist:

```
user:user_profiles!user_id ( username, avatar_url )
```

The live error:

> *Searched for a foreign key relationship between `league_members` and
> `user_profiles` using the hint `user_id` in the schema `public`, but no
> matches were found.*

Confirmed against the schema — `league_members` has exactly one FK
(`league_id → leagues`) and `gym_members` has exactly one (`gym_id →
gym_businesses`). Neither has a `user_id` FK, so neither embed can ever
resolve. **Two features have never returned a row.**

The fix is either an FK (`ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY (user_id)
REFERENCES user_profiles(id)`) or dropping the embed and doing a second query
keyed on `user_id`. The FK is better — it also makes the relationship real.

**Not broken, verified:** I chased two things that looked dead and weren't.
Onboarding's 6th goal option appears unreachable behind the CTA — the list
scrolls, it's fine (§9.3 covers the affordance). And the Dashboard appears
stuck on skeletons — it resolves at ~5s; my first measurement was just too
early.

---

## 6. Buttons that look bad

**1. The Hub tab icon is orange-ringed while inactive.** In the bottom nav,
"Workout" is the selected tab (orange icon, orange bold label) — but Hub's icon
sits inside a filled orange ring at all times. Two tabs read as selected
simultaneously, on every screen in the app. This is the single most damaging
small visual bug in the product because it is always on screen.

**2. The "···" quick-action hint is invisible.** Every nav item renders a
three-dot affordance below its label at roughly 4px in pale grey. It is too
faint to notice and too small to be read as a control, so it reads as a
clipped second line of text. An affordance nobody can see is just noise.

**3. The four "i" info badges on the Workout grid** are ~26px grey circles
pinned to each card's top-right — four identical repetitions in one viewport,
each well under the 44px target, each competing with the card's actual icon.

**4. Two icon-tile treatments for peer actions.** On the same Workout grid,
"Generate Workout" gets a **solid orange** tile and "Explore Regimens" gets a
**pale orange** tile. They are siblings in the same 2×2 grid. The colour
difference implies a priority the layout doesn't explain.

**5. Disabled CTAs that don't say why.** Onboarding step 1 gets this right —
the disabled button reads "Pick at least one". Step 4's reads only "Continue"
while remaining disabled until you fill a username field further up the page,
with nothing indicating which field is blocking. Same component, two standards.

**6. Two red "1" badges in the header.** One on the notification bell, one on
the avatar. Both red, both "1", stacked 40px apart. Whatever they count, they
read as the same number reported twice.

---

## 7. Colour

**The palette is genuinely disciplined — this is a strength.** Measured off the
rendered pixels, the whole app runs on six values:

| Role | Value |
|---|---|
| Primary / accent | `rgb(242, 112, 13)` orange |
| Ink | `rgb(24, 31, 37)` |
| Muted text | `rgb(96, 107, 118)` |
| Surface | `rgb(255, 255, 255)` |
| Border | `rgb(232, 235, 238)` |
| App background | `rgb(249, 247, 246)` |

8–14 distinct colours per screen, which is tight for an app this feature-dense.
The recent colour-budget pass held.

**The problems:**

**C1. The OS dark-mode preference is ignored.** Rendering with
`prefers-color-scheme: dark` leaves the body at `rgb(249, 247, 246)` — the same
cream as light mode. Dark exists as an in-app setting (`preferred_theme`,
`dark_mode`), but a user whose phone is in dark mode opens a bright white app
and has to go find a toggle. In 2026 that reads as an oversight rather than a
choice.

**C2. Muted grey `rgb(96,107,118)` on the cream background is ~4.3:1** — under
the 4.5:1 AA threshold for normal text, and it is the most-used text colour in
the app after ink. At the 9–11px sizes it frequently appears at (818 instances
app-wide), it is the single most common legibility problem.

**C3. The Dashboard mixes two card languages side by side** — "Log another
session" is a saturated orange gradient, and the "Readiness 66" tile next to it
is pale green with a thin green ring. Adjacent, same row, unrelated visual
systems.

---

## 8. Fonts — **unverified, and here's why**

I cannot review the typography from this environment. `fonts.googleapis.com` is
blocked in this sandbox, `document.fonts` contained **zero loaded faces**, and
every screenshot in this review therefore rendered in system fallbacks. Any
judgement I made about letterforms would be about a font you don't ship.
`document.fonts.check()` returns `true` regardless, so it is not a usable
signal either — worth knowing before anyone tries to shortcut this.

Three things I *can* state, because they're independent of loading:

**F1. Five web font families load from one render-blocking stylesheet**
(`index.html:43`): Archivo (400–900 variable), Figtree (300–900 variable),
Leckerli One, Press Start 2P, and Caveat. Three of those are display/novelty
faces. Five families is a lot for one product, and it is one external request
away from the entire app rendering in fallbacks — which is exactly what
happened here, and will also happen to users on restricted networks.

**F2. Three separate font stacks coexist on a single screen**, measured on
`/workout`:

```
Figtree, system-ui, -apple-system, sans-serif
Archivo, "Helvetica Neue", Arial, sans-serif
ui-sans-serif, system-ui, sans-serif, ...        ← Tailwind's default
```

The third one is the tell: those components never had a brand font applied and
are silently falling through to Tailwind's default. That's why parts of the app
feel subtly unrelated to other parts, and it's fixable by setting the stack
once in `tailwind.config.js` rather than per-component.

**F3. Self-host the fonts.** It removes the third-party dependency, the
render-blocking request, and the failure mode above.

---

## 9. Quality-of-life polish backlog

Ordered by improvement-per-effort. All are under an hour unless noted.

1. **Un-ring the Hub nav icon when inactive** — the highest-value single line in
   this document. Two tabs currently read as selected on every screen.
2. **Fix the onboarding step counter.** Step 3 shows `03/11` in the progress bar
   and `EXPERIENCE · 02` in the eyebrow. Verified on screen.
3. **Add a scroll affordance to onboarding option lists.** At rest, step 1 shows
   5 of 6 goals with the 5th clipped mid-sentence and the 6th fully hidden
   behind the CTA. It scrolls, but nothing says so — a fade mask or a half-row
   peek fixes it.
4. **Rename step 8's CTA.** It reads "Build my plan" on step 08/11, then three
   more steps follow. Call it "Continue" and save "Build my plan" for step 11.
5. **Make every disabled CTA state its blocker**, the way step 1 already does
   ("Pick at least one"). Step 4 just says "Continue" and stays dead.
6. **Greet people by first name, not username.** The Dashboard currently reads
   "Evening work, revu14404." — `full_name` was set and ignored.
7. **Re-read that greeting.** "Evening work," parses as a noun phrase, not a
   greeting. And the grey/black split emphasises the *username* over the words.
8. **Drop one of the two red "1" header badges**, or make them visibly different
   things.
9. **Raise muted text to ≥4.5:1** on the cream background (§C2).
10. **Set the font stack once in `tailwind.config.js`** so nothing falls through
    to `ui-sans-serif` (§F2).
11. **Honour `prefers-color-scheme`** on first load, then let the setting
    override it.
12. **Make the "···" quick-action hint visible or remove it.** Right now it's
    ~4px of pale grey that reads as clipped text.
13. **Enlarge the four "i" badges to 44px** or move the info to a long-press.
14. **Unify the two icon-tile treatments** on the Workout grid.
15. **Delete the placeholder chart on onboarding step 3** — four grey bars and
    "Choose below" occupying the top third until you answer.
16. **Print the age once**, not as both a giant number and a stepper label.
17. **Collapse step 4's two instruction lines** ("TAP TO TYPE", "DRAG OR USE
    BUTTONS") into one.
18. **Fill onboarding step 8's dead space** — ~250px of empty background between
    the time chips and the CTA.
19. **Audit Progress's 193 sub-44px controls** (of 212 total). Even accepting
    chart elements, that is the densest screen in the app by 4×.
20. **Same for Hub** — 73 of 112.
21. **Give `PublicGymLanding` a failure state.** Under an induced network
    failure it rendered a completely blank page — 8 DOM nodes, zero characters —
    while `/@username`, `/duel-invite` and `/checkin` all degraded gracefully
    under the identical failure. Controlled comparison, same conditions.
22. **Reconsider the Dashboard's first screen order.** Story rail → greeting →
    feature ad. Training appears fourth.
23. **Self-host the five web fonts** (§F3).

---

## 10. Bigger moves

**M1. Delete the Feature of the Day carousel; give the space to training.**
It's 45% of the home screen and 9 slides of internal advertising. The reason it
exists is that 18 features live off-nav — so fix the cause (M2), not the
symptom. *Cost: small to remove, and it forces M2.*

**M2. Collapse Duels + Bounties + Gauntlet into one "Compete" destination, and
Gym Map + My Gym + My Gyms into one "Gym" screen.** That's six routes to two,
which frees nav slots and removes most of the reason the carousel exists.
*Cost: 3–5 days, mostly routing and shared shells.*

**M3. Put Coach in the nav and Hub somewhere else.** The AI coach is the thing
this app has that others don't, and it's currently off-nav while a social feed
holds the elevated centre slot. In a fitness app that slot should start a
workout. *Cost: 1 day for the nav, longer for the argument.*

**M4. Flag off Trainer Studio, Trainer Market and the Corporate Portal until
they're real.** All three are half-built, all three are reachable, and the
trainer purchase path calls an Edge Function that isn't deployed. The "Coming
Soon" pattern already exists in `Market.jsx`. *Cost: hours.*

---

## What's genuinely good

- **The Workout screen is the best thing in the app.** The dark hero with the
  glowing orange play button is the one element that looks like a shipped
  product, and "Repeat last workout — Today • 2 exercises • 5 sets" picked up
  my seeded session correctly and instantly.
- **The palette is disciplined** — six values, 8–14 per screen, in an app with
  23 screens. That's rare and it's holding.
- **Onboarding is better than most shipped fitness apps.** The type hierarchy
  is confident, the option cards are legible and well-spaced, the copy has a
  voice ("Compound lifts. Heavy. Honest."), and the whole flow completed without
  a single error.
- **Both admin routes are properly gated** with a clean explanation rather than
  a crash or a leak.
- **The seeded workout, meal and goal all rendered correctly** everywhere I
  looked. The data layer works; the two failures in §5 are specific and
  identifiable, not systemic.
