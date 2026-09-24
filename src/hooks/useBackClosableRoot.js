// src/hooks/useBackClosableRoot.js
//
// Lets a Radix Dialog / AlertDialog Root close on the phone's Back gesture.
//
// Before this, only two overlays in the app (AchievementsVault and
// InjuryForm) listened for Back. Every other dialog left the page
// underneath instead of closing: swipe back on an open dialog and you
// were on a different screen with the dialog gone. The shared Root
// wrappers in components/ui call this, so every dialog gets it without
// touching 40 call sites.
//
// Radix roots are used both controlled (`open` + `onOpenChange`) and
// uncontrolled (`defaultOpen` + a Trigger). The hook needs to know the
// open state either way, so it mirrors Radix's own rule: a defined
// `open` prop wins, otherwise we hold the state ourselves.

import { useCallback, useState } from 'react';
import { useOverlayBackButton } from '@/hooks/useOverlayBackButton';

export function useBackClosableRoot({ open: openProp, defaultOpen, onOpenChange }) {
  const controlled = openProp !== undefined;
  const [inner, setInner] = useState(Boolean(defaultOpen));
  const open = controlled ? Boolean(openProp) : inner;

  const handleOpenChange = useCallback((next) => {
    if (!controlled) setInner(next);
    onOpenChange?.(next);
  }, [controlled, onOpenChange]);

  useOverlayBackButton(open, () => handleOpenChange(false));

  return { open, onOpenChange: handleOpenChange };
}

export default useBackClosableRoot;
