// Tests for src/lib/imageCompress.js — the canvas-based image
// downscaler used on photo uploads (progress photos, avatars, story
// snapshots) to keep mobile-data costs sane.
//
// Browser image APIs (createImageBitmap, canvas.toBlob, OffscreenCanvas)
// aren't available in jsdom, so we stub:
//   • global.createImageBitmap → return a fake bitmap with width/height
//   • HTMLCanvasElement.prototype.getContext → 2d context stub
//   • HTMLCanvasElement.prototype.toBlob → handed-back Blob of known size
//
// This way the tests can drive the decision branches (skip/early-out/
// rename/etc.) without needing a real renderer.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compressImage } from '../imageCompress';

// Tunable fake bitmap and toBlob output across tests.
let fakeBitmapW = 3000;
let fakeBitmapH = 4000;
let fakeOutputBytes = 100 * 1024;

beforeEach(() => {
  fakeBitmapW = 3000;
  fakeBitmapH = 4000;
  fakeOutputBytes = 100 * 1024;

  global.createImageBitmap = vi.fn(async () => ({
    width: fakeBitmapW,
    height: fakeBitmapH,
    close: vi.fn(),
  }));

  // jsdom HTMLCanvasElement: stub getContext and toBlob.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
  }));
  HTMLCanvasElement.prototype.toBlob = function (cb, type) {
    const blob = new Blob([new Uint8Array(fakeOutputBytes)], { type });
    setTimeout(() => cb(blob), 0);
  };
});

function makeFile({ name = 'photo.jpg', type = 'image/jpeg', bytes = 500 * 1024 } = {}) {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('compressImage', () => {
  it('returns null/non-blob inputs unchanged', async () => {
    expect(await compressImage(null)).toBeNull();
    expect(await compressImage(undefined)).toBeUndefined();
    expect(await compressImage('not a file')).toBe('not a file');
  });

  it('returns non-image files unchanged', async () => {
    const f = new File(['hello'], 'a.txt', { type: 'text/plain' });
    expect(await compressImage(f)).toBe(f);
  });

  it('skips SVG and GIF (animation/vector preservation)', async () => {
    const svg = makeFile({ name: 'i.svg', type: 'image/svg+xml' });
    const gif = makeFile({ name: 'i.gif', type: 'image/gif' });
    expect(await compressImage(svg)).toBe(svg);
    expect(await compressImage(gif)).toBe(gif);
  });

  it('skips files smaller than minBytes', async () => {
    const tiny = makeFile({ bytes: 4 * 1024 });
    expect(await compressImage(tiny)).toBe(tiny);
  });

  it('downscales a large jpeg and renames to .jpg', async () => {
    const big = makeFile({ name: 'IMG_1234.jpeg', bytes: 4 * 1024 * 1024 });
    fakeOutputBytes = 200 * 1024; // smaller than input
    const out = await compressImage(big, { maxWidth: 1600, maxHeight: 1600 });
    expect(out).not.toBe(big);
    expect(out.name).toBe('IMG_1234.jpg');
    expect(out.type).toBe('image/jpeg');
    expect(out.size).toBe(200 * 1024);
  });

  it('keeps the original when compressed output is larger', async () => {
    const original = makeFile({ bytes: 100 * 1024 });
    fakeOutputBytes = 200 * 1024; // bigger than input
    const out = await compressImage(original);
    expect(out).toBe(original);
  });

  it('returns the original when the image is already smaller than max bounds and JPEG', async () => {
    fakeBitmapW = 800;
    fakeBitmapH = 600;
    const original = makeFile({ bytes: 200 * 1024 });
    const out = await compressImage(original, { maxWidth: 1600, maxHeight: 1600 });
    expect(out).toBe(original);
  });

  it('still recompresses a non-JPEG image even when no downscaling is needed', async () => {
    fakeBitmapW = 800;
    fakeBitmapH = 600;
    fakeOutputBytes = 150 * 1024;
    const png = makeFile({ name: 'a.png', type: 'image/png', bytes: 300 * 1024 });
    const out = await compressImage(png, { maxWidth: 1600, maxHeight: 1600 });
    expect(out).not.toBe(png);
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('a.jpg');
  });

  it('falls back to the original when something throws', async () => {
    global.createImageBitmap = vi.fn(async () => { throw new Error('decode fail'); });
    const big = makeFile({ bytes: 4 * 1024 * 1024 });
    const out = await compressImage(big);
    expect(out).toBe(big);
  });
});
