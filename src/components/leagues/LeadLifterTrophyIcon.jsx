// src/components/leagues/LeadLifterTrophyIcon.jsx
//
// The Lead Lifter trophy: the top lifter of a league level ("Gold III Lead
// Lifter, Week 40") or of a whole league ("Gold Lead Lifter, Week 40").
// Only one person holds each one a week, so it is drawn as a prestige piece.
//
// It is a sibling of the league crest (LeagueTierIcon), built the same way:
// the league's palette, flat facets lit from the upper left (no gradients),
// rim-coloured outlines, the same pips, laurel, rosette and star finial.
// What makes it a cup rather than a crest:
//
//   lip and a beaded band      the rim of a cast cup
//   fluted base on the bowl    gadroons, the lobes on a silver trophy
//   a medallion on the front   carrying the league's own mark:
//                              bronze one chevron, silver two, gold a star,
//                              platinum a spiked star, diamond a cut stone,
//                              legend a crown
//   scroll handles, a knopped stem, a stepped foot and a nameplate
//
// Level trophy: the nameplate carries the level as pips (I to IV), exactly
// like the crest's ribbon, so it needs no numeral to translate.
// League trophy (best across all four levels): the cup stands inside the
// crest's laurel with its star finial above, and a bar on the nameplate.

import React, { useId } from 'react';
import { getTier } from '@/lib/leagueTiers';
import { PALETTES, chevron, STAR, Laurel, FINIAL } from '@/components/leagues/LeagueTierIcon';

const BOWL = 'M15.5 9.5 H48.5 V16 C48.5 27 42 35 32 37.2 C22 35 15.5 27 15.5 16 Z';
const BOWL_L = 'M15.5 9.5 H32 V37.2 C22 35 15.5 27 15.5 16 Z';
const BOWL_R = 'M48.5 9.5 H32 V37.2 C42 35 48.5 27 48.5 16 Z';
const HANDLE_L = 'M16 12 C4.5 10.5 3.5 23.5 11 27.5 C15 29.5 18.5 26.5 16.8 23.8';
const HANDLE_R = 'M48 12 C59.5 10.5 60.5 23.5 53 27.5 C49 29.5 45.5 26.5 47.2 23.8';

// The league's mark, sized to sit on the medallion at (32, 19.5).
function Mark({ tier, p }) {
  const at = (cx, cy, k) => `translate(32 18.5) scale(${k}) translate(${-cx} ${-cy})`;
  const ink = { fill: p.ink, stroke: p.rim, strokeLinejoin: 'round' };
  switch (tier) {
    case 'bronze':
      return <path d={chevron(25)} transform={at(32, 31, 0.5)} {...ink} strokeWidth="2" />;
    case 'silver':
      return (
        <g transform={at(32, 30.5, 0.42)}>
          <path d={chevron(19)} {...ink} strokeWidth="2.2" />
          <path d={chevron(30)} {...ink} strokeWidth="2.2" />
        </g>
      );
    case 'gold':
      return <path d={STAR} transform={at(32, 30.5, 0.52)} {...ink} strokeWidth="2" />;
    case 'platinum':
      return (
        <g transform={at(32, 27, 0.46)}>
          <path d="M32 9 L35 15.5 L32 18 L29 15.5 Z" {...ink} strokeWidth="2" />
          <path d={STAR} {...ink} strokeWidth="2" />
        </g>
      );
    case 'diamond':
      return (
        <g transform={at(32, 34, 0.33)}>
          <path d="M21 17 H43 L50 27 L32 54 L14 27 Z" fill={p.ink} />
          <path d="M14 27 H32 V54 Z" fill={p.light} />
          <path d="M21 17 H43 L50 27 L32 54 L14 27 Z M14 27 H50 M27 27 L32 54 L37 27" fill="none" stroke={p.rim} strokeWidth="2.6" strokeLinejoin="round" />
        </g>
      );
    default: // legend
      return (
        <g transform={at(32, 14, 0.4)}>
          <path d="M19 23 L16 8 L24.5 15 L32 4 L39.5 15 L48 8 L45 23 Z" fill={p.crown} />
          <path d="M32 4 L39.5 15 L48 8 L45 23 H32 Z" fill={p.crownDark} />
          <path d="M19 23 L16 8 L24.5 15 L32 4 L39.5 15 L48 8 L45 23 Z" fill="none" stroke={p.rim} strokeWidth="2.6" strokeLinejoin="round" />
        </g>
      );
  }
}

/** The trophy for a league tier. `level` 1 to 4 for a level trophy, null
 *  for the whole league. Decorative: the name is always in text beside it
 *  or in the button's label. */
export default function LeadLifterTrophyIcon({ tier, level = null, className = 'w-8 h-8', ...rest }) {
  const clip = useId().replace(/:/g, '');
  const id = PALETTES[tier] ? tier : 'bronze';
  const p = { ...PALETTES[id], mid: getTier(id).color };
  const lv = level ? Math.min(4, Math.max(1, Math.round(Number(level)))) : 0;
  const whole = lv === 0;
  const pips = Array.from({ length: lv }, (_, i) => 32 + (i - (lv - 1) / 2) * 6);
  const outline = { fill: 'none', stroke: p.rim, strokeLinejoin: 'round' };

  return (
    // Framed tighter than the crest: a cup is narrower than a winged shield
    // and would read small in the same box. The league cup keeps the crest's
    // frame, for its laurel and finial.
    <svg viewBox={whole ? '-8 -9 80 80' : '2 1 60 60'} className={className} aria-hidden="true" focusable="false" {...rest}>
      <defs>
        <clipPath id={clip}><path d={BOWL} /></clipPath>
      </defs>

      {whole && <Laurel p={p} />}

      {/* Scroll handles: a rim-coloured casting with the metal inside. */}
      <path d={HANDLE_L} fill="none" stroke={p.rim} strokeWidth="4.8" strokeLinecap="round" />
      <path d={HANDLE_L} fill="none" stroke={p.light} strokeWidth="2.2" strokeLinecap="round" />
      <path d={HANDLE_R} fill="none" stroke={p.rim} strokeWidth="4.8" strokeLinecap="round" />
      <path d={HANDLE_R} fill="none" stroke={p.dark} strokeWidth="2.2" strokeLinecap="round" />

      {/* Stem with a knop, then a stepped foot. */}
      <path d="M29 36.5 H35 L33.6 45 H30.4 Z" fill={p.dark} {...{ stroke: p.rim }} strokeWidth="1.2" strokeLinejoin="round" />
      <ellipse cx="32" cy="41" rx="4.6" ry="2.1" fill={p.mid} stroke={p.rim} strokeWidth="1.1" />
      <path d="M32 38.9 C29.5 38.9 27.4 40 27.4 41 H32 Z" fill={p.light} />
      <path d="M24.5 44.5 H39.5 L42.5 48.5 H21.5 Z" fill={p.mid} stroke={p.rim} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M24.5 44.5 H32 V48.5 H21.5 Z" fill={p.light} opacity="0.6" />

      {/* Bowl, faceted like the crest's shield. */}
      <path d={BOWL_L} fill={p.mid} />
      <path d={BOWL_R} fill={p.dark} />
      {/* Gadroons: the lobed base of the bowl, lit on the left. */}
      <g clipPath={`url(#${clip})`}>
        {[18.5, 24, 29.5, 35, 40.5].map((x, i) => (
          <path
            key={x}
            d={`M${x} 40 C${x - 2.5} 35 ${x - 1.5} 31 ${x + 2.75} 29 C${x + 7} 31 ${x + 8} 35 ${x + 5.5} 40 Z`}
            fill={i < 2 ? p.light : i === 2 ? p.mid : p.dark}
            stroke={p.rim}
            strokeWidth="0.7"
            opacity={0.9}
          />
        ))}
      </g>
      <path d="M19 14 C19 21 20.5 25 23 27" stroke="#FFFFFF" strokeWidth="1.3" strokeLinecap="round" opacity="0.6" fill="none" />
      <path d={BOWL} {...outline} strokeWidth="2" />

      {/* Medallion with the league's mark. */}
      <circle cx="32" cy="18.5" r="7.8" fill={p.rim} />
      <circle cx="32" cy="18.5" r="6.4" fill={p.dark} />
      <path d="M32 12.1 A6.4 6.4 0 0 0 32 24.9 Z" fill={p.mid} />
      <Mark tier={id} p={p} />

      {/* Lip and beaded band. */}
      <path d="M13 5 H51 V9.5 H13 Z" fill={p.light} stroke={p.rim} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M32 5 H51 V9.5 H32 Z" fill={p.mid} opacity="0.55" />
      <path d="M15.5 7 H29" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" opacity="0.85" />
      {[19, 23.5, 28, 32.5, 37, 41.5, 46].map((x) => (
        <circle key={x} cx={x - 0.5} cy="11.3" r="0.95" fill={p.light} stroke={p.rim} strokeWidth="0.5" />
      ))}

      {/* Plinth and nameplate. */}
      <path d="M16 48.5 H48 V57.5 H16 Z" fill={p.dark} stroke={p.rim} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M16 48.5 H32 V57.5 H16 Z" fill={p.mid} opacity="0.55" />
      <path d="M20.5 50.5 H43.5 V55.5 H20.5 Z" fill={p.rim} />
      {whole ? (
        <path d="M24 53 H40" stroke={p.light} strokeWidth="1.2" strokeLinecap="round" />
      ) : pips.map((x) => (
        <path key={x} data-pip="" d={`M${x} 50.9 L${x + 2.1} 53 L${x} 55.1 L${x - 2.1} 53 Z`} fill={p.ink} />
      ))}

      {whole && <path d={FINIAL} fill={p.light} stroke={p.rim} strokeWidth="1.2" strokeLinejoin="round" />}
    </svg>
  );
}
