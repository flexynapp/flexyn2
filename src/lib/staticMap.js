// src/lib/staticMap.js
//
// A map card built from raster tiles and nothing else — no API key, no
// JavaScript map engine, no vendor.
//
// The obvious way to show "here is your gym" is a little MapLibre map,
// and it is the wrong way HERE. GymMap statically imports maplibre-gl,
// and vite.config keeps that library out of `vendor-misc` precisely so it
// stays a lazy chunk; pulling it into onboarding would put a map engine
// on the most latency-sensitive screen in the app, for a card the user
// never interacts with. See CLAUDE.md's home-gym section.
//
// Street View was considered and isn't available: there is no Google key
// (and their terms restrict caching their imagery), MapTiler's key is
// empty in this project, and Mapillary's coverage runs out exactly where
// this feature matters most — the rural gyms that aren't in OSM either.
//
// So: <img> tiles from OpenStreetMap, positioned. It is the same data the
// rest of the locator uses, under the same licence.
//
// ── Attribution is required ──────────────────────────────────────────
//
// ODbL, same as the Overpass and Nominatim results. Render
// TILE_ATTRIBUTION next to any card built from these. Unlike the gym
// list, there is no MapLibre attribution control here to inherit from —
// this is a plain image grid, so the credit has to be ours.

/** Standard OSM raster tiles. Required credit wherever they are shown. */
const TILE_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

export const TILE_ATTRIBUTION = '© OpenStreetMap contributors';

export const TILE_SIZE = 256;

/**
 * Slippy-map tile coordinates for a point, as FRACTIONS.
 *
 * The fractional part is the whole point: it says where inside its tile
 * the gym actually sits, which is what lets the caller centre the card on
 * the building rather than on whichever 256px square happens to contain
 * it.
 */
export function tileCoords(lat, lng, zoom) {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  const x = ((lng + 180) / 360) * n;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/**
 * Everything a caller needs to render a centred map card as plain images.
 *
 * Returns a 3x3 block of tiles around the point, plus the offset that
 * puts the point at the centre of a `width` x `height` box. Render the
 * tiles in a grid inside a container with `overflow: hidden`, translated
 * by `offsetX` / `offsetY`.
 *
 * Three-by-three rather than two-by-two because a point can sit anywhere
 * in its tile, including a corner: a 2x2 block only guarantees 128px of
 * cover in the worst direction, which is less than half of any card wide
 * enough to be worth showing.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {{zoom?: number, width?: number, height?: number}} [opts]
 */
export function staticMapCard(lat, lng, { zoom = 16, width = 320, height = 160 } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const z = Math.max(0, Math.min(19, Math.round(zoom)));
  const n = 2 ** z;
  const { x, y } = tileCoords(lat, lng, z);

  const baseX = Math.floor(x);
  const baseY = Math.floor(y);

  const tiles = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = baseX + dx;
      const ty = baseY + dy;
      // Wrap longitude, clamp latitude: a tile row outside [0, n) does
      // not exist and would render as a broken image.
      if (ty < 0 || ty >= n) continue;
      tiles.push({
        key: `${z}/${tx}/${ty}`,
        url: TILE_URL(z, ((tx % n) + n) % n, ty),
        // Grid position within the 3x3 block, in pixels.
        left: (dx + 1) * TILE_SIZE,
        top: (dy + 1) * TILE_SIZE,
      });
    }
  }

  // Where the point falls inside the 3x3 block, then how far to shift
  // that block so it lands at the centre of the card.
  const pointX = (x - baseX + 1) * TILE_SIZE;
  const pointY = (y - baseY + 1) * TILE_SIZE;

  return {
    tiles,
    width,
    height,
    blockSize: TILE_SIZE * 3,
    offsetX: Math.round(width / 2 - pointX),
    offsetY: Math.round(height / 2 - pointY),
    attribution: TILE_ATTRIBUTION,
  };
}
