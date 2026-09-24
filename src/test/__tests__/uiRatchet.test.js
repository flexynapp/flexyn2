// Guards the UI composition rules in CLAUDE.md against regression.
// The mechanism and the reasoning live in scripts/ui-ratchet.mjs.
//
// Two directions, same as the orphan-key ratchet:
//   • a file may not GAIN a banned pattern (the point of the test), and
//   • a file that LOST some must be re-baselined, or the ceiling stays at
//     the old number and the next person can quietly spend the headroom.
import { describe, it, expect } from 'vitest';
import { RULES, measure, readBaseline } from '../../../scripts/ui-ratchet.mjs';

const now  = measure();
const base = readBaseline().counts;

describe('UI ratchet: banned patterns may only go down', () => {
  for (const [rule, spec] of Object.entries(RULES)) {
    it(`${rule}: no file gains one`, () => {
      const grew = Object.entries(now[rule])
        .filter(([file, n]) => n > (base[rule]?.[file] ?? 0))
        .map(([file, n]) => `  ${file}: ${base[rule]?.[file] ?? 0} -> ${n}`);
      expect(grew, grew.length ? `${spec.why}\n${grew.join('\n')}` : '').toEqual([]);
    });

    it(`${rule}: the baseline is not stale`, () => {
      const shrank = Object.entries(base[rule] ?? {})
        .filter(([file, n]) => (now[rule][file] ?? 0) < n)
        .map(([file, n]) => `  ${file}: ${n} -> ${now[rule][file] ?? 0}`);
      expect(
        shrank,
        shrank.length
          ? `These files improved. Lock it in with \`npm run ui:ratchet -- --write\`:\n${shrank.join('\n')}`
          : '',
      ).toEqual([]);
    });
  }
});
