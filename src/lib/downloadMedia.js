// src/lib/downloadMedia.js
//
// Single helper for "save this image/video to the user's device."
// Used by:
//   • StoryPreviewSheet — composer preview download
//   • StoryViewer       — story-owner download of their own published stories
//
// Behavior:
//   1. Fetch the URL as a blob.
//   2. Use an <a download> anchor for browsers that honor it.
//   3. iOS Safari ignores `<a download>` for cross-origin media — fall
//      back to opening the URL in a new tab so the user can long-press
//      and choose "Save Image." Comment on the constraint, not the
//      flag-checking; this is platform reality.

function isIosSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isSafari;
}

/**
 * Download a remote media URL to the user's device.
 *
 * @param {string} url        Remote media URL (image or video).
 * @param {string} filename   Suggested filename (e.g. "flexyn-story-123.jpg").
 * @returns {Promise<{ ok: boolean, opened?: boolean }>}
 *   ok=true → download triggered (or new-tab opened on iOS).
 *   ok=false → fetch failed; caller should surface a toast.
 */
export async function downloadMedia(url, filename) {
  if (!url) return { ok: false };

  // iOS Safari path: skip the blob round-trip; opening in a new tab
  // lets the user long-press → Save Image, which is the platform-
  // native flow.
  if (isIosSafari()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return { ok: true, opened: true };
  }

  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return { ok: false };
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Hold the object URL long enough for the click to be processed,
    // then release the blob memory.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
