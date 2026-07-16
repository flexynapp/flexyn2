// src/lib/barcodeScan.js
//
// Multi-orientation frame decoding for the nutrition scanner.
//
// Why this exists: @zxing/browser's `HTMLCanvasElementLuminanceSource.rotate()`
// updates the pixel buffer but NOT the source's width/height, so the library's
// built-in TRY_HARDER rotation pass reads misaligned rows and fails to decode a
// truly 90°-sideways barcode (verified empirically — a sideways code that reads
// fine when the frame is rotated by hand returns NotFound through zxing's own
// rotation). To actually read a can whose barcode runs vertically, we rotate the
// captured frame into a correctly-sized canvas ourselves and decode each
// orientation. TRY_HARDER + POSSIBLE_FORMATS (see barcodeHints.js) still help the
// upright case; this covers the rest.

/**
 * Rotate a source canvas by `deg` (0/90/180/270) into a NEW, correctly-sized
 * canvas. Unlike zxing's in-place rotate, this resizes the output so the
 * decoder sees properly-aligned rows.
 */
export function rotateCanvas(src, deg) {
  const d = ((deg % 360) + 360) % 360;
  if (d === 0) return src;
  const out = document.createElement('canvas');
  if (d === 90 || d === 270) { out.width = src.height; out.height = src.width; }
  else { out.width = src.width; out.height = src.height; }
  const ctx = out.getContext('2d');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((d * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

/**
 * Try to decode a canvas at several orientations. Default set covers a can
 * turned either way: upright, then 90° and 270° (sideways both directions).
 * Returns the decoded text, or null if no orientation matched.
 *
 * `reader.decodeFromCanvas` throws NotFoundException on a frame with no code —
 * that's the common per-frame case, so it's swallowed and we try the next
 * orientation / next frame.
 */
export function decodeCanvasMultiOrientation(reader, canvas, orientations = [0, 90, 270], rotate = rotateCanvas) {
  for (const deg of orientations) {
    let c;
    try {
      c = rotate(canvas, deg);
    } catch {
      continue; // canvas op failed (e.g. zero-size frame) — skip this orientation
    }
    try {
      const res = reader.decodeFromCanvas(c);
      const text = res?.getText?.();
      if (text) return text;
    } catch {
      /* NotFound at this orientation — try the next */
    }
  }
  return null;
}
