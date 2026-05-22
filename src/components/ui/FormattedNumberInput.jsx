// src/components/ui/FormattedNumberInput.jsx
//
// Number input that displays the value with locale-aware thousands
// separators when not focused, but reverts to raw digits when the
// user is editing (so the cursor isn't fighting commas). Hands the
// PARENT a raw number — no parsing required at the call site.
//
// Pattern: type "1000" → blur → see "1,000". Tap to edit → "1000".
// Tab away → "1,000" again. Premium-feel touch from Stripe / Apple
// Numbers / Notion.
//
// USAGE
//
//   <FormattedNumberInput
//     value={weight}
//     onChange={setWeight}
//     min={0}
//     max={1500}
//     placeholder="225"
//   />
//
// PROPS
//
//   value      Raw numeric value (Number | null). Use null for empty.
//   onChange   (next: number | null) => void
//   min/max    Optional. Enforced on commit (blur), not while typing.
//   placeholder, className, ...rest  → spread to the underlying Input.
//   allowDecimals  Default true. When false, strips dot in typed input.
//   locale     Default 'en-US'. Reads from useLanguage() in a future iteration.
//
// EDGE CASES HANDLED
//
//   • Empty input → onChange(null), no NaN bleed into parent state.
//   • Paste of "1,500" → strips the separator, keeps 1500 as the value.
//   • Pasted negative → clamped to min if min is set.
//   • Decimal: "100.5" preserved across blur → focus → blur.
//   • Locale "de-DE" formats as "1.500", strips "." separators on parse.

import { useState, useEffect, forwardRef } from 'react';
import { Input } from './input';

function formatForDisplay(value, locale) {
  if (value === null || value === undefined || value === '' || Number.isNaN(value)) return '';
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value);
  } catch {
    return String(value);
  }
}

function rawForEditing(value) {
  if (value === null || value === undefined || value === '' || Number.isNaN(value)) return '';
  return String(value);
}

function parseRaw(text, locale) {
  if (!text) return null;
  // Strip the locale's group separator (commas in en, periods in de, etc.).
  // Build a regex by sampling the formatter on 1,234.5.
  let groupSep = ',';
  let decimalSep = '.';
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(1234.5);
    groupSep = parts.find((p) => p.type === 'group')?.value ?? ',';
    decimalSep = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  } catch { /* fall back to defaults */ }
  const cleaned = text
    .replace(new RegExp(`\\${groupSep}`, 'g'), '')
    .replace(new RegExp(`\\${decimalSep}`, 'g'), '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

const FormattedNumberInput = forwardRef(function FormattedNumberInput(
  {
    value,
    onChange,
    min,
    max,
    allowDecimals = true,
    locale = 'en-US',
    onBlur,
    onFocus,
    ...rest
  },
  ref
) {
  // Internal text state — mirror of `value` while editing, since the
  // formatted display vs. raw editing version differ.
  const [text, setText] = useState(() =>
    value === null || value === undefined ? '' : formatForDisplay(value, locale)
  );
  const [focused, setFocused] = useState(false);

  // Re-sync from parent when value changes externally (and we're not
  // mid-edit — would clobber cursor).
  useEffect(() => {
    if (focused) return;
    setText(value === null || value === undefined ? '' : formatForDisplay(value, locale));
  }, [value, locale, focused]);

  const handleChange = (e) => {
    let raw = e.target.value;
    if (!allowDecimals) raw = raw.replace(/[.,]/g, '');
    // Allow only digits, decimal separator, and a leading minus.
    raw = raw.replace(/[^0-9.,\-]/g, '');
    setText(raw);
    const parsed = parseRaw(raw, locale);
    onChange?.(parsed);
  };

  const handleFocus = (e) => {
    setFocused(true);
    // Show raw form (no commas) so the cursor isn't fighting separators.
    setText(rawForEditing(value));
    onFocus?.(e);
  };

  const handleBlur = (e) => {
    setFocused(false);
    // Clamp to min/max on commit.
    let v = value;
    if (typeof v === 'number') {
      if (typeof min === 'number' && v < min) v = min;
      if (typeof max === 'number' && v > max) v = max;
      if (v !== value) onChange?.(v);
    }
    setText(v === null || v === undefined ? '' : formatForDisplay(v, locale));
    onBlur?.(e);
  };

  return (
    <Input
      ref={ref}
      type="text"
      inputMode={allowDecimals ? 'decimal' : 'numeric'}
      value={text}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      {...rest}
    />
  );
});

export default FormattedNumberInput;
