import React from 'react';
import {
  Flame, Drumstick, Wheat, Droplet, Leaf, HeartPulse,
  Magnet, Nut, Milk, Banana, Carrot, Citrus, Sun, Pill,
} from 'lucide-react';

/**
 * Per-nutrient glyphs for the Nutrition page.
 *
 * Every tile in the Nutritional Values / Vitamins & Minerals cards and in
 * the Log Meal form reads the SAME icon from here, so a nutrient looks
 * identical wherever it appears — the tile you read and the field you type
 * into are recognisably the same thing.
 *
 * Lucide covers most of these. Sodium (salt shaker), sugar (sugar cube) and
 * the Log Meal plate have no lucide equivalent, so they're drawn below in
 * lucide's own house style — 24x24 viewBox, no fill, `currentColor` stroke,
 * width 2, round caps and joins — so they sit at the same visual weight as
 * their neighbours and inherit the tile's text colour like the rest.
 */

/* Shared <svg> shell so the custom glyphs match lucide's attributes exactly. */
function Glyph({ children, className = '', strokeWidth = 2, ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/**
 * Diner salt shaker — domed perforated cap over a squat, flared body.
 *
 * Proportions were picked at the 14px the tiles actually render at: a
 * narrower, taller body read as a vial or a thermometer, so the shaker is
 * deliberately wide and short with a cap band that stays visible when the
 * stroke is only a pixel or two.
 */
export function SaltShakerIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M7.5 9.5V8a4.5 4.5 0 0 1 9 0v1.5" />
      <path d="M6 9.5h12" />
      <path d="M7.2 9.5 6.4 18.2A2.6 2.6 0 0 0 9 21h6a2.6 2.6 0 0 0 2.6-2.8l-.8-8.7" />
      {/* Cap holes — filled dots read cleaner than open circles at 14px. */}
      <circle cx="10" cy="6.4" r=".8" fill="currentColor" stroke="none" />
      <circle cx="14" cy="6.4" r=".8" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** Sugar cube — isometric cube with a grain sparkle on the top face. */
export function SugarCubeIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M12 2.8 20 7.4 12 12 4 7.4Z" />
      <path d="M4 7.4v9.2L12 21.2l8-4.6V7.4" />
      <path d="M12 12v9.2" />
      <circle cx="12" cy="7.4" r=".7" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/**
 * A place setting — fork, plate, knife — as the Log Meal mark.
 *
 * The plate alone is two concentric circles, which is the same shape as the
 * target icon on this page's "Edit Goals" control; the flanking utensils are
 * what keep the two from reading as each other. A third fork tine and a
 * closed knife blade were both tried and both blur into a blob at 16px, so
 * the fork is two tines and the knife is a line with a single-sided edge.
 */
export function MealPlateIcon(props) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12.8" r="6.4" />
      <circle cx="12" cy="12.8" r="2.5" />
      <path d="M3.2 3v4a1.6 1.6 0 0 0 3.2 0V3" />
      <path d="M4.8 8.6V21" />
      <path d="M19.4 3v18" />
      <path d="M19.4 3c1.3 1.7 1.3 4.4 0 6.1" />
    </Glyph>
  );
}

/**
 * nutrient column key -> icon component.
 *
 * Keys are the database column names the nutrition cards already index by
 * (`sodium_mg`, `vitamin_c_mg`, …) so a tile can look its icon up with the
 * field key it already has, with no second mapping to keep in sync.
 */
export const NUTRIENT_ICONS = {
  // Macros
  calories:        Flame,       // energy
  protein_g:       Drumstick,   // meat
  carbs_g:         Wheat,       // grain
  fat_g:           Droplet,     // oil
  sodium_mg:       SaltShakerIcon,
  fiber_g:         Leaf,        // greens
  sugar_g:         SugarCubeIcon,
  cholesterol_mg:  HeartPulse,  // cardiovascular
  // Minerals
  iron_mg:         Magnet,      // metal
  magnesium_mg:    Nut,         // nuts + seeds
  calcium_mg:      Milk,        // dairy
  potassium_mg:    Banana,      // the canonical potassium food
  // Vitamins
  vitamin_a_iu:    Carrot,
  vitamin_c_mg:    Citrus,
  vitamin_d_iu:    Sun,         // sunlight
  vitamin_b12_mcg: Pill,        // most commonly supplemented
};

/**
 * Renders the glyph for `nutrientKey`, or nothing if the key is unknown —
 * a new nutrient column shows up without an icon rather than crashing the
 * card it lives in.
 */
export default function NutrientIcon({ nutrientKey, className = 'w-4 h-4', ...props }) {
  const Icon = NUTRIENT_ICONS[nutrientKey];
  if (!Icon) return null;
  return <Icon className={className} aria-hidden="true" {...props} />;
}
