# Audit 07 — localStorage namespace consistency & missing exports

## Section A — localStorage namespace consistency

CLAUDE.md convention: per-user UX state should live under
`flexyn.<feature>.<userId>`. Keys without a userId suffix LEAK across users
on a shared device (login-as-A, set flag, logout, login-as-B, B sees A's
state). `wipeLocalClientState` in `src/components/ProfileMenu.jsx`
nukes ALL localStorage on Sign Out (preserving only `journal_*` /
`fn-theme` / `fn-dark-mode` / `fn-loot-theme`) and on Delete Account
(no preservation) — so cross-user leak only matters within a single
session if the user signs OUT and a new user signs in. BUT: account
switching that goes via a token refresh, OAuth provider switch, or
deep-link auth doesn't always traverse `handleSignOut`. Keys without a
userId suffix are still a correctness risk.

| severity | file:line | issue | suggested-fix |
|---|---|---|---|
| high | src/components/hub/HubMessages.jsx:58,61,64,67,85,95,106,116 | `fn_pinned_convs`, `fn_muted_convs`, `fn_pinned_crews`, `fn_muted_crews` — per-user UX state with NO userId suffix; legacy `fn_` prefix (not `flexyn.`); user B sees user A's pinned chats after switch | Rename to `flexyn.pinnedConvs.<userId>` etc; migrate legacy keys once on first read |
| high | src/components/crews/CrewMessageItem.jsx:87-89 | `fireKey(id) = 'fire_${id}'` — per-user reaction state with no userId; uses no `flexyn.` namespace | `flexyn.crewFire.<userId>.<msgId>` |
| high | src/components/hub/HubChat.jsx:95 | `DM_FIRE_KEY = (convId) => 'dm_fire_reactions_${convId}'` — per-user state keyed only by convId | `flexyn.dmFire.<userId>.<convId>` |
| high | src/components/hub/HubSearchOverlay.jsx:14 | `hubRecentSearches` — search history (potential PII: who the user looked up) shared across all users on device | `flexyn.hubRecentSearches.<userId>` + treat as PII in wipe |
| high | src/components/progress/InsightsTab.jsx:119 | `flexyn_goal_weight_lbs` — body-composition target leaks across users | `flexyn.goalWeightLbs.<userId>` |
| high | src/components/progress/ProgressPhotoCapture.jsx:14 | `flexyn_progress_photos` — base64 progress photos (PII / body images) shared across users on device | `flexyn.progressPhotos.<userId>` + treat as PII in wipe |
| high | src/lib/nutritionPlans.js:408 | `flexyn_dietary_restrictions` — dietary restrictions (potential health PII) leaks across users | `flexyn.dietaryRestrictions.<userId>` |
| high | src/lib/savedMeals.js:5 | `flexyn_saved_meals` — saved meal templates leak across users | `flexyn.savedMeals.<userId>` |
| high | src/pages/Nutrition.jsx:99,110,675 | `flexyn_scan_history` — barcode scan history leaks across users | `flexyn.scanHistory.<userId>` |
| high | src/lib/conversationArchive.js:19 | `fn_archived_convs` — which conversations a user archived leaks across users | `flexyn.archivedConvs.<userId>` |
| high | src/lib/DistanceUnitContext.jsx:6 | `flexyn_distance_unit` — per-user setting (server-backed) but local cache leaks across users; user B inherits A's km/mi until first server read | `flexyn.distanceUnit.<userId>` |
| high | src/lib/WeightUnitContext.jsx:6 | `flexyn_weight_unit` — same issue as distance unit | `flexyn.weightUnit.<userId>` |
| high | src/components/hub/HubPostCard.jsx:142 | `VOTE_KEY = 'poll_vote_${postId}_${userEmail}'` — has user discriminator but legacy `poll_vote_` prefix instead of `flexyn.` | rename to `flexyn.pollVote.<userEmail>.<postId>` for consistency |
| medium | src/components/hub/MarketplaceFeed.jsx:39 | `CHEST_KEY = 'daily_chest_claimed_${userId}'` — has userId but legacy prefix; ALSO `src/components/Layout.jsx:110` reads `daily_chest_claimed_${userId}` — keep call sites in sync if renamed | `flexyn.dailyChestClaimed.<userId>` |
| medium | src/lib/firstLaunch.js:14,60 | `fn-has-launched` + `fn-returning-user` — device-scoped intentionally, but legacy `fn-` prefix not `flexyn.` | Acceptable as-is (device-scoped); rename for style only |
| medium | src/lib/LanguageContext.jsx:6 | `fn-language` — device-scoped intentionally (pre-auth language), legacy prefix | Acceptable as-is |
| medium | src/lib/RestTimerContext.jsx:25,26 | `fn-rest-timer-default`, `fn-rest-timer-sound` — device-scoped intentional, legacy prefix | Acceptable as-is |
| medium | src/lib/audioCues.js:14 | `fn-voice-cues` — per-user setting on device-scoped key; minor leak | `flexyn.voiceCues.<userId>` |
| medium | src/lib/leaderboardStats.js:11 | `fn-leaderboard-stats-backfilled-v3` — per-user backfill flag stored device-wide; user B may skip the backfill because user A already ran it | `flexyn.leaderboardBackfill.<userId>` |
| medium | src/components/LevelUpManager.jsx:20,42 | `fn-last-seen-level:${user.email}` — has discriminator but uses legacy prefix and colon separator | rename to `flexyn.lastSeenLevel.<email>` for consistency |
| medium | src/pages/Nutrition.jsx:163 + NutritionOnboardingModal.jsx:181,197 | `fn-nutrition-onboarded` — per-user state stored device-wide; new user lands on fully-onboarded nutrition view | `flexyn.nutritionOnboarded.<userId>` |
| medium | src/lib/data/duelInvites.js:88 | `fn-pending-duel-invite-token` — pending duel invite intentionally pre-auth, but if a logged-in user starts a duel they're stashing in a shared key | OK pre-auth; document the intent or scope to `<userId>\|anon` |
| medium | src/components/PWAInstallPrompt.jsx:15 | `fn-pwa-install-dismissed-at` — device-scoped intentional, legacy prefix | Acceptable as-is |
| low | src/lib/data/referrals.js:18 | `flexyn.pendingReferralCode` — pre-auth by design (referral arrives before signup), matches CLAUDE.md example | OK |
| low | src/lib/cardioSession.js:2 | `fn-cardio-active-session` — active cardio session NOT per-user; if user A starts cardio and B logs in, B sees A's paused run | `flexyn.cardioActiveSession.<userId>` |
| critical | src/lib/data/journal.js:111-122 + ProfileMenu.jsx:50 | `wipeLocalClientState({ preserveKeys: true })` preserves keys starting with `journal_` (legacy localStorage entries pre-mig 145). After mig-145 these are uploaded to the server, but the `flexyn.journalMigrated.<userId>` flag (line 110) is NOT preserved. On Sign Out → Sign In, the flag is wiped, so migration runs again — harmless because `getEntry` dedupes, but a wasted RT per re-signin. Worse: legacy `journal_<email>_<date>` entries leak across users — user B logs in, the migration helper enumerates ALL `journal_<email>_*` keys, but only migrates those matching THIS userEmail. So no PII leak from the migration path, but the raw legacy keys remain readable by anyone with devtools after Sign Out. | Have `wipeLocalClientState` migrate then delete legacy `journal_*` keys (or only preserve `journal_<currentEmail>_*`); preserve the `flexyn.journalMigrated.<userId>` flag |

## Section B — Missing exports / unresolved references

All cross-references for the new pulled files
(`organizations.js`, `trainerMarket.js`, `journal.js`, `gymSignageKit.js`,
`workoutVolume.js`, `trainerSplit.js`, `CorporatePortal.jsx`,
`TrainerStudio.jsx`, `TrainerMarket.jsx`) were verified against the
source modules' actual `export` lines.

| severity | file:line | issue | suggested-fix |
|---|---|---|---|
| — | (none) | All imports in the audited files resolve to real named exports. Verified: `gymSignageKit` (`downloadSignageKit`, `SIGNAGE_PLACEMENT_COUNT`) → consumed in `GymSignageCard.jsx`. `workoutVolume` (`totalVolume`) → consumed as `computeTotalVolume` in `Workout.jsx` + `LiveVolumePill.jsx`. `trainerSplit` (`calculateSplit`, `formatCents`, `dollarsToCents`, `PLATFORM_CUT_PERCENT`) → consumed in `TrainerStudio.jsx`, `TrainerMarket.jsx`, `ListingFormModal.jsx`. `data/trainerMarket` (`becomeTrainer`, `getMyListings`, `createListing`, `updateListing`, `setPublished`, `deleteListing`, `getMyRevenue`, `listPublishedListings`, `listMyPurchasedListingIds`, `startCheckout`) → all used in studio + market + modal. `data/organizations` (`listMyOrganizations`, `createOrganization`, `joinOrganizationByCode`, `leaveOrganization`, `listChallenges`, `createChallenge`, `deleteChallenge`, `getOrgAnalytics`, `getMemberCount`) → all imported in `CorporatePortal.jsx` line 25-27. `data/journal` (`getEntry`, `upsertEntry`, `listEntries`, `uploadAttachment`, `migrateLocalEntries`) → consumed in `JournalView.jsx` + `JournalHistoryModal.jsx`. | — |

No MISSING_EXPORT / UNRESOLVED_IMPORT findings in scope.
