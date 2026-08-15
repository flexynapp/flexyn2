// The orange word in an onboarding headline, and the two ways it goes missing.
//
// Both heroes animate a heading word by word and paint ONE of those words with
// the primary colour. Neither marks that word up: they split the heading on
// spaces and compare each word against a separate `accentWord` value. So the
// accent survives translation only while the accent word is still a word of
// the translated sentence — a property nothing in the markup enforces, and
// which no test held until this file.
//
// It had already failed twice, in two different ways, and only a screenshot
// ever caught either:
//
//   1. Spanish shipped `onboarding.welcome.accentWord` as "en serio" — two
//      words. The splitter compares single tokens, so it matched nothing and
//      the hero rendered with no orange word at all.
//   2. Ten of the eleven call sites passed a hardcoded ENGLISH literal
//      (`accentWord="sharpen"`) beside a translated heading, so every one of
//      them lost its accent in Spanish and French the moment those locales
//      shipped. Five of those literals carried punctuation ("for?",
//      "training?", "yourself.", "weigh?", "train?") and the matcher stripped
//      punctuation from the WORD but not from the literal — so those five
//      highlighted nothing in ENGLISH either, and had not since they were
//      written.
//
// Measured before the fix: 25 of 33 site×locale pairs highlighted no word.
//
// The fix is one matcher (`isAccent`) and a catalog key per site, so the
// accent word is translated alongside the sentence it has to appear in. This
// file asserts the property that makes that work, for every released locale.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SUPPORTED_LANGUAGES } from '@/lib/i18n';
import { bare, isAccent, accentHits } from '@/lib/accentWord';

const SOURCE = readFileSync('src/pages/Onboarding.jsx', 'utf8');
const catalog = (l) => JSON.parse(readFileSync(`src/locales/${l}.json`, 'utf8'));
const en = catalog('en');
const RELEASED = SUPPORTED_LANGUAGES.map((l) => l.code);

// What the app actually renders for a key: the locale's value, else English.
const resolve = (dict, key) => dict[key] ?? en[key];

// Every `<KineticHeading …/>`, read out of the source so a call site added
// later is covered without editing this file — which is the exact way the
// first ten were missed.
const SITES = [...SOURCE.matchAll(/<KineticHeading\b([\s\S]*?)\/>/g)].map((m) => {
  const attrs = m[1];
  const heading = attrs.match(/text=\{tFallback\(\s*'([^']+)'/);
  const accentKey = attrs.match(/accentWord=\{tFallback\(\s*'([^']+)'/);
  const accentLiteral = attrs.match(/accentWord="([^"]*)"/);
  return { heading: heading?.[1], accentKey: accentKey?.[1], accentLiteral: accentLiteral?.[1] };
});

// The welcome hero renders its own markup rather than using KineticHeading, so
// it cannot be discovered by the scan above. Its keys are asserted to exist.
const WELCOME = { heading: 'onboarding.welcome.headline2', accentKey: 'onboarding.welcome.accentWord' };

// The catalog assertions below run the REAL matcher, so they cannot tell a
// correct matcher from a consistently wrong one. These pin its behaviour to
// literal expectations instead — every case here is one that actually shipped.
describe('the accent matcher', () => {
  it('strips punctuation from the word AND from the accent word', () => {
    expect(isAccent('for?', 'for')).toBe(true);   // the catalog form today
    expect(isAccent('for?', 'for?')).toBe(true);  // the literal that shipped
    expect(isAccent('yourself.', 'yourself')).toBe(true);
    expect(isAccent('¿Cuánto', 'Cuánto')).toBe(true);  // Spanish opens with ¿
    expect(bare('venido?')).toBe('venido');
  });

  it('matches nothing when the accent word is empty or absent', () => {
    // French sets "?" off with a space, so it arrives as its own token and
    // strips to "". Without the guard it would be painted by a blank accent.
    expect(isAccent('?', '')).toBe(false);
    expect(isAccent('?', undefined)).toBe(false);
    expect(isAccent('plan.', null)).toBe(false);
  });

  it('cannot match a multi-word accent word', () => {
    // Spanish shipped "en serio" here and the hero lost its orange word.
    expect(accentHits('fuera en serio.', 'en serio')).toBe(0);
    expect(accentHits('fuera en serio.', 'serio')).toBe(1);
  });

  it('does not match a word that merely contains the accent word', () => {
    expect(isAccent('training', 'train')).toBe(false);
    expect(accentHits('Which days can you train?', 'train')).toBe(1);
  });
});

describe('onboarding accent words', () => {
  it('finds every KineticHeading call site', () => {
    // A guard on the guard: if the JSX shape changes and the scan silently
    // matches nothing, every assertion below would vacuously pass.
    expect(SITES.length).toBe(10);
  });

  it('reads the accent word from the catalog at every site, never a literal', () => {
    // A hardcoded literal is the defect itself: it cannot follow a
    // translation, so it is wrong in every locale but English by construction.
    const literals = SITES.filter((s) => s.accentLiteral !== undefined)
      .map((s) => `${s.heading}: accentWord="${s.accentLiteral}"`);
    expect(literals).toEqual([]);
    expect(SITES.filter((s) => !s.accentKey).map((s) => s.heading)).toEqual([]);
  });

  it('pairs each accent key with the heading it has to appear in', () => {
    // `onboarding.goal.accentWord` belongs to `onboarding.goal.heading`. A
    // mismatched pair still renders, and still silently drops the accent.
    const mismatched = SITES.filter((s) => s.accentKey !== s.heading.replace(/\.heading$/, '.accentWord'));
    expect(mismatched.map((s) => `${s.heading} + ${s.accentKey}`)).toEqual([]);
  });

  it('still renders the welcome hero from the two keys this test assumes', () => {
    expect(SOURCE).toContain(`tFallback('${WELCOME.heading}'`);
    expect(SOURCE).toContain(`tFallback('${WELCOME.accentKey}'`);
    expect(SOURCE).toContain('isAccent(w, accent)');
  });

  describe.each(RELEASED)('in %s', (lang) => {
    const dict = catalog(lang);
    const all = [...SITES, WELCOME];

    it('gives every accent word as a single token', () => {
      // The Spanish "en serio" bug. Two words can never equal one token, so
      // this fails loudly where the rendered result only went quiet.
      const multi = all
        .map((s) => [s.accentKey, resolve(dict, s.accentKey)])
        .filter(([, v]) => v != null && /\s/.test(v.trim()));
      expect(multi).toEqual([]);
    });

    it('highlights exactly one word of every heading', () => {
      const wrong = all.map((s) => {
        const heading = resolve(dict, s.heading);
        const accent = resolve(dict, s.accentKey);
        return { key: s.accentKey, heading, accent, n: accentHits(heading, accent) };
      }).filter((r) => r.n !== 1);

      expect(wrong.map((r) => `${r.key}: "${r.accent}" hits ${r.n} words of "${r.heading}"`))
        .toEqual([]);
    });
  });
});
