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

// The font rule is the easiest to get wrong in the permissive direction:
// a lookahead that backtracks past the space in `font-family: var(...)`
// flagged the tokens themselves on its first draft. So it is pinned on
// both sides, what it must catch and what it must leave alone.
describe('hardcodedFont: what counts as typing a face by hand', () => {
  const hits = (s) => (s.match(new RegExp(RULES.hardcodedFont.re.source, 'g')) || []).length;
  it.each([
    [`style={{ fontFamily: 'system-ui, sans-serif' }}`],
    [`<text fontFamily="Inter">`],
    [`.x { font-family: Arial, sans-serif; }`],
    [`font-family:'Press Start 2P'`],
    [`className="font-['Inter']"`],
    [`ctx.font = 'bold 24px sans-serif';`],
  ])('catches %s', (s) => expect(hits(s)).toBe(1));
  it.each([
    [`style={{ fontFamily: 'var(--font-body)' }}`],
    [`.x { font-family: var(--font-heading); }`],
    [`style="font-family: var(--font-heading); font-weight: 800"`],
    [`fontFamily: FONT_MAP[style.font]`],
    [`font: 'inherit'`],
    [`className="font-[600]"`],
    [`ctx.font = canvasFont('bold', 24);`],
  ])('leaves %s alone', (s) => expect(hits(s)).toBe(0));
});
