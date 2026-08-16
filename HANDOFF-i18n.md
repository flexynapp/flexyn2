Continue the flexyn2 i18n work in `~/flexyn2-i18n` (worktree on branch
`i18n-lang-eval`, pushed to `origin/main`). Read the memory files
`flexyn2-i18n-json-catalogs.md` and `flexyn2-glossary-grows-with-app.md`
first — they carry the durable findings and are more current than this file
will be after a day.

## WHERE THINGS STAND

The measurement was the whole problem when this started, and it is fixed.
`_coverage.json` read **99.4% for Spanish while the dashboard rendered half
its cards in English**, because every count was taken against `en.json` and
the two biggest sources of on-screen English live outside it.

| | then | now |
|---|---|---|
| untranslatable keys | 781 | **0** |
| hardcoded strings | 725 | **271** |
| en.json | 3,895 | 5,151 |
| real es/fr coverage | 70.5% | **~94%** |
| de / it / nl / pl | — | ~96% catalog |
| pt | — | ~95% catalog |
| tr | 2,137 | 2,337 / 5,151 |

`npm run i18n:audit` section E is the honest number. Section B is CATALOG
coverage and is not what a user sees — do not quote it.

## THE JOB

**Finish the 271 hardcoded strings.** These are UI copy held as object-literal
properties that never reach a catalog. `npm run i18n:hardcoded -- --list`
enumerates them; the largest are:

    18  src/pages/AdminReports.jsx        (admin-only, low user value)
    11  src/lib/aiCoach/workoutGenerator.js   ← SEE "KNOWN FALSE POSITIVE"
    10  src/pages/CorporatePortal.jsx
     9  src/pages/TradeHistory.jsx
     8  src/pages/Nutrition.jsx
     7  src/components/settings/NotificationsSection.jsx
     7  src/components/gyms/GymEquipmentEditor.jsx
     7  src/components/duels/CreateInviteLinkModal.jsx
     6  src/lib/macroColors.js
     6  src/lib/leagueTiers.js
     5  src/components/hub/HubComposer.jsx   (content warnings)

then a tail of 1–4 across ~70 files. Nothing large is left; it is steady
file-by-file work.

**Also outstanding:**
- **tr is at 2,337/5,110.** Glossary and the register fix are done. Only
  batching remains — `next-batch.mjs tr 200` → translate → `add-keys.mjs`.
- **pt/de/it/nl/pl trail es/fr by ~180–260 keys** — mostly keys the parallel
  session added to en/es/fr only. `node scripts/i18n-audit.mjs --lang pt`.
- **A native prose pass is still owed on every locale.** `_meta.json` says
  "awaiting native review" and that must stay true. All of this is MACHINE
  draft. `coach.*` first, then `onboarding.*`, then notification bodies.

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

Scratchpad scripts (recreate if gone — the handoff before this one had to):
`lib.mjs`, `next-batch.mjs`, `add-keys.mjs`, `add-en.mjs`, `apply-fixes.mjs`,
`extract-defaults.mjs`, `triage2.mjs`, `stage.mjs`, `mojibake.mjs`,
`check-accents.mjs`. `add-keys` refuses the WHOLE batch on any placeholder,
newline or `**` mismatch, on an `englishOnly` key, or on a bad accentWord.

## A COGNATE GOES IN THE ALLOW-LIST, NOT THE BASELINE

When `englishEcho` rises on a genuine loanword — German "Option", Dutch
"Inbox", Italian "follower" — add it to `ALLOW_IDENTICAL_BY_LANG` in
`src/lib/i18n-check.js` with a reason. Unit symbols and feature names go in
the global `ALLOW_IDENTICAL`. Regenerating the ratchet to absorb a cognate
raises the ceiling for every future string too, which is how a no-regression
guard quietly stops guarding.
