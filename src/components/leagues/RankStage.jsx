// src/components/leagues/RankStage.jsx
//
// The rank up's own effects layer: the sunburst that turns behind the crest
// and the host the capsule stage's bursts (rings, sparks, flash) are thrown
// into. It used to be the capsule opener's OpenerStage, and the rank up was
// approved with that look. The capsule open has since replaced its sunburst
// with its own colour field, so the rank up keeps the sunburst here rather
// than render the capsule's field over its own LeagueFluid.
//
// It binds to the refs `useOpenerFx()` hands out (layerRef for the hit
// point, sparkRef for the bursts), so fx.aimAt and fx.burst work unchanged.
// Every animation is transform or opacity, as in openFx.

import { useCallback, useEffect, useMemo, useRef } from 'react';

const BONE = '#F5F2F0';

// Wedges from a centre point, drawn once and turned slowly with a CSS
// animation. Sized in vmax so it always overfills the screen.
function wedges(n, widthDeg) {
  const out = [];
  const r = 150;
  for (let i = 0; i < n; i++) {
    const a0 = ((i * 360) / n - widthDeg / 2) * (Math.PI / 180);
    const a1 = ((i * 360) / n + widthDeg / 2) * (Math.PI / 180);
    out.push(`M0 0L${(Math.cos(a0) * r).toFixed(2)} ${(Math.sin(a0) * r).toFixed(2)}L${(Math.cos(a1) * r).toFixed(2)} ${(Math.sin(a1) * r).toFixed(2)}Z`);
  }
  return out.join('');
}
const RAYS_MAIN = wedges(16, 11);
const RAYS_BACK = wedges(10, 5);

/** The sunburst's handle: its ref and a setter for colour and strength. */
export function useRankRays() {
  const raysRef = useRef(null);
  /** Colour and strength of the sunburst. `double` adds the back layer. */
  const setRays = useCallback((color, opacity, { double = false, fast = false } = {}) => {
    const rays = raysRef.current;
    if (!rays) return;
    rays.style.color = color || BONE;
    rays.style.opacity = String(opacity || 0);
    rays.dataset.double = double ? '1' : '0';
    rays.dataset.fast = fast ? '1' : '0';
  }, []);
  // Stable, so effects that list it as a dependency do not re-run.
  return useMemo(() => ({ raysRef, setRays }), [setRays]);
}

/** The layer itself. Render once, above the backdrop and below the content. */
export default function RankStage({ fx, rays }) {
  // Park the centre somewhere sensible before the first measurement.
  useEffect(() => {
    const layer = fx.layerRef.current;
    if (!layer) return;
    if (!layer.style.getPropertyValue('--fx-x')) {
      layer.style.setProperty('--fx-x', '50vw');
      layer.style.setProperty('--fx-y', '35vh');
    }
  }, [fx.layerRef]);

  return (
    <div ref={fx.layerRef} className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div ref={rays.raysRef} className="rank-rays" style={{ opacity: 0 }} data-double="0" data-fast="0">
        <svg className="rank-rays-back" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid slice">
          <path d={RAYS_BACK} fill="currentColor" />
        </svg>
        <svg className="rank-rays-main" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid slice">
          <path d={RAYS_MAIN} fill="currentColor" />
        </svg>
      </div>
      <div ref={fx.sparkRef} className="absolute inset-0" />
    </div>
  );
}
