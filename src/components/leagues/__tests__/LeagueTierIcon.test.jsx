import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import LeagueTierIcon, { LeagueTierBadge } from '@/components/leagues/LeagueTierIcon';
import { TIERS } from '@/lib/leagueTiers';
import { parseSeasonTrophy } from '@/lib/trophyDefinitions';

const markOf = (tier) => {
  const { container } = render(<LeagueTierIcon tier={tier} />);
  return container.querySelector('svg').innerHTML;
};

describe('LeagueTierIcon', () => {
  it('gives every league tier its own emblem', () => {
    const marks = TIERS.map(t => markOf(t.id));
    expect(new Set(marks).size).toBe(TIERS.length);
  });

  it('draws each emblem in its own tier colour', () => {
    for (const t of TIERS) {
      expect(markOf(t.id).toLowerCase()).toContain(t.color.toLowerCase());
    }
  });

  it('uses flat facets, never an SVG gradient', () => {
    for (const t of TIERS) expect(markOf(t.id)).not.toMatch(/Gradient/);
  });

  it('is hidden from screen readers, since the tier name is always beside it', () => {
    const { container } = render(<LeagueTierIcon tier="gold" />);
    expect(container.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
  });

  it('falls back to the bronze emblem for an unknown tier', () => {
    expect(markOf('nope')).toBe(markOf('bronze'));
  });

  it('renders the badge at the requested size', () => {
    const { container } = render(<LeagueTierBadge tier="diamond" size={40} />);
    const svg = container.querySelector('svg');
    expect(svg.style.width).toBe('40px');
    expect(svg.style.height).toBe('40px');
  });
});

describe('season trophies carry their league tier', () => {
  it('maps a tier trophy to its tier and a champion to Legend', () => {
    expect(parseSeasonTrophy('league_s3_diamond').leagueTier).toBe('diamond');
    expect(parseSeasonTrophy('league_s3_champion').leagueTier).toBe('legend');
  });
});

describe('LeagueTierIcon levels', () => {
  const svgOf = (tier, level) => render(<LeagueTierIcon tier={tier} level={level} />).container.querySelector('svg');

  it('draws a different emblem at each of the four levels', () => {
    for (const t of TIERS) {
      const marks = [1, 2, 3, 4].map((lv) => svgOf(t.id, lv).innerHTML);
      expect(new Set(marks).size).toBe(4);
    }
  });

  it('keeps level one identical to the plain crest', () => {
    expect(svgOf('gold', 1).innerHTML).toBe(markOf('gold'));
  });

  it('counts the level in pips from level two up', () => {
    expect(svgOf('silver', 1).querySelectorAll('[data-pip]').length).toBe(0);
    for (const lv of [2, 3, 4]) {
      expect(svgOf('silver', lv).querySelectorAll('[data-pip]').length).toBe(lv);
    }
  });

  it('clamps an out of range level', () => {
    expect(svgOf('bronze', 9).innerHTML).toBe(svgOf('bronze', 4).innerHTML);
    expect(svgOf('bronze', 0).innerHTML).toBe(svgOf('bronze', 1).innerHTML);
  });
});
