# Flexyn — Complete Feature Inventory

Every feature, surface, screen, button, toggle, and background system in
the app. Built by sweeping `src/pages`, `src/components`, `src/lib`,
`src/lib/data`, `src/hooks`, `src/api`, `supabase/migrations` (279) and
`supabase/functions` (6).

**No prioritization here on purpose.** Items are numbered so they can be
sorted into tiers later. Numbering is per-section (`W1`, `H1`, …) so
inserting an item never renumbers the rest.

Legend on the few non-obvious status marks:
- `[shipped]` — live and working (default; omitted)
- `[dormant]` — code exists, nothing calls it or it's flag-gated off
- `[stub]` — placeholder / "coming soon" UI

---

## 0. App shell, navigation & chrome — `SH`

| # | Feature |
|---|---|
| SH1 | Five-tab bottom nav: Dashboard, Workout, Hub, Progress, Nutrition |
| SH2 | Hub tab rendered as a center "FAB" ring, visually distinct from the other four |
| SH3 | Per-user nav color override on the Hub ring (purple for `kegan`, blue for `sean`) |
| SH4 | Bottom nav auto-hides on scroll-down, snaps back on scroll-up (6px jitter threshold) |
| SH5 | Nav visibility resets to visible on every route change |
| SH6 | Haptic pulse on every tab tap |
| SH7 | Re-tapping the active tab resets that section to its root (closes sub-views/modals, scrolls to top) |
| SH8 | Re-tap also fires a `flexyn:active-tab-retap` event so feeds can treat it as a refresh |
| SH9 | Long-press (400 ms) any tab → quick-action popover, anchored above that exact tab |
| SH10 | Quick actions — Workout: Quick log / Open cardio / Open goals |
| SH11 | Quick actions — Hub: New post / Search users |
| SH12 | Quick actions — Progress: Log weight / Add photo |
| SH13 | Quick actions — Nutrition: Log meal / Scan barcode / Add water |
| SH14 | `···` dot affordance under tabs that have a quick-action menu |
| SH15 | One-shot tooltip teaching the long-press gesture ("Hold any tab for shortcuts") |
| SH16 | Unread dot on the Hub tab when a followed user posts something new; clears on visiting Hub |
| SH17 | Desktop sidebar (lg+): logo, profile menu, AI Coach / Messages / Notifications / Marketplace buttons, nav list, language picker |
| SH18 | DM unread count badge (9+ cap) on Messages icon, sidebar + header |
| SH19 | Red dot on the Marketplace icon when today's daily chest is unclaimed |
| SH20 | Fixed mobile header: logo (home) or back-arrow + page title on child routes |
| SH21 | Header title override channel (`flexyn-title` event) used by Cardio mode |
| SH22 | Pull-to-refresh on the whole app shell |
| SH23 | Floating back-to-top button after ~2 screen-heights of scroll |
| SH24 | Animated route transitions (Framer Motion, per-route keyed) |
| SH25 | Global bag + capsule-opener mount (single instance, opened from anywhere via event) |
| SH26 | `last_active_at` presence heartbeat, once per session per day |
| SH27 | Safe-area insets respected (iOS home indicator, notch) |
| SH28 | Keyboard-inset hook so composers sit above the on-screen keyboard |
| SH29 | Network status chip (offline/online) |
| SH30 | Launch splash + splash screen route |
| SH31 | Page-not-found route |
| SH32 | Hidden easter egg: tap header logo 7× → confetti barrage + random toast |

---

## 1. Onboarding & auth — `ON`

| # | Feature |
|---|---|
| ON1 | 14-step onboarding flow: welcome → goal → sharpen → experience → age → height → weight → body baseline → days → assessment → injury history → home gym → loading → reveal |
| ON2 | Cinematic hero slideshow (5 feature slides: AI Coach, Smart Log, Progress, Recovery, Streaks) with custom SVG visuals |
| ON3 | Six selectable goals: Build strength, Add muscle, Lose fat, Run faster, Run further, Move better |
| ON4 | Multi-goal selection (profiles blend rather than collapse to one) |
| ON5 | "Sharpen" step — goal-specific follow-up (race distance 5K/10K/Half/Marathon/General, target times for 1mi/5K/10K) |
| ON6 | Four experience levels with animated bar meters: New / Returning / Consistent / Advanced |
| ON7 | Age, height, weight capture with validation (13+ age gate, realistic ranges) |
| ON8 | Gender selection: Male / Female / Other (feeds starting-weight scaling and cardio emoji) |
| ON9 | Body-baseline step (bodyweight + composition context) |
| ON10 | Training-days-per-week picker |
| ON11 | Four-question fitness self-assessment (bench bodyweight, squat 1.5×BW, 10 strict pull-ups, sub-10-min mile) with Yes / Not yet |
| ON12 | Injury history step with severity tiers (Mild / Moderate / Serious) |
| ON13 | Home-gym picker step (deferred — writes only at final save) |
| ON14 | Animated "loading / building your plan" step |
| ON15 | Reveal step — generated starter regimen presented |
| ON16 | Per-step transition animations (curtain, tilt, flip, flash, iris) |
| ON17 | Auto-generated starter regimen from onboarding answers, saved to Regimens |
| ON18 | Onboarding AI Coach component (`OnboardingCoach`) |
| ON19 | Onboarding error surface (`onboardingErrors.js`) |
| ON20 | 7-day onboarding nudge push sequence |
| ON21 | Onboarding state persisted per device (`flexyn.onboardingState.<userId>`) |
| ON22 | Magic-link email sign-in |
| ON23 | Apple OAuth sign-in |
| ON24 | Google OAuth sign-in |
| ON25 | Guest / anonymous sign-in |
| ON26 | "Sign in to continue" interstitial page for gated public links |
| ON27 | `user_not_registered` and `auth_required` error screens |
| ON28 | Account-deleted screen |
| ON29 | Stashed-token recovery path |
| ON30 | Username picker + profanity check (server-side, migration 050) |
| ON31 | Referral code capture pre-signup (`flexyn.pendingReferralCode`) |

---

## 2. Dashboard — `D`

### Layout & customization

| # | Feature |
|---|---|
| D1 | "Customize home" edit mode |
| D2 | Drag-to-reorder any dashboard row (Framer Reorder) |
| D3 | Hide any section; hidden sections show as "Hidden — tap to restore" chips |
| D4 | Per-section layout toggle: stack full-width vs pair side-by-side |
| D5 | Reset to default layout |
| D6 | Layout syncs cross-device via `user_profiles.dashboard_layout` (localStorage is the fast-paint path) |
| D7 | Admin-only "Save as default layout for new users" |
| D8 | Widget Library — add/remove optional widgets, browsable by category |
| D9 | 10 widget definitions: Exercise Trends, Weekly Volume, Muscle Groups, Personal Bests, Recent Workout, Goals Progress, Workout Streak, Top Exercises, Stats Slideshow, Journal |
| D10 | 6 widget categories: analytics, summary, achievements, goals, motivation, wellbeing |
| D11 | Unknown-widget fallback card ("try removing and re-adding it") |
| D12 | Collapsible "Nutrition & Recovery" group |
| D13 | Collapsible "Your progress" group |
| D14 | Collapsible quick-actions row with show-more/show-less |

### Cards & surfaces

| # | Feature |
|---|---|
| D15 | Hero slideshow (auto-advancing, swipeable, prev/next) |
| D16 | Hero card → Start workout CTA |
| D17 | Resume-workout banner for a paused session (+ discard with tap-to-confirm) |
| D18 | Stories row (top of Dashboard) |
| D19 | Login streak banner |
| D20 | Workout streak banner |
| D21 | Streak calendar grid (show/hide toggle, "You trained on this day") |
| D22 | Streak rescue card — one-tap save on a missed day, once per month |
| D23 | Daily chest card ("Free capsule + coins — tap to open") |
| D24 | Daily quests card, expandable/collapsible, per-quest claim, "+N coins claimed!" |
| D25 | Daily quote (rotating), prev/next, editable rotation |
| D26 | Custom quotes modal — add / delete your own quotes, author field, profanity-checked |
| D27 | League card + league standings modal (promotion/demotion zones, "Top N promoted / Bottom N demoted") |
| D28 | Friend leaderboard panel (this week) |
| D29 | Weekly recap card + shareable Weekly Recap PNG card |
| D30 | Workout suggestion card ("Next: …") |
| D31 | Workout memory card ("On this day…") |
| D32 | Goals progress strip |
| D33 | "Goals almost complete" nudge |
| D34 | Readiness card (compact + detail) |
| D35 | Hydration ring (tap → Nutrition) |
| D36 | Mood log card (how are you feeling today) |
| D37 | Sleep log card (hours slept) |
| D38 | Steps log card (manual entry, edit) |
| D39 | Macro ring widget |
| D40 | Calorie progress widget ("cal remaining") |
| D41 | Journal widget (inline day entry) |
| D42 | Discovery cards (rotating suggestions, per-device dismissal with cooldown) |
| D43 | Push opt-in banner (only after first workout) |
| D44 | iOS "Add to Home Screen" install banner |
| D45 | PWA install prompt (non-iOS) |
| D46 | Prestige prompt when eligible |
| D47 | Stat tiles: This week, Volume, Muscle groups — each with vs-last-week trend arrows |
| D48 | Quick actions: Log weight, Add progress photo, My Week, open Goals, etc. |
| D49 | Log Weight modal (unit-aware, sanity warning on odd values) |
| D50 | Progress photo capture modal (camera + flip + close) |
| D51 | Routine calendar modal ("My Week") |
| D52 | Sync status footer (last-updated timestamp, "Synced") |
| D53 | Trophy check on load (auto-celebrates newly earned trophies) |

---

## 3. Workout — `W`

### Session logging

| # | Feature |
|---|---|
| W1 | Free-form workout session builder |
| W2 | Exercise autocomplete over a ~400-exercise library |
| W3 | Per-set logging: weight, reps, completed checkbox |
| W4 | Weight stepper buttons (increase/decrease) + decimal input mode |
| W5 | Bodyweight-exercise detection; "added weight" input instead of absolute |
| W6 | Per-set note field |
| W7 | Per-set overflow menu (delete set, more options) |
| W8 | Mark set done / not done, with haptic |
| W9 | "Complete exercise" one-tap |
| W10 | Superset grouping |
| W11 | Circuit grouping |
| W12 | EMOM 1:00 preset |
| W13 | Tabata 20s / Tabata 10s presets |
| W14 | "Complete group" for a superset/circuit block |
| W15 | Drag-to-reorder exercises within a session |
| W16 | Live volume pill (running session tonnage) |
| W17 | Workout elapsed-time chip |
| W18 | PR proximity bar ("New PR pace") per exercise |
| W19 | Set-input text parsing (`parseSetInput`) — e.g. "100x5" |
| W20 | Voice input for set logging — dictate "100 by 5", "Heard: …" confirmation, stop-listening, mic-permission error handling |
| W21 | Plate calculator modal + plate diagram, bar-weight selector |
| W22 | Configurable barbell inventory (Olympic 45, women's 35, EZ-curl, trap bar, etc.) |
| W23 | "Include bar weight in volume" setting |
| W24 | Workout name field + tag selector |
| W25 | Save workout; discard workout with confirm dialog |
| W26 | Save current session as a reusable template |
| W27 | Repeat last workout (one tap from the last-workout card) |
| W28 | Repeat any past workout from the saved list |
| W29 | Idempotent save / reconcile (migration 142) — no double-logged sessions |
| W30 | Rest timer overlay with voice cues (Web Speech API) |
| W31 | Audio cue on workout complete (spoken) |
| W32 | Gym check-in XP multiplier applied when checked in |
| W33 | Realistic-limits guard (max weight / reps / duration per exercise) |
| W34 | Implausible-workout detection (sets-per-exercise + muscle-group caps) |
| W35 | Deload-opportunity detector |
| W36 | Comeback protocol screen after a long layoff |
| W37 | Injury banner + injury form (severity tiers, synergist muscle exclusion) |
| W38 | Exercise form modal (form cues per lift) |
| W39 | Equipment thumbnail per exercise |
| W40 | Implement picker — record the exact machine/model used (brand + type + model) |
| W41 | Recent-implements memory (leads the dropdown with your real gear) |
| W42 | Equipment photo capture / replace, "Your photo" vs drawn silhouette |
| W43 | Drawn equipment silhouettes (no manufacturer imagery, licence-safe) |
| W44 | Equipment ladder snapping — progressive-overload suggestions land on selectable weights |
| W45 | First-workout coach-mark tutorial (skip / next / dismiss, tip N of M) |
| W46 | Workout saved list with search by name or date |
| W47 | Gym / Cardio sub-tab filter on the saved list |
| W48 | Edit a saved workout (`EditWorkoutModal`) |
| W49 | Workout share card (PNG, purple/fuchsia) — share sheet + download fallback |
| W50 | PR share card (PNG, gold/crimson) |
| W51 | PR celebration (confetti + haptic + toast) on estimated-1RM records |
| W52 | First-workout celebration + first-workout capsule grant (with retry message if the grant fails) |
| W53 | Live session broadcast ("Go Live") from a workout |
| W54 | Pending-workout recovery (crash/refresh restores an in-progress session) |
| W55 | Workout sessions hook with pausable background sync |
| W56 | Workout XP calculation (per-set formula, session caps) |
| W57 | Quest progress emission on save (workout completed, minutes, PRs) |
| W58 | Crew war + crew challenge progress sync on save |
| W59 | Bounty claim progress check on save |
| W60 | Gauntlet progress check on save |
| W61 | Duel progress submission on save |
| W62 | Scheduled workouts — pin a session to a local day + hour; hourly cron reminder; `/workout?scheduled=<id>` deep link loads it |

### Programs, regimens & templates

| # | Feature |
|---|---|
| W63 | Regimens section — create, edit, delete, run |
| W64 | Regimen form with muscle-group selector + exercise autocomplete |
| W65 | Regimen detail view |
| W66 | Built-in program templates (Starting Strength, 5/3/1 Wendler, Push/Pull/Legs, and more) |
| W67 | Program template picker ("Proven programming. Tap a card to get started.") |
| W68 | Workout templates modal (your saved templates) |
| W69 | Regimen template store (community-published regimens) |
| W70 | Regimen store page with difficulty + muscle-group filters |
| W71 | Regimen reviews + star ratings |
| W72 | Regimen fork / adopt ("Adopt") with copy-count tracking |
| W73 | Seed regimen sets from history (`seedRegimenSets`) |
| W74 | Starter plan hero card ("Your starter plan is ready") + customize / remove |
| W75 | Starter plan view |
| W76 | Routines — "My Routine" sheet, today's routine card, routine calendar modal |
| W77 | Crew-assigned regimens (leaders push a regimen to the crew) |

---

## 4. Cardio — `C`

| # | Feature |
|---|---|
| C1 | Four activities: Walking, Running, Cycling, Swimming |
| C2 | Gendered activity emoji (matches the user's onboarding gender) |
| C3 | Mode picker: Running / Walking / Biking |
| C4 | Environment picker: Outside (GPS) vs Stationary / Treadmill |
| C5 | Input picker: manual entry vs live tracking |
| C6 | Live outdoor tracker with GPS (`CardioLiveTrackerOutside`) |
| C7 | Live indoor tracker (`CardioLiveTrackerIndoor`) |
| C8 | Route map rendering of a GPS track |
| C9 | "GPS signal weak" warning state |
| C10 | Auto-pause setting for live cardio |
| C11 | Manual cardio form (duration, distance, calories) |
| C12 | Split/segment logging — add split, remove split, per-split duration + distance |
| C13 | Pace calculation and display (per km / per mi, unit-aware) |
| C14 | Heart-rate capture + HR zones (migration 094) |
| C15 | Cadence, power, elevation fields |
| C16 | VO2max estimate |
| C17 | Cardio PRs |
| C18 | Cardio calorie estimation |
| C19 | Cardio limits / sanity guards |
| C20 | Cardio templates |
| C21 | Cardio goals (with onboarding-set cardio goal) |
| C22 | Planned cardio (`CardioPlanned`) |
| C23 | Cardio saved list + detail modal |
| C24 | Cardio voice coach |
| C25 | Repeat last cardio session |
| C26 | Session recovery dialog ("recover or discard" an interrupted session) |
| C27 | Wearable-sync stub (`CardioWearableStub`) `[stub]` |
| C28 | Cardio XP with its own caps (migration 262) |
| C29 | Distance-unit preference (mi / km) applied everywhere |
| C30 | Running fueling model + pace model (`lib/running/`) |

---

## 5. AI Coach — `AI`

| # | Feature |
|---|---|
| AI1 | Coach chat (`/coach`) — free-form conversation |
| AI2 | Quick-pick workout generator (non-chat path) |
| AI3 | Chat / Generate Workout tab split |
| AI4 | Coach plan card rendering a generated session |
| AI5 | "Schedule it" on the plan card → `scheduled_workouts` |
| AI6 | Save generated plan to Regimens |
| AI7 | Start generated plan live |
| AI8 | Intent classification (`intents.js`) + responders |
| AI9 | Follow-up question generation |
| AI10 | Lightweight markdown rendering in chat |
| AI11 | Voice dictation into the Coach composer |
| AI12 | Clear chat history (with confirm — "erased on this device") |
| AI13 | Conversation persisted per device |
| AI14 | Workout generator with muscle-group balance, equipment awareness, set/rep prescription |
| AI15 | Training modifiers engine — clamped `loadMultiplier` (0.8–1.1), `setsDelta` (±1), `repDelta` (−4…+6), `restDeltaSec` (−30…+60) |
| AI16 | Every modifier writes a human-readable note rendered on the plan card |
| AI17 | Goal-based modifiers, multi-goal averaging |
| AI18 | Nutrition-goal modifiers (cut removes a set, keeps load; bulk adds a set) |
| AI19 | Weekly rate-of-change modifier |
| AI20 | Dietary-restriction / allergen-filtered fuel notes (never names a food you can't eat) |
| AI21 | Age-band modifiers |
| AI22 | Cycle-phase modifier (deliberately weak: ≤5% load, never blocks a session, overridden by the daily check-in) |
| AI23 | Ovulation warm-up cue (ACL/ligament-laxity, not a load change) |
| AI24 | "How do you feel today?" check-in that overrides predicted phase |
| AI25 | Demographic starting-weight scaling (sex, age, activity — upper vs lower body separately) |
| AI26 | Injury-driven muscle-group exclusion passed into the generator |
| AI27 | Both surfaces (quick pick + chat) receive identical context |
| AI28 | Onboarding coach variant |
| AI29 | Disclaimer copy ("not a substitute for a coach if you have injuries") |

---

## 6. Form Coach — `FC`

| # | Feature |
|---|---|
| FC1 | On-device pose analysis (TF.js MoveNet) — no upload, runs on the phone |
| FC2 | Camera view with front/back flip |
| FC3 | Exercise picker (4 supported lifts) |
| FC4 | Rule-based form scoring (`formCoach/rules.js`, `geometry.js`) |
| FC5 | Feedback panel with per-rep cues |
| FC6 | Demo section showing correct form |
| FC7 | Entry point from Dashboard discovery card + Workout page ("Try Form Coach") |

---

## 7. Nutrition — `N`

### Logging

| # | Feature |
|---|---|
| N1 | Manual meal logging (name, calories, macros) |
| N2 | Meal-type picker: Breakfast / Lunch / Dinner / Snack, with auto-pick by time of day |
| N3 | Barcode scanner (@zxing) with multi-orientation decode |
| N4 | Barcode result modal + "not found" modal with add-your-own path |
| N5 | Barcode hints ("rotate a shiny can to cut glare", reads sideways codes) |
| N6 | Torch/flashlight toggle in the scanner |
| N7 | Open Food Facts lookup |
| N8 | USDA + Spoonacular food lookup |
| N9 | Community food items (user-submitted, migration 175) |
| N10 | Save a new food item for reuse |
| N11 | Food-name profanity check |
| N12 | Photo-AI meal recognition (Claude Vision via `recognize-meal` Edge Function) |
| N13 | Food photo capture modal + library picker |
| N14 | Photo-AI result modal with editable macros |
| N15 | Photo-AI daily quota (cap 3/day) + limit modal + owner exemption |
| N16 | Image compression before upload; "too large even after compression" handling |
| N17 | Rate-limit and timeout error states for recognition |
| N18 | Saved meals — save any logged meal, re-log with one tap |
| N19 | Meal history modal + re-log from history |
| N20 | Delete a logged entry; clear all for the day |
| N21 | First-meal celebration |

### Targets, macros & micros

| # | Feature |
|---|---|
| N22 | Calorie top bar (eaten / remaining) |
| N23 | Macro nutrient box (protein / carbs / fat) |
| N24 | Nutrient rings + ring-vs-bar view toggle setting |
| N25 | Minerals & vitamins box (calcium, magnesium, potassium, fiber, cholesterol, …) |
| N26 | Net carbs |
| N27 | Nutrition onboarding modal (goal, TDEE, targets) with base-TDEE display |
| N28 | Nutrition plans modal (preset target plans) |
| N29 | Calorie cycling — separate training-day vs rest-day targets, auto-selected by whether a workout was logged |
| N30 | Calorie cycling per-macro overrides (blank = keep usual goal) |
| N31 | Nutrition trends chart |
| N32 | Nutrition stats: avg cal/day, days logged, meals logged |

### Water, fasting, planning

| # | Feature |
|---|---|
| N33 | Water tracker with per-glass logging + XP |
| N34 | Water bottle icon component + hydration ring on Dashboard |
| N35 | Intermittent fasting tracker — start/end fast, eating-window state, 1–48h duration validation |
| N36 | Recipe builder modal (ingredients, directions, image) |
| N37 | Recipes hub modal — My Recipes / Discover / Most popular tabs |
| N38 | Publish a recipe to Discover |
| N39 | Weekly meal planner grid |
| N40 | Grocery list generation from the planner + copy-to-clipboard |
| N41 | Meal plan day picker |
| N42 | Nutrition tab reorder / customize (same edit-mode pattern as Dashboard) |
| N43 | Admin "save as default nutrition layout" |

---

## 8. Progress — `P`

| # | Feature |
|---|---|
| P1 | Four tabs: Trends, Body, Photos, Insights |
| P2 | Summary tiles: total workouts, days trained (30d), top muscle group |
| P3 | Hero stat row: Streak, Workouts, Volume, Level |
| P4 | Exercise progress cards (per-lift over time) |
| P5 | Grouped exercise trends |
| P6 | Filter by regimen |
| P7 | Filter by time range: 7 / 30 / 90 / 365 days |
| P8 | Filter by muscle group |
| P9 | Muscle-group heatmap (anatomical) |
| P10 | Advanced analytics panel |
| P11 | Insights tab (derived observations) |
| P12 | Training pattern card ("You usually train Mon/Wed/Fri at 6:30 PM") |
| P13 | Workout calendar grid |
| P14 | PR history modal |
| P15 | Body metrics tab — weight, body fat %, and 7 measurements (chest, waist, arms, thighs, …) |
| P16 | Muscle diagram + muscle details modal |
| P17 | Progress photos tab with capture |
| P18 | Photo compare slider (before/after) |
| P19 | Achievements tab |
| P20 | Achievements vault |
| P21 | Estimated 1RM (Epley) surfaced across the app |
| P22 | Progressive-overload suggestions |
| P23 | Training-week aggregation |
| P24 | Workout volume + fatigue computation |
| P25 | Global rank hook |

---

## 9. Goals — `G`

| # | Feature |
|---|---|
| G1 | Goals modal (browse + manage) |
| G2 | Goal form — create strength / cardio / generic goals |
| G3 | Goal timeframes: weekly / monthly / lifetime |
| G4 | Goal progress bars |
| G5 | Goals list |
| G6 | "Almost complete" nudge card |
| G7 | Goals progress strip on Dashboard |
| G8 | Atomic server-side goal completion (migration 030) |
| G9 | Goal completion celebration (confetti + haptic + 🏆) |
| G10 | First-goal celebration (distinct signature) |
| G11 | Goal completion XP reward (100 XP) |

---

## 10. Hub — feed & posts — `H`

| # | Feature |
|---|---|
| H1 | Three feed sub-tabs: Pump (global), Squad (following), Crews |
| H2 | Activity view (likes/follows/comments) in the header corner |
| H3 | Composer — text posts |
| H4 | Composer — workout share (auto-populated from a logged session) |
| H5 | Composer — freestyle workout post |
| H6 | Composer — meal share (name, calories, protein, carbs, fat) |
| H7 | Composer — progress photo post |
| H8 | Composer — video post (50 MB cap, MIME + size validation) |
| H9 | Composer — achievement share |
| H10 | Composer — stats snapshot share |
| H11 | Composer — poll creation (question + ≥2 options) |
| H12 | Content warning selector: No warning / Sensitive content / Graphic injury / Spoiler / Other (specify) |
| H13 | Content warning gate (blur + tap-to-reveal on the card) |
| H14 | Post privacy: Public vs Followers-only |
| H15 | Post reactions (like / dislike) |
| H16 | Emoji reactions on posts (migration 126) |
| H17 | Comments, inline on the card |
| H18 | Threaded replies |
| H19 | @mentions in comments |
| H20 | Comment likes |
| H21 | Repost to your own feed |
| H22 | Save / unsave a post |
| H23 | Save a shared meal straight to your saved meals |
| H24 | Share post (share sheet + copy link) |
| H25 | Edit your own post ("edited" marker) |
| H26 | Delete your own post |
| H27 | Post analytics for the author (views, engagement) |
| H28 | Creator analytics panel |
| H29 | Post view tracking (`hub_post_views`) |
| H30 | On-demand translation of user content ("Translate" / "Show original", "translated from …") |
| H31 | Mute author |
| H32 | Block author |
| H33 | Report post (harassment, hate speech, impersonation, inappropriate, other) |
| H34 | Video autoplay with mute/unmute toggle |
| H35 | Image expand / collapse |
| H36 | Post collaborators (`collaborator_ids`, migration 219) |
| H37 | Realtime feed updates (`hubPostsRealtime`) |
| H38 | Post activity block (who reacted / commented) |
| H39 | Verified-admin badge on posts |
| H40 | Signature trophy shown next to the author name |
| H41 | Equipped title + frame rendered on the author row |
| H42 | Server-side profanity check on post bodies |
| H43 | Atomic post counters (migrations 077, 200) |

---

## 11. Hub — social graph & profile — `HP`

| # | Feature |
|---|---|
| HP1 | Follow / unfollow, "Follow back", mutual "You follow each other" |
| HP2 | Follower + following counts and lists |
| HP3 | Hub profile page (own + others') |
| HP4 | Profile edit — display name, bio, city, avatar |
| HP5 | Avatar uploader + crop |
| HP6 | Avatar gradient fallback (deterministic per user) |
| HP7 | Country picker (full ISO list) on profile |
| HP8 | Profile lift stats (best lifts, est. 1RM, lifetime tonnage, longest streak) |
| HP9 | Profile badge showcase |
| HP10 | Trophy case (show/hide toggle) |
| HP11 | Primary/signature trophy slot ("Slot 1 shows on your profile banner") |
| HP12 | Profile completion meter with actionable prompts (add photo, write bio, add city, share a workout) |
| HP13 | Profile share card (PNG) |
| HP14 | Share profile / copy profile link |
| HP15 | Public profile route `/@username` (works signed-out) |
| HP16 | Profile QR code |
| HP17 | "Training together since {month}" |
| HP18 | Active-now / last-active indicator |
| HP19 | People You May Know rail |
| HP20 | Follow suggestion rail (dismissible, "Hide suggestions for now") |
| HP21 | Recently viewed rail |
| HP22 | Follower activity banner ("N friends joined", "N friends training") |
| HP23 | Live activity rail — friends working out right now |
| HP24 | Live session card + "Go Live" broadcaster |
| HP25 | Friend leaderboard panel (3 sort modes) |
| HP26 | Hub search overlay (users, by name/handle) |
| HP27 | Status notes — short blurb on your avatar in the stories tray, with likes |
| HP28 | Private-profile mode (only followers see level, workouts, photos) |
| HP29 | Hide-from-search mode |
| HP30 | Block list management |
| HP31 | User mutes |
| HP32 | Referral card + referral sheet — invite code, copy link, share, redeem a code, lifetime referral count |
| HP33 | Referral reward: 200 coins + Elite capsule for both parties |
| HP34 | Referral cap / anti-abuse (migration 205) |

---

## 12. Stories — `ST`

| # | Feature |
|---|---|
| ST1 | Stories row on Dashboard + Hub |
| ST2 | "Your Story" / "Add a story" entry |
| ST3 | Photo stories |
| ST4 | Video stories (50 MB cap) |
| ST5 | Story preview sheet before posting |
| ST6 | Text overlays with multiple fonts (Figtree, Caveat, Bradley Hand, Comic Sans MS, Chalkboard SE, Times New Roman) |
| ST7 | Overlay styles: Normal / Bright / Casual / Pixel |
| ST8 | Story overlay renderer |
| ST9 | Story polls with voting |
| ST10 | Story countdown overlay |
| ST11 | Story viewer with tap-through + progress bars |
| ST12 | Story likes |
| ST13 | Story emoji reactions (reaction picker) |
| ST14 | DM reply to a story ("Reply sent!") |
| ST15 | Setting: allow / disallow DM replies to my stories |
| ST16 | Story privacy — default visibility Friends vs Public |
| ST17 | Story highlights — create album, add to album, remove from album, "This album is empty" |
| ST18 | Story highlights rail on the profile |
| ST19 | Long-press a story to add it to a highlight |
| ST20 | Delete your own story |
| ST21 | Report a story |
| ST22 | 24h hard delete (migration 233) |
| ST23 | Stories-row visibility rules (who earns a slot) |
| ST24 | Story viewers list |

---

## 13. Messages / DMs — `M`

| # | Feature |
|---|---|
| M1 | Messages page with DMs / Crews tabs |
| M2 | Inbox / Requests / Archived views |
| M3 | Message requests — accept, delete, block, unsend (with confirm steps) |
| M4 | Auto-accept requests from people you follow (migration 235) |
| M5 | Declined-requests management in Settings ("Allow requests" to re-open) |
| M6 | Conversation search (by name or message) |
| M7 | In-conversation message search |
| M8 | Pin / unpin a conversation |
| M9 | Mute / unmute a conversation |
| M10 | Archive a conversation (per device) |
| M11 | Text messages |
| M12 | Image attachments |
| M13 | Voice memos (record, playback) |
| M14 | GIF picker (Tenor) |
| M15 | Sticker picker + sticker display |
| M16 | Sticker reactions with variants |
| M17 | Emoji reactions on DM messages |
| M18 | Quote-reply to a message |
| M19 | Pin a message to the conversation |
| M20 | Scheduled send (pick a future date/time, cancel a scheduled message) |
| M21 | Delete a message (unsend) |
| M22 | Typing indicators |
| M23 | Delivery status ticks: Sent / Delivered / Read |
| M24 | Read receipts opt-out setting (mutual) |
| M25 | Unread count badge + per-conversation unread |
| M26 | Load earlier messages (pagination) |
| M27 | Group DMs — create group, name it, member list |
| M28 | Crew DM invite card |
| M29 | DM polls |
| M30 | Coin gifting inside a DM (amount presets + custom, 10,000 cap, balance shown) |
| M31 | Trade offer card inside a DM |
| M32 | Message a marketplace seller (deep link into a pending conversation) |
| M33 | Guest-safe DM identity handling (migrations 240/241/244) |
| M34 | Block from a conversation |
| M35 | Conversation date separators ("Today at", "Yesterday at") |

---

## 14. Crews — `CR`

| # | Feature |
|---|---|
| CR1 | Crews section on the Hub |
| CR2 | Crew creation flow (name, avatar, description) |
| CR3 | Crew avatar upload + crop modal |
| CR4 | Crew discovery + suggested-crews rail |
| CR5 | Join requests — approve / decline (leader) |
| CR6 | Crew membership door / seat cap (crew fills up) |
| CR7 | One crew per user (migration 252) |
| CR8 | Leave crew (blocked while a war is live; must promote a new leader first) |
| CR9 | Auto-delete an emptied crew on leave |
| CR10 | Crew page (roster, stats, chat) |
| CR11 | Crew member directory |
| CR12 | Crew member dots (presence) |
| CR13 | Crew chat with message reactions |
| CR14 | Crew stats panel |
| CR15 | Crew league panel + standings |
| CR16 | Crew seasons + divisions (migration 248) |
| CR17 | Crew wars — matchmaking, multi-metric scoring, contribution tracking, resolution |
| CR18 | Crew war panel + battle entry |
| CR19 | Crew war XP clamp (anti-inflation) |
| CR20 | Crew win celebration |
| CR21 | Crew challenges — create (title, metric, target, duration), progress, completion |
| CR22 | Crew challenge server-side progress (migration 246) |
| CR23 | Crew treasury — pooled coins earned from wars and challenges |
| CR24 | Crew perk shop — leader spends the treasury on perks |
| CR25 | Crew-assigned regimens |
| CR26 | Crew push notifications (war started/resolved, challenge created/completed) |
| CR27 | `crew_everyone` broadcast notification |

---

## 15. Gyms & the map — `GY`

| # | Feature |
|---|---|
| GY1 | My Gym page — declare the one gym you actually train at |
| GY2 | Home-gym picker with tap-to-save (no confirm step) |
| GY3 | Nearby gym picker via OpenStreetMap Overpass |
| GY4 | Multi-mirror Overpass fetch with failure-aware error reporting (never renders an outage as "no gyms found") |
| GY5 | Picking an OSM gym promotes it to a persistent community gym |
| GY6 | Gym leaderboard ranked by consistency (active days in the last 7) |
| GY7 | Community progress aggregate (members-only) |
| GY8 | My Gyms page — all gyms you belong to |
| GY9 | Join a gym by 8-char Flexyn code |
| GY10 | QR code scanner for join-by-code |
| GY11 | Gym check-in (+XP multiplier on that day's workout) |
| GY12 | Check-in landing page `/checkin/:code` |
| GY13 | Gym Hub page per gym: Feed / Events / Leaderboard / Equipment / About tabs |
| GY14 | Gym feed with reactions, comments, pinned posts, image upload |
| GY15 | Gym events with Going / Maybe / Can't RSVPs |
| GY16 | Create / delete a gym event (owner) |
| GY17 | Gym About card — hours, amenities, photo gallery, contact |
| GY18 | 20 amenity types (parking, showers, lockers, sauna, steam room, cardio zone, free weights, squat racks, platform, classes, yoga studio, pool, PT, childcare, juice bar, wifi, outdoor space, combat/MMA, climbing, …) |
| GY19 | Member directory modal |
| GY20 | Gym leaderboard tabs: Consistency / Volume / Streak |
| GY21 | National gym map (MapLibre, free OpenFreeMap tiles) |
| GY22 | Debounced bbox queries as you pan |
| GY23 | Three map tiers by shape/color: purple bubble = verified business, grey bubble = community gym, grey teardrop = unclaimed OSM result |
| GY24 | Search gyms by name / city |
| GY25 | 25 seeded demo gyms across US metros |
| GY26 | Register Gym flow (business name, address, lat/lng, capture-my-location) → verification queue |
| GY27 | Admin gyms dashboard — approve / reject verification requests |
| GY28 | 8-char Flexyn Code minted on approval |
| GY29 | Gym Edit (owner) — logo, cover, description, hours, "copy Monday to all days", amenities, gallery, contact, map pin |
| GY30 | Public gym landing page `/p/gym/:id` (signed-out) |
| GY31 | Printable signage kit — multi-page US-Letter PDF, one quarter-page QR poster per sheet |
| GY32 | Gym signage card in-app |
| GY33 | Push to the owner when a member joins |
| GY34 | Leave gym |
| GY35 | Share gym |
| GY36 | Gym equipment tab — the gym's floor, unioned across every member's training space |
| GY37 | Gym equipment editor — add equipment (brand, implement type, series/model, house brand) |
| GY38 | Trust tiers: owner's space authoritative, `verified_by_owner` = blessed member find, rest member-submitted |
| GY39 | Owner controls: "Confirm this is on the floor", "Listed by the gym", remove confirmation |
| GY40 | "N member submission(s) to confirm" badge for owners |
| GY41 | Equipment brand catalog (~25 brands: Life Fitness, Hammer Strength, Cybex, Technogym, Precor, Matrix, Nautilus, Atlantis, Arsenal, PRIME, Panatta, gym80, Watson, Rogue, Eleiko, REP, Titan, Bowflex, PowerBlock, Ironmaster, NÜOBELL, NordicTrack, Force USA, Tonal, Other, Don't know) |
| GY42 | Implement-type catalog (~40 types across machine / cable / free-weight kinds) |
| GY43 | ~50 seed equipment models as a client-side vocabulary |
| GY44 | Home training space (one per owner) for personal gear |
| GY45 | Equipment photos (user-supplied only — never manufacturer imagery) |

---

## 16. Competitive — `CP`

### Duels

| # | Feature |
|---|---|
| CP1 | Duels page — active, history, win/loss/tie record (W / L / TIE) |
| CP2 | Three duel types: Open (most total volume), Mirror (same workout, best completion), Exercise (head-to-head on one lift) |
| CP3 | Create duel against a followed user |
| CP4 | Create duel by shareable invite link (external, works for non-users) |
| CP5 | Duel invite landing page with type explainer + accept |
| CP6 | Duel invite card in DMs |
| CP7 | Configurable duel window (24h / 72h) |
| CP8 | Duel detail sheet with live scoring |
| CP9 | Server-authoritative duel scoring (migration 202) |
| CP10 | Atomic duel submission (migration 079) |
| CP11 | Duel expiry cron (migration 166) |
| CP12 | Duel invite + result push notifications |
| CP13 | Duel trophies (Challenger, Champion) |

### Bounties

| # | Feature |
|---|---|
| CP14 | Bounty board |
| CP15 | Auto-generated bounties from your own records |
| CP16 | User-created bounties (metric, exercise, target value, difficulty, expiry) |
| CP17 | Metrics: weekly volume, session volume, single-lift weight, single-lift reps |
| CP18 | Three difficulty tiers (Easy / Medium / Hard) with scaled rewards |
| CP19 | Pay-to-claim + escrow (migration 205) |
| CP20 | Claim → progress → beat flow, checked on every workout save |
| CP21 | Bounty claim + bounty beaten push notifications |
| CP22 | Bounty economy integrity guards (migration 152) |

### Solo challenges

| # | Feature |
|---|---|
| CP23 | Solo challenges section with Easy / Medium / Hard tiers |
| CP24 | Claim a challenge, track progress, collect reward |

### Gauntlet

| # | Feature |
|---|---|
| CP25 | 10-challenge Gauntlet path with sequential unlocks |
| CP26 | Challenge categories: Single Session, Weekly Volume, Personal Record, Streak, Nutrition, Final Boss |
| CP27 | Submit a score against a challenge |
| CP28 | Gauntlet stats modal |
| CP29 | Weekly community gauntlet card |
| CP30 | Weekly gauntlet reset cron + start-of-gauntlet push fanout |
| CP31 | Server-side gauntlet validation (migration 201) |
| CP32 | Path-completion self-celebration notification |

### Gym Rival (formerly Nemesis)

| # | Feature |
|---|---|
| CP33 | Weekly AI-matched rival ("Find Your Rival") |
| CP34 | Rival card + rival menu on the Workout page |
| CP35 | Challenge types picker |
| CP36 | Accept / decline a rival challenge, AFK confirmation handling |
| CP37 | Weekly settlement — won / lost / draw |
| CP38 | Rival win/loss record |
| CP39 | Overthrow flow + overthrow count |
| CP40 | Cardio Rival variant |
| CP41 | "Find a new rival" |
| CP42 | Opt out of Gym Rival (Settings) |
| CP43 | Rival-assigned push notification |

### Leagues & leaderboards

| # | Feature |
|---|---|
| CP44 | Weekly leagues with six tiers: Bronze, Silver, Gold, Platinum, Diamond, Legend |
| CP45 | Monthly leagues (migration 132) |
| CP46 | Promotion / demotion zones with top-N / bottom-N callouts |
| CP47 | Atomic league resolution + rewards (migrations 027, 067) |
| CP48 | League promoted / demoted / held push notifications, i18n |
| CP49 | Leaderboards modal — all boards |
| CP50 | Regional leaderboards modal |
| CP51 | Global rank |
| CP52 | Friend leaderboard (3 sort modes) |
| CP53 | Gym consistency leaderboard |
| CP54 | Crew league standings |
| CP55 | Time-window / period leaderboards |
| CP56 | Leaderboard podium component |
| CP57 | "Around me" leaderboard slice |

---

## 17. Gamification & economy — `GA`

| # | Feature |
|---|---|
| GA1 | XP system with a tuned curve through Level 100 |
| GA2 | Level bar + animated level-up overlay |
| GA3 | Level-up manager (queued, non-overlapping) |
| GA4 | Level animations toggle in Settings |
| GA5 | XP tiers / tier badges |
| GA6 | Server-authoritative XP (migration 189) |
| GA7 | Per-action, per-day XP rate limits + audit ledger (migrations 188, 198) |
| GA8 | XP rewards for: workouts, cardio, water, goals, regimens created, achievements, milestones |
| GA9 | Level reward schedule (migration 263) |
| GA10 | Flex Coins currency |
| GA11 | Coin ledger with a rolling mint ceiling that clamps over-credits (migration 264) |
| GA12 | Peer-to-peer coin gifting (10,000 cap per gift) |
| GA13 | Coin shop — Standard Capsule (100), Premium Capsule (350), Elite Capsule (1000), Streak Freeze (200) |
| GA14 | "Best value" marker computed from cost-per-epic-or-better |
| GA15 | Server-side price table (client sends only a SKU) |
| GA16 | Capsules — standard / premium / elite rarity ladder |
| GA17 | Capsule opener animation (single + batch open) |
| GA18 | Capsule rarity-odds transparency panel ("{epic}% epic+ · {legendary}% legendary+") |
| GA19 | Pity system — guaranteed rarity after N opens, with personal open history |
| GA20 | Atomic capsule open + server-authoritative rolls (migrations 028, 255, 266) |
| GA21 | Capsule recovery — auto-grants loot that was rolled but never handed over |
| GA22 | Capsule streak card |
| GA23 | Welcome capsule + first-workout capsule (migrations 277/278) |
| GA24 | Milestone/achievement capsules |
| GA25 | Daily chest (once per UTC day) |
| GA26 | Daily Flexyn Drop — 3 deterministic rotating items per calendar day |
| GA27 | Loot catalog: ~60 branded items across common / uncommon / rare / epic / legendary / animated |
| GA28 | 20 unlockable titles |
| GA29 | 11 profile frames |
| GA30 | 27 unlockable app themes (Coral, Mint, Rose, Dusk, Tidal, Nebula, Ember, Aurora, Cyberpunk, Prism, Solar, Jade, Sunset, Arctic, Volcano, Galaxy, Zen, Abyss, Storm, Kingdom, Dragon, Mirage, Summit, Temple, Waterfall, Lunar, Enchanted) |
| GA31 | Collection modal — everything in the game and what you're still missing |
| GA32 | Rarity visuals (per-rarity glow/border treatment) |
| GA33 | User bag / inventory |
| GA34 | Equip title / frame / theme |
| GA35 | 26 achievements across regimen, workout, goal, water, tonnage, cardio, nutrition and scanner categories |
| GA36 | 17 trophies across workout / streak / level / duel / crew / cardio, tiered bronze → legendary |
| GA37 | Signature trophy (primary slot on the profile banner) |
| GA38 | Achievements flow + share-achievement card |
| GA39 | Daily quests — one easy + one medium + one hard, deterministic per user per day |
| GA40 | Quest catalog keyed to 10 action types (meal, water, workout, workout minutes, cardio, cardio seconds, PR, progress photo, hub post, goal) |
| GA41 | Quest coin rewards 8 / 20 / 50, server-enforced (migrations 199, 265) |
| GA42 | Quest expiry warning cron (every 15 min) |
| GA43 | Login streak + workout streak, tracked separately |
| GA44 | Longest-streak records |
| GA45 | Streak freeze item |
| GA46 | Streak rescue (once/month) |
| GA47 | Streak flame component with intensity by length |
| GA48 | Streak-break reminder cron in the user's local 18–21h, 15 languages |
| GA49 | Prestige — reset at L100 for permanent status, 10 tiers with Roman numerals and titles (The Initiated → The Eternal) |
| GA50 | Reward queue — serializes multi-celebration moments so toasts don't overlap |
| GA51 | Particles / theme animation layer |
| GA52 | Six celebration helpers, each with a distinct haptic + confetti signature |

---

## 18. Marketplace & trading — `MK`

| # | Feature |
|---|---|
| MK1 | Marketplace feed |
| MK2 | List an item for sale (stickers, regimens) |
| MK3 | Listing card + item detail sheet |
| MK4 | Buy confirm dialog, atomic purchase RPC (migration 025) |
| MK5 | Cancel a listing (atomic, migration 078) |
| MK6 | Filter bar — muscle group, difficulty, type |
| MK7 | Bundles / bundle deals |
| MK8 | Featured weekly slot |
| MK9 | Wishlist / save-for-later |
| MK10 | "Sold N times" counters |
| MK11 | Star ratings + reviews on regimens |
| MK12 | Seller profile link + "Message seller" |
| MK13 | Recently-viewed listings rail |
| MK14 | Today rail (daily drop block) |
| MK15 | Daily chest block inside the market |
| MK16 | Trade offers — propose an item-for-item swap |
| MK17 | Trade escrow (migration 253) — your item is held, released on cancel |
| MK18 | Trade history page (Pending / Accepted / Declined / Cancelled) |
| MK19 | Cancel offer → release my item |
| MK20 | Trade offer push notification |
| MK21 | Listing profanity check |
| MK22 | Collection browser ("Browse every item") |

---

## 19. Creator / Trainer tier — `TR`

| # | Feature |
|---|---|
| TR1 | Trainer Studio — enable creator mode |
| TR2 | Create / edit / delete listings |
| TR3 | Publish / unpublish to the trainer market |
| TR4 | Sales dashboard: gross sales, your payout, sales count |
| TR5 | Platform-fee split math mirrored client-side |
| TR6 | Stripe payout account linking `[stub — "Real payouts route to your Stripe account once live"]` |
| TR7 | Trainer Market — browse published programs |
| TR8 | Unlock a program (test mode, no charge) |
| TR9 | Already-owned detection |
| TR10 | `checkout-session` Edge Function `[dormant — live payments not enabled]` |
| TR11 | Trainer tier flag on profiles (migration 143) |

---

## 20. Corporate wellness — `CO`

| # | Feature |
|---|---|
| CO1 | Corporate Portal page |
| CO2 | Create an organization |
| CO3 | Join by code; join-code copy |
| CO4 | Seat limits |
| CO5 | Leave organization |
| CO6 | HR/admin dashboard: total workouts, volume lifted, active (7d), workouts (7d), avg streak, active days, participation, hydration, streak days |
| CO7 | Launch a step / workout / streak challenge for the team |
| CO8 | Delete a challenge |
| CO9 | Member-facing challenge view ("Your admin hasn't started a challenge yet") |
| CO10 | Actor dedup for HR aggregates (migration 156) |

---

## 21. Notifications — `NT`

| # | Feature |
|---|---|
| NT1 | Notification bell with unread badge + bounce animation |
| NT2 | Notification panel (slide-in) |
| NT3 | Dedicated `/notifications` page with category filters: Social, Competitive, Achievements, System |
| NT4 | Clear all |
| NT5 | Delete a single notification |
| NT6 | 7 push categories with per-category toggles: streak, quests, league, social, achievements, engagement, competitive |
| NT7 | Per-category snooze: 1h / 4h / 24h + clear |
| NT8 | Quiet hours (do-not-disturb window) |
| NT9 | Push opt-in / opt-out from Settings, with browser-blocked state |
| NT10 | Web push via VAPID (`send-push` Edge Function) |
| NT11 | Batched push fanout trigger (migration 222) |
| NT12 | 410-Gone subscription cleanup |
| NT13 | Streak-break reminder cron (local 18–21h, 15 languages) |
| NT14 | Welcome-back cron (3–30 day churned users, hourly) |
| NT15 | Quest-expiry cron (every 15 min) |
| NT16 | Scheduled-workout reminder cron (hourly, 12h staleness cutoff → `missed`) |
| NT17 | Weekly gauntlet start fanout cron |
| NT18 | Notification types wired to push: streak milestone/break, quest claimed/expiry, league promoted/demoted/held, friend post, friend follow, comment reply, post reaction/like, sticker reaction, trade offer, crew broadcast, PR set, capsule earned, coin milestone, welcome back, weekly gauntlet started, duel invite/result, bounty claim/beaten, crew war started/resolved, rival assigned, rival overthrown, crew challenge created/completed, DM received, memories, referrals, gym member join, report resolution, workout reminder |
| NT19 | `workout_reminder` deliberately unmapped so it always delivers |
| NT20 | 15-language server-side notification text helpers |

---

## 22. Settings & account — `SE`

| # | Feature |
|---|---|
| SE1 | Settings panel (slide-over from the profile menu) |
| SE2 | Toggle: In-app alerts |
| SE3 | Toggle: Workout reminders |
| SE4 | Toggle: Cardio auto-pause |
| SE5 | Toggle: Rest timer |
| SE6 | Toggle: Level animations |
| SE7 | Toggle: Nutrient ring view |
| SE8 | Toggle: Calorie cycling |
| SE9 | Toggle: Cycle tracking |
| SE10 | Toggle: Include bar weight in volume |
| SE11 | Toggle: Haptic feedback (with unsupported-device message) |
| SE12 | Toggle: Sound effects |
| SE13 | Distance unit: mi / km |
| SE14 | Weight unit: lbs / kg / stone |
| SE15 | Theme picker + theme selector (11 base themes + unlocked loot themes) |
| SE16 | Language picker (15 languages) with RTL for Arabic |
| SE17 | Body stats editing: weight, height, age/date of birth, gender — all validated |
| SE18 | Story settings: allow DM replies, default visibility (Friends / Public) |
| SE19 | Privacy: private profile |
| SE20 | Privacy: hide from search |
| SE21 | Privacy: read receipts |
| SE22 | Privacy: opt out of Gym Rival |
| SE23 | Blocked accounts list — add by email, unblock, self-block prevention |
| SE24 | Declined message requests management |
| SE25 | Two-factor authentication (enroll via TOTP, verify, disable) |
| SE26 | Connected apps section: Apple Health, Google Fit, Strava `[stub]` |
| SE27 | "Download my data" full export |
| SE28 | Delete account (typed confirmation) |
| SE29 | Sign out (with confirm) |
| SE30 | Build info footer — tap to copy hash + date + UA |
| SE31 | Twemoji attribution credit |
| SE32 | Profile menu entries: Profile, Settings, Marketplace, My Bag, My Gym, My Gyms, Corporate, Trade History, Admin (role-gated), Sign out, Delete account |

---

## 23. Journal & wellness — `WE`

| # | Feature |
|---|---|
| WE1 | Daily journal — titled entry per day, autosave |
| WE2 | Voice dictation into the journal |
| WE3 | Journal history modal (browse past days) |
| WE4 | Journal mood score (migration 165) |
| WE5 | "Switch to today to write" guard on past days |
| WE6 | Mood logging (Dashboard card + data layer) |
| WE7 | Sleep logging (hours + quality) |
| WE8 | Step logging (manual entry) |
| WE9 | Recovery score — weighted sleep 40% / quality 20% / soreness 25% / recency 15% |
| WE10 | Readiness tiers: Primed / Ready / Moderate / Tired / Depleted |
| WE11 | Readiness hook consumed by the Coach |
| WE12 | Cycle tracker card — log period, edit, delete, duplicate guard |
| WE13 | Cycle phase computation, opt-in only, owner-only RLS |
| WE14 | Hydration tracking + ring |

---

## 24. Weekly Debriefs — `DB`

| # | Feature |
|---|---|
| DB1 | Weekly debrief card |
| DB2 | Debrief vault (past debriefs, lazy-loaded) |
| DB3 | Auto-generated weekly summary via `generateWeeklyDebriefs` Edge Function `[deployed but inert — cron unscheduled, secret unset]` |
| DB4 | Claude-generated insight with a rule-based fallback |
| DB5 | PNG export of a debrief |
| DB6 | `friendRecapEmail` Edge Function |

---

## 25. Moderation & admin — `AD`

| # | Feature |
|---|---|
| AD1 | Report content (posts, comments, stories, users) |
| AD2 | Report reasons: harassment, hate speech, impersonation, inappropriate, other |
| AD3 | Admin Reports page — Content / Bug reports tabs |
| AD4 | Report states: Pending / Reviewed / Actioned / Dismissed |
| AD5 | Delete reported content (with confirm) |
| AD6 | Report-resolution notification to the reporter |
| AD7 | Bug report dialog (in-app) with admin pipeline |
| AD8 | Moderator RPCs + role table (migrations 103, 110, 179) |
| AD9 | Admin role gating (`isAppAdmin`) hiding admin-only UI |
| AD10 | Admin gyms verification dashboard |
| AD11 | Client + server profanity filters (username, bio, posts, comments, listings, quotes, food names) |
| AD12 | Profanity warning dialog |
| AD13 | Verified-user badge system |

---

## 26. PWA, performance & resilience — `RS`

| # | Feature |
|---|---|
| RS1 | Installable PWA (iOS / Android / desktop) |
| RS2 | Service worker with precache + offline shell |
| RS3 | App update prompt on new deploy |
| RS4 | Stale-deploy guard (recovers from missing hashed chunks after a deploy) |
| RS5 | Custom push service worker (`push-sw.js`) |
| RS6 | Write strip-and-retry on missing columns (`db.js`) |
| RS7 | Read strip-and-retry on missing columns (`safeSelect.js`) |
| RS8 | Per-region ErrorBoundaries around every major card |
| RS9 | Route-level ErrorBoundaries on every page |
| RS10 | Error recovery affordances: Go to Home / Try again / Copy details / auto-reset on route change |
| RS11 | Sentry async error capture with feature tags (`reportError`) |
| RS12 | Toast policy — errors always show; success toasts require an action |
| RS13 | Build guards that fail the build on `MISSING_EXPORT`, `UNRESOLVED_IMPORT`, `PLUGIN_ERROR` |
| RS14 | Manual vendor chunking (tfjs, supabase, charts, motion, maplibre isolated) |
| RS15 | Lazy-loaded pages, modals and tabs |
| RS16 | Supabase CDN image transforms (edge resize/recompress) |
| RS17 | Client image compression before upload |
| RS18 | Micro-batcher request coalescer |
| RS19 | Profile cache module with explicit `patchProfile` invalidation |
| RS20 | Scroll position + scroll restoration hooks |
| RS21 | Network status detection |
| RS22 | Delayed-loading hook (no spinner flash on fast responses) |
| RS23 | Optimistic delete hook |
| RS24 | Swipe-to-delete hook |
| RS25 | Pull-to-dismiss hook |
| RS26 | Long-press hook |
| RS27 | Form draft persistence hook |
| RS28 | Body-scroll lock hook |
| RS29 | Autofocus-on-open hook |
| RS30 | Reduced-motion respect throughout |
| RS31 | Storage GC Edge Function |
| RS32 | Account reset filtering (`filterAfterReset`) so pre-reset rows stay hidden |
| RS33 | 2,366 tests across 167 files (vitest + jsdom) |

---

## 27. Design system & primitives — `UI`

| # | Feature |
|---|---|
| UI1 | 45+ Radix-based UI primitives (accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button, card, chart, checkbox, collapsible, context-menu, dialog, drawer, dropdown-menu, form, hover-card, input, label, menubar, navigation-menu, pagination, popover, progress, radio-group, scroll-area, select, separator, sheet, sidebar, skeleton, slider, switch, table, tabs, textarea, toast, toaster, toggle, toggle-group, tooltip) |
| UI2 | BottomSheet |
| UI3 | MobileSelect (native-feel picker on touch devices) |
| UI4 | FormattedNumberInput |
| UI5 | CharCountIndicator |
| UI6 | AnimatedNumber (count-up) |
| UI7 | TapToCopy |
| UI8 | UnitPill |
| UI9 | EmptyState + a set of empty-state illustrations |
| UI10 | OneShotTooltip + tooltip registry (each hint shows once, ever) |
| UI11 | PageHeader |
| UI12 | ThemedScope / theme scoping utility |
| UI13 | Flexyn logo component |
| UI14 | Skeleton loaders throughout |
| UI15 | Twemoji rendering for cross-platform emoji consistency |
| UI16 | Intl helpers — `useNumberFormatter`, `useDateFormatter`, `formatNumber`, `formatDate` |
| UI17 | Relative-date formatting + per-locale date-fns locales |
| UI18 | Pluralization helper |
| UI19 | Text-case helper |
| UI20 | Highlight-matches helper (search result highlighting) |
| UI21 | Safe-URL helper |
| UI22 | Haptic helper with named patterns |
| UI23 | Sound player with a named sound registry |
| UI24 | Download-media helper (share API + download fallback chain) |

---

## 28. Internationalization — `I18`

| # | Feature |
|---|---|
| I18-1 | 15 languages: en, es, fr, de, pt, it, ja, ko, zh, ar, hi, ru, tr, pl, nl |
| I18-2 | ~40 per-domain translation part files, aggregated at build time by `scripts/split-i18n.mjs` |
| I18-3 | `tFallback('key', 'English')` pattern — never renders a raw key |
| I18-4 | RTL support: `dir="rtl"` on `<html>` for Arabic, logical CSS properties across 22 audited files, icon flips |
| I18-5 | Exercise-name translations |
| I18-6 | Muscle-group translations |
| I18-7 | Server-side notification text in all 15 languages |
| I18-8 | On-demand translation of user-generated content |
| I18-9 | i18n check + warn tooling |

---

## 29. Data, security & backend systems — `BE`

| # | Feature |
|---|---|
| BE1 | 279 SQL migrations with a documented runbook + state-check query |
| BE2 | Schema drift audit script |
| BE3 | RLS on every user table |
| BE4 | SECURITY DEFINER RPC layer for anything cross-user |
| BE5 | `auth.uid()`-gated RPCs (never trusting client-passed identifiers) |
| BE6 | Privileged-column lockdown — client writes to `flex_coins`, `total_xp`, `current_level`, `prestige_level`, `league_tier`, streak columns, `referral_code`, etc. rejected with 42501 |
| BE7 | Anon RPC surface lockdown |
| BE8 | Function `search_path` hardening |
| BE9 | RLS initplan optimization (wrapped `auth.*` calls) |
| BE10 | FK indexing + hot-path indexes |
| BE11 | Public profiles view with email-harvest protection |
| BE12 | Storage `uploads` bucket with per-uid path prefixes, MIME allowlist, 50 MB cap |
| BE13 | Progress-photos bucket |
| BE14 | Storage delete-safety SELECT policy |
| BE15 | Vault-stored secrets for push + cron |
| BE16 | pg_cron jobs: streak reminders, welcome-back, quest expiry, gauntlet reset, duel expiry, scheduled-workout reminders |
| BE17 | pg_net HTTP dispatch to Edge Functions |
| BE18 | 6 Edge Functions: `send-push`, `recognize-meal`, `generateWeeklyDebriefs`, `checkout-session`, `friendRecapEmail`, `storage-gc` |
| BE19 | Anti-cheat: XP rate limits, coin mint ceiling, capsule mint lockdown, server-authoritative loot catalog, crew war XP clamp, bounty escrow, referral cap |
| BE20 | Atomic RPCs for every economy-touching write (purchase, capsule open, goal complete, post counter, league resolution, volume/distance increment, crew war contribution) |
| BE21 | Guest-user support paths throughout |
| BE22 | TanStack Query cache with a shared query client |

---

## 30. Known stubs, dormant code & explicit non-features — `NF`

| # | Item |
|---|---|
| NF1 | Trainer Programs card on Market — "Coming Soon" placeholder |
| NF2 | Live payments — checkout runs in test mode, no charge |
| NF3 | Connected Apps (Apple Health / Google Fit / Strava) — UI only, no sync |
| NF4 | Cardio wearable sync — stub component |
| NF5 | Weekly Debriefs — Edge Function deployed but the cron is unscheduled and `DEBRIEF_CRON_SECRET` is unset |
| NF6 | `push_subscriptions` currently 0 rows — delivery is verified working, nobody is subscribed yet |
| NF7 | `regimens.is_active` column — schema exists, nothing reads or writes it |
| NF8 | Bio profanity check is client-only (username is server-checked) |
| NF9 | LocationStep removed from onboarding — no country/state collection pending a product decision |
| NF10 | i18n gaps: ~128 keys missing in Arabic / Chinese / Russian; discovery cards + ~21 Hub keys English-only on 8 of 15 languages; `recap.*` keys English-only |
| NF11 | RTL visual verification on device still pending (class swaps done; JS animation direction, e.g. NotificationPanel slide-in, not yet direction-aware) |
| NF12 | `.toLocaleString()` migration partially complete — some sites still hardcode `en-US` |
| NF13 | Deliberately NOT pushed: individual gauntlet-challenge completions, crew-challenge 25/50/75% milestones, crew-challenge expiry-without-goal, "you got dethroned" to the overthrown rival |
| NF14 | `equipment_models` table is empty by design — the 50 seed models are a client-side vocabulary; the table fills from user submissions only |
| NF15 | Owner equipment controls never render on the 25 demo gyms (they have no owner) — correct behavior |

---

## 31. Easter eggs & hidden surfaces — `EE`

| # | Feature |
|---|---|
| EE1 | 7× logo tap → confetti barrage + random cheeky toast |
| EE2 | Snake game modal (hidden, "Secret game") |
| EE3 | Heavy Bird modal (Flappy-Bird-style minigame) |
| EE4 | Sweat Jetpack modal (minigame) |

---

**Section totals:** SH 32 · ON 31 · D 53 · W 77 · C 30 · AI 29 · FC 7 · N 43 ·
P 25 · G 11 · H 43 · HP 34 · ST 24 · M 35 · CR 27 · GY 45 · CP 57 · GA 52 ·
MK 22 · TR 11 · CO 10 · NT 20 · SE 32 · WE 14 · DB 6 · AD 13 · RS 33 · UI 24 ·
I18 9 · BE 22 · NF 15 · EE 4

**Grand total: 886 discrete features.**
