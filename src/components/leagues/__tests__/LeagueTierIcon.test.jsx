import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import LeagueTierIcon, { LeagueTierBadge } from '@/components/leagues/LeagueTierIcon';
import { TIERS, onTierColor } from '@/lib/leagueTiers';
import { parseSeasonTrophy } from '@/lib/trophyDefinitions';

const markOf = (tier) => {
  const { container } = render(<LeagueTierIcon tier={tier} />);
  return container.querySelector('svg').innerHTML;
};

describe('LeagueTierIcon', () => {
  it('gives every league tier its own mark', () => {
    const marks = TIERS.map(t => markOf(t.id));
    expect(new Set(marks).size).toBe(TIERS.length);
  });

  it('counts chevrons up through the metals', () => {
    const count = (id) => (markOf(id).match(/<path/g) || []).length;
    expect([count('bronze'), count('silver'), count('gold')]).toEqual([1, 2, 3]);
  });

  it('draws in currentColor and hides from screen readers', () => {
    const { container } = render(<LeagueTierIcon tier="gold" />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('falls back to the bronze mark for an unknown tier', () => {
    expect(markOf('nope')).toBe(markOf('bronze'));
  });

  it('puts the mark on a chip in the tier colour with readable ink', () => {
    const { container } = render(<LeagueTierBadge tier="diamond" size={24} />);
    const chip = container.firstChild;
    const diamond = TIERS.find(t => t.id === 'diamond');
    const toRgb = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    expect(chip.style.backgroundColor).toBe(toRgb(diamond.color));
    expect(chip.style.color).toBe(toRgb(onTierColor(diamond.color)));
  });
});

describe('season trophies carry their league tier', () => {
  it('maps a tier trophy to its tier and a champion to Legend', () => {
    expect(parseSeasonTrophy('league_s3_diamond').leagueTier).toBe('diamond');
    expect(parseSeasonTrophy('league_s3_champion').leagueTier).toBe('legend');
  });
});
