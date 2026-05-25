# Column drift audit — code vs. migration schema

Generated 2026-05-24. Audited `src/lib/data/*.js`, `src/hooks/*.js`, `src/api/*.js`,
and `src/components/**/*.{jsx,js}` against `supabase/migrations/*.sql`.

**Method:** Extracted column lists from every `CREATE TABLE` / `ALTER TABLE
... ADD COLUMN` in migrations (102 tables resolved). For each `.from('xxx')`
in code, parsed the chained `.eq()`, `.neq()`, `.gt/gte/lt/lte()`, `.like()`,
`.ilike()`, `.in()`, `.contains()`, `.order()`, `.is()`, `.filter()`, `.match()`,
`.or()` calls; the column lists in `.select('...')`; and the object keys in
`.update({})`, `.insert({})`, `.upsert({})`. Cross-referenced each column
against the schema for that table. Unknown tables (views, storage, external)
were skipped: `avatars`, `regimen_review_aggregates`, `uploads`. Test files
excluded.

## Findings

| Severity | File:line | Table | Column referenced | Actual columns | Suggested fix |
|---|---|---|---|---|---|
| critical | `src/lib/data/crews.js:284` | `regimens` | `clone_count` (in `.update()`) | `copy_count` is the correct column (see `migrations/005_missing_columns.sql:69` and `migrations/042_security_hardening.sql:121`) | Rename `clone_count` → `copy_count` in the update payload. Currently the write throws 42703 and is swallowed by `.catch(() => {})` — clone counter for shared regimens never increments. |
| critical | `src/lib/data/crews.js:300` | `regimens` | `clone_count` (in `.select()`) | `copy_count` (same migration as above) | Change `.select('clone_count')` to `.select('copy_count')` and `data?.clone_count` → `data?.copy_count` on line 304. Currently `getRegimenCloneCount()` always returns 0; the RegimenMessage UI in `CrewMessageItem.jsx:534` shows a permanent "0 clones" badge regardless of real adoption. |

## Coverage notes

- All 102 in-schema tables were audited. Two findings, both in the same
  file, same defect, same column → likely a single oversight when the
  feature was wired up. The increment is fire-and-forget (`.catch(() => {})`),
  so it would never have surfaced as a user-facing error toast.
- The auditor's parser tolerates: PostgREST embedded selects (e.g.
  `id, author:user_id(name)` — the embedded relation name is skipped),
  column aliases (`alias:real_col`), casts (`col::text`), and `*` wildcards.
- Tables where the convention "looks obvious" but is actually
  non-standard — all verified clean in current code:
  - `user_mutes` uses `muter_id` (not `user_id`) — clean in
    `src/lib/data/userMutes.js`. Fixed in commit e2d65b2.
  - `user_blocks` uses `blocker_id` (not `user_id`) — clean in
    `src/lib/data/userBlocks.js`.
  - `hub_follows` uses `followee_email` (not `followed_email`) — only
    defensive fallback references to `followed_email` remain in
    `HubMessages.jsx:148` and `NewGroupDMModal.jsx:43`, which is
    intentional shape-tolerance code, not a defect.
  - `story_blocks` uses `blocker_id` + `blocked_email` — clean.
  - `status_note_likes`, `story_likes`, `story_reactions` use
    `liker_id`/`liker_email` style — clean.
  - `regimens.copy_count` — flagged here, see above.
  - `workout_templates.copy_count` — clean (no code references the
    wrong name).
- The two findings here exhaust the defect class within the auditor's
  current scope. No "more than 50 findings" tail.

## What this audit does NOT cover

- RPC argument-name drift (e.g. `p_user_id` vs `p_user`) — `.rpc()` calls
  with mis-named params would return a different error class and were
  out of scope.
- SECURITY DEFINER function bodies — the 108 privacy bug was a logic
  issue inside a RPC, not a column reference. Needs a separate audit.
- View column references — three unknown tables (`avatars`,
  `regimen_review_aggregates`, `uploads`) are likely views or storage
  metadata; their selects weren't audited.
- JSONB key references inside `metadata` / `data` / `read_by` /
  `participant_emails` etc. PostgREST tolerates arbitrary JSONB keys, so
  drift there is a product-logic concern, not a 42703 concern.
- Computed selects like `.select('id', { count: 'exact', head: true })`
  — the second arg is an options object and is correctly skipped.
