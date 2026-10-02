// src/components/stories/StoryCountdownOverlay.jsx
//
// Render-side countdown overlay. Story author attaches:
//   { kind: 'countdown', label, target_iso, x, y }
//
// Viewer sees a pill ticking down to the target. Updates once per
// second so seconds-level countdowns feel live. Past-target shows
// "Now" so the moment lands as a celebration rather than a void.

import React, { useEffect, useState } from 'react';

function format(deltaMs) {
  if (deltaMs <= 0) return 'Now';
  const totalSeconds = Math.floor(deltaMs / 1000);
  const days  = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins  = Math.floor((totalSeconds % 3600) / 60);
  const secs  = totalSeconds % 60;
  if (days > 0)  return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0)  return `${mins}m ${String(secs).padStart(2, '0')}s`;
  return `${secs}s`;
}

export default function StoryCountdownOverlay({ overlay }) {
  const targetMs = overlay?.target_iso ? Date.parse(overlay.target_iso) : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Once we're past the deadline the text is permanently "Now" —
    // there's no need to keep firing setInterval every second forever.
    if (!Number.isFinite(targetMs) || targetMs - Date.now() <= 0) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  if (!Number.isFinite(targetMs)) return null;
  const text = format(targetMs - now);

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${(overlay.x ?? 0.5) * 100}%`,
        top:  `${(overlay.y ?? 0.5) * 100}%`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div className="bg-black/55 backdrop-blur-md border border-white/15 rounded-2xl px-4 py-2 text-center">
        {overlay.label && (
          <p className="kicker text-white/70">
            {overlay.label}
          </p>
        )}
        <p className="text-white text-2xl font-bold tabular-nums leading-tight">
          {text}
        </p>
      </div>
    </div>
  );
}
