// Tests for the multi-orientation decode orchestration. The canvas rotation
// itself is verified end-to-end in the browser (a real 90°-rotated barcode
// decodes only when we resize the frame ourselves); here we inject a fake
// rotate so the try-each-orientation logic is testable under jsdom.

import { describe, it, expect, vi } from 'vitest';
import { decodeCanvasMultiOrientation } from '../barcodeScan';

// A reader that "decodes" only when the frame is at one of `hitDegs`.
const makeReader = (hitDegs, text = '036000291452') => ({
  decodeFromCanvas: (c) => {
    if (hitDegs.includes(c.deg)) return { getText: () => text };
    const err = new Error('NotFoundException'); err.name = 'NotFoundException';
    throw err;
  },
});
// Fake rotate: tags the canvas with the requested degree, no real canvas work.
const fakeRotate = (canvas, deg) => ({ ...canvas, deg });

describe('decodeCanvasMultiOrientation', () => {
  it('decodes an upright frame (0°) without rotating', () => {
    const reader = makeReader([0]);
    expect(decodeCanvasMultiOrientation(reader, {}, [0, 90, 270], fakeRotate)).toBe('036000291452');
  });

  it('reads a SIDEWAYS frame by trying 90° when upright misses', () => {
    const reader = makeReader([90]); // only the 90°-rotated frame decodes
    expect(decodeCanvasMultiOrientation(reader, {}, [0, 90, 270], fakeRotate)).toBe('036000291452');
  });

  it('reads a frame rotated the other way (270°)', () => {
    const reader = makeReader([270]);
    expect(decodeCanvasMultiOrientation(reader, {}, [0, 90, 270], fakeRotate)).toBe('036000291452');
  });

  it('returns null when no orientation decodes', () => {
    const reader = makeReader([]); // always NotFound
    expect(decodeCanvasMultiOrientation(reader, {}, [0, 90, 270], fakeRotate)).toBeNull();
  });

  it('stops at the first matching orientation (no wasted decodes)', () => {
    const spy = vi.fn((c) => {
      if (c.deg === 0) return { getText: () => 'X' };
      throw new Error('should not reach');
    });
    const out = decodeCanvasMultiOrientation({ decodeFromCanvas: spy }, {}, [0, 90, 270], fakeRotate);
    expect(out).toBe('X');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ignores an empty decode result and keeps trying', () => {
    const reader = {
      decodeFromCanvas: (c) => (c.deg === 90 ? { getText: () => '123' } : { getText: () => '' }),
    };
    expect(decodeCanvasMultiOrientation(reader, {}, [0, 90, 270], fakeRotate)).toBe('123');
  });

  it('skips an orientation whose rotate throws (e.g. zero-size frame)', () => {
    const reader = makeReader([270]);
    const flakyRotate = (canvas, deg) => {
      if (deg === 90) throw new Error('bad frame');
      return { ...canvas, deg };
    };
    expect(decodeCanvasMultiOrientation(reader, {}, [0, 90, 270], flakyRotate)).toBe('036000291452');
  });
});
