# Flexyn — Product Overview

A self-contained brief for brainstorming sessions. Paste the whole
file into a fresh Claude chat (or upload it to a Claude Project) and
you're set — no other context needed.

---

## What Flexyn is

A fitness companion PWA that combines workout tracking with social,
gamification, and (newly) a national network of physical gyms. The
core loop is: log workouts → earn XP + capsules + cosmetics → climb
leaderboards (friend / global / gym / league) → post to the Hub feed
→ get reactions + emoji from friends + your gym's local community.

Five top-level routes (Dashboard, Workout, Hub, Progress, Nutrition)
plus four hoisted destinations (Messages, Market, Coach, Onboarding)
and now a gym sub-ecosystem (/my-gym, /gym/:id, /gym-map,
/register-gym, /admin/gyms). 15 supported languages. iOS / Android /
desktop installable PWA.

---

## Tech stack (so future chats can ground answers)

- React + Vite, Tailwind, Radix UI, Framer Motion
- Supabase (Postgres + Auth + Storage + Edge Functions + Realtime)
- TanStack Query for data
- date-fns
- MapLibre GL (free OpenFreeMap tiles or MapTiler with key)
- @zxing/browser for barcode + QR scans
- qrcode for owner gym signage
- Sentry for error tracking
- Workbox for PWA / service worker
- TF.js + MoveNet for the Form Coach (4 lifts today)
- Anthropic API for the AI Coach + photo-AI meal recognition (Vision)

---

## Major feature surfaces

### Workout
Workout logger with sets/reps/weight + cardio. 400+ exercise library
with autocomplete. Rest timer with voice cues. Regimens (user-built +
community templates + supersets/circuits/fork count). Form Coach
(MoveNet, 4 lifts). Gauntlet (10-challenge path + weekly community
gauntlet). Duels (mirror / open / exercise). Bounties (auto + user-
created). Nemesis (AI-matched rival). PR tracking with celebration +
share card. Workout share card.

### Cardio
Logging with HR, cadence, splits, power, elevation. Indoor + outdoor
GPS modes. Cardio templates. Cardio goals. VO2max estimate.

### Wellness
Sleep log, mood log, hydration ring, recovery score, readiness card.
Cycle tracking (opt-in, owner-only RLS).

### Nutrition
Manual log + barcode scanner (@zxing). USDA + Spoonacular + community
foods. Macros + micronutrients. Net carbs. Meal plans + weekly grid +
grocery list export. Recipe builder. Intermittent fasting tracker.
Photo-AI meal recognition (Claude Vision via the recognize-meal
Edge Function).

### Hub / Social
Posts (text, workout, meal, repost, poll, video), comments with
@mentions and threading, post reactions (like/dislike + emoji
reactions on top), stories with overlays / reactions / highlights,
DMs (text, voice memos, GIFs via Tenor, stickers, reactions, typing,
quote-reply, scheduled send, message requests, pinning), Crews,
Crew Chat with reactions, AI Coach chat, follow suggestions, profile
pages with QR + share, profile completion meter, Crews + Crew Wars.

### Gamification
XP curve through L100. Capsule rewards (standard / premium / elite)
with transparency on rarity odds. Loot catalog modal (titles, frames,
themes, stickers). Daily quests. Weekly + monthly leagues. Streaks
(login + workout) with calendar grid, streak freezes, milestone
celebrations + confetti. Achievements (workout, cardio, nutrition,
regimen, goal, milestone). Peer-to-peer coin gifting.

### Map + Gym ecosystem (the most recent buildout)
- Verification queue → admin approves → 8-char Flexyn Code minted
- Per-gym hub: feed (reactions + comments + pinned + image upload),
  events with going / maybe / cant RSVPs, member leaderboard, About
  card (hours / amenities / photo gallery)
- Member directory modal
- National map (MapLibre, free tiles), debounced bbox queries,
  search by name/city, 25 demo gyms seeded across US metros
- QR scanner for the join-by-code flow
- Owner printable signage (QR + code on quarter-page poster)
- "My Gym" — one page for the gym you train at (leaderboard +
  community progress) and every gym you've joined. /my-gyms was
  folded into it on 2026-08-09 and redirects there.
- Owner edit-gym surface (logo / cover / description / hours /
  amenities / gallery / contact info / map pin)
- Push notification to owner on member join

### Marketplace
Player-to-player regimen + sticker sales. Star ratings + reviews.
Trade history. Seller profile link. Filters by muscle group /
difficulty. Bundles. Featured weekly slot. Wishlist.

### Settings / Account
Magic-link sign-in, Apple + Google OAuth, 2FA status, data export,
connected apps, privacy mode (hide from non-followers / search),
per-category push toggles + per-category snooze + quiet hours,
haptics + sounds, app update prompts.

---

## Recent shipping waves (chronological, May 2026)

Each "wave" is one product theme shipped over a handful of commits.

- **Wave M** — gamification + social engagement (coin gifting, emoji
  reactions on posts, story highlights wired)
- **Wave N** — onboarding handoff (AI Coach starter-plan hero card on
  Workout, first-workout coach-mark tutorial)
- **Wave O** — polish primitives (inputMode="decimal" everywhere,
  useAutofocusOnOpen hook, TapToCopy, AnimatedNumber, ProfileCompletionMeter,
  EmptyState rollout, weight-stepper buttons)
- **Wave P** — time-window leaderboards + AnimatedNumber rollout +
  i18n session-strings file
- **Wave Q** — emoji reactions on posts (migration 126), magic-link +
  Apple sign-in, per-category notification snooze (migration 127),
  story highlight album viewer
- **Wave R** — DM polish (already-existing), weekly meal-planner grid
  with grocery list PNG export, period/cycle tracking (mig 128)
- **Wave S** — profile share artifact, onboarding skill assessment
  (mig 129), swipe-to-delete hook, Photo-AI meal recognition,
  pull-to-dismiss hook
- **Wave T** — trivial polish (date test fixes, NotificationBell
  bounce, AnimatedNumber + TapToCopy rollout)
- **Wave U** — gym foundation: schema + lib (mig 135), Register Gym,
  My Gyms, Gym Hub, national map, admin verification dashboard
  (My Gyms merged into My Gym, 2026-08-09)
- **Wave V** — discover, admin, QR scan, printable signage
- **Wave W** — owner edit, leave gym, share gym, member-join
  notifications (mig 136)
- **Wave X** — 25 demo gyms seeded (mig 137), map polish (debounce,
  cluster sizing, search, count pill), non-member preview on Gym Hub,
  near-you discovery rail
- **Wave Y** — gym social home page: post reactions + comments +
  pinned posts + image upload (mig 138), event RSVPs (mig 139),
  member directory modal
- **Wave Z** — Gym About surface: hours, amenities, photo gallery
  (mig 140)

---

## What's NOT shipped (the brainstorming surface)

Pulled from earlier audits. Some of these are quick (under a day),
some are multi-week. Categorized:

### Quick (under a day)
- Past vs upcoming event split on Gym Hub
- Trending gyms / discovery rail on the map page
- Gym member badge on user's hub profile
- Gym-vs-gym leaderboard (total volume across all member workouts)
- @-mention members inside gym feed posts
- Optional join-request approval flow (owner toggle)
- Recent search history on food search
- Restaurant lookup UI
- Calorie cycling UI (backend exists, no UI)
- Mutual followers indicator on hub profiles
- Shareable flexyn.app/@username profile link
- Share post to DM (forward post)
- Story expiry countdown UI
- Message search within a conversation
- Conversation mute + archive
- Crew Chat message reactions
- Gradient avatar fallback (deterministic by name)
- Theme picker preview before applying — note the picker itself is currently
  disabled (`THEMES_ENABLED = false`, `src/lib/featureFlags.js`); it renders
  as "Coming soon". A preview is only worth building once themes are back on.

### Medium (1–3 days)
- Trending hashtags / exercises
- Poll results timeline chart
- TDEE estimate
- Muscle imbalance analysis
- Overtraining warning push
- Projected goal completion date
- Gauntlet Season 2 path
- Monthly league as dedicated track
- Limited-time / seasonal shop items
- Crew announcements pinned + crew shared workout plans
- Onboarding V2 — injury history step
- Onboarding V2 — body baseline step
- Story music / soundtrack

### Big (3+ days each)
- Apple Health / Google Fit import
- Wearable OAuth (Whoop / Garmin / Oura)
- Coach-mode (trainer profiles, assign workouts, review form videos)
- Form Coach expansion beyond 4 lifts (with save/review clips)
- Periodization-aware workout generator
- Adaptive regimen "auto-pilot" (week-over-week mutation)
- Coach AI memory + prompt caching
- Live workout sessions (go-live + spectate + cheer)
- Video / audio calls in DMs
- In-workout music mini-player

### Aspirational (1–2 weeks+ each)
- Music integration (Spotify / Apple Music)
- Form-clip trainer-review marketplace (depends on Coach-mode)
- Mental wellness suite (meditation / breathwork / journaling)
- Live multiplayer follow-along classes (Peloton-style)
- Native iOS/Android wrappers (Capacitor — unlocks HealthKit, Live
  Activities, widgets, watchOS)
- CGM integration
- Genetics-based training recommendations

### Deploy tasks (not code)
- Push notifications activation — VAPID keys, function deploy,
  `app.send_push_url`
- Weekly Debriefs activation — cron secret, function deploy
- i18n native-speaker pass for Arabic / Chinese / Russian (~128 keys)

### Known debt
- Hub bio profanity check is client-only on non-username fields
  (migration 054 does cover bio; username has its own trigger)
- `is_active` regimen UI shipped but column wasn't always read
- LocationStep onboarding was deleted; country/state collection
  pending product decision
- The 25 demo gyms have `Demo:` name prefix — delete with
  `DELETE FROM gym_businesses WHERE owner_id IS NULL AND name LIKE 'Demo:%'`
  once enough real gyms register

---

## Design opinions worth knowing

- **Celebration vocabulary is sacred**: there are 6 distinct
  celebration helpers (firstWorkout, firstRegimen, firstGoal,
  firstMeal, goalComplete, prCelebration), each with its own
  haptic + confetti signature. Adding a 7th gets its own pattern;
  never reuse another's signature.
- **Build guards in vite.config**: MISSING_EXPORT and
  UNRESOLVED_IMPORT are *errors*, not warnings. Production crashed
  once because a stale import slipped through silently; the guard
  exists so it never does again.
- **TDZ trap**: useEffect deps arrays read const-bound names
  synchronously. Declaring `const { user } = useAuth()` AFTER a
  useEffect that references `user` in its deps array is a
  ReferenceError in minified production builds even though dev mode
  swallows it. Always declare hooks high.
- **Failure modes**: every RPC wrapper falls back to a sensible
  empty value (`[]`, `null`, `{ok: false}`) on `42883`/`42P01` so
  the UI degrades gracefully when a migration isn't deployed.
- **Migrations are idempotent** by convention: `CREATE TABLE IF NOT
  EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS` +
  `CREATE POLICY`, `INSERT ... ON CONFLICT DO NOTHING`. Re-running
  the deploy bundle should never break anything.
- **i18n discipline**: 15 languages with native-quality translations.
  Don't ship machine-translated copy on prominent surfaces; use
  `tFallback('key', 'English fallback')` so missing keys gracefully
  degrade to readable English.
- **Push pipeline + Weekly Debriefs + Photo-AI Edge Function** are
  built but each needs one-time secrets configured in Supabase
  before they actually deliver. The code paths are dormant until
  then but don't crash.

---

## Common brainstorming prompts to start with

Pick one of these to seed a session:

1. "Look at the gym ecosystem (Waves U–Z). What's the #1 missing
   feature that would make this feel less like a beta?"
2. "I'm pitching this app to investors. What's the strongest 30-second
   demo flow?"
3. "Pick three quick-wins from the brainstorming surface above that
   would compound the most with what's already shipped."
4. "What user persona is this app failing? Where would they drop off?"
5. "If I had to cut Flexyn down to 5 features for a v1 launch, which
   stay, which go?"
6. "Rewrite my onboarding for a casual gym-goer who's never used a
   tracker before."
7. "What's the right monetization model — coach-mode subscription,
   gym owner tier, ads, or capsule-only? Argue all four."
