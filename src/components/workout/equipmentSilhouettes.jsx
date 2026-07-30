// src/components/workout/equipmentSilhouettes.jsx
//
// Line-art silhouettes for equipment types — the always-available bottom
// of the image fallback chain, so the picker and the exercise header are
// never blank while a space has no photos yet.
//
// Uses `currentColor` and the same minimal-stroke language as
// src/components/emptyStateIllustrations.jsx, so these tint with the
// surrounding text.
//
// ── Scope, stated honestly ───────────────────────────────────────────
// There are 57 implement types in equipmentCatalog.js. There are NOT 57
// silhouettes here — a recognizably distinct line drawing of a seated
// row vs a high row vs a low row is not something a drawing can carry at
// 36px, and pretending otherwise would just be 57 near-identical boxes.
//
// Instead there are 12 shapes covering visually distinct FAMILIES, and
// SILHOUETTE_FOR maps every implement type onto one. A user who wants to
// see their actual machine uploads a photo — that's the whole point of
// Phase 3, and it's the tier above this one.
//
// No manufacturer imagery, ever. These are generic shapes drawn here.

import React from 'react';

// strokeWidth is deliberately heavy for a 48-unit viewBox. These render
// at 27px inside a 36px thumbnail, so a 1.6 stroke lands under 1 device
// pixel and the shape reads as a grey smudge — checked on screen, not
// assumed. 2.6 survives the downscale and still looks like line art at
// the 56px selected-implement size.
const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 48 48',
  xmlns: 'http://www.w3.org/2000/svg',
};

function Frame({ children, ...rest }) {
  return <svg {...S} {...rest} aria-hidden="true">{children}</svg>;
}

// Pin-stack selectorized machine — seat, back pad, weight column.
export const SelectorizedIcon = (p) => (
  <Frame {...p}>
    <rect x="6" y="10" width="11" height="28" rx="1.5" />
    <path d="M8.5 15h6M8.5 19h6M8.5 23h6M8.5 27h6" />
    <path d="M24 34h13M27 34V22a3 3 0 0 1 3-3h6" />
    <path d="M24 34l3-4" />
    <circle cx="36" cy="19" r="2" />
  </Frame>
);

// Plate-loaded machine — horns with plates on them.
export const PlateLoadedIcon = (p) => (
  <Frame {...p}>
    <path d="M10 38V16h8M10 27h8" />
    <path d="M22 20h10M22 20v10" />
    <ellipse cx="36" cy="20" rx="2.5" ry="7" />
    <ellipse cx="40" cy="20" rx="2" ry="5.5" />
  </Frame>
);

// Leg press — angled sled on rails.
export const LegPressIcon = (p) => (
  <Frame {...p}>
    <path d="M6 38h14l16-16" />
    <path d="M30 16l8 8-5 5-8-8z" />
    <path d="M10 38v-6a4 4 0 0 1 4-4h4" />
    <ellipse cx="39" cy="15" rx="2" ry="5" />
  </Frame>
);

// Cable station — high pulley, cable, handle.
export const CableIcon = (p) => (
  <Frame {...p}>
    <path d="M12 8v32M12 40h16" />
    <circle cx="17" cy="12" r="2.5" />
    <path d="M19.5 13l10 9v6" />
    <path d="M26 28h7M29.5 28v4" />
  </Frame>
);

// Lat pulldown — overhead bar on a cable, seat below.
export const PulldownIcon = (p) => (
  <Frame {...p}>
    <path d="M9 8v32M9 40h14" />
    <circle cx="14" cy="11" r="2" />
    <path d="M16 12h14M30 12v8" />
    <path d="M24 20h13M27 20v-3M34 20v-3" />
    <path d="M20 34h12a3 3 0 0 0 3-3" />
  </Frame>
);

// Smith machine / rack — uprights with a bar across.
export const RackIcon = (p) => (
  <Frame {...p}>
    <path d="M11 8v32M37 8v32M7 40h8M33 40h8" />
    <path d="M8 20h32" />
    <ellipse cx="12" cy="20" rx="1.8" ry="5" />
    <ellipse cx="36" cy="20" rx="1.8" ry="5" />
  </Frame>
);

// Barbell.
export const BarbellIcon = (p) => (
  <Frame {...p}>
    <path d="M8 24h32" />
    <ellipse cx="12" cy="24" rx="2.5" ry="9" />
    <ellipse cx="16" cy="24" rx="2" ry="6.5" />
    <ellipse cx="36" cy="24" rx="2.5" ry="9" />
    <ellipse cx="32" cy="24" rx="2" ry="6.5" />
  </Frame>
);

// Dumbbell.
export const DumbbellIcon = (p) => (
  <Frame {...p}>
    <path d="M16 24h16" />
    <rect x="8" y="17" width="6" height="14" rx="1.5" />
    <rect x="34" y="17" width="6" height="14" rx="1.5" />
    <rect x="14" y="20" width="4" height="8" rx="1" />
    <rect x="30" y="20" width="4" height="8" rx="1" />
  </Frame>
);

// Kettlebell.
export const KettlebellIcon = (p) => (
  <Frame {...p}>
    <path d="M18 18a6 6 0 0 1 12 0" />
    <path d="M18 18c-4 3-6 8-6 13a3 3 0 0 0 3 3h18a3 3 0 0 0 3-3c0-5-2-10-6-13z" />
  </Frame>
);

// Bench.
export const BenchIcon = (p) => (
  <Frame {...p}>
    <path d="M8 22h32v4H8z" />
    <path d="M12 26v12M36 26v12M12 38h6M33 38h6" />
  </Frame>
);

// Resistance band.
export const BandIcon = (p) => (
  <Frame {...p}>
    <path d="M10 30c6-12 22-12 28 0" />
    <path d="M10 30c0 3 2 5 4 5M38 30c0 3-2 5-4 5" />
    <circle cx="10" cy="28" r="2.5" />
    <circle cx="38" cy="28" r="2.5" />
  </Frame>
);

// Cardio machine — treadmill profile.
export const CardioIcon = (p) => (
  <Frame {...p}>
    <path d="M8 36h26l4-14" />
    <rect x="34" y="10" width="8" height="10" rx="1.5" />
    <path d="M10 36l-2 4M32 36l2 4" />
    <path d="M12 32h18" />
  </Frame>
);

// Every implement type maps onto one of the shapes above.
const SILHOUETTE_FOR = {
  // Leg press family
  leg_press: LegPressIcon, hack_squat: LegPressIcon, pendulum_squat: LegPressIcon,
  belt_squat: LegPressIcon,
  // Pulldown family
  lat_pulldown: PulldownIcon, assist_dip_pull: PulldownIcon, pullover: PulldownIcon,
  // Cable family
  cable_station: CableIcon, cable_crossover: CableIcon, functional_trainer: CableIcon,
  // Rack / smith
  smith_machine: RackIcon, rack: RackIcon,
  // Plate-loaded look
  t_bar_row: PlateLoadedIcon, landmine: PlateLoadedIcon,
  // Free weights
  barbell: BarbellIcon, ez_bar: BarbellIcon, trap_bar: BarbellIcon,
  safety_squat_bar: BarbellIcon,
  dumbbell: DumbbellIcon, dumbbell_adj: DumbbellIcon,
  kettlebell: KettlebellIcon,
  bench: BenchIcon,
  band: BandIcon,
  // Cardio
  treadmill: CardioIcon, bike: CardioIcon, rower: CardioIcon,
  elliptical: CardioIcon, stair_climber: CardioIcon, ski_erg: CardioIcon,
};

/**
 * Silhouette component for an implement type. Everything not explicitly
 * mapped is a selectorized machine, which is the correct default — the
 * unmapped types (chest_press, seated_row, leg_extension, pec_deck, the
 * rest) are all pin-stack machines.
 */
export function silhouetteFor(implementType) {
  return SILHOUETTE_FOR[implementType] || SelectorizedIcon;
}

export default function EquipmentSilhouette({ implementType, className = '' }) {
  const Icon = silhouetteFor(implementType);
  return <Icon className={className} />;
}
