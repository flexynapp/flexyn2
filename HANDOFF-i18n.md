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
| hardcoded strings | 725 (undercounted) | **347** (honest) |
| en.json | 3,895 | 5,933 |
| real es/fr coverage | 70.5% | **93.9%** |
| de / it / nl / pl | — | 90.3% real |
| pt | — | 89.1% real |
| tr | 2,137 | 2,353 / 5,933 |

`npm run i18n:audit` section E is the honest number. Section B is CATALOG
coverage and is not what a user sees — do not quote it.

**Everything up to `e24c3057` is verified: 5,252 tests across 379 files, lint
clean.**


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

## THE JOB

**Finish the 347 hardcoded strings.** UI copy that never reaches a catalog.
`npm run i18n:hardcoded -- --list` enumerates them; the largest are:

    11  src/lib/aiCoach/workoutGenerator.js   ← SEE "KNOWN FALSE POSITIVE"
     7  src/components/debrief/DebriefVault.jsx
     7  src/components/nutrition/RecipeBuilderModal.jsx
     7  src/components/regimens/RegimenForm.jsx
     7  src/components/settings/NotificationsSection.jsx
     7  src/components/wellness/CycleTrackerCard.jsx

then a tail of 1–6 across ~121 files. `workoutGenerator` is the documented
false positive, so the real top is 9 and it is flat from there down.

**GROUP FILES THAT SHARE A VOCABULARY, and grep for the concept before you
start.** The three duel surfaces each declared their own English for the same
three duel types, and two of the three short descriptions disagreed — "Complete
the same session" against "Same workout, best completion", on screens a user
reaches within a tap of each other. Keying them one file at a time would have
translated the drift into seven languages instead of removing it. The same
question is worth asking of the Hub files below.

**The loot catalogs are DONE** (105 keys, 2026-08-16). Cosmetic NAMES stay
English by standing decision; the flavour text beside them is translated
through `loot.item.<id>.desc`, one namespace for all four catalogs because
the 89 ids are globally unique. The pattern to copy if another catalog turns
up: a generic inventory row has lost the module it came from, so the resolver
must key off the id alone, and the module that owns the data should re-export
the resolver so the audit can follow the import edge.

**THE SCANNER UNDERCOUNTS EVERY FILE YOU OPEN, so read the file, not the
list.** Two shapes it structurally cannot see, both found in this batch:

- **A template-literal toast.** Every detector keys off a quoted string, so
  ``toast.success(`"${r.name}" shared with the Crew!`)`` is invisible. CrewChat
  had five and Workout one. They take the catalog form with `{name}`.
- **THE DETECTOR MATCHES A FIXED LIST OF PROPERTY NAMES, and a data shape
  that uses different nouns is invisible.** Nutrition's hero slides are
  `{ id, kicker, title, tip, ctaLabel }` — `title` is on the list, `kicker`,
  `tip` and `ctaLabel` are not, so the headline of every slide was counted and
  the eyebrow, body and button under it were not. Five reported against twenty
  real. Read the object, not the count.
- **`name:` is excluded from the objectProp detector by design** (it is
  overwhelmingly an identifier here). `trophyDefinitions.js` reported 123 and
  had 166 — the 43 extra were `LADDERS[].name` and `TROPHY_CATEGORIES[].name`,
  rendering as page headings.
- **A DUPLICATE CATALOG is the best find, because the fix is a deletion.**
  `CardioPlanned` carried its own English for six cardio types while
  `cardio.type.<slug>` already held the same six translated 7/7 with a
  resolver in `src/lib/cardioTypeLabel.js` — and the data's `value` fields
  were the key slugs. Before keying a `slug -> { label }` map, grep en.json
  for the slug: somebody may have done it already.
- **A slug→label map whose PROPS ARE THE SLUGS is invisible entirely.** The
  detector matches on the property NAME being `label`/`title`/`desc`, so
  `REASON_LABEL = { harassment: 'Harassment', spam: 'Spam', … }` in
  `AdminReports.jsx` matched nothing at all — six labels on every row of the
  moderation queue, never counted, English in fourteen languages.
- **A DISPLAY STRING DERIVED FROM A SLUG.** HubComposer's content-warning
  button read `` `Content warning: ${cwType.replace('_', ' ')}` `` — English
  manufactured at the render site, in every language, while the picker two
  lines below held the real words. Grep for `.replace('_', ' ')` and
  `.replace(/_/g, ' ')`; each one is a label being invented from an id.
- **A sentence assembled from fragments cannot be translated even after you
  find it.** Two in this batch: Workout built "Cleared 2 weights and 1 rep
  field" by joining pluralised English pieces with `" and "`, and the
  corporate cohort gate joined a dash clause, an inline plural and a
  parenthetical. Rewrite as whole messages, one per case — never key the
  fragments.

**Also outstanding:**
- **tr is at 2,353/5,424.** Glossary and the register fix are done. Only
  batching remains — `next-batch.mjs tr 200` → translate → `add-keys.mjs`.
- **pt/de/it/nl/pl trail es/fr by ~200–300 keys.**
  `node scripts/i18n-audit.mjs --lang pt`.
- **A native prose pass is still owed on every locale.** `_meta.json` says
  "awaiting native review" and that must stay true. All of this is MACHINE
  draft. `coach.*` first, then `onboarding.*`, then notification bodies.
- **Dashes in already-shipped copy.** The no-dash rule is applied to strings
  as they are touched, so the catalogs still carry em dashes in older keys
  (`workout.workoutLoadedLogYourSets` is "Workout loaded — log your sets!").
  Cleaning them means re-translating, so it is its own pass, not a drive-by.

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

- **Generated key paths use UNDERSCORES, never hyphens.** Every key scan
  matches `[\w.]+`, so `todaysPlan.label.push-day` is invisible to the audit.
  Hit three times.
- **A `tFallback` with a TEMPLATE key probably has no keys behind it.**
  TodaysPlanCard, WorkoutSuggestionCard and eight `hero.unit.*` keys all
  shipped the lookup and never the catalog entries — English in all fifteen
  languages while the code looked internationalised. A computed key cannot be
  checked statically, so nothing reports it. Check before assuming.
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

## KNOWN FALSE POSITIVE — do not chase it

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
