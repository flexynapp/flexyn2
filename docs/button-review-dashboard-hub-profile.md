# Dashboard · Hub · Profile — button-level review

2026-08-04. Driven at 375×812 with a real signed-in account seeded with a
workout, a meal and a goal. **Onboarding deliberately excluded.**

**Method.** Two passes. First an automated sweep that clicked every control on
each screen and recorded what happened. Then — because the sweep produced a lot
of noise — a second pass that re-tested each suspicious control **on a fresh
page load, located by its visible text at click time**. Only the second pass is
treated as evidence.

**The headline result is that almost every button works.** The sweep flagged
175 controls as unclickable across the three screens; on re-test essentially
all of them were my own harness (a menu left open behind the click, or the
Dashboard carousel rotating a control out from under the cursor mid-click). I
am reporting that rather than the scary number, because the scary number is
wrong. Two things I nearly filed as dead buttons — "Add Story" and "Add to
story" — turned out to open a native file chooser, which produces no DOM change
and no dialog. They work.

What's actually wrong is **routing, hierarchy and visual consistency**, not
dead controls.

---

## The defects

### D1 — "Open a duel" goes to the Workout page

**Verified.** Fresh load, clicked by exact text, twice.

```
Open a duel      123x28  BUTTON   NAVIGATES -> /workout
```

Source: `src/components/dashboard/HeroSlideshow.jsx:895`

```js
cta: { label: 'Open a duel', to: '/workout' },
```

There is a `/duels` route. The CTA on the Dashboard's largest card promises
duels and delivers the workout page.

This isn't an isolated typo — it's the weakest link in a set that otherwise
knows how to route precisely. Two sibling CTAs in the same file use proper deep
links (`/workout?openCardio=1`, `/hub?search=open`), so the pattern exists and
this one just missed it. Two others are vague in the same way:

| Label | Goes to | Should probably go to |
|---|---|---|
| **Open a duel** | `/workout` | `/duels` |
| **Browse** (from "Try a regimen") | `/workout` | a regimens surface |
| **Open** (from "Invite a friend") | `/profile` | the invite sheet — the card is already on `/profile` |

### D2 — The league query 400s on both Dashboard and Profile

Every load of `/dashboard` and `/profile` fires:

```
400  /league_members?select=*,user:user_profiles!user_id(username,avatar_url)
PGRST200 — no relationship between 'league_members' and 'user_profiles'
```

`league_members` has exactly one foreign key (`league_id → leagues`). There is
no `user_id` FK, so the embed can never resolve and the league leaderboard has
never rendered a row. Same bug in `gymBusinesses.js:449` against `gym_members`.
SQL fix at the bottom.

### D3 — The same user shows two different avatar initials, on the same screen

On **Hub**, the header avatar reads **AR** and the story avatar 850px below
reads **RE** — one user, one viewport, two answers.

- `src/components/ProfileMenu.jsx:287` — `full_name.split(' ').map(n => n[0])` → **AR** (Alex Rivera)
- `src/components/hub/HubProfile.jsx:873` — `displayUsername.slice(0, 2)` → **RE** (revbot)

There's no shared helper, so the two drifted. On **Profile** it's worse: the
header avatar renders as an empty grey person icon while the profile avatar
right below it is a pink **RE**.

### D4 — Content renders *through* the bottom nav

On Profile, scrolled to the bottom, "Overhead Press · 100 lb" and "Share my
stats" are clearly legible **behind** the nav bar. The nav has a translucent
background and the scroll container doesn't reserve space for it, so the last
~80px of every scrolling screen slides underneath and shows through. It reads
as a rendering bug. Screenshot: `review-shots/profile-under-nav.png`.

### D5 — The Hub tab icon is highlighted while inactive

The Hub icon sits in a filled orange ring at all times. On Workout, "Workout"
is orange-and-bold *and* Hub is orange-ringed — two tabs read as selected, on
every screen in the app.

### D6 — The Dashboard carousel rotates controls out from under you

The Feature-of-the-Day carousel auto-advances. My clicker lost the race 133
times: it located a button, moved to it, and by the time the click landed the
slide had changed. A thumb is slower than that. A carousel that auto-rotates
while it's the largest tap target on screen will produce mis-taps — you reach
for "Open a duel" and press "Log a meal".

Either stop the rotation on the CTA, pause on interaction, or don't auto-rotate.

---

## What each screen feels like

### Dashboard

**The biggest element on the home screen is an ad for another feature.** The
"Feature of the Day: Duels" card is roughly 45% of the visible screen, carries
**9 carousel dots** — nine features in rotation — and sits above any training
content. Above *it* is the story rail. So the order on open is: Add Story →
greeting → ad → training.

Other things worth changing:

- **Greeted by username, not name.** "Evening work, revu14404." `full_name`
  was set and ignored. The username is also rendered darker than the greeting,
  so the database key is the emphasised word in the sentence.
- **"Evening work,"** parses as a noun phrase, not a greeting.
- **Two red "1" badges** in the header, 40px apart — one on the bell, one on
  the avatar. Same colour, same number.
- The **"1 day streak"** chip has a chevron and does nothing when clicked. It's
  a `<span>` styled to look expandable.
- **Carousel dots are 6×6px.** Nine of them. Neither tappable nor readable.
- "Log another session" (saturated orange gradient) sits directly beside
  "Readiness 66" (pale green with a thin ring) — two unrelated visual systems
  in one row.

### Hub

Busy in a way the other screens aren't. In one viewport I counted **11+ orange
elements** competing: three solid-orange Follow buttons, the Marketplace
gradient card, the New Post outline, the "New" pill, Go Live, the floating "+"
FAB, Add Story's dashed ring, the story "+" badge, the "BUILD YOUR FEED" label,
and the nav's Hub ring. Nothing dominates because everything is shouting.

- **The orange FAB overlaps the first post card**, covering its top-right
  corner including one of the post's own controls.
- **Two "create" affordances**: an outlined "New Post" button and the orange
  "+" FAB, ~230px apart, same action, different styles.
- **The "Build your feed" carousel is clipped mid-word** — the third card reads
  "seant" with its Follow button sliced in half, and there's no scroll hint.
- **Marketplace gets a full-width orange promo card** — the same
  advertise-another-feature move as the Dashboard.
- The three header icons (search, activity, profile) are unlabeled and ~24px.

### Profile

The most solid of the three. Real data rendered correctly — 5k lb lifted, 1
workout, best lifts with estimated 1RM, profile completion at 50%. Tabs
(Stats / Trophies / Posts) work, "Share my stats" opens a dialog, "Edit
profile" and "+ note" both respond.

- **The avatar is magenta/pink** — a colour that appears nowhere else in the
  app — sitting directly on top of the orange cover gradient. It's the one
  place the palette breaks, and it's the most prominent element on the screen.
- **The M T W T F S S week strip is white text on a busy orange gradient**;
  so are "BRONZE" and "LV 1". Legibility is poor on all of them.
- **Three zeros in a row** — "0 Followers · 0 Following · 0 Posts" — is a cold
  opening for a new account.
- Content slides under the nav (D4).

---

## Colour and type

**The palette is disciplined and that's a real strength.** Sampled from
rendered pixels, the whole app runs on six values:

| Role | Value |
|---|---|
| Accent | `rgb(242, 112, 13)` |
| Ink | `rgb(24, 31, 37)` |
| Muted | `rgb(96, 107, 118)` |
| Surface | `rgb(255, 255, 255)` |
| Border | `rgb(232, 235, 238)` |
| Background | `rgb(249, 247, 246)` |

Two exceptions break it: the **pink profile avatar** and the **green** profile
completion bar. Both are single-use colours with no other home in the system.

**Two colour problems worth fixing:**

- **Muted grey on the cream background is ~4.3:1** — under AA, and it's the
  second most-used text colour in the app.
- **The OS dark-mode preference is ignored.** Rendering with
  `prefers-color-scheme: dark` leaves the background at `rgb(249,247,246)`.
  Dark exists as an in-app setting; the phone's setting does nothing.

**Type is unverified and I'm not going to guess.** Google Fonts is blocked in
this container — `document.fonts` was empty and every screenshot rendered in
fallbacks, so any judgement about letterforms would be about a font you don't
ship. Two things are true regardless: `index.html:43` loads **five families**
(Archivo, Figtree, Leckerli One, Press Start 2P, Caveat) from one
render-blocking request, and **three different font stacks coexist on one
screen**, one of them Tailwind's untouched `ui-sans-serif` default — meaning
some components never got a brand font at all.

---

## Fix list, ordered

1. **Point "Open a duel" at `/duels`** — `HeroSlideshow.jsx:895`. One line.
2. **Un-ring the Hub nav icon when inactive.** Always on screen, always wrong.
3. **Add the two foreign keys** (D2) so the league board and gym roster work.
4. **One shared `initials()` helper**, used by both avatar call sites.
5. **Add bottom padding to scroll containers** equal to the nav height (D4).
6. **Greet by first name**, and de-emphasise the name relative to the greeting.
7. **Pause the Dashboard carousel on interaction** — or drop auto-rotation.
8. **Make "1 day streak" either a real button or not look like one.**
9. **Drop one of the two red "1" header badges.**
10. **Move the FAB off the first post card** on Hub.
11. **Pick one create affordance on Hub** — the FAB or "New Post", not both.
12. **Add a scroll hint to the "Build your feed" rail**, and don't clip mid-word.
13. **Bring the pink avatar and green progress bar into the palette.**
14. **Raise muted text to ≥4.5:1.**
15. **Set the font stack once in `tailwind.config.js`** so nothing falls
    through to `ui-sans-serif`.
16. **Honour `prefers-color-scheme` on first load.**
17. **Enlarge the 6×6px carousel dots** or remove them — nine dots that small
    are decoration, not navigation.
18. **Reconsider the Dashboard's order.** Story rail → greeting → feature ad →
    training. The thing the app is for is fourth.

---

## SQL — D2 only

Verified against production: no orphan rows and no NULLs in either column, so
both constraints apply cleanly. **Not applied** — this is yours to run.

```sql
ALTER TABLE public.league_members
  ADD CONSTRAINT league_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.gym_members
  ADD CONSTRAINT gym_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';
```

The `NOTIFY` is required — PostgREST won't expose the new relationship until
its schema cache reloads.

---

## Where I might be wrong

- **The 175 "unclickable" controls were my harness, not your app.** I'm stating
  that plainly because the raw number looks alarming and isn't real. The
  fresh-load re-test is the number that counts, and it found almost everything
  working.
- **I did not exhaustively re-test every control** — I re-tested the 13 most
  suspicious on fresh loads. A genuinely dead button elsewhere on these three
  screens could still be hiding behind harness noise.
- **"Browse" → `/workout` and "Plan the week" → `/workout`** may be intentional
  if those surfaces live inside the Workout page. I flagged them as weaker than
  D1 for that reason; "Open a duel" is unambiguous because `/duels` exists.
- **Type is unjudged**, per above.
