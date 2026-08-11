/**
 * cardio_logs.type -> a label a human reads.
 *
 * Swimming shipped into the activity picker without
 * `cardio.type.swimming_pool` or `cardio.type.swimming_openwater`. Eight
 * call sites built the key by template and handed it to `t()`, and
 * `getTranslation` ends with `return enVal ?? key` — so a missing key
 * renders as the KEY PATH. A pool swim put the literal string
 * "cardio.type.swimming_pool" in the manual form's heading, the detail
 * modal's title, the Repeat-last row, and three Hub surfaces including a
 * post other people can see.
 *
 * The keys exist now. The helper exists so the next type added without
 * one degrades to readable text rather than a key path — which is the
 * part a test can actually hold onto, since "we remembered the key" is
 * not a property, it is a habit.
 */
import { describe, it, expect } from 'vitest';
import { cardioTypeLabel } from '@/lib/cardioTypeLabel';
import { cardioI18n } from '@/lib/i18n-cardio';
import { translations_p8 as part8 } from '@/lib/i18n-part8';

// Mirrors the real tFallback contract: look the key up in English, and
// fall back only when it is genuinely absent. NOT `(key, english) => english`
// — that house stub would pass no matter which keys exist, which is the
// entire thing under test here.
const EN = { ...(part8.en || {}), ...(cardioI18n.en || {}) };
const tFallback = (key, english) => (EN[key] !== undefined ? EN[key] : english);

// Every type the app can persist: the 4 modes x their environments.
const ALL_TYPES = [
  'running_outside', 'running_treadmill',
  'walking_outside', 'walking_treadmill',
  'biking_outside', 'biking_stationary',
  'swimming_pool', 'swimming_openwater',
];

describe('every persistable cardio type has a translation key', () => {
  it.each(ALL_TYPES)('%s resolves to real copy, not a key path', (type) => {
    const label = cardioTypeLabel(type, tFallback);
    expect(label).not.toContain('cardio.type.');
    expect(label.length).toBeGreaterThan(0);
  });

  // The two that were missing, named explicitly so a deletion is loud.
  it('names the swim types the way the other six are named', () => {
    expect(cardioTypeLabel('swimming_pool', tFallback)).toBe('Pool swim');
    expect(cardioTypeLabel('swimming_openwater', tFallback)).toBe('Open water swim');
  });

  it('still resolves the six that already worked', () => {
    expect(cardioTypeLabel('running_outside', tFallback)).toBe('Outdoor run');
    expect(cardioTypeLabel('biking_stationary', tFallback)).toBe('Stationary bike');
  });

  it('gives every type a DISTINCT label', () => {
    const labels = ALL_TYPES.map(t => cardioTypeLabel(t, tFallback));
    expect(new Set(labels).size).toBe(ALL_TYPES.length);
  });
});

describe('an unknown type degrades to text, never to a key path', () => {
  it('humanizes a type that has no key', () => {
    // The whole reason the helper exists. Adding a mode or an environment
    // is a two-line change in CardioSection and nothing forces you to
    // remember the i18n file.
    const label = cardioTypeLabel('rowing_erg', tFallback);
    expect(label).toBe('Rowing erg');
    expect(label).not.toContain('cardio.type.');
  });

  it('does not title-case every word', () => {
    // 'Swimming Pool' reads as the noun — the thing you swim in — rather
    // than the activity. Sentence case keeps it obviously a label.
    expect(cardioTypeLabel('kayaking_lake', tFallback)).toBe('Kayaking lake');
  });
});

describe('a missing type falls back to a TRANSLATED word', () => {
  // The Hub carries activities with no type at all; those call sites used
  // to pass `|| 'cardio'`, which built `cardio.type.cardio` — a key that
  // does not exist either, so it rendered as its own path.
  it.each([undefined, null, '', '   '])('%p becomes "Cardio"', (input) => {
    expect(cardioTypeLabel(input, tFallback)).toBe('Cardio');
  });

  it('uses cardio.title, which IS translated in all 15 languages', () => {
    const seen = [];
    cardioTypeLabel('', (key, english) => { seen.push(key); return english; });
    expect(seen).toEqual(['cardio.title']);
    // Not a new English-only key invented for the empty case.
    expect(seen[0]).not.toContain('cardio.type.');
  });
});

describe('the i18n file itself', () => {
  it('carries English originals for both swim types', () => {
    expect(cardioI18n.en['cardio.type.swimming_pool']).toBeTruthy();
    expect(cardioI18n.en['cardio.type.swimming_openwater']).toBeTruthy();
  });

  it('does not machine-translate them into other languages', () => {
    // English-only is the deliberate state, per CLAUDE.md's i18n rule and
    // consistent with cardio.modes.swimming beside them. If a native pass
    // adds real translations this test should be deleted, not muted.
    for (const [lang, block] of Object.entries(cardioI18n)) {
      if (lang === 'en') continue;
      expect(block['cardio.type.swimming_pool'], `${lang} should not carry MT copy`).toBeUndefined();
      expect(block['cardio.type.swimming_openwater'], `${lang} should not carry MT copy`).toBeUndefined();
    }
  });
});
