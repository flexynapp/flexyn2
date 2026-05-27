// src/components/stories/StoryOverlayRenderer.jsx
//
// Renders persisted overlays on top of a story's base image/video.
// Each overlay carries normalized x/y coords (0..1) so it lands in
// the same spot regardless of viewport aspect ratio.
//
// Supported overlay kinds (mig 111):
//   • emoji   — { kind: 'emoji', emoji, x, y, scale?, rotation? }
//   • text    — { kind: 'text',  text, color?, font?, x, y, scale?, rotation? }
//   • sticker — { kind: 'sticker', label, x, y, scale?, rotation? }
//
// Future-friendly: unknown `kind` values render nothing instead of
// throwing, so a v2 client can ship a new kind without crashing v1
// clients still in the wild.

import React from 'react';
import StoryPollOverlay from './StoryPollOverlay';
import StoryCountdownOverlay from './StoryCountdownOverlay';

const FONT_MAP = {
  normal:  "'Inter', system-ui, sans-serif",
  serious: "Georgia, 'Times New Roman', serif",
  casual:  "'Comic Sans MS', 'Chalkboard SE', cursive",
  pixel:   "'Press Start 2P', monospace",
};

function OverlayItem({ overlay, storyId, userId, isOwn }) {
  const { kind } = overlay || {};
  // Interactive kinds delegate to dedicated components. They handle
  // their own positioning + pointer-events so the static-overlay
  // path below stays simple.
  if (kind === 'poll') {
    return <StoryPollOverlay overlay={overlay} storyId={storyId} userId={userId} isOwn={isOwn} />;
  }
  if (kind === 'countdown') {
    return <StoryCountdownOverlay overlay={overlay} />;
  }
  // Freehand drawing — a full-frame SVG polyline using normalized points.
  // preserveAspectRatio="none" stretches the 0..100 viewBox to the overlay
  // box exactly like the editor frame, and non-scaling-stroke keeps the
  // line a constant pixel width regardless of display size.
  if (kind === 'drawing') {
    const pts = Array.isArray(overlay?.points) ? overlay.points : [];
    if (pts.length < 2) return null;
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${clamp01(p[0]) * 100} ${clamp01(p[1]) * 100}`).join(' ');
    return (
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
        aria-hidden="true"
      >
        <path
          d={d}
          fill="none"
          stroke={overlay.color || '#fff'}
          strokeWidth={Number.isFinite(overlay?.width) ? overlay.width : 4}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  const x = clamp01(overlay?.x);
  const y = clamp01(overlay?.y);
  const scale = Number.isFinite(overlay?.scale) ? overlay.scale : 1;
  const rotation = Number.isFinite(overlay?.rotation) ? overlay.rotation : 0;
  const style = {
    position: 'absolute',
    left: `${x * 100}%`,
    top:  `${y * 100}%`,
    transform: `translate(-50%, -50%) scale(${scale}) rotate(${rotation}deg)`,
    transformOrigin: 'center center',
    pointerEvents: 'none',
    userSelect: 'none',
  };

  if (kind === 'emoji' && overlay.emoji) {
    return <span style={{ ...style, fontSize: 56, lineHeight: 1 }} aria-hidden="true">{overlay.emoji}</span>;
  }
  if (kind === 'text' && overlay.text) {
    return (
      <span
        style={{
          ...style,
          fontSize: 32,
          fontWeight: 700,
          color: overlay.color || '#fff',
          fontFamily: FONT_MAP[overlay.font] || FONT_MAP.normal,
          textShadow: '0 2px 8px rgba(0,0,0,0.45)',
          whiteSpace: 'pre-wrap',
          textAlign: 'center',
          maxWidth: '80%',
        }}
      >
        {overlay.text}
      </span>
    );
  }
  if (kind === 'sticker' && overlay.label) {
    // Placeholder: render the label inside a soft pill until we wire
    // the real sticker assets through. The data shape is forward-
    // compatible — v1 ships the chrome, v2 swaps in the artwork.
    return (
      <span
        style={{
          ...style,
          padding: '4px 12px',
          borderRadius: 999,
          background: 'rgba(255,255,255,0.95)',
          color: '#111',
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        {overlay.label}
      </span>
    );
  }
  return null;
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

export default function StoryOverlayRenderer({ overlays, storyId, userId, isOwn }) {
  if (!Array.isArray(overlays) || overlays.length === 0) return null;
  return (
    <>
      {overlays.map((o, i) => (
        <OverlayItem
          key={`${o?.kind || 'x'}-${i}`}
          overlay={o}
          storyId={storyId}
          userId={userId}
          isOwn={isOwn}
        />
      ))}
    </>
  );
}
