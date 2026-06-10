# Flexyn — Ship-Readiness Audit
**Date:** 2026-06-10 · **Target:** App Store + Google Play + Web launch in ~30 days
**Method:** 14 parallel domain audits over the full codebase (all 31 pages, 370 JSX + 374 JS files, all 201 migrations, all 5 edge functions), live browser testing of the running app (mobile/desktop/dark, signed-out surfaces), Supabase production advisors (283 security + 424 performance lints), full test suite (1155/1155 pass), production build (pass), full ESLint (192 warnings).

**Bottom line: NOT READY FOR LAUNCH** as scoped. The web product could soft-launch after a ~2–3 week stabilization sprint; the App Store build is realistically 8–10 weeks out (matching your own roadmap doc) because the native wrapper, push, IAP-compliance, and the blockers below all stack. The good news: the foundations are genuinely strong (complete RLS table coverage, resilience layers, 1155 green tests, hardened duels/bounties, rich messaging) — the blockers are concentrated and mostly mechanical.

---

## 1. CRITICAL LAUNCH BLOCKERS

### A. Store compliance & legal

**C1. Zero privacy policy, terms of service, or consent surface — anywhere.**
Repo-wide grep: no legal links in SignInToContinue, Settings, or Onboarding; verified visually on the live splash/auth screens. The app collects health data (weight, body photos, injuries, mood, sleep, **cycle logs**), has UGC + DMs, and plans Sentry session replay. Apple 5.1.1(i) and Google Play's Health policy both hard-require this; it's also GDPR Art. 13 non-compliance with sensitive-category data.
*Fix:* host `/privacy` + `/terms`, link from sign-in ("By continuing you agree…") and Settings.

**C2. "Delete account" never deletes the account.**
`src/api/db.js:608-840`: the cascade deletes ~35 table/columns then *resets* the profile — it never deletes `user_profiles` or `auth.users` (client can't admin-delete). Email is re-upserted; **a magic link to the same email re-enters the same ghost account**. Also: (a) the cascade misses ~25 tables incl. `journal_entries` (private journal text!), stories, weekly_debriefs, crews, duels, nemesis, bounty/gauntlet, coin_gifts, routines, step_logs, referrals, recipes; (b) **zero Storage cleanup** — avatars and body photos stay at permanent public URLs after "deletion"; (c) the reset itself **throws 42501** for any user with XP/coins because `resetForDeletion` (src/lib/data/me.js:45-93) writes columns migration 142's privileged-column trigger blocks — so deletion is broken outright for established accounts. Apple 5.1.1(v) requires real deletion; GDPR erasure fails.
*Repro:* delete account as a level>1 user → first privileged column write trips 42501. Or complete a "deletion" → request magic link → you're back in.
*Fix:* a `delete-account` Edge Function (service role) running the cascade + `auth.admin.deleteUser(uid)` + `storage.remove(uid/*)`, with the table list shared with `dataExport.js` so they can't drift.

**C3. Apple 3.1.1 + payments dead-end: trainer marketplace sells digital goods outside IAP, and no payment path works at all.**
`/trainer/market` shows "Unlock for $X" buttons; `checkout-session/index.ts` returns **501 STRIPE_NOT_IMPLEMENTED** in live mode (no Stripe charge code, no webhook function exists) and in mock mode (`ALLOW_MOCK_CHECKOUT=true`) **grants paid content permanently for free** (`trainer_purchases.is_mock` rows satisfy the regimens RLS — migrations 143:158-167, 170:33-43 have no `is_mock=false` filter). Digital content via Stripe inside an iOS wrapper is a guaranteed rejection.
*Fix:* feature-flag the entire paid trainer surface off for v1 (the "Coming Soon" pattern already exists in Market.jsx), purge `is_mock` rows before real payments ship.

**C4. OAuth sign-in will not survive the Capacitor wrap.**
`db.js:360-368` uses full-page `signInWithOAuth` with `redirectTo: window.location.origin`. Inside WKWebView, origin is `capacitor://localhost`; Google blocks embedded-webview OAuth (`403 disallowed_useragent`). Both "Continue with Google" and "Continue with Apple" dead-end in the store build. Needs `skipBrowserRedirect` + ASWebAuthenticationSession/Capacitor Browser + deep-link return, or native SIWA plugin + `signInWithIdToken`.

**C5. Pinch-zoom is disabled app-wide** (`index.html:31` — `maximum-scale=1.0, user-scalable=no`). Hard WCAG 1.4.4 fail, a known App-Review accessibility flag, compounded by 817 uses of 9–11px text. One-line fix; do it now.

### B. Broken core functionality (live-verified or fully traced)

**C6. All four public/viral surfaces render a permanently blank page** — live-verified on `/duel-invite/<token>`, `/@username`, `/p/gym/<id>`, `/checkin/<code>`.
Root cause: `App()` wraps `AuthenticatedApp` in `<Router>` (App.jsx:404-407) while the public-route bypasses (App.jsx:148-199) return a **second nested `<BrowserRouter>`** — react-router 6 throws "cannot render a Router inside another Router." Duel invites (your viral funnel), shareable profiles, gym landing pages, and gym QR check-ins are 100% dead.
*Fix:* delete the four early-return Router blocks; register those paths inside the single Router.

**C7. An active workout does not survive refresh or app-kill, and two one-tap controls destroy it.**
The only persistence is a React **unmount cleanup** (Workout.jsx:294-314) — it never runs on refresh, PWA process kill (iOS does this routinely), crash, or battery death; there's no `pagehide`/`visibilitychange` flush and no autosave. 45 minutes of sets vanish silently. Additionally: "Cancel" and the header back-arrow call `resetWorkout` with **no confirmation** (Workout.jsx:2648, Header.jsx:86-93); the resume card **deletes the draft on resume and resets the elapsed clock** (Workout.jsx:1332-1342).
*Fix:* debounced write-through of workout state to localStorage on every change + a pagehide flush; confirm dialog on cancel/back; stop removing the draft on resume.

**C8. Bodyweight sets are silently deleted at save — calisthenics workouts save empty with a success toast.**
The save filter (Workout.jsx:549-560) drops any set with `weight=0` unless the exercise is Cardio. Pull-ups/push-ups/dips/planks logged reps-only are erased; exercises losing all sets are dropped; `xpSystem.js`'s bodyweight XP branch is unreachable. Related: **all per-set metadata (warmup/failed/RPE/RIR/feel) is stripped on save** (Workout.jsx:1467-1509), and "Weighted Plank" rejects all weight input (realisticLimits substring `'plank'` → cap 0).
*Repro:* Freestyle → Pull-Up 3×10, no weight → Save → "Save anyway" → log contains `exercises: []`.

**C9. Metric users can't type weights.** SetRow's controlled input re-formats per keystroke through `toFixed` (SetRow.jsx:136-158): typing "82" in kg becomes "8.0…" — multi-digit/decimal kg and stone entry is broken on the hottest input in the app. Same bug in EditWorkoutModal.jsx:48 and GoalForm.jsx:204-215.
*Fix:* keep a raw string while focused; convert on blur.

**C10. Built-in programs and templates are broken at start.** Three producers write `exercises[].sets[]`, but `startFromRegimen` (Workout.jsx:1085-1118) reads only `target_sets/target_reps` → every exercise collapses to 3 blank sets, and `cloneTemplateExercises` **flattens a multi-day program into one mega-workout** ("Starting Strength" = the whole week in one session).

**C11. DM threads silently cap at the OLDEST 200 messages — and your just-sent message vanishes.**
`listMessages` orders ascending with `limit(200)` (hubMessages.js:210-213): past 200 rows, new messages never load; after sending, the optimistic row is replaced by a refetch of the oldest-200 window that doesn't contain it. Plus **new DMs generate no notification row and no push at all** (no trigger exists) — a closed app never learns about messages.
*Fix:* fetch `'-created_date'` + reverse + cursor pagination; add a `notify_dm_for` trigger.

**C12. Notification preferences were re-broken server-side by migration 136** — the exact regression migration 083 documents fixing. `136_gym_member_notifications.sql:95-129` replaced `notification_type_category()` with phantom type names (`streak_break` vs real `streak_break_warning`, `quest_complete` vs `quest_claimed`, `pr_celebrated` vs `pr_set`, drops `post_like`, etc.) → unmapped types return NULL and the fanout/snooze gates **fail open: muted categories still push**. Also: the streak-break cron deep-links to `/workouts` (404 — route is `/workout`), and the Notifications page **never marks-all-read on a cold visit** (effect deps bug, Notifications.jsx:109-120).

**C13. Feed interactions are corrupted on mobile.** The post card binds the same tap detector to `onClick` AND `onTouchStart` (HubPostCard.jsx:774-775): one physical tap = touchstart + synthetic click within the 300ms double-tap window → **every single tap likes the post**, and tapping Dislike ends as a Like (no stopPropagation + stale closure). Separately, **"Share a Video" is 100% dead** — the upload helper whitelists image extensions only (db.js:892-911), so every mp4/mov throws; and comment delete corrupts `comment_count` (hubComments.js:93-112).

**C14. The Gauntlet is non-functional past challenge 1, and its reward RPC is mint-able.** Only `checkChallenge1` ever calls completion (gauntlet.js:264-309); challenges 2–10 have no detection anywhere — every legitimate user stalls forever at step 1. Meanwhile `complete_gauntlet_challenge` (060:131-209) awards XP+coins without verifying the metric → devtools can claim all 10 (~6,025 XP + ~2,150 coins).

**C15. "Continue as guest" is a dead button in production** — live-verified: `POST /auth/v1/signup` → **422 `anonymous_provider_disabled`** (anonymous sign-ins are off in the Supabase project config) and the UI shows **no error whatsoever**. Either enable + harden (guests amplify every economy exploit; see C18) or remove the button. Also: guest copy is wrong ("data lives on this device" — it's server-side) and **no link-email upgrade flow exists** (`linkIdentity`/`updateUser` never called) — a guest who signs out loses the account forever. And an expired magic link lands silently on the marketing splash with no explanation (no `#error_code=otp_expired` handling).

**C16. Mojibake (double-encoded UTF-8) in user-visible Workout strings** — verified in source: `Workout.jsx:843, 983, 999, 1179, 2357, 2971` render `âš"ï¸ +XP â†'`, `ðŸ"¥`, `â€¢`, `â€¦` in save/streak toasts and on-page text on the most-used screen.

**C17. Progress photos: silent permanent data loss behind a success toast.** Photos are base64 in localStorage (~250-600KB each, `ProgressPhotoCapture.jsx:70-113`); QuotaExceeded is swallowed and the UI still toasts "Saved" — on iOS's ~5MB quota the feature silently stops persisting at ~8–14 photos. No server sync (photos die with the browser profile / Safari 7-day eviction), excluded from the GDPR export, and a legacy-bucket migration can hand one user's body photos to another account on a shared device.

### C. Security & privacy breaches

**C18. The economy is mintable today (and prod is behind the repo's fixes).**
- `increment_flex_coins(p_delta)` — **unbounded self coin-mint**, `GRANT EXECUTE` to authenticated, never revoked (030:21-43). Migration 147 fixed the sibling `grant_flex_coins` but missed this one; the 142 column-trigger explicitly exempts SECURITY DEFINER callers. `supabase.rpc('increment_flex_coins',{p_delta:999999999})`.
- `increment_user_xp` — client-supplied XP up to 100k/call, no daily cap, loopable (042:36-99).
- `contribute_crew_war_xp` — unbounded client XP wins any crew war (076:34-104).
- `update_solo_challenge_progress` / `complete_solo_challenge` — client-asserted progress mints coins (171:238-301).
- Direct `achievements` INSERT (RLS allows self-rows) defeats 147's milestone-capsule cap → free elite capsules.
- `user_profiles.total_volume_lbs` is **missing from the privileged-column trigger** (142:83-136) → one REST PATCH tops every volume leaderboard.
- Referrals pay 200 coins + elite capsule to both parties **at claim time** with no activity gate → sybil farming (089:164-261).
- Gym check-in codes are static signage text with no geofence → permanent 1.2x XP from home (149:38-78).
- **Prod drift:** live advisors still show the always-true `monthly_leagues` insert/update policies and unscoped `weekly_debriefs` service policies that migrations 147/148 drop — i.e. **the security-fix migrations are not (fully) deployed to production**, and `weekly_debriefs` is cross-user readable live (the "service role" policy has no `TO service_role`, so it ORs open for authenticated).

**C19. `user_profiles` is world-readable — including anonymously — with emails and health-adjacent fields.** Policy `FOR SELECT USING (true)` (001:46-48) + client `select('*')` means anyone with the anon key (it ships in the bundle) can `GET /rest/v1/user_profiles?select=*` and dump every member's email, full name, notification prefs, `cycle_tracking_enabled`, fitness assessment, streaks. Compounding it, **email is the public identifier**: `/@username` resolves to `/hub?profile=<EMAIL>` (App.jsx:81-94), share links broadcast the author's email, and crews/nemesis/duels/leaderboards/story-reaction payloads all return peer emails. GDPR breach class + App Store 5.1.
*Fix:* a whitelisted `public_profiles` view; owner-only base-table SELECT; route on username/user_id everywhere.

**C20. Social privacy is client-side theater.**
- `hub_posts: public read USING (true)` was never replaced — followers-only, crew-only, and **unpublished scheduled posts** are readable via REST; the Realtime feed channel broadcasts them too (hubPosts.js, HubFeed.jsx:129).
- **Blocking is one-directional and client-only**: `is_blocked()` exists in the DB but no RLS/insert guard uses it for posts/comments/stories; a blocked user still sees the blocker everywhere and can comment under their posts; typing indicators/read receipts still flow (only message INSERT is gated, mig 159). The block dialog's promise ("They won't see your profile, posts, or stories") is false. There is also **no Block/Report affordance anywhere in the DM surface** — Apple 1.2 reviewers check exactly this.
- **Private-account / hide-from-search toggles are dead code** — `privacy.js` is imported only by its test; search, PYMK, suggestions, and HubProfile ignore the flags; any signed-in user sees "private" profiles.
- **Stories upload originals with EXIF/GPS to the public `uploads` bucket** (no compression/strip, stories.js:151-176), URLs outlive the 25h "expiry" forever (no cleanup cron), and the bucket is **public + listable** (live advisor: `public_bucket_allows_listing`) — body photos and meal photos enumerable.

**C21. Push/notification abuse paths.** `send-push` accepts any Bearer (the public anon key is a valid JWT) and never binds `payload.user_id` to the caller → once VAPID ships, **anyone can push arbitrary phishing to any user** (send-push/index.ts:159-224). Today, `create_notification_for` (026:40-100) already lets any user deliver attacker-titled notifications with arbitrary `link_url` into any inbox.

**C22. AI cost exposure.** `recognize-meal` is JWT-only with **zero rate limiting** — any account can loop Claude Vision calls and drain the Anthropic budget (its own `RATE_LIMIT` code is unreachable). And `src/lib/aiCoach/coach.js:98-105` will call `api.anthropic.com` **directly from the browser** with `VITE_ANTHROPIC_API_KEY` if set — Vite inlines it into the public bundle; the in-code comment claiming it "stays on your build server" is wrong. Never set that var; move Coach behind an edge function; add per-user daily caps.

**C23. Sentry Replay will ship health data and DMs to a third party un-masked.** `main.jsx:36-51` adds `replayIntegration()` with no `maskAllText`/`blockAllMedia`, and `reportError` attaches raw user emails. Latent until `VITE_SENTRY_DSN` is set — which your roadmap does at launch. Configure masking + PII scrubbing in the same PR that sets the DSN.

**C24. Admin authority is a claimable username.** `is_app_admin` = `username IN ('sean','seanj','kegan','admin')` (103:29-40) gates moderation, report deletion, gym approval, featured listings. The profanity trigger reserves `admin` but **not `sean`/`seanj`/`kegan`**; usernames are mutable, and account-reset frees handles (`deleted_*`). One unclaimed handle = full moderation takeover. The client list (`adminRoles.js`) also disagrees with the server and grants client-admin by **email prefix** (`admin@…`).
*Fix:* an `admin_users` table keyed by `auth.uid()`; reserve the operator handles.

---

## 2. HIGH PRIORITY (fix before launch)

**Dates & timezones (hits the Americas + every non-English market):**
- Date-only strings parsed as UTC shift workouts/measurements/PRs **one day earlier** for anyone west of UTC — heatmap squares, frequency charts, body-metric history (WorkoutCalendarGrid.jsx:72-104, Progress.jsx:202/224, BodyMetricsTab, PRHistoryModal).
- The max-weight chart **sorts by the localized label** → reversed/garbled in 14 languages and across year boundaries (Progress.jsx:195-206).
- Weekly debrief week-start uses `toISOString()` → wrong week windows by timezone; the RPC never normalizes to Monday (debriefs.js:103-109, 061:46-48).
- Nutrition page date is computed **once per mount** — meals/water logged after midnight land on yesterday (Nutrition.jsx:296-297). Dashboard "today" has the same staleness (Dashboard.jsx:898).
- DM schedule-send `min` is UTC for a local picker — Americas users can't schedule within |offset| hours (HubChat.jsx:1667).

**Dashboard hero (first screen, every session):**
- Streak/PR math computed from the **last 50 logs** → wrong streaks and **false "New PR" celebrations/share cards** for committed users (Dashboard.jsx:847-1010, Workout.jsx:433-437); three divergent streak numbers render on one screen; "This week" means two different windows.
- Hero is **hardcoded English and lbs-only** on a 15-language metric-majority launch (HeroSlideshow.jsx:292-596).
- Push opt-in "Not now" never sticks (permission stays `default` → banner returns every mount) and **three push prompts can stack on one screen** (PushOptInBanner.jsx:73-80 + OnboardingNudgeCard + DiscoveryCards). Apple flags permission-nagging.
- Hero/Stories/DailyQuote/StreakRescue aren't wrapped in per-region ErrorBoundaries — one corrupt row blanks the whole Dashboard.

**Workout loop:**
- Rest timer is **silent on locked/backgrounded iOS** — AudioContext created outside a user gesture stays suspended; `navigator.vibrate` is a no-op on iOS; no notification fallback (RestTimerContext.jsx:222-263). The timer also keeps running after save/cancel.
- PR baseline windowing (above) + no undo on typo-PRs.
- Exercise search dead-ends with no "add custom" affordance; custom exercises get `muscle_groups: []` which feeds the C8 filter. Supersets can't be ungrouped and hide PR/history context.
- Voice set-logging is **dead code** — `VoiceInputButton` is imported nowhere while CLAUDE.md/store copy claims the feature.

**Nutrition:**
- Community barcode submissions are destroyed end-to-end: the form writes `nutrition/vitamins/source` columns that don't exist → strip-and-retry persists nothing; RLS hides the row anyway (`is_verified=false`, no verification flow); re-scans log **0-calorie meals**. The "available for all users" toast is false on every axis (BarcodeNotFoundModal.jsx:82-102, foodLookup.js:140-152).
- Barcode scanner teardown race leaves the **camera running after close** (controls assigned after await; Nutrition.jsx:736-813) — Apple tests camera teardown.
- Photo-AI fails on ordinary phone photos: >4MB rejected with no downscale, HEIC forwarded to Anthropic (unsupported → 400), error codes mismatched so users only ever see a generic failure; no timeout either (photoMealRecognition.js:23-76).
- First scan on iOS likely opens the **front camera** (device labels empty pre-grant; no facingMode fallback).
- Open Food Facts micronutrient conversions are wrong by 1,000–40,000× (vitamin C/D/B12/A; foodLookup.js:100-135).
- One-tap meal/water delete with no confirm/undo; no edit UI at all. Same one-tap permanent delete on body measurements.

**Goals/Progress:** weekly/monthly goal periods **never reset** — "Run 10km/week" stays 100% forever (GoalForm.jsx:19-29, GoalsList.jsx:81-121); body-metrics query fetches the **oldest** 200 rows so entry #201+ never appears; "All Time" stats truncate at 200 logs; the multi-metric chart plots raw lbs under a kg label (BodyMetricsTab.jsx:280-284); measurement entry has no range validation (body fat 250%, year-2030 dates save fine).

**Messaging/notifications:** no block/report in DM surfaces (also listed under C20); like/reaction notifications have no dedupe/batching (like-bombing floods the inbox; un-like/re-like refires); push tags collapse per-type so 5 distinct pushes overwrite each other; unread badges come from fixed 200/400-row windows and the conversation read-state localStorage key isn't user-scoped; group-creation usually fails to open the new thread (stale closure).

**Performance (won't survive launch traffic):**
- The **entire `user_profiles` table** (`select('*')`, limit 1000) downloads on every feed render and 6 other surfaces, refetched on window focus — 2-4MB a pop, and silently breaks past 1,000 users (useAuthors.js → db.js:64-72).
- Crew chat: **~330 requests/min** per open chat (per-message reaction polling × 80 messages + 4s list poll) (CrewMessageItem.jsx:161-170).
- Global unread badge fetches **400 full message rows every 30s** on every screen (hubMessages.js:336-346).
- Hub feed: 4 point-reads per post card (N+1), full 100-row feed refetch after **every like**, no virtualization (100 posts ≈ 15-20k DOM nodes), videos autoplay simultaneously and never pause offscreen.
- Stories/journal/gym uploads ship full-res photos (no compression — also the EXIF/GPS leak), and the service worker caches **zero** runtime images (every cold start re-downloads all avatars).
- Opening any profile downloads 500 full workout logs to show 4 numbers (ProfileLiftStats.jsx:33).
- Dashboard mounts ~30 queries and refetches nearly all on every refocus; six pollers run concurrently.
- DB advisors: **183 RLS policies re-evaluate `auth.uid()` per row** (wrap as `(select auth.uid())`), **129 duplicate permissive policies**, **65 unindexed foreign keys**.

**Accessibility (beyond C5):** ~56 hand-rolled modals with no focus trap/ESC/dialog role (HubComposer, MarketplaceFeed, BarcodeResultModal, UserBag, BottomSheet…); Stories viewer is touch-only with 8s auto-advance; **212 of 234 inputs lack programmatic labels**; 40 icon-only buttons unnamed; the dead shadcn toaster mounts two empty `z-[100]` full-width divs that shield taps over the header (delete ui/toast.jsx + the `<Toaster/>` mount); CSS animations ignore reduced-motion (1 `motion-reduce:` vs 207 animate-* utilities; onboarding runs looping motion on first run); bottom nav has no `aria-current` (color-only active state); RTL: NotificationPanel slides across the whole screen in Arabic and ~90% of directional chevrons don't flip. Estimated **~55% WCAG 2.2 AA** today; ~85% reachable in a focused week.

**i18n:** ar/zh/ru/hi are missing **~286 keys** (double the documented gap); the entire Market/economy surface (Market.jsx, MarketplaceFeed, UserBag, TradeHistory) has zero i18n calls; Hub composer toasts, Nutrition carousel, Progress tabs/labels, Notifications tabs, Layout quick-actions are English islands; all notification/message timestamps are en-US (`formatDistanceToNow` without locale); ~20 native `window.confirm` dialogs are English-only and jarring in standalone PWA; 28 raw `.toLocaleString()` sites bypass intl.js.

**Trust & safety:** no image moderation pipeline for any uploaded media (avatars/posts/stories/DMs) — a UGC store-review and legal liability; no rate limits on posts/comments/DMs/follows/reports/referrals; email verification not required before social actions; bounty `exercise_name` has no server-side profanity trigger (world-readable board); age gate is a floor-clamp (under-13 input silently becomes 13; "guardian consent" label with no flow); minors get stranger-DM social by default.

**Other:** 2FA is decorative (enrolled TOTP never challenged at sign-in; AAL never checked); XP level-curve desync — client xpSystem.js (base 150) vs server RPC (base 250) so UI level ≠ DB level and level-gated rewards fire at wrong totals; deploys force a mid-session reload (`autoUpdate` + skipWaiting; AppUpdatePrompt is unreachable dead code); netlify.toml has no security headers (CSP/HSTS/frame-ancestors) and no immutable caching; GDPR export is JSON-only and misses journals/stories/debriefs/DM history; gym leaderboard RPC has no membership gate (roster IDOR — the 158 stub was never implemented); gym owner phone/street address world-readable (135:142-144); `weekly_debriefs` service policies need `TO service_role`.

---

## 3. MEDIUM PRIORITY (first weeks post-launch)

- localStorage hygiene: dietary restrictions, saved meals, goal weight, recent profile searches (stores other users' emails!), bar inventory, and DM read-state keys are **not user-scoped** → cross-user bleed on shared devices; sessionStorage dash keys same.
- Poll votes publicly attributable (`USING (TRUE)` + user_email + option) and fetched row-by-row; `hub_post_views` readable by everyone ("who viewed whom" surveillance).
- "Translate" sends private post/comment text to lingva.ml / mymemory with no disclosure.
- Scheduled posts visible pre-publish via API and burn feed-window slots; Squad feed caps at your first 100 follows; follower counts cap at 500; comments cap at 200 with no pagination (newest never visible on viral posts); notifications page caps at 200 with no pagination.
- `create_notification_for` hardening (server-render title/body; fixed per-type routes) — see C21.
- Onboarding: 12 screens; draft restores answers but restarts at step 1 (`stepIdx` not persisted).
- Trade history: 500-message window truncation; counterparty/direction read from author-controlled payload text.
- Nemesis overthrow self-attestable and grindable (client UPDATE + reassign loop).
- Crew deleted mid-war cascades the war away with no resolution for the innocent crew.
- GymMap: up to ~3,000 individual DOM markers with no clustering; no style-load error UI for the keyless tile fallback; ship a MapTiler key.
- Charts: no text alternative (`accessibilityLayer` unused); tooltips show unrounded floats ("90.71847 kg"); cardio sessions plot 0-lb cliffs; Trends tab mounts 30-40 Recharts simultaneously (default tab jank).
- RestTimer context re-renders all exercise loggers 1Hz during every rest; Prismatic theme rewrites `:root` CSS vars at 30Hz app-wide; 62 infinite particle animations on Dashboard without reduced-motion gates.
- Hydration: Dashboard hardcodes 64oz while Nutrition computes a personalized goal (contradictory rings); oz-only for 14 metric locales.
- Recharts theme vars used without `hsl()` wrapper → invisible tooltip backgrounds (WidgetRenderer.jsx:54-57); streak calendar `text-emerald-300` unreadable in light mode; splash/error screens are light-only (live-verified: splash ignores OS dark mode); Market/Bag/Capsule surfaces use a hardcoded dark game palette that ignores the theme system (formalize or fix).
- Update/caching: precache swallows `/` so installed PWA always boots the stale shell then force-reloads; switch to `registerType:'prompt'` and let AppUpdatePrompt work.
- Trophy toasts stack and bypass rewardQueue (violates house convention); LeagueStandingsModal NaN "Days left" when `week_end` missing; first-meal celebration miscounts foods starting with "Water"; PageHeader silently drops the `icon` prop; document.title never changes per route; missing h1 on Hub/auth pages; back-button anarchy (position/icon/label/fallback differ everywhere; Notifications' is at the bottom); no scroll policy (only HubFeed restores; tab switches land mid-page); empty/loading-state forks (skeleton vs spinner vs literal "Loading…" on adjacent surfaces).
- Terminology: Regimen/Program/Routine/Template/Plan collide (one toggle uses two terms); Duel/Challenge/Battle interchangeably on one screen; "Squad" = follow-feed in one place, your crew in three others; "Recap" vs "Debrief" both brand the weekly summary. Decree a glossary and sweep.
- ESLint: 49 `no-use-before-define` warnings (the TDZ class that already crashed prod once) + 109 unused vars; favicon.ico and robots.txt referenced but absent (the SPA serves index.html as the favicon); iOS splash screens missing; maskable icon is the unpadded 512.
- Duel-invite token leaks via Referer through the challenger-controlled avatar image (add `referrerpolicy="no-referrer"`); send-push Bearer-shape check should verify in-handler; CORS `*` on edge functions → origin allowlist.
- Supabase config: enable leaked-password protection (moot while passwordless, cheap anyway); 47 unused indexes.

---

## 4. NICE-TO-HAVE IMPROVEMENTS

- Nutrition parity: serving-size multiplier on barcode/manual logging, food-name database search, copy-yesterday, re-log from history, favorites, log-a-recipe (the carousel already promises several of these — tone the copy down until they exist).
- Post permalink route (`/post/:id`) + linkified URLs + @mentions in bodies; multi-image carousels; bookmark surfacing; comment sorting/pinning; "post unavailable" tombstones for deleted repost originals.
- Message edit; offline outbox for meal/workout/DM writes (gym basements!); close-friends stories; mute words.
- Superset ungroup control; "no matches — add '{query}'" row in exercise search; plate-math helper; per-set done-toggles so pre-seeded values aren't phantom volume.
- Mount-or-delete VoiceInputButton; gallery import for progress photos (camera-only today); photo compare ResizeObserver fix.
- Dark-mode pass for splash/PageNotFound/UserNotRegisteredError; document titles per route; a shared BackButton and useConfirm() hook; EmptyState adoption everywhere (Duels has bare text, no CTA).
- Dashboard CTA de-duplication (three "start workout" affordances above the fold); promo slides ("Feature of the Day" is permanently Duels) on a real rotation.

---

## 5. COMPETITIVE GAPS

**vs Instagram / X / Threads / Reddit / TikTok:**
1. No post detail page — shares, search hits, and notifications land on profiles, never the post.
2. No working video pipeline (and no transcode/thumbnails/duration caps even once the MIME bug is fixed).
3. No multi-image posts; single image hidden behind a tap-to-reveal blur by default.
4. No ranked/algorithmic feed — "Hot" is a client-side sort of a 100-post window; trending hashtags are window-local substring matches.
5. Blocking/private accounts far below platform norms (no mutual hide, no approval-based follows, no restricted/teen mode).
6. No mention support in post bodies, no keyword muting, no comment pagination/sorting/creator-pinning.
7. Stories aren't truly ephemeral (permanent public URLs) and lack close-friends.
8. No creator analytics, no share-to-story, no verified system beyond a hardcoded username list.

**vs fitness market (Strava, Fitbod, Hevy, MyFitnessPal, Whoop):**
9. **No Apple Health / Google Fit / wearable sync** — the most-requested integration class in the category; steps/sleep are manual logs.
10. No watch app / Live Activities / home-screen widgets for the rest timer and active workout.
11. No offline mode for logging (everything errors and is lost offline).
12. Nutrition lacks a verified food database search and quantity math (vs MyFitnessPal's core loop).
13. No data import (Strava/Hevy/Strong CSV) for switchers — high-value lifters arrive with history.
14. Where you're AHEAD of typical pre-launch: DM richness (typing, receipts, reactions, voice notes, polls, scheduled send), celebrations/haptics system, share cards, league/duel/bounty/nemesis depth, 15-language ambition, PWA installability. The retention machinery is genuinely differentiated — it's the trust layer underneath that's behind.

---

## 6. SHIP READINESS SCORES

| Dimension | Score | Rationale |
|---|---|---|
| **Design** | **6.5/10** | Real token system, strong flagship surfaces, working dark mode core — but mojibake on the core flow, a theme-ignoring Market palette, 6 title scales across routes, and English islands everywhere. |
| **UX** | **6/10** | Rich, often thoughtful (optimistic UX, celebrations, empty states) — undermined by data-loss traps, dead buttons (guest), permission nagging, and four blank acquisition funnels. |
| **Stability** | **4.5/10** | 1155 green tests and good error boundaries, but the core loop loses data on refresh, public routes crash, and video/Gauntlet/programs/community-barcode are broken end-to-end. Tests cover libs, not flows. |
| **Performance** | **5/10** | Excellent hygiene (lazy i18n/tfjs, cleanup discipline, chunking) wrapped around data-layer patterns that won't survive launch: full-table downloads, 330 req/min chat polling, per-like feed refetches, zero image caching. |
| **Accessibility** | **4/10** | ~55% WCAG 2.2 AA. Zoom disabled, 56 untrappable modals, 212 unlabeled inputs, touch-only stories. Mostly mechanical fixes; the Radix layer underneath is sound. |
| **Security** | **3.5/10** | Complete RLS table coverage and many genuinely hardened RPCs — but live coin/XP mints, world-readable profiles with emails, client-side privacy theater, a username-keyed admin takeover path, and prod drift behind the fix migrations. For a social app, this is the weakest pillar. |
| **Launch Readiness** | **3/10** | Compliance void (privacy/ToS/deletion), store-build auth broken, payments dead-end, and the above. |

---

## 7. FINAL RECOMMENDATION

### **Not Ready for Launch.**

Not within 30 days for the App Store, and not for a public web launch this week — but this is a **triage problem, not a rebuild problem**. The same five patterns explain most criticals: client-trusted RPC amounts, `USING (true)` RLS, email-as-identifier, date/locale handling, and unguarded destructive paths.

**Suggested sequencing:**

- **Week 1 — Security & privacy hotfix batch (SQL-heavy):** deploy/verify 147+148 against prod; revoke `increment_flex_coins`; cap/gate `increment_user_xp`, crew-war, solo-challenge, gauntlet RPCs; `public_profiles` view + owner-only base select; real post-privacy/blocking RLS; `TO service_role` on weekly_debriefs; `admin_users` table; notification-category mapping hotfix (un-break 136); send-push caller binding; rate-limit recognize-meal.
- **Week 2 — Core-flow data integrity:** workout persistence + confirms + bodyweight/metadata save fixes + kg input; nested-Router fix (revives all four funnels); DM newest-200 + DM notifications; tap-to-like; video upload; programs/templates; progress photos → Storage; Nutrition midnight/barcode-pipeline/camera-teardown; date/TZ cluster.
- **Week 3 — Compliance & a11y:** privacy policy + ToS + consent line; delete-account edge function (+ storage purge, shared manifest with export); IAP-flag the trainer market off; viewport zoom; modal a11y hook + label sweeps; reduced-motion block; Sentry masking + DSN; remove/enable guest coherently; mojibake sweep; i18n top-ups for the four weak locales or de-advertise them.
- **Week 4 — Verification + web soft launch:** regression pass on the fixed flows (real iOS device), performance batch (authors/reactions batching, head-count RPCs, crew-chat poll consolidation, image compression + SW cache), then a quiet web/PWA launch to validate at small scale.
- **Stores:** per your own roadmap, ~8–10 weeks (Capacitor, APNs path, OAuth deep-links, store assets, review cycles). The store clock can start in parallel during Week 1 (Apple account, bundle ID, privacy labels).

**What I could not test live** (flag for manual QA): authed in-app flows end-to-end (guest sign-in is disabled in prod config and magic-link needs an inbox — fix C15 and this gets easier), real-device iOS behavior (PWA kill, camera, haptics, audio), push delivery (VAPID unset), and real Stripe. Everything else above is verified in source, in the live advisors, or in the running app.
