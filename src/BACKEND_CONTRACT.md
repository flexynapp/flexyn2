# Backend Contract

This document defines the data and operations the Flexyn app expects from
its backend. The current implementation runs on Base44; this contract
exists so that any future backend (Firebase, Supabase, AWS Amplify, custom
Node, etc.) can be implemented to match the same shape, with no changes
required in the app's UI code.

The app's only contact with the backend is through `src/lib/data/*` — if
those modules behave per this spec, every page and component continues
to work.

---

## 1. Authentication

The backend must authenticate users by email. The current user is exposed
to the app as a `User` record with at minimum:

- `id` — string, server-assigned
- `email` — string, unique, immutable per account
- `full_name` — string, optional
- `created_date` — ISO 8601 timestamp, server-assigned on create

The app calls:
- `me.get()` → returns the current `User` record
- `me.update(partial)` → updates the current `User` record (atomic per-field)
- `me.logout()` → ends the session

---

## 2. The `User` record (extended fields)

In addition to the base auth fields, the app stores these on `User`:

| Field | Type | Purpose |
|---|---|---|
| `username` | string | Display name, profanity-filtered |
| `gender` | string\|null | 'male' / 'female' / 'other' |
| `birthday` | ISO date string\|null | YYYY-MM-DD |
| `height_inches` | number\|null | Stored in inches regardless of display unit |
| `weight_lbs` | number\|null | Stored in lbs regardless of display unit |
| `weight_unit` | string | 'lbs' / 'kg' / 'stone' (display preference) |
| `distance_unit` | string | 'mi' / 'km' (display preference) |
| `preferred_language` | string | ISO 639-1 code |
| `preferred_theme` | string | Theme id |
| `dark_mode` | boolean | |
| `country_code` | string\|null | ISO 3166-1 alpha-2 |
| `state_code` | string\|null | USPS abbreviation, only when `country_code === 'US'` |
| `onboarding_complete` | boolean | Gates routing to /dashboard |
| `account_reset_at` | ISO timestamp\|null | When the user last reset/deleted their account; client uses this to filter stale records |
| `total_xp` | number | Cumulative XP — **MUST support atomic increment** |
| `achievements_unlocked_count` | number | **MUST support atomic increment** |
| `total_volume_lbs` | number | Lifetime workout volume — **MUST support atomic increment** |
| `total_distance_meters` | number | Lifetime cardio distance — **MUST support atomic increment** |
| `avatar_url` | string\|null | URL to the user's profile picture (uploaded via Core.UploadFile) |

### Critical: atomic counter increments

The four counter fields (`total_xp`, `achievements_unlocked_count`,
`total_volume_lbs`, `total_distance_meters`) **must be incremented
atomically server-side**. The current Base44 implementation does
client-side read-modify-write, which produces lost updates under
concurrent saves. On the migration target, expose:

```
serverFunctions.incrementUserCounter(field, delta)
```

…or fold the increments into the existing
`updateUserXpAndAchievements` server function.

---

## 3. Entities (per-user records)

Every entity below has these common fields:
- `id` — server-assigned string
- `created_by` — email of the owner; backend MUST scope all reads to this
- `created_date` — ISO timestamp, server-assigned

### `WorkoutLog`
- `date` — YYYY-MM-DD
- `duration_minutes` — number\|null
- `notes` — string
- `regimen_id` — string\|null
- `regimen_name` — string
- `exercises[]` — array of `{ name, displayName?, muscle_group, muscle_groups[], sets[{weight, reps}], duration_minutes? }`

### `CardioLog`
- `date` — YYYY-MM-DD
- `type` — string (`running_outside`, `walking_treadmill`, etc.)
- `distance_meters` — number
- `duration_seconds` — number
- `calories` — number
- `notes` — string

### `Regimen`
- `name` — string
- `description` — string
- `exercises[]` — array of `{ name, displayName?, target_sets, target_reps, muscle_groups[], notes }`

### `Goal`
- `name`, `exercise_name`, `exercise_canonical`, `target_value`, `target_unit`,
  `current_value`, `target_date`, `notes`, `completed`, `completed_date`

### `Achievement`
- `achievement_id` — references `ACHIEVEMENT_DEFINITIONS` in the client
- `unlocked` — boolean
- `unlocked_date` — ISO timestamp\|null
- `progress` — number 0–100

### `BodyMetric`
- `date` — YYYY-MM-DD
- `weight_lbs`, `body_fat_percent`, `chest_inches`, `waist_inches`, `hips_inches`, etc.

### `NutritionLog`
- `date` — YYYY-MM-DD
- `food_name`, `calories`, `protein_g`, `carbs_g`, `fat_g`, `meal_type`

### `WorkoutTemplate`
- `name`, `exercises[]`

### `ExerciseForm`
- `exercise_name` — string (cross-user lookup, not scoped to `created_by`)
- AI-generated form coaching tips, cached for reuse across users

### `FoodItem` (shared — NOT scoped to created_by on read)
- `barcode` — string, UPC/EAN barcode (indexed for fast lookup)
- `name` — string
- `serving_label` — string
- `source` — string: 'user_submitted'
- `nutrition` — object: { calories, protein, carbs, fat, fiber, sugar, sodium, cholesterol }
- `vitamins` — object: { calcium_mg, iron_mg, magnesium_mg, potassium_mg, vitamin_a_iu, vitamin_c_mg, vitamin_d_iu, vitamin_b12_mcg }

**Migration note:** On the new backend, add a unique index on `barcode` and ensure `findByBarcode` queries use it. This table will grow to millions of rows as users submit items — do NOT do a full-table scan.

---

## 4. Required server-side functions

| Function | Purpose | Migration priority |
|---|---|---|
| `updateUserXpAndAchievements({xp_gained, action_type, action_data})` | Award XP, recompute achievements, update unlocks. Atomic. | **Critical** |
| `deleteAccountData()` | Cascade-delete all records owned by current user. | **Critical** |

### Recommended additions for new backend (not present on Base44)

| Function | Purpose | Why |
|---|---|---|
| `getLeaderboard(metric, scope, country, state, limit)` | Server returns pre-sorted top-N users for a given metric and region. | Eliminates `User.list()` payload (which becomes 5MB+ at 5,000 users). |
| `incrementUserCounter(field, delta)` | Atomic increment of any counter field on the current user. | Eliminates client-side read-modify-write race. |

---

## 5. Query semantics

The data layer expects these query primitives on each entity:

- `filter(query, sort, limit)` — returns array of records matching `query`,
  sorted by `sort` (string field name; prefix with `-` for descending),
  limited to `limit` records.
- `create(data)` — creates a record owned by the current user.
- `update(id, partial)` — partial update of a record by id.
- `delete(id)` — deletes a record by id.

The `created_by` filter MUST be enforced server-side as a security check
even when the client passes it explicitly.

---

## 6. Backend status (post-migration)

The Base44 → Supabase migration is complete. The data client lives at
`src/api/db.js` and presents the same `entities.X.{filter,list,...}`
shape the rest of the app uses. Schema is owned by the SQL migrations
under `supabase/migrations/`.

The data-access seam at `src/lib/data/*` is still the convention —
business logic (pages, components, hooks) calls into the data layer;
the data layer calls the client. A future swap to another backend
would only need to rewrite `src/api/db.js` + the data-layer modules.

## 7. Server-side RPCs (security-critical)

State changes that involve multiple rows, or where the client could lie
about inputs, go through Postgres SECURITY DEFINER RPCs. Current set:

| RPC | Migration | What it protects |
|---|---|---|
| `increment_user_xp` | base | atomic XP accumulation |
| `increment_user_volume` | 023 | concurrent workout/cardio volume race |
| `increment_user_distance` | 023 | same for cardio distance |
| `set_post_reaction` | 024 | atomic like/dislike toggle (delete+insert+counter) |
| `purchase_listing` | 025 | marketplace race + cheat |
| `create_marketplace_listing` | 025 | ownership validation |
| `create_notification_for` | 026 | cross-user notification whitelist |
| `increment_league_xp` | 027 | concurrent XP earns lose updates |
| `claim_league_resolution` | 027 | double-fire reward double-grant |
| `claim_capsule_loot` | 028 | client-side roll cheat |
| (sticker trigger) | 029 | inventory ownership + canonical rarity |
| `complete_goal` | 030 | idempotent goal-complete double-credit |
| `increment_flex_coins` | 030 | atomic coin delta |

When adding a new flow with similar properties (atomic multi-row state
change, cross-user write, inventory-validated action), define a new RPC
in a fresh migration file. Always include a graceful client-side fallback
so the rollout window doesn't break pre-migration hosts.

---

## 8. Out-of-scope (handled client-side)

These features run entirely client-side and don't depend on the backend
beyond the entity reads/writes already documented:

- Profanity filter (`src/lib/profanityFilter.js`)
- XP / level calculation (`src/lib/xpSystem.js`)
- Achievement definitions (`src/lib/achievementDefinitions.js`)
- i18n (`src/lib/i18n-*.js`)
- Daily quote rotation (`src/lib/dailyQuotes.js`)
- Region data (countries, US states) (`src/lib/regions.js`)
- Realistic-limits anti-cheat (`src/lib/realisticLimits.js`)

These travel with the app to any new backend without changes.

---

## 9. Adding a new entity (development workflow)

When the app needs a new entity (e.g., friendships, custom exercises),
follow this exact order so the seam stays intact:

1. Add a Supabase migration file (`supabase/migrations/NNN_*.sql`) that
   creates the table + RLS policies + any required RPCs.
2. Copy `src/lib/data/_template.js` to `src/lib/data/<entityname>s.js`.
   Find/replace `__ENTITY__` with the entity name (matches the table
   name referenced by `db.entities.<Name>` in `src/api/db.js`).
3. Add `export * as <entityname>s from './<entityname>s';` to
   `src/lib/data/index.js`.
4. Document the entity in § 3 of this file with its field list.
5. If the new flow needs atomicity or cross-user writes, define an RPC
   in the same migration and add it to § 7's table.
6. In components / pages, import via the data layer:
   `import { friendships } from '@/lib/data';`
   then call `friendships.list(email)`, `friendships.create(...)`, etc.

The ESLint rule (`no-restricted-syntax` on `db.entities`) will fail
the build if any file outside `src/lib/data/` calls the client
directly. That's the safety net — if you forget steps 2–3, the build
tells you.

---

## 10. Hub (social layer)

Six entities form the social network. All use Base44 RLS, but several
important security and scale concerns are flagged for the migration target.

### Entities
- **HubPost** — feed content; `read` is open to all authenticated users; client-side enforces privacy='followers' filtering. **Migration target: enforce followers-only privacy server-side** to prevent direct API queries from bypassing the client filter.
- **HubFollow** — directed follow graph
- **HubReaction** — per-post like/dislike
- **HubComment** — post comments
- **HubConversation** — 1:1 conversation metadata
- **HubMessage** — DM bodies; RLS scopes read to sender or recipient only

### Critical security note: messaging is access-controlled, NOT end-to-end encrypted

The current `HubMessage` implementation provides:
- ✅ Transport security (HTTPS)
- ✅ Server-side authorization — only the sender or recipient can fetch a given message (RLS rule)
- ❌ End-to-end encryption (server can read message contents)

**On migration to a real backend, true E2E should be implemented** using:
1. Per-device key generation (Curve25519 / X25519)
2. Server-mediated public key exchange
3. Signal-style double ratchet for forward secrecy
4. Encrypted blob storage; server only sees ciphertext

Until then, do not market the messaging feature as "end-to-end encrypted."
"Private" or "secure" (in the access-control sense) is accurate.

### Counter atomicity — same as elsewhere

`HubPost.like_count`, `dislike_count`, and `comment_count` are denormalized
counters incremented client-side. **Atomic increment server functions are
required on migration** — concurrent reactions will race otherwise.

### Feed scaling — known not to scale past ~5K active users

The Squad feed currently fans out reads (one filter per followed user, up
to 100). At scale this becomes expensive. **Migration target: server-side
fan-out feed query** that returns one merged sorted result for a list of
follow targets.

The Pump (global feed) currently does an unfiltered list of all public
posts. At scale, this needs server-side pagination (cursor-based) and
indexing on `(privacy, created_date)`.

---

## 11. AI assistant instructions

If you are an AI agent writing code in this project, follow these rules:

1. **Never call `db.entities.X`, `db.auth.X`, or `db.functions.invoke`
   from any file outside `src/lib/data/`.** The build will fail.
   Use the data layer.
2. **If the data layer doesn't have a function you need, add it first**
   to the appropriate module in `src/lib/data/`, then use it.
3. **If you need a new entity**, follow § 9 above before writing the
   feature that uses it.
4. **Atomicity / security-critical flows go through an RPC** — see § 7
   for the pattern. Multi-row state changes, cross-user writes, and
   anything where the client could lie about inputs all qualify.
5. **Keep entity field shapes stable** — UI / pages should be able to
   move between backends with no changes if the data layer + RPCs
   provide the same surface.