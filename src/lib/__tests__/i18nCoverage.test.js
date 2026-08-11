// App-wide i18n coverage guards.
//
// These lock the invariants that produce visible damage, and deliberately
// do NOT assert 100% coverage — the app ships some features English-only
// on purpose (see CLAUDE.md's out-of-scope list), so a "no gaps" test
// would just get skipped past.
//
// The failure modes, worst first:
//
//   1. A key resolving to NOTHING. getTranslation falls back
//      `language → en → the raw key`, so a key absent from `en` too
//      renders its own path — "challenge.duration" on a button. This must
//      stay at zero.
//   2. A PARTIAL gap: translated in ten languages, missing in four. Shows
//      as one English line inside an otherwise-translated screen. Tracked
//      with a ratchet so it can shrink but not silently grow.
//
// `node scripts/i18n-audit.mjs` reports the same data in detail;
// `--partial` lists exactly which keys and languages.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const LANGS = ['en','es','fr','de','pt','it','ja','ko','zh','ar','hi','ru','tr','pl','nl'];
const OTHERS = LANGS.filter(l => l !== 'en');
const DIR = 'src/lib/i18n-langs';

const keys = Object.fromEntries(LANGS.map(l => [
  l,
  new Set([...fs.readFileSync(path.join(DIR, `${l}.js`), 'utf8').matchAll(/"([^"]+)":/g)].map(m => m[1])),
]));
const en = keys.en;

/** Every bare `t('key')` in the app, with comments stripped. */
function collectCallSites() {
  const bare = new Map();
  const safe = new Set();
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!/__tests__|node_modules|i18n-langs/.test(e.name)) walk(p);
        continue;
      }
      if (!/\.jsx?$/.test(e.name) || /^i18n-/.test(e.name)) continue;
      const src = fs.readFileSync(p, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const m of src.matchAll(/\btFallback\(\s*['"]([\w.]+)['"]\s*,/g)) safe.add(m[1]);
      for (const m of src.matchAll(/\bt\(\s*['"]([\w.]+)['"]\s*\)(?!\s*(?:\|\||\?\?))/g)) {
        if (!bare.has(m[1])) bare.set(m[1], new Set());
        bare.get(m[1]).add(p.replace(/^src\//, ''));
      }
    }
  })('src');
  return { bare, safe };
}

describe('no key can render as a raw key path', () => {
  it('every bare t() call resolves to something', () => {
    const { bare, safe } = collectCallSites();
    const unresolvable = [...bare.keys()]
      .filter(k => !en.has(k) && !safe.has(k))
      .map(k => `${k} (${[...bare.get(k)].join(', ')})`)
      .sort();
    // A bare t('x') with no English definition puts the literal string
    // 'x' on screen. Either add it to a part file or switch the call to
    // tFallback('x', 'English').
    expect(unresolvable).toEqual([]);
  });
});

describe('every language file is loadable and non-trivial', () => {
  it.each(LANGS)('%s has a populated aggregate', (lang) => {
    expect(keys[lang].size).toBeGreaterThan(1000);
  });

  it('no language has keys English lacks', () => {
    // The reverse direction: a key only in `es` is dead weight nothing
    // can reach, since every call site is written against the English set.
    for (const l of OTHERS) {
      const orphans = [...keys[l]].filter(k => !en.has(k));
      expect(orphans, `${l} has keys absent from en: ${orphans.slice(0, 5).join(', ')}`).toEqual([]);
    }
  });
});

describe('partial-gap ratchet', () => {
  // Keys translated in SOME languages but not others. Unlike an
  // English-only feature (missing everywhere, usually deliberate), these
  // are oversights. The ceiling only ever moves down — lower it when you
  // close gaps so the improvement is locked in.
  //
  // 55 after clearing eleven namespaces. The enKeys-aliasing root cause
  // is now gone entirely and guarded by the test below, so what remains
  // here is ordinary partial coverage rather than that class of bug.
  const CEILING = 55;

  it(`has no more than ${CEILING} partial gaps`, () => {
    const partial = [...en].filter(k => {
      const missing = OTHERS.filter(l => !keys[l].has(k)).length;
      return missing > 0 && missing < OTHERS.length;
    });
    expect(
      partial.length,
      `partial gaps went up. Run: node scripts/i18n-audit.mjs --partial`
    ).toBeLessThanOrEqual(CEILING);
  });

  // Namespaces shipped English-only ON PURPOSE, awaiting a native-speaker
  // pass. Excluded from the denominator below — NOT from the app, where they
  // render English in every locale exactly as they did when the copy was
  // hardcoded in JSX.
  //
  // Why this list exists at all: the floor used to count TOTAL coverage, so
  // it fell whenever `en` grew — including when English-only strings were
  // extracted OUT of JSX into keys. That penalised the workflow CLAUDE.md
  // prescribes ("ship English-only with a TODO(i18n)") and rewarded leaving
  // copy hardcoded, where no audit could see it at all. The cardio
  // extraction cost a notch (0.80 → 0.79) for 18 keys; onboarding's 237 NEW
  // ones would have cost ten points, for a change that took the flow from
  // untranslatable to translatable and left not one user-visible string
  // different.
  //
  // So the metric now asks the question it always meant to: of the copy we
  // have COMMITTED to translating, how much is done? Moving a namespace in
  // here is a deliberate act with a name attached; it is not the same as
  // lowering the floor for everybody.
  //
  // Burn-down rules:
  //   • Add a prefix ONLY when the whole namespace is new and English-only.
  //   • DELETE the prefix the moment its translations land — the guard below
  //     fails on a stale entry, so this list cannot quietly become permanent.
  //   • A partial translation does not belong here. Finish it or leave it
  //     counted.
  const AWAITING_TRANSLATION = [
    // Onboarding flow — extracted from JSX 2026-08-05 (audit 18 #6). The
    // first thing every new user reads, so CLAUDE.md forbids machine
    // translation outright. Needs a native pass in 14 languages.
    //
    // This prefix exempts the WHOLE namespace, which is **275 keys** today.
    // The "237" in the preamble above is a different number and is correct:
    // that extraction ADDED 237 (87 → 324 in one commit, measured against
    // dfc41585^), which is the cost the old total-coverage metric would have
    // charged it. The namespace has since been trimmed 324 → 275. Two counts,
    // both right — don't reconcile them by editing one to match the other.
    //
    // WHEN THIS PREFIX GOES, RAISE `FLOOR` TO 0.80 (kegan, 2026-08-10).
    // Deleting it here is already forced — the stale-prefix guard above
    // fails otherwise — so this note sits where that edit has to happen
    // rather than somewhere it would be read too late. The measurement is
    // in the FLOOR comment below; you do not need to re-derive it.
    'onboarding.',
    // Tap-to-copy — extracted from JSX 2026-08-10. `TapToCopy` built both
    // its toast and its aria-label by interpolating an English noun into an
    // English frame, so six screens' worth of copy feedback was English in
    // all 15 languages. A whole new namespace, all English-only, so this is
    // the sanctioned bare-prefix case. Worth a translator rather than a
    // machine despite being seven short strings: the two frames need
    // rewriting, not translating — see i18n-copy.js.
    'copy.',
    // Body heat map — extracted from JSX 2026-08-10. Progress → Body had
    // ZERO translation calls: every string on the tab was an English
    // literal, so all 15 languages already read English there. The keys
    // change nothing on screen and make the tab translatable for the first
    // time. Prose (the three headlines and their body copy), so CLAUDE.md
    // forbids machine translation; needs a native pass in 14 languages.
    //
    // Scoped `bodyMap.` and NOT `body.` — `body.` would swallow the
    // body-metrics namespace next door, which is translated.
    'bodyMap.',
    // League activity gating — new namespace, migration 310 (2026-08-08).
    // Qualification and promote/demote zone copy. Named `league.gate.` rather
    // than dropped loose under `league.` precisely so this exemption cannot
    // swallow the league keys that ARE translated (daysLeft, topPromoted, …).
    'league.gate.',
    // League seasons — new namespace, migration 312 (2026-08-08).
    'league.season.',
    // Season-end ceremony — new namespace, migration 312 (2026-08-08).
    'league.ceremony.',
    // "How leagues work" explainer — new namespace, 2026-08-09. Long-form
    // prose describing the ranking rules, so CLAUDE.md forbids machine
    // translation; needs a native pass in 14 languages.
    'league.info.',
    // Daily-quests expansion, 2026-08-09. The sheet's whole copy deck plus
    // 19 new quest labels/descriptions. All prose (CLAUDE.md forbids
    // machine-translating it) and all reached through tFallback or the
    // catalog's English fallback, so a missing locale renders sensible
    // English rather than a raw key.
    //
    // Listed one quest id at a time rather than as a bare `quest.` prefix on
    // purpose: `quest.` would also exempt the 14 entries that ARE translated
    // and hide a future regression in them. The "every prefix still has
    // untranslated keys" test above then forces each line to be deleted as
    // its translations land, which is the mechanism working.
    // Injuries / Recovery Mode — new namespace, 2026-08-09. InjuryForm and
    // InjuryBanner had NO i18n at all: every body part, severity, button,
    // empty state and toast was hardcoded English in a 15-language app. The
    // strings are now extracted to `i18n-injuries.js` and reached through
    // tFallback, so a missing locale renders correct English rather than a
    // key code — which is strictly better than where this started.
    //
    // English-only on purpose. Most of this copy is the app explaining that
    // it has REMOVED training from someone's plan ("That area comes out until
    // you clear it", "Those exercises come back into your sessions straight
    // away"), and a machine translation that lands slightly wrong there reads
    // as a bug rather than as a coach. CLAUDE.md forbids it for exactly this
    // shape of copy. Needs a native pass in 14 languages; the file head
    // carries notes for whoever does it.
    //
    // Note this does NOT exempt the muscle-group names — those already ship
    // in all 15 languages under bare keys (`chest`, `glutes`, …) and both
    // components look them up there, so they stay counted.
    'injuries.',
    // Progress page main view — new namespaces, 2026-08-10. The hero
    // carousel, timeframe stats card, last-workout callout, Top PRs rail,
    // tab bar and Weekly Review summary were ~55 hardcoded English literals
    // in a 15-language app. Extracted to `i18n-progress.js` and reached
    // through tFallback, so a missing locale renders correct English.
    //
    // Listed as eleven narrow prefixes rather than a bare `progress.` for
    // the reason `league.gate.` is: `progress.` would also exempt the ~96
    // keys in that namespace that ARE translated (the chart headings, the
    // filter labels, progress.today / yesterday / all) and hide any future
    // regression in them. Every prefix below is a namespace this change
    // created, so each one holds English-only keys and nothing else.
    //
    // Note what is deliberately NOT here: 'Today', 'Yesterday' and 'All'
    // are not new keys at all. `progress.today` / `.yesterday` / `.all`
    // already shipped in 15 languages and had simply stopped being called;
    // those call sites now point back at them and stay counted.
    'progress.tab.',
    'progress.frame.',
    'progress.frameShort.',
    'progress.stat.',
    'progress.carousel.',
    'progress.slide.',
    'progress.lastWorkout.',
    'progress.topPRs.',
    'progress.pb.',
    // Also covers the PR History modal, extracted 2026-08-10 — it had zero
    // translation calls, the same defect as the Body tab on a smaller
    // surface, and `progress.pb.history` (the button that opens it) was
    // already here.
    'progress.analytics.',
    'progress.review.',
    // Added with the layout change (2026-08-10): the Recent section that
    // replaced the last-workout card and the Top PRs rail.
    'progress.recent.',
    // The two Progress modals rebuilt as sheets (2026-08-10). New
    // namespaces, English-only, reached through tFallback.
    'analyticsSheet.',
    'pbSheet.',
    // Exercise Trends rebuild (2026-08-10). A whole new namespace, all of
    // it English-only, so this is the sanctioned bare-prefix case rather
    // than the narrow-prefix one above: there is nothing under `trends.`
    // that predates this change, so the prefix cannot exempt a translated
    // key by accident. The keys are the metric switch, the three empty
    // states and the two filter chips — see the notes in
    // `src/lib/i18n-progress.js`, which flag the two that need care
    // (`trends.metric.e1rm` must keep its hedge; `trends.oneSession` must
    // not read as an error).
    //
    // Deliberately NOT here, and it matters: the muscle-group names on the
    // group headers, which come from `muscleGroups.<key>` and already ship
    // in 15 languages. The tab looks them up there rather than carrying a
    // second vocabulary, so they stay counted.
    'trends.',
    // Muscle regions (2026-08-10) — the four buckets the validated colour
    // encoding can carry, in `src/lib/i18n-regions.js`. A whole new
    // namespace, all English-only, so this is the sanctioned bare-prefix
    // case: nothing under `regions.` predates it.
    //
    // Four keys, and worth a translator's attention rather than a machine's
    // despite being short: Push / Pull / Legs is gym vocabulary that most
    // training traditions already have their own word for, so the right
    // translation is the term lifters actually use, not a literal one.
    'regions.',
    // Insights tab (2026-08-10, audit 21). The same shape as `trends.`
    // directly above, and the same sanctioned bare-prefix case: nothing
    // under `insights.` predates this change, so the prefix cannot exempt
    // a translated key by accident.
    //
    // The tab had ZERO translation calls before — every string in it was a
    // hardcoded English literal in a 15-language app, which is why 92 keys
    // arrive at once. They all land through tFallback, so an untranslated
    // locale renders correct English rather than a key path.
    //
    // This is dilution, not regression, and the distinction is the reason
    // the exemption is legitimate here: no language LOST a key. Measured
    // before adding this line — every language moved down by the same ~2.4
    // points purely because 92 English-only keys entered the denominator.
    // If this prefix is ever reached for after a language actually drops
    // translated copy, that is the misuse the FLOOR comment warns about.
    //
    // The CSV column headers are deliberately absent: they stay English by
    // design (a localized header breaks whatever script the file is piped
    // into), so they are literals at the call site rather than keys.
    'insights.',
    // AI Coach generated text (2026-08-10). Narrow prefixes, not a bare
    // `coach.`, for the reason `league.gate.` is narrow: `coach.title`,
    // `coach.subtitle`, `coach.placeholder` and the welcome copy ARE
    // translated in several languages, and a blanket prefix would stop
    // guarding them.
    //
    // These are the coach's own sentences — training advice, not labels — so
    // CLAUDE.md forbids machine-translating them outright. A wrong
    // translation here tells someone the wrong thing about lifting in a
    // deficit or about ligament laxity around ovulation.
    //
    // Note the English lives TWICE on purpose: here, and as the tFallback
    // fallback at the point of use. The generators are pure modules that
    // cannot reach an i18n file, so the sentence has to travel with the rule
    // it belongs to. Edit both or they drift.
    'coach.note.',
    'coach.goal.',
    'coach.fuel.',
    'coach.feel.',
    'coach.plan.',
    'coach.schedule.',
    'coach.reply.',
    'coach.onboarding.',
    'quests.',
    'quest.cardio_session.',
    'quest.log_sleep.',
    'quest.log_mood.',
    'quest.steps_5k.',
    'quest.hub_react_3.',
    'quest.log_body_metric.',
    'quest.workout_30min.',
    'quest.sets_20.',
    'quest.steps_10k.',
    'quest.hub_comment_2.',
    'quest.cardio_double.',
    'quest.volume_10k.',
    'quest.workout_60min.',
    'quest.sets_40.',
    'quest.volume_25k.',
    'quest.steps_15k.',
    'quest.crew_workout.',
    'quest.crew_cardio.',
    'quest.crew_chat_3.',
    'quest.crew_steps_8k.',
    'quest.crew_volume_15k.',
    'quest.crew_fuel_2.',
    // Settings moved out of the ProfileMenu dropdown onto its own route
    // (/settings + seven subpages), 2026-08-09. 67 keys in
    // src/lib/i18n-settings-nav.js: the index rows and their one-line
    // hints, the group headings inside each subpage, and — this is most of
    // them — strings that were HARDCODED ENGLISH inline in the old
    // SettingsPanel and had no key at all ("Private profile", "Blocked
    // users", "Muted users", "My reports", "Default story visibility",
    // "Body Stats", "Privacy"). So these keys don't reduce what a Spanish
    // user can read; they make previously-unreachable copy translatable.
    // All prose, so CLAUDE.md forbids machine-translating it, and every
    // call site is `tFallback(key, 'English')`.
    //
    // Prefixes are narrow ON PURPOSE. A bare `settings.` would exempt the
    // whole namespace and hide a regression in the ~40 settings keys that
    // ARE translated — verified that each prefix below catches only the new
    // keys and nothing else.
    'settings.section.',
    'settings.group.',
    'settings.stat.',
    'settings.sex.',
    'settings.appearance.',
    'settings.privateProfile.',
    'settings.hideFromSearch.',
    'settings.blockedUsers.',
    'settings.mutedUsers.',
    'settings.myReports.',
    'settings.export.',
    'settings.admin.',
    'settings.build.',
    // Progress → Photos tab revamp, 2026-08-10. Same shape as the settings
    // block above and listed exactly for the same reason: the `photos.`
    // namespace already holds ~17 fully-translated keys, so a bare prefix
    // would exempt those too and hide a real regression in them.
    //
    // Most of these do not reduce what a non-English user can read — they
    // ADD a key where there was none. The compare slider shipped with
    // "Compare Photos", "Before", "After", "Choose before", "N days apart",
    // "Drag the divider to compare" and "Select two photos above to compare
    // them" HARDCODED in English with no key at all, so a Spanish user read
    // English there whether or not this list exists. The genuinely new copy
    // is the Add-photo CTA, the empty-state hint and the viewer chrome.
    // All `tFallback(key, 'English')`; prose, so CLAUDE.md forbids
    // machine-translating it.
    'photos.addPhoto',
    'photos.emptyHint',
    'photos.compare',
    'photos.compareTitle',
    'photos.compareBefore',
    'photos.compareAfter',
    'photos.compareChooseBefore',
    'photos.compareChooseAfter',
    'photos.compareApartOne',
    'photos.compareApartMany',
    'photos.compareDragHint',
    'photos.compareEmpty',
    'photos.viewer',
    'photos.prev',
    'photos.next',
    'photos.position',
    // The rest sit inside namespaces that already hold translated keys, so
    // they are listed exactly rather than by prefix.
    'settings.inAppAlerts.hint',
    'settings.cycleTracking.hint',
    'settings.gymRival.title',
    'settings.gymRival.desc',
    'settings.story.defaultVisibility',
    'settings.story.friendsOnly',
    'settings.story.public',
    'settings.story.blockedAccounts',
    'settings.block.placeholder',
    'settings.block.action',
    'settings.block.empty',
    'settings.block.undo',
    'settings.mute.undo',
    'settings.quiet.startLabel',
    'settings.quiet.endLabel',
    // Progress surfaces, 2026-08-10. These keys were ALREADY being called
    // — correct `tFallback(key, 'English')` at every site — but no part
    // file defined them, so they resolved to their inline fallback and were
    // invisible to both this audit and anyone doing a translation pass. The
    // copy on screen has not changed; the keys simply exist now, in
    // `i18n-progress.js`. Listed individually because each namespace has
    // translated keys elsewhere that a bare prefix would wrongly exempt.
    'photos.saveError',
    'photos.closeCamera',
    'photos.flipCamera',
    'photos.saving',
    'photos.migratePartial',
    'photos.capturedAlt',
    'photos.cameraError',
    'calendar.future',
    'calendar.heatmapLabel',
    'trainingPattern.kicker',
    'achievements.shareSuccess',
    'achievements.shareFailed',
    'progress.nextUp',
    'progress.locked',
    'progress.noneCompletedTitle',
    // Cardio swimming + activity-tile descriptions, 2026-08-11. Swimming
    // was added to the picker without `cardio.type.*` keys, so a pool swim
    // rendered the literal "cardio.type.swimming_pool" on six surfaces
    // including a shared Hub post; and Running/Walking/Biking all reused
    // `cardio.subtitle`, so three tiles in one 2x2 grid carried an
    // identical description.
    //
    // English-only because the activity they belong to already is —
    // `cardio.modes.swimming` has no translation either — so a native pass
    // should take the whole swimming set in one go rather than these two
    // labels in isolation.
    //
    // Listed as EXACT KEYS, not a `cardio.type.` prefix: six of the eight
    // cardio.type.* keys are translated in all 15 languages and a bare
    // prefix would exempt them too, hiding a future regression in copy
    // that is finished. Same reasoning as the quest ids above.
    //
    // These five are only the keys added on 2026-08-11. The rest of
    // i18n-cardio.js's English-only block — 20 more keys, the swim
    // question/env labels and the utility-tile names — stays COUNTED, and
    // is why `ru` sits close to the floor. Exempting those is a coverage
    // policy call, not a side effect of a labels fix.
    //
    // MEASURED 2026-08-11, because the FLOOR note below is right that a
    // floor sitting flush re-trips on the next honest extraction:
    //   as it stands (these 5 exempt)   ru 79.21%, 1703 counted — 0.21 pts
    //                                   of headroom, i.e. about four keys
    //   all 25 cardio English-only keys ru 80.15%, 1683 counted — 1.15 pts
    // The second option also clears the 0.80 the FLOOR comment wants to
    // return to. It is left undone deliberately: it changes the measured
    // coverage of pre-existing debt, which is kegan's call and not a side
    // effect of naming two swim types. Whoever picks it up does not need
    // to re-derive these numbers.
    'cardio.type.swimming_pool',
    'cardio.type.swimming_openwater',
    'cardio.modes.running.desc',
    'cardio.modes.walking.desc',
    'cardio.modes.biking.desc',
    // Goals: target date, archive, and the status badges — 2026-08-11.
    //
    // Scoped to three NARROW prefixes, never a bare `goals.`, which would
    // swallow the ~30 goals keys already translated in all 15 languages.
    // Same reasoning as `league.gate.` above.
    //
    // `goals.deadline.` and `goals.archive.` are genuinely new copy for two
    // features that did not exist: the `deadline` column was 0-of-5 populated
    // with no input anywhere, and there was no archive at all. Prose plus a
    // pluralised count, so CLAUDE.md forbids machine translation.
    //
    // `goals.badge.` is a different case and is exempted for a different
    // reason: those three strings were RAW ENGLISH LITERALS in GoalsList's
    // JSX with no key, so all 15 languages already rendered them in English.
    // Keying them changes nothing on screen and makes them translatable for
    // the first time — the coverage ratio moves, the user's experience does
    // not. Do not read this entry as new untranslated debt.
    'goals.deadline.',
    'goals.archive.',
    'goals.badge.',
    // The row's ⋮ trigger had no accessible name at all. Exact key, not a
    // `goals.` prefix, for the same swallowing reason as the three above.
    'goals.rowMenu',
  ];

  const pending = (k) => AWAITING_TRANSLATION.some(p => k.startsWith(p));
  const counted = [...en].filter(k => !pending(k));

  it('every awaiting-translation prefix still has untranslated keys', () => {
    // A prefix that no longer matches anything untranslated has done its job
    // and must be removed, or it silently exempts future keys that happen to
    // share the namespace.
    for (const prefix of AWAITING_TRANSLATION) {
      const stillMissing = [...en].some(k =>
        k.startsWith(prefix) && OTHERS.some(l => !keys[l].has(k)));
      expect(
        stillMissing,
        `"${prefix}" is fully translated — delete it from AWAITING_TRANSLATION`,
      ).toBe(true);
    }
  });

  // 0.79, lowered from 0.80 (kegan, Aug 2026 — deliberate, not drift).
  //
  // Note the failure mode when this trips: `expect` throws on the first
  // language in OTHERS order, so the message names ONE language when eight
  // may have moved. Run `node scripts/i18n-audit.mjs` for the full picture
  // before concluding the damage is small.
  //
  // With onboarding excluded the lower bound is `ru` again. If this trips
  // now it means a language actually LOST ground on copy we said we'd
  // translate — so translate, don't loosen, and don't reach for
  // AWAITING_TRANSLATION to make it green.
  //
  // GOES BACK TO 0.80 WHEN `onboarding.` LEAVES AWAITING_TRANSLATION
  // (kegan, 2026-08-10). Measured rather than assumed, on the aggregates as
  // they stand today: 1,690 counted keys, 275 under `onboarding.`, lower
  // bound `ru` at 79.5%. Translating those 275 adds the same count to both
  // sides of the ratio, so every language moves UP — `ru` to 82.4%, `ja` to
  // 84.0%. 0.80 therefore clears with ~2.4 points of headroom, which is the
  // point: a floor set flush against the minimum re-trips on the next
  // honest extraction, which is how it came down from 0.80 in the first
  // place. 0.82 would also pass today; 0.80 is the deliberate, conservative
  // number, and the one to use.
  const FLOOR = 0.79;

  it(`coverage does not regress below ${FLOOR * 100}% in any language`, () => {
    for (const l of OTHERS) {
      const covered = counted.filter(k => keys[l].has(k)).length;
      const pct = covered / counted.length;
      expect(pct, `${l} coverage fell to ${(pct * 100).toFixed(1)}%`).toBeGreaterThan(FLOOR);
    }
  });
});

describe('no language may be aliased to the English object', () => {
  // THE bug of this whole cleanup, found eight times across nine files.
  // A part file that does `it: enKeys, ko: enKeys, …` reports 100% key
  // coverage to any presence-based audit while rendering pure English to
  // those users. notifications, formcoach, gauntlet, marketplace,
  // discovery, league, generator, coach and share all shipped this way.
  //
  // The shortcut is understandable — it makes a namespace "complete"
  // instantly — but it is indistinguishable from finished work unless
  // you compare VALUES, which is why it survived so long. This test
  // makes the shortcut fail loudly instead.
  //
  // If you genuinely want a language to fall back to English, delete the
  // key from that language entirely. getTranslation already resolves
  // `language -> en -> key`, so omission gives you the English fallback
  // AND stays visible to the audit as a real gap.
  it('no i18n part file maps a non-English locale to enKeys', () => {
    const dir = 'src/lib';
    const offenders = [];
    for (const f of fs.readdirSync(dir).filter(x => /^i18n-.*\.js$/.test(x))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const hits = src.match(/\b(es|fr|de|pt|it|ja|ko|zh|ar|hi|ru|tr|pl|nl)\s*:\s*enKeys\b/g);
      if (hits) offenders.push(`${f} (${hits.length}: ${hits.join(', ')})`);
    }
    expect(
      offenders,
      'A locale aliased to enKeys looks translated but renders English. ' +
      'Either translate it, or omit the keys so the fallback is visible.'
    ).toEqual([]);
  });
});

describe('the i18n-check allow-lists stay honest', () => {
  // src/lib/i18n-check.js suppresses "untranslated" warnings for two
  // reasons: universal codes/units, and per-language cognates. Both are
  // load-bearing — a checker that cries wolf gets ignored, and it was
  // emitting 366 warnings before these were populated.
  //
  // But an allow-list is also the easiest place to hide a real gap, so
  // these two tests bound it in both directions.
  const src = fs.readFileSync(path.join('src/lib', 'i18n-check.js'), 'utf8');
  const NON_LATIN = ['ja', 'ko', 'zh', 'ar', 'hi', 'ru'];

  const perLang = {};
  for (const m of src.matchAll(/^ {2}(es|fr|de|pt|it|tr|pl|nl|ja|ko|zh|ar|hi|ru): new Set\(\[([\s\S]*?)\]\),/gm)) {
    perLang[m[1]] = [...m[2].matchAll(/'([\w.]+)'/g)].map(x => x[1]);
  }

  it('never allow-lists a cognate for a non-Latin-script language', () => {
    // A Japanese, Korean, Chinese, Arabic, Hindi or Russian value that
    // equals the English one cannot be a coincidence — different script.
    // It is always an untranslated string, so it must always warn.
    const bad = NON_LATIN.filter(l => perLang[l]?.length);
    expect(
      bad,
      `cognate allow-list must not cover non-Latin scripts: ${bad.join(', ')}`
    ).toEqual([]);
  });

  it('has no stale entries — every allow-listed cognate is still identical', () => {
    // If a key gets translated later, its allow-list entry becomes dead
    // weight that would silently suppress a future regression.
    const stale = [];
    for (const [lang, keys] of Object.entries(perLang)) {
      const dict = Object.fromEntries(
        [...fs.readFileSync(path.join(DIR, `${lang}.js`), 'utf8')
          .matchAll(/"((?:[^"\\]|\\.)+)":\s*"((?:[^"\\]|\\.)*)"/g)].map(m => [m[1], m[2]])
      );
      const enDict = Object.fromEntries(
        [...fs.readFileSync(path.join(DIR, 'en.js'), 'utf8')
          .matchAll(/"((?:[^"\\]|\\.)+)":\s*"((?:[^"\\]|\\.)*)"/g)].map(m => [m[1], m[2]])
      );
      for (const k of keys) {
        if (dict[k] !== undefined && enDict[k] !== undefined && dict[k] !== enDict[k]) {
          stale.push(`${lang}:${k}`);
        }
      }
    }
    expect(stale, `remove these from ALLOW_IDENTICAL_BY_LANG: ${stale.join(', ')}`).toEqual([]);
  });
});
