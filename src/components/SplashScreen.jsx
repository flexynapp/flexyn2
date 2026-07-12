import { useEffect, useRef } from "react";

/**
 * Flexyn opening animation: self-drawing reveal -> ignite -> settle.
 *
 * Ported verbatim (shape + palette) from the Flexyn logo-reveal export.
 * Pure inline SVG + CSS keyframes, no animation libraries.
 *
 * Behaviour:
 *  - Plays ONCE, then fades out and calls onComplete().
 *  - Respects prefers-reduced-motion (skips straight to the lit mark).
 *  - Guarantees a minimum on-screen time so it never "flashes" if the app
 *    behind it is already ready.
 *
 * Props:
 *  - onComplete: () => void   called once, after the fade-out finishes.
 *  - background:  string      full-bleed backdrop colour (default near-black).
 *  - drawMs:      number      length of the draw+ignite+settle animation.
 */
export default function SplashScreen({
  onComplete,
  background = "#12161B",
  drawMs = 1700,
}) {
  const doneRef = useRef(false);

  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // We draw + ignite + hold on the lit mark, then signal completion. The
  // splash does NOT fade itself out: LaunchSplash owns a single crossfade
  // of the whole overlay (lit logo + backdrop) onto the live app beneath.
  // Self-fading here would drop the logo to a solid backdrop first, then
  // crossfade the solid color — a visible two-step with a flat hold in
  // between instead of one smooth handoff to the dashboard.
  useEffect(() => {
    const holdAfterAnim = 250; // linger a beat on the lit mark
    const activeMs = prefersReduced ? 450 : drawMs + holdAfterAnim;

    const toDone = setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      onComplete && onComplete();
    }, activeMs);

    return () => clearTimeout(toDone);
  }, [drawMs, prefersReduced, onComplete]);

  const dur = `${drawMs}ms`;

  return (
    <div
      role="img"
      aria-label="Flexyn"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <style>{`
        @keyframes flxDraw   { from { stroke-dashoffset: 1; } 55% { stroke-dashoffset: 0; } to { stroke-dashoffset: 0; } }
        @keyframes flxGray   { 0%,52% { opacity: 1; } 72%,100% { opacity: 0; } }
        @keyframes flxFire   { 0%,52% { opacity: 0; } 72%,100% { opacity: 1; } }
        @keyframes flxSettle { 0%,72% { transform: scale(1); } 79% { transform: scale(1.035); } 88%,100% { transform: scale(1); } }

        .flx-splash .flx-draw   { animation: flxDraw   ${dur} cubic-bezier(.45,.05,.35,1) both; }
        .flx-splash .flx-g      { animation: flxGray   ${dur} linear both; }
        .flx-splash .flx-f      { animation: flxFire   ${dur} linear both; }
        .flx-splash .flx-lockup { animation: flxSettle ${dur} linear both; will-change: transform; }

        @media (prefers-reduced-motion: reduce) {
          .flx-splash .flx-draw   { stroke-dashoffset: 0; animation: none; }
          .flx-splash .flx-g      { opacity: 0; animation: none; }
          .flx-splash .flx-f      { opacity: 1; animation: none; }
          .flx-splash .flx-lockup { transform: none; animation: none; }
        }
      `}</style>

      <div className="flx-splash">
        <div
          className="flx-lockup"
          style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <svg
            width="200"
            height="200"
            viewBox="0 0 100 100"
            style={{ display: "block", overflow: "visible", maxWidth: "40vw", maxHeight: "40vw" }}
          >
            <defs>
              <linearGradient id="flxFire" x1="0" y1="26" x2="0" y2="73" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#FFD27A" />
                <stop offset="30%" stopColor="#FB9D38" />
                <stop offset="62%" stopColor="#F2700D" />
                <stop offset="100%" stopColor="#C2410C" />
              </linearGradient>
              <linearGradient id="flxGray" x1="0" y1="26" x2="0" y2="73" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#949AA3" />
                <stop offset="100%" stopColor="#565D67" />
              </linearGradient>
              <mask id="flxReveal" maskContentUnits="userSpaceOnUse">
                <path
                  className="flx-draw"
                  d="M 22.4 53.6 C 24.0 54.3 25.6 55.1 26.63 55.73 C 26.74 55.55 27.05 55.00 27.26 54.63 C 27.47 54.27 27.59 54.09 27.89 53.52 C 28.20 52.96 28.67 52.00 29.10 51.25 C 29.53 50.50 29.98 49.75 30.46 49.02 C 30.94 48.29 31.45 47.56 31.98 46.86 C 32.52 46.16 33.07 45.46 33.67 44.80 C 34.28 44.15 34.91 43.52 35.60 42.95 C 36.28 42.38 37.01 41.84 37.78 41.38 C 38.54 40.93 39.35 40.53 40.18 40.20 C 41.01 39.86 41.87 39.60 42.74 39.37 C 43.61 39.14 44.51 38.97 45.42 38.83 C 46.32 38.69 47.25 38.61 48.18 38.54 C 49.11 38.46 50.06 38.44 50.99 38.36 C 51.92 38.28 52.85 38.20 53.76 38.07 C 54.66 37.94 55.57 37.79 56.45 37.59 C 57.32 37.39 58.20 37.16 59.02 36.84 C 59.85 36.53 60.63 36.13 61.40 35.73 C 62.17 35.32 62.90 34.82 63.64 34.41 C 64.39 33.99 65.18 33.49 65.85 33.21 C 66.52 32.93 67.14 32.75 67.66 32.73 C 68.18 32.71 68.62 32.82 68.98 33.10 C 69.35 33.38 69.65 33.83 69.85 34.39 C 70.06 34.95 70.19 35.69 70.20 36.47 C 70.21 37.26 70.06 38.23 69.90 39.11 C 69.75 39.98 69.52 40.88 69.27 41.73 C 69.01 42.58 68.72 43.41 68.37 44.20 C 68.02 45.00 67.64 45.77 67.19 46.50 C 66.75 47.23 66.25 47.92 65.70 48.58 C 65.16 49.23 64.56 49.85 63.93 50.41 C 63.29 50.97 62.61 51.49 61.89 51.96 C 61.18 52.44 60.42 52.86 59.63 53.24 C 58.85 53.62 58.03 53.95 57.20 54.25 C 56.36 54.55 55.50 54.80 54.63 55.04 C 53.77 55.27 52.88 55.46 51.98 55.64 C 51.09 55.82 50.19 55.97 49.29 56.13 C 48.38 56.29 47.47 56.42 46.57 56.58 C 45.67 56.74 44.77 56.90 43.89 57.10 C 43.01 57.31 42.13 57.52 41.27 57.80 C 40.42 58.07 39.58 58.38 38.77 58.75 C 37.97 59.13 37.19 59.56 36.45 60.05 C 35.71 60.54 35.00 61.09 34.35 61.69 C 33.70 62.28 33.09 62.94 32.56 63.64 C 32.03 64.34 31.61 65.15 31.15 65.87 C 30.69 66.60 30.25 67.31 29.81 67.99 C 29.36 68.67 28.80 69.44 28.49 69.94 C 28.18 70.45 28.13 70.68 27.95 71.02 C 27.76 71.36 27.47 71.82 27.38 71.98"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="11"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength="1"
                  strokeDasharray="1 1"
                />
              </mask>
            </defs>

            <path
              className="flx-g"
              mask="url(#flxReveal)"
              fill="url(#flxGray)"
              d="M 67.99 25.8 L 73.93 25.8 L 73.93 40.72 L 73.63 41.01 L 73.63 42.46 L 72.41 46.23 L 70.88 49.13 L 68.14 52.61 L 63.87 56.09 L 58.99 58.41 L 58.08 58.41 L 56.55 58.99 L 55.03 58.99 L 54.73 59.28 L 45.58 59.28 L 44.97 59.57 L 43.45 59.57 L 40.09 60.72 L 37.2 62.61 L 33.99 66.23 L 32.47 69.71 L 32.16 73.19 L 25.61 73.19 L 25.91 68.99 L 26.22 68.7 L 26.52 66.67 L 28.05 63.48 L 30.79 60 L 34.91 56.38 L 37.2 55.07 L 37.8 55.07 L 41.16 53.62 L 44.51 53.33 L 44.82 53.04 L 53.66 53.04 L 55.49 52.75 L 59.15 51.45 L 61.43 50 L 64.63 46.67 L 66.46 43.48 L 67.07 41.74 L 67.07 40.58 L 67.38 40.29 L 67.38 36.09 L 67.07 35.94 L 65.85 37.1 L 62.04 39.57 L 58.08 41.01 L 55.34 41.3 L 55.03 41.59 L 45.58 41.59 L 41.62 42.46 L 37.8 44.64 L 35.37 46.96 L 33.38 50 L 32.62 53.04 L 28.05 55.94 L 25.61 58.12 L 25.61 53.62 L 25.91 53.33 L 26.22 50.43 L 28.05 46.09 L 30.95 42.17 L 35.67 38.26 L 37.8 37.1 L 41.16 35.94 L 43.6 35.65 L 43.9 35.36 L 55.64 35.07 L 60.67 33.62 L 64.18 31.45 L 66.01 29.71 Z"
            />
            <path
              className="flx-f"
              mask="url(#flxReveal)"
              fill="url(#flxFire)"
              d="M 67.99 25.8 L 73.93 25.8 L 73.93 40.72 L 73.63 41.01 L 73.63 42.46 L 72.41 46.23 L 70.88 49.13 L 68.14 52.61 L 63.87 56.09 L 58.99 58.41 L 58.08 58.41 L 56.55 58.99 L 55.03 58.99 L 54.73 59.28 L 45.58 59.28 L 44.97 59.57 L 43.45 59.57 L 40.09 60.72 L 37.2 62.61 L 33.99 66.23 L 32.47 69.71 L 32.16 73.19 L 25.61 73.19 L 25.91 68.99 L 26.22 68.7 L 26.52 66.67 L 28.05 63.48 L 30.79 60 L 34.91 56.38 L 37.2 55.07 L 37.8 55.07 L 41.16 53.62 L 44.51 53.33 L 44.82 53.04 L 53.66 53.04 L 55.49 52.75 L 59.15 51.45 L 61.43 50 L 64.63 46.67 L 66.46 43.48 L 67.07 41.74 L 67.07 40.58 L 67.38 40.29 L 67.38 36.09 L 67.07 35.94 L 65.85 37.1 L 62.04 39.57 L 58.08 41.01 L 55.34 41.3 L 55.03 41.59 L 45.58 41.59 L 41.62 42.46 L 37.8 44.64 L 35.37 46.96 L 33.38 50 L 32.62 53.04 L 28.05 55.94 L 25.61 58.12 L 25.61 53.62 L 25.91 53.33 L 26.22 50.43 L 28.05 46.09 L 30.95 42.17 L 35.67 38.26 L 37.8 37.1 L 41.16 35.94 L 43.6 35.65 L 43.9 35.36 L 55.64 35.07 L 60.67 33.62 L 64.18 31.45 L 66.01 29.71 Z"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
