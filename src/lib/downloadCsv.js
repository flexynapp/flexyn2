// src/lib/downloadCsv.js
//
// Single helper for "save this table to the user's device as CSV."
// Used by the Insights tab's three export buttons.
//
// Three things this handles that a hand-rolled anchor click does not:
//
//   1. **iOS.** This app ships to iOS and Android only, and iOS Safari
//      ignores `<a download>` — the old inline version in InsightsTab
//      also called `URL.revokeObjectURL` synchronously right after
//      `.click()`, which can abort the download before it starts, and
//      never appended the anchor to the DOM (Firefox requires that).
//      So export was doing nothing on the platform the app ships to.
//      The Web Share API with a File is the native "save to Files"
//      flow there; the anchor is the desktop/Android fallback.
//
//   2. **Excel's UTF-8 sniffing.** Without a BOM, Excel decodes the
//      file as the system codepage and mojibakes every non-ASCII
//      exercise name — which is 14 of the app's 15 languages.
//
//   3. **Formula injection.** Exercise names and workout notes are
//      user-authored and land in a file whose whole purpose is being
//      opened in a spreadsheet. A cell starting `=`, `+`, `-`, `@`,
//      TAB or CR is evaluated as a formula by Excel and Sheets even
//      when quoted, so those get an apostrophe prefix. Plain negative
//      numbers are exempted — prefixing `-5` would turn a real value
//      into text and break the column.

/** Excel/Sheets treat these leading characters as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** A bare number, which must stay numeric rather than being escaped to text. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Escape one cell: neutralize formula triggers, then RFC-4180 quote.
 * Exported for the test — the escaping is the part worth pinning.
 */
export function escapeCsvCell(value) {
  let s = value == null ? '' : String(value);
  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Rows (array of arrays) → an RFC-4180 CSV string. CRLF is what Excel expects. */
export function rowsToCsv(rows) {
  return rows.map(r => r.map(escapeCsvCell).join(',')).join('\r\n');
}

function isIos() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
}

/**
 * Build a CSV from `rows` and hand it to the user.
 *
 * MUST be called synchronously from a user gesture (a click handler) —
 * `navigator.share` rejects otherwise. Everything before the share call
 * is synchronous for exactly that reason; don't await anything above it.
 *
 * @param {Array<Array<string|number>>} rows  Header row first.
 * @param {string} filename
 * @returns {Promise<{ ok: boolean, shared?: boolean, cancelled?: boolean }>}
 */
export async function downloadCsv(rows, filename) {
  const csv = rowsToCsv(rows);
  // U+FEFF so Excel detects UTF-8. It is stripped by every CSV parser
  // that matters and is invisible in Sheets/Numbers.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });

  if (isIos() && typeof File === 'function' && navigator.share && navigator.canShare) {
    const file = new File([blob], filename, { type: 'text/csv' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return { ok: true, shared: true };
      } catch (err) {
        // The user dismissing the share sheet is a completed action,
        // not a failure — surfacing an error toast for it would be a lie.
        if (err?.name === 'AbortError') return { ok: true, shared: true, cancelled: true };
        // Anything else: fall through to the anchor below.
      }
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Hold the object URL long enough for the click to be processed,
    // then release the blob memory. Mirrors downloadMedia.js.
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
