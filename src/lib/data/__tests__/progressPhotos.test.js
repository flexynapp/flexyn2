import { describe, it, expect, beforeEach, vi } from 'vitest';

// Storage mock — each method returns staged data/error and records args.
const _state = {
  upload: { args: null, error: null },
  list: { data: [], error: null },
  signed: { data: [], error: null },
  remove: { args: null, error: null },
};

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    storage: {
      from: (bucket) => {
        _state.bucket = bucket;
        return {
          upload: async (path, blob, opts) => {
            _state.upload.args = { path, blob, opts };
            return { data: { path }, error: _state.upload.error };
          },
          list: async (prefix, opts) => {
            _state.list.args = { prefix, opts };
            return { data: _state.list.data, error: _state.list.error };
          },
          createSignedUrls: async (paths, ttl) => {
            _state.signed.args = { paths, ttl };
            return { data: _state.signed.data, error: _state.signed.error };
          },
          remove: async (paths) => {
            _state.remove.args = { paths };
            return { data: null, error: _state.remove.error };
          },
        };
      },
    },
  },
}));

import {
  uploadProgressPhoto,
  listProgressPhotos,
  deleteProgressPhoto,
  migrateLocalProgressPhotos,
} from '../progressPhotos';

const UID = 'user-123';

beforeEach(() => {
  _state.upload = { args: null, error: null };
  _state.list = { data: [], error: null };
  _state.signed = { data: [], error: null };
  _state.remove = { args: null, error: null };
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('uploadProgressPhoto', () => {
  it('uploads to <uid>/<takenAtMs>.jpg with image/jpeg + upsert:false', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const res = await uploadProgressPhoto(UID, blob, 1700000000000);
    expect(_state.bucket).toBe('progress-photos');
    expect(_state.upload.args.path).toBe('user-123/1700000000000.jpg');
    expect(_state.upload.args.opts).toEqual({ contentType: 'image/jpeg', upsert: false });
    expect(res.path).toBe('user-123/1700000000000.jpg');
    expect(res.takenAt).toBe(new Date(1700000000000).toISOString());
  });

  it('throws on a storage error', async () => {
    _state.upload.error = new Error('boom');
    await expect(uploadProgressPhoto(UID, new Blob(['x']), 1)).rejects.toThrow('boom');
  });

  it('requires userId and blob', async () => {
    await expect(uploadProgressPhoto(null, new Blob(['x']))).rejects.toThrow(/userId/);
    await expect(uploadProgressPhoto(UID, null)).rejects.toThrow(/blob/);
  });
});

describe('listProgressPhotos', () => {
  it('lists newest-first, parses takenAt from filename, attaches signed urls', async () => {
    _state.list.data = [
      { name: '1700000002000.jpg' },
      { name: '1700000001000.jpg' },
      { name: '.emptyFolderPlaceholder' }, // non-jpg placeholder is filtered
    ];
    _state.signed.data = [
      { signedUrl: 'https://signed/2' },
      { signedUrl: 'https://signed/1' },
    ];
    const res = await listProgressPhotos(UID);
    expect(_state.list.args.opts).toEqual({ sortBy: { column: 'name', order: 'desc' } });
    expect(_state.signed.args.paths).toEqual([
      'user-123/1700000002000.jpg',
      'user-123/1700000001000.jpg',
    ]);
    expect(_state.signed.args.ttl).toBe(3600);
    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({
      name: '1700000002000.jpg',
      path: 'user-123/1700000002000.jpg',
      url: 'https://signed/2',
      takenAt: new Date(1700000002000).toISOString(),
    });
  });

  it('returns [] for an empty folder without signing', async () => {
    _state.list.data = [];
    const res = await listProgressPhotos(UID);
    expect(res).toEqual([]);
    expect(_state.signed.args).toBeUndefined();
  });

  it('throws when the list call errors', async () => {
    _state.list.error = new Error('list-fail');
    await expect(listProgressPhotos(UID)).rejects.toThrow('list-fail');
  });
});

describe('deleteProgressPhoto', () => {
  it('removes the path', async () => {
    await deleteProgressPhoto('user-123/1.jpg');
    expect(_state.remove.args.paths).toEqual(['user-123/1.jpg']);
  });
  it('throws on remove error', async () => {
    _state.remove.error = new Error('nope');
    await expect(deleteProgressPhoto('user-123/1.jpg')).rejects.toThrow('nope');
  });
});

describe('migrateLocalProgressPhotos', () => {
  const dataUrl = 'data:image/jpeg;base64,' + btoa('hello');

  it('uploads every localStorage photo then clears the key + sets the flag', async () => {
    localStorage.setItem(
      `flexyn.progressPhotos.${UID}`,
      JSON.stringify([
        { id: 'a', dataUrl, takenAt: '2024-01-01T00:00:00.000Z' },
        { id: 'b', dataUrl, takenAt: '2024-02-01T00:00:00.000Z' },
      ]),
    );
    const res = await migrateLocalProgressPhotos(UID);
    expect(res).toEqual({ migrated: 2, failed: 0, ran: true });
    expect(localStorage.getItem(`flexyn.progressPhotos.${UID}`)).toBeNull();
    expect(localStorage.getItem(`flexyn.progressPhotos.migrated.${UID}`)).toBe('1');
  });

  it('is a no-op once the migrated flag is set', async () => {
    localStorage.setItem(`flexyn.progressPhotos.migrated.${UID}`, '1');
    localStorage.setItem(`flexyn.progressPhotos.${UID}`, JSON.stringify([{ dataUrl }]));
    const res = await migrateLocalProgressPhotos(UID);
    expect(res.ran).toBe(false);
    expect(_state.upload.args).toBeNull();
  });

  it('keeps failed entries and does NOT set the flag on partial failure', async () => {
    _state.upload.error = new Error('upload-down');
    localStorage.setItem(
      `flexyn.progressPhotos.${UID}`,
      JSON.stringify([{ id: 'a', dataUrl, takenAt: '2024-01-01T00:00:00.000Z' }]),
    );
    const res = await migrateLocalProgressPhotos(UID);
    expect(res.failed).toBe(1);
    expect(localStorage.getItem(`flexyn.progressPhotos.migrated.${UID}`)).toBeNull();
    const remaining = JSON.parse(localStorage.getItem(`flexyn.progressPhotos.${UID}`));
    expect(remaining).toHaveLength(1);
  });

  it('also drains the legacy un-namespaced key', async () => {
    localStorage.setItem(
      'flexyn_progress_photos',
      JSON.stringify([{ id: 'legacy', dataUrl, takenAt: '2023-12-01T00:00:00.000Z' }]),
    );
    const res = await migrateLocalProgressPhotos(UID);
    expect(res.migrated).toBe(1);
    expect(localStorage.getItem('flexyn_progress_photos')).toBeNull();
  });
});
