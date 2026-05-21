# Feature Tier List — Full App Audit & Recommendations

Working notes from a deep-audit pass over every feature area in the
Flexyn PWA. Ranked tier list of additions/improvements with effort,
impact, and existing-infrastructure readiness.

## Ranking rubric

- **Impact** = how much it changes the product experience (1–5)
- **Effort** = engineering hours (XS = <1 day, S = 1–2d, M = 3–5d, L = 1–2wk, XL = >2wk)
- **Readiness** = how much existing infra already covers it (% complete)

Items rank higher when **Impact is high AND Effort is low AND Readiness
is high**.

---

## What already exists (so we don't re-pitch it)

**Training:** Workout logger (sets/reps/weight, cardio), 400+ exercise
library w/ autocomplete, rest timer w/ voice cues, regimens
(user-built + community templates w/ supersets/circuits/fork count),
Form Coach (TF.js MoveNet, 4 lifts), Gauntlet (10-challenge path +
weekly community gauntlet), Duels (mirror/open/exercise), Bounties
(auto-generated, 3 difficulty tiers), Nemesis (AI-matched rival),
PR tracking (data-layer), fatigue/anti-cheat detection, comeback
protocol, XP curve through L100, capsule rewards
(standard/premium/elite).

**Wellness:** Dashboard (hero, stats, quick actions, daily quests,
weekly league, stories, discovery), Progress (PRs, trends, analytics,
body metrics, photos), Goals (strength/cardio/generic,
weekly/monthly/lifetime, almost-complete nudges), Achievements vault,
Nutrition (manual log, barcode scan via @zxing, USDA + Spoonacular,
water tracker, macros & micronutrients, nutrition plans), Streaks
(login + workout), Weekly Debriefs (auto-generated, PNG export),
Injuries (severity tiers, muscle group exclusion, synergist blocking),
Body composition (weight + 7 measurements + photos).

**Social/Infra:** Hub (profile, follows, stories), DMs, Crews, Coach
(AI chat), Market (real-RPC purchases, post-admin-bypass cleanup), 15
languages (split build), push notifications (push-sw.js), PWA install,
Sentry+reportError, safeSelect schema drift, 5 celebration helpers
(distinct haptic/confetti signatures), region+route ErrorBoundaries.

---

## S-Tier — Ship this week (high impact × very low effort × ≥80% built)

### S1. PR Auto-Celebration Modal — *Impact 5 / Effort XS / Readiness 90%*
The `PR_ACHIEVED` quest type already exists; PRs are tracked in the
data layer; you have 5 celebration helpers with their own
haptic/confetti signatures. Just add `firePRCelebration` (gold
confetti, victory haptic `[20,80,20,80,40]`, 🏆 emoji) and fire it
from `Workout.jsx` save when estimated 1RM (Epley) for that exercise
exceeds prior max. Surfaces an emotional moment that's currently
silent. **~3 hrs.**

### S2. Exercise History Sidebar in Logger — *Impact 5 / Effort XS / Readiness 95%*
`getLastSetsForExercise` already runs in the regimen seeder. During
logging, render the last 3 sessions' sets next to the input row
("Last: 185×8, 185×8, 185×7"). Removes the #1 friction in the logger.
**~4 hrs.**

### S3. Live 1RM Estimator + PR Bar — *Impact 4 / Effort XS / Readiness 100%*
Pure client math (Epley). On every set save, show estimated 1RM and a
progress bar toward current PR. Combine with S1 for a complete moment.
**~2 hrs.**

### S4. Warmup Set Toggle — *Impact 4 / Effort XS / Readiness 85%*
A "warmup" pill on each set row. Flagged warmup sets get reduced XP
weight and a different visual. No schema change required if stored in
`set_meta` JSON. **~4 hrs.**

### S5. Hydration Ring on Dashboard — *Impact 4 / Effort XS / Readiness 95%*
Water tracker exists w/ daily cap. Add an Apple-Watch-style radial
progress ring to `Dashboard.jsx` showing % of daily water goal. Tap →
quick-add modal. **~3 hrs.**

### S6. Sleep Log (Quality + Hours) — *Impact 5 / Effort S / Readiness 80%*
One row per day: hours + dropdown (poor/fair/good/great). New
`sleep_logs` table mirroring `body_metrics` shape. Add to Progress
analytics tab as a line chart. Unlocks every recovery feature
downstream. **~1 day.**

### S7. Daily Mood Log — *Impact 4 / Effort S / Readiness 80%*
Single-tap emoji picker (😩😐🙂😄🔥) on Dashboard. Stored daily. Show
mood-vs-volume correlation in Progress. Mirror the `body_metrics`
pattern; reuse celebration helpers for milestones (30-day log streak).
**~1 day.**

### S8. Nemesis Weekly Snapshot Widget — *Impact 4 / Effort XS / Readiness 90%*
`getWeeklyComparison` already exists. Render a side-by-side card on
Dashboard: you vs nemesis on volume / sessions / XP this week, with
"overtake in 240 lbs" countdown. **~4 hrs.**

### S9. HIIT / Interval Timer Presets — *Impact 4 / Effort XS / Readiness 90%*
`RestTimerContext` already exists. Add preset buttons to the overlay:
Tabata (20/10×8), EMOM, 30/30, 40/20, custom. **~4 hrs.**

### S10. Deload-Week Detection Toast — *Impact 4 / Effort XS / Readiness 90%*
`detectImplausibleWorkout` + fatigue infra already analyze volume
trends. Extend to suggest a deload when weekly volume > 2σ above
4-week rolling avg for 3+ weeks. Soft toast on save. **~4 hrs.**

### S11. Follow Notifications in the Bell Center — *Impact 4 / Effort XS / Readiness 95%*
`NOTIFICATION_TYPES.FRIEND_FOLLOW` already exists;
`hubFollows.follow()` already fires `notifyFriendFollow()`
fire-and-forget. The bell panel just doesn't display them distinctly.
Add row template + follower-count badge to Hub header. **~50 LOC, ~2 hrs.**

### S12. Message Read Receipts UI — *Impact 4 / Effort XS / Readiness 95%*
`read_at` column is already populated in `hubMessages`; localStorage
tracking is in place. UI just doesn't render the checkmark or "seen
at" time. **~75 LOC, ~3 hrs.**

### S13. "Your Rank: #N" Badge on Leaderboards — *Impact 4 / Effort XS / Readiness 100%*
All users are already fetched in `LeaderboardsContent.jsx`; current
user is available via `useAuth()`. Find the row, render a sticky
badge above the podium with a highlighted "you" row deeper in the
list. **~60 LOC, ~2 hrs.**

### S14. Coach Voice Input (Web Speech API) — *Impact 4 / Effort XS / Readiness 95%*
`CoachChat.jsx` has message flow; `responders.js` has all the logic.
Add a mic icon next to send → `SpeechRecognition` → transcribe →
existing send path. **~100 LOC, ~4 hrs.**

### S15. Post Share Button (Web Share API) — *Impact 4 / Effort XS / Readiness 95%*
Posts have deep-link URLs (`?profile=<email>`). Add a share icon to
`HubPostCard` using `navigator.share()` with `navigator.clipboard`
fallback. Massive virality unlock for ~80 LOC. **~3 hrs.**

### S16. Story Reactions (Emoji) — *Impact 4 / Effort XS / Readiness 85%*
`story_likes` table + reaction patterns from post comments already
exist. Add `story_reactions` table + RLS, reuse the comment-reaction
picker in `StoryViewer.jsx`. **~100 LOC, ~5 hrs.**

---

## A-Tier — High impact, 2–5 days of work

### A1. Built-in Program Templates (5/3/1, PPL, Starting Strength, nSuns, GZCLP)
Regimen system supports supersets/circuits already. Ship 6–8 canonical
programs as seeded `regimens` with `is_template = true`. Huge for
new-user activation; today users build from scratch or fork community
junk. **~3 days.**

### A2. Apple Health / Google Fit Integration
PWA limitation, but you can ingest CSV/share-sheet exports today, and
add a Capacitor wrapper later. Pull sleep/HRV/steps/active calories
into Dashboard recovery score. Massive moat. **~5 days** for
read-only import path.

### A3. Readiness Score (Composite Dashboard Card)
Combines sleep (S6), mood (S7), workout fatigue (existing), days since
last workout, soreness (new 1-tap). Score 0–100 → recommends "go
hard / maintain / deload / rest". Drives daily decisions. **~3 days**
once S6+S7 land.

### A4. Custom-Created Bounties
Today bounties are auto-generated. Let users post bounties on
themselves ("first to beat my 315 squat wins 100 coins"). Reuses
existing bounty data model + RPC. Drives social engagement loop.
**~4 days.**

### A5. Live Workout Sessions (Spectate + Cheer)
Crews + DMs exist; capsules + coins for cheer reactions. A user "goes
live" during a session → followers see live volume tick up, can send
🔥 reactions that play a haptic + sound in the lifter's overlay.
**~5 days** w/ Supabase realtime.

### A6. Voice-Logged Workouts ("alexa-style" hands-free)
Browser Web Speech API. "315 by 5" → autocomplete the active set.
Massive UX win for gym phones. RestTimerOverlay already has voice
cues, so audio infra is proven. **~4 days.**

### A7. Photo-AI Meal Recognition
You have barcode scanning + USDA already. Add a "take photo of plate"
button → Anthropic Vision (or Gemini/OpenAI) returns macros estimate.
Drops nutrition logging friction to zero. **~3 days** w/ Claude API.

### A8. Coach-Mode (Trainer Profiles)
Marketplace already sells, RPCs proven. Add a `is_coach` role: coach
assigns workouts to clients, reviews submitted logs, comments on form
videos (Form Coach already records). Monetization path. **~5 days.**

### A9. Crew Wars (Team-vs-Team Duels)
Duels engine + Crews both exist. Combine: crew A vs crew B for 1
week, total volume wins. Crew leaderboard. **~4 days.**

### A10. Referral Program
Hub follows + capsule rewards both exist. Generate per-user referral
codes; when referee hits first workout, both get a premium capsule.
Cheap viral loop. **~3 days.**

### A11. Onboarding Skill Assessment + Personalized Plan
You ask goal already. Add a 4-question lift estimate ("can you bench
your bodyweight?"), then auto-generate a 4-week starter regimen via
existing `WorkoutGeneratorModal`. Dramatically improves D1 retention.
**~3 days.**

### A12. Push-Notification Categories + Quiet Hours
`push-sw.js` exists, `timezone_offset` already on profile. Add user
toggles for: PRs, duels, bounties, nemesis, crew, marketing. Plus a
22:00–07:00 quiet window per user TZ. Required before scaling pushes.
**~3 days.**

### A13. Crew Roster + Crew Goals
`getCrewMembers()` + `setAdmin()` RPCs exist; admin check is simple.
Build `CrewMembersSheet.jsx` (member list, join date, admin badge,
promote/remove). Then layer a `crew_challenges` table (target,
end_date, type) + `CrewChallengeCard.jsx` into the crew chat view.
The crew battle scaffolding is already in `crewWars.js`. **~5 days.**

### A14. Time-Window Leaderboards (Weekly / Monthly / Season)
Leaderboard fetching exists; add `?period=weekly|monthly|alltime`
toggle, recompute from cached workout/cardio aggregates. Pairs with
S13 personal-rank badge. **~3 days.**

### A15. Onboarding V2: Injury History + Body Baseline + Fitness Test
Today onboarding captures goal + level + height/weight. Add: (1)
optional injury history rows (already-built `InjuryForm` works), (2)
body baseline (the 7 measurements + body fat % field from
`BodyMetricsTab`), (3) 4-question lift-estimate self-test (bench
bodyweight? squat bodyweight? mile time? plank duration?). Feeds
`buildStarterRegimen()` for a dramatically better day-1 plan.
**~4 days.**

### A16. Profanity & Moderation on Post Content
Today `containsProfanity()` only runs on usernames. Extend to post
bodies, comments, stories, and crew names. Add a `flagged_at` column
+ simple moderator view. **~3 days.**

### A17. In-App Notification Center (Dedicated Tab)
Notifications fire via the bell, but there's no full history view.
Add a `/notifications` route with tabs: All / Social / Achievements /
Marketplace / System. Reuses `notifications.js`. **~3 days.**

---

## B-Tier — Strong impact, 1–2 weeks

- **B1. Wearable Integration** (Whoop/Garmin/Oura) — after A2, OAuth + token refresh via Edge Functions.
- **B2. Form Coach Expansion** — row variants, RDL, lunges, pull-up, dip, OHP, hip thrust + save 5-sec clip.
- **B3. Meal Planning + Grocery List Generator** — weekly planner grid → exportable PNG (reuse debrief html2canvas pattern).
- **B4. Period / Cycle Tracking + Training Adaptation** — phase-aware workout suggestions, opt-in only.
- **B5. Restaurant / Chain Nutrition Search** — Spoonacular has it; just surface.
- **B6. Achievement Reveal Engine** — queue cinematic unlocks (PR → streak → quest → capsule).
- **B7. Streaks: Freezes, Recovery, Visual Calendar** — heatmap + 1-use-per-month freeze. #1 churn driver.
- **B8. Seasonal Themes / Epoch Cosmetics** — debriefs already tag `epoch_id`; bundle cosmetics per epoch.
- **B9. Public Profile Polish** — top 3 lifts, total tonnage, longest streak, achievements wall on HubProfile.
- **B10. Smart Plate Calculator + Bar Inventory** — per-gym bar weight, "per-side" plate breakdown.
- **B11. Workout Templates from Today's Session** — "save this session as a template?" after logging.
- **B12. Coach AI Memory + Long-Context Profile** — last 4 wks of training + injuries + sleep into Coach; Claude prompt caching (~90% cost cut).
- **B13. Story Highlights** — `story_highlights` table mapping story_id → album; pin to profile.
- **B14. Message Reactions, Typing Indicators, Quote-Reply** — Supabase Realtime is already in the stack.
- **B15. Magic-Link Auth + Social Sign-In Buttons** — Supabase auth supports it; UI doesn't expose Google/Apple/email-link.
- **B16. iOS A2HS Walkthrough + Background Sync** — detect iOS Safari, show share-sheet card; register `sync` events for offline post queueing.
- **B17. Referral Link with Tracking** — `?ref=<code>` parameter surviving onboarding, credits both on first workout.
- **B18. Live Crew Battle Score** — Supabase Realtime push for live crew bar updates.

---

## C-Tier — Worth doing, but pricier (2–4 weeks)

- **C1. Music Integration** (Spotify/Apple Music) — intensity-aware playlist; heavy OAuth.
- **C2. Gym Check-In + Crowd Density** — needs network density to work.
- **C3. Form Coach Trainer Review Marketplace** — coaches review form clips for a fee; capsule escrow via existing market RPCs.
- **C4. Workout Generator V2 (Periodization-Aware)** — mesocycle phases, auto-progression rules.
- **C5. Adaptive Regimen ("auto-pilot")** — mutates each week based on RPE + readiness + missed sessions.
- **C6. Mental Wellness Suite** — meditation timer, breathwork, journaling as a unified surface.
- **C7. Recipe Builder + Macro Calculator** — compose meals, save recipes, log in one tap.
- **C8. Crew Voice Chat / Walkie-Talkie** — WebRTC for synced crew workouts.
- **C9. Workout Difficulty Heatmap** — per-exercise difficulty curve by demographics.
- **C10. NFT-Adjacent Verifiable Achievements** — cryptographically signed badges; compliance heavy.

---

## D-Tier — Big bets / aspirational / high risk

1. **Native iOS/Android wrappers (Capacitor)** — unlocks HealthKit, background sync, Live Activities, widgets, watchOS complications. **Mandatory for serious wearable integration.**
2. **VR/AR form coaching (Vision Pro / Quest)** — feasible but tiny TAM today.
3. **Computer-vision body composition from progress photos** — accuracy claims dangerous.
4. **Live multiplayer "follow-along" classes** (Peloton-style).
5. **Real-world tournament platform with cash prizes** (compliance heavy).
6. **Genetics / DNA-based training recommendations** (partner play).
7. **Glucose monitor (CGM) integration.**
8. **AR mirror for live form overlay in the gym** (Snap Spectacles).

---

## Quick-win bundle ("Week 1 push")

If you ship **S1–S5 + S8 + S9 + S10 + S11 + S12 + S13 + S15** in a
sprint, you get:
- A logger that finally celebrates wins (S1, S3)
- A logger that shows history without leaving the screen (S2)
- A dashboard that closes the recovery + competition + hydration loops (S5, S8)
- A timer that handles HIIT (S9)
- An intelligence layer that warns when you're overdoing it (S10)
- A social layer that closes the basic feedback loop: follow notifications, message read receipts, personal rank, share buttons (S11–S13, S15)

That's roughly **5 engineering days** of work for a "the app got way
better this week" feel — all on existing infra.

**Week 2:** S6 (sleep) + S7 (mood) + A3 (readiness score) + S14
(voice coach) + S16 (story reactions) — ships the recovery story
end-to-end plus a richer social surface.

**Week 3:** A1 (built-in programs) + A11 (smart onboarding) + A15
(onboarding V2) + A12 (notification categories + quiet hours) —
turns first-run into a moat and protects you from notification fatigue
as you scale.

---

## Easiest seven from S-tier (no DB migrations required)

For the first sprint, see [`quick-wins-spec.md`](./quick-wins-spec.md)
for the detailed implementation brief.

| # | Item | Effort |
|---|---|---|
| 1 | S3. Live 1RM Estimator + PR Bar | ~2 hrs |
| 2 | S13. "Your Rank: #N" Badge | ~2 hrs |
| 3 | S11. Follow Notifications in Bell | ~2 hrs |
| 4 | S5. Hydration Ring on Dashboard | ~3 hrs |
| 5 | S15. Post Share Button | ~3 hrs |
| 6 | S12. Message Read Receipts UI | ~3 hrs |
| 7 | S1. PR Auto-Celebration Modal | ~3 hrs |

---

## Critical files referenced

**Training:** `src/pages/Workout.jsx`, `src/lib/data/workouts.js`,
`src/lib/RestTimerContext.jsx`, `src/lib/workoutFatigue.js`,
`src/components/regimens/ExerciseAutocomplete.jsx`,
`src/lib/data/regimens.js`, `src/lib/data/gauntlet.js`,
`src/lib/data/duels.js`, `src/lib/data/bounties.js`,
`src/lib/data/nemesis.js`,
`src/components/formcoach/FormCoachModal.jsx`,
`src/lib/formCoach/analyzeForm.js`, `src/lib/xpSystem.js`

**Wellness/Dashboard:** `src/pages/Dashboard.jsx`,
`src/components/dashboard/*`, `src/pages/Progress.jsx`,
`src/components/progress/*`, `src/pages/Nutrition.jsx`,
`src/components/nutrition/*`, `src/lib/data/goals.js`,
`src/lib/data/injuries.js`,
`src/components/debrief/DebriefVault.jsx`,
`src/lib/data/capsules.js`

**Infra to reuse:** `src/lib/firstWorkoutCelebration.js` (+ siblings),
`src/lib/reportError.js`, `src/api/safeSelect.js`,
`src/api/db.js` (`updateMe`, `makeEntity`),
`src/components/ErrorBoundary.jsx`

---

## How to verify a given feature lands

1. `npm run lint && npm run test && npm run build` — must be clean.
2. Manually exercise the golden path in dev (`npm run dev`).
3. Confirm celebration helpers fire with their unique haptic/confetti
   signature (see CLAUDE.md "Celebration system" table).
4. Use `safeSelect` for any new `.select()` with explicit columns.
5. New async catches use `reportError(err, { feature: 'x.y' })`.
6. Wrap any new page/region in `<ErrorBoundary label="...">`.
7. Add i18n keys with at minimum English + `t(key) || 'fallback'` at
   the call site.
