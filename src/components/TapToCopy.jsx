// src/components/TapToCopy.jsx
//
// Tap any stat or label to copy its value to the clipboard. The
// pattern other apps (Twitter, Strava, GitHub) use to make number
// flexes one-tap shareable. We use it on PR values, total volume,
// streak counts, etc. — anywhere a user might want to brag in a
// chat without screenshotting.
//
// Usage:
//   <TapToCopy value="1,247 lbs"><span className="font-bold">{volume}</span></TapToCopy>
//
// On tap: writes to clipboard, fires a tiny haptic, surfaces a
// "Copied!" toast. Falls back to a non-clipboard no-op on browsers
// that don't expose navigator.clipboard (rare).

import React from 'react';
import { toast } from '@/lib/toast';
import { triggerHaptic } from '@/lib/haptic';

export default function TapToCopy({ value, label = 'value', children, className = '' }) {
  const handle = async (e) => {
    e?.stopPropagation?.();
    const text = String(value ?? '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      triggerHaptic?.('light');
      toast.success(`Copied ${label}`, { duration: 1200 });
    } catch {
      // Older browsers / insecure context — fall back silently. We
      // don't surface an error because the user can still long-press
      // to select + copy manually.
    }
  };
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={handle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handle(e); } }}
      className={`cursor-pointer select-none active:opacity-70 transition-opacity ${className}`}
      aria-label={`Copy ${label}`}
    >
      {children}
    </span>
  );
}
