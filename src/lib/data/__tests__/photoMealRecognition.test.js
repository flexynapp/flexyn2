import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock supabase BEFORE importing the module under test.
const invokeMock = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: { functions: { invoke: (...args) => invokeMock(...args) } },
}));

import { recognizeMealPhoto } from '@/lib/data/photoMealRecognition';

// ── Browser-API scaffolding (jsdom has no createImageBitmap / canvas
//    rasteriser / URL.createObjectURL) ────────────────────────────────

function makeFakeCanvas({ outBlob } = {}) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage: vi.fn() })),
    toBlob: vi.fn((cb) => cb(
      outBlob !== undefined
        ? outBlob
        : new Blob([new Uint8Array(2048)], { type: 'image/jpeg' })
    )),
  };
  return canvas;
}

let fakeCanvas;
const realCreateElement = document.createElement.bind(document);

// Image stub whose load always FAILS — used to simulate a format the
// browser can't decode (HEIC on non-Safari).
class FailingImage {
  set src(_v) { queueMicrotask(() => this.onerror?.(new Error('decode failed'))); }
}

beforeEach(() => {
  invokeMock.mockReset();
  fakeCanvas = makeFakeCanvas();
  vi.spyOn(document, 'createElement').mockImplementation((tag) =>
    tag === 'canvas' ? fakeCanvas : realCreateElement(tag));
  // jsdom lacks these
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const jpegBlob = (bytes = 1024) =>
  new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });

describe('recognizeMealPhoto — input guards', () => {
  it('returns NO_IMAGE when no blob is given', async () => {
    expect(await recognizeMealPhoto(null)).toEqual({ ok: false, error: 'NO_IMAGE' });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('recognizeMealPhoto — canvas downscale', () => {
  it('scales the longest edge to 1280px and uploads JPEG', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 4000, height: 3000, close: vi.fn(),
    })));
    invokeMock.mockResolvedValue({ data: { ok: true, result: { food_name: 'Pasta' } }, error: null });

    const res = await recognizeMealPhoto(jpegBlob(1024));

    expect(fakeCanvas.width).toBe(1280);
    expect(fakeCanvas.height).toBe(960);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [, opts] = invokeMock.mock.calls[0];
    expect(opts.body.media_type).toBe('image/jpeg');
    expect(typeof opts.body.image_base64).toBe('string');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(res).toEqual({ ok: true, result: { food_name: 'Pasta' } });
  });

  it('passes the full result through verbatim (portion_estimate, confidence, notes)', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 1000, height: 1000, close: vi.fn(),
    })));
    const result = {
      food_name: 'Grilled salmon with quinoa',
      portion_estimate: '1 plate (~450 g)',
      calories: 540, protein_g: 45, carbs_g: 50, fat_g: 18, fiber_g: 6,
      confidence: 'high',
      notes: 'Salmon ~180g, quinoa ~150g, asparagus ~90g.',
    };
    invokeMock.mockResolvedValue({ data: { ok: true, result }, error: null });

    const res = await recognizeMealPhoto(jpegBlob(1024));
    expect(res).toEqual({ ok: true, result });
    // The new fields survive the round-trip so the UI can show them.
    expect(res.result.portion_estimate).toBe('1 plate (~450 g)');
    expect(res.result.confidence).toBe('high');
  });

  it('never upscales a small image', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 640, height: 480, close: vi.fn(),
    })));
    invokeMock.mockResolvedValue({ data: { ok: true, result: {} }, error: null });

    await recognizeMealPhoto(jpegBlob(1024));
    expect(fakeCanvas.width).toBe(640);
    expect(fakeCanvas.height).toBe(480);
  });

  it('rejects undecodable non-JPEG/PNG formats with UNSUPPORTED_FORMAT', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('nope'); }));
    vi.stubGlobal('Image', FailingImage);

    const heic = new Blob([new Uint8Array(1024)], { type: 'image/heic' });
    expect(await recognizeMealPhoto(heic)).toEqual({ ok: false, error: 'UNSUPPORTED_FORMAT' });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('falls back to uploading the original blob when decode fails but the type is API-supported', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('nope'); }));
    vi.stubGlobal('Image', FailingImage);
    invokeMock.mockResolvedValue({ data: { ok: true, result: {} }, error: null });

    const res = await recognizeMealPhoto(jpegBlob(1024));
    expect(res).toEqual({ ok: true, result: {} });
    const [, opts] = invokeMock.mock.calls[0];
    expect(opts.body.media_type).toBe('image/jpeg');
  });

  it('returns IMAGE_TOO_LARGE when even the re-encoded image exceeds the cap', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 1000, height: 1000, close: vi.fn(),
    })));
    fakeCanvas.toBlob = vi.fn((cb) =>
      cb(new Blob([new Uint8Array(5 * 1024 * 1024)], { type: 'image/jpeg' })));

    expect(await recognizeMealPhoto(jpegBlob(1024)))
      .toEqual({ ok: false, error: 'IMAGE_TOO_LARGE' });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('recognizeMealPhoto — error-body parsing', () => {
  beforeEach(() => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 100, height: 100, close: vi.fn(),
    })));
  });

  const httpError = (status, body) => ({
    message: 'Edge Function returned a non-2xx status code',
    context: {
      status,
      clone() { return this; },
      json: async () => {
        if (body === undefined) throw new Error('not json');
        return body;
      },
    },
  });

  it('maps a 429 body to RATE_LIMIT', async () => {
    invokeMock.mockResolvedValue({ data: null, error: httpError(429, { ok: false, error: 'RATE_LIMIT' }) });
    expect(await recognizeMealPhoto(jpegBlob())).toEqual({ ok: false, error: 'RATE_LIMIT' });
  });

  it('maps a 413 body to IMAGE_TOO_LARGE', async () => {
    invokeMock.mockResolvedValue({ data: null, error: httpError(413, { ok: false, error: 'IMAGE_TOO_LARGE' }) });
    expect(await recognizeMealPhoto(jpegBlob())).toEqual({ ok: false, error: 'IMAGE_TOO_LARGE' });
  });

  it('falls back to status mapping when the body is not JSON', async () => {
    invokeMock.mockResolvedValue({ data: null, error: httpError(404) });
    expect(await recognizeMealPhoto(jpegBlob())).toEqual({ ok: false, error: 'PIPELINE_MISSING' });

    invokeMock.mockResolvedValue({ data: null, error: httpError(429) });
    expect(await recognizeMealPhoto(jpegBlob())).toEqual({ ok: false, error: 'RATE_LIMIT' });
  });

  it('maps a fetch-level failure (no HTTP status) to NETWORK, not the raw message', async () => {
    // supabase-js throws this when the function isn't deployed / CORS / offline.
    invokeMock.mockResolvedValue({ data: null, error: { message: 'Failed to send a request to the Edge Function' } });
    expect(await recognizeMealPhoto(jpegBlob())).toEqual({ ok: false, error: 'NETWORK' });
  });
});

describe('recognizeMealPhoto — timeout', () => {
  it('aborts after timeoutMs and returns TIMEOUT', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 100, height: 100, close: vi.fn(),
    })));
    invokeMock.mockImplementation((_name, opts) => new Promise((resolve) => {
      opts.signal.addEventListener('abort', () =>
        resolve({ data: null, error: new Error('aborted') }));
    }));

    expect(await recognizeMealPhoto(jpegBlob(), { timeoutMs: 20 }))
      .toEqual({ ok: false, error: 'TIMEOUT' });
  });
});
