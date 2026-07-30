// Tests for src/lib/equipmentImage.js — the image fallback chain.
//
// The invariant that matters: the chain ALWAYS terminates. The picker
// and the exercise header must never render a blank box, whatever
// combination of photos does or doesn't exist.

import { describe, it, expect } from 'vitest';
import { resolveEquipmentImage, isPhoto, REFERENCE_IMAGES } from '../equipmentImage';

describe('resolveEquipmentImage — tier ordering', () => {
  it('prefers a photo of this machine in this space', () => {
    const r = resolveEquipmentImage({
      spacePhotoUrl: 'https://x.test/mine.jpg',
      modelPhotoUrl: 'https://x.test/other.jpg',
      implementType: 'leg_press',
    });
    expect(r.kind).toBe('space');
    expect(r.url).toBe('https://x.test/mine.jpg');
  });

  it('falls back to a photo of the same model elsewhere', () => {
    const r = resolveEquipmentImage({
      modelPhotoUrl: 'https://x.test/other.jpg',
      implementType: 'leg_press',
    });
    expect(r.kind).toBe('model');
    expect(r.url).toBe('https://x.test/other.jpg');
  });

  it('falls through to the silhouette when there are no photos', () => {
    const r = resolveEquipmentImage({ implementType: 'leg_press' });
    expect(r.kind).toBe('silhouette');
    expect(r.url).toBeNull();
  });

  it('always terminates, even with nothing at all', () => {
    for (const args of [undefined, {}, { implementType: null }, { implementType: 'nonsense' }]) {
      const r = resolveEquipmentImage(args);
      expect(r.kind).toBe('silhouette');
      expect(r).toHaveProperty('url');
      expect(r).toHaveProperty('attribution');
    }
  });
});

describe('reference tier', () => {
  it('ships empty — no image whose license nobody verified', () => {
    // Intentional. Populating this requires verifying each file's own
    // license page and adding an ATTRIBUTIONS.md row. See the module
    // header. If this ever becomes non-empty, the test below must pass.
    expect(Object.keys(REFERENCE_IMAGES)).toHaveLength(0);
  });

  it('every reference entry carries full attribution', () => {
    // Guards the tier against a future half-populated entry: an image
    // without author + license is a license violation, so the resolver
    // must skip it rather than render it.
    for (const [type, ref] of Object.entries(REFERENCE_IMAGES)) {
      expect(ref.url, `${type}.url`).toBeTruthy();
      expect(ref.author, `${type}.author`).toBeTruthy();
      expect(ref.license, `${type}.license`).toBeTruthy();
      expect(ref.licenseUrl, `${type}.licenseUrl`).toBeTruthy();
    }
  });

  it('skips an incomplete reference rather than rendering it unattributed', () => {
    REFERENCE_IMAGES.__test_incomplete = { url: 'https://x.test/no-credit.jpg' };
    try {
      const r = resolveEquipmentImage({ implementType: '__test_incomplete' });
      expect(r.kind).toBe('silhouette');
      expect(r.url).toBeNull();
    } finally {
      delete REFERENCE_IMAGES.__test_incomplete;
    }
  });

  it('returns attribution for a complete reference', () => {
    REFERENCE_IMAGES.__test_complete = {
      url: 'https://x.test/ok.jpg',
      author: 'A Photographer',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Ok.jpg',
    };
    try {
      const r = resolveEquipmentImage({ implementType: '__test_complete' });
      expect(r.kind).toBe('reference');
      expect(r.attribution.author).toBe('A Photographer');
      expect(r.attribution.license).toBe('CC BY-SA 4.0');
    } finally {
      delete REFERENCE_IMAGES.__test_complete;
    }
  });
});

describe('isPhoto', () => {
  it('is true only for real photographs of real equipment', () => {
    expect(isPhoto({ kind: 'space' })).toBe(true);
    expect(isPhoto({ kind: 'model' })).toBe(true);
    expect(isPhoto({ kind: 'reference' })).toBe(false);
    expect(isPhoto({ kind: 'silhouette' })).toBe(false);
    expect(isPhoto(null)).toBe(false);
  });
});
