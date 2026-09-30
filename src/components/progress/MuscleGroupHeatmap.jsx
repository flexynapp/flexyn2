import React, { useState, useMemo, useEffect, useRef } from 'react';
import { FRONT_GROUPS, BACK_GROUPS } from './muscleAnatomy';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { parseLocalDate } from '@/lib/dateUtils';

/* ============================================================
   FLEXYN · Muscle heat-map  (Body Heat Map design, wired to
   real workout logs)
   Front + back silhouettes, per-muscle heat colouring, tappable
   groups, recovery vs volume modes, 7 / 30 / 90-day ranges.
   ============================================================ */

/* Flexyn logs tag exercises with 9 coarse groups; the anatomy model
   has 14 finer muscles. Map coarse → fine so real training data drives
   the detailed figure (each fine muscle inherits its parent group's
   activity, so e.g. all three back muscles read as hot as "Back" work). */
const COARSE_TO_FINE = {
  Chest: ['chest'], Shoulders: ['shoulders'], Triceps: ['triceps'],
  Biceps: ['biceps'], Forearms: ['forearms'],
  Back: ['lats', 'lowerback', 'traps'],
  Legs: ['quads', 'hamstrings', 'calves'],
  Glutes: ['glutes'], Core: ['abs', 'obliques'],
};
const FINE = {
  chest: ['Chest', 'Push'], shoulders: ['Shoulders', 'Push'], triceps: ['Triceps', 'Push'],
  biceps: ['Biceps', 'Pull'], forearms: ['Forearms', 'Pull'], traps: ['Traps', 'Pull'],
  lats: ['Lats', 'Pull'], lowerback: ['Lower Back', 'Pull'],
  abs: ['Abs', 'Core'], obliques: ['Obliques', 'Core'],
  glutes: ['Glutes', 'Legs'], quads: ['Quads', 'Legs'],
  hamstrings: ['Hamstrings', 'Legs'], calves: ['Calves', 'Legs'],
};
const FINE_IDS = Object.keys(FINE);
const PARENT = {};
Object.entries(COARSE_TO_FINE).forEach(([cg, fs]) => fs.forEach((f) => { PARENT[f] = cg; }));

/* The names above are the ENGLISH data, and they stay that way: buildMuscles
   is exported and tested, and a locale-dependent data layer would mean the
   same log produced different objects for different users. Translation
   happens at render, through these two tables.

   Thirteen of the fourteen muscles already ship in all 15 languages under
   `muscleGroups.*` — eight other surfaces read them there — so this maps to
   that namespace rather than restating it. `lowerback` is the only one with
   no key anywhere, and it is the ONLY string this tab adds to the app's
   muscle vocabulary; see `src/locales/*.json` for how to retire it. */
const MUSCLE_KEY = {
  chest: 'muscleGroups.chest', shoulders: 'muscleGroups.shoulders',
  triceps: 'muscleGroups.triceps', biceps: 'muscleGroups.biceps',
  forearms: 'muscleGroups.forearms', traps: 'muscleGroups.traps',
  lats: 'muscleGroups.lats', lowerback: 'bodyMap.muscle.lowerBack',
  abs: 'muscleGroups.abs', obliques: 'muscleGroups.obliques',
  glutes: 'muscleGroups.glutes', quads: 'muscleGroups.quads',
  hamstrings: 'muscleGroups.hamstrings', calves: 'muscleGroups.calves',
};
/* Push and Pull come from `regions.*` (`src/locales/*.json`), which named them
   for the muscle-group colour encoding. Legs and Core keep their
   `muscleGroups.*` keys — those already ship in 15 languages, where
   `regions.*` is English-only — and `regions.other` is deliberately NOT
   used: it means "core and the things that aren't a push/pull/legs axis",
   which is a remainder bucket. This tab's fourth region is Core exactly. */
const REGION_KEY = {
  Push: 'regions.push', Pull: 'regions.pull',
  Legs: 'muscleGroups.legs', Core: 'muscleGroups.core',
};
/* Both take tFallback rather than calling a hook, so the detail sheet and
   the list can share them without either owning the lookup. The English
   name already on the muscle record is the fallback. */
const muscleName = (tf, m, id) => tf(MUSCLE_KEY[id], m.name);
const regionName = (tf, region) => tf(REGION_KEY[region], region);

/* Three vocabularies reach this component and only one of them is what
   COARSE_TO_FINE is keyed on. The exercise library (ExerciseAutocomplete)
   writes capitalised coarse names — 'Chest', 'Legs'. The AI Coach
   generator writes LOWERCASE ones — 'chest', 'legs' — plus 'arms', which
   is not a coarse group at all. planBuilder writes the odd fine name
   ('Quads'). An unrecognised name was dropped in silence, so every
   Coach-generated session contributed NOTHING to this map, and the
   headline read "0 muscles need recovery" the day after one.

   Normalise on the way IN rather than fixing each writer: those strings
   are persisted in workout_logs.exercises, so renaming them at the source
   is a data migration and would still leave every existing log wrong. */
const COARSE_KEYS = Object.keys(COARSE_TO_FINE);
const GROUP_ALIASES = {
  arms: ['Biceps', 'Triceps'],
  lats: ['Back'], traps: ['Back'], lowerback: ['Back'], 'lower back': ['Back'],
  quads: ['Legs'], quadriceps: ['Legs'], hamstrings: ['Legs'], calves: ['Legs'],
  abs: ['Core'], obliques: ['Core'],
  delts: ['Shoulders'], deltoids: ['Shoulders'],
  // An Olympic lift genuinely does train everything, and the library tags
  // 25 exercises this way — every clean, snatch and jerk was invisible here.
  'full body': COARSE_KEYS, fullbody: COARSE_KEYS,
  // 'Cardio' is deliberately absent: it names no lifting muscle, and its
  // sets carry neither weight nor reps so they're filtered out upstream.
};
const GROUP_LOOKUP = {};
COARSE_KEYS.forEach((k) => { GROUP_LOOKUP[k.toLowerCase()] = [k]; });
Object.entries(GROUP_ALIASES).forEach(([k, v]) => { GROUP_LOOKUP[k] = v; });
const coarseKeysFor = (raw) => GROUP_LOOKUP[String(raw || '').trim().toLowerCase()] || [];

/* The three windows in one place: the id the state holds, the days it
   means, and the two labels it renders under — the chip, and the short form
   the ranked-list kicker and the detail sheet's stat tiles print. The short
   form used to be the raw state id, so '30D' reached the screen untranslated
   in all 15 languages. */
const RANGES = [
  { id: '7D', days: 7, key: 'bodyMap.range.7d', en: '7 days', shortKey: 'bodyMap.rangeShort.7d', shortEn: '7D' },
  { id: '30D', days: 30, key: 'bodyMap.range.30d', en: '30 days', shortKey: 'bodyMap.rangeShort.30d', shortEn: '30D' },
  { id: '90D', days: 90, key: 'bodyMap.range.90d', en: '90 days', shortKey: 'bodyMap.rangeShort.90d', shortEn: '90D' },
];
const RANGE_DAYS = Object.fromEntries(RANGES.map((r) => [r.id, r.days]));

/* Recovery %: 0 right after training → 100 fully rested, ramping smoothly
   over a muscle-size-dependent window (bigger muscles recover slower). An
   untrained muscle (no history) reads fully recovered / fresh. */
const RECOV_DAYS = { Push: 2.5, Pull: 3, Legs: 3.5, Core: 2 };
const recoveryPct = (days, region) => (
  days == null ? 100 : Math.min(100, Math.round((days / (RECOV_DAYS[region] || 3)) * 100))
);

/* A log entry with no name at all. This is a KEY in the top-exercises tally
   and it comes out of an exported, tested function, so it stays a stable
   token rather than a translated string — the sheet swaps it for
   `bodyMap.detail.unnamedExercise` at render. */
export const UNNAMED_EXERCISE = 'Exercise';
const exName = (ex) => ex.name || ex.exercise_name || ex.exercise || UNNAMED_EXERCISE;

/* Build the per-muscle dataset from real logs for the active range.
   Exported for tests: this is the only place the three writer
   vocabularies get reconciled, and a name it fails to recognise costs a
   whole session in silence rather than throwing. */
export function buildMuscles(logs, rangeDays) {
  const now = Date.now();
  const coarse = {};
  Object.keys(COARSE_TO_FINE).forEach((g) => { coarse[g] = { sets: 0, vol: 0, last: null, ex: {} }; });

  (logs || []).forEach((log) => {
    // Local midnight, not UTC: `new Date('2026-09-30')` is midnight UTC, which
    // in the Americas is the previous evening, so a session logged today read
    // as a day old every evening and recovery showed partly recovered.
    const dt = parseLocalDate(log.date);
    if (!dt) return;
    const days = Math.floor((now - dt) / 86400000);
    (log.exercises || []).forEach((ex) => {
      const sets = (ex.sets || []).filter((s) => (Number(s.weight) > 0 || Number(s.reps) > 0));
      if (!sets.length) return;
      const vol = sets.reduce((a, s) => a + (Number(s.weight) || 0) * (Number(s.reps) || 0), 0);
      // `?.length`, not `||` — several writers set muscle_groups to an
      // empty array AND a legacy muscle_group string, and `[]` is truthy,
      // so `||` never reached the fallback and dropped the whole exercise.
      const groups = ex.muscle_groups?.length ? ex.muscle_groups
        : (ex.muscle_group ? [ex.muscle_group] : []);
      // Aliases collapse: ['Legs','Quads'] both resolve to Legs, and
      // crediting that exercise's volume to Legs twice would double it.
      const hit = new Set();
      groups.forEach((g) => coarseKeysFor(g).forEach((k) => hit.add(k)));
      hit.forEach((g) => {
        const c = coarse[g];
        if (!c) return;
        // last-trained is all-time (recovery is a "right now" metric)
        if (c.last == null || dt > c.last) c.last = dt;
        // sets / volume / top exercises use the selected window
        if (days <= rangeDays) {
          c.sets += sets.length;
          c.vol += vol;
          c.ex[exName(ex)] = (c.ex[exName(ex)] || 0) + 1;
        }
      });
    });
  });

  const out = {};
  FINE_IDS.forEach((fid) => {
    const [name, region] = FINE[fid];
    const c = coarse[PARENT[fid]] || { sets: 0, vol: 0, last: null, ex: {} };
    const days = c.last == null ? null : Math.floor((now - c.last) / 86400000);
    const recovery = recoveryPct(days, region);
    const ex = Object.entries(c.ex).sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
    out[fid] = { name, region, sets: c.sets, vol: Math.round(c.vol), last: days, recovery, ex };
  });
  return out;
}

/* ---- Colour ---------------------------------------------- */
/* Recovery is drawn in the three status hues the detail sheet already
   names: ready (success), recovering (primary), needs rest (destructive).
   It was a five-stop rainbow, green through yellow to red, and yellow is
   not a hue this app has. Three bands also match the three words, so the
   colour on the body and the word in the sheet can no longer disagree.

   Volume is one hue, the first chart colour, deeper where more work
   landed. It was a second rainbow (grey, amber, orange, red), which read
   the heaviest-trained muscle as a warning.

   A muscle with nothing logged keeps the plain body colour in both modes.
   It used to read as fully recovered, so an untrained body was all green.
   (Progress audit round 2, 2026-09-30.) */
const STATUS = {
  ready: { k: 'bodyMap.status.ready', en: 'Ready to train', v: '--success' },
  recovering: { k: 'bodyMap.status.recovering', en: 'Recovering', v: '--primary' },
  needsRest: { k: 'bodyMap.status.needsRest', en: 'Needs rest', v: '--destructive' },
};
export const recoveryStatus = (recovery) => (
  recovery >= 75 ? 'ready' : recovery >= 50 ? 'recovering' : 'needsRest'
);
const volumeAlpha = (t) => (0.25 + 0.75 * Math.max(0, Math.min(1, t))).toFixed(2);

const intensityOf = (muscles, id, mode, maxVol) => (
  mode === 'recovery'
    ? (100 - muscles[id].recovery) / 100
    : (maxVol ? muscles[id].vol / maxVol : 0)
);
const colorFor = (muscles, id, mode, maxVol) => {
  const m = muscles[id];
  if (mode === 'recovery') {
    return m.last == null ? 'hsl(var(--mmap-body))' : `hsl(var(${STATUS[recoveryStatus(m.recovery)].v}))`;
  }
  return m.vol > 0 ? `hsl(var(--chart-1) / ${volumeAlpha(intensityOf(muscles, id, mode, maxVol))})` : 'hsl(var(--mmap-body))';
};

/* ============================================================
   SVG figure — neutral body base, then colour-coded tracked
   groups, and crisp guide outlines.

   Everything reads from tokens: the --mmap-* block in index.css
   for the body, and the state and chart tokens for the data, so
   the figure follows the user's light / dark choice.

   These are applied through `style`, NOT as fill/stroke
   presentation attributes: var() is not substituted in a
   presentation attribute, so `fill="hsl(var(--x))"` renders as
   an invalid paint and the shape falls back to black.
   ============================================================ */
const NEUTRAL_FILL = 'hsl(var(--mmap-body))';
const NEUTRAL_STROKE = 'hsl(var(--mmap-body-edge) / 0.5)';
const HEAT_STROKE = 'hsl(var(--mmap-ink) / 0.28)';
const GUIDE_STROKE = 'hsl(var(--mmap-ink) / 0.5)';
const GUIDE_STROKE_ACTIVE = 'hsl(var(--mmap-ink))';
const LEG_GROUPS = new Set(['hamstrings', 'calves']);

/* The figure sizes itself from its own 520:1005 viewBox rather than being
   pinned to a height, and this is a phone fix specifically.

   The slot used to be a flat `height: 430`. At a wide column that is
   right — the figure fits by HEIGHT and fills the box. At a phone column
   it fits by WIDTH instead and then floats in the middle of a box that is
   too tall: measured at a 375px viewport the slot was 157x430 while the
   figure painted 287, leaving 71px dead above AND below. A third of the
   card's figure area was empty on the only widths this app ships to.

   `height: auto` on an SVG with a viewBox takes the intrinsic ratio, so
   the box now ends where the figure does. The cap keeps every wider
   viewport at exactly the scale the design was drawn at — above ~222px of
   column the aspect would ask for more than 430 and `meet` letterboxes
   horizontally instead, which is the old behaviour unchanged. No phone
   reaches that: a 430px Pro Max column works out at 373. */
const FIGURE_MAX_H = 430;

/* The figure is the feature, and until now a screen reader could not reach
   any of it: fourteen `<g onClick>` groups with no role, no name and no tab
   stop, inside an SVG that announced nothing. Colour carried 100% of the
   information and colour cannot be heard.

   Each group is now a real button — role, accessible name, tab stop, and
   Enter/Space — and the three purely decorative layers (the neutral base,
   the top-light, the guide outlines) are hidden from the tree so the same
   body is not announced four times over.

   `labelFor` is passed in rather than computed here because the label has
   to state the muscle's VALUE, and Figure has no access to the dataset —
   it is handed fills, not numbers. */
function Figure({ groups, viewBox, getFill, sel, onSel, vid, mirrorAxis, labelFor, figureLabel }) {
  const mirrorT = mirrorAxis ? `translate(${2 * mirrorAxis},0) scale(-1,1)` : null;
  const legMirror = (grp) => mirrorT && LEG_GROUPS.has(grp.g);
  const allPaths = groups.flatMap((grp) => grp.paths);
  const legPaths = mirrorT ? groups.filter((g) => LEG_GROUPS.has(g.g)).flatMap((g) => g.paths) : [];
  // Space scrolls the page by default, so activating a muscle with it would
  // also jump the view out from under the person who just pressed it.
  const onKey = (e, k, active) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    e.preventDefault();
    e.stopPropagation();
    onSel(active ? null : k);
  };
  return (
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="group" aria-label={figureLabel}
      style={{ width: '100%', height: 'auto', maxHeight: FIGURE_MAX_H, overflow: 'visible' }}>

      {/* 1 · neutral body base */}
      <g aria-hidden="true" style={{ fill: NEUTRAL_FILL, stroke: NEUTRAL_STROKE }} strokeWidth="0.8" strokeLinejoin="round">
        {allPaths.map((d, i) => <path key={i} d={d} />)}
        {mirrorT && <g transform={mirrorT}>{legPaths.map((d, i) => <path key={`mb${i}`} d={d} />)}</g>}
      </g>

      {/* 2 · tracked muscle groups — heat colour + interaction */}
      {groups.map((grp) => {
        const k = grp.g;
        const active = sel === k;
        const dim = sel && !active;
        return (
          <g key={k}
            role="button" tabIndex={0} aria-label={labelFor(k)} aria-expanded={active}
            onClick={(e) => { e.stopPropagation(); onSel(active ? null : k); }}
            onKeyDown={(e) => onKey(e, k, active)}
            style={{
              cursor: 'pointer', opacity: dim ? 0.32 : 1, transition: 'opacity .35s, fill .55s ease',
              fill: getFill(k), stroke: HEAT_STROKE,
            }}
            strokeWidth="0.6" strokeLinejoin="round"
          >
            {grp.paths.map((d, i) => <path key={i} d={d} />)}
            {legMirror(grp) && <g transform={mirrorT}>{grp.paths.map((d, i) => <path key={`m${i}`} d={d} />)}</g>}
          </g>
        );
      })}

      {/* 3 · The white top-light that sat here is gone. It was a gradient
             under `mix-blend-mode: soft-light`, which CLAUDE.md records as
             not surviving iOS Safari, and it was decoration: it shaded the
             colour that carries the data. */}

      {/* 4 · guide outlines per clickable group */}
      <g aria-hidden="true" fill="none" strokeLinejoin="round" style={{ pointerEvents: 'none' }}>
        {groups.map((grp) => {
          const active = sel === grp.g;
          const dim = sel && !active;
          return (
            <g key={grp.g}
              strokeWidth={active ? 3 : 1.3}
              style={{
                stroke: active ? GUIDE_STROKE_ACTIVE : GUIDE_STROKE,
                opacity: dim ? 0.32 : 1, transition: 'opacity .35s, stroke-width .2s',
              }}
            >
              {grp.paths.map((d, i) => <path key={i} d={d} />)}
              {legMirror(grp) && <g transform={mirrorT}>{grp.paths.map((d, i) => <path key={`m${i}`} d={d} />)}</g>}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

const FrontFigure = (p) => <Figure groups={FRONT_GROUPS} viewBox="105 254 520 1005" vid="a" {...p} />;
const BackFigure = (p) => <Figure groups={BACK_GROUPS} viewBox="824 291 520 1005" vid="b" mirrorAxis={1084} {...p} />;

/* ---- small UI atoms -------------------------------------- */
/* House type: the body face at the micro step, in sentence case. It was
   mono at 9.5px in tracked capitals, a type style used nowhere else in the
   app and under the 11px floor. */
function Kicker({ children }) {
  return <div className="text-micro font-semibold text-muted-foreground">{children}</div>;
}

function Segmented({ options, value, onChange }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(${options.length}, 1fr)`,
      gap: 2, padding: 3, background: 'hsl(var(--secondary))', borderRadius: 11,
    }}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} style={{
            padding: '9px 4px', minHeight: 44, borderRadius: 8, border: 'none', cursor: 'pointer',
            background: on ? 'hsl(var(--card))' : 'transparent',
            color: on ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
            fontFamily: 'var(--font-body)', fontSize: 'var(--text-label)', fontWeight: on ? 700 : 600,
            transition: 'background .2s, color .2s',
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

/* Volume is accumulated in lbs (that is how sets are stored — see the
   "Stored volume is RAW" note in CLAUDE.md), so it has to be converted
   for display like every other weight in the app. This card was printing
   the raw pound figure with a hardcoded "lb" suffix, so a user on kg saw
   pounds here and kilos everywhere else. */
const volumeText = (lbs, unit) => {
  const v = Math.round(fromLbs(lbs, unit));
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
};

/* ---- detail sheet (fixed bottom-sheet overlay) ----------- */
function DetailSheet({ muscles, id, rangeLabel, onClose, weightUnit }) {
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(!!id);
  // Every hook sits above the early return — a conditional hook changes the
  // hook count between renders and React throws.
  const { tFallback } = useLanguage();
  const closeRef = useRef(null);
  const returnRef = useRef(null);

  /* A modal a keyboard cannot leave is worse than no modal. This does the
     three things the sheet was missing:

     • Escape closes it. It was a fixed overlay with no key handling at all,
       so the only exit was tapping — fine on a phone, a trap otherwise.
     • Focus moves in on open and RETURNS to whatever opened it on close.
       Without the return, dismissing the sheet drops focus to the top of
       the document and you re-traverse the page to get back to the muscle
       you were reading.
     • Tab cycles within the sheet rather than wandering the page behind it,
       which is inert anyway (the scroll is locked and it is aria-hidden to
       nothing — the sheet is not portalled, so hiding the rest would mean
       hiding its own ancestor). `aria-modal` states the intent; the Tab
       wrap is what enforces it. */
  useEffect(() => {
    if (!id) return undefined;
    returnRef.current = document.activeElement;
    // Focus the close button rather than the panel: it is a real control,
    // so the name is announced and Enter does the obvious thing.
    closeRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const panel = closeRef.current?.closest('[role="dialog"]');
      if (!panel) return;
      const stops = panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!stops.length) return;
      const first = stops[0], last = stops[stops.length - 1];
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // The opener can be gone by now (mode switch unmounts the figure), so
      // only restore focus to something still in the document.
      const back = returnRef.current;
      if (back && document.contains(back)) back.focus();
    };
  }, [id, onClose]);

  if (!id) return null;
  const m = muscles[id];
  /* Status colour is a TOKEN, unlike the heat ramp above. Two reasons it
     had to change: the pill's tint was built by string-patching the solid
     colour into `hsla(150 50% 38%, 0.12)` — space-separated components
     with a comma before the alpha is not valid CSS, so the browser
     dropped the declaration and the pill had no background at all. And
     the three literals were tuned against a white card; on the dark card
     the red measured ~3.3:1, under AA. The tokens already carry a
     per-theme value for exactly this reason, and these are the hues the
     colour budget assigns: earned/on-track, effort, danger. */
  const status = STATUS[recoveryStatus(m.recovery)];
  const statusColor = `hsl(var(${status.v}))`;
  const r = 30, c = 2 * Math.PI * r;
  const volTxt = volumeText(m.vol, weightUnit);
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'flex-end',
      background: 'rgba(0,0,0,0.55)', animation: 'bh-fade .2s ease',
    }}>
      <div role="dialog" aria-modal="true" aria-labelledby={`bh-title-${id}`}
        onClick={(e) => e.stopPropagation()} style={{
          width: '100%', background: 'hsl(var(--card))',
          borderTopLeftRadius: 16, borderTopRightRadius: 16, borderTop: '1px solid hsl(var(--border))',
          padding: '14px 18px calc(30px + env(safe-area-inset-bottom))',
          animation: 'bh-rise .32s cubic-bezier(0.16,1,0.3,1)',
        }}>
        <div aria-hidden="true" style={{ width: 38, height: 5, borderRadius: 3, background: 'hsl(var(--border))', margin: '0 auto 16px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* `role="img"` + a label, rather than aria-hidden: the recovery
              number lives INSIDE this wrapper, so hiding it would drop the
              sheet's headline figure. Read as-is it announces "100 RECOV",
              which is the ring's caption, not a sentence — the label says
              it once, properly, and role="img" makes the parts beneath it
              presentational. */}
          <div role="img" aria-label={tFallback('bodyMap.a11y.recoveredPct', '{pct}% recovered', { pct: m.recovery })}
            style={{ position: 'relative', width: 76, height: 76, flexShrink: 0 }}>
            <svg width="76" height="76" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="38" cy="38" r={r} fill="none" stroke="hsl(var(--secondary))" strokeWidth="7" />
              <circle cx="38" cy="38" r={r} fill="none" stroke={statusColor} strokeWidth="7"
                strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - m.recovery / 100)}
                style={{ transition: 'stroke-dashoffset .5s' }} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              {/* The 7.5px "RECOV" caption under this is gone: the status
                  line beside the ring says what the number is. */}
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 18, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{m.recovery}%</div>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Kicker>
              {regionName(tFallback, m.region)}
              {' · '}
              {m.last != null
                ? tFallback('bodyMap.detail.daysAgo', '{n}d ago', { n: m.last })
                : tFallback('bodyMap.detail.untrained', 'untrained')}
            </Kicker>
            <div id={`bh-title-${id}`} className="font-heading font-bold text-2xl leading-tight mt-0.5">{muscleName(tFallback, m, id)}</div>
            <p className="text-sm font-semibold mt-1" style={{ color: statusColor }}>{tFallback(status.k, status.en)}</p>
          </div>
        </div>

        {/* A hairline row, like the page's own stat row. These were three
            filled tiles with 8.5px tracked-capital captions. Fixed count of
            three, so a grid is right. */}
        <div className="grid grid-cols-3 border-y border-border divide-x divide-border rtl:divide-x-reverse mt-6">
          {/* `key` is the id, not the label — a translated label is not a
              stable React key and would remount the tile on a language
              change. */}
          {[
            { k: 'sets', l: tFallback('bodyMap.detail.sets', 'Sets'), v: m.sets, u: '' },
            { k: 'volume', l: tFallback('bodyMap.detail.volume', 'Volume'), v: volTxt, u: weightUnit === 'lbs' ? 'lb' : weightUnit },
            {
              k: 'last',
              l: tFallback('bodyMap.detail.last', 'Last'),
              v: m.last != null ? m.last : '—',
              u: m.last != null ? tFallback('bodyMap.detail.daysAgoUnit', 'd ago') : '',
            },
          ].map((s) => (
            <div key={s.k} className="py-2 text-center">
              <div className="font-heading font-bold text-lg tabular-nums">
                {s.v}{s.u && <span className="text-micro font-semibold text-muted-foreground ms-0.5">{s.u}</span>}
              </div>
              <div className="text-micro text-muted-foreground">{s.k === 'last' ? s.l : `${s.l} · ${rangeLabel}`}</div>
            </div>
          ))}
        </div>

        {m.ex.length > 0 && (
          <div className="mt-6">
            <Kicker>{tFallback('bodyMap.detail.topExercises', 'Top exercises')}</Kicker>
            {/* Interpunct text, not a row of pills. */}
            <p className="text-sm mt-1">
              {m.ex.map((e) => (e === UNNAMED_EXERCISE ? tFallback('bodyMap.detail.unnamedExercise', 'Exercise') : e)).join(' · ')}
            </p>
          </div>
        )}

        {/* Named beyond its visible word: "CLOSE" alone is ambiguous once a
            screen reader has moved away from the title that gives it scope. */}
        <button ref={closeRef} onClick={onClose}
          aria-label={tFallback('bodyMap.a11y.closeDetail', 'Close muscle details')}
          // Secondary, not primary: closing a sheet is not the action the
          // orange is kept for.
          className="w-full mt-6 min-h-[48px] rounded-lg bg-secondary text-foreground text-sm font-semibold"
        >{tFallback('bodyMap.detail.close', 'Close')}</button>
      </div>
    </div>
  );
}

/* ============================================================
   MAIN — drops into the Progress page (no device frame / tab bar)
   ============================================================ */
export default function MuscleGroupHeatmap({ logs }) {
  const [mode, setMode] = useState('recovery');   // 'recovery' | 'volume'
  const [range, setRange] = useState('30D');
  const [sel, setSel] = useState(null);
  const { weightUnit } = useWeightUnit();
  const { tFallback } = useLanguage();
  const rangeShort = useMemo(() => {
    const r = RANGES.find((x) => x.id === range) || RANGES[1];
    return tFallback(r.shortKey, r.shortEn);
  }, [range, tFallback]);

  const muscles = useMemo(() => buildMuscles(logs, RANGE_DAYS[range]), [logs, range]);
  const maxVol = useMemo(() => Math.max(1, ...FINE_IDS.map((id) => muscles[id].vol)), [muscles]);
  const getFill = (id) => colorFor(muscles, id, mode, maxVol);

  /* The accessible name for a muscle on the figure. It has to carry the
     VALUE, because for a sighted user the fill is the value — announcing
     only "Chest" would hand a screen-reader user a body diagram with every
     number stripped out. Mode decides which number, since the two are not
     interchangeable: 100% recovered and 0 lb are both "nothing logged". */
  const muscleLabel = (id) => {
    const m = muscles[id];
    const name = muscleName(tFallback, m, id);
    const detail = mode === 'recovery'
      ? tFallback('bodyMap.a11y.muscleRecovery', '{muscle}, {pct}% recovered', { muscle: name, pct: m.recovery })
      : tFallback('bodyMap.a11y.muscleVolume', '{muscle}, {vol} {unit}', {
        muscle: name, vol: volumeText(m.vol, weightUnit), unit: weightUnit === 'lbs' ? 'lb' : weightUnit,
      });
    return `${detail}, ${tFallback('bodyMap.a11y.opensDetail', 'shows details')}`;
  };

  const ranked = useMemo(
    () => [...FINE_IDS].sort((a, b) => intensityOf(muscles, b, mode, maxVol) - intensityOf(muscles, a, mode, maxVol)),
    [muscles, mode, maxVol],
  );
  // "Need recovery" is every muscle not in the ready band, so the count
  // matches the colours: it was < 55, which left a 50 to 54 muscle orange
  // on the body and uncounted in the headline.
  const headline = mode === 'recovery' ? FINE_IDS.filter((id) => recoveryStatus(muscles[id].recovery) !== 'ready').length : ranked.length;
  // No workouts logged in-range → the figure still renders (all fresh), but
  // swap the data-y headline/status for a "log a workout" invitation.
  const empty = !FINE_IDS.some((id) => muscles[id].sets > 0);

  return (
    <div style={{ position: 'relative' }}>
      {/* header */}
      <div style={{ padding: '0 2px' }}>
        {/* No kicker row. It said "Progress · Muscle map" on the Progress
            page's Body tab, beside a hairline and an orange "● LIVE" dot for
            data that is read once from saved logs. */}
        {/* `pre-line` rather than a hardcoded <br />: the break is now a `\n`
            inside the string, so a translator can move it to where their
            text wants to break, or drop it and let the heading wrap. */}
        <h2 className="font-heading font-bold text-2xl leading-tight text-foreground" style={{ whiteSpace: 'pre-line' }}>
          {empty
            ? tFallback('bodyMap.headline.empty', 'Your muscle\nheat map.')
            : mode === 'recovery'
              ? tFallback(
                headline === 1 ? 'bodyMap.headline.recovery.one' : 'bodyMap.headline.recovery.other',
                headline === 1 ? '{n} muscle\nneeds recovery.' : '{n} muscles\nneed recovery.',
                { n: headline },
              )
              : tFallback('bodyMap.headline.volume', 'Where your\nwork landed.')}
        </h2>
        <p className="text-sm text-muted-foreground mt-2" style={{ maxWidth: 320 }}>
          {empty
            ? tFallback('bodyMap.body.empty', 'Log a workout and the muscles you trained light up here. Color shows fatigue so you know what’s ready to hit again.')
            : mode === 'recovery'
              ? tFallback('bodyMap.body.recovery', 'Color shows fatigue right now. Green is ready to train, orange is still recovering, red needs rest.')
              : tFallback('bodyMap.body.volume', 'Color shows training volume over the selected window. Brighter means more work landed there.')}
        </p>
      </div>

      {/* controls */}
      <div style={{ padding: '16px 0 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Segmented value={mode} onChange={(v) => { setMode(v); setSel(null); }} options={[
          { id: 'recovery', label: tFallback('bodyMap.mode.recovery', 'Recovery') },
          { id: 'volume', label: tFallback('bodyMap.mode.volume', 'Volume') },
        ]} />
        {/* Recovery is a right-now reading from the last session, whatever
            the window, so the window picker only shows where it changes
            something. It sat under Recovery and did nothing. */}
        {mode === 'volume' && (
          <Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ id: r.id, label: tFallback(r.key, r.en) }))} />
        )}
      </div>

      {/* map card */}
      <div style={{ padding: '14px 0 0' }}>
        {/* The stage: a flat panel plus a top-centre sheen, both themed —
            see the --mmap-* block in index.css. The sheen is a separate
            layer over a solid colour rather than a three-stop gradient
            between three literals, because a light theme wants the panel
            to get DARKER away from the light and a dark theme wants it to
            get darker too — which is the same rule only if the light is
            painted on, not baked into the ramp. */}
        {/* A flat panel now. The radial sheen and drop shadow over it were
            a spotlight effect, the kind of decoration CLAUDE.md bans. */}
        <div onClick={() => setSel(null)} className="rounded-2xl border border-border" style={{
          background: 'hsl(var(--mmap-stage))', padding: '20px 6px 14px', position: 'relative',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
            {[
              { k: 'front', label: tFallback('bodyMap.figure.front', 'Front'), F: FrontFigure,
                a11y: tFallback('bodyMap.a11y.figureFront', 'Front view, {n} muscles', { n: FRONT_GROUPS.length }) },
              { k: 'back', label: tFallback('bodyMap.figure.back', 'Back'), F: BackFigure,
                a11y: tFallback('bodyMap.a11y.figureBack', 'Back view, {n} muscles', { n: BACK_GROUPS.length }) },
            ].map(({ k, label, F, a11y }) => (
              <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: '100%' }}>
                  <F getFill={getFill} sel={sel} onSel={setSel} labelFor={muscleLabel} figureLabel={a11y} />
                </div>
                <div className="text-micro font-semibold text-muted-foreground mt-1">{label}</div>
              </div>
            ))}
          </div>

          {/* legend. Recovery names its three colours; volume shows its one
              colour at the two ends it runs between. */}
          <div className="mt-3 px-2">
            {mode === 'recovery' ? (
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-micro text-muted-foreground">
                {Object.entries(STATUS).map(([key, st]) => (
                  <span key={key} className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="w-2.5 h-2.5 rounded-sm" style={{ background: `hsl(var(${st.v}))` }} />
                    {tFallback(st.k, st.en)}
                  </span>
                ))}
              </div>
            ) : (
              <>
                <div aria-hidden="true" className="h-2 rounded-full mb-1.5" style={{
                  background: `linear-gradient(90deg, hsl(var(--chart-1) / ${volumeAlpha(0)}), hsl(var(--chart-1)))`,
                }} />
                <div className="flex justify-between text-micro text-muted-foreground">
                  <span>{tFallback('bodyMap.legend.less', 'Less')}</span>
                  <span>{tFallback('bodyMap.legend.more', 'More volume')}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ranked list */}
      <div style={{ padding: '20px 0 0' }}>
        <Kicker>
          {mode === 'recovery'
            ? tFallback('bodyMap.list.recovery', 'Recovery by muscle')
            : tFallback('bodyMap.list.volume', 'Volume by muscle')}
          {mode === 'volume' && <>{' · '}{rangeShort}</>}
        </Kicker>
      </div>
      <div style={{ margin: '10px 0 0', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 18, overflow: 'hidden' }}>
        {ranked.map((id, i) => {
          const m = muscles[id];
          const t = intensityOf(muscles, id, mode, maxVol);
          const col = colorFor(muscles, id, mode, maxVol);
          const valTxt = mode === 'recovery' ? `${m.recovery}%` : volumeText(m.vol, weightUnit);
          return (
            /* A real <button>, not a div: these rows open the same sheet the
               figure does, so they need the same keyboard and the same role.
               `type="button"` matters — a bare button inside any future form
               defaults to submit. Width/alignment/font are reset because a
               button does not inherit them. */
            <button key={id} type="button" onClick={() => setSel(id)} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', minHeight: 44, cursor: 'pointer',
              width: '100%', textAlign: 'start', font: 'inherit', color: 'inherit',
              border: 'none', borderRadius: 0,
              borderBottom: i < ranked.length - 1 ? '1px solid hsl(var(--border))' : 'none',
              background: sel === id ? 'hsl(var(--secondary))' : 'transparent', transition: 'background .2s',
            }}>
              <span aria-hidden="true" style={{ width: 11, height: 11, borderRadius: 3, background: col, flexShrink: 0 }} />
              <div style={{ width: 84, flexShrink: 0 }}>
                <div className="text-sm font-semibold text-foreground">{muscleName(tFallback, m, id)}</div>
                <div className="text-micro text-muted-foreground">{regionName(tFallback, m.region)}</div>
              </div>
              {/* The bar restates the number beside it, so it has to measure
                  the SAME quantity. In recovery mode it used to be drawn from
                  the fatigue intensity (100 − recovery), so "0%" sat beside a
                  full bar and "100%" beside an empty one. The colour still
                  comes from the fatigue ramp; only the length follows the
                  number. */}
              <div aria-hidden="true" style={{ flex: 1, height: 6, borderRadius: 999, background: 'hsl(var(--secondary))', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.max(6, (mode === 'recovery' ? m.recovery / 100 : t) * 100)}%`, background: col, borderRadius: 999, transition: 'width .5s, background .5s' }} />
              </div>
              <div style={{ width: 46, textAlign: 'end', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums', color: 'hsl(var(--foreground))' }}>
                {valTxt}{mode === 'volume' && <span className="text-micro text-muted-foreground font-semibold"> {weightUnit === 'lbs' ? 'lb' : weightUnit}</span>}
              </div>
            </button>
          );
        })}
      </div>

      <DetailSheet muscles={muscles} id={sel} rangeLabel={rangeShort} weightUnit={weightUnit} onClose={() => setSel(null)} />
    </div>
  );
}
