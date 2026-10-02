import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import LeagueFluid, { fluidPalette } from '@/components/leagues/LeagueFluid';

describe('LeagueFluid', () => {
  it('makes a dark, a mid and a light shade of the league colour', () => {
    const [dark, mid, light] = fluidPalette('#facc15');
    const sum = (c) => c.reduce((a, b) => a + b, 0);
    expect(sum(dark)).toBeLessThan(sum(mid));
    expect(sum(mid)).toBeLessThan(sum(light));
    [dark, mid, light].flat().forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });

  it('keeps the gold hue in every shade', () => {
    fluidPalette('#facc15').forEach(([r, g, b]) => {
      expect(r).toBeGreaterThan(b);
      expect(g).toBeGreaterThan(b);
    });
  });

  it('renders without WebGL and hides itself', () => {
    const { container } = render(<LeagueFluid from="#c0c0c0" to="#facc15" phase="enter" chargeMs={1500} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas.style.display).toBe('none');
  });
});
