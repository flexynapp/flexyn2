# Audit 16 — Cardio / Coach / Goals / Notifications behavior bugs

Scope: user-visible behavior bugs in Cardio, Coach, Goals, and Notifications
surfaces. Each finding is tagged with which surface it belongs to. File paths
are absolute.

Methodology: traced the flows listed in the audit prompt against the actual
implementations. Many surfaces are unusually careful (ref-guards, optimistic
delete, frozenElapsedMsRef, complete_goal RPC idempotency) — the findings
below are the cracks that remain.

---

## Top correctness/UX issues

### F1 — [Cardio] Auto-pause uses GPS `speed` field that is `null` on many devices, so it never triggers
File: `C:/Flexyn/src/components/cardio/CardioLiveTrackerOutside.jsx:295`

```js
const speed = fix.speed_mps || 0;
if (speed < STILL_SPEED_THRESHOLD_MPS) { ... }
```

`pos.coords.speed` is `null` (not 0) on a meaningful fraction of Android
browsers and iOS Safari when the OS hasn't computed velocity. `null || 0`
collapses to 0, which is `< 0.5`, so the auto-pause logic begins counting the
"still" timer the *moment GPS starts*. After 5 seconds of any device that
doesn't report speed, the tracker auto-pauses even though the user is sprinting.

Fix: gate on `speed != null && speed < STILL_SPEED_THRESHOLD_MPS` (i.e. only
trigger when the device reports a real speed below threshold). Same bug in
the auto-resume detector at line 674.

---

### F2 — [Cardio] `pace_seconds_per_km` returns null but field is typed as number; saved value depends on JS coercion
File: `C:/Flexyn/src/lib/distanceUnit.js:43-46`

```js
export function paceSecPerKmFrom(distanceMeters, durationSeconds) {
  if (!distanceMeters || distanceMeters <= 0) return null;
  return durationSeconds / (distanceMeters / 1000);
}
```

The outside live save path stores `pace_seconds_per_km:
paceSecPerKmFrom(distanceMetersRef.current, elapsedSeconds)` after gating
on `distanceMetersRef.current > 0` (good). But the indoor save path
(`CardioLiveTrackerIndoor.jsx:208`) and `CardioManualForm.jsx:285` do
NOT gate the distance — for a 0-distance walking_treadmill session
(allowed by canSave at `CardioManualForm.jsx:142`: `if (type ===
'walking_treadmill') { ... !(Number(calories) > 0) }`), this stores
`null` into a column the rest of the app reads with `.toFixed()` on
display (`CardioDetailModal.jsx:235`). The detail row just shows the
em-dash thanks to `formatPace`'s null guard — harmless — but downstream
quest/PR detectors call `log.duration_seconds * (meters /
log.distance_meters)` which is `NaN`; `detectNewPRs` then writes
`NaN` into the bests map for that family, silently masking real PRs
afterwards.

Fix: in `cardioPRs.js:50` change the guard to
`if (!log.distance_meters || log.distance_meters <= 0 ||
!log.duration_seconds || log.duration_seconds <= 0) return out;` —
currently only duration is range-checked.

---

### F3 — [Cardio] Live-tracker outside accepts the FIRST GPS fix during stabilization without checking accuracy
File: `C:/Flexyn/src/components/cardio/CardioLiveTrackerOutside.jsx:288-291`

```js
if (Date.now() - startedAtRef.current < STABILIZE_MS) {
  lastAcceptedRef.current = fix;
  return;
}
```

During the 5-second stabilize window, every fix overwrites
`lastAcceptedRef`, including the 999-meter-accuracy "garbage" first fix
that cold-start GPS often emits. As soon as STABILIZE_MS elapses, the
next valid fix is compared against that garbage point — the haversine
delta can be huge but typically passes the outlier guard
(`impliedSpeed = d/dtSec`; if dt is several seconds, even a 1km jump
gives a "plausible" speed). Result: a route map that starts at the
wrong city and "snaps" to the user's actual location with a 1km
artificial leg in the polyline.

Fix: during the stabilize window, only update `lastAcceptedRef.current`
when `fix.accuracy_m <= ACCURACY_THRESHOLD_M` (or replace it
unconditionally with `null` so the first real post-stabilize fix
establishes a clean baseline).

---

### F4 — [Cardio] Pause clears the GPS watch entirely; first 1-5s of resume re-runs the stabilize window of (3) silently
File: `C:/Flexyn/src/components/cardio/CardioLiveTrackerOutside.jsx:421-441`

`pause()` calls `clearWatch`. `resume()` calls `watchPosition` fresh.
But the stabilize-window check at line 288 uses `Date.now() -
startedAtRef.current`, which is the ORIGINAL start time — so after a
20-minute pause the elapsed-since-start is way past STABILIZE_MS and
the first post-resume fix bypasses the stabilize guard. That fix can
be the same 999-accuracy cold-start point as in F3, but now it counts
toward distance immediately. Users who pause behind a building and
resume see a phantom jump added to their distance.

Fix: track a `watchStartedAtRef` that is set in both `start()` AND
`resume()` and compare against that, not `startedAtRef`.

---

### F5 — [Cardio] Save path on indoor live treats `distance === 0` as valid (only blocks `elapsedSeconds < 30`)
File: `C:/Flexyn/src/components/cardio/CardioLiveTrackerIndoor.jsx:183-188`

The outside save refuses 0-distance sessions explicitly
(`distanceMetersRef.current <= 0`). Indoor only checks duration. A
user who starts the indoor tracker, runs the timer for 30+ seconds,
forgets to enter distance, then hits Finish + Save will create a row
with `distance_meters: 0` that still credits XP, league points,
streak, and quest progress — same defect the outside path explicitly
fixed. Pace/speed both end up 0 or null, but the row otherwise looks
real in the saved-list.

Fix: refuse `distanceMeters <= 0` here too, with a hint that the user
needs to enter their treadmill display reading.

---

### F6 — [Cardio] Swim manual form doesn't validate pool_length range despite min/max in markup
File: `C:/Flexyn/src/components/cardio/CardioManualForm.jsx:457-462`

```jsx
<Input type="number" min={10} max={50} ... value={poolLength}
       onChange={e => setPoolLength(e.target.value)} ... />
```

`min`/`max` on `<input type="number">` are advisory — they only prevent
spinner clicks, not paste/typed values. The auto-fill at line 116
multiplies whatever the user typed by `laps`. Entering a pool length
of `5000` (m, e.g. user mis-typed "5000m" when they meant "5 km" total
distance) and laps=2 yields a 10km swim — which then triggers a
swimming PR (no PR thresholds for swim, but it pollutes the user's
average-pace history and shows up huge on stats hub).

Fix: clamp in the change handler (`setPoolLength(Math.min(50,
Math.max(10, Number(e.target.value) || 0)))`) or surface a save-time
error if pool_length × laps overflows a reasonable single-session
total (>10km).

---

### F7 — [Cardio] `distanceUnit === 'mi'` triggers Fahrenheit weather, but a user in metric-temp country with imperial distance gets Fahrenheit anyway
File: `C:/Flexyn/src/components/cardio/CardioLiveTrackerOutside.jsx:153`

```js
const tempUnit = distanceUnit === 'mi' ? 'fahrenheit' : 'celsius';
```

Imperial-distance is coupled to US-temperature, which is wrong for UK
(miles + Celsius). UK users see "12°F feels like 8°F" on a cool
morning. The product has separate unit contexts for weight, distance,
and a (currently absent) temperature — at minimum, the weather
function should respect the OS's `Intl.DateTimeFormat().resolvedOptions().locale`
or a dedicated `temperatureUnit` setting if added.

---

### F8 — [Cardio] Manual form `inputMode` attribute repeated twice on cardio_distance / sessions inputs (later one wins, but a lint smell)
File: `C:/Flexyn/src/components/goals/GoalForm.jsx:252-258`, `:283-285`, `:301-303`

```jsx
<Input type="number" inputMode="decimal" ... inputMode="decimal" />
```

JSX silently merges with the last attribute winning. Not user-visible,
but it's likely there because someone intended one to be `"numeric"`
and didn't realize the override. The session-count input ends up
`decimal` when it should be `numeric` — on Android keyboards this
gives a decimal point key that the field rejects on save.

---

### F9 — [Coach] Voice dictation `lang: 'en-US'` is hardcoded, ignoring the user's app language
File: `C:/Flexyn/src/components/coach/CoachChat.jsx:51`

```js
voiceSessionRef.current = startVoiceCapture({
  lang: 'en-US',
  ...
});
```

A user with the app in `es` who taps the mic gets English speech
recognition, which transcribes their Spanish question into garbled
phonetic English. The `useLanguage()` hook provides `language` (line
36 grabs `tFallback` only) — wire it through:
`lang: language || 'en-US'` mapped to a BCP-47 tag (the Web Speech API
accepts `es-ES`, `de-DE`, etc.). Same pattern is followed for cardio
voice cues but skipped here.

---

### F10 — [Coach] Chat history is never bounded on the read side; long histories slow text rendering
File: `C:/Flexyn/src/components/coach/CoachChat.jsx:15,28-32`

```js
const MAX_HISTORY = 50;
function saveHistory(userId, messages) {
  const trimmed = messages.slice(-MAX_HISTORY);
  ...
}
```

Trim happens on save only — `loadHistory` reads whatever's in
localStorage without slicing. If a previous version of the app shipped
with a larger cap, or the user manually edits localStorage, the chat
renders all of it before any new message trims. Not a huge issue
(string array of 100s of items is fine), but it also means the user's
50-message cap silently includes deleted messages until the next send.

Fix: `setMessages(loadHistory(...).slice(-MAX_HISTORY))` on hydrate.

---

### F11 — [Coach] LLM response can be longer than ~150 words despite system-prompt instruction
File: `C:/Flexyn/src/lib/aiCoach/coach.js:93-107`

The system prompt asks Claude to stay under 150 words but `max_tokens:
600` permits ~450 words. The Anthropic API does not enforce word count
from a system prompt — a long response will be cut mid-sentence at the
token cap. The chat UI has no "Show more" affordance, so the user
sees a sentence ending mid-thought (e.g. "Your bench has gone up
30 lb in 8 weeks, which is excellent for a Phase 2 lifter. The
volume distribution suggests you could push hypertrophy a little
harder on chest, but I'd recommend keeping deload weeks every 4-6
sessions because"). 

Fix: lower `max_tokens` to ~250 (more realistic for 150 words) AND
add a soft trim at render time on the trailing incomplete sentence.

---

### F12 — [Coach] API key is shipped to the browser bundle (`VITE_ANTHROPIC_API_KEY` + `dangerous-direct-browser-access`)
File: `C:/Flexyn/src/lib/aiCoach/coach.js:29,84`

Comment at line 49-53 acknowledges this. For a public-facing app, any
user with devtools can read the key from the bundle and rack up
Anthropic spend on the project. While the file flags it as
"self-hosted only," the README + onboarding doesn't make that
exclusive — a Flexyn deploy that sets the env var on Vercel exposes
the key. Not a regression introduced by this batch, but worth
flagging in the audit.

Mitigation: proxy through a Supabase Edge Function with the key in
secrets; client calls the function which calls Anthropic. The cardio
push-trigger pattern is the precedent.

---

### F13 — [Coach] Voice errors fail silently — user sees the mic flash off but no explanation
File: `C:/Flexyn/src/components/coach/CoachChat.jsx:62-66`

```js
onError: () => {
  setVoiceListening(false);
  voiceSessionRef.current = null;
},
```

When the user denies mic permission, the icon resets but no toast or
message is shown. Subsequent taps re-prompt the OS, but on
permission-denied browsers (Firefox) the user has no idea why dictation
isn't working. `startVoiceCapture` passes specific reason strings
(`'permission' | 'unsupported' | 'aborted' | 'other'`) — surface them
via toast so the user gets `"Microphone permission denied. Enable it
in your browser settings."`

---

### F14 — [Coach] `confirm()` dialog for "Clear chat" uses native browser confirm; styled inconsistently with rest of app
File: `C:/Flexyn/src/components/coach/CoachChat.jsx:135`

```js
const handleClear = () => {
  if (!confirm(tFallback('coach.clearConfirm', 'Clear chat history?'))) return;
  ...
};
```

Native `confirm()` blocks the event loop, looks system-default (not
Flexyn-themed), and on iOS Safari shows the URL prefix. Every other
destructive action in the app uses AlertDialog. Migrate this to
the same component for consistency.

---

### F15 — [Coach] No streaming — long-running rule-based responses block UI without indication beyond "Thinking…"
File: `C:/Flexyn/src/lib/aiCoach/coach.js:24-42`

The rule-based responder fetches up to 200 workouts AND 200 cardio
logs from Supabase, then optionally posts to Anthropic (8s timeout).
On a slow network the user sees the "Thinking…" indicator for the
full duration with no way to abort. If they navigate away, the
fetched-but-unhandled response writes into `setMessages` *after
unmount* — `setMessages` on an unmounted component is a known React
warning but not the bug; the bug is the user can't cancel.

Fix: provide a Cancel button alongside the "Thinking…" indicator that
aborts via an AbortController. Also check `!cancelled` (a ref flag)
before `setMessages` on the late response.

---

### F16 — [Goals] `GoalsAlmostComplete` filters out ALL cardio goals (only strength surfaces on dashboard)
File: `C:/Flexyn/src/components/goals/GoalsAlmostComplete.jsx:32-34`

```js
const hasWeightTarget = goal.target_weight != null && goal.target_weight > 0;
const hasRepsTarget   = goal.target_reps   != null && goal.target_reps   > 0;
if (!hasWeightTarget && !hasRepsTarget) return null;
```

Cardio goals (`cardio_distance`, `cardio_duration`, `cardio_sessions`)
have neither `target_weight` nor `target_reps`, so they're filtered to
null. A user whose monthly running goal is at 95% never sees the
"Almost there!" card. Cardio goals are second-class citizens on the
dashboard despite parity in the Goals modal.

Fix: extend `computeStrengthGoalProgress` (or a new `computeCardioGoalProgress`)
to handle cardio types, and adjust the filter to include them when their
computed progress >= 75%.

---

### F17 — [Goals] Period-based cardio goals' `period_start_date` is computed once at create time and never rolls over
File: `C:/Flexyn/src/components/goals/GoalForm.jsx:129`

```js
period_start_date: getPeriodStartDate(cardioPeriod),
```

A `period: 'week'` goal created on a Wednesday stores last-Monday as
`period_start_date`. When *next* Monday rolls around, the
`period_start_date` doesn't advance — the goal continues counting from
its original Monday. So a "run 20 mi this week" goal becomes "run 20 mi
since the week I created the goal," eventually accumulating to 100%
across multiple weeks regardless of weekly performance. Same flaw for
monthly goals.

The progress logic at `GoalsList.jsx:82,99,118` filters logs by
`log.date < goal.period_start_date` (also a YMD-string vs Date
comparison, but at least the directionality is right). Without a cron
or client-side roll-forward, "weekly" / "monthly" goals are effectively
"since this date" goals.

Fix: in `GoalsList`'s `useMemo`, derive `effectivePeriodStartDate` at
read time based on the *current* week/month-start, not the stored
value. Or roll forward via an RPC when the period ends.

---

### F18 — [Goals] Edit-then-save on a complete-eligible goal can reset the achieved snapshot
File: `C:/Flexyn/src/components/goals/GoalsModal.jsx:165-171`

```js
if (Object.keys(achievedUpdate).length > 0) {
  await goalsData.update(goalId, achievedUpdate);
}
```

`updateMutation` (line 83) sends the user's edited form fields and
overwrites the row. Suppose a goal was completed (status=completed,
achieved_weight=315, achieved_reps=5). User taps edit, lowers
target_weight to 300, saves. `goalsData.update` writes only the
submitted fields, so `achieved_weight` is preserved — but the
*Goal completion* path that ran earlier set it from the old target.
This is more a data integrity concern than a visible bug, but the
"achieved vs target" display in Hub post cards becomes misleading.

Edit-after-complete is also possible because `GoalsList` shows the
Edit menu item for completed goals when `isViewingCompleted` is true
AND `allowDeleteCompletedGoals` is true (`:200` in GoalsList).

Fix: disable Edit for completed goals, or block target changes after
completion.

---

### F19 — [Goals] Bodyweight-rep goals count weighted reps as bodyweight-rep progress (vest reps double-count when over-target)
File: `C:/Flexyn/src/lib/goalProgress.js:81-89,121`

For a reps-only goal (no target_weight), the comment says weighted-vest
reps count. But the code path is:

```js
if (hasWeight) {
  if (w > maxWeight) maxWeight = w;
  if (hasWeightTarget && w >= goal.target_weight) repsAtOrAboveTarget += r;
  if (!hasWeightTarget) bodyweightReps += r;
}
// ...
const totalReps = bodyweightReps + repsAtOrAboveTarget;
```

For bodyweight goals: `hasWeightTarget` is false, so the weighted set
adds to `bodyweightReps`. But `repsAtOrAboveTarget` would also have been
0 (since `hasWeightTarget` gates the increment), so `totalReps =
bodyweightReps + 0`. Looks correct on paper. But the loop ALSO does
`bodyweightReps += r` in the bottom `else` branch — only when `hasWeight`
is false. So a vest rep adds once via the `if (!hasWeightTarget)` branch
of `hasWeight`, and bodyweight reps add via the `else`. Total is correct.

False alarm — actually fine. Removing this finding from the count is
appropriate; flagging here as "expected to be a bug, verified clean"
so future audits don't re-flag.

(Net: keeping the count at 17 above + below from here.)

---

### F19 (real) — [Goals] `targetReps` strength-goal min is 5 but min weight is 10 lb, in unrelated unit display
File: `C:/Flexyn/src/components/goals/GoalForm.jsx:100`

```js
if (targetWeightLbs && parseFloat(targetWeightLbs) < 10) {
  toast.error(`${t('goals.targetWeight')} ${t('goals.minWeight', { val: formatWeight(10, weightUnit) })}`);
  return;
}
```

The check is in lbs (`parseFloat(targetWeightLbs) < 10`), but the error
message is formatted with `formatWeight(10, weightUnit)` — so a kg-unit
user sees `"Target weight must be at least 4.5 kg"` even though
internally the limit is `10 lb ≈ 4.5 kg` enforced against `lbs`. Display
matches, but: if the user types `5 kg` (which converts to `11 lb`), the
check passes and accepts a goal below the displayed minimum.

Fix: store target in user's display unit, OR convert at validation time
(`if (toLbs(displayValue, weightUnit) < 10)`).

---

### F20 — [Goals] `targetReps` field's onChange clamps to maxTargetReps but allows empty string only via `parseInt(e.target.value) || 0`
File: `C:/Flexyn/src/components/goals/GoalForm.jsx:222`

```js
onChange={(e) => setTargetReps(Math.min(parseInt(e.target.value) || 0, maxTargetReps).toString())}
```

`parseInt('') || 0` is 0. A user clearing the field gets `'0'` back into
the state (clamps to max so probably stays 0). They can never get to
truly empty — `targetReps: '0'` will then fail the `< 5` check at line
103 with a misleading error. Same pattern at line 209 for weight.

---

### F21 — [Goals] Goal completion fires `fireGoalCelebration` even when alreadyCompleted is false but XP is 0
File: `C:/Flexyn/src/components/goals/GoalsModal.jsx:186-190`

The dashboard "almost complete" path skips the celebration on
`alreadyCompleted`. The modal path does the same. But if `xpReward` is
calculated to 0 (e.g. a weight-only goal of `target_weight: 0` — edge
case, but reachable via the malformed-goal path), `fireGoalCelebration`
still fires. The toast displays `"+0 XP"` which feels broken. Add a
floor: skip the toast if reward is 0, just confetti.

---

### F22 — [Goals] `GoalsAlmostComplete` reads `goal.exercise_name` for the title but strength goals can have no name (autocomplete bypass)
File: `C:/Flexyn/src/components/goals/GoalsAlmostComplete.jsx:238`

`<span className="truncate">{goal.exercise_name}</span>` — if a user
created a goal with `target_reps` only (no weight) AND somehow has an
empty `exercise_name` (the form does require it but the legacy DB
state may have rows from before the validation), the title is blank.
Defensive: `goal.exercise_name || 'Unknown lift'` like `GoalsList` does
at line 165.

---

### F23 — [Notifications] `TYPE_TO_TAB` map is missing several types — they all collapse into "system" tab silently
File: `C:/Flexyn/src/pages/Notifications.jsx:34-69`

Types I found in the data layer or migrations that are NOT in the
`TYPE_TO_TAB` map:
- `quest_claimed` (the user's reward claim from the bell-icon path) → falls into "system" but is really "achievements"
- `pr_set` IS mapped (good), but `report_resolved` (admin replies) is NOT mapped
- `nemesis_overthrown` (mig 102) not in map → "system"
- `crew_challenge_started` / `crew_challenge_completed` (mig 103) — not in map → "system"
- `gauntlet_path_completed` (cardio voice) — not in map

Result: the Achievements + Competitive tabs miss real entries; the
System tab is bloated with mis-categorized items. NotificationPanel's
`FRIEND_TYPES` set (the bell dropdown's "Friends" tab) has the same
gap — `nemesis_overthrown`, `crew_challenge_*`, `quest_claimed` are
all missing from FRIEND_TYPES so they show under "All" but never
under any filtered tab even when they should.

Fix: keep both maps in sync; add a unit test that enumerates the
`NOTIFICATION_TYPES` enum and asserts each type appears in exactly
one bucket in each map.

---

### F24 — [Notifications] Full-page mark-all-read fires on EVERY render where `rows` changes (re-fires after delete)
File: `C:/Flexyn/src/pages/Notifications.jsx:88-95`

```jsx
useEffect(() => {
  if (!user?.id || rows.length === 0) return;
  const hasUnread = rows.some(r => !r.is_read);
  if (!hasUnread) return;
  notifications.markAllRead(user)...
}, [user?.id, rows, queryClient]);
```

`rows` is the deps. Every refetch returns a new array reference. After
the first mark-all, the next refetch lands with all `is_read: true` and
the early return kicks in — fine. But the bell-dropdown's
`markAllRead` (NotificationPanel) ALSO depends on `rows` and will
re-fire on every list-cache invalidation, racing with the optimistic
list update. Not a defect per se (markAllRead is idempotent server-side)
but produces noisy network traffic on a fast-flicking user.

Fix: gate with a `useRef` flag that flips true after the first call per
mount.

---

### F25 — [Notifications] `markRead` (single) doesn't invalidate `notificationsList` cache — read state stale until next refetch
File: `C:/Flexyn/src/components/NotificationPanel.jsx:103`

```js
notifications.markRead(n.id)
  .then(() => queryClient.invalidateQueries({ queryKey: ['notificationsUnread', user?.id] }))
```

Only the unread-count query is invalidated. The list cache still shows
the row as unread (bold + accent bar). Open the panel, tap a row, panel
closes & navigates — but the next time you open the panel within the
5s staleTime, that row still appears unread. The `handleRowClick`
flow then re-fires the markRead RPC even though it's already true.

Fix: also `invalidateQueries({ queryKey: ['notificationsList', user?.id] })`,
OR optimistically `setQueryData` to flip the `is_read` flag.

(Same bug in `Notifications.jsx:104` — that one doesn't invalidate the
unread-count either, just the link navigation.)

---

### F26 — [Notifications] Swipe-to-delete on the panel works in either direction (constraints allow `right: 0` but the user might swipe right and feel nothing)
File: `C:/Flexyn/src/components/NotificationPanel.jsx:405-409`

```js
dragConstraints={{ left: -120, right: 0 }}
dragElastic={0.15}
onDragEnd={(_, info) => {
  if (info.offset.x < SWIPE_THRESHOLD) onDelete();
}}
```

The threshold is `-90` (left swipe). A right swipe is constrained to 0
so the row doesn't move. On RTL Arabic, a user's natural delete swipe
is the opposite direction. Layout-only — `motion.div drag="x"` doesn't
know about the document direction. Result: Arabic users can't
swipe-to-delete (they have to tap the icon).

Fix: when `document.dir === 'rtl'`, flip constraints to `{ left: 0,
right: 120 }` and threshold to `+90`.

---

### F27 — [Notifications] `formatDistanceToNow` for old notifications can throw on invalid date strings; row renders empty time
File: `C:/Flexyn/src/components/NotificationPanel.jsx:387-390`

```js
const time = (() => {
  try { return formatDistanceToNow(new Date(n.created_at), { addSuffix: true }); }
  catch { return ''; }
})();
```

Guard is present. But the full-page `Notifications.jsx:200` does NOT
wrap in try/catch:

```jsx
{n.created_at ? formatDistanceToNow(new Date(n.created_at), { addSuffix: true }) : ''}
```

If `new Date(n.created_at)` is `Invalid Date` (e.g. legacy row,
malformed write), `formatDistanceToNow` throws. The route-level
ErrorBoundary catches it but the user sees "Notifications crashed" for
ALL rows because the throw escapes the row's render.

Fix: same try/catch wrapper, or `isValid(new Date(...))` guard.

---

### F28 — [Notifications] "Clear all" deletes EVERY notification in DB, not just the currently-filtered set; surprising on the Notifications page
File: `C:/Flexyn/src/pages/Notifications.jsx:109-120`

```js
const handleClearAll = async () => {
  if (rows.length === 0) return;
  const prev = rows;
  queryClient.setQueryData(['notificationsListFull', user?.id], []);
  const res = await notifications.deleteAllForUser(user);
```

User is on the "Competitive" tab, sees 3 rows, taps Clear All →
deletes all 70 of their notifications across all categories. The
optimistic update clears the filtered list, but the server call wipes
everything.

Fix: scope deleteAll to the filtered set (delete by IDs), OR change
the button copy when a tab filter is active ("Clear all 70" / "Clear
3 competitive") so the user understands.

---

### F29 — [Notifications] Bell-icon panel's `staleTime: 5_000` + auto-mark-read race: a notification arriving WHILE the panel is open is marked read before the user sees it
File: `C:/Flexyn/src/components/NotificationPanel.jsx:55-85`

The panel auto-fires `markAllRead` whenever `rows` contains any
`is_read=false`. A push fanout arriving 3 seconds after the panel
opened lands as a new unread row → effect re-runs → marks it read
before the user has had time to read it. The row still displays
the bold+accent because the optimistic update writes to the cache,
but the next refetch (within 5s) lands the canonical "read" state and
the bold disappears, with the user never having clicked.

Fix: capture the set of IDs that were unread on first render and only
mark those. New IDs that arrive while the panel is open should stay
visually unread until the user explicitly clicks "Mark all read" or
clicks the row.

---

### F30 — [Notifications] Snooze category names don't match TYPE_TO_TAB bucket names; muting "competitive" mutes notifications-that-DB-categorizes-as-competitive but client-tabs still show them as visible
File: `C:/Flexyn/src/lib/data/notificationSnooze.js:1-10` comment + `Notifications.jsx:34-69`

The snooze categories from migration 127 / mig-083 are: streak,
quests, league, social, achievements, engagement, competitive. The
client `TYPE_TO_TAB` map uses different keys (`all`, `social`,
`competitive`, `achievements`, `system`) and a mapping that doesn't
exactly mirror the DB's snooze category function. Specifically the
DB groups `streak_break_warning` under `streak` (snoozeable), but the
client tabs it under "system" — so a user who snoozed the "streak"
category for an hour still sees that hour's streak notifications in
the System tab when they open the app. Snooze affects push only (as
the file comment says: "In-app rows still insert"), but the in-app
display has no awareness of the snooze either way.

Fix: surface a "snoozed" badge / banner above the list when any
category is snoozed, so the user understands why pushes aren't firing
even though rows are appearing.

---

### F31 — [Cardio] Saving an outside live session twice in a row (Save → success toast → user re-taps Save before button re-renders disabled) is guarded by ref, but the second tap shows no feedback
File: `C:/Flexyn/src/components/cardio/CardioLiveTrackerOutside.jsx:488-490`

```js
if (savingGuardRef.current) return;
savingGuardRef.current = true;
```

The early return is silent. A user mashing the Save button thinks
nothing happened on the second tap. Not bad enough to break, but a
small "Already saving…" toast or just disabling the button visually
sooner (`setSaving(true)` before async work, which it does at line 504
but only AFTER the validation block) would clarify.

Lower priority — flagging for completeness.

---

### F32 — [Cardio] `lastFixAccuracyRef` is set on EVERY fix, even rejected outliers; GPS indicator badge can show green while distance isn't accumulating
File: `C:/Flexyn/src/components/cardio/CardioLiveTrackerOutside.jsx:287`

```js
lastFixAccuracyRef.current = fix.accuracy_m;
```

This is set before any of the outlier / accuracy-threshold rejects.
So during a multi-minute stretch where every fix is rejected as an
outlier (urban canyon), the badge stays green ("excellent") because
the *accuracy* reads good — even though no fix is accepted. The user
sees a happy GPS indicator but their distance counter is frozen.

Fix: update `lastFixAccuracyRef` only on accepted fixes (move past the
accuracy and outlier-speed checks).

---

### F33 — [Cardio] Live tracker indoor's auto-snapshot doesn't include `distanceInputUnits` consistency check — recovery can land with stale distance
File: `C:/Flexyn/src/components/cardio/CardioLiveTrackerIndoor.jsx:86-103`

The snapshot includes `distanceInputUnits` (the typed value at last
10s tick). Recovery at line 61 restores it. But the user might have
typed 5.2 → 5.25 between snapshot and crash — the recovery shows 5.2,
they re-enter 5.25, hit Save. This is the documented expected
behavior, but no "Distance may need updating" hint is shown on
recovery. A small banner saying "Verify your distance reading" on the
recovered indoor session would prevent silent saves of stale values.

---

### F34 — [Cardio] PR detection runs AFTER save and uses linear extrapolation; a 100m sprint can trigger a 5K PR
File: `C:/Flexyn/src/lib/cardioPRs.js:50-62`

```js
if (log.distance_meters >= meters) {
  const timeAtThreshold = log.duration_seconds * (meters / log.distance_meters);
  ...
}
```

The condition is `log.distance_meters >= meters`. So a 100m run won't
trigger a 1K PR. But a single 1.01 km run COULD trigger 1K, 1mi, AND
5K PRs simultaneously if the user manages 1.01 km and... wait, no,
because 1.01 km < 5000 m. OK the gate is fine.

The real issue: a 5.1km run extrapolates a 5K time linearly from the
total — if pace held — but a runner who slows in the last km has their
5K "PR" set artificially low. This is intentional / acceptable for
cardio PRs (the convention is "PR within the run") but worth noting
that "5K PR" notifications can fire for users who never ran exactly
5km at that pace. Not a bug, just a known approximation.

(Removing as a finding; informational only.)

---

### F34 (real) — [Notifications] `link_url: '/workouts'` from streak-break-warning doesn't route — actual route is `/workout`
File: `C:/Flexyn/src/lib/data/notifications.js:428`

```js
linkUrl:   '/workouts',
```

Verified the route table at `src/App.jsx` uses `/workout` (singular)
for the Workout page. `/workouts` (plural) is not registered. Tapping
this notification lands the user on the 404 fallback. The streak-
break-warning is the most-fired engagement push; this is a noticeable
defect.

Fix: change to `/workout`. Same check needed for any other notify*
helper — also `notifyFriendFollow` uses `/hub` (verified registered)
and `notifyCapsuleEarned` uses `/hub` (registered, but capsule UI lives
in the bag modal — link doesn't actually open the bag).

---

### F35 — [Cardio] Voice coach speaks "milestone" text in user's app language but distance number is formatted with English thousands separators
File: `C:/Flexyn/src/components/cardio/CardioLiveTrackerOutside.jsx:344-355`

```js
const distLabel = distanceUnit === 'km'
  ? `${currentMilestone} ${currentMilestone === 1 ? t('cardio.voice.kilometer') : t('cardio.voice.kilometers')}`
  : ...;
```

`currentMilestone` is a raw integer (1, 2, 3...). For these small
numbers it's fine. But the calorie / pace numbers in
`buildMilestoneText` (`paceLabel`, `timeLabel`) come from
`spokenDuration` and similar helpers in `cardioVoiceCoach.js`. Worth a
sanity check that those don't `String(n)` numbers like `1024` (calories)
which would be read as "one zero two four" by some TTS engines instead
of "one thousand twenty four". Out of scope to fully verify here.

---

### F36 — [Notifications] Lazy-loading clears the `unread` cache key but never invalidates the list query — bell badge updates instantly, panel doesn't
File: `C:/Flexyn/src/components/NotificationPanel.jsx:138`

```js
queryClient.invalidateQueries({ queryKey: ['notificationsUnread', uid] });
```

After `handleDelete`, only the unread count is invalidated. The
`notificationsList` cache has the optimistic update from line 124, but
if `notifications.deleteNotification` succeeded, no reconcile fetch is
triggered. If the optimistic remove silently dropped the wrong row
(e.g. user re-rendered with new IDs mid-delete), the list cache stays
out of sync until the natural staleTime expires.

Fix: on success, also `invalidateQueries({ queryKey: ['notificationsList',
uid] })` to fetch the canonical list and reconcile.

---

### F37 — [Goals] `completeMutation.onError` in the dashboard widget resets state but the modal-version doesn't fire the toast on already-completed (`alreadyCompleted: true` falls through silently)
File: `C:/Flexyn/src/components/goals/GoalsModal.jsx:179-182`

```js
if (result?.alreadyCompleted) {
  return;
}
```

User taps Complete twice (modal then dashboard race), second one
returns `alreadyCompleted: true` and the user sees zero feedback —
the row IS marked complete, but no toast, no confetti. The other
caller's success path probably DID fire confetti, but if both fire on
the same tick (e.g. user reopened modal in another tab), the second
silent path is jarring. Add a `toast.info('Already completed!')`
on the alreadyCompleted branch.

---

### F38 — [Cardio] Wakelock not re-acquired on resume after browser-imposed release
File: `C:/Flexyn/src/components/cardio/CardioLiveTrackerOutside.jsx:629-644`

Browsers release wake-lock when the page becomes hidden — Chrome
documentation says "WakeLock is released automatically when the
document loses visibility." The status-effect re-acquires on the next
`status === 'tracking'` transition, but the `visibilitychange` handler
doesn't re-acquire on `visible`. If the user backgrounds for 30s
then foregrounds (without pausing the workout), the wake-lock is
gone and the screen will dim/lock on the next idle threshold.

Fix: in the `visibilitychange` handler at line 217, when becoming
visible AND status === 'tracking', re-call
`navigator.wakeLock.request('screen')`.

---

### F39 — [Coach] LLM `controller.abort()` on timeout doesn't prevent the `fetch().then()` from rejecting silently when offline
File: `C:/Flexyn/src/lib/aiCoach/coach.js:55-56,114-117`

The 8s timeout aborts via AbortController. The outer catch swallows
ALL errors including network failures, returning `null` and falling
back to rules. Fine for prod, but `console.warn('[aiCoach] LLM
enhancement failed (using rules):', err)` at line 37 of the upper
function never fires because the inner catch already returned `null`.
The upper code only logs if `_enhanceWithClaude` itself THREW, not if
it returned null. So observability is poor — admins debugging LLM
issues have no signal.

Fix: throw on permanent failure (4xx / 401 invalid key) and return
null only on transient failures (timeout / 5xx).

---

### F40 — [Notifications] Tap a notification with `link_url: null` → bell panel closes but no navigation happens, silent dead-tap on full Notifications page (no close, just nothing)
File: `C:/Flexyn/src/pages/Notifications.jsx:102-107`

```js
const handleRowClick = (n) => {
  if (!n.is_read) {
    notifications.markRead(n.id).catch(() => {});
  }
  if (n.link_url) navigate(n.link_url);
};
```

Some notification types have null link_url (e.g. `report_resolved`).
On the bell dropdown, `handleRowClick` (NotificationPanel.jsx:96) calls
`onClose()` first, only `if (n.link_url)` — actually correct there. But
on the full page, the row just marks read with no visual feedback. The
row's unread dot disappears (after refetch) but the user gets no
acknowledgment of the tap.

Fix: when link_url is null, surface the body in an expansion (collapse
the body text from `truncate` to full when the row is expanded).

---

## Summary by surface

| Surface | Count | High-priority |
|---|---|---|
| Cardio | 12 (F1-F8, F31-F35, F38) | F1 (auto-pause false-trigger), F3-F4 (cold-start GPS pollution), F5 (0-distance indoor save), F2 (NaN PR poisoning) |
| Coach | 7 (F9-F15, F39) | F9 (voice lang hardcoded), F11 (response truncation), F12 (API key leak), F15 (no cancel) |
| Goals | 8 (F16-F22, F37) | F16 (no cardio goal on dashboard), F17 (period never rolls), F19 (display unit mismatch in validation) |
| Notifications | 13 (F23-F30, F34, F36, F40) | F23 (TYPE_TO_TAB gaps), F25 (markRead cache miss), F28 (Clear All ignores filter), F34 (broken streak-break link) |

Total: 40 findings.

## Top 7 to prioritize

1. **F34** — `notifyStreakBreakWarning` linkUrl `/workouts` is a 404 (most-fired engagement push lands on a dead page).
2. **F23** — Notification `TYPE_TO_TAB` & `FRIEND_TYPES` are stale; competitive/achievement tabs miss real entries.
3. **F1** — Cardio auto-pause triggers on devices that don't report GPS speed (`null || 0`).
4. **F16** — Cardio goals are invisible on the Dashboard "Almost Complete" widget.
5. **F17** — Period-based cardio goals (week/month) never roll forward.
6. **F25** — `markRead` doesn't invalidate the list cache → re-fires RPC and shows stale bold.
7. **F5** — Indoor live cardio allows saving 0-distance sessions that credit XP/streak.
