# Handoff — Equipment picker (session continuation prompt)

Paste this into a new session to pick up where the last one stopped.

---

## Start here

You are continuing work on **Flexyn** (`~/flexyn2`), a fitness PWA.
Read `CLAUDE.md` first, then:

- `docs/gym-equipment-picker-research.md` — evidence base, licensing constraint
- `docs/gym-equipment-picker-prompt.md` — the phase-by-phase build log, with
  every decision and every bug found, in order

Branch **`equipment-picker`**, already fast-forwarded to `main`.
Last commit: `23d1cbb`. Working tree clean, `origin/main` in sync.

## What the feature is

Inside an active workout, a dropdown next to each exercise title records the
**specific implement** the lifter is on — their gym's Hammer Strength row
rather than "a row", or their own Bowflex 552s at home. Gyms describe their
floor so members' pickers lead with real machines.

**Phases 0–6 are complete and shipped.** Migrations 268 through 273 are all
**applied to production** — do not hand Kegan SQL for them. 271 (one home
space per owner), 272 (uploads bucket accepts video) and 273 (own-object
SELECT so delete works) were added and applied on 2026-07-31; see the two
sections below for what each was for.

## Non-negotiables (learned the hard way, don't relitigate)

1. **Never ship manufacturer product photography or brand logos.** Brand and
   model names as *text* are nominative use and fine. Images come from users,
   falling back to drawn silhouettes. See `ATTRIBUTIONS.md`.
2. **Mobile-only.** ≥44px targets, no hover-only affordances, `MobileSelect`
   or `BottomSheet` rather than bare shadcn `Select`.
3. **Test RLS by executing the attack, not by reading the policy.** Raw SQL
   through the Supabase MCP runs as `postgres` and **bypasses RLS entirely** —
   it proves nothing. Use:
   ```sql
   BEGIN;
   SET LOCAL role authenticated;
   SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
   -- ...the exact statements the client makes...
   ROLLBACK;
   ```
   This is how the mig-270 hole was found after five clean "reviews" missed it.
   CTEs in one statement can't see each other's writes, so multi-step client
   flows must be separate statements or you'll get a false "blocked".
4. **`i18n-check.js` already exists** — a DEV checker with `ALLOW_IDENTICAL`
   and `ALLOW_IDENTICAL_BY_LANG`. Don't rebuild it. `scripts/i18n-audit.mjs`
   is the CLI counterpart; keep their exclusions in sync.
5. **Machine translation is a documented one-off**, not precedent. See the
   `i18n-equipment.js` header and `CLAUDE.md`. Don't extend it to prose without
   asking.
6. **Push straight to main** (branch first, then fast-forward). Check
   `git log` before claiming anything is uncommitted — a parallel session
   stages the whole tree.

## Key files

| File | Role |
|---|---|
| `src/lib/equipmentCatalog.js` | Vocabulary: 26 brands, 57 implement types, 50 seed models, exercise→implement map, `snapToSelectable` |
| `src/lib/equipmentImage.js` | Image fallback chain; `REFERENCE_IMAGES` deliberately empty |
| `src/lib/recentImplements.js` | Per-user pick history (localStorage) |
| `src/lib/data/equipment.js` | All DB access; every function degrades to null rather than throwing |
| `src/components/workout/ImplementPicker.jsx` | The in-workout dropdown |
| `src/components/workout/EquipmentThumb.jsx` | Thumbnail — kept separate so the gym page doesn't pull 31 KB of picker |
| `src/components/gyms/GymEquipmentTab.jsx` | Member-facing floor list, on GymHub |
| `src/components/gyms/GymEquipmentEditor.jsx` | Owner's pill-grid editor, in GymEdit |
| `supabase/migrations/268/269/270` | Schema, data fixes, security gate |
| `supabase/migrations/271/272/273` | Home-space uniqueness, bucket MIME types, own-object SELECT |

## Open items, highest value first

1. ~~**The upload path has never run end-to-end.**~~ **DONE, 2026-07-31.**
   Run through the real UI on the deployed site: opened the picker on Bench
   Press, selected Rogue Ohio Bar, and injected a 1.8 MB camera-sized JPEG
   into the actual `capture="environment"` input, so `compressImage` really
   re-encoded (the file is deliberately over its 64 KB `minBytes` guard —
   under that it short-circuits and the canvas path never runs). Upload
   landed, the thumbnail rendered from the public URL, and all four rows
   wrote: `training_spaces` home/"My gear" → `equipment_models`
   rogue/barbell/**approved=false** → `space_equipment` with `photo_url` set
   → `equipment_photos` **is_primary=true**. Test rows have been cleared.
   Also verified independently at two lower layers, either of which is a
   reusable recipe:
   - **SQL under real RLS** — the exact client statements as `authenticated`
     (`SET LOCAL role` + JWT claims, each step separate, `ROLLBACK`), on a
     user with no home space. All four writes plus three read-backs pass.
   - **The HTTP APIs** — a node probe signing in with `signInAnonymously()`
     and driving Storage + PostgREST the way the app does. This is the layer
     SQL cannot reach: a bucket MIME allowlist is enforced by the Storage
     service, not the database.
   `src/lib/data/__tests__/equipment.test.js` (24 tests) pins the client half:
   statement sequence, payloads, the `.is(col, null)` identity filter,
   `approved: false`, the 23505 re-reads, "don't steal an existing primary".
   Sentry tags if it regresses: `equipment.homeSpace`, `equipment.attachPhoto`.
2. **Native review of the translations.** ~3,000 machine-translated strings.
   `docs/i18n-review-brief.md` + two CSVs are ready for a human. The 12 HIGH
   rows matter most — `formcoach.betaDisclosure` tells users their camera
   images never leave the device. Claude cannot do this review; don't offer to.
3. ~~**`getOrCreateHomeSpace` can race** into two "My gear" spaces.~~ **DONE**
   — migration 271, applied 2026-07-30. Verified by executing the race as
   `authenticated`: the second home-space insert is blocked with 23505, the
   first still succeeds, and gym-kind spaces are unaffected (the index is
   partial on `kind = 'home'`).
   The client half mattered more than the index: with it in place the losing
   racer's INSERT returns 23505, and the old code reported it and returned
   null — so the index alone would have converted a harmless duplicate into a
   silently dropped photo. `getOrCreateHomeSpace` now re-reads the winner.
   `getOrCreateGymSpace` got the same fix and that one was never hypothetical:
   `UNIQUE (owner_id, gym_id)` has rejected the loser since mig 268, so two
   quick contributions to a gym floor could already come back null in
   production. Both paths covered in `equipment.test.js`.
   Mig 271 deliberately does NOT merge pre-existing duplicates — deleting a
   duplicate space cascades away its photos, re-parenting collides with
   `UNIQUE (space_id, model_id)`, and choosing which photo set survives is a
   human call. It creates the index only while zero duplicates exist and
   otherwise warns with the count.
4. **`equipment_models`' SELECT policy nests three levels of RLS** per row.
   Fine at 50 rows, wants a SECURITY DEFINER helper at thousands.
5. **Phase 4's owner-curation is only exercised on one gym.** Camp
   Quannapowitt (`WKF2QPWT`) is the only gym with an owner; the other 25 are
   deliberately ownerless demo seeds. Owner controls render for nobody on
   those, which is correct, not a bug.

## Found while testing the picker — unrelated to it, all fixed 2026-07-31

Chasing "my two device tests showed success toasts but wrote nothing" turned
up three defects that had nothing to do with the equipment picker. Worth
reading, because each was silent and each had been live for weeks.

- **The app was not registering a service worker at all** (fixed in
  `AppUpdatePrompt.jsx`). The dynamic `import('virtual:pwa-register')`
  carried a `/* @vite-ignore */`, which tells Vite not to resolve the
  specifier — so the virtual module was never bundled and at runtime the
  browser tried to import a bare string that isn't a URL. It rejected, the
  `.catch(() => null)` swallowed it, and `registerSW` was never called. Dead
  since the file was created on 2026-05-23. Consequences: no precache, no
  offline shell, no update prompt, and — because `usePushSubscription`
  awaits `navigator.serviceWorker.ready`, which never resolves without a
  registration — **push opt-in hung silently**, which is why production has
  exactly one push subscription. Verified fixed on the live authenticated
  page: the app fetches the pwa-register chunk, `/push-sw.js` controls the
  page, and `ready` resolves.
- **The `uploads` bucket rejected every video** (migration 272). Its
  `allowed_mime_types` was images-only while `_uploadFile` accepts mp4 /
  mov / webm, so Hub video posts and story videos had **never once
  succeeded** — zero video objects and zero video `hub_posts` since the
  project was created. The client also advertised 100 MB, which the Free
  plan's 50 MB global cap makes impossible, so `VIDEO_MAX_BYTES` and four
  pieces of copy came down to 50 MB rather than the bucket going up. Same
  commit fixed `contentType: SAFE_MIMES[ext]`, which was `undefined` on the
  video branch (`ext` is `''` for video; `VIDEO_MIMES` was declared and never
  used) — so the "never trust client-supplied `file.type`" comment above it
  wasn't true for videos.
- **`remove()` deleted nothing and reported success** (migration 273).
  Storage resolves a delete's targets with a SELECT first, and mig 185
  dropped the bucket's only SELECT policy to stop enumeration. Measured as
  the owning user: listing own prefix returned `[]` with two real objects in
  it, `DELETE` returned 200 and `[]`, the object still served 200. Every
  failed-after-upload cleanup in the app was orphaning its blob —
  `HubChat.jsx` ×2, `HubComposer.jsx`, `stories.js`. Mig 273 adds a SELECT
  policy scoped to the caller's own uid prefix, matching the DELETE/UPDATE
  policies 185 left alone, so delete works and cross-user enumeration stays
  closed (verified: own prefix visible, another user's returns 0, root
  listing shows only your own folder).

## Things that will bite you

- **`gym_businesses.owner_id` is nullable ON PURPOSE** (mig 137). Demo gyms
  have no owner. Do not "restore" the NOT NULL and do not backfill owners onto
  demo rows. I misdiagnosed this once and it's documented in the prompt doc as
  a retraction.
- **`classifyEquipment` is NOT the gate** for the picker — it's wrong on ~25
  of the exercises that matter. `implementTypeForExercise` overrides it. Don't
  "fix" the classifier; its other consumer depends on current behaviour.
- **`Workout.jsx` rebuilds exercise objects key-by-key in several places.**
  `:507` and `:1330` carry `equipment` forward; the save-path maps use spread.
  Anything new on an exercise must be added to those rebuilds or it vanishes.
- **Two effects in `ExerciseLogger` share one `onChange`** deliberately. As
  separate effects they clobbered each other. Anything else seeded there must
  join that effect, not add a third.
- **Radix `Select` throws on an empty-string item value.** Use a sentinel.
- **Part files have inconsistent shapes** — nested `lang: {}` in most,
  top-level `const ru = {}` in part10, `missingKeys.es = {}` in part9. A
  patcher that assumes one shape silently does nothing.
- **`equipment_models` is EMPTY in production and that is correct.** The "50
  seed models" live in `SEED_MODELS` in `src/lib/equipmentCatalog.js`, a
  client-side vocabulary — neither mig 268 nor 269 inserts a single row. The
  table only ever fills from user submissions, as a dedupe target. The picker
  lists Rogue and Eleiko bars off the bundled catalog while the table has
  zero rows. Don't read `count(*) = 0` as missing seed data.
- **A build hash from the device is worth more than any amount of
  theorising.** Two "successful" device tests wrote nothing because the phone
  was running `b4dd418` from 2026-05-21 — ten weeks stale, and a build in
  which the picker does not exist. Every server-side check said the backend
  was healthy, and it was. Settings → footer → tap the build label copies
  build hash + date + UA. Ask for that FIRST when a device report and the
  database disagree. The live hash is readable from the served bundle, so the
  two can be compared directly.
- **`storage.protect_delete()` is not an absolute block.** Deleting from
  `storage.objects` raises `42501` with "Use the Storage API instead", but the
  function only checks a session setting. `BEGIN; SET LOCAL
  storage.allow_delete_query = 'true'; DELETE …; COMMIT;` works, and is the
  only route when the object's owning user no longer exists (the prefix-scoped
  policy means nobody else can delete it). Caveat: this removes the metadata
  row, so the underlying blob may be orphaned in S3 — prefer the Storage API
  whenever the owner can still authenticate.
- **`AppUpdatePrompt` (and everything beside it in `App.jsx`'s main render)
  does not mount when signed out.** Five early returns sit above it —
  loading, `user_not_registered`, `auth_required` → `SignInToContinue` /
  `Onboarding`, incomplete onboarding, and the stashed-token bail. Measuring
  anything global (service worker, prompts) on the signed-out marketing or
  onboarding screens will show it missing whether or not it is broken. I drew
  a wrong conclusion from exactly this before catching it.

## How to verify anything here

```bash
npm run test          # 2366 tests / 167 files, all green
npx eslint src        # 0 errors
npm run build
node scripts/i18n-audit.mjs            # summary
node scripts/i18n-audit.mjs --partial  # the real i18n gaps
```

There is **no local Postgres** (Docker isn't installed), so migrations can't
be parsed offline — the first real parse happens on apply.

**Three layers, and each catches what the one below cannot.** Every real bug
this session was found by dropping to a layer the previous one couldn't see:

1. **SQL as `authenticated`** (`SET LOCAL role` + JWT claims, separate
   statements, `ROLLBACK`) — proves RLS. Cannot see PostgREST or Storage: a
   bucket MIME allowlist is enforced by the Storage service, and mig 272's bug
   was invisible from here.
2. **A node probe** using the anon key from `.env.local` and
   `supabase.auth.signInAnonymously()`, driving the real HTTP APIs. Proves the
   service layer. Cannot see the browser: no `compressImage`, no file input.
   Clean up whatever it writes, and note that `remove()` no-ops if mig 273 is
   ever reverted.
3. **The deployed site in the browser pane.** A file input can be driven
   without a real file — build a `File` (canvas → `toBlob` for an image,
   `MediaRecorder` on a canvas stream for a genuinely decodable video), assign
   it via `DataTransfer` to `input.files`, and dispatch `change`. That is how
   the picker's photo path was finally exercised.

Sign in first (see the `App.jsx` early-return note above), and remember the
browser pane's own tab may already hold a guest session.

## Working style Kegan expects

Short one-line progress notes, not detailed summaries. State what's verified
versus what's assumed, and flag it explicitly when something is unverified —
several real bugs in this feature were found only because a claim got checked
instead of trusted.
