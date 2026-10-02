// src/lib/crestMorph.js
//
// Shape changes between league crests, with no animation library. Each
// helper takes a progress `k` from 0 to 1 and returns something to draw at
// that instant, so the caller owns the timing (a framer `animate(0, 1, …)`
// driving state, or a motion value) and picks the spring from
// `@/lib/motion`.
//
// Why no Flubber here: a general path morph has to guess which point of one
// shape becomes which point of the other, and between the diamond's stone
// and the shield it guessed badly and passed through a blob. These shapes
// are ours, so we can just write them with the same points in the same
// order and move each number. Wings are one shape at different sizes
// already (`wingPath(size, lift)`), so they only need the size moved.

const clamp01 = (k) => Math.min(1, Math.max(0, Number(k) || 0));
const lerp = (a, b, k) => a + (b - a) * k;

// The stone's outline (Diamond draws its Gem at y = 2) and the shield's,
// as the same commands: M, L, L, C, C, L, Z. Ten points each.
const STONE = [32, 19, 43, 19, 50, 29, 44, 38, 38, 47, 32, 56, 26, 47, 20, 38, 14, 29, 21, 19];
const SHIELD = [32, 8, 50, 14, 50, 31, 50, 43, 42, 51, 32, 57, 22, 51, 14, 43, 14, 31, 14, 14];

/**
 * The crest outline part way from the cut stone (k = 0) to the shield
 * (k = 1). Use it for Diamond to Platinum, or reversed for the way up.
 * Same 64 by 64 coordinates as LeagueTierIcon.
 *
 * @param {number} k 0 to 1
 * @param {number} [stoneY] the Gem's y offset in the starting crest (2 for Diamond, 6 for Legend)
 * @returns {string} an SVG path
 */
export function stoneToShieldPath(k, stoneY = 2) {
  const t = clamp01(k);
  const dy = stoneY - 2;
  const v = STONE.map((a, i) => {
    const from = i % 2 ? a + dy : a;
    return (Math.round(lerp(from, SHIELD[i], t) * 100) / 100).toString();
  });
  return `M${v[0]} ${v[1]} L${v[2]} ${v[3]} L${v[4]} ${v[5]} `
    + `C${v[6]} ${v[7]} ${v[8]} ${v[9]} ${v[10]} ${v[11]} `
    + `C${v[12]} ${v[13]} ${v[14]} ${v[15]} ${v[16]} ${v[17]} `
    + `L${v[18]} ${v[19]} Z`;
}

/**
 * Wing settings part way between two crests, for `wingPath(size, lift)`
 * or `<Wings feathers={…} />`. Gold to Silver is
 * `wingsBetween(WING_FULL, WING_SMALL, k)`; wings growing out of a bare
 * shield start from `{ size: 0, lift: 0 }`.
 *
 * @param {{size:number, lift:number}} from
 * @param {{size:number, lift:number}} to
 * @param {number} k 0 to 1
 * @returns {{size:number, lift:number}}
 */
export function wingsBetween(from, to, k) {
  const t = clamp01(k);
  return {
    size: lerp(from?.size ?? 0, to?.size ?? 0, t),
    lift: lerp(from?.lift ?? 0, to?.lift ?? 0, t),
  };
}
