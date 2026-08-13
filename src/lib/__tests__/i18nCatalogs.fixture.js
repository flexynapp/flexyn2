// Shared loader for the i18n catalogs, for tests that assert on catalog
// CONTENT rather than on runtime behaviour.
//
// Replaces the old `i18nAllParts.fixture.js`, which existed to paper over a
// problem the JSON catalogs no longer have: under the part-file layout a
// key's English half and its translations could live in different files
// (`notifications.markAllReadError` had English in i18n-batch2.js and the
// other 14 languages in i18n-notifications.js), so a per-file symmetry test
// could not tell a legitimate split from an orphan. One flat catalog per
// language makes that distinction meaningless — a key is in a language, or
// it is not.
import fs from 'node:fs';
import path from 'node:path';

// Resolved from the repo root rather than `import.meta.url`. Vitest already
// runs with cwd at the root (every other catalog test reads
// 'src/locales/en.json' directly), and a second `import.meta` in a module
// this widely imported trips Vite's transform with
// "Cannot split a chunk that has already been edited".
export const LOCALES_DIR = path.resolve(process.cwd(), 'src', 'locales');

export const LANGS = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'ar', 'hi', 'ru', 'tr', 'pl', 'nl'];

/** One language's catalog as a plain key → string object. */
export function catalog(lang) {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), 'utf8'));
}

/** Every catalog, keyed by language code. */
export function allCatalogs() {
  return Object.fromEntries(LANGS.map((l) => [l, catalog(l)]));
}

/** Translation policy — see src/locales/_meta.json. */
export function meta() {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, '_meta.json'), 'utf8'));
}

/** Keys of a catalog, as a Set — the common case in symmetry assertions. */
export function keySet(lang) {
  return new Set(Object.keys(catalog(lang)));
}

/**
 * Catalog entries whose key starts with any of `prefixes`, as key → string.
 * Domain-scoped tests (journal, equipment, notifications, cardio, body map)
 * used to import a single part file; they now slice the flat catalog.
 */
export function domain(lang, prefixes) {
  const list = Array.isArray(prefixes) ? prefixes : [prefixes];
  const all = catalog(lang);
  const out = {};
  for (const k of Object.keys(all)) if (list.some((p) => k.startsWith(p))) out[k] = all[k];
  return out;
}

/**
 * A domain across every language, in the `{ en: {...}, es: {...} }` shape the
 * old per-domain part files exported — so the structural guards that used to
 * import `journalI18n` / `equipmentI18n` keep asserting exactly what they did.
 *
 * Languages that define none of the domain's keys are OMITTED, matching the
 * part-file shape (a part file simply had no block for a language it did not
 * cover). Tests that assert "ships all 15 languages" therefore still fail if
 * a domain silently loses one.
 *
 * @param {string} name — a key of `domains` in src/locales/_meta.json
 */
export function domainByLang(name) {
  const prefixes = meta().domains[name];
  if (!prefixes) throw new Error(`unknown i18n domain "${name}" — add it to src/locales/_meta.json`);
  const out = {};
  for (const lang of LANGS) {
    const block = domain(lang, prefixes);
    if (Object.keys(block).length) out[lang] = block;
  }
  return out;
}

// Back-compat shape for the one consumer of the old fixture.
export default { en: new Set(Object.keys(catalog('en'))) };
