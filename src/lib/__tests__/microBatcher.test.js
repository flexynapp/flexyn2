import { describe, it, expect, vi } from 'vitest';
import { createBatcher } from '../microBatcher';

describe('createBatcher', () => {
  it('coalesces same-tick calls into one batchFn call with deduped keys', async () => {
    const batchFn = vi.fn(async (keys) => new Map(keys.map((k) => [k, `v:${k}`])));
    const load = createBatcher(batchFn);

    const results = await Promise.all([load('a'), load('b'), load('a')]);

    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(batchFn.mock.calls[0][0]).toEqual(['a', 'b']); // deduped
    expect(results).toEqual(['v:a', 'v:b', 'v:a']);
  });

  it('resolves undefined for keys absent from the result map', async () => {
    const load = createBatcher(async () => new Map());
    await expect(load('missing')).resolves.toBeUndefined();
  });

  it('rejects every queued caller when batchFn throws', async () => {
    const boom = new Error('db down');
    const load = createBatcher(async () => { throw boom; });

    const p1 = load('a');
    const p2 = load('b');
    await expect(p1).rejects.toBe(boom);
    await expect(p2).rejects.toBe(boom);
  });

  it('flushes immediately when maxBatch is reached', async () => {
    const batchFn = vi.fn(async (keys) => new Map(keys.map((k) => [k, k])));
    const load = createBatcher(batchFn, { maxBatch: 2 });

    const p1 = load('a');
    const p2 = load('b'); // hits maxBatch → immediate flush
    await Promise.all([p1, p2]);
    expect(batchFn).toHaveBeenCalledTimes(1);

    // A later call starts a fresh batch.
    await load('c');
    expect(batchFn).toHaveBeenCalledTimes(2);
  });

  it('separates calls made in different windows into different batches', async () => {
    const batchFn = vi.fn(async (keys) => new Map(keys.map((k) => [k, k])));
    const load = createBatcher(batchFn, { windowMs: 5 });

    await load('first');
    await load('second');

    expect(batchFn).toHaveBeenCalledTimes(2);
    expect(batchFn.mock.calls[0][0]).toEqual(['first']);
    expect(batchFn.mock.calls[1][0]).toEqual(['second']);
  });
});
