// Storage upload invariants for the hand-rolled upload paths in
// src/lib/data (the ones that don't go through db.js `_uploadFile`).
//
// These exist because all three of them shipped broken for months: migration
// comments in 140/145 referred to "the existing `avatars` Storage bucket",
// which has never existed, and three call sites copied the name out of the
// comment. Every journal attachment, gym feed image and gym logo upload
// failed — two of them swallowed the error and returned null.
//
// Renaming the bucket alone was NOT sufficient: the `uploads` bucket's INSERT
// policy is `foldername(name)[1] = auth.uid()`, so the old `journal/<uid>/…`
// and `gym/<gymId>/…` prefixes are rejected by RLS even against the right
// bucket. Verified against production: old shapes → "Bucket not found" /
// "new row violates row-level security policy"; uid-first → 200.
//
// The two invariants below are what those failures reduce to. Both are easy
// to regress from a stale comment, and neither is visible in a green build.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const _state = { bucket: null, upload: { args: null, error: null }, uid: 'user-abc' };

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: _state.uid } }, error: null }),
    },
    storage: {
      from: (bucket) => {
        _state.bucket = bucket;
        return {
          upload: async (path, blob, opts) => {
            _state.upload.args = { path, blob, opts };
            return { data: { path }, error: _state.upload.error };
          },
          getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
        };
      },
    },
  },
}));

vi.mock('@/api/safeSelect', () => ({ safeSelect: vi.fn() }));

import { uploadAttachment } from '../journal';
import { uploadFeedImage } from '../gymBusinesses';

const UID = 'user-abc';
const png = () => new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });

beforeEach(() => {
  _state.bucket = null;
  _state.upload = { args: null, error: null };
  _state.uid = UID;
});

describe('journal.uploadAttachment', () => {
  it('uploads to the `uploads` bucket — never `avatars`, which does not exist', async () => {
    await uploadAttachment(UID, png());
    expect(_state.bucket).toBe('uploads');
    expect(_state.bucket).not.toBe('avatars');
  });

  it('puts the uid FIRST in the path — the bucket INSERT policy keys on foldername(name)[1]', async () => {
    await uploadAttachment(UID, png());
    expect(_state.upload.args.path.split('/')[0]).toBe(UID);
  });

  it('pins contentType from the extension, not the client-supplied file.type', async () => {
    // A tampered client claiming image/png for an SVG must not get
    // image/svg+xml written into a PUBLIC bucket (script-execution XSS).
    const spoofed = new File(['<svg/>'], 'evil.svg', { type: 'image/png' });
    const res = await uploadAttachment(UID, spoofed);
    expect(res).toBeNull();
    expect(_state.upload.args).toBeNull();
  });

  it('refuses an extension outside the image allowlist', async () => {
    const res = await uploadAttachment(UID, new File(['x'], 'notes.html', { type: 'text/html' }));
    expect(res).toBeNull();
    expect(_state.upload.args).toBeNull();
  });

  it('returns null (not a throw) when storage rejects, so the caller can toast', async () => {
    _state.upload.error = { message: 'Bucket not found' };
    await expect(uploadAttachment(UID, png())).resolves.toBeNull();
  });
});

describe('gymBusinesses.uploadFeedImage', () => {
  it('uploads to the `uploads` bucket with the uid first, gym id one level down', async () => {
    await uploadFeedImage('gym-1', png());
    expect(_state.bucket).toBe('uploads');
    const parts = _state.upload.args.path.split('/');
    expect(parts[0]).toBe(UID);
    expect(parts).toContain('gym-1');
  });

  it('refuses a spoofed content type', async () => {
    const res = await uploadFeedImage('gym-1', new File(['<svg/>'], 'evil.svg', { type: 'image/jpeg' }));
    expect(res).toBeNull();
    expect(_state.upload.args).toBeNull();
  });
});
