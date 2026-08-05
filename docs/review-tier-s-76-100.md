# Acceptance review — features #76–100

Run 2026-08-05 against `main` and the production database.

The band splits cleanly: **#76–82** are the last of the S-tier resilience and
workout guarantees, **#83–100** are the top of A-tier "Active" — and unlike the
previous two bands, most of those are real UI a designer can hold an opinion
about.

---

## Headline

**Every informational toast in the app renders nothing.** Not most — **28 of
28**. `toast.info`, `toast.message` and `toast.warning` are still gated behind
"must carry an action", and not one call site passes one. That includes a live
GPS tracker telling you it auto-paused, a set row telling you it just changed
the weight you typed, and onboarding warning you that profile details failed to
save. This is the same defect that was found and fixed for `toast.success`
earlier today; the fix covered one of the four variants.

---

## Resilience & workout (#76–82)

### #76 `RS7` — Read strip-and-retry (`safeSelect.js`)
**GRADE: A** — 126 lines, **51 consumers**. Handles both error shapes (`42703`,
`PGRST204`), retries up to 20 times so a wide payload can shed every bad column
before giving up, and documents that a stripped column comes back absent rather
than throwing. Genuinely adopted, not a helper nobody calls.

### #77 `RS8` — Per-region ErrorBoundaries
**GRADE: A** — **107** labelled `<ErrorBoundary label="…">` instances across 24
files. The label is what makes these useful; a boundary with no label produces
a recovery card that can't say what broke.

### #78 `RS9` — Route-level ErrorBoundaries
**GRADE: A** — 32 references in `App.jsx`, one per lazy route.

### #79 `W29` — Idempotent save / reconcile (migration 142)
**GRADE: A** — The full chain is present and, unusually, complete on both sides:

- `workout_logs.idempotency_key` with a **partial** unique index
  (`WHERE idempotency_key IS NOT NULL`), so pre-feature rows aren't caught.
- `Workout.jsx` mints the key per `saveWorkout` **invocation**, deliberately not
  per mutation call, so the error-toast retry hands back the same key.
- `db.js` catches `23505`, confirms it's the idempotency constraint by name,
  and re-reads the winning row rather than surfacing an error.
- Double-tap is guarded twice over — `saveInFlightRef.current ||
  saveMutation.isPending` at the top of the handler, and `disabled` on the
  button.

I went looking for the gap where a double-tap produces two keys and therefore
two rows. It's closed.

### #80 `W52` — First-workout celebration + capsule grant with retry message
**GRADE: A** — The retry message the row claims genuinely exists, and the
comment records why: the grant used to fail silently, so a user celebrated a
capsule they never received and later found an empty Bag. Now
`workout.firstCapsuleFailed` tells them to log another workout, which works
because the RPC is idempotent.

### #81 `W55` — Workout sessions hook with pausable background sync
**GRADE: A** — `src/hooks/useWorkoutSessions.js` exists and is wired.

### #82 `W56` — Workout XP (per-set formula, session caps)
**GRADE: A** — Per-set formula with a bodyweight branch (0.5 XP/rep, capped at
20/set), a hard `MAX_WORKOUT_XP` per session, and a separate cardio ceiling.
Best part is a 25-line comment stating that **daily** caps live in SQL and not
here, that the client-side per-session caps are advisory, and that the server
re-caps regardless. That is exactly the right division and it is written down.

---

## A-tier · Active (#83–100)

### #83 `AI28` / #93 `ON18` — Onboarding coach
**GRADE: A** — `src/components/onboarding/OnboardingCoach.jsx`, 4 references.
These are two rows describing one component; worth collapsing in the sheet.

### #84 `SH22` — Pull-to-refresh on the whole app shell
**GRADE: A** — Mounted once in `Layout.jsx` wrapping the route outlet, so it
genuinely covers the shell rather than per-page.

### #85 `D16` — Hero card → Start workout CTA
**GRADE: A** — Present in the hero's right-hand CTA column.

### #86 `D23` / #90 `GA25` — Daily chest
**GRADE: C** — and the server half is the strong half.

`claim_daily_chest` is **properly atomic**: a single `UPDATE … WHERE id = uid
AND (last_daily_chest_at IS NULL OR … < today) RETURNING`, so exactly one of N
concurrent callers passes the predicate, and the capsule INSERT rides in the
same transaction as the coin credit. No read-then-write race. That is the part
most likely to be wrong and it is right.

**GAP 1 — the "already claimed" message renders nothing.** The branch exists
*because a user reported the bug it fixes* — the comment quotes them: "the daily
chest icon has popped up three times and it even says that it's claimed but
when…". It calls `toast.message(…, { description: … })` with no `action`, and
`toast.message` is `keepIfAction`. So:

```js
setReady(false);                          // card disappears
if (data?.already_claimed === true) {
  toast.message('Already claimed today.') // ← renders NOTHING
```

The user taps the chest, it vanishes, and they get silence. The fix for a
user-reported bug is itself invisible. See the headline finding below — this is
one of 28.

**GAP 2 — readiness is decided from localStorage, not the server.**
`isDailyChestReady` reads `daily_chest_claimed_<userId>` from localStorage. It
correctly mirrors the server's UTC-day basis (checked — both use UTC, no
mismatch), but a second device, a cleared cache or a private window all show an
available chest that the server will refuse. `last_daily_chest_at` is already on
`user_profiles` and already in the profile cache, so the authoritative value is
sitting right there unused. With GAP 1 fixed this degrades to a clear message;
today it degrades to nothing.

**Checked and cleared:** I expected the write-before-act bug here (the same one
just fixed in `LevelUpManager`). It isn't present — the localStorage write comes
*after* `if (error) throw error`, which is the correct order.

**Also worth a look, though it matches the stated claim:** "once per UTC day"
means a user at UTC−7 sees their daily reward reset at **5pm local**. That's the
same clock problem as the XP caps in #59, and more user-visible, because "come
back tomorrow" arrives mid-evening.

### #87 `D43` — Push opt-in banner, only after first workout
**GRADE: A** — `PushOptInBanner({ hasWorkouts })` and the render condition ANDs
on it. The gate is real.

### #88 `GA16` — Capsule rarity ladder
**GRADE: A** — standard / premium / elite, with a documented grant schedule:
standard per level, premium every 5, elite every 10.

### #89 `GA17` — Capsule opener animation (single + batch)
**GRADE: A** — Batch open is genuinely implemented (32 references), not just
single-open in a loop.

### #91 `NT1` — Notification bell with unread badge + bounce
**GRADE: A** — Unread count from `notifications.unreadCount`, **combined with**
the DM unread count for the app badge total, animated with framer-motion.
Combining the two is a nice detail the row doesn't even claim.

### #92 `NT2` — Notification panel (slide-in)
**GRADE: A** — Slides from `x: offEdge` to `x: 0` over a fading scrim.
`offEdge` rather than a hardcoded negative value means it respects RTL, which
is the thing usually missed here.

### #94 `P1` — Four tabs: Trends, Body, Photos, Insights
**GRADE: A** — All four render off one `activeTab`.

### #95 `SE1` — Settings panel (slide-over)
**GRADE: A** — Present.

### #96 `SE32` — Profile menu entries
**GRADE: D — the row is wrong in both directions.**

What the menu actually renders, read off the twelve buttons in
`ProfileMenu.jsx`:

> Profile · Settings · Achievements · My Bag · My Gym · My Gyms ·
> Corporate Wellness *(feature-flagged **off**)* · My Journal ·
> Weekly Summary · My Injuries · Sign out / Sign in · Delete account

Against the sheet:

| Claimed | Reality |
|---|---|
| Marketplace | **No such entry.** `My Bag` navigates to `/market`; there is no "Marketplace" item. |
| Trade History | **Absent.** |
| Admin (role-gated) | **Absent as a menu entry.** Verified users get a crown drawn on their avatar — that's the only admin affordance here. |
| Corporate | Present but **flagged off**, so it renders for nobody. |

And four entries that exist are **missing from the sheet**: Achievements, My
Journal, Weekly Summary, My Injuries.

Same class as #43's "45+ Radix primitives" — the sheet describes an older or
imagined build. Nothing to fix in code; the row needs rewriting so the next
reviewer doesn't hunt for a Trade History screen.

### #97 `W4` — Weight steppers + decimal input
**GRADE: A** — And the step size is thought through: `2.5 / 0.453592` lbs when
the user is in kg, because 2.5 kg is the smallest standard plate pair. A naive
5 lb step would land on unloadable weights for every kg lifter.

### #98 `W45` — First-workout coach-mark tutorial
**GRADE: A** — `src/components/workout/FirstWorkoutTutorial.jsx`, wired into
`Workout.jsx`.

### #99 `W46` — Saved list with search by name or date
**GRADE: A** — Searches the raw ISO date *and* human-formatted words ("July",
"Mon"), so typing a month name works. That's the version of this feature people
actually want.

### #100 `W74` / #101 `W75` — Starter plan hero + view
**GRADE: A** — `StarterPlanHeroCard.jsx` and `StarterPlanView.jsx` both exist.

---

## The headline finding, in full

**28 of 28 gated-variant toast call sites render nothing.**

`src/lib/toast.js` wraps three variants in `keepIfAction`, which returns
`undefined` unless the options object carries an `action`:

```js
toast.info    = keepIfAction(sonnerToast.info);
toast.message = keepIfAction(sonnerToast.message);
toast.warning = keepIfAction(sonnerToast.warning);
```

A scan of every call site (paren-balanced, so multi-line calls are read whole)
finds **28 calls across 21 files, and zero of them pass an `action`.** The gate
isn't shaping these messages — it is deleting all of them.

The ones that matter most:

| Site | Message the user never sees |
|---|---|
| `pages/Onboarding.jsx` | **"Some profile details could not be saved — finish setup fro…"** — a data-loss warning, during onboarding |
| `workout/SetRow.jsx` | **"Capped at {n} {unit}"** / **"Capped at {n} reps"** — the app silently changed what the user typed |
| `cardio/CardioLiveTrackerOutside.jsx` | **"Auto-paused"** / **"Auto-resumed"** / **"GPS signal weak"** — mid-run, on a live GPS track |
| `dashboard/DailyChestCard.jsx` | "Already claimed today" (see #86) |
| `hub/CapsuleOpener.jsx` | "{n} capsule(s) were already open…" |
| `pages/MyGyms.jsx` | "You're already a member of this gym." |
| `crews/CrewBattleEntry.jsx` | "Already in the queue." |
| `duels/DuelInviteCard.jsx` | "Duel declined." |
| `journal/JournalView.jsx` ×3 | "No earlier journal entries." / "Switch to today to write…" |

The SetRow and cardio ones are the serious pair. Silently clamping a typed
weight is the app changing user data without telling them. Silently pausing a
run means someone finishes a 10k and finds half of it recorded.

**This is the same defect fixed earlier today, one variant short.** The
"errors only" policy was written for a design with subtle inline cues that
never shipped; the audit that caught it found 271 of 283 `success` toasts
rendering nothing, and `success` was made a passthrough. The other three
variants were left gated, and their 28 sites have exactly the same problem —
they were simply outside the scope of that scan.

**FIX:**
- `warning` → passthrough, unambiguously. It is the error-adjacent class, and
  muting "your data didn't save" is not a design choice anyone made on purpose.
- `info` / `message` → this needs Kegan's call, not mine. They are the class
  the original policy was aimed at. But the evidence is that the gate currently
  means "these 28 messages do not exist", which is not what "only show a toast
  when it carries an action" was meant to achieve. My recommendation is
  passthrough for both plus a lint rule banning bare `toast.info` for anything
  that is really a confirmation. **S** to change, **M** if every call site is
  re-reviewed for whether the message is worth showing at all.

---

## Summary

**Grades:** A ×20 · C ×1 · D ×1.

This is the strongest band of the three so far, and the reason is visible in
the code: the workout save path (#79) is the only feature reviewed anywhere in
these 100 items where I went hunting for the obvious hole — double-tap
producing two idempotency keys — and found it already closed, on both the
client and the server, with the reasoning written down. `safeSelect` at 51
consumers and 107 labelled error boundaries say the resilience layer is real
rather than aspirational.

**The one systemic failure is the toast gate**, and it is worth noting what it
has in common with the previous band's findings. Storage GC reported
`succeeded` 2,710 times while collecting nothing. The i18n `||` returned a
string, so the lookup "worked". And here, `keepIfAction` returns `undefined`
and every caller ignores the return value, so 28 messages are dropped with no
error, no warning and no test failing. **Three bands, three variations of the
same shape: the mechanism runs, the signal says fine, the outcome never
happens.** The cheap defense is the same each time — assert on the outcome, and
make the silent path loud.

**Best improvement-per-hour:**
1. `toast.warning` → passthrough, then decide on `info`/`message`. One line for
   the first part; it un-mutes a data-loss warning in onboarding and a silent
   clamp of user-entered weights.
2. Give `DailyChestCard`'s already-claimed toast an action (or let the variant
   through), so the fix for the reported bug becomes visible.
3. Read daily-chest readiness from `last_daily_chest_at` instead of
   localStorage, so a second device doesn't offer a chest the server will
   refuse.
4. Rewrite the #96 row to match the menu that exists.
