import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// .font-display condenses Archivo to width 75 on its variable wdth axis.
// If the axis ever drops out of the Google Fonts URL nothing throws and the
// computed style still reads `font-stretch: 75%`; every title just renders at
// normal width. Only the source can say the axis is being asked for.
const root = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

describe('display type', () => {
  it('loads Archivo with its width axis wide enough for 75', () => {
    const m = read('index.html').match(/family=Archivo:wdth,wght@(\d+)\.\.(\d+),/);
    expect(m, 'Archivo must be requested with the wdth axis').not.toBeNull();
    expect(Number(m[1])).toBeLessThanOrEqual(75);
    expect(Number(m[2])).toBeGreaterThanOrEqual(75);
  });

  it('defines one .font-display that condenses and uppercases', () => {
    const css = read('src/index.css');
    const block = css.match(/\.font-display\s*\{([^}]*)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/font-stretch:\s*75%/);
    expect(block[1]).toMatch(/text-transform:\s*uppercase/);
    expect(block[1]).toMatch(/font-weight:\s*800/);
    expect(css.match(/\.font-display\s*\{/g)).toHaveLength(1);
  });
});
