# Flexyn

A fitness companion PWA — workouts, nutrition tracking, daily quests,
weekly leagues, and a social Hub. React + Vite + Supabase, deployed to
Netlify.

## Stack

- **Frontend**: React 18, Vite, Tailwind, Radix UI, Framer Motion,
  React Query, React Router
- **Backend**: Supabase (Postgres + RLS, Auth, Storage, Edge
  Functions, pg_cron, pg_net, Vault, supabase_vault)
- **PWA**: vite-plugin-pwa with a custom service worker
  (`src/lib/push-sw.js`) — Web Push delivery, offline-tolerant shell,
  network-first navigation
- **Pose detection**: `@mediapipe/tasks-vision` Pose Landmarker (lazy-loaded
  for the Form Coach feature only)
- **Maps**: `maplibre-gl` + OpenFreeMap vector tiles (lazy-loaded for cardio route rendering only)
- **i18n**: 15 languages with per-language code splitting

## Local development

Prerequisites: Node 18+ and a Supabase project.

```bash
git clone <this repo>
cd Flexyn
npm install
cp .env.example .env   # if it exists; otherwise create one manually
# Edit .env with your Supabase + VAPID values (see below)
npm run dev
```

### Required environment variables

```bash
# .env (local) — also set these in Netlify env vars for production
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key-from-project-settings>

# Optional — only needed if you want Web Push to work locally.
# Generate with the snippet in docs/push-notifications-setup.md
VITE_VAPID_PUBLIC_KEY=<vapid-public-key>
```

### Available scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server + i18n aggregator in watch mode |
| `npm run build` | Production build to `dist/` (used by Netlify) |
| `npm run build:i18n` | Re-aggregate per-language i18n bundles (auto runs in `dev` and `build`) |
| `npm test` | Vitest run, 306+ unit tests |
| `npm run lint` | ESLint (errors only) |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run typecheck` | TypeScript check via `jsconfig.json` |

## Deploying

### Frontend (Netlify)

Netlify auto-builds on every push to `main`. Configuration is in
`netlify.toml`. Set the env vars above in Netlify's Site
Configuration → Environment Variables.

### Backend (Supabase)

The database side is a stack of plain-SQL migrations in
`supabase/migrations/`, applied via the Supabase SQL Editor. See
[`docs/migrations-runbook.md`](docs/migrations-runbook.md) for the
canonical order, what each migration does, and a state-check query.

For the **push notification pipeline** specifically — which spans the
database trigger, Edge Function, VAPID keys, and Vault secrets — see
[`docs/push-notifications-setup.md`](docs/push-notifications-setup.md).

## Architecture cheat sheet

```
┌─────────────────────────┐
│  Client (PWA shell)     │
│  React + Router         │
│  - main entry chunk     │ ←── Lazy-loaded route chunks:
│  - vendor-misc          │      Dashboard, Workout, Hub,
│  - vendor-supabase      │      Nutrition, Progress
│  - service worker       │
│  - error reporter +     │ ←── On bad deploys, paints a visible
│    SW kill-switch       │      error message instead of blank screen.
└──────────┬──────────────┘
           │
           │  supabase-js (Auth, REST, Realtime, RPC)
           │
┌──────────▼──────────────┐
│  Supabase Postgres      │
│  - user_profiles, hub_  │
│    posts, notifications,│
│    leagues, etc.        │
│  - RLS on every table   │
│  - pg_cron jobs:        │
│      streak-break       │ ←── Insert notifications hourly
│      welcome-back       │      when users match the criteria.
│      quest-expiry       │
│  - notify_push_fanout   │ ←── AFTER INSERT trigger on
│    trigger (pg_net)     │      notifications calls send-push.
└──────────┬──────────────┘
           │  HTTP via pg_net + X-Send-Push-Secret header
           │
┌──────────▼──────────────┐
│  send-push Edge Fn      │
│  - Validates trigger    │
│    secret (Vault)       │
│  - Reads VAPID keys     │
│  - web-push to every    │
│    subscription row     │
└─────────────────────────┘
```

## Notification system overview

Every retention-relevant event (quest claim, streak milestone, league
result, friend posted, etc.) writes a row to the `notifications`
table. From there:

1. **In-app**: a React Query subscription on the bell-icon component
   reads the row and shows it in the panel.
2. **Push**: an AFTER INSERT trigger on the table fires a fire-and-forget
   `pg_net.http_post` to the `send-push` Edge Function, which fans out
   Web Push to every device the user has subscribed.

Three cron jobs proactively insert rows for users who haven't acted on
their own (streak-break warning at 18:00 local, welcome-back at 18:00
local after 3+ idle days, quest-expiry at 21:00 local with incomplete
quests).

Text is rendered **server-side, per-recipient** for cross-user
notifications (league resolutions, friend follows, friend posts,
welcome-back, streak-break, quest-expiry) — see helpers in migrations
035, 037, 040, 041. Each recipient sees the notification in their own
`preferred_language`, not the sender's.

Per-category opt-out controls live in **Settings → push notifications**
(stored in `user_profiles.notification_prefs` JSONB; trigger respects
the prefs before dispatching).

## Performance characteristics

After the perf pass in this codebase:

- **vendor-misc**: 587 KB minified (down from 1454 KB before the audit)
- **Entry chunk**: 293 KB (overlays are lazy)
- **Code-split routes**: Dashboard, Workout, Hub, Nutrition, Progress
- **Lazy on-demand chunks**: `vendor-charts` (Dashboard/Progress only),
  `RouteMap` (cardio detail only), `@zxing/browser` (barcode scan
  only), `canvas-confetti` (level-up only), `vendor-pose`
  (Form Coach only)
- **Service Worker strategy**: NetworkFirst for navigations (so new
  deploys self-heal), precache for content-hashed assets

## Documentation index

- [`docs/migrations-runbook.md`](docs/migrations-runbook.md) — every
  SQL migration in order, what it does, what follow-up it needs
- [`docs/push-notifications-setup.md`](docs/push-notifications-setup.md) —
  full Web Push pipeline setup (VAPID, Edge Function, Vault, smoke
  test, troubleshooting)
- [`docs/verification-checklist.md`](docs/verification-checklist.md) —
  pre-deploy checklist
- [`supabase/tests/cron_smoke_tests.sql`](supabase/tests/cron_smoke_tests.sql) —
  paste-and-run grid that verifies cron + helper functions
- [`src/VERIFICATION_CHECKLIST.md`](src/VERIFICATION_CHECKLIST.md) —
  manual QA checklist for major features
