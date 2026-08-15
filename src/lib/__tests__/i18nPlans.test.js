// Structural tests for the `plans` i18n domain (src/locales/*.json, sliced by
// the prefixes in src/locales/_meta.json).
//
// These check SHAPE, not translation quality — no test can tell you whether
// the Korean reads naturally. What they can do is stop the silent failures: a
// locale drifting out of sync when someone adds a key to `en` only, a lost
// placeholder, a string quietly left in English and mistaken for translated,
// and a PROSE string getting machine-translated later by someone who did not
// read the header.
//
// The split this file exists for: 36 short labels are machine-drafted and
// awaiting native review; 6 full sentences are deliberately English in every
// language and listed in ENGLISH_ONLY. Kegan chose the split over English-only
// and over drafting everything, which is the same call he made for `journal`.
//
// The placeholder test is the one that earns its keep. This domain carries
// {label}, {n} and {max}, and `weeklyMealPlannerModal.slotFull` uses two in one
// string — it shipped as "{n} of {n}", one placeholder doing two jobs, and read
// correctly in English only because a full slot makes count and cap equal.

import { describe, it, expect } from 'vitest';
import { domainByLang, meta } from './i18nCatalogs.fixture';

const plansI18n = domainByLang('plans');
const { englishOnly, reviewPending } = meta();
const ENGLISH_ONLY = englishOnly.keys.filter(
  (k) => k.startsWith('weeklyMealPlannerModal.') || k.startsWith('nutritionPlansModal.'),
);
const REVIEW_PENDING = reviewPending.plans;

const LANGS = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'ar', 'hi', 'ru', 'tr', 'pl', 'nl'];
const OTHERS = LANGS.filter((l) => l !== 'en');
const enKeys = Object.keys(plansI18n.en).sort();
const labelKeys = enKeys.filter((k) => !ENGLISH_ONLY.includes(k)).sort();
const PLACEHOLDER = /\{(\w+)\}/g;
const holes = (s) => (String(s).match(PLACEHOLDER) || []).sort();

describe('coverage', () => {
  it('ships all 15 supported languages', () => {
    for (const l of LANGS) expect(plansI18n[l], `missing block: ${l}`).toBeTruthy();
  });

  it.each(OTHERS)('%s has exactly the LABEL key set — no more, no less', (lang) => {
    // Not the full English set: prose is deliberately absent. Extra keys mean
    // someone translated a sentence; missing keys mean the locale drifted.
    expect(Object.keys(plansI18n[lang]).sort()).toEqual(labelKeys);
  });

  it.each(LANGS)('%s has no blank values', (lang) => {
    for (const [k, v] of Object.entries(plansI18n[lang])) {
      expect(String(v).trim(), `${lang}.${k} is blank`).not.toBe('');
    }
  });
});

describe('the prose hold', () => {
  it('every ENGLISH_ONLY key in this domain exists in en', () => {
    for (const k of ENGLISH_ONLY) {
      expect(plansI18n.en[k], `ENGLISH_ONLY lists ${k} but en does not define it`).toBeTruthy();
    }
  });

  it.each(OTHERS)('%s defines NONE of the prose keys', (lang) => {
    // A future pass must not quietly machine-translate a sentence. Removing a
    // key from ENGLISH_ONLY is a deliberate act; slipping a translation in
    // beside the labels is not.
    for (const k of ENGLISH_ONLY) {
      expect(plansI18n[lang][k], `${lang} translated prose key ${k}`).toBeUndefined();
    }
  });

  it('every held key is genuinely a sentence, not a label hiding in the list', () => {
    // The split line is short labels vs full sentences. A one-word string in
    // ENGLISH_ONLY means someone parked a label rather than translating it.
    for (const k of ENGLISH_ONLY) {
      const en = String(plansI18n.en[k]);
      expect(en.length, `${k} is too short to be prose: ${en}`).toBeGreaterThan(30);
    }
  });
});

describe('placeholders survive translation', () => {
  it.each(OTHERS)('%s keeps every placeholder its English carries', (lang) => {
    for (const k of labelKeys) {
      const want = holes(plansI18n.en[k]);
      if (!want.length) continue;
      expect(holes(plansI18n[lang][k]), `${lang}.${k} dropped or renamed a placeholder`).toEqual(want);
    }
  });

  it('slotFull carries two DISTINCT placeholders', () => {
    // It shipped as "{label} is full — {n} of {n}", which renders correctly in
    // English only because a full slot makes the count equal the cap. A
    // translator cannot see that coincidence from the string.
    const en = plansI18n.en['weeklyMealPlannerModal.slotFull'];
    expect(en).toContain('{n}');
    expect(en).toContain('{max}');
    expect(new Set(holes(en)).size).toBe(3);
  });
});

describe('review status is recorded, not assumed', () => {
  it('every non-English language is listed as awaiting native review', () => {
    // These are machine drafts. The list is what stops them being mistaken for
    // reviewed copy, and it is the thing a reviewer works down.
    expect([...REVIEW_PENDING].sort()).toEqual([...OTHERS].sort());
  });
});
