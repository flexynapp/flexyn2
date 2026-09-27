// src/components/onboarding/GoalIcon.jsx
//
// The six goal glyphs drawn for the onboarding brand direction (the "Goal,
// brand icons" board; its assets/icons/goal-*.svg are the source paths).
//
// Each glyph is two-tone: an ACCENT shape (the plates, the flame core, the
// stopwatch sweep) and a line drawing around it. At rest the accent takes
// `--primary` and the lines take the text colour. On a picked card the whole
// glyph inks in `currentColor`, because the card itself is filled with
// primary and an orange accent on an orange card would vanish. That is why
// these are components rather than <img> tags: an image cannot follow the
// card's ink.
//
// Keyed by the GOAL id the onboarding step persists (`lose`, `speed`, ...),
// not by the board's file names, so the caller never needs a second map.

const PATHS = {
  // goal-strength.svg
  strength: {
    accent: (
      <>
        <rect x="10" y="10" width="7" height="28" rx="3.5" />
        <rect x="31" y="10" width="7" height="28" rx="3.5" />
      </>
    ),
    line: (
      <>
        <path d="M3 24H10M17 24H31M38 24H45" />
        <rect x="4.5" y="16" width="5.5" height="16" rx="2.75" />
        <rect x="38" y="16" width="5.5" height="16" rx="2.75" />
      </>
    ),
  },
  // goal-muscle.svg
  muscle: {
    accent: <path d="M31.5 23C30 13.5 19 11 13.5 17C10.5 20.5 9 28 4.5 29.5V35.5C14 35.5 26 34.5 31.5 29Z" />,
    line: (
      <>
        <path d="M4.5 42H27C35.5 42 40.5 37 40 29L39.3 16" />
        <path d="M31.5 16V23C30 13.5 19 11 13.5 17C10.5 20.5 9 28 4.5 29.5" />
      </>
    ),
    solid: <rect x="29" y="4.5" width="12.5" height="12" rx="5" />,
  },
  // goal-fat.svg
  lose: {
    accent: <path d="M24.5 42C19.8 42 17 38.8 17 35C17 30.5 21 28.6 22.5 23.5C27.5 26.5 31.5 30.5 31.5 35.2C31.5 39 28.8 42 24.5 42Z" />,
    line: <path d="M24 44.5C15 44.5 9.5 38.5 9.5 31C9.5 21.5 18 17.5 19.5 4C25.5 8 28.5 13.5 28 19.5C30 18 31.2 15.5 31.5 12.5C37.5 17 39.5 24 39.5 30.5C39.5 38.5 33.5 44.5 24 44.5Z" />,
  },
  // goal-fast.svg
  speed: {
    accent: <path d="M24 28V16.5A11.5 11.5 0 0 1 34.6 32.4Z" />,
    line: (
      <>
        <circle cx="24" cy="28" r="16" />
        <path d="M19 4.5H29M24 4.5V12" />
        <path d="M38 12.5L40.5 10" />
      </>
    ),
  },
  // goal-far.svg
  endurance: {
    accent: <path d="M36 5L45 8.8L36 12.6Z" />,
    line: (
      <>
        <path d="M8 41C19 41 20 33 22 28C24 22.5 27 20.5 36 20.5" />
        <path d="M36 5V21" />
      </>
    ),
    solid: <circle cx="8" cy="41" r="3.5" />,
  },
  // goal-move.svg
  mobility: {
    accent: <circle cx="10" cy="37" r="6" />,
    line: (
      <>
        <path d="M10 37H43" />
        <path d="M10 37L24.5 9" />
      </>
    ),
    dotted: <path d="M33.8 33.6A24 24 0 0 0 24.1 17.6" />,
  },
};

export const GOAL_ICON_IDS = Object.keys(PATHS);

export default function GoalIcon({ id, picked = false, size = 40 }) {
  const p = PATHS[id];
  if (!p) return null;
  const accent = picked ? 'currentColor' : 'hsl(var(--primary))';
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true"
      data-goal-icon={id} className="block shrink-0">
      <g fill={accent}>{p.accent}</g>
      <g stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">{p.line}</g>
      {p.solid && <g fill="currentColor">{p.solid}</g>}
      {p.dotted && (
        <g stroke="currentColor" strokeWidth="3" strokeDasharray="0.01 4.6" strokeLinecap="round">{p.dotted}</g>
      )}
    </svg>
  );
}
