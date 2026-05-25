# 05 — ErrorBoundary Coverage Audit

Date: 2026-05-24
Scope: `src/App.jsx` routes + page-level region wrapping per CLAUDE.md
"Resilience layers" contract.

## Summary

- **App.jsx routes**: ALL 23 in-Layout routes are correctly wrapped in
  `<ErrorBoundary label="..."><Suspense fallback={<PageLoader />}><Page /></Suspense></ErrorBoundary>`.
  The three pre-router public surfaces (`/duel-invite/:token`, `/@:username`,
  `/p/gym/:id`) are NOT wrapped, but they're the auth-gate bypass — out of
  scope of the standard pattern.
- **Page-level coverage** is uneven:
  - Dashboard, Workout (idle view), Progress, Nutrition: ~all major
    cards wrapped.
  - **New pages (Migration 146 batch): CorporatePortal, TrainerStudio,
    TrainerMarket, GymMap, GymHub — zero region-level ErrorBoundaries**.
  - Hub: one outer boundary; sub-sections (HubFeed/CrewsSection/etc.)
    NOT individually wrapped — a single render bug white-screens the
    whole social surface.
  - Workout **active session view** (lines 2098-2333) has no region
    boundary around ExerciseLogger/Reorder.Group/EditWorkoutModal.
- No `JournalView` route exists; JournalView is mounted lazily inside
  ProfileMenu (line 35 + 523). It has its own data-fetching but no
  parent ErrorBoundary in ProfileMenu.

## Findings

| Severity | Location | Observed | Suggested fix |
|---|---|---|---|
| critical | `src/pages/CorporatePortal.jsx` (entire page) | No `import ErrorBoundary`. Three `useQuery` reads (listMyOrganizations, listChallenges, getOrgAnalytics) + the `OrgHub` sub-component all throw uncaught. Route-level boundary catches it but degrades the WHOLE page. | Wrap `<OrgHub>` invocation (line ~164) and the create/join state (line ~115) in their own `<ErrorBoundary label="OrgHub">`. |
| critical | `src/pages/TrainerStudio.jsx` (entire page) | No `import ErrorBoundary`. Uses `db.auth.me()`, `getMyListings`, `getMyRevenue` queries + lazy `ListingFormModal`. A regimen with malformed data crashes the listings render. | Add `import ErrorBoundary` and wrap (a) the listings grid section, (b) the revenue card, (c) the lazy `<ListingFormModal>` modal mount. |
| critical | `src/pages/TrainerMarket.jsx` (entire page) | No `import ErrorBoundary`. Two unauth-prone queries (`listPublishedListings`, `listMyPurchasedListingIds`); one stripe-mode payload mismatch white-screens the storefront. | Wrap the listings `<div className="grid">` (line ~120) in `<ErrorBoundary label="TrainerListings">`. |
| critical | `src/pages/GymMap.jsx` (entire page) | No `import ErrorBoundary`. maplibre-gl can throw on style URL fail, bbox query, or `buildFlexynPin` DOM error. README comment says ErrorBoundary reload loop forced static import — but the boundary itself was never added. | Wrap the `<div ref={mapContainerRef}>` map render in `<ErrorBoundary label="GymMapCanvas">`; wrap the `<GymLeaderboard>` overlay separately. |
| critical | `src/pages/GymHub.jsx` (entire page) | No `import ErrorBoundary`. EventsTab + LeaderboardTab have local `useState/useEffect` data fetches; getGym/getLeaderboard/listEvents all throw uncaught. The membership-flash logic + `gym_members` membership query (line 76-82) is raw `supabase.from` with no `safeSelect`. | Add `import ErrorBoundary` and wrap each tab body: `<ErrorBoundary label="GymFeedTab">`, `"GymEventsTab"`, `"GymLeaderboardTab"`, plus `<GymAboutCard>` (lazy). |
| critical | `src/pages/Hub.jsx` lines 327-352 (sections) | A single outer `<ErrorBoundary label="Hub">` wraps everything. HubFeed / CrewsSection / HubProfile have no individual boundaries — a render bug in CrewsSection takes the entire Hub down (same defect class as the May 2026 HubPostCard TDZ crash). | Wrap each of HubFeed, CrewsSection, HubProfile, FollowSuggestionRail, FriendLeaderboardPanel, LiveActivityRail, StoriesRow, FollowerActivityBanner in their own `<ErrorBoundary label="...">`. |
| critical | `src/pages/Workout.jsx` active-session view (lines 2098-2333) | The active-workout render (ExerciseLogger × N, GroupBlock, LiveVolumePill, ExerciseAutocomplete) is the most-touched UI in the app and has NO region boundary — a per-set render bug white-screens mid-workout, the worst possible UX moment. | Wrap the `<Reorder.Group>` block (line 2210) in `<ErrorBoundary label="ActiveSession">`; wrap `<LiveVolumePill>` separately. |
| high | `src/pages/Workout.jsx` line 1976-1980 | `Suspense<GoalsModal>` + raw `<EditWorkoutModal>` (line 2000-2043) mounted without ErrorBoundary; EditWorkoutModal does volume-delta RPCs that can throw. | Wrap `<EditWorkoutModal>` in `<ErrorBoundary label="EditWorkoutModal">` and `<GoalsModal>` likewise. |
| high | `src/pages/Dashboard.jsx` line 977 | `<DashboardWidgets logs={logs} goals={goals} />` is rendered unwrapped. It's a sibling of many wrapped cards — same blast radius. | Wrap in `<ErrorBoundary label="DashboardWidgets">`. |
| high | `src/pages/Dashboard.jsx` lines 980-998 | `<GoalsModal>`, `<LeagueStandingsModal>`, `<LogWeightModal>` mounted at root unwrapped. A modal-render crash on open white-screens the page below. | Wrap each modal mount in `<ErrorBoundary label="...">`. |
| high | `src/components/ProfileMenu.jsx` line 523 | Lazy `<JournalView>` rendered with `Suspense` but NO `ErrorBoundary`. JournalView (~400 lines) reads `journal_entries` and writes via mutations — throws on schema drift. | Wrap with `<ErrorBoundary label="JournalView">` and same for `<JournalHistoryModal>` (line 35 import). |
| high | `src/pages/GymHub.jsx` lines 76-82 | `supabase.from('gym_members').select('id')` is raw — not via `safeSelect`. If a future column rename breaks the query, the membership check throws on every gym page visit. | Migrate to `safeSelect` per CLAUDE.md "wrap explicit-column selects" rule. |
| high | `src/pages/GymHub.jsx` `EventsTab` line 341-353 | `listEvents` + dynamic-imported `listEventRsvps` inside `useEffect` with no try/catch. A rejection raises an unhandled promise + leaves `loading=true` forever (stuck spinner). | Add try/catch with `reportError({ feature: 'gym.events' })`; setLoading(false) in a finally block. |
| high | `src/pages/CorporatePortal.jsx` line 193 | `useQuery({ queryFn: () => getOrgAnalytics(org.id), enabled: isAdmin })` — analytics RPC throws translate to React Query error state but the rendered card (line 246-281) doesn't check `error`; only checks `!analytics`. Stays on permanent spinner. | Destructure `error` from useQuery, render an inline retry CTA on error. |
| high | `src/pages/TrainerStudio.jsx` lazy `ListingFormModal` (line 29) | `Suspense` fallback isn't paired with an ErrorBoundary — chunk-load failure (mirrors the GymMap reload-loop scenario noted in that file's header comment) crashes the page. | `<ErrorBoundary label="ListingFormModal"><Suspense fallback={null}>...</Suspense></ErrorBoundary>`. |
| high | `src/pages/GymHub.jsx` lines 256-258, 296-300, 306-324 | Multiple `Suspense` blocks (GymAboutCard / GymFeedTab / GymSignageCard / MemberDirectoryModal) without ErrorBoundary pairs. Chunk-load failure → blank tab. | Wrap each `Suspense` in its own ErrorBoundary. |
| medium | `src/pages/GymMap.jsx` lines 17, 100+ (data layer) | `getGymsInBbox` calls in map move handler; rejections will surface as console errors but not user-facing toast or recovery affordance. | Wrap call site in try/catch with `reportError({ feature: 'gym.map.bbox' })` and a single toast on first failure. |
| medium | `src/pages/Workout.jsx` lines 2319-2321 | `<Suspense><ProgressPhotoCapture /></Suspense>` without ErrorBoundary; in Dashboard the SAME component IS wrapped (line 1003). Inconsistent. | Match Dashboard pattern: add `<ErrorBoundary label="ProgressPhotoCapture">`. |
| medium | `src/pages/Progress.jsx` line 911+ | `PersonalBestsTab`, `AdvancedAnalyticsTab` (in modals) lack region boundaries. Used to be no big deal but they read `bodyMetrics` + `logs` and crash easily on bad payloads. | Wrap each modal body in `<ErrorBoundary label="PersonalBests">` / `"AdvancedAnalytics"`. |
| medium | `src/pages/Workout.jsx` line 2499-2510 | `<GauntletStatsModal>` mounted unwrapped between two wrapped boundaries. Inconsistent — same blast radius as wrapped modals. | Wrap in `<ErrorBoundary label="GauntletStatsModal">`. |
| medium | `src/pages/Hub.jsx` lines 383-397 | `<HubSearchOverlay>` and line 380 `<HubComposer>` mount at root unwrapped (relying only on outer Hub boundary). | Wrap each in its own ErrorBoundary so overlay crash doesn't kill the underlying feed. |
| medium | `src/pages/CorporatePortal.jsx` line 168-173 | `<ChallengeFormModal>` mounted unwrapped — form-state bugs white-screen the page. | Wrap mount site in `<ErrorBoundary label="ChallengeForm">`. |
| medium | `src/pages/Nutrition.jsx` line 1112-1153 | "Entries list" — directly maps `entries.filter(...)` without ErrorBoundary; a malformed entry payload (e.g. NaN macro) crashes the list render. | Wrap the `<motion.div className="space-y-2">` block in `<ErrorBoundary label="MealsList">`. |
| low | `src/pages/Workout.jsx` line 1850 | `<NemesisCard>` IS wrapped (good), but identical card on Dashboard line 826 + Workout uses different inline patterns — fine, just inconsistent commentary. | Style only; no change needed. |
| low | `src/App.jsx` lines 146-183 | Public/auth-bypass routes (DuelInviteLanding, PublicProfile, PublicGymLanding) don't have ErrorBoundary wrappers — acceptable since they're the auth-bootstrap region, but inconsistent with the post-auth route convention. | Optional: add `<ErrorBoundary label="...">` around each `<Route>` in those three pre-Router branches. |
