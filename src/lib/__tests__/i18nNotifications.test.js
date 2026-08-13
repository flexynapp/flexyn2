// Structural tests for the `notifications` i18n domain (src/locales/*.json,
// sliced by the prefixes in src/locales/_meta.json).
//
// These check SHAPE, not translation quality — no test can tell you whether
// the Korean reads naturally. What they CAN stop are the silent failures,
// and this file has already been bitten by two of them:
//
//   • Seven keys were called with `tFallback(key, 'English')` at the call
//     site and defined in NO part file. Every language rendered English and
//     the coverage audit reported this file at 100%, because it compares
//     languages to each other and never to the call sites. The last
//     describe block below closes that gap.
//   • Thirteen keys are machine copy pending native review. A future pass
//     needs to know WHICH thirteen; a comment alone drifts.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { domainByLang, meta, keySet } from './i18nCatalogs.fixture';

const I18N = domainByLang('notifications');
const { machineTranslated, reviewPending } = meta();
const MACHINE_TRANSLATED = machineTranslated.notifications;
const REVIEW_PENDING = reviewPending.notifications;

const LANGS = ['en','es','fr','de','pt','it','ja','ko','zh','ar','hi','ru','tr','pl','nl'];
const OTHERS = LANGS.filter(l => l !== 'en');
const enKeys = Object.keys(I18N.en).sort();
// cwd-relative, like every other catalog test. An `import.meta` here trips
// Vite's transform ("Cannot split a chunk that has already been edited")
// now that this file imports the shared catalog fixture statically.
const SRC = path.resolve(process.cwd(), 'src');

describe('coverage', () => {
  it('ships all 15 supported languages', () => {
    expect(Object.keys(I18N).sort()).toEqual([...LANGS].sort());
  });

  it.each(OTHERS)('%s defines everything the English block does', (lang) => {
    const missing = enKeys.filter(k => !(k in I18N[lang]));
    expect(missing, `${lang} is missing: ${missing.join(', ')}`).toEqual([]);
  });

  it.each(OTHERS)('%s defines nothing whose English half is missing entirely', (lang) => {
    // What must never happen is a key with NO English at all —
    // `getTranslation` ends in `return enVal ?? key`, so an English speaker
    // would be shown the raw key path.
    //
    // This used to need the union of every part file, because a key's English
    // half could sit in a different file from its translations
    // (`notifications.markAllReadError` had English in i18n-batch2.js). One
    // flat catalog per language retires that whole class of split: en.json
    // either has the key or nothing does.
    const en = keySet('en');
    const extra = Object.keys(I18N[lang]).filter(k => !en.has(k));
    expect(extra, `${lang} has keys with no English anywhere: ${extra.join(', ')}`).toEqual([]);
  });

  it.each(LANGS)('%s has no blank values', (lang) => {
    for (const [k, v] of Object.entries(I18N[lang])) {
      expect(String(v).trim(), `${lang}.${k} is blank`).not.toBe('');
    }
  });

  it('no language is aliased to the English object', () => {
    // A part file doing `ko: enKeys` reports 100% coverage and ships an
    // entirely English screen. Found eight times across nine files once.
    for (const l of OTHERS) expect(I18N[l], `${l} is the en object`).not.toBe(I18N.en);
  });
});

describe('the machine-translated set is declared, not just commented', () => {
  it('every declared key exists', () => {
    for (const k of MACHINE_TRANSLATED) {
      expect(enKeys, `${k} is declared MT but is not a key`).toContain(k);
    }
  });

  it('every declared key has a value in all 15', () => {
    for (const k of MACHINE_TRANSLATED) {
      for (const l of LANGS) expect(I18N[l][k], `${l}.${k}`).toBeTruthy();
    }
  });

  it('REVIEW_PENDING is the 14 non-English languages until someone reviews one', () => {
    for (const l of REVIEW_PENDING) expect(OTHERS).toContain(l);
    expect(new Set(REVIEW_PENDING).size).toBe(REVIEW_PENDING.length);
  });

  it('the three borrowed labels are NOT claimed as machine copy', () => {
    // They reuse values a human wrote for leaderboards.achievements,
    // profile.journal.today and journal.yesterday. Listing them as MT
    // would send a reviewer to re-check human work.
    for (const k of [
      'notifications.tab.achievements',
      'notifications.group.today',
      'notifications.group.yesterday',
    ]) {
      expect(MACHINE_TRANSLATED).not.toContain(k);
      for (const l of LANGS) expect(I18N[l][k], `${l}.${k}`).toBeTruthy();
    }
  });
});

describe('placeholders', () => {
  // `{count}` / `{coins}` / `{day}` are substituted by the CALLER. A
  // translation that drops one renders a sentence with a hole; one that
  // translates the token breaks the .replace() just as silently. English
  // can never show you either, because English is the fallback.
  const TOKENS = (s) => (String(s).match(/\{[a-zA-Z_]+\}/g) || []).sort();

  it.each(OTHERS)('%s carries the same tokens English does', (lang) => {
    for (const k of enKeys) {
      expect(TOKENS(I18N[lang][k]), `${lang}.${k} token mismatch`).toEqual(TOKENS(I18N.en[k]));
    }
  });

  it('the two counted confirm strings keep {count} everywhere', () => {
    for (const k of ['notifications.clearAllConfirmTitle', 'notifications.clearAllConfirmHidden', 'notifications.newCount']) {
      for (const l of LANGS) {
        expect(I18N[l][k], `${l}.${k} lost {count}`).toContain('{count}');
      }
    }
  });
});

describe('nothing silently left in English', () => {
  // A non-English value identical to English is usually a skipped string.
  // The exceptions are real: loanwords and scripts that borrow the word.
  // Empty on purpose. Add a `lang:key` here only with the reason the two
  // languages genuinely share the string (a loanword, a borrowed script).
  const ALLOWED_IDENTICAL = new Set([]);

  it.each(OTHERS)('%s does not echo English on the machine-translated set', (lang) => {
    const echoed = MACHINE_TRANSLATED.filter(k =>
      I18N[lang][k] === I18N.en[k] && !ALLOWED_IDENTICAL.has(`${lang}:${k}`));
    expect(echoed, `${lang} echoes English for: ${echoed.join(', ')}`).toEqual([]);
  });
});

describe('the filtered-empty sentence names the tab that is actually on screen', () => {
  // It reads "Other notifications are waiting under All." — where "All" is
  // whatever `notifications.tab.all` renders. If a language translates the
  // sentence but writes a different word for the tab, it points the user at
  // a tab that does not exist. Latin-script languages only: the CJK and
  // Arabic renderings quote the label with their own punctuation, which a
  // substring check cannot see through reliably.
  const CHECKABLE = ['es', 'fr', 'de', 'pt', 'it', 'nl', 'tr', 'pl'];

  it.each(CHECKABLE)('%s uses its own tab.all label in the sentence', (lang) => {
    const tab = I18N[lang]['notifications.tab.all'];
    const desc = I18N[lang]['notifications.empty.filteredDesc'];
    expect(desc.toLowerCase(), `${lang}: "${desc}" does not mention "${tab}"`)
      .toContain(tab.toLowerCase());
  });
});

describe('every key the UI asks for is defined here', () => {
  // THE bug this file shipped with for months: `notifications.seeAll`,
  // `.loading`, `.fullSubtitle`, `.emptyDesc`, `.empty`, `.clearAllConfirm`
  // and `.clearAllFilteredConfirm` were called at real call sites and
  // defined nowhere, so all 15 languages rendered English while a
  // language-vs-language coverage audit reported this file complete.
  const FILES = [
    'components/NotificationPanel.jsx',
    'components/NotificationBell.jsx',
    'lib/data/notifications.js',
    'lib/notificationCatalog.js',
  ];

  it('no call site references a notifications.* key the corpus lacks', () => {
    // Checked against the whole English catalog, not just this domain slice:
    // a call site may reference a key that sorts outside the `notifications.`
    // prefix, and en.json is the single place English can live.
    const parts = { en: keySet('en') };
    const missing = [];
    for (const rel of FILES) {
      const full = path.join(SRC, rel);
      if (!fs.existsSync(full)) continue;
      const text = fs.readFileSync(full, 'utf8');
      // Match the TRANSLATION call specifically. A bare
      // /notifications\.[\w.]+/ also catches Sentry `feature:` tags
      // ('notifications.markRead', 'notifications.unmappedType'), which are
      // observability labels that share the namespace and are not keys.
      // `tFallback(key, …)` in components, `tr(t, key, …)` in the data
      // layer — the row.* strings are written at insert time and only ever
      // reach the corpus through that second form.
      const CALLS = /(?:\bt(?:Fallback)?\(\s*|\btr\(\s*\w+\s*,\s*)['"`](notifications\.[a-zA-Z0-9_.]+)['"`]/g;
      for (const m of text.matchAll(CALLS)) {
        const key = m[1];
        if (!parts.en.has(key)) missing.push(`${rel}: ${key}`);
      }
    }
    expect(missing, `keys used but never defined:\n${missing.join('\n')}`).toEqual([]);
  });
});
