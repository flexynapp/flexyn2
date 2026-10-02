// src/components/capsules/parts.jsx
//
// Small drawn pieces the capsule and market screens share: the notched plate
// corner. (The set bar that lived here went 2026-10-02; the odds list on
// Capsules and the rarity rows on the Sticker set page replaced it.)

/**
 * The notched corner on a sticker plate: the bottom right corner cut away and
 * folded, as if the plate were a stamped tag. Place inside a `relative` plate.
 */
export function NotchedCorner() {
  return (
    <svg
      width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"
      className="absolute -end-px -bottom-px rtl:scale-x-[-1]"
    >
      <path d="M28 0V14A14 14 0 0 1 14 28H0Z" fill="hsl(var(--background))" />
      <path d="M28 0L0 28H13A15 15 0 0 0 28 13Z" fill="hsl(var(--border))" />
      <path d="M28 0L0 28" stroke="hsl(var(--muted-foreground) / 0.35)" strokeWidth="1" />
    </svg>
  );
}
