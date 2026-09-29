import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { flagCode, flagSrc } from '../flags';

describe('flags', () => {
  it('reads the emoji the picker stores', () => {
    expect(flagCode('🇺🇸')).toBe('us');
    expect(flagSrc('🇬🇧')).toBe('/flags/gb.svg');
  });

  it('reads a bare ISO code from older rows', () => {
    expect(flagCode('US')).toBe('us');
    expect(flagCode('fr')).toBe('fr');
  });

  it('returns null for anything that is not a flag', () => {
    expect(flagSrc('')).toBeNull();
    expect(flagSrc(null)).toBeNull();
    expect(flagSrc('🗽')).toBeNull();
    expect(flagSrc('USA')).toBeNull();
  });

  // The profile renders whatever the picker saved, so every country the
  // picker offers needs its file, or that flag is a broken image again.
  it('ships a file for every country the picker offers', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../components/hub/HubProfile.jsx'), 'utf8');
    const codes = [...src.matchAll(/\['([A-Z]{2})','/g)].map((m) => m[1].toLowerCase());
    expect(codes.length).toBeGreaterThan(150);
    const missing = codes.filter((c) => !fs.existsSync(path.resolve(__dirname, `../../../public/flags/${c}.svg`)));
    expect(missing).toEqual([]);
  });
});
