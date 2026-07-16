// src/lib/barcodeHints.js
//
// Decode hints for the nutrition barcode scanner (@zxing). Kept as a pure
// builder that RECEIVES the zxing enum objects rather than importing them,
// so this module carries no static `@zxing/*` dependency — the ~80 KB
// reader stays lazy-loaded on first scan — and the logic stays unit-testable.
//
// Two hints, both material to real-world scanning:
//
//   • TRY_HARDER — the fix for sideways cans. In @zxing/library's OneDReader,
//     the 90°-rotated decode pass (`image.rotateCounterClockwise()`) only
//     runs when TRY_HARDER is true. Without it, a barcode that isn't roughly
//     horizontal is never attempted. It also scans more rows per frame, which
//     helps glare-broken / partially-obscured codes on shiny packaging.
//
//   • POSSIBLE_FORMATS — restrict to retail symbologies. The default
//     multi-format reader tries every 1D + 2D format on every frame; a
//     grocery product is always one of a handful of UPC/EAN codes. Narrowing
//     the set makes each frame cheaper and the read more reliable.

// Retail 1D symbologies, by BarcodeFormat enum name. UPC-A/EAN-13 cover
// virtually all US/global packaged goods; the rest catch the long tail
// (small packages, some imports, shipping/interleaved codes).
export const RETAIL_FORMAT_NAMES = [
  'UPC_A', 'UPC_E', 'EAN_13', 'EAN_8', 'CODE_128', 'CODE_39', 'ITF',
];

/**
 * Build the DecodeHintType→value Map zxing expects.
 * @param {object} DecodeHintType - the enum from '@zxing/library'
 * @param {object} BarcodeFormat  - the enum from '@zxing/library' (or '@zxing/browser')
 * @returns {Map} hints map ready for `new BrowserMultiFormatReader(hints)`
 */
export function buildBarcodeHints(DecodeHintType, BarcodeFormat) {
  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(
    DecodeHintType.POSSIBLE_FORMATS,
    RETAIL_FORMAT_NAMES
      .map((name) => BarcodeFormat[name])
      .filter((v) => v !== undefined && v !== null),
  );
  return hints;
}
