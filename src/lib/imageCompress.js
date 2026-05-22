// src/lib/imageCompress.js
//
// Client-side image compression — downscale + re-encode before upload
// so a 12-megapixel iPhone photo doesn't burn through 4 MB of the
// user's mobile data to upload a 600px thumbnail. Pure browser-side
// canvas; no dependencies.
//
// USAGE
//
//   const compressed = await compressImage(file, { maxWidth: 1600 });
//   if (compressed) await uploadAvatar(compressed);
//
// RETURNS  a File (same name + .jpg ext) or the original on failure
//          so the caller can still upload — corrupt source images
//          shouldn't block the path entirely.
//
// SKIPS
//   • Non-image MIME types — return the original unchanged.
//   • SVG and GIF — animation/vector formats shouldn't be re-encoded
//     to a flat JPEG. Return original.
//   • Files already smaller than `minBytes` (default 64 KB) — no point
//     spending CPU on a tiny image.

const DEFAULT_OPTS = {
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.82,
  mimeType: 'image/jpeg',
  minBytes: 64 * 1024,
};

const SKIP_MIME = ['image/svg+xml', 'image/gif'];

export async function compressImage(file, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  if (!file || !(file instanceof Blob)) return file;
  if (!file.type?.startsWith('image/')) return file;
  if (SKIP_MIME.includes(file.type)) return file;
  if (file.size < o.minBytes) return file;

  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = scaleToFit(bitmap.width, bitmap.height, o.maxWidth, o.maxHeight);

    // Short-circuit: no downscaling AND already JPEG → not worth re-encoding.
    if (width === bitmap.width && height === bitmap.height && file.type === o.mimeType) {
      bitmap.close?.();
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, o.mimeType, o.quality);
    });
    if (!blob) return file;

    // If "compression" made the file LARGER (rare, but possible on
    // already-optimized JPEGs at high quality), keep the original.
    if (blob.size >= file.size) return file;

    const newName = renameToExt(file.name || 'image', o.mimeType);
    return new File([blob], newName, { type: o.mimeType, lastModified: Date.now() });
  } catch {
    // Anything goes wrong → just return the original so the upload
    // path stays intact.
    return file;
  }
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  // Fallback for older browsers — load via Image element.
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function scaleToFit(w, h, maxW, maxH) {
  const ratio = Math.min(maxW / w, maxH / h, 1);
  return {
    width: Math.round(w * ratio),
    height: Math.round(h * ratio),
  };
}

function renameToExt(name, mime) {
  const ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
  const base = name.replace(/\.[^.]+$/, '');
  return base + ext;
}
