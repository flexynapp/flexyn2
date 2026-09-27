// src/components/skins/halloween/Ghost.jsx
//
// The Halloween skin's `EmptyAccent`: a small ghost that bobs at the corner
// of every EmptyState icon. Card-coloured body with an ink outline so it
// reads on both light and dark.

export default function Ghost({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" className={`hw-dangle ${className}`} aria-hidden="true">
      <path
        d="M12 2C6.5 2 4 6 4 11v10l2.7-2 2.6 2 2.7-2 2.7 2 2.6-2 2.7 2V11C20 6 17.5 2 12 2Z"
        fill="hsl(var(--card))"
        stroke="hsl(var(--foreground) / 0.7)"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <ellipse cx="9.4" cy="10.5" rx="1.3" ry="1.8" fill="hsl(var(--foreground))" />
      <ellipse cx="14.6" cy="10.5" rx="1.3" ry="1.8" fill="hsl(var(--foreground))" />
      <ellipse cx="12" cy="15" rx="1.4" ry="1" fill="hsl(var(--foreground) / 0.6)" />
    </svg>
  );
}
