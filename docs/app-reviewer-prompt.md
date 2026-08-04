# Prompt — app reviewer teardown: every feature, every control, every pixel

Self-contained brief. Paste into a fresh session; it assumes no memory of the
one that wrote it.

---

## Task

You are a professional app reviewer with Flexyn (`~/flexyn2` — React + Vite +
Supabase + Tailwind + Radix PWA) installed for the first time. Your job is to
**find and test every single feature**, then publish the teardown: what's good,
what's buried, what's broken, what looks cheap, and the twenty small things
that would make it feel like a finished product.

Review the app the way a reviewer does — by trying to use all of it, including
the parts the app doesn't advertise. A feature you can't find is a feature that
doesn't exist, and that judgement is one of the main things this teardown is
for.

Seven questions drive everything:

1. **What features exist?** Build the census yourself by using the app, not by
   reading the file tree.
2. **What's hidden that shouldn't be?** Buried behind a menu inside a modal,
   three taps deep, or reachable only by a URL nobody will type.
3. **What's front-and-centre that shouldn't be?** Prime real estate spent on
   something half-built or rarely wanted.
4. **Which buttons don't work?** Dead, silent, or wrong.
5. **Which buttons look bad?** Weight, padding, radius, colour, states,
   alignment, hit area.
6. **Which colours and fonts are wrong?** Per screen, in both themes.
7. **What are the small polish wins?** The quality-of-life list — the highest
   value output of this whole exercise.

## Scope — read before starting

**The app is unreleased. There are no real users. Beta accounts get wiped
constantly.** So no usage analysis: no row counts, no activation, no funnels,
no "nobody uses X". A prior pass (`docs/app-critique-2026-08-04.md`) made
exactly that mistake and drew a wrong conclusion from wiped test data — **its
§3 and most of §5 are void**. Its security and account-deletion findings are
real but are not your subject.

Your subject is the product surface: what's there, whether you can find it,
whether it works, and whether it looks like something you'd pay for.

Related and worth skimming so you don't duplicate it:
`docs/ui-critique-prompt.md` is a screen-by-screen *walkthrough* brief — same
app, journey framing, "what did I feel". **This brief is different**: it is
feature-coverage framing. Where that one follows the user's path, this one
sweeps the whole surface for completeness and ranks what it finds. If both have
been run, cross-reference rather than repeat.

## Setup — mandatory, and already solved

**A UI teardown written from source code is worthless.** You cannot see a bad
button, a colour clash, or a dead control in JSX.

In sandboxed containers the headless browser has no TLS route out while Node
does, so the app boots, renders its shell, and loses every Supabase call to
`TypeError: Failed to fetch` — which looks exactly like a broken feature. A
prior run lost its entire visual pass to this. The fix is committed:

```bash
npm install
node scripts/dev-sb-relay.mjs &        # read its header — it explains the two gotchas

cat > .env.local <<'ENV'
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key — Supabase MCP get_publishable_keys>
ENV

npm run dev                            # http://localhost:5173
```

Drive with Playwright against
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, and **always** pass
`serviceWorkers: 'block'` — `push-sw.js` otherwise sits in front of the network
and makes failures nondeterministic.

Anonymous sign-ins are enabled, so `POST /auth/v1/signup` with `{}` and the
anon key returns a real session; write it to `localStorage` under
`sb-127-auth-token` and reload to land in onboarding as a new user.

**Two sandbox artifacts to rule out before blaming the app:**
`fonts.googleapis.com` is blocked here, so **the web font may not load and type
will render in a fallback** — confirm which face is actually painting before
writing a single word about typography. And if a screen is empty, check the
relay log before calling the feature broken.

You will need **two accounts' worth of state**: one fresh through onboarding,
and one with a workout, a meal, a goal and a regimen already logged — several
features only render once data exists, and reviewing them empty is reviewing
the wrong thing. Clean up what you create.

## Method

### Stage 1 — Find everything, without cheating

Spend the first pass discovering features **only through the UI**. Tap every
tab, every icon, every avatar, every card, every menu, every long-press. Write
down each feature the moment you find it, and **how many taps from the
Dashboard it took**.

Then — and only then — open `src/App.jsx` and `docs/feature-tier-list.md` and
list what you *missed*. That gap is the single most valuable artifact in this
review: **every feature on it is one a real user would never have found.** For
each, record where it actually lives and why you walked past it.

### Stage 2 — Exercise every feature

For each feature in the census, actually complete its task end to end. Not
"open the screen" — finish the job it exists to do: log the workout, send the
message, create the duel, claim the reward, edit the gym, save the plan.

Record, per feature:

| Field | Meaning |
|---|---|
| **Taps from Dashboard** | discoverability, counted |
| **Completed?** | did the job finish, yes/no/partly |
| **Feedback on success** | did the app tell you it worked |
| **Empty state** | what it looks like with no data |
| **Verdict** | `ship it` · `needs polish` · `half-built` · `broken` · `cut it` |

`src/lib/toast.js` suppresses every non-error toast without an `action` — 271
of 283 success call sites lack one — so expect many features to succeed
silently. Judge whether the surrounding UI compensates or whether the action
truly vanishes.

### Stage 3 — The control sweep

Click **every interactive element in the app** and log it. Buttons, tabs,
chips, toggles, switches, sliders, cards, avatars, icon buttons, menu items,
empty-state CTAs, back arrows, close buttons, pull-to-refresh, swipes.

Two independent verdicts per control, because they fail separately:

- **Function:** works · dead (nothing happens) · silent (works, no feedback) ·
  wrong (works, but not what the label says)
- **Form:** hit area ≥44×44? label legible? states present (default, pressed,
  disabled, loading)? does a disabled control *look* disabled rather than
  broken? does a primary action look primary?

Flag any control where **form implies the wrong function** — a secondary style
on the main action, a disabled-looking button that's live, a live-looking
button that's inert.

### Stage 4 — Colour and type, per screen

**Colour.** Extract the actual palette from each screen (sample the rendered
pixels, don't read Tailwind classes). Then judge:

- How many distinct hues on one screen? Which carry meaning (success, danger,
  streak, XP tier, league) and which are decoration?
- Does one colour mean the same thing on every screen it appears on?
- Contrast in **both** themes — a token can pass in dark and fail in light.
  Measure the ratios; don't eyeball them.
- Gradients: how many, and do they compete with each other or with content?
- A deliberate "colour budget" pass shipped recently — check whether it held or
  whether new colour has crept back in.

**Type.** Which families actually render, at what sizes and weights, and how
many distinct combinations appear on one screen. There are ~818 uses of 9–11px
text and ~1,219 `text-xs` — the question isn't the count, it's **which of them
you genuinely cannot read at arm's length on a phone**. Note that pinch-zoom is
currently disabled app-wide (`index.html:62`), so anything too small can't be
zoomed. Check numerals: are stats using tabular figures, or do they jitter as
they animate?

### Stage 5 — The polish backlog

The deliverable people act on. Every small thing that would make the app feel
more finished, each **under an hour**. Aim for 20+. Examples of the altitude:
a missing loading state, a button 4px off centre, a heading that wraps to two
lines at 375px, an icon that doesn't match its label, inconsistent corner
radii between two adjacent cards, a modal without a close button, a list that
doesn't preserve scroll on back, placeholder text still reading "Enter value".

Be specific enough to fix without asking a question.

## Deliverable

One document: `docs/app-review-<YYYY-MM-DD>.md`. Structure it as the review:

```
1. The verdict            — 5 sentences. What this app is, how finished it
                            feels, what you'd fix before launch. Written last.
2. Feature census         — every feature, taps-from-Dashboard, verdict.
3. Hidden features        — what you couldn't find, where it lives, and
                            where it should live instead. Ranked.
4. Over-exposed           — what occupies prime space and shouldn't.
5. Buttons that don't     — control, screen, expected, actual.
   work
6. Buttons that look bad  — with screenshots, and what's wrong with each.
7. Colour problems        — per screen, with measured contrast ratios.
8. Font problems          — per screen, with the face that actually rendered.
9. Quality-of-life        — 20+ items, under an hour each, ordered by
   polish backlog           feel-per-effort.
10. Bigger moves          — redesigns worth considering, with rough cost.
```

Sections 3, 5, 6, 9 are what was asked for — give them the most room.
Screenshots are evidence, not decoration: embed them beside the claim.

## Traps

- **Don't review from the file tree.** Discover through the UI first (Stage 1);
  the gap between what you found and what exists is a finding, and reading the
  routes early destroys it.
- **Don't blame the app for the sandbox.** Blocked fonts, a dead relay, a
  missing env var. A prior run reported a blank page and a "profile not found"
  that were both its own network failure.
- **Review features with data in them.** Half of this app renders differently
  once a workout exists. An empty screen reviewed as if it were the finished
  screen is a wasted section.
- **Separate taste from defect.** "Too much orange" is taste and welcome; "3.1:1
  on the primary button" is a defect. Label which is which; don't dress one as
  the other.
- **Don't pad the polish list.** 20 real items beat 40 with filler — filler is
  obvious and it makes the real ones easy to skip.
- **Don't count rows.** See scope.
- **Don't re-report** the security or account-deletion findings from
  `docs/app-critique-2026-08-04.md`.

## Constraints

- **Observe, don't fix.** The deliverable is the review. Fixes come after, in
  separate commits, once the list has been picked over. A visible typo you can
  fix in one line is the only exception — do it and say so.
- Read-only against production data; clean up accounts you create.
- If fixes do follow: `npm run lint` clean, `npm run test` green, `npm run
  build` clean. Feature branch first, never force-push `main`.
- After any push, post SQL inline in a ```sql block or say "No SQL needed —
  frontend only". Never point at a file path — the user is on mobile.

## Done means

A review someone could publish. Every feature found and exercised, every
control clicked and logged, colour and type judged per screen with measurements,
and a polish backlog long and specific enough to work through in order without
asking a follow-up question.

Where the app is genuinely good, say so and show it. A teardown that finds
nothing worth praising is not a rigorous teardown, it's a hostile one — and
this app is likely to earn real praise in places.
