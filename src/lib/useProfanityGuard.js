// CONVENTION: Every new user-text input field in this app — names, titles,
// descriptions, notes, comments — MUST use this guard. The guard intercepts
// onChange, shows the "Watch your profanity :)" popup, and clears the field
// on Continue. For numeric/date/dropdown inputs no guard is needed.
//
// Pattern for a single field:
//   const fieldGuard = useProfanityGuard(setField);
//   <Input onChange={e => fieldGuard.handleChange(e.target.value)} ... />
//   <ProfanityWarningDialog open={fieldGuard.open} onContinue={fieldGuard.onContinue} />
//
// Pattern for a form with several text fields (one shared popup):
//   const guard = useMultiProfanityGuard();
//   <Input  onChange={e => guard.handleChange(e.target.value, setName)} ... />
//   <Textarea onChange={e => guard.handleChange(e.target.value, setNotes)} ... />
//   <ProfanityWarningDialog open={guard.open} onContinue={guard.onContinue} />
//
// Always also call `hasAnyProfanity(...)` at submit time as a defensive
// backstop in case a value was injected programmatically (paste, import,
// pre-fill, etc.) and bypassed the live onChange check.

import { useState, useCallback } from 'react';
import { containsProfanity } from '@/lib/profanityFilter';

/**
 * Reusable profanity guard for any text-input field.
 *
 * Usage:
 *   const nameGuard = useProfanityGuard(setName);
 *   <Input value={name} onChange={e => nameGuard.handleChange(e.target.value)} />
 *   <ProfanityWarningDialog open={nameGuard.open} onContinue={nameGuard.onContinue} />
 */
export function useProfanityGuard(setter) {
  const [open, setOpen] = useState(false);

  const handleChange = useCallback((value) => {
    if (containsProfanity(value)) {
      setOpen(true);
    } else {
      setter(value);
    }
  }, [setter]);

  const onContinue = useCallback(() => {
    setter('');
    setOpen(false);
  }, [setter]);

  return { open, handleChange, onContinue };
}

/**
 * Variant that guards many fields with a single shared popup.
 *
 * Usage:
 *   const guard = useMultiProfanityGuard();
 *   <Input value={name} onChange={e => guard.handleChange(e.target.value, setName)} />
 *   <Textarea value={notes} onChange={e => guard.handleChange(e.target.value, setNotes)} />
 *   <ProfanityWarningDialog open={guard.open} onContinue={guard.onContinue} />
 */
export function useMultiProfanityGuard() {
  const [open, setOpen] = useState(false);
  const [pendingClear, setPendingClear] = useState(null);

  const handleChange = useCallback((value, setter) => {
    if (containsProfanity(value)) {
      setPendingClear(() => setter);
      setOpen(true);
    } else {
      setter(value);
    }
  }, []);

  const onContinue = useCallback(() => {
    if (pendingClear) pendingClear('');
    setPendingClear(null);
    setOpen(false);
  }, [pendingClear]);

  return { open, handleChange, onContinue };
}

/**
 * Submit-time blanket check across an arbitrary set of strings.
 * Returns true if any string contains profanity.
 *
 * Usage:
 *   if (hasAnyProfanity([name, description, notes])) {
 *     toast.error(tFallback('common.profanity.beforeSaving',
 *       'Please remove inappropriate language before saving.'));
 *     return;
 *   }
 */
export function hasAnyProfanity(...values) {
  const flat = values.flat(Infinity);
  return flat.some(v => typeof v === 'string' && containsProfanity(v));
}