// The "Missing Data" dialog listed every Push-Up set as "no weight entered",
// because a blank weight counted as missing even on a bodyweight lift, and
// its copy was untranslated English carrying a dash.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import en from '@/locales/en.json';
import es from '@/locales/es.json';
import fr from '@/locales/fr.json';

const src = readFileSync(resolve(__dirname, '../Workout.jsx'), 'utf8');

describe('Workout missing-data dialog', () => {
  it('does not flag a blank weight on a bodyweight or cardio lift', () => {
    expect(src).toMatch(/const wMissing = !zeroWeightOk && \(isBlank\(s\.weight\) \|\| Number\(s\.weight\) === 0\);/);
  });

  it('renders every reason through a released catalog key', () => {
    const reasons = [...src.matchAll(/reason: '([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(reasons.length).toBeGreaterThan(0);
    for (const r of new Set(reasons)) {
      for (const cat of [en, es, fr]) expect(cat[`workout.missing.${r}`], r).toBeTruthy();
    }
  });

  it('carries no dash or hardcoded English in the list', () => {
    const dialog = src.slice(src.indexOf('Missing data warning'), src.indexOf('Implausible workout volume modal'));
    expect(dialog).not.toMatch(/—/);
    expect(dialog).not.toMatch(/This workout has empty sets/);
    expect(dialog).not.toMatch(/…and/);
  });
});
