Continue the flexyn2 i18n work in `~/flexyn2-i18n` (worktree on branch
`i18n-lang-eval`, pushed to `origin/main`). Read the memory files
`flexyn2-i18n-json-catalogs.md` and `flexyn2-glossary-grows-with-app.md`
first — they carry the durable findings and are more current than this file
will be after a day.

## WHERE THINGS STAND

Two measurement crises are resolved and a third was found and closed here.
`untranslatable` is 0 and `_coverage.json` reads honestly. **Do not quote the
old numbers from any earlier handoff** — the hardcoded scanner was blind to
roughly two thirds of its subject until 2026-08-16, so every "271 left" and
every "94% real" predates a correct measurement.

| | then | now |
|---|---|---|
| untranslatable keys | 781 | **0** |
| hardcoded strings | 725 (undercounted) | **0 real** (43 counted, all settled) |
| en.json | 3,895 | 6,297 |
| es / fr | 70.5% | **99.4%** (6,258) |
| de / it / nl / pl | — | 95.8% (6,034) |
| pt | — | 94.6% (5,957) |
| tr | 2,137 | 2,376 / 6,297 |

`npm run i18n:audit` section E is the honest number. Section B is CATALOG
coverage and is not what a user sees — do not quote it.

**Everything up to `4c3c32e8` is verified: 5,315 tests across 390 files, lint
clean, `npm run build` clean.** Run all three. The suite alone is not the
gate — see the DiscoveryCards entry under TRAPS.


**Three scanner defects were fixed on 2026-08-16 and they are the reason the
numbers moved.** `844e24b9` (parallel session): every sentence containing a
period was invisible, JSX with `&` never matched, and `accept="image/*"`
opened a phantom block comment. `a667354f`: the SAME comment bug was live in
four more scanners — `i18n-audit.mjs` (A2), `i18n-baseline.mjs`,
`i18nCoverage.test.js`, `i18nRawKeys.test.js` — where it hides `tFallback`
CALL SITES rather than literals, and a prose comment saying
`src/locales/*.json` swallowed 62 lines of `Workout.jsx`. `9d9c8975`: the
`englishEcho` counter parsed only `ALLOW_IDENTICAL_BY_LANG` and never the
global `ALLOW_IDENTICAL`, so 14 declared-identical keys per locale counted as
untranslated.

## THE JOB — the hardcoded sweep is DONE

**Zero real hardcoded strings remain.** `npm run i18n:hardcoded` reads **43**
and every one is settled. Do not chase them; the list is exhaustive and each
entry has been checked at its render site, not assumed:

| n | file | why it still counts |
|---|---|---|
| 11 | `aiCoach/workoutGenerator.js` | resolved — `generator.equipment/duration/skill.<id>` |
| 4 | `aiCoach/planBuilder.js` | resolved — `coach.cardioStyle.<id>` |
| 4 | `data/coinShop.js` | resolved — `shop.<camel>.name/.desc` |
| 4 | `CalorieCyclingModal.jsx` | resolved — `nutrient.<slug>` |
| 3 | `ThemeContext.jsx` | resolved — `theme.<id>.desc` |
| 3 | `CreateDuelModal.jsx` | resolved — `duel.type.<id>.rules` |
| 2 | `MarketFilterBar.jsx` | resolved — `marketFilter.sort.<id>` |
| 2 | `FoodSearchSheet.jsx` | resolved — `foodSearch.source.<key>` |
| 3 | `RestTimerOverlay.jsx` | deliberate — Tabata / EMOM are protocol names |
| 3 | `Onboarding.jsx` | deliberate — sample data inside a picture of the app |
| 1 | `LanguagePicker.jsx` | deliberate — must be legible in every language |
| 1 | `SplashScreen.jsx` | the brand wordmark, in an SVG |
| 1 | `ReadinessCard.jsx` | a map KEY fallback, never rendered |
| 1 | `AboutSection.jsx` | CC-BY 4.0 is a licence identifier |

**Why a resolved file still counts forever.** Once a slug→label map is routed
through a key, the module's English label IS the `tFallback` fallback — and it
has to be. The scanner's map heuristic keys on a sibling `id` property, so any
map whose slug field is called `key`, `sku` or `value` stays on the list.
**Read the render site before believing the number.**

## WHAT IS ACTUALLY LEFT

Three things, none of them hardcoded strings:

1. **A native prose pass on every locale.** Everything shipped is MACHINE
   DRAFT and `_meta.json` says so. That has not changed and must not be
   quietly dropped.
2. **tr at 2,376 / 6,297**, and pt/de/it/nl/pl at 94–96% against es/fr's
   99.4%. Batching only.
3. **Notification rows: 16 of 37 types render in the reader's language.**
   `src/lib/notificationText.js` rebuilds a row from `type` + `metadata`;
   `NotificationPanel` calls it. Everything else keeps the stored text, frozen
   in whatever language wrote it.

   **Only 16 types have EVER fired in production** — 21 have never produced a
   row. So "29 types left" was never the real number; the live table is the
   only place that answer exists. **Query it before planning this work:**

       cd <scratch> && supabase link --project-ref ebvqxuwfiptcmlkhflfj --yes
       supabase db query --linked "select type, count(*) from public.notifications group by type"

   That is the documented no-MCP route and it corrected three separate things
   a migration read had got wrong.

   **Three live types CANNOT be done from the client.** `crew_war_started`
   and `crew_war_resolved` name the opponent CREW in the title and store only
   `opponent_crew_id`; `nemesis_assigned` names the rival and stores only
   `assignment_id`. A name that is not on the row cannot be rebuilt. Each
   needs its writer to store it — **a migration, and the only remaining DB
   work in this area.** `CANNOT_LOCALIZE` in that module names all three.

   The remaining 18 have never fired, have no catalog rows, and cost nothing
   while they fall back. Do one when it starts firing, and check a live row.

   **The fallback rule is load-bearing.** A spec applies only when every
   placeholder resolves, so a wrong mapping degrades to today's behaviour
   rather than rendering a hole. Do not relax it to "best effort". And note
   the third body state: `keepBody` means the stored body is USER CONTENT
   (comment_reply's body is the comment) — returning null there deletes what
   somebody wrote.

## HOW TO DO IT — the pattern that works

Almost every remaining file is a `slug -> { label }` map rendered somewhere
else. Do not move the English into a component; route it through a **derived
key** at the render site and leave the data module pure.

1. `node <scratch>/triage2.mjs --file <name>` — what is genuinely unreached
2. wire the render site: ``tFallback(`ns.${x.id}`, x.label)``
3. extract the keys, `node <scratch>/add-en.mjs <file>.json`
4. translate 7 locales, `node <scratch>/add-keys.mjs <lang> <file>.json`
5. `npm run i18n:review -- <lang>` after every batch — it catches vocabulary
   the shape validator cannot
6. `npm run i18n:baseline`, `npm run lint`, run the i18n tests, commit, push

**A render HELPER is not a component and cannot hold a hook.** `HeroPager`
calls `renderSlide(slide, opts)`, so a `useLanguage()` inside
`renderShortcutSlide` is a rules-of-hooks violation no test catches. Pass the
translator in as an argument, defaulting to `enT` from `src/lib/translatorArg.js`
— never a local `(_k, english) => english`, which drops the vars.

**A data module with no React context takes the translator as an argument** —
`implementTypeLabel(slug, tf)`. Pass it from every render AND every sort:
sorting on the English while displaying the translation puts a Spanish list in
English alphabetical order, which reads as a bug with no visible cause.

**Copy built by a module-scope function carries `<field>Key` beside the
English** — that is HeroSlideshow's shape and the audit understands it. Make
the resolver conditional (`key ? tFallback(key, val, vars) : val`), because a
goal's own title and an exercise name are USER DATA and must render verbatim.

## TRAPS THAT COST TIME HERE

- **Before minting a near-duplicate, grep the catalog for the SENTENCE.** The
  profanity warning now exists SIX times — `hub.composer.profanityError`,
  `hub.profile.removeProfanity`, `nutrition.profanityWarning`,
  `templatesModal.profanity`, `workout.removeProfanity` and
  `cardioManualForm.profanityNotes`. Five are the same sentence differing only
  in which field they name. That wants one parameterised key and a sweep of
  six call sites; it is a change of its own, and it is on the list.
- **A guarded domain can have its OWN identical-value allow-list.**
  `gymEquip.*` is checked by `i18nEquipment.test.js`, which carries a
  `LEGITIMATE_MATCHES` set of its own — completely separate from
  `ALLOW_IDENTICAL` in `i18n-check.js`. Eight new keys turned fourteen tests
  red on Cardio, Kettlebell and Machine. Adding to the global list would not
  have helped. **When a domain test goes red on a cognate, look for the
  allow-list inside that test file first.**
- **A module-scope options array freezes whichever language loaded first.**
  `GymEquipmentEditor`'s `BRAND_OPTIONS` was built at import time, so a keyed
  label in it would never change when the user switched language. It is a
  `useMemo(tFallback)` now, like the type groups beside it. Check for
  `const X_OPTIONS = [...]` at module scope before keying anything inside it.
- **Gendered agreement has now appeared in four languages** (de, es, pl, fr).
  It is not a German quirk. Anywhere the copy describes the reader, prefer a
  form that carries no agreement: a noun the feature owns (PREPARACIÓN,
  GOTOWOŚĆ), an invariable adjective (es "fuerte", "al mejor"), or a verb.
  The cycle tracker is the sharpest case — it is opt-in, and assuming its
  users' gender in the copy is exactly the assumption not to make.
- **Canvas text has no truncation, no wrap, and ships as a PNG the user
  posts.** The four share cards paint their labels at fixed coordinates. There
  is no ellipsis and no way for anyone to notice afterwards, so a canvas
  string must be MEASURED, not estimated: serve a page that runs
  `ctx.measureText` at the real font and diff every locale against the real
  budget. Twelve of thirteen fit; the profile card's streak chip was a fixed
  280px against text needing up to 278px for the text alone (pt). The chip
  measures and fits now. **It was already broken in English** at a 3-digit
  streak — the translation did not introduce the bug, it made it reachable,
  which is the usual shape.
- **A python edit script that asserts before it writes leaves the file
  UNTOUCHED, and the lint that follows is then meaningless.** One
  WeeklyRecapShareCard pass failed its last assertion, wrote nothing, and the
  `npx eslint` after it reported clean — on the unmodified file. If an edit
  script raises, re-check the file before believing anything downstream of it.
- **A computed key is a CLAIM, not a fact, and it keeps being false.** Four
  families found in two days, all rendering English in fifteen languages while
  the call site read as finished: `readiness.action.*` (ReadinessCard),
  `nutrition.macro.*` (CalorieCyclingModal), `crew.discover.sort.*`
  (CrewDiscovery), and the eight `hero.unit.*` before them. **Every time you
  see a backtick inside `tFallback(`, grep en.json for the prefix before
  moving on.** It is one command and it has paid four times.
- **Grep a template key by its PREFIX, never by a whole key.**
  `mealPlanner.slot.breakfast` returns nothing in `src/` and the family is
  very much alive — the weekly planner reads it through
  `slotLabelKey(slot)`. Deleting it as dead would have blanked every slot
  header in the planner.
- **`.toLowerCase()` on a translated word is an English-only operation.**
  LogRecipeSheet lower-cased a meal name for its CTA; German capitalises its
  nouns, so the moment the word is translated the transform is wrong. Same
  class as a hardcoded plural `s`.
- **When a bolded node sits inside a sentence, the bold is its own key and it
  must land on the emphasised WORD.** French and Italian need a verb phrase
  where English needs one adverb, and Polish needs "nigdy" inside its double
  negation. A first draft put the Polish bold on "to" (this), which
  emphasises the wrong word while reading fine to anyone skimming.
- **A scanner reading zero is a statement about what it can SEE.**
  `npm run i18n:orphans` read `0 (baseline 0)` while five real orphans sat in
  `ReadinessCard.jsx` — because the map holds the key and the call site is
  `tFallback(ACTION_BY_LABEL[label].key, …)`, a VARIABLE, and the scanner
  matches literal keys only. The readiness card's advice line had rendered
  English in all fifteen languages since it shipped. **Before keying a file,
  grep it for `.key` and `.fallback` object properties**, not just for bare
  literals. Two more of the same shape are likely still out there.
- **A file at the top of the hardcoded list may have no users at all.**
  `src/lib/hrZones.js` was #2 with five strings and is imported by nothing
  but its own test; no file in `src/` reads an `hr_zone*` column. Check for a
  consumer before you translate a data module. Its module comment claims the
  cardio UI uses it, which is how it stayed on the list — **the comment is
  wrong and greping for the exports is what settles it.**
- **Gendered adjectives are the same trap in every inflected language.**
  German drifted feminine three times earlier in this work; Spanish and
  Polish did it here, on a readiness label rendered as an adjective. The fix
  is to agree with the FEATURE's noun (PREPARACIÓN, GOTOWOŚĆ) rather than
  with the user. German and Dutch predicative adjectives are uninflected and
  need no such care, which is exactly why the trap moves rather than
  repeating.
- **A message SENT to another user must not be translated into the sender's
  language.** `TradeOfferDialog` composes a DM body; the reader is the
  recipient. It stays English on purpose, with the reason at the call site.
  The general rule: client-composed cross-user text needs the RECIPIENT's
  language, which the sending client does not have. Push notifications solve
  it server-side; anything else has to stay English or move to a payload the
  reader's client renders.
- **The scratchpad is not durable and it was wiped again mid-session.**
  `add-en.mjs`, `add-keys.mjs`, `fb.mjs` and `mojibake.mjs` all had to be
  rewritten from scratch in the middle of a batch. They are small; the cost
  is losing your place. Rebuild them at the START of a batch, not when a
  command fails halfway through one.
- **The suite is not the build.** `08afd95b` put a JSX comment inside an
  attribute list in `DiscoveryCards.jsx` — `{/* … */}` between two props,
  which is a syntax error rather than a comment — and it sat on `origin/main`
  through a green 379-file run, because no test imports that file. Netlify
  deploys from `main`, so that was a broken production build on the branch
  everyone pushes to. **Run `npm run lint` AND `npm run build` AND
  `npm run test` before every push.** Lint caught it in a second; the suite
  never would have.
- **A key under a GUARDED domain prefix needs all fourteen locales, not the
  seven complete ones.** `_meta.json` `domains` lists them: `journal.`,
  `mood.`, `readiness.`, `gymEquip`, `implement.`, `notifications.`,
  `cardio.`, `bodyMap.`, `weeklyMealPlannerModal.`, `nutritionPlansModal.`.
  The domain tests assert each locale carries EXACTLY the label set, so one
  new `weeklyMealPlannerModal.*` key turned seven files red. Nothing static
  reports this — every counter that only reads the released locales says the
  key is complete. Check the prefix list before you name a key.
- **The extractor misses two whole classes.** `extract-defaults.mjs` matches
  same-quote pairs only, so `tFallback('key', "double-quoted English")` is
  invisible, and it cannot see a template key at all. Nine of one batch's 51
  keys had to be added by hand. After running it, diff its output against the
  `tFallback(` call sites you actually wrote.
- **Reusing a key a locale does not carry is not a reuse, it is a
  regression.** `crewWars.timeLeft`, `crew.coins` and `crewTrophies.levelN`
  existed in es/fr only; pointing five more surfaces at them would have
  rendered the English fallback in pt/de/it/nl/pl where a minted key would at
  least have been translated. Check coverage across all seven before taking a
  reuse, and backfill in the same change.
- **Filling a gap can RAISE the English-echo ratchet, legitimately.**
  `crewTrophies.levelN` is "Level {n}" in every language because Level is a
  doNotTranslate term, so backfilling five locales added five echoes. That
  belongs in `ALLOW_IDENTICAL` with the reason, never in a regenerated
  baseline.
- **Generated key paths use UNDERSCORES, never hyphens.** Every key scan
  matches `[\w.]+`, so `todaysPlan.label.push-day` is invisible to the audit.
  Hit three times.
- **A `tFallback` with a TEMPLATE key probably has no keys behind it.**
  TodaysPlanCard, WorkoutSuggestionCard and eight `hero.unit.*` keys all
  shipped the lookup and never the catalog entries — English in all fifteen
  languages while the code looked internationalised. A computed key cannot be
  checked statically, so nothing reports it. Check before assuming.
  **Paid out again on 2026-08-16:** `NotificationsSection` already read
  ``tFallback(`settings.push.${key}`, label)`` and not one of its seven
  `settings.push.*` keys existed, so every push-category row was English in
  fourteen languages. The fix was seven catalog rows and zero lines of JSX —
  which is the tell that a file needing "no code change" may be the worst case,
  not the best. When the scanner flags a `slug -> { label }` map, check whether
  the render site ALREADY resolves it before touching the component.
- **Suspect any coverage heuristic that only ever SHRINKS the number.** The
  derived-key rule has been wrong three times, always by being generous. Verify
  in both directions: what you fixed reads zero AND something untouched is
  still counted.
- **`\b` is ASCII-only in JavaScript** — use the `W()` lookaround in
  `scripts/i18n-review.mjs`.
- **origin/main moves every few minutes.** Rebase before pushing; confirm
  `git diff origin/main..HEAD --stat` lists only your files. Locale JSON
  conflicts resolve as a UNION — never take one side.
- **The feature branch goes stale after every rebase.** Push `HEAD:main`
  first, then `--force-with-lease` the branch to match. Never force-push main.
- **`migrationCatalog.test.js` goes red on YOUR branch for someone else's
  migration.** It requires a `docs/migrations-runbook.md` row per file in
  `supabase/migrations/`, and two landed without one on 2026-08-16 (372, 373).
  The message names a doc you were not editing. Write the row from the
  migration's own header comment and move on; it is a minute, and diagnosing
  a red suite on a clean checkout is not.
- **NEVER `git checkout <locale>.json` mid-batch.** The keys you just landed
  are uncommitted, so it silently reverts the whole batch and the file still
  looks plausible. Cost one German batch here. Re-run `add-keys.mjs` to
  restore; the scratchpad batch file is the backup.
- **Do not chain `git rebase && git push` in one command.** A conflict leaves
  the rebase half-applied, and the `&&` chain then pushes the PARTIAL HEAD —
  which here shipped one commit of a two-commit change to main.
- **A key that already exists is a fork, not a win, and the test is MEANING.**
  `workout.goBackAndFix` said exactly what the new button said, so reusing it
  was right. `hub.composer.videoTooLarge` said the same THING in different
  words ("That video is too large. The limit is 50 MB." vs "Video must be
  under 50 MB."), so reuse was right there too — but the call site must then
  take the CATALOG's English, or the code and the screen disagree.
  `workout.dragToReorder` means something else entirely and needed a new key.
  Check `en.json` before minting or reusing.
- **A RENAME THAT STRANDS KEYS FIGHTS THE RATCHET, so prefer the imperfect
  namespace.** `collectionModal.tab.*` names four objects the Bag shows too, so
  UserBag reuses them rather than minting twins — but moving them to a
  surface-neutral namespace would drop four translated keys per locale, and
  `_coverage.json` fails when `translated` FALLS. Renaming means regenerating a
  no-regression guard to absorb your own tidying, which is the move that guard
  exists to prevent. One vocabulary from one source is the property that
  matters; where the key happens to live is not.
- **EVERY `TransText` KEY IS OUTSIDE THE UNTRANSLATABLE AUDIT.**
  `i18n:audit --untranslatable` scans for `tFallback(` CALLS; TransText takes
  its key as a JSX prop (`k="…"`), so none of its 27 call sites are checked.
  `myRoutineSheet.emptyHint` was missing from en.json and the audit read clean.
  Check them by hand after touching one:
  `grep -rn "<TransText" src --include="*.jsx" -A3 | grep -oE 'k="[^"]+"'`
  and diff against en.json. Reach for TransText only when a sentence genuinely
  wraps an element mid-string — otherwise a plain `tFallback` stays visible to
  the tooling.
- **A KEY CAN BE ORPHANED IN THE OTHER DIRECTION** — present in all fifteen
  catalogs, translated, and referenced by nothing. `hub.chat.attachImage` had
  said "Attach photo" in seven languages with no call site at all. Nothing
  reports this class: `i18n:audit` compares locales against en.json and it IS
  in en.json; the orphan ratchet looks for keys absent from the catalog, which
  is the opposite. It surfaced only because a new call site happened to pick
  the same name and the fallback guard failed on the wording. When you mint a
  key, grep `en.json` for the name first — the translation may already exist.
- **A call site's fallback must equal `en.json`, and a guard now enforces it**
  (`i18nCoverage.test.js`, added 2026-08-16). `getTranslation` returns the
  catalog value whenever the key exists, so the fallback renders only when the
  key is MISSING — a mismatch means the source says one thing and the screen
  says another, invisibly. 45 keys were mismatched on the first measurement and
  two were live defects: `workout.weightWithUnit` had lost its `{unit}`
  placeholder in all fifteen catalogs (a kg user read "lbs"), and two strings
  still called the feature "nemesis". **When the guard fires, decide which side
  is stale.** Aligning the call site is free; changing `en.json` is a copy edit
  in eight locales.
- **The extractor takes the SOURCE BYTES, not the runtime value.** A default
  written `'Drag a card\u2019s grip'` lands in `en.json` as a literal
  backslash-u. Type the character.

## KNOWN FALSE POSITIVES — do not chase these

**`src/components/RestTimerOverlay.jsx` (3).** Tabata 20s, Tabata 10s and
EMOM 1:00, plus 30 / 30, 40 / 20 and 20 / 40. Tabata and EMOM are protocol
names lifters use untranslated in every language and the rest is arithmetic,
so six keys there would be six copies of the same numerals. The reasoning is
a comment at the site.

**`src/lib/hrZones.js` — DELETED 2026-08-22, kegan's call.** Kept here as the
worked example. It ranked #2 on the hardcoded list at five strings and had
never been imported by anything, in the whole of git history: it shipped in
`df929992` alongside migration 094 and the UI that was meant to consume it was
never built. Its own header said the cardio log entry UI used it. **Grep the
EXPORTS, not the module name, and check the history for an import before you
translate a data module.**

Still on the database and NOT deleted, because schema is kegan's:
`cardio_logs.hr_zone1_min`…`hr_zone5_min`, `cardio_logs.avg_hr_bpm` /
`max_hr_bpm`, and `user_profiles.max_hr_bpm` (migration 094). Nothing in
`src/` reads or writes any of them.

`workoutGenerator.js`'s 11 option labels ARE translated and resolving. A
`keyPrefix` passed as a PROP leaves the only template literal as
`` `${keyPrefix}${opt.id}` ``, whose static prefix is empty, so the scanner
records no pattern. Documented at the top of `scripts/i18n-hardcoded.mjs`. Do
not "fix" it by matching empty prefixes — that matches everything.

## STANDING DECISIONS (kegan)

- **Flexyn is never translated.** Guarded by a test; verified across all 29
  strings that carry it in all fourteen locales.
- **Usernames are never translated.** They travel only as `{handle}` /
  `{name}` placeholders, and placeholder parity is pinned by the validator.
- **Level and Lv stay English** wherever they name the user's Level stat. NOT
  in ordinary prose ("activity level", "experience level") and NOT where
  `level` is the ADJECTIVE meaning tied ("Level pegging", "Level with @{n}").
  Fourteen declared exceptions live in `_glossary.json` →
  `doNotTranslate.exempt`, each with a reason.
- **Product/item names stay English** — brand names in `BRAND_META`, cosmetic
  names like "Coral Rush". The flavour text beside them is translated.
- **Nothing is released beyond en/es/fr.** Adding a locale to the picker is
  kegan's call and a separate change.

## TOOLING

In-repo: `npm run i18n:audit` (`--untranslatable`, `--partial`, `--lang X`),
`i18n:hardcoded` (`--list`, `--kind`, `--json`), `i18n:review -- <lang>`,
`i18n:baseline`, `i18n:orphans`.

Guards in `src/lib/__tests__/i18nCoverage.test.js`: untranslatable and
hardcoded may not RISE; no Cyrillic/Greek in a Latin-script catalog (this
caught a shipped Turkish defect on its first run); the brand survives; plus
the parallel session's `i18nOrphanKeys.test.js`, which measures the same
untranslatable class independently and also reads zero.

**THE SCRATCHPAD GETS WIPED WITHOUT WARNING** — it happened mid-batch on
2026-08-16, twice over (this session's directory and the previous session's).
Nothing committed is at risk, but the batch tooling goes with it. Recreating
`lib.mjs`, `add-en.mjs`, `add-keys.mjs` and `extract-defaults.mjs` takes about
five minutes; the shapes are in this file and in the commit history. Do not
keep a batch half-landed across a break.

Scratchpad scripts (recreate if gone — two handoffs running have had to):
`lib.mjs`, `next-batch.mjs`, `add-keys.mjs`, `add-en.mjs`, `apply-fixes.mjs`,
`extract-defaults.mjs`, `triage2.mjs`, `stage.mjs`, `mojibake.mjs`,
`check-accents.mjs`. `add-keys` refuses the WHOLE batch on any placeholder,
newline or `**` mismatch, on an `englishOnly` key, or on a bad accentWord.

## AN IDENTICAL ENGLISH IS NOT EVIDENCE THE TRANSLATION TRANSFERS

Reusing a shipped translation is the house habit and it is right most of the
time — a duplicate ROW with the same words costs nothing and makes the two keys
agree by construction. But check what the sentence is DOING, not just what it
says. `adminReports.status.approved` and `registerGym.status.approved` are both
"Approved" in English; the first titles a tab holding a queue of requests and is
PLURAL in every Romance locale (Aprobadas, Approuvées, Rifiutate), the second
labels ONE submission and must be singular. Same English, different agreement,
and nothing in the tooling can see it.

**The mirror of this is a collision the ENGLISH cannot have.** "Turn your best
regimens into paid programs" is two nouns in English and ONE in five locales,
because `_glossary.json` maps Regimen to Programa / Programme / Programma /
Programm — so it collapses to "programas en programas". Dutch was fine, Regimen
being Schema there. When a sentence names two product nouns, check the glossary
for both before writing it: the fix is to rename the OTHER one (the thing being
sold is a product), not to accept the repetition.

Safe to inherit: context-free validation lines ("Latitude must be a number
between {min} and {max}."). Not safe: anything carrying number, gender or a
participle agreeing with a noun the other site does not have.

## A COGNATE GOES IN THE ALLOW-LIST, NOT THE BASELINE

When `englishEcho` rises on a genuine loanword — German "Option", Dutch
"Inbox", Italian "follower" — add it to `ALLOW_IDENTICAL_BY_LANG` in
`src/lib/i18n-check.js` with a reason. Unit symbols and feature names go in
the global `ALLOW_IDENTICAL`. Regenerating the ratchet to absorb a cognate
raises the ceiling for every future string too, which is how a no-regression
guard quietly stops guarding.
