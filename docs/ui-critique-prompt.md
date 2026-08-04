# Prompt — UI/UX walkthrough critique, section by section

Self-contained brief. Paste into a fresh session; it assumes no memory of the
one that wrote it.

---

## Task

Use Flexyn (`~/flexyn2` — React + Vite + Supabase + Tailwind + Radix PWA) as a
**person trying to get something done**, screen by screen, and write down what
it feels like. Then say, for every section, what would make it look better,
read clearer, and behave more obviously.

You are not auditing. You are the user. The deliverable is **feedback per
section**, in the order someone actually encounters them — not a
severity-ranked defect list, not a table of findings sorted by risk.

Three questions per screen, in this order, always:

1. **What did I feel?** First impression in one line. Confident? Lost?
   Impressed? Overwhelmed? Nothing at all?
2. **Where did I hesitate?** Every moment you weren't sure what something was,
   what it would do, or whether it had worked. Hesitation is the data. Record
   it even when you figured it out a second later — *especially* then, because
   you have context a real user won't.
3. **What's actually wrong with it?** Now put the engineer hat back on: the
   colour that fights the one next to it, the button that does nothing, the
   label that lies, the thing two screens call by two names.

## What this is NOT about — read this before you start

**The app is not released. There are no users. Every account in the database is
a beta account and they get deleted constantly.**

So: **do not analyse usage.** Row counts, activation rates, funnels, "feature X
has zero rows", retention, DAU, product-market questions — all of it is
meaningless here and all of it is out of scope. A prior critique
(`docs/app-critique-2026-08-04.md`) spent most of its energy there and got the
central claim wrong for exactly this reason: it read an unreleased app's wiped
test data as a usage signal. **Its §3 (F3) and most of §5 are void. Do not
build on them.** Its security and account-deletion findings stand, but they are
not your subject either.

Your subject is the interface. Colour, type, spacing, layout, motion, copy,
naming, affordance, state, and whether every control does the thing it looks
like it does.

## Setup — do this first, and do not skip it

**A UI critique written from reading JSX is worthless.** You cannot see a
colour clash, a cramped tap target, a layout shift, or a dead button in source.
The last attempt at this failed here: the headless browser had no network route
to Supabase, so nothing rendered with data and the whole visual pass was lost.

That is solved. The recipe below is **verified working** — it was used to drive
the real app, sign in, and screenshot onboarding at 375×812.

```bash
# 1. deps + the relay that gives the browser a path to Supabase
npm install
node scripts/dev-sb-relay.mjs &        # see the file header for why

# 2. point the app at the relay (.env.local is git-ignored)
cat > .env.local <<'ENV'
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<the anon key — Supabase MCP get_publishable_keys>
ENV

# 3. run it
npm run dev                            # http://localhost:5173
```

Then drive it with Playwright (install `playwright`, point `executablePath` at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`), and **always** pass
`serviceWorkers: 'block'` on the context — the app registers `push-sw.js` and a
service worker in the middle makes request failures nondeterministic.

To get a real signed-in session without an email round-trip: anonymous
sign-ins are enabled on this project, so `POST /auth/v1/signup` with `{}` and
the anon key returns a full session. Write it into `localStorage` under
`sb-127-auth-token` (supabase-js derives the key from the URL host) and reload.
That drops you at onboarding step 1 as a genuinely new user — which is exactly
where this critique should start.

**Verify before you critique:** if a screen renders empty or a control does
nothing, confirm the request actually reached Supabase before you write it up.
Check the relay log and the network panel. In the last run,
`fonts.googleapis.com` is also blocked in this sandbox, so **type may render in
a fallback face** — check whether the web font loaded before making any
judgement about typography.

Clean up whatever you create: the anon accounts you sign in as, and `.env.local`.

## Go in this order

Follow the path a person actually takes. Do not jump to the interesting
screens.

**Act 1 — first contact**
`/` splash → sign-in → onboarding (11 steps shown, `Onboarding.jsx`) →
whatever screen you land on first.

**Act 2 — the core loop**
Dashboard → start a workout → log a set → finish and save it → look at where
it went. Then: log a meal. Then: come back to the Dashboard and see if it
noticed anything you did.

**Act 3 — the rest of the app, in tab order**
Workout · Hub · Progress · Nutrition, then the hoisted destinations
(Messages, Market, Coach), then everything else:
Profile · Notifications · Duels · Bounties · Gauntlet · MyGym · MyGyms ·
GymHub · GymMap · GymEdit · RegisterGym · TrainerStudio · TrainerMarket ·
CorporatePortal · TradeHistory · Settings.

**Act 4 — the edges**
Every modal and sheet you can reach. Both themes. 375×812 first, then 320 px,
then desktop. Then the signed-out public routes: `/@username`,
`/duel-invite/<token>`, `/p/gym/<id>`, `/checkin/<code>`.

## Per-section template — use this exact shape

For **every** section, in order:

```
### <Screen name>

**Feel:**       one line — the honest first impression
**Screenshot:** <path>

**Hesitations**
- <what confused you, and for how long>

**Colour & type**
- <palette count, contrast, hierarchy, what fights what>

**Layout & density**
- <what's above the fold, card count, spacing rhythm, alignment, what wraps>

**Controls** — every interactive thing on the screen
| Control | Expected | Actual | Verdict |
|---|---|---|---|
| "Save" button | saves + confirms | saves, no feedback | wire crossed |

**Wires crossed**
- <mislabels, wrong destinations, dead controls, two names for one concept>

**Make it better**
1. <specific, smallest-first>
```

If a section is genuinely fine, say "Nothing to change" and move on. **Do not
invent problems to fill the template** — a short honest section is worth more
than a padded one, and padding here is easy to spot because it reads as taste
dressed up as a defect.

## The five lenses, applied per section

**1. Colour.** Count the distinct hues on screen. Which ones carry meaning
(success, danger, streak, XP tier) and which are decoration? Does the same
colour mean the same thing on the next screen? Check contrast in **both**
themes — a token that passes in dark can fail in light. Recent commits were a
deliberate "colour budget" pass; check whether it held or whether new colour
has crept back.

**2. Type & spacing.** There are ~818 uses of 9–11px text and ~1,219 `text-xs`.
Judge that on screen, not as a number: which of them are actually unreadable at
arm's length? Note that pinch-zoom is currently disabled app-wide
(`index.html:62`), so anything too small to read cannot be zoomed. Also check
scale consistency — how many distinct sizes and weights appear on one screen —
and whether spacing follows a rhythm or was tuned per-component.

**3. Does every button work.** This is the one the last pass never got to, and
it is the highest-value part of this brief. **Click everything.** Every button,
tab, chip, toggle, card, avatar, icon, menu item, empty-state CTA. For each,
write down what you expected and what happened. Three failure modes to look
for:

- **Dead** — nothing happens at all.
- **Silent** — it worked, but nothing on screen says so. Expect a lot of this:
  `src/lib/toast.js` suppresses every non-error toast that lacks an `action`,
  and 271 of 283 success/info toast call sites don't have one. So a successful
  save currently looks identical to a broken button. Judge on screen whether
  the surrounding UI compensates (a state change, an inline tick) or whether
  the action really does vanish into nothing.
- **Wrong** — it works, but not where the label pointed.

**4. Wires crossed.** The category the request named, and it's broader than
bugs: a control whose label doesn't match its behaviour; a link to the wrong
screen; two screens naming one concept differently (**regimen / program /
template / routine** is four words — find out how many concepts they are, and
**streak / consistency / active days** likewise); a back button that loses
state; a modal that opens behind another; an empty state that describes a
feature that isn't there. Anywhere the app contradicts itself.

**5. Feel.** The soft one, and worth real attention. Does it feel fast? Does
motion help you understand what happened or just delay you — time the
animations, anything over ~200ms on a repeated interaction is a tax. Does the
app ever scold (missed streak, expired quest, "you didn't...")? Does it
celebrate things worth celebrating and stay quiet otherwise? Is there exactly
one obvious next action per screen, and can you reach it one-handed on a 6.1"
phone?

## Deliverable

One document: `docs/ui-walkthrough-<YYYY-MM-DD>.md`.

```
1. Overall impression   — 5 sentences, written last. What the app feels like
                          to use, and the one change that would help most.
2. Cross-cutting        — patterns that showed up on many screens (a colour
                          used two ways, a control style that reads as
                          disabled, a naming split). These matter more than
                          any single screen.
3. Section by section   — the template above, in the order of Acts 1–4.
4. Everything that      — one table: control, screen, expected, actual.
   doesn't work
5. Quick wins           — under an hour each, ordered by how much they'd
                          improve the feel.
6. Bigger moves         — the redesigns worth considering, with what they'd
                          cost.
```

Screenshots are not optional and are not decoration — embed them next to the
section they belong to. A claim about how something looks, without the picture,
is an opinion.

## Traps

- **Don't critique from source.** If the browser isn't showing you the screen,
  fix the browser or say the section is unverified. Never infer a visual
  judgement from JSX.
- **Don't confuse sandbox breakage with product breakage.** Blocked fonts, a
  dead relay, a missing env var — verify the request reached Supabase before
  calling anything broken. The last run reported a blank gym page and a
  "profile not found" that were both its own network failure.
- **Taste is fine; label it.** "I'd use less orange" is legitimate feedback.
  "This fails 4.5:1 contrast" is a defect. Both belong; conflating them
  doesn't.
- **Don't redesign what you haven't used.** Any "rebuild this screen" needs
  you to have completed the task that screen exists for.
- **Don't re-report the security or deletion findings** from
  `docs/app-critique-2026-08-04.md`. They're known and they're not this job.
- **Don't count rows.** See the scope section. If you catch yourself writing a
  sentence about how many users did something, delete it.

## Constraints

From `CLAUDE.md` — worth reading, but for this pass they mostly reduce to:

- **Observe, don't fix.** Feedback first; changes come after, in separate
  commits, once the list has been picked over. If you spot a one-line fix so
  obvious it would be strange to leave (a typo in visible copy), do it and say
  so.
- Read-only against production data. Clean up any account you create.
- If any fix does follow: `npm run lint` clean, `npm run test` green,
  `npm run build` clean. Feature branch first, never force-push `main`.
- After any push, post SQL inline in a ```sql block or say "No SQL needed —
  frontend only". Never point at a file path; the user is on mobile.

## Done means

Someone can read it top to bottom and know what to change on every screen, in
order, without opening the app. Every screen in Acts 1–4 has a section. Every
interactive control has been clicked and recorded. Screenshots throughout. No
usage analysis anywhere in it.

If a whole area turns out to be in good shape, say so plainly and show the
screenshot — "this screen is good, here's why" is useful feedback and this app
is likely to earn it in places.
