// Structural tests for src/lib/i18n-journal.js.
//
// These check SHAPE, not translation quality — no test can tell you
// whether the Korean reads naturally. What they can do is stop the
// silent failures: a locale drifting out of sync when someone adds a key
// to `en` only, a lost {n} placeholder, a string quietly left in English
// and mistaken for translated — and, unique to this file, a PROSE string
// getting machine-translated later by someone who did not read the
// header.
//
// The split this file exists for: 46 short labels are machine
// translated; 14 full sentences are deliberately English in every
// language and listed in ENGLISH_ONLY. The tests enforce both halves.

import { describe, it, expect } from 'vitest';
import { journalI18n, REVIEW_PENDING, ENGLISH_ONLY } from '../i18n-journal';

const LANGS = ['en','es','fr','de','pt','it','ja','ko','zh','ar','hi','ru','tr','pl','nl'];
const OTHERS = LANGS.filter((l) => l !== 'en');
const enKeys = Object.keys(journalI18n.en).sort();
const labelKeys = enKeys.filter((k) => !ENGLISH_ONLY.includes(k)).sort();

describe('coverage', () => {
  it('ships all 15 supported languages', () => {
    for (const l of LANGS) expect(journalI18n[l], `missing block: ${l}`).toBeTruthy();
    expect(Object.keys(journalI18n).sort()).toEqual([...LANGS].sort());
  });

  it.each(OTHERS)('%s has exactly the LABEL key set — no more, no less', (lang) => {
    // Not the full English set: prose is deliberately absent. A language
    // with extra keys means someone translated a sentence; a language with
    // missing keys means it drifted.
    expect(Object.keys(journalI18n[lang]).sort()).toEqual(labelKeys);
  });

  it.each(LANGS)('%s has no blank values', (lang) => {
    for (const [k, v] of Object.entries(journalI18n[lang])) {
      expect(String(v).trim(), `${lang}.${k} is blank`).not.toBe('');
    }
  });
});

describe('the prose hold', () => {
  it('every ENGLISH_ONLY key exists in en', () => {
    for (const k of ENGLISH_ONLY) {
      expect(journalI18n.en[k], `ENGLISH_ONLY lists ${k} but en does not define it`).toBeTruthy();
    }
  });

  it.each(OTHERS)('%s defines NONE of the prose keys', (lang) => {
    // The guard the header asks for: a future pass must not quietly
    // machine-translate a sentence. Removing a key from ENGLISH_ONLY is a
    // deliberate act; slipping a translation in beside the labels is not.
    for (const k of ENGLISH_ONLY) {
      expect(journalI18n[lang][k], `${lang} machine-translated prose key ${k}`).toBeUndefined();
    }
  });

  it('holds back full sentences, not labels — the split is real', () => {
    // A crude proxy for "is this a sentence": ends in a full stop, or is
    // long. If this ever fails, the split has drifted and the header is
    // lying about what got translated.
    for (const k of ENGLISH_ONLY) {
      const v = journalI18n.en[k];
      expect(/[.!?]$/.test(v) || v.length > 40, `${k} is held back but reads like a label: "${v}"`).toBe(true);
    }
  });
});

describe('placeholders', () => {
  // A dropped placeholder is invisible until a user hits that string with
  // a real value, and then it renders a sentence with a hole in it.
  // Deliberately generic. An allowlist of known names ({n}|{d}|...) silently
  // skips any NEW placeholder — journal.ctx.mood carries {emoji} and {label},
  // and neither was checked until this regex stopped naming names.
  const PLACEHOLDER = /\{\w+\}/g;

  it.each(OTHERS)('%s keeps every placeholder the English carries', (lang) => {
    for (const k of labelKeys) {
      const want = (journalI18n.en[k].match(PLACEHOLDER) || []).sort();
      const got = (journalI18n[lang][k].match(PLACEHOLDER) || []).sort();
      expect(got, `${lang}.${k} placeholder mismatch`).toEqual(want);
    }
  });

  it('never splits a placeholder across words', () => {
    for (const lang of LANGS) {
      for (const [k, v] of Object.entries(journalI18n[lang])) {
        expect(/\{\s|\s\}/.test(v), `${lang}.${k} has a broken placeholder: "${v}"`).toBe(false);
      }
    }
  });
});

describe('review bookkeeping', () => {
  it('lists every non-English language as pending review', () => {
    // Nothing here has been seen by a native speaker. When one reviews a
    // language, delete it from REVIEW_PENDING — that is the only signal
    // this file carries about which languages are trustworthy.
    expect([...REVIEW_PENDING].sort()).toEqual([...OTHERS].sort());
  });

  it('does not claim English needs review', () => {
    expect(REVIEW_PENDING).not.toContain('en');
  });
});

describe('the save state, which is three different promises', () => {
  it.each(OTHERS)('%s keeps saved / held / notSaved distinct', (lang) => {
    // "Saved" = the server has it. "Held offline" = failed, still
    // retrying. "Not saved" = we have STOPPED. If a language collapses
    // two of these into the same string, someone closes the app believing
    // their writing is safe when it is sitting in localStorage.
    const three = [
      journalI18n[lang]['journal.saved'],
      journalI18n[lang]['journal.held'],
      journalI18n[lang]['journal.notSaved'],
    ];
    expect(new Set(three).size, `${lang} collapses two save states: ${three.join(' / ')}`).toBe(3);
  });
});
