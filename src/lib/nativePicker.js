// Native date and time inputs only open their picker when the small
// calendar or clock glyph is hit. Tapping the text (the mm/dd/yyyy
// segments) focuses a segment and nothing else, so on desktop Chrome and
// Android the field reads as broken. showPicker() opens the same native
// picker from anywhere on the field. iOS Safari already opens it on any tap
// and has no showPicker before 16.4, so the guard keeps that path as it was.
export const PICKER_TYPES = new Set(['date', 'datetime-local', 'time', 'month', 'week']);

export function openNativePicker(input) {
  if (!input || input.disabled || input.readOnly) return;
  if (typeof input.showPicker !== 'function') return;
  try {
    input.showPicker();
  } catch {
    // Throws without user activation or inside a cross-origin frame. The
    // field still works by typing or through its own glyph, so ignore it.
  }
}

export function openPickerOnClick(e) {
  openNativePicker(e.currentTarget);
}
