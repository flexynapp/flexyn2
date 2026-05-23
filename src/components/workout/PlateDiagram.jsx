// src/components/workout/PlateDiagram.jsx
//
// Renders a stylized barbell with color-coded plates — the visual
// equivalent of "2×45 + 1×25 per side." Most gym apps (Strong, Hevy,
// Jefit) show this; far more intuitive than text math when you're
// loading the bar.
//
// Plates are drawn as horizontal rectangles stacked outward from the
// sleeve. Heavier plates render larger; colors match the standard
// Olympic plate color convention (red 55, blue 45, yellow 35, etc.).
//
// Pure presentational — accepts the already-computed per-side array
// from platesPerSide(target, bar) and the bar weight for the label.

import React from 'react';

const PLATE_STYLE = {
  55:  { color: '#dc2626', h: 56 }, // red
  45:  { color: '#2563eb', h: 56 }, // blue
  35:  { color: '#eab308', h: 46 }, // yellow
  25:  { color: '#16a34a', h: 38 }, // green
  20:  { color: '#fff', h: 38 },    // white
  15:  { color: '#fff', h: 32 },    // white-ish small
  10:  { color: '#f5f5f5', h: 30 },
  5:   { color: '#94a3b8', h: 22 },
  2.5: { color: '#64748b', h: 16 },
  1.25:{ color: '#475569', h: 12 },
};

function plateMeta(weight) {
  return PLATE_STYLE[weight] || { color: '#475569', h: 18 };
}

export default function PlateDiagram({ plates = [], barLbs = 45 }) {
  if (!Array.isArray(plates) || plates.length === 0) return null;
  // Expand the per-side groups into a flat list of plate weights,
  // heaviest first (already the input order).
  const flat = [];
  for (const { count, plate } of plates) {
    for (let i = 0; i < count; i += 1) flat.push(plate);
  }
  if (flat.length === 0) return null;

  const PLATE_WIDTH = 8;
  const PLATE_GAP   = 2;
  const SLEEVE_W    = 10;
  const BAR_H       = 4;
  const SVG_H       = 72;

  // Each side gets the same plate stack, mirrored. Center is the bar.
  const sideWidth = flat.length * (PLATE_WIDTH + PLATE_GAP);
  const totalWidth = (sideWidth * 2) + SLEEVE_W * 2 + 60; // 60 = collar/grip

  return (
    <div className="mt-1 pl-8 flex items-center gap-2">
      <svg width={totalWidth} height={SVG_H} viewBox={`0 0 ${totalWidth} ${SVG_H}`} role="img" aria-label={`Bar loaded with ${flat.map(p => p + ' lb').join(', ')} per side`}>
        {/* Bar (horizontal line through center) */}
        <rect x="0" y={SVG_H / 2 - BAR_H / 2} width={totalWidth} height={BAR_H} fill="#9ca3af" rx="1" />
        {/* Center grip — wider band for visual anchor */}
        <rect x={totalWidth / 2 - 28} y={SVG_H / 2 - 5} width="56" height="10" fill="#6b7280" rx="2" />
        {/* Left-side plates (heaviest closest to grip) */}
        {flat.map((w, i) => {
          const meta = plateMeta(w);
          const xOffset = totalWidth / 2 - 30 - SLEEVE_W - (i + 1) * (PLATE_WIDTH + PLATE_GAP);
          return (
            <g key={`L${i}`}>
              <rect
                x={xOffset}
                y={SVG_H / 2 - meta.h / 2}
                width={PLATE_WIDTH}
                height={meta.h}
                fill={meta.color}
                stroke="#0f172a"
                strokeWidth="0.5"
                rx="1"
              />
            </g>
          );
        })}
        {/* Right-side plates (mirror) */}
        {flat.map((w, i) => {
          const meta = plateMeta(w);
          const xOffset = totalWidth / 2 + 30 + SLEEVE_W + i * (PLATE_WIDTH + PLATE_GAP);
          return (
            <g key={`R${i}`}>
              <rect
                x={xOffset}
                y={SVG_H / 2 - meta.h / 2}
                width={PLATE_WIDTH}
                height={meta.h}
                fill={meta.color}
                stroke="#0f172a"
                strokeWidth="0.5"
                rx="1"
              />
            </g>
          );
        })}
      </svg>
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {plates.map(({ count, plate }) => `${count}×${plate}`).join(' + ')} · {barLbs} bar
      </span>
    </div>
  );
}
