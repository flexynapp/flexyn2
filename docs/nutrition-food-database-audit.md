# Audit — Nutrition, the Food Database

Run 2026-08-12 against `origin/main` @ `77690599` (rebased onto `3ce405e7`)
and production (`ebvqxuwfiptcmlkhflfj`). Four sub-features were named in the
brief: Search by name, Filter by Macro Profile, Barcode Scan, Add custom food.

**One of the four does not exist. The moderation queue that is the whole point
of this feature is enforced in the client only — verified by executing the
bypass against production as a real non-admin user.** Short version:

| # | Sub-feature | Verdict | |
|---|---|---|---|
| 1 | Search by name | **(a) exists and works** | but it searches YOUR foods, not a database — deliberately. Its ranking failed its own documented example — **FIXED** |
| 2 | Filter by Macro Profile | **(d) absent** | no macro filter or sort anywhere. Never built. **Not started — needs your call** |
| 3 | Barcode Scan | **(b) exists and is broken** | four blank label fields served to every scanner as hard zeros; a nutrient the label lacks rendered "0% DV" beside an em dash — **both FIXED** |
| 4 | Add custom food | **(c) partially wired, and a misnomer** | reachable only from a failed camera scan; 0 requests ever filed; the sheet promised to publish; the database does not enforce the review — **copy FIXED, migration 345 handed over** |

Everything measured here decays. Re-measure before quoting it.

---

## The verdict I was sent to correct, and what it teaches

`docs/nutrition-meal-logging-audit.md` (2026-08-11) states as one of five
headline verdicts: *"Search Food Database — (d) ABSENT. There is no text search
over food anywhere in the application… This was never built."*

**That was true when written and is false now.** Commit `6a7929ff` shipped
`FoodSearchSheet.jsx` and `foodSearch.js` after that audit was written. I read
the sheet rather than inheriting the verdict, and that document now carries a
dated amendment pointing here.

The same decay is already visible inside this feature at one-migration scale.
Two code comments name **migration 342** as the file that created
`food_item_requests`; it is **343**. 342 is the cross-user row-injection RLS
fix. Both corrected.

**So date your claims.** A verdict is a measurement with a timestamp.

---

## Ground truth — re-verified line by line

The brief's block was checked before any of it was used. **It held exactly**,
with two additions and one correction.

| Claim | Verified |
|---|---|
| `food_items` 2 rows, ONE user (`keganbergeron@gmail.com`) | ✅ exact |
| barcode 2 of 2 · brand 0 of 2 · `nutrition` 2 of 2 · `vitamins` 2 of 2 | ✅ exact |
| `is_verified` true 0 of 2 · `source = 'user_submitted'` on both | ✅ exact (and 0 NULL — both are literally `false`) |
| THREE RLS policies on `food_items`, doing three different things | ✅ exact, expressions verbatim |
| `food_item_requests` 0 rows, insert-own + select-own only, no admin policy | ✅ exact |
| `nutrition_logs.food_item_id` still 0 of 126 | ✅ exact |
| Four SECURITY DEFINER functions mention `food_item` | ✅ exact |

Two things to add:

- **`food_items.barcode` carries a UNIQUE index** (`food_items_barcode_key`,
  partial `WHERE barcode IS NOT NULL`). So `lookupCommunity`'s "fetch ten
  candidates and pick the newest client-side, because multiple users can submit
  the same barcode" is defending against a row the database cannot hold. Not a
  bug — dead defensiveness, left alone, recorded here so the next reader does
  not take that comment as evidence duplicates exist.
- **`admin_purge_user_data` deliberately EXCLUDES `food_items`** from its
  email sweep (`table_name NOT IN ('admin_users', 'food_items')`). A deleted
  account's email address therefore stays in `created_by` — in a row every
  signed-in user can read. See check 5.

One correction to the brief: `admin_purge_user_data` is **not** granted to
`authenticated` (`{postgres=X,service_role=X}`), so it is not one of the
functions a signed-in user could call at all.

---

## Rule Zero — does each sub-feature exist?

### 1. Search by name — (a) exists and works

`FoodSearchSheet.jsx` (210 lines) → `rankFoodMatches` in `foodSearch.js`,
reached from a full-width Search button at the top of `LogMealForm` and from
`Nutrition.jsx:2300`. A pick FILLS the form; it does not log.

**The hypothesis in the brief holds, and it is a design, not a bug.**
`listMineForSearch` is `created_by = <the caller>` and the three merged sources
are all local: the user's own `food_items` rows, their own recipes, their own
diary. No user can find another user's food by name, and no query touches the
shared catalogue.

That is stated in two head comments as a deliberate boundary, with a reason
that survives inspection: it is what lets the sheet filter on every keystroke
with no network call, and Open Food Facts' own documentation says not to wire
their search to a search-as-you-type field. The pick-fills-rather-than-logs
split is likewise documented and correct.

**So the name over-promises and the code is right.** "Search by name" reads as
a catalogue search; it answers "what have I eaten". Unlike meal-plans' "View
Assigned Plan", this is not working code behind a name that promises something
absent — it is working code behind a name that promises something *wider*. The
honest fix is the label, not the query. Not renamed here: the string is
`nutrition.search.title` = "Search", which is accurate; what oversells it is
the brief's own feature name.

One real defect, found by rendering — see defect 1.

### 2. Filter by Macro Profile — (d) ABSENT

There is no macro filter, sort, or range control anywhere in the food database
or the Nutrition page.

- A grep for `macro.?filter|filterBy|minProtein|maxCarb|protein.?range|highProtein|lowCarb|macroProfile`
  across all of `src/` returns nothing but unrelated hits in a hub-messages
  test.
- `FoodSearchSheet` has one control: the text input. No sort, no filter, no
  chips.
- `rankFoodMatches` ranks on **name only**, then usage, then recency, then
  alphabetical. It carries every macro on each entry and never reads one.
- Checked the two places the brief said to check before concluding.
  `LogMealForm`'s tab bar is nutrients / vitamins / history — data entry, not
  filtering. `MacroNutrientBox`'s only `filter` is a JS array filter over its
  own tiles (the 2026-08-11 display fix) and its only button toggles a net-carbs
  explainer.

Nothing was removed: no comment, migration, or deleted file anywhere refers to
a macro filter. **This was never built. I did not start it — building it is new
product work and it needs your call.** A note on what it would cost, since the
recon is done: the ranking module is a pure function that already carries
`protein_g / carbs_g / fat_g / fiber_g / sodium_mg / sugar_g` per entry, so the
filter itself is a predicate before the sort. The hard part is not the code —
it is that with two catalogue rows and eight logged meals there is almost
nothing to filter, and that ten of the sixteen nutrients cannot be stored at
all until migration 006 lands (inherited finding, still open).

### 3. Barcode Scan — (b) exists and is BROKEN

The chain is real and each link was read: `barcodeHints.js` (TRY_HARDER +
retail formats) → `barcodeScan.js` (multi-orientation frame decode) →
`foodLookup.js` (community `food_items` → Open Food Facts) →
`BarcodeResultModal` on a hit, `BarcodeNotFoundModal` on a miss. Well
commented, well tested (16 tests across three files before this audit), and
the USDA tier's removal is documented honestly.

Two defects, both unconditional and both on the read path — defects 2 and 3.

### 4. Add custom food — (c) partially wired, and a misnomer

**There is no path to add a food that does not begin with a camera barcode
scan.** `setNotFoundBarcode` has exactly one call site
(`Nutrition.jsx:1162`, inside `lookupAndShow`, when `lookupBarcode` returns
null). There is no manual barcode field anywhere — a grep for
`manualBarcode|enterBarcode|typeBarcode` returns nothing. So loose produce, a
home-cooked meal and a restaurant plate cannot be added to the food database at
all; the recipe builder is the only alternative and it writes a private
`nutrition_recipes` row.

**And the queue has never run once.** `food_item_requests` is 0 rows. That is
not evidence of a bug: the precondition is a barcode miss on a real scan
*since 6a7929ff shipped on 2026-08-11*, and the two `food_items` rows that
exist were created 2026-07-16/17 by the direct-write path 343 replaced. So the
precondition has held twice in this feature's life, both times before the queue
existed. **Unexercised, not broken** — with one exception, which is that the
part nobody has run is also the part nothing enforces (defect 4).

Two defects here — defects 4 and 5.

---

## Checks — claim / proof / failure

**1. Does `matchRank` deliver the ordering its own head comment specifies?**
*Claim:* `foodSearch.js` says the tiers exist so that "chicken" puts *Chicken
breast* above *Grilled lemon chicken*, and both above *Chicken-fried steak
sauce*. *Proof:* mount `FoodSearchSheet` in a real browser with all three
sources populated and read the rendered order. *Failure:* the documented order.
**Rendered order before: Chicken breast, Chicken-fried steak sauce, Chicken
rice bowl, Grilled lemon chicken.** The sauce came SECOND. See defect 1.

**2. Is any nutrient on a scanned product a value nobody entered?**
*Claim:* the catalogue serves what its submitter typed. *Proof:* read both
production rows' `nutrition` jsonb against their flat columns, then trace
`pick()`. *Failure:* jsonb and flat agreeing everywhere. **They do not.**
`White Claw Surge (Pineapple)` has `protein/carbs/fat/fiber` explicitly
**null** in `nutrition` and **0** in the flat columns, whose DEFAULT is 0.
`pick = json[key] ?? flatNum(record[key])` resolved all four to 0. See defect 2.

**3. Does the scan result sheet claim a % DV for a nutrient it lacks?**
*Proof:* render the real row; read the text. *Failure:* the tile absent, or
present with no % DV. **Present, reading "0% DV" above "—mg"** for the one
nutrient (`cholesterol`) with no flat column to mask its null. The vitamin grid
twelve lines below handles the identical case correctly. See defect 3.

**4. Are the three admin RPCs a privilege hole?**
*Claim (from the brief's recon):* all three are `EXECUTE`-granted to
`authenticated` and an ILIKE over their source for `is_admin|admin_email|role.*admin`
returned FALSE — which reads exactly like an ungated SECURITY DEFINER function.
*Proof:* `pg_get_functiondef()` on the installed bodies, THEN call each one as a
real non-admin authenticated user, and as an admin, in both directions.
*Failure:* a call getting past the gate. **NO HOLE.** Every one opens with
`IF NOT public.is_app_admin(auth.uid()) THEN RAISE EXCEPTION 'admin_only' USING
ERRCODE='42501'`. Executed as `theerikvoelker@gmail.com`
(`7e92e7ff…`, asserted first: 0 rows in `admin_users`):
`list_food_item_requests_for_admin` → `42501 admin_only`,
`approve_food_item_request` → `42501 admin_only`,
`reject_food_item_request` → `42501 admin_only`. The same list call as
`keganbergeron@gmail.com` (in `admin_users`) → allowed, 0 rows. The grant is
fine because the gate is inside the body, and `is_app_admin` is itself a
SECURITY DEFINER `EXISTS` over `admin_users`, which holds two rows.

**The method is the finding here, not the outcome.** The heuristic got it
exactly backwards because the gate is spelled `is_app_admin`, which none of
those three patterns match. A grep over source text is not a reading of the
source, and reading the source is not executing it.

**5. Is `food_items` readable by users who do not own its rows, and does that
expose an email?**
*Proof:* `SET LOCAL role authenticated` + JWT claims as a non-owner, with the
probe identity asserted against the row owner **in the same call**.
*Failure:* 0 rows, or rows without `created_by`.
**2 of 2 rows visible, `created_by = keganbergeron@gmail.com` readable**, to a
user who owns neither row and is not an admin. `relrowsecurity` is on; this is
the "barcode community read" policy (`USING (barcode IS NOT NULL)`, and both
rows have a barcode) working as designed. The head comment on `foodItems.js`
is accurate that the table is not user-scoped on read.

But note the tension the brief flagged, because it is real:
`listMineForSearch`'s comment justifies client-side scoping on the grounds that
search "cannot surface an unapproved entry somebody else typed" — **and the
database would happily serve it.** That privacy claim is enforced *only* in the
client. Nothing exploits it today because Search is the only surface that would
show a name, and it filters. Recorded, not changed: opening the table's read
side is what the barcode waterfall needs.

The email is worth a separate sentence. `created_by` is an address, it is
readable by every signed-in user, and `admin_purge_user_data` explicitly skips
this table — so deleting an account leaves it. **Not fixed:** dropping or
hashing `created_by` on `food_items` is a schema change with an RLS policy
depending on it, and it is your call.

**6. Is the `TO PUBLIC` verified-read policy reachable by `anon`?**
*Claim (from the brief):* `is_verified` is 0 of 2 so nothing is exposed, but
CLAUDE.md documents a case where a `TO PUBLIC` policy was unreachable only
because the role lacked a GRANT. *Proof:* check the grant, then read as `anon`,
then seed one `is_verified` row and read again, then delete it and verify.
*Failure:* rows returned.
**`anon` DOES hold SELECT on `food_items`.** And the read still fails — with
`42501 permission denied for function current_user_email`, both with and
without a verified row present.

**The mechanism is not the one I would have predicted, and it matters.** It is
not that the verified policy returns nothing; it is that the OTHER policy on
the same table (`owner full access`, also `TO public`) calls
`public.current_user_email()`, which `anon` has no EXECUTE on — so the whole
SELECT errors before any policy can match. Permissive policies are OR'd, and
one of them throwing takes the query with it.

So: nothing is exposed today, by accident twice over. CLAUDE.md: depending on a
missing GRANT is not a boundary. Migration 345 scopes both read policies to
`authenticated`. **Note the trap this creates for anyone doing half the job:**
scoping only the owner policy to `authenticated` would have REMOVED the
throwing expression from `anon`'s evaluation and let the verified-read policy
succeed — opening the hole while looking like a fix.

**7. What reads `is_verified` and `source` on the client?**
*Proof:* grep `src/` for both. *Failure:* a reader.
**Nothing. Zero readers, in `src/` and in `pg_proc`** — the only `pg_proc` hit
for `is_verified` is `approve_food_item_request`, which writes it. Both column
mentions in `src/` are inside comments.

The consequence is bigger than a dead column: **`lookupCommunity` does not
filter on `is_verified`, so an approved record and an unreviewed one are served
to a scanner identically.** Two write paths produce two shapes
(`user_submitted`/false, `member_request`/true) and only the never-used one
produces a verified row — and nothing anywhere distinguishes them. Recorded,
not changed: filtering the waterfall on `is_verified` would hide both existing
rows from their own contributor, and surfacing the state in the UI is product
work. Migration 345 at least makes `is_verified` mean something before anything
starts reading it.

**8. Is `nutrition_logs.food_item_id` dead?**
*Proof:* count, plus a grep over `src/` and over `pg_proc`/`pg_views`/
`pg_constraint`. *Failure:* any reader, writer, view, or FK.
**0 of 126. No reader, no writer, no view, no foreign key, no function
mentions it** — the only hit in `src/` is a column name inside another test's
fixture list. Independently confirms the meal-logging audit. `uuid`, nullable.
**Not deleted: it is a schema change and therefore yours.** The SQL is at the
foot of this document.

**9. Can a non-admin publish into the shared catalogue?**
*Proof:* execute the INSERT as a real non-admin authenticated user with every
NOT NULL column supplied, then read it back as a third user and as `anon`, then
delete it and verify the table is back to 2 rows.
*Failure:* `42501`, or the row invisible to others.
**ACCEPTED.** See defect 4. The first attempt failed on `23502 null value in
column "created_by"` before reaching RLS at all — exactly the trap CLAUDE.md
warns about; re-run with `created_by` supplied and it went through.

**10. Do the tests cover the sheet that renders all this?**
*Proof:* `ls src/components/nutrition/__tests__/`. **Four files, none of them
`FoodSearchSheet`.** The ranking module had 19 tests; the component rendering it
had none. Three new files, 36 tests — see below.

---

# RESULTS

## Confirmed defects — five fixed, four reported

| # | Severity | Defect | Status |
|---|---|---|---|
| **1** | **Medium** | **The ranking module fails its own documented example.** `foodSearch.js`'s head comment says the tiers exist so that "chicken" ranks *Chicken breast* above *Grilled lemon chicken* above *Chicken-fried steak sauce*. `n.startsWith(q)` is true for `'chicken-fried steak sauce'`, so the SAUCE shared tier 1 with *Chicken breast* and outranked the chicken dinner. Rendered in a browser across all three sources: the sauce came second of four. "The ordering IS the feature" — that comment is the specification and it was not met. | **FIXED** |
| **2** | **High** | **Four blank label fields are served to every scanner as hard zeros.** The submission form writes `parseFloat('')` → null into `nutrition` for a field the user left empty — the honest record. The six flat columns carry `DEFAULT 0`, and `pick = json[key] ?? flatNum(record[key])` turned that null into **0**. Measured: `White Claw Surge (Pineapple)` reports 0 g protein, 0 g carbs, 0 g fat, 0 g fibre as manufacturer-grade claims about a product nobody entered those for. Only `sugar` and `cholesterol` escaped, because they have no flat column to default. | **FIXED** |
| **3** | **Medium** | **`BarcodeResultModal` printed "0% DV" for a nutrient it does not have.** `pct` fell back to `0` on null and `{Math.round(pct)}% DV` rendered outside the null check, so an absent nutrient read "0% DV" above "—mg". The vitamin grid in the same file, twelve lines below, gets this right. The sibling cards on the same page were fixed for this exact class on 2026-08-11; this sheet was missed. | **FIXED** |
| **4** | **High (security)** | **The moderation queue is enforced in the client only.** Executed against production as a real non-admin authenticated user: `INSERT INTO public.food_items (…, is_verified, source) VALUES (…, TRUE, 'member_request')` — the exact shape `approve_food_item_request` produces — was **accepted**, then read by a third authenticated user both by name and by the barcode-equality lookup the scanner uses. The owner could also flip `is_verified` FALSE→TRUE on their own row. Migration 343 changed the client and left the table's INSERT policy alone. This is the `equipment_models` hazard CLAUDE.md documents as deliberately closed there. | **Migration 345 written — needs applying** |
| **5** | **Medium** | **The "Add custom food" sheet promised to publish.** "…and we'll save it for everyone" over a button reading **"Save for Everyone"**, while the code files a moderation request and the toast underneath said "Sent for review" — two contradictory claims on one tap. Whoever changed the behaviour in 343 updated the two toasts and left 30 hardcoded English literals, which is also the half-converted i18n state CLAUDE.md says is worse than either extreme. | **FIXED** |
| **6** | **Low** | **Search rendered "0 cal" for a food stored with zero calories.** Production has such a row (`food_name: 'ck'`, a one-character name and sixteen untouched inputs); `safeEntry` maps every blank numeric field to a hard 0. It appeared in the list beside foods with real numbers, claiming a figure nobody entered. | **FIXED** |
| **7** | **Low** | **Two code comments name migration 342 as the food-request schema.** It is 343; 342 is the cross-user row-injection fix. | **FIXED** |
| **8** | **Low** | **`is_verified` and `source` have zero readers**, in `src/` and in `pg_proc`. `lookupCommunity` does not filter on `is_verified`, so an approved catalogue record and an unreviewed one are served to a scanner identically — the moderation queue changes nothing about what the catalogue *serves*. | **Reported** — filtering the waterfall would hide both existing rows from their own contributor; surfacing the state is product work |
| **9** | **Low** | **`created_by` is an email address in a row every signed-in user can read**, and `admin_purge_user_data` deliberately skips `food_items`, so a deleted account's address stays. | **Reported** — dropping/hashing it is a schema change with a policy depending on it |

## What changed

- **`src/lib/foodSearch.js`** — `matchRank` asks whether the query matches a
  whole WORD rather than whether it prefixes the string. Four tiers: whole name
  / whole word at the start / whole word further in / mid-word anywhere. A
  hyphen, underscore, apostrophe or slash joins a word; punctuation does not,
  so "(Pineapple)" keeps its tier while "chicken-fried" loses one. It scans
  every occurrence and takes the best, because the first is not always the best
  ("chicken-fried chicken soup"). Building no RegExp from user input also
  removes the need to escape metacharacters.
- **`src/lib/foodLookup.js`** — `pick()` is `key in json ? json[key] : flat`,
  so an explicit null in the rich jsonb WINS and the flat column is read only
  when the jsonb does not carry the key at all — which is the legacy pre-jsonb
  row this fallback was written for.
- **`src/components/nutrition/BarcodeResultModal.jsx`** — a nutrient with no
  value gets no tile, and no `% DV` is printed for one. A genuine `0` keeps its
  tile: a diet soda really does contain 0 g of protein and that is the label's
  claim. Both grids moved from `grid-cols-2` to **`tileRow()`**, because gating
  made the count data-driven; new literal `'2-2-2'` added to `tileRows.js` with
  the manifest test updated. When a record carries nothing but calories the
  sheet says so in one line instead of drawing a grid. The eight vitamin labels
  and the two tab labels went through keys; `'👥 Community Submitted'` lost
  its emoji literal.
- **`src/components/nutrition/BarcodeNotFoundModal.jsx`** — converted in full
  (30 literals), and the copy now says what the code does: **"Send for
  review"**, "we will send it for review — you can log it for yourself right
  away". One line was added rather than translated: *"A blank is kept as
  unknown, not as zero"*, which is the user-facing half of defect 2.
- **`src/components/nutrition/FoodSearchSheet.jsx`** — the calorie figure is
  gated on `> 0`, same gate and same reasoning as `MacroNutrientBox`'s tiles.
- **`src/lib/data/foodItems.js`** — `create()` and `listRecent()` deleted. The
  first was the direct-publish path 343 replaced, the second never had a
  caller; leaving either exported is an unused door back into the shared
  catalogue. The head comment now describes all three RLS policies and what
  they actually do, including the `anon` finding.
- **`src/lib/i18n-food-db.js`** — new part file, English-only with a
  `TODO(i18n)` head and a translator note. `nutrition.search.` and
  `nutrition.foodDb.` added to `AWAITING_TRANSLATION` as narrow prefixes, never
  a bare `nutrition.`. **The `nutrition.search.*` half is not new debt:** those
  ten keys were already being called from 2026-08-11 with no part file behind
  any of them, so every language already rendered the English fallback and no
  translator could find them. The sixteen nutrient LABELS were deliberately
  NOT added — they already exist as `nutrition.macros.*` / `.minerals.*` /
  `.vitamins.*` and are now called with `t()`.
- **`supabase/migrations/345_food_items_moderation_gate.sql`** — defect 4, plus
  check 6. Recorded in the runbook.

## New test coverage

**36 tests, 3 new files, plus 5 added and 1 inverted in existing files.** Suite
went 4572 → **4604 tests across 334 files**.

- **`foodSearchSheet.test.jsx` (9)** — the file that did not exist. Pins which
  TABLE each of the three sources reads and the `created_by` scoping (which is
  the whole answer to "does Search search a shared database?"), the documented
  ranking order as rendered, both empty states told apart, the zero-calorie
  gate, and that a pick calls `onPick` + `onClose` rather than logging.
- **`barcodeResultModal.test.jsx` (9)** — null gets no tile and no "0% DV";
  **a genuine 0 keeps its tile**, which is the half a careless fix would break.
- **`barcodeNotFoundModal.test.jsx` (10)** — deliberately asserts on WORDS. A
  test that only checked `requestFoodItem` was called would have passed
  throughout the period the button was lying.
- **`foodSearch.test.js` +3** — the doc comment's own example, punctuation vs.
  hyphen, and best-occurrence-not-first.
- **`foodLookup.test.js`** — one test **INVERTED** and labelled. It was titled
  *"fills null jsonb fields from flat columns per-field"* and asserted the
  defect. Its fixture (a non-null flat column over a null jsonb key) is also a
  shape no writer can produce — every writer fills the flat columns FROM the
  jsonb — so the fallback was firing only on the reachable case, which was the
  wrong one. A second test now pins the legacy key-absent case the fallback
  genuinely exists for.

**Verified not vacuous.** Reverting `foodSearch.js` + `foodLookup.js` fails 4
tests; reverting the three components fails 14; all 63 pass restored. **That
exercise caught a real gap:** the zero-calorie assertion was
`not.toMatch(/\bcal\b/)`, which passed against the bug — the figure and unit
render adjacent as `0cal` and there is no word boundary between a digit and a
letter. Rewritten as a substring check, it now fails on revert. The note is in
the test file.

## Browser render

jsdom paints nothing, so every figure was read in a real browser through a
stub-alias harness (recipe below), at 420px in the dark theme.

| Fixture | Before | After |
|---|---|---|
| Search, empty account | "No foods yet" + the boundary explained | unchanged |
| Search, no match | "Nothing matches that yet" | unchanged |
| Search, production (2 scans + diary) | 4 rows, `ck` reading **"0 cal"** | 4 rows, `ck` carries no figure |
| Search, `q=chicken`, all three sources | Chicken breast · **Chicken-fried steak sauce** · Chicken rice bowl · Grilled lemon chicken | Chicken breast · Chicken rice bowl · Grilled lemon chicken · **Chicken-fried steak sauce** |
| Barcode hit, the real White Claw row | 7 tiles: Protein **0.0 g**, Carbs **0.0 g**, Fat **0.0 g**, Fibre **0.0 g**, Sugar 2.0 g, Sodium 30 mg, Cholesterol **0% DV / —mg** | Calories 160 (8% DV) + **2 tiles**: Sugar 2.0 g, Sodium 30 mg |
| Barcode miss | "Food Item Not Found" · "we'll save it for everyone" · **"Save for Everyone"** | "Not in the catalogue yet" · "we will send it for review — you can log it for yourself right away" · **"Send for review"** + the blank-is-unknown line |

The barcode-hit row is the one that matters most, and it was measured honestly:
the harness renders BOTH readers over the SAME production row —
`?view=scanhit` calls the real `lookupBarcode`, `?view=scanhit&legacy=1`
reproduces the old `pick()` verbatim — so before and after are one row through
two readers rather than two fixtures.

## Checks that PASSED

Ground truth verbatim, including the three-policy shape and the four SECURITY
DEFINER functions · all three admin RPCs answer `42501 admin_only` to a real
non-admin and succeed for an admin, tested in both directions · a non-owner
cannot UPDATE somebody else's catalogue row (0 rows) · `food_item_requests` is
invisible to a non-owner (0 rows) · `relrowsecurity` is on for all three tables
· `barcodeScan.js` / `barcodeHints.js` read as documented and the USDA tier's
removal is honestly recorded · `requestFoodItem` passes `requester_user_id`,
without which its own INSERT policy rejects the write · the water predicate in
`foodSearch.js` matches the four correct consumers · `FoodSearchSheet`'s
results are a single-column vertical list, so **`tileRow()` does NOT apply**
(there is no partial row to centre — the rule is about wrapped tile rows) ·
`nutrition.macros.*` ships in all 15 languages so `t()` is correct for it, and
`nutrition.minerals.*` / `nutrition.vitamins.*` ship in 8, which is
pre-existing debt already counted · lint clean · build clean · **4604 tests
across 334 files**.

## What I did NOT do

- **Did not build "Filter by Macro Profile".** It has never existed. Building it
  is new product work — **this needs your call**, and the note in Rule Zero §2
  has the cost.
- **Did not apply migration 345.** Yours to run; the SQL is below and the file
  ends in a `SELECT` that proves it worked.
- **Did not delete `nutrition_logs.food_item_id`** or touch `created_by` on
  `food_items`. Both are schema changes.
- **Did not filter the barcode waterfall on `is_verified`** (defect 8). Doing so
  today would hide both catalogue rows from the person who contributed them,
  because `is_verified` is 0 of 2. It becomes the right move once 345 is applied
  and approvals start producing verified rows.
- **Did not add a "scan a barcode" affordance to Search's no-match state.** The
  copy already tells the user to do it and the app has the path one sheet away,
  so the dead end is a real gap — but wiring a CTA out of the sheet is new
  product surface, not a fix. Recorded as the cheapest next improvement here.
- **Did not rename "Add custom food".** It is barcode-only, which makes the name
  a misnomer rather than a bug, and the surface has no title of its own to
  change.
- **Did not touch the inherited findings.** Migration 006 remains unapplied
  (ten of sixteen nutrient fields still discarded on save), `confirmPhotoMeal`
  can still double-insert, a blank calories field still stores a hard 0. All
  three belong to `docs/nutrition-meal-logging-audit.md`; defect 6 above is a
  *display* consequence of the third and does not fix it.
- **Did not run an authenticated end-to-end round trip.** Same limit the
  previous audits hit — it needs a real sign-in and a real barcode. What remains
  unproven is camera → miss → request row → admin approval → a second user's
  scan resolving to it. Nobody has ever run that chain.

## The thing that outranks every defect above

**This feature is a shared food database with two rows in it, both belonging to
the same person, neither reviewed, and a moderation queue that has never run.**
No user can find another user's food by name — by design — and the catalogue
join on `nutrition_logs` has never been exercised in 126 rows.

So "unexercised" is the honest answer to a lot of it, and I have said so where
it is: 0 requests is a precondition that has not held, not a bug; 2 rows is the
`equipment_models` shape CLAUDE.md already documents.

**But defects 1 through 6 are not that.** Every one is unconditionally true
right now, on every render, for every user. The ranking inverts regardless of
who types "chicken". Four nutrients on the catalogue's only interesting row are
zeros nobody entered, and every future scanner gets them. A nutrient the label
lacks claims 0% of a daily value. None of them would ever surface as an error;
the suite was green through all of it.

And defect 4 is the one worth the most: **the feature's entire reason for
existing — "a human reviews it before it becomes everyone's" — is a client-side
convention.** Any signed-in user can write the reviewed shape themselves. That
was not visible from the code, from the migration, or from a grep over the
function source; it took executing the INSERT as somebody who should not have
been able to.

---

## SQL to run

Migration 345, the fix for defect 4 and check 6. Idempotent; ends in a `SELECT`
that proves it applied.

```sql
ALTER POLICY "food_items: verified items readable by all"
  ON public.food_items TO authenticated;

DROP POLICY IF EXISTS "food_items: owner full access" ON public.food_items;

DROP POLICY IF EXISTS "food_items: owner reads own" ON public.food_items;
CREATE POLICY "food_items: owner reads own"
  ON public.food_items
  FOR SELECT
  TO authenticated
  USING (
    (SELECT NULLIF(public.current_user_email(), '')) = created_by
    OR (SELECT auth.uid()) = user_id
  );

DROP POLICY IF EXISTS "food_items: owner submits unverified" ON public.food_items;
CREATE POLICY "food_items: owner submits unverified"
  ON public.food_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    ((created_by IS NULL)
      OR (created_by = (SELECT NULLIF(public.current_user_email(), ''))))
    AND ((user_id IS NULL) OR (user_id = (SELECT auth.uid())))
    AND ((created_by IS NOT NULL) OR (user_id IS NOT NULL))
    AND (COALESCE(is_verified, FALSE) = FALSE)
    AND (COALESCE(source, 'user_submitted') = 'user_submitted')
  );

DROP POLICY IF EXISTS "food_items: owner deletes own unverified" ON public.food_items;
CREATE POLICY "food_items: owner deletes own unverified"
  ON public.food_items
  FOR DELETE
  TO authenticated
  USING (
    ((SELECT NULLIF(public.current_user_email(), '')) = created_by
      OR (SELECT auth.uid()) = user_id)
    AND (COALESCE(is_verified, FALSE) = FALSE)
  );

SELECT policyname, cmd, roles::text AS applies_to
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'food_items'
 ORDER BY cmd, policyname;
```

Expect four rows, none with `cmd = 'ALL'` and none with `cmd = 'UPDATE'`.

**Optional, and your call — check 8.** `nutrition_logs.food_item_id` is 0 of
126 with no reader, no writer, no view and no foreign key. Dropping a column is
irreversible without a restore, so this is deliberately not in a migration:

```sql
-- Confirm the finding still holds before running the DROP.
SELECT count(*) AS rows, count(food_item_id) AS populated
  FROM public.nutrition_logs;

-- ALTER TABLE public.nutrition_logs DROP COLUMN food_item_id;
```

## Reproducing the SQL

Row counts, column population, policy expressions, grants and
`pg_get_functiondef` bodies came from `execute_sql` as `postgres` — none of
those need RLS.

Everything about a boundary was run as a real role, in one call per bundle, with
outcomes captured into a temp table and a `SELECT` last (a `ROLLBACK` inside the
call would roll the temp table back too, and `RAISE NOTICE` is invisible through
MCP). Every uuid was resolved BEFORE dropping privileges. The probe identity was
asserted against the row owner and against `admin_users` in the same call, so a
wrong comparison user could not look like a broken policy:

```sql
-- inside a DO block, per probe
PERFORM set_config('role','authenticated',true);
PERFORM set_config('request.jwt.claims',
  '{"sub":"7e92e7ff-…","role":"authenticated","email":"theerikvoelker@gmail.com"}', true);
-- … the thing that should fail …
PERFORM set_config('role','postgres',true);   -- reset before bookkeeping
INSERT INTO probe VALUES ('step', outcome);
```

Two traps worth carrying forward:

- **A probe INSERT fails on `NOT NULL` before it reaches the policy.** The first
  self-publish attempt returned `23502 null value in column "created_by"` and
  reads exactly like "RLS blocked it". Supply every NOT NULL column, and re-read
  the error rather than assuming the thing you were testing fired.
- **Test both directions.** The admin RPCs were run as a non-admin AND as an
  admin. A one-sided test cannot tell "correctly gated" from "broken for
  everyone".

Everything written to production was deleted and the deletion verified in the
same call (`food_items` back to 2 rows, 0 rows matching `ZZ_AUDIT%`).

## Reproducing the render harness

Deliberately **not committed** — throwaway scaffolding.

- `harness.html` at root with `class="dark"` on `<html>`, mounting
  `/src/harness.jsx`.
- `src/harness.jsx` mounts `FoodSearchSheet`, `BarcodeResultModal` or
  `BarcodeNotFoundModal` inside `QueryClientProvider` + `LanguageProvider` +
  `SettingsProvider`, selected by `?view=search|scanhit|scanmiss`, with
  `?fx=prod|three|empty|water` and `?q=<query>`. **Both providers are
  required** — without `LanguageProvider` every card throws `useLanguage must
  be used within a LanguageProvider` and you get an empty body that reads as a
  mounting failure.
- `?legacy=1` on the `scanhit` view reproduces the OLD `pick()` over the same
  production row. That is what makes the before/after a measurement rather than
  two fixtures — do this rather than editing the fixture to look wrong.
- `src/harnessStubs.js` is aliased over `@/api/db`, `@/api/supabaseClient`,
  `@/lib/AuthContext` and `@/lib/WeightUnitContext`. Stub at the **supabase**
  layer keyed by table name — one chainable thenable per table, resolving at
  ANY depth, since `listMineForSearch` bottoms out at `.limit()` and
  `nutritionRecipes.listMine` at `.order()`. Never by reassigning a data
  module's exports: `foodItems.listMineForSearch = …` fails the dep scan
  outright, ESM exports are immutable bindings.
- The fixtures carry the production rows' flat columns AND their `nutrition`
  jsonb verbatim, because the null-vs-zero split IS the finding.
- `vite.harness.config.js` needs `optimizeDeps.entries: ['harness.html']` or the
  dep scan walks `index.html` → `App.jsx` → `virtual:pwa-register` and the
  server dies.
- `npx vite --config vite.harness.config.js --port 5254 --strictPort`. **Not
  5199 or 5253** — parallel sessions hold those. Vite binds **IPv6 only** here,
  so confirm with
  `curl -s "http://[::1]:5254/harness.html" | grep -c src/harness.jsx` —
  `127.0.0.1` returns nothing and looks like a dead server.
- `preview_start({url})` opens it; `preview_start` alone only ever serves
  `~/flexyn2`. Call `resize_window` first. Read with `get_page_text`, not a
  screenshot — the Browser pane pauses rAF while hidden, so framer-motion never
  settles.
- The console buffer is **cumulative across navigations**, so stale HMR errors
  from an intermediate edit persist and read as live failures. Check whether the
  served module still contains the symbol the error names before chasing it.
