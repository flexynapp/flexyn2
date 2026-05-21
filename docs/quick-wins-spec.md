# Sprint Spec: Top 7 Quick Wins

Implementation brief for the seven easiest S-tier features from
[`feature-tier-list.md`](./feature-tier-list.md). All seven require
**zero database migrations**. Total estimated effort: ~18–22 hours.

Each section is structured so it can be handed directly to a dev (or
pasted into a Claude session) and yield a working implementation.

**Order:** easiest → hardest.

---

## 1. Live 1RM Estimator + PR Bar (~2 hrs)

### Vision
Every time a user finishes typing a set (weight + reps), a small
subtle inline indicator appears beneath the input row showing their
estimated one-rep max for that lift using the Epley formula, plus a
horizontal progress bar comparing that estimate to their current PR.
This turns every set into a micro-feedback moment: "you're at 87% of
your PR" or "🎯 new estimated PR pace." Users learn their numbers
organically without needing to dig into Progress charts. It also
primes them for the celebration in feature 7.

### Why it matters
Today, set completion is silent until save. Lifters mentally do this
math anyway — surface it. Bonus: the estimate is the trigger for the
PR celebration (feature 7), so building this first sets up the
cascade.

### Prerequisites
None. Pure client-side math.

### Files touched
- **New file:** `src/lib/oneRepMax.js` — pure utility
- **Edit:** `src/pages/Workout.jsx` (or whichever set-row component
  is rendered inside it — likely `src/components/workout/ExerciseLogger.jsx`
  or similar). Search for the set input rendering.
- **New file:** `src/components/workout/OneRMIndicator.jsx` — display
  component
- **Edit:** `src/lib/i18n-workout.js` (or new domain file) for strings

### Data model
None. Computed live.

### Math
```
Epley:    1RM = weight × (1 + reps/30)
Brzycki:  1RM = weight × 36 / (37 - reps)
```
Use Epley as default (most popular, simplest). Cap reps at 12 — above
that, the formula loses accuracy, so show "n/a" instead of a wild
number.

### UI Specification

Indicator row appears below each set input as soon as both
`weight > 0` AND `reps > 0` are entered:

```
[ 185 lb ] × [ 8 reps ]           ← existing inputs
─────────────────────────         ← subtle separator
≈ 231 lb 1RM  ████████░░  87% PR  ← new indicator row
```

**Three sub-elements, left to right:**

1. **Estimated 1RM text** — `≈ 231 lb 1RM` (or `kg` per
   `useWeightUnit()`). Greyed text, 12px. The `≈` symbol signals it's
   an estimate, not a real lift.
2. **Progress bar** — horizontal, full-width-minus-text. Fill color:
   - **Grey** if reps > 12 (out of formula range — show "estimate skipped")
   - **Blue** if estimate < 90% of current PR
   - **Orange** if estimate is 90–100% of PR (approaching)
   - **Gold + subtle pulse animation** if estimate ≥ PR (new PR pace!)
3. **Percentage label** — `87% PR` or, if no prior PR exists,
   `Set your first PR!`

**Tap behavior:** Tapping the indicator opens a small bottom
sheet/popover explaining:
- "Estimated 1RM uses the Epley formula. Your actual max may vary."
- Their current actual PR for that exercise (e.g., "Current PR: 250 lb × 1")
- A small chart showing 1RM estimate trend over last 5 sessions (if
  data exists). If no prior data: "Log more sessions to see trends."

### States & edge cases
- **First set of new exercise (no PR history):** Show "Set your first
  PR!" instead of percentage. Bar fills based on estimate vs. zero.
- **Reps = 1:** Estimate equals weight. Bar fills to 100% if it ties
  PR or exceeds, no-op otherwise.
- **Bodyweight exercises:** Detect via exercise metadata
  (`requires_weight === false`). Show rep-count-vs-PR instead of
  weight-vs-PR. "12 reps · 92% of PR (13)."
- **Cardio exercises:** Don't render the indicator.

### Verification
- Manual: enter 185 × 8 → expect "≈ 231 lb 1RM."
- Manual: edit a set higher than PR → bar turns gold + pulses.
- Switch units (lb ↔ kg in settings) → number reflows correctly.
- Run `npm run test` — add a unit test for `estimate1RM(weight, reps)`
  covering boundary cases (1 rep, 12 reps, 13 reps → null).

---

## 2. "Your Rank: #N" Badge on Leaderboards (~2 hrs)

### Vision
The Leaderboards screen today shows the top of each board with podium
styling, but users can't see where **they** sit unless they're in the
top 10. Add a sticky banner at the top of each leaderboard tab
showing the current user's exact rank and how close they are to
climbing — "You're #47 — 240 XP from #46." Also, when the user
scrolls down the list, their row is visually highlighted (subtle gold
border, "YOU" pill). This turns the leaderboard from "show-off wall"
into "personal ladder."

### Why it matters
Right now leaderboards are aspirational only for top users. Adding
personal rank turns them into a daily check-in surface for every
user, regardless of skill level. Pairs perfectly with feature 3
(notifications) once you add "you've been passed" alerts later.

### Prerequisites
None — `LeaderboardsContent.jsx` (251 lines) already fetches all
users and has access to `useAuth()`.

### Files touched
- **Edit:** `src/components/LeaderboardsContent.jsx`
- **New file:** `src/components/leaderboards/YourRankBanner.jsx`
- **Edit:** existing user-row component within `LeaderboardsContent.jsx`
  to add highlight styling
- **Edit:** `src/lib/i18n-leaderboards.js` (create if doesn't exist)

### Data model
None — derive from existing fetched data.

### UI Specification

Sticky banner at top of each leaderboard tab (Level / Achievements /
Volume / Distance):

```
┌─────────────────────────────────────────────┐
│  YOU                                        │
│  #47 of 1,283                               │
│  ━━━━━━━━━━━━━━━━━━━━━━━━░░░░░░░░░░         │
│  240 XP to overtake #46 (Sarah G.)          │
└─────────────────────────────────────────────┘
```

**Elements:**

1. **"YOU" pill** — gold or primary color, 11px uppercase, top-left
2. **Rank text** — large (24px bold): `#47` followed by smaller
   `of 1,283`
3. **Progress bar** — shows how far through the current "tier" the
   user is. Tier = bracket of 10 (so user at #47 sees how close to
   #41 they are: bracket bottom is rank 50, top is rank 41).
4. **Gap-to-next text** — `240 XP to overtake #46 (Sarah G.)`. If
   user is #1: show `🏆 You're #1` instead.
5. **Tap behavior:** scroll the leaderboard down to the user's row
   with a smooth animation.

**Highlighted user row in list:**
- 2px gold/primary border on the row background
- Inline `YOU` pill next to the name
- Sticky behavior: as user scrolls past their row, the row "sticks"
  to the top of the scroll area so they always see themselves.

### States & edge cases
- **User not in leaderboard yet** (no data): show "Log a workout to
  join the leaderboard." with CTA button.
- **User is #1:** show trophy icon + "🏆 You're #1" + countdown to
  runner-up's gap closing.
- **Tied with another user:** show `#47 (tied)` and "X users tied at
  this position."
- **Switching board tabs:** banner updates per board; cache results
  so toggling doesn't refetch.

### Verification
- Log in as a known user, switch each tab → banner shows correct rank.
- Tap banner → list scrolls + your row highlighted.
- Confirm sticky behavior works on mobile (test on actual iOS Safari
  since `position:sticky` has historical bugs).

---

## 3. Follow Notifications in the Bell Center (~2 hrs)

### Vision
When user A follows user B, B's bell icon already gets a +1 unread
count — but the dropdown panel doesn't show a distinct "X started
following you" row. Currently it shows up as a generic notification
or gets buried. Add a dedicated row type with the follower's avatar,
name, and a one-tap **Follow Back** button (if not already
following). This closes the most basic social loop in any platform.

### Why it matters
Reciprocal-follow loops are the #1 driver of social graph density.
Currently no nudge to follow back = lopsided graph = dead feeds. Five
minutes of UI work prevents a structural problem.

### Prerequisites
None. `NOTIFICATION_TYPES.FRIEND_FOLLOW` exists,
`hubFollows.follow()` already fires `notifyFriendFollow()`.
Server-side i18n already in place via `notify_friend_follow_for()`
RPC.

### Files touched
- **Edit:** `src/components/NotificationPanel.jsx` (433 lines — find
  the row render function, add a new switch case for `FRIEND_FOLLOW`
  type)
- **Edit:** `src/lib/i18n-notifications.js` for the row template
  strings
- **No data layer changes** — `notifications.js` already creates these.

### UI Specification

New notification row template (renders when
`notification.type === 'FRIEND_FOLLOW'`):

```
┌─────────────────────────────────────────────┐
│  [avatar]  Sarah G. started following you   │
│            2 hours ago         [Follow Back]│
└─────────────────────────────────────────────┘
```

**Elements:**

1. **Avatar** — 40px round, falls back to initials if no photo. Tap →
   opens follower's profile (`?profile=<email>` route).
2. **Body text** — `<bold>Sarah G.</bold> started following you`. Use
   the recipient's preferred language (already handled by `t()`).
3. **Timestamp** — relative time ("2 hours ago", "3 days ago"). Use
   existing relative-time helper.
4. **Follow Back button** — primary outline button, only renders if
   recipient does NOT already follow the actor.
   - On tap: calls `hubFollows.follow(targetEmail)`, optimistically
     updates button to `Following ✓` (greyed), fires a small toast
     "You followed Sarah G."
   - If the follow API fails: revert button, show error toast.
   - If already following: button hides entirely, replaced by a small
     `Following` pill.
5. **Whole-row tap** — opens follower's profile.

### States & edge cases
- **Self-follow attempt:** notification type should never fire for
  self. If it does (race condition), filter it out client-side.
- **Follower deleted account:** show "Someone" as name + greyed-out
  avatar; tap is a no-op + tooltip "This user no longer exists."
- **Multiple follows in one session:** stack identically — don't
  dedupe. Each shows individually.
- **Already followed back:** swap the button for a `Following ✓` pill.

### Follower count badge on Hub header
While in `NotificationPanel.jsx`, also add a small numeric badge next
to the followers count on the Hub profile screen header — `12 ▲` if
there are new follows since last view. Reset on view. (Store
last-view timestamp in `localStorage`.)

### Verification
- Test account B follows A → A's bell shows new dot. Open panel → row
  renders with "Follow Back."
- Tap "Follow Back" → B's bell shows new dot for A's reciprocal
  follow. State updates without page reload.
- Reload page → button correctly shows "Following" state.

---

## 4. Hydration Ring on Dashboard (~3 hrs)

### Vision
The Nutrition page already has a beautiful animated water ring
(`WaterTracker.jsx`, 288 lines). Bring a compact version of it to the
Dashboard as a glanceable hydration widget — visible the moment a
user opens the app, no extra tap required. A subtle pulse when you
tap to add water. Builds the daily check-in habit: "open app → see
hydration is at 40% → quick-add a glass → close." 30 seconds of
engagement that lifts retention.

### Why it matters
Hydration is the easiest fitness habit. Surfacing it on Dashboard
makes it the front-door behavior, not a buried Nutrition tab feature.

### Prerequisites
None. `WaterTracker` already exists; water data already fetched and
stored.

### Files touched
- **New file:** `src/components/dashboard/HydrationRingWidget.jsx`
- **Edit:** `src/pages/Dashboard.jsx` — add the widget to the
  dashboard grid (probably in the same row as `WorkoutStreakBanner`
  or just above quick actions)
- **Edit:** `src/components/dashboard/WidgetLibrary.jsx` — register
  as an optional widget (the dashboard appears to support
  customizable widgets)
- **Edit:** `src/lib/i18n-dashboard.js` strings

### Data model
None. Reuses the existing water-log data layer.

### UI Specification

Compact ring widget (roughly 120×120px on mobile, sits inline with
other dashboard cards):

```
   ╱─────╲
  │  60%  │     Today
   ╲──💧──╱     48 / 80 oz
                [+ 8 oz]
```

**Elements:**

1. **Circular SVG ring** — 100px diameter, 8px stroke, animated fill
   from 0° based on `consumed/goal × 360`. Color shifts:
   - **Blue** (0–60%)
   - **Cyan→teal gradient** (60–100%)
   - **Green** (>100%) with a tiny ✓ in the center
2. **Center percentage** — large, bold. 16px.
3. **Right-side label stack:**
   - "Today" (small uppercase)
   - "48 / 80 oz" (large; respect user's unit pref from `useUnit()` —
     show ml if metric)
4. **Quick-add button** — `+ 8 oz` (or `+ 250 ml`). Uses the user's
   default bottle size from their nutrition prefs. Tap: instantly
   adds, ring animates fill upward + subtle pulse + soft haptic
   (`navigator.vibrate(15)`).
5. **Long-press behavior:** opens a modal with size options
   (8 oz / 16 oz / 32 oz / custom). Same modal Nutrition page already
   uses — extract it to a shared component if not already.
6. **Whole-card tap (not button):** deep-links to Nutrition page →
   Water tab.

### States & edge cases
- **Goal not set:** show "Set hydration goal" CTA instead of
  percentage. Tap → opens Nutrition onboarding for hydration goal.
- **Goal exceeded:** show "Crushed it 🎉" pill, ring stays at 100%
  visually but small "+2" badge shows extra.
- **At/past daily cap** (200 oz from explore notes): quick-add button
  greys out; tooltip "Daily cap reached for safety."
- **Reduced motion:** skip the pulse/animation; just snap the fill.

### Verification
- Log water → ring animates up. Refresh → state persists.
- Switch units in settings → label flips between oz and ml correctly.
- Reach 100% → color transitions to green + ✓ appears.

---

## 5. Post Share Button (~3 hrs)

### Vision
A workout PR, a duel win, a debrief — these are share-worthy
artifacts. Today they're trapped inside the app. Add a share button
to every post in `HubPostCard` (and stories, debriefs, workout-saved
cards). Tap → native share sheet on mobile (iMessage, WhatsApp,
Instagram, etc.), or copy-link with a toast on desktop. Each shared
link includes Open Graph meta tags so the preview shows the user's PR
card, not a generic Flexyn logo. This is the lowest-cost viral loop
you can ship — every share is a free acquisition channel.

### Why it matters
You can't grow organically without share. Currently you have rich
post snapshots (workouts, cardio, meals, goals — all already rendered
with full data) and no way to get them out of the app. Five-minute
fix with disproportionate growth impact.

### Prerequisites
- For share URL: deep-link infrastructure (already exists —
  `?profile=<email>` routes are functional).
- For OG previews: requires server-side rendering or a
  meta-tag-only HTML stub. Defer the OG part to a follow-up if not in
  scope (still ship the share button immediately; links work,
  previews come later).

### Files touched
- **Edit:** `src/components/hub/HubPostCard.jsx` (606 lines — add
  share button to action row alongside like/comment)
- **New file:** `src/lib/sharePost.js` — wraps `navigator.share()`
  with `navigator.clipboard` fallback
- **Edit:** `src/lib/i18n-hub.js` for strings
- **(Optional, can defer)** `index.html` and a small share-link route
  for OG metadata.

### Data model
None — share URL is derived from post data.

### URL format
Posts need a stable URL. Use the existing deep-link convention:
```
https://flexyn.app/?post=<post_id>
```
On load, the app should resolve `?post=<id>` → open the relevant feed
scrolled to that post. If post doesn't exist (deleted, private): show
a graceful "This post is no longer available" card.

### UI Specification

Share button in the existing post action row (next to like + comment):

```
[ ❤ 24 ]  [ 💬 7 ]  [ ↗ Share ]      ← icons only on mobile
```

**Elements:**

1. **Share icon** — Lucide `Share2` icon or platform-appropriate.
   18px, same style as like/comment.
2. **Tap behavior:**
   - Attempt `navigator.share({ title, text, url })` — works on iOS
     Safari + Android Chrome + many desktops.
   - **Title:** "Sarah's new bench PR on Flexyn" (or context-appropriate)
   - **Text:** "I just hit 250 × 1 on bench press. Beat that 💪" (or
     just the post body)
   - **URL:** the canonical post URL.
   - On `AbortError` (user cancelled): silent — no toast.
   - On other errors OR if `navigator.share` unsupported: fall back
     to `navigator.clipboard.writeText(url)` + toast "Link copied.
     Share anywhere."
3. **Long-press (optional, future):** show a custom share menu with
   platform-specific buttons (Instagram Stories, X, Discord) — defer
   to a later sprint.

### Per-post-type customization
The share text should reflect what's being shared:
- **Workout post:** "I just logged a workout: 4 exercises, 12 sets,
  9,840 lbs total"
- **PR post:** "New PR! 250 × 1 bench press 🏆"
- **Goal complete:** "Goal achieved: Lose 10 lbs in 60 days ✓"
- **Plain post:** Just the post body, truncated to 140 chars

Extract a helper: `buildShareText(post) → { title, text }`.

### States & edge cases
- **Private/friends-only post:** Hide the share button entirely (use
  existing privacy field). Don't tempt users to share something only
  their followers can see.
- **Story posts:** Stories are ephemeral — show share button only on
  the user's own story (let them share their story to other
  platforms), don't show on others' stories.
- **No network:** if `navigator.clipboard` fails too (rare, e.g.,
  insecure context), show a manual modal with selectable URL text.

### Verification
- Mobile: tap share → native share sheet appears.
- Desktop: tap share → clipboard copy + toast.
- Share to iMessage → confirm URL pastes correctly.
- Open shared URL in incognito → app opens, post visible.

---

## 6. Message Read Receipts UI (~3 hrs)

### Vision
DMs in Flexyn already track who has read what and when (`read_at`
column populated by `hubMessages.js`). The UI just doesn't show it.
Add subtle checkmark indicators next to each sent message: one ✓ for
delivered, two ✓ ✓ for read, with a small "Seen 2m ago" timestamp
under the last-read message in each conversation. Mirrors
WhatsApp/iMessage patterns so it's instantly understood. Removes the
"did they get it?" anxiety that kills DM engagement.

### Why it matters
Read receipts are table stakes for any messaging product in 2024+.
Their absence makes DMs feel half-built. Pure UI work — all the data
is already there.

### Prerequisites
None. `hubMessages.js` (243 LOC) already populates `read_at`;
localStorage caching for read state is in place.

### Files touched
- **Edit:** `src/components/hub/HubMessages.jsx` (301 lines — find
  the message-row render function)
- **Edit:** `src/lib/i18n-messages.js` (create if doesn't exist)
- **No data layer changes** — `read_at` is already populated.

### UI Specification

On the sender's side of the conversation (right-aligned bubbles):

```
                   ┌──────────────────┐
                   │  Hey, you free?  │
                   │              ✓✓  │
                   └──────────────────┘
                   Seen 2m ago
```

**Elements:**

1. **Status indicator** in the bottom-right corner of each sent
   message bubble:
   - **Pending** (just sent, not yet confirmed by server): grey clock
     icon ⏱
   - **Delivered** (server acked, not yet read): single grey ✓
   - **Read** (`read_at` is set): double blue/primary-color ✓✓
2. **"Seen X ago" timestamp** — appears below the **last** read
   message in the conversation (not every message — only the most
   recent read one). Uses relative time. Updates live if the
   conversation is open (poll every 30s or via Supabase Realtime
   subscription).
3. **Inbox list view** (`HubMessages.jsx` inbox tab):
   - Conversations with unread messages: bold name + count badge
     (right side, primary color).
   - Conversations user has read: regular weight.
   - Last-message preview now shows the read state indicator at end:
     `"Hey..."  ✓✓` so you can see at a glance if they've seen your
     last message.

### States & edge cases
- **Sender's own messages:** show receipts.
- **Received messages:** no receipts shown (only the sender cares
  about their delivery state).
- **Group/crew chat:** show "Seen by 3 of 5" if any have read it,
  "All read" when full. Aggregated, not per-person (per-person would
  be too noisy).
- **User has read receipts disabled** (not currently a setting —
  could be a future option; for now, always on, but **mention this in
  the implementation** as a known concern for privacy-aware users).
- **Message just sent, not yet roundtripped:** show clock icon
  optimistically until server confirms, then upgrade to ✓.

### Optional: Settings toggle (defer if out of scope)
Add a privacy toggle in `SettingsPanel.jsx`: "Send read receipts."
When off, the user's reads don't populate `read_at` on incoming
messages, AND they can't see other users' read receipts (industry
standard — read receipts are reciprocal).

### Verification
- Test account A sends to B. A sees ✓ (delivered).
- B opens conversation. A sees ✓✓ + "Seen Xm ago" within ~30s.
- Reload A's page — state persists.
- Test inbox: conversations sort with unread on top, bold names.

---

## 7. PR Auto-Celebration Modal (~3 hrs)

### Vision
The biggest emotional moment in lifting is hitting a new PR. Today,
the app is silent when it happens — the set just gets saved like any
other. Add a dedicated celebration that fires immediately on save
when the user's just-logged set produces a new estimated 1RM PR for
that exercise. Distinct from the existing 5 celebrations (first
workout, first regimen, first goal, first meal, goal complete) —
this one has its own haptic signature, gold-themed confetti shooting
from the bottom-center like a champion's burst, a trophy emoji, and a
modal that names the PR explicitly: "NEW PR: 250 × 1 BENCH PRESS."
Optionally taps into the share button (feature 5) so they can
broadcast it immediately.

### Why it matters
This is THE retention moment in any strength app. Strong, Hevy, etc.
all do it. Adding this single feedback loop is plausibly worth 5–10
percentage points on D30 retention by itself. The data + estimator
(feature 1) is already there — this just wires the moment.

### Prerequisites
- Feature 1 (1RM Estimator) — uses the same Epley calc
- `PR_ACHIEVED` quest type already exists in `notifications.js`
- 5 existing celebration helpers in `src/lib/*Celebration.js` serve
  as templates

### Files touched
- **New file:** `src/lib/prCelebration.js` (mirror
  `firstWorkoutCelebration.js`, 69 lines)
- **Edit:** `src/pages/Workout.jsx` save handler — wire the trigger
- **Edit:** `src/lib/data/workouts.js` — add a helper to compute "is
  this a PR" alongside save
- **New file:** `src/components/celebrations/PRCelebrationModal.jsx`
  — modal UI distinct from the toast
- **Edit:** `src/lib/i18n-workout.js` for strings
- **Update:** `CLAUDE.md` celebration table to add this 6th
  celebration with its signature

### Distinct celebration signature
Per CLAUDE.md, each celebration must have a **distinct vocabulary**.
Proposed for PR:

| Property | Value |
|---|---|
| Helper | `firePRCelebration` |
| Trigger | New estimated 1RM PR on a single exercise |
| Haptic | `[20, 80, 20, 80, 40]` (victory drumroll — distinct from goal `[15,50,15]`) |
| Confetti shape | Single dense burst from `y: 0.9` (bottom-center, "champion's eruption") + cascading gold sparks |
| Emoji | 🏆 |
| Palette | Gold/amber: `['#fbbf24', '#f59e0b', '#d97706', '#ffffff']` (clean — no rainbow) |
| Duration | 8s (longer than others — give the moment air) |

### PR detection logic
Place in `src/lib/data/workouts.js` or a new
`src/lib/data/personalRecords.js`:

```
isPersonalRecord(exerciseName, weight, reps) → { isNew, previousPR, newEstimate }
```

1. Compute `newEstimate = estimate1RM(weight, reps)`.
2. Query the user's prior best estimated 1RM for that exercise
   (`max(weight × (1 + reps/30))` across all sets for that exercise).
3. Return `isNew: newEstimate > previousPR + ε` (small epsilon to
   avoid floating-point ties).
4. Cache the previous PR per-exercise in React Query so this is a
   single DB hit per save, not one per set.

### UI Specification

On save, after the existing save flow completes, check each logged
set. If any set produces a new PR, fire the celebration once per
exercise (so a session with PRs in 3 exercises = 3 celebrations
queued, shown sequentially with 1.5s gap).

**Celebration Modal:**

```
        🏆
   NEW PERSONAL RECORD

   BENCH PRESS
   ━━━━━━━━━━━━━━━━━━━
   250 × 1
   Previous: 240 × 1

   +50 XP
   ━━━━━━━━━━━━━━━━━━━
   [ Share PR ]  [ Continue ]
```

**Elements:**

1. **Trophy emoji** — 64px, scale-in spring animation (Framer Motion
   already in stack).
2. **"NEW PERSONAL RECORD"** — uppercase, gold gradient text, 14px
   tracking-wide.
3. **Exercise name** — large (28px), title case.
4. **The PR** — 36px bold, format `weight × reps` in user's unit.
5. **Previous PR line** — small grey, with the prior number for
   comparison.
6. **XP gained** — pulled from the save flow's XP delta. Show with a
   gold `+` prefix.
7. **Two buttons:**
   - **Share PR** (primary) → invokes the share helper from feature 5
     with PR-specific text: "New PR: 250 × 1 bench press 🏆 via
     @flexyn"
   - **Continue** (secondary) → dismisses the modal, returns to
     workout view.
8. **Auto-dismiss** after 8 seconds if user takes no action (still
   log to Sentry + fire toast as a fallback record).
9. **Background:** subtle gold radial gradient overlay (no full
   backdrop blur — keep it celebratory, not modal-y).

### Confetti & haptic
Fire from the helper, not from the modal component, so the
celebration works even if the modal fails to render:

```js
navigator.vibrate?.([20, 80, 20, 80, 40]);
confetti({
  particleCount: 200,
  spread: 120,
  origin: { x: 0.5, y: 0.9 },
  colors: ['#fbbf24', '#f59e0b', '#d97706', '#ffffff'],
  scalar: 1.4,
});
// 400ms later: secondary "spark" cascade
setTimeout(() => {
  confetti({ particleCount: 80, spread: 60, startVelocity: 25, origin: { x: 0.5, y: 0.8 } });
}, 400);
```

### States & edge cases
- **Multiple PRs in same session:** queue them. Show sequentially
  with 1.5s between modals so user can savor each.
- **Reduced motion preference:** skip confetti, fire toast only.
  Modal still shows (it's informational, not motion-heavy).
- **First-ever set of an exercise:** technically a PR (no previous).
  Show "FIRST PR!" label instead of "NEW PR." Use the same modal.
- **Editing/deleting a set:** if a user logs a PR then deletes it,
  the PR doesn't roll back automatically — that's fine for v1
  (rolling back celebrations is a confusing UX). Note this as known
  limitation.
- **Implausible PR (anti-cheat):** the existing
  `detectImplausibleWorkout` should run before firing celebration. If
  flagged, skip the celebration and queue for review.

### Verification
- Log a known PR set → modal fires, confetti, haptic.
- Log a non-PR set → no modal, normal save flow.
- Log multiple PRs in one save → modals queue and play in sequence.
- Tap "Share PR" → invokes the share sheet (verifies integration
  with feature 5).
- Test on iOS Safari (haptic feedback, reduced-motion respect).
- Run `npm run test` — add tests covering `isPersonalRecord` logic
  (boundary, ties, first-set).

---

## Cross-cutting verification checklist

Before merging the whole sprint:

1. `npm run lint && npm run test && npm run build` — all clean
2. Each new file follows existing patterns (`safeSelect`,
   `reportError`, `ErrorBoundary`)
3. Each new string has at least an English i18n key with
   `t(key) || 'fallback'`
4. New celebrations don't accidentally duplicate haptic signatures of
   existing ones (verify against CLAUDE.md celebration table)
5. Each item ships behind no feature flag — small, additive, no
   breaking changes
6. Manual QA on mobile Safari (the dominant install target for a
   fitness PWA) + Android Chrome

## Suggested commit cadence

One commit per item (7 commits total). Each commit message follows
the existing convention:

```
feat(<area>): <one-line summary>

<paragraph explaining the WHY>
<paragraph noting any follow-ups or known limitations>
```

This keeps `git blame` clean and lets you cherry-pick or revert any
one feature independently.
