Continue the flexyn2 i18n work (~/flexyn2-i18n — a worktree on branch
i18n-lang-eval, pushed to origin/main). Read the memory files
flexyn2-i18n-json-catalogs.md and flexyn2-glossary-grows-with-app.md first.

## FIRST, AND IT OUTRANKS EVERYTHING BELOW

**The coverage number is measuring the wrong denominator, and the app is
visibly English in Spanish.** A screenshot of the es dashboard showed "Log
last night's sleep", "Your daily chest is ready", "Free capsule + coins — tap
to open", "Bronze League", "feeds your readiness", "248 XP earned overall",
"Standing", "Friends this week", "Your progress" — while the same screen
rendered "Entrena 45 minutos" and "Días restantes" correctly.

Kegan's words: "these are common throughout the app", "most titles are all
english still", "and cards carasells". He is right and the metric was wrong.
Measured: **788 referenced-but-absent keys + 318 bare English object-literal
props ≈ 1,106 user-visible strings that no locale can ever translate.** Against
a real denominator of ~5,000 that is **~77% actual, not 99.4%.**

Three independent causes, confirmed:

1. **788 keys are referenced in source but absent from `en.json`.** They are
   called as `tFallback('some.key', 'English default')` where `some.key` was
   never added to the catalogs, so the English default renders in EVERY
   language, permanently. `dashboard.dailyChest.title` and
   `dashboard.dailyChest.subtitle` are two of them. Coverage cannot see this
   class at all, because coverage counts locale keys against `en.json` and
   these keys are not in `en.json`. Reproduce:

   ```
   node -e "
   const fs=require('fs'),path=require('path');
   const en=JSON.parse(fs.readFileSync('src/locales/en.json'));
   let files=[];(function w(d){for(const f of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,f.name);
    if(f.isDirectory()){if(!/node_modules|__tests__/.test(p))w(p);}else if(/\.(jsx?|tsx?)\$/.test(f.name))files.push(p);}})('src');
   const miss=new Set();
   for(const f of files){const s=fs.readFileSync(f,'utf8');
    for(const m of s.matchAll(/tFallback\(\s*['\`]([\w.]+)['\`]/g)) if(!(m[1] in en)) miss.add(m[1]+'  <- '+f);
    for(const m of s.matchAll(/\bt\(\s*['\`]([\w.]+)['\`]\s*\)/g)) if(!(m[1] in en)) miss.add(m[1]+'  <- '+f);}
   console.log(miss.size); [...miss].forEach(x=>console.log(' ',x));"
   ```

   Worst files (count of absent keys): `hub/HubProfile.jsx` 58,
   `hub/HubMessages.jsx` 43, `crews/CrewWarsMenu.jsx` 33,
   `hub/HubPostCard.jsx` 31, `pages/Dashboard.jsx` 27, `pages/Workout.jsx` 23,
   `crews/CrewDiscovery.jsx` 20, `settings/NotificationsSection.jsx` 19,
   `crews/CrewChallengeCard.jsx` 18, `pages/Nutrition.jsx` 18.

2. **318 bare English strings as object-literal props** (`title:`, `label:`,
   `sub:`, `desc:`) that never touch `t()`. Not JSX text, not an attribute —
   so `scripts/i18n-hardcoded.mjs` misses all of them. That scanner reports
   **1 TOTAL**, which is false; treat its green as unproven until it catches
   both classes. Worst files:

       71  src/lib/questCatalog.js        'Log a meal', 'Drink 4 glasses of water'
       48  src/lib/lootThemes.js          'Coral Rush', 'Mint Frost'
       43  src/components/dashboard/HeroSlideshow.jsx   'Personal Record', 'Standing'
       22  src/lib/ThemeContext.jsx       'Iron Orange', 'Electric Blue'
       12  src/components/cardio/CardioWearableStub.jsx
       10  src/lib/lootCatalog.js         'Common', 'Uncommon', 'Rare'
       10  src/lib/lootFrames.js
       10  src/pages/Nutrition.jsx
        7  src/lib/data/coinShop.js       'Standard Capsule'
        7  src/lib/nutritionPlans.js      'Lean Muscle Builder'

   `HeroSlideshow.jsx` IS the carousel Kegan is looking at, and
   `questCatalog.js` is almost certainly the quest mystery below: the card
   falls back to `def.label` — 71 hardcoded English labels — whenever the key
   lookup misses.

3. **es / fr / pt are 77 keys behind** — the parallel session added English
   keys during the coverage work. That is the only class the coverage number
   actually measures, and it is the smallest of the three.

So: locale catalogs are 3,873/3,895 against `en.json`, but the real
user-visible denominator is ~4,683 strings. **The honest figure is ~83%, not
99.4%.** Do not report catalog coverage as if it were what a user sees.

**What to do, in this order:**
- Fix the measurement before translating anything else. `npm run i18n:audit`
  and `_coverage.json` should count referenced-but-absent keys and
  object-literal strings, or at minimum fail loudly on them. A number that
  can read 99.4% while the dashboard is half English is worse than no number.
- Then triage the 788. Many will be dead references; some are live and
  user-visible. The dashboard ones are live — start there, since that is the
  first screen every user sees.
- Extend `i18n-hardcoded.mjs` to object-literal string properties, then
  re-run it and believe the count.
- **Not yet diagnosed, do not guess:** the quest labels. `es` HAS
  `quest.log_sleep.label` = "Registra el sueño de anoche", yet the screen
  showed "Log last night's sleep". The render path is
  `DailyQuestsCard.jsx:415` — `const k = \`quest.${def.id}.label\`; const v =
  t(k); return v === k ? def.label : v;` with an English fallback baked into
  `src/lib/questCatalog.js`. Either `def.id` does not match the key suffix or
  `t()` is not resolving there. I mis-wrote a regex trying to check this and
  did not confirm it — find out, do not assume.

## THE TRANSLATION WORK, WHICH IS ONLY PARTLY DONE

Finished and pushed, catalog-complete at 3,873/3,895 (every key except the 19
`englishOnly` and the 3 swim keys held for a native pass):

  **de, it, nl, pl** — ~8,900 strings this session, `npm run i18n:review`
  clean after every batch, all 11 onboarding accent words verified per locale.

In progress:

  **tr — 2,137/3,895 (54.9%), 1,736 left.** Glossary and the register fix are
  DONE and pushed; only batch translation remains. There is an
  **unapplied batch** at `<scratch>/tr-5.json` (~200 keys, written but never
  run through add-keys because the session was interrupted). Apply it first,
  then continue the loop.

Also fixed this session: **12 English strings in `en.json` were mojibake** —
`Level so far â tap to see` — UTF-8 written through latin-1 in the Gym Rival
commit `147001b2`. Repaired in `e9e50a3a`. Worth re-running
`<scratch>/mojibake.mjs` after any parallel-session merge.

## THE LOOP

    node <scratch>/next-batch.mjs tr 200     dump the next N untranslated keys
    ...translate into a {key: value} JSON file...
    node <scratch>/add-keys.mjs tr <file>    validates + writes
    npm run i18n:review -- tr                after every batch

Scripts live in the session scratchpad, not the repo — recreate if gone.
`add-keys` refuses the WHOLE batch (never a partial write) if any string's
placeholder set, newline count or `**` count differs from English, if the key
is `englishOnly`, or if an `onboarding.<step>.accentWord` is not a single
token appearing exactly once in its own heading. `apply-fixes.mjs` rewrites
EXISTING keys with the same validation. `replace.mjs` does Unicode-safe
whole-word swaps. `check-accents.mjs` runs the shipped matcher over every
locale — the guard test only covers RELEASED ones, so unreleased locales must
be checked out of band. Commit and push every ~400 strings.

## WHAT EACH LOCALE DECIDED, AND WHY

Every locale arrived with at least one defect that only shows up if you
measure BEFORE translating. Do this for any new locale.

- **The one-word-two-jobs collision appeared in it, pl and (as Regimen/Plan)
  pl again.** it: `Serie` = Streak AND Set → Streak became **Fiamma**
  (feminine like Serie, so agreements carried; chosen from the app's own
  iconography — StreakFlame.jsx, 82 Flame refs, 🔥 already in 3 strings).
  pl: `Seria` = Streak AND Set → **Passa**. Polish deliberately does NOT use
  the flame word: `płomień` is masculine while `seria` is feminine, so it
  would have broken agreement on all 18 strings for nothing.
- **The two-registers defect appeared in nl, tr and (already known) fr.**
  nl: 6 formal-`u` strings in a `je` catalog, all clustered in `cardio.*`;
  bare `u` is also the Dutch abbreviation for *uur*, so 6 of 12 hits were the
  unit — read them, do not count them. tr: **105 strings** in formal `siz`
  inside a `sen` catalog, the largest instance in the repo. Measured on the
  imperative (bare stem = sen, stem + -ın/-in = siz): 164 vs 61 before, 224 vs
  1 after. A pronoun count is nearly useless in Turkish — person lives in the
  suffix, and free `siz` appeared in only 4 of the 105.
- **Regimen is Programa/Programme/Programm/Program in es/fr/de/pl/pt/it/tr —
  and Schema in nl.** Dutch diverges on measured evidence: German needed
  Programm because German `Plan` was already translating the English word
  Plan, and that reason does not transfer — Dutch says plan/plannen everywhere
  and never Schema. Polish had German's exact problem (`Plan` = Regimen 26 AND
  Plan 11) and was settled the same way.
- **Turkish never had the Streak/Set collision** because it borrowed `set`
  from English, leaving `seri` free. Set/Sets, Exercise/Exercises and
  Coin/Coins each share one glossary row because Turkish agglutinates the
  plural — declared in `$acceptedCollisions`, same as Italian's invariant
  `serie`. Not the defect class.
- **Turkish Weight is deliberately two words:** `Kilo` is body weight,
  `Ağırlık` is the load on the bar. Fine when the language genuinely
  distinguishes two things; what was NOT fine was the same screen using both.

## TRAPS THAT COST TIME

- **`\b` is ASCII-only in JavaScript.** `\btes\b` matches inside "vous êtes".
  Use the `W()` lookaround helper in `scripts/i18n-review.mjs`.
- **German capitalised Sie/Ihr is ambiguous** (formal you, but also she/they).
  Same for Italian `Lei` and Dutch `u`. The tool lists them as candidates on
  purpose — read them.
- **German, Dutch and Turkish form closed compounds; Polish and Turkish
  inflect.** A kept term hides inside a longer word (Cardiotraining,
  trainingsschema, setini, na Hubie). i18n-review handles this — do not "fix" it.
- **Measure which way the corpus leans before mass-applying any term fix.**
  Every violation this session was checked against majority usage first.
- **The batch validator checks SHAPE; i18n-review checks VOCABULARY.** Polish
  needed both: 8 strings passed shape while translating `Reps`, which is
  doNotTranslate. Run review after every batch, not at the end.
- **origin/main moves every few minutes from a parallel session.** Rebase
  before pushing and confirm `git diff origin/main..HEAD --stat` lists only
  your files. Two rebase conflicts this session, both in `_coverage.json` /
  `en.json`; resolve by keeping THEIR new keys plus YOUR edit, never by
  taking one side wholesale.
- **Enforcing doNotTranslate RAISES `englishEcho`,** which the baseline
  ratchet reads as regression. Expected; regenerate and say why in the commit.

## NOT MINE TO DECIDE

- Nothing is released. `SUPPORTED_LANGUAGES` is still en/es/fr. Adding pt, de,
  it, nl, pl or tr to the picker is Kegan's call and a separate change.
- All of these are MACHINE drafts. `_meta.json` says "awaiting native review"
  for every one and that must stay true. The prose pass — `coach.*` first,
  then `onboarding.*`, then notification bodies — is what is still owed and is
  not something to machine-translate a second time.
- The six non-Latin locales (ja ko zh ar hi ru) keep terms by TRANSLITERATING
  them (カーディオ is Cardio), which a Latin-script matcher cannot check. Doing
  one needs the expected katakana/hangul/Cyrillic form per term recorded in
  `_glossary.json` first. Ask before starting.
- Production still has ZERO accounts on any non-English locale. Nothing
  validates adding languages; Kegan asked for them anyway, which is fine —
  just never present coverage as demand.
