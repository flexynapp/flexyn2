// Tests for the barcode decode-hints builder. Uses the REAL zxing enums so
// the format-name → enum-value mapping is verified against the installed
// library, not a mock that could drift from it.

import { describe, it, expect } from 'vitest';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import { buildBarcodeHints, RETAIL_FORMAT_NAMES } from '../barcodeHints';

describe('buildBarcodeHints', () => {
  const hints = buildBarcodeHints(DecodeHintType, BarcodeFormat);

  it('enables TRY_HARDER (the sideways/rotated-decode fix)', () => {
    expect(hints.get(DecodeHintType.TRY_HARDER)).toBe(true);
  });

  it('restricts to the retail symbologies, mapped to real enum values', () => {
    const formats = hints.get(DecodeHintType.POSSIBLE_FORMATS);
    expect(Array.isArray(formats)).toBe(true);
    expect(formats.length).toBe(RETAIL_FORMAT_NAMES.length);
    // Every entry resolves to a defined BarcodeFormat enum value.
    for (const f of formats) expect(typeof f).toBe('number');
    // The headline grocery formats are present.
    for (const name of ['UPC_A', 'EAN_13', 'EAN_8', 'UPC_E']) {
      expect(formats).toContain(BarcodeFormat[name]);
    }
  });

  it('drops any format name the library does not define (forward-safe)', () => {
    const fakeFormat = { UPC_A: 14 }; // only one known member
    const out = buildBarcodeHints(DecodeHintType, fakeFormat);
    const formats = out.get(DecodeHintType.POSSIBLE_FORMATS);
    expect(formats).toEqual([14]); // undefined names filtered out
  });

  it('returns a Map suitable for new BrowserMultiFormatReader(hints)', () => {
    expect(hints).toBeInstanceOf(Map);
    expect(hints.size).toBe(2);
  });
});
