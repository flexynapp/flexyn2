import { describe, it, expect } from 'vitest';
import { staticMapCard, tileCoords, TILE_ATTRIBUTION, TILE_SIZE } from '../staticMap';

// A map card made of <img> tiles rather than a MapLibre instance. The
// reason is in the module head: onboarding must not import maplibre-gl,
// which vite.config deliberately keeps in its own lazy chunk.

const SANFORD = { lat: 43.4387179, lng: -70.7746224 };

describe('tileCoords', () => {
  it('places 0,0 at the middle of the world at zoom 1', () => {
    const { x, y } = tileCoords(0, 0, 1);
    expect(x).toBeCloseTo(1, 5);
    expect(y).toBeCloseTo(1, 5);
  });

  it('keeps the fractional part, which is where inside the tile the point sits', () => {
    const { x, y } = tileCoords(SANFORD.lat, SANFORD.lng, 16);
    // Integer coordinates would only say which 256px square the gym is
    // in — the fraction is what lets the card centre on the building.
    expect(x % 1).not.toBe(0);
    expect(y % 1).not.toBe(0);
  });

  it('increases x with longitude and decreases y with latitude', () => {
    const west = tileCoords(43, -71, 12);
    const east = tileCoords(43, -70, 12);
    const north = tileCoords(44, -70, 12);
    expect(east.x).toBeGreaterThan(west.x);
    expect(north.y).toBeLessThan(east.y);
  });
});

describe('staticMapCard', () => {
  it('returns a 3x3 block of tiles', () => {
    const card = staticMapCard(SANFORD.lat, SANFORD.lng);
    // 2x2 only guarantees 128px of cover in the worst direction — less
    // than half of any card wide enough to be worth showing — because a
    // point can sit in a tile corner.
    expect(card.tiles).toHaveLength(9);
    expect(card.blockSize).toBe(TILE_SIZE * 3);
  });

  it('offsets the block so the point lands at the centre of the card', () => {
    const card = staticMapCard(SANFORD.lat, SANFORD.lng, { width: 320, height: 160 });
    const { x, y } = tileCoords(SANFORD.lat, SANFORD.lng, 16);
    const pointX = (x - Math.floor(x) + 1) * TILE_SIZE;
    const pointY = (y - Math.floor(y) + 1) * TILE_SIZE;

    expect(pointX + card.offsetX).toBeCloseTo(160, 0);
    expect(pointY + card.offsetY).toBeCloseTo(80, 0);
  });

  it('builds real OSM tile URLs at the requested zoom', () => {
    const card = staticMapCard(SANFORD.lat, SANFORD.lng, { zoom: 14 });
    for (const t of card.tiles) {
      expect(t.url).toMatch(/^https:\/\/tile\.openstreetmap\.org\/14\/\d+\/\d+\.png$/);
    }
  });

  it('drops tile rows that do not exist rather than rendering broken images', () => {
    // Near the pole there is no row above the top one.
    const card = staticMapCard(85, 0, { zoom: 3 });
    expect(card.tiles.length).toBeLessThan(9);
    expect(card.tiles.every(t => /\/3\/\d+\/\d+\.png$/.test(t.url))).toBe(true);
  });

  it('wraps longitude at the antimeridian', () => {
    const card = staticMapCard(0, 179.99, { zoom: 4 });
    const xs = card.tiles.map(t => Number(t.url.split('/')[4]));
    // 2^4 = 16 tiles across, so every x must land in [0, 15] even though
    // the block straddles the edge of the world.
    expect(Math.max(...xs)).toBeLessThan(16);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
  });

  it('returns null on a bad point instead of a card full of NaN', () => {
    expect(staticMapCard(NaN, -70.77)).toBeNull();
    expect(staticMapCard(43.4, undefined)).toBeNull();
  });

  it('carries the attribution ODbL requires', () => {
    // There is no MapLibre attribution control on a plain image grid, so
    // the credit has to come from here.
    expect(staticMapCard(SANFORD.lat, SANFORD.lng).attribution).toBe(TILE_ATTRIBUTION);
    expect(TILE_ATTRIBUTION).toMatch(/OpenStreetMap/);
  });
});
