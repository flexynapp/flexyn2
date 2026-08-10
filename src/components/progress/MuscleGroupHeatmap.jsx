import React, { useState, useMemo } from 'react';
import { FRONT_GROUPS, BACK_GROUPS } from './muscleAnatomy';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';

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
   muscle vocabulary; see i18n-body-map.js for how to retire it. */
const MUSCLE_KEY = {
  chest: 'muscleGroups.chest', shoulders: 'muscleGroups.shoulders',
  triceps: 'muscleGroups.triceps', biceps: 'muscleGroups.biceps',
  forearms: 'muscleGroups.forearms', traps: 'muscleGroups.traps',
  lats: 'muscleGroups.lats', lowerback: 'bodyMap.muscle.lowerBack',
  abs: 'muscleGroups.abs', obliques: 'muscleGroups.obliques',
  glutes: 'muscleGroups.glutes', quads: 'muscleGroups.quads',
  hamstrings: 'muscleGroups.hamstrings', calves: 'muscleGroups.calves',
};
/* Push and Pull come from `regions.*` (i18n-regions.js), which named them
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
  { id: '7D', days: 7, key: 'bodyMap.range.7d', en: '7 DAYS', shortKey: 'bodyMap.rangeShort.7d', shortEn: '7D' },
  { id: '30D', days: 30, key: 'bodyMap.range.30d', en: '30 DAYS', shortKey: 'bodyMap.rangeShort.30d', shortEn: '30D' },
  { id: '90D', days: 90, key: 'bodyMap.range.90d', en: '90 DAYS', shortKey: 'bodyMap.rangeShort.90d', shortEn: '90D' },
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
    const dt = new Date(log.date);
    if (isNaN(dt)) return;
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

/* ---- Colour ramps ---------------------------------------- */
const lerpStops = (stops, t) => {
  t = Math.max(0, Math.min(1, t));
  const n = stops.length - 1, f = t * n, i = Math.min(Math.floor(f), n - 1), r = f - i;
  const a = stops[i], b = stops[i + 1];
  const h = a[0] + (b[0] - a[0]) * r, s = a[1] + (b[1] - a[1]) * r, l = a[2] + (b[2] - a[2]) * r;
  return `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`;
};
const VOL_STOPS = [[214, 12, 52], [40, 42, 56], [32, 84, 55], [26, 93, 54], [12, 88, 53], [2, 82, 52]];
const REC_STOPS = [[150, 46, 44], [104, 44, 46], [44, 90, 52], [22, 92, 53], [2, 82, 52]];

const intensityOf = (muscles, id, mode, maxVol) => (
  mode === 'recovery'
    ? (100 - muscles[id].recovery) / 100
    : (maxVol ? muscles[id].vol / maxVol : 0)
);
const colorFor = (muscles, id, mode, maxVol) => {
  const t = intensityOf(muscles, id, mode, maxVol);
  return mode === 'recovery' ? lerpStops(REC_STOPS, t) : lerpStops(VOL_STOPS, t);
};

/* ============================================================
   SVG figure — neutral body base, then heat-coloured tracked
   groups, dimensional top-light, and crisp guide outlines.

   Everything that isn't a heat colour reads from the --mmap-*
   tokens in index.css so the figure follows the user's light /
   dark choice; the heat ramps above are deliberately fixed, so
   the same fatigue is the same colour in either theme.

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

function Figure({ groups, viewBox, getFill, sel, onSel, vid, mirrorAxis }) {
  const mirrorT = mirrorAxis ? `translate(${2 * mirrorAxis},0) scale(-1,1)` : null;
  const legMirror = (grp) => mirrorT && LEG_GROUPS.has(grp.g);
  const allPaths = groups.flatMap((grp) => grp.paths);
  const legPaths = mirrorT ? groups.filter((g) => LEG_GROUPS.has(g.g)).flatMap((g) => g.paths) : [];
  return (
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'auto', maxHeight: FIGURE_MAX_H, overflow: 'visible' }}>
      <defs>
        <mask id={`bm-${vid}`}>
          {allPaths.map((d, i) => <path key={i} d={d} fill="#fff" />)}
          {mirrorT && <g transform={mirrorT}>{legPaths.map((d, i) => <path key={`m${i}`} d={d} fill="#fff" />)}</g>}
        </mask>
        <linearGradient id={`hl-${vid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="34%" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="70%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* 1 · neutral body base */}
      <g style={{ fill: NEUTRAL_FILL, stroke: NEUTRAL_STROKE }} strokeWidth="0.8" strokeLinejoin="round">
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
            onClick={(e) => { e.stopPropagation(); onSel(active ? null : k); }}
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

      {/* 3 · dimensional top-light, clipped to the body */}
      <g mask={`url(#bm-${vid})`} style={{ pointerEvents: 'none', mixBlendMode: 'soft-light' }}>
        <rect x="-100" y="-100" width="2000" height="2000" fill={`url(#hl-${vid})`} />
      </g>

      {/* 4 · guide outlines per clickable group */}
      <g fill="none" strokeLinejoin="round" style={{ pointerEvents: 'none' }}>
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
function Kicker({ children }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.2em',
      color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase',
    }}>{children}</div>
  );
}

function Segmented({ options, value, onChange, mono = true }) {
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
            fontFamily: mono ? 'var(--font-mono)' : 'var(--font-heading)',
            fontSize: mono ? 10 : 12.5, fontWeight: on ? 800 : 700,
            letterSpacing: mono ? '0.12em' : '-0.01em',
            boxShadow: on ? '0 1px 2px rgba(0,0,0,0.08)' : 'none', transition: 'all .2s',
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
  // Both hooks sit above the early return — a conditional hook changes the
  // hook count between renders and React throws.
  const { tFallback } = useLanguage();
  if (!id) return null;
  const m = muscles[id];
  const fatigue = (100 - m.recovery) / 100;
  /* Status colour is a TOKEN, unlike the heat ramp above. Two reasons it
     had to change: the pill's tint was built by string-patching the solid
     colour into `hsla(150 50% 38%, 0.12)` — space-separated components
     with a comma before the alpha is not valid CSS, so the browser
     dropped the declaration and the pill had no background at all. And
     the three literals were tuned against a white card; on the dark card
     the red measured ~3.3:1, under AA. The tokens already carry a
     per-theme value for exactly this reason, and these are the hues the
     colour budget assigns: earned/on-track, effort, danger. */
  const status = m.recovery >= 75 ? { k: 'bodyMap.status.ready', en: 'Ready to train', v: '--success' }
    : m.recovery >= 50 ? { k: 'bodyMap.status.recovering', en: 'Recovering', v: '--primary' }
      : { k: 'bodyMap.status.needsRest', en: 'Needs rest', v: '--destructive' };
  const statusColor = `hsl(var(${status.v}))`;
  const statusTint = `hsl(var(${status.v}) / 0.12)`;
  const r = 30, c = 2 * Math.PI * r;
  const volTxt = volumeText(m.vol, weightUnit);
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'flex-end',
      background: 'rgba(15,18,24,0.4)', backdropFilter: 'blur(2px)', animation: 'bh-fade .2s ease',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', background: 'hsl(var(--card))',
        borderTopLeftRadius: 26, borderTopRightRadius: 26,
        padding: '14px 18px calc(30px + env(safe-area-inset-bottom))',
        boxShadow: '0 -12px 40px rgba(0,0,0,0.18)', animation: 'bh-rise .32s cubic-bezier(0.16,1,0.3,1)',
      }}>
        <div style={{ width: 38, height: 5, borderRadius: 3, background: 'hsl(var(--border))', margin: '0 auto 16px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ position: 'relative', width: 76, height: 76, flexShrink: 0 }}>
            <svg width="76" height="76" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="38" cy="38" r={r} fill="none" stroke="hsl(var(--secondary))" strokeWidth="7" />
              <circle cx="38" cy="38" r={r} fill="none" stroke={lerpStops(REC_STOPS, fatigue)} strokeWidth="7"
                strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - m.recovery / 100)}
                style={{ transition: 'stroke-dashoffset .5s' }} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.03em', lineHeight: 1 }}>{m.recovery}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 7.5, fontWeight: 700, letterSpacing: '0.1em', color: 'hsl(var(--muted-foreground))' }}>{tFallback('bodyMap.detail.recov', 'RECOV')}</div>
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
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.03em', lineHeight: 1.05, marginTop: 3 }}>{muscleName(tFallback, m, id)}</div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, padding: '4px 10px', borderRadius: 999,
              background: statusTint,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: statusColor }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: statusColor }}>{tFallback(status.k, status.en)}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 18 }}>
          {/* `key` is the id, not the label — a translated label is not a
              stable React key and would remount the tile on a language
              change. */}
          {[
            { k: 'sets', l: tFallback('bodyMap.detail.sets', 'SETS'), v: m.sets, u: '' },
            { k: 'volume', l: tFallback('bodyMap.detail.volume', 'VOLUME'), v: volTxt, u: weightUnit === 'lbs' ? 'lb' : weightUnit },
            {
              k: 'last',
              l: tFallback('bodyMap.detail.last', 'LAST'),
              v: m.last != null ? m.last : '—',
              u: m.last != null ? tFallback('bodyMap.detail.daysAgoUnit', 'd ago') : '',
            },
          ].map((s) => (
            <div key={s.k} style={{ background: 'hsl(var(--secondary))', borderRadius: 13, padding: '11px 12px' }}>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 19, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                {s.v}<span style={{ fontSize: 10, fontWeight: 600, color: 'hsl(var(--muted-foreground))', marginLeft: 2 }}>{s.u}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.14em', color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>{s.l} · {rangeLabel}</div>
            </div>
          ))}
        </div>

        {m.ex.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <Kicker>{tFallback('bodyMap.detail.topExercises', 'Top exercises')}</Kicker>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
              {m.ex.map((e) => (
                <span key={e} style={{
                  padding: '6px 11px', borderRadius: 999, background: 'hsl(var(--secondary))',
                  fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: 'hsl(var(--foreground))',
                }}>{e === UNNAMED_EXERCISE ? tFallback('bodyMap.detail.unnamedExercise', 'Exercise') : e}</span>
              ))}
            </div>
          </div>
        )}

        <button onClick={onClose} style={{
          width: '100%', marginTop: 20, padding: 14, minHeight: 44, borderRadius: 14, border: 'none', cursor: 'pointer',
          background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))',
          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 800, letterSpacing: '0.16em',
        }}>{tFallback('bodyMap.detail.close', 'CLOSE')}</button>
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

  const ranked = useMemo(
    () => [...FINE_IDS].sort((a, b) => intensityOf(muscles, b, mode, maxVol) - intensityOf(muscles, a, mode, maxVol)),
    [muscles, mode, maxVol],
  );
  const headline = mode === 'recovery' ? FINE_IDS.filter((id) => muscles[id].recovery < 55).length : ranked.length;
  // No workouts logged in-range → the figure still renders (all fresh), but
  // swap the data-y headline/status for a "log a workout" invitation.
  const empty = !FINE_IDS.some((id) => muscles[id].sets > 0);

  return (
    <div style={{ position: 'relative' }}>
      {/* header */}
      <div style={{ padding: '0 2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Kicker>{tFallback('bodyMap.kicker', 'Progress · Muscle map')}</Kicker>
          <span style={{ flex: 1, height: 1, background: 'hsl(var(--border))' }} />
          {/* The glyph stays in the JSX; only the word is translated. */}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.16em', color: empty ? 'hsl(var(--muted-foreground))' : 'hsl(var(--primary))' }}>
            {empty ? `○ ${tFallback('bodyMap.data.noData', 'NO DATA')}` : `● ${tFallback('bodyMap.data.live', 'LIVE')}`}
          </span>
        </div>
        {/* `pre-line` rather than a hardcoded <br />: the break is now a `\n`
            inside the string, so a translator can move it to where their
            text wants to break, or drop it and let the heading wrap. */}
        <h1 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 30, letterSpacing: '-0.035em', lineHeight: 1.02, color: 'hsl(var(--foreground))', whiteSpace: 'pre-line' }}>
          {empty
            ? tFallback('bodyMap.headline.empty', 'Your muscle\nheat map.')
            : mode === 'recovery'
              ? tFallback(
                headline === 1 ? 'bodyMap.headline.recovery.one' : 'bodyMap.headline.recovery.other',
                headline === 1 ? '{n} muscle\nneeds recovery.' : '{n} muscles\nneed recovery.',
                { n: headline },
              )
              : tFallback('bodyMap.headline.volume', 'Where your\nwork landed.')}
        </h1>
        <p style={{ margin: '10px 0 0', fontSize: 12.5, lineHeight: 1.45, color: 'hsl(var(--muted-foreground))', maxWidth: 320 }}>
          {empty
            ? tFallback('bodyMap.body.empty', 'Log a workout and the muscles you trained light up here — colour shows fatigue so you know what’s ready to hit again.')
            : mode === 'recovery'
              ? tFallback('bodyMap.body.recovery', 'Colour shows fatigue right now — fresh green muscles are ready, hot ones still need rest before you hit them again.')
              : tFallback('bodyMap.body.volume', 'Colour shows training volume over the selected window — brighter means more work landed there.')}
        </p>
      </div>

      {/* controls */}
      <div style={{ padding: '16px 0 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Segmented mono={false} value={mode} onChange={(v) => { setMode(v); setSel(null); }} options={[
          { id: 'recovery', label: tFallback('bodyMap.mode.recovery', 'Recovery') },
          { id: 'volume', label: tFallback('bodyMap.mode.volume', 'Volume') },
        ]} />
        <Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ id: r.id, label: tFallback(r.key, r.en) }))} />
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
        <div onClick={() => setSel(null)} style={{
          background: 'radial-gradient(120% 80% at 50% 8%, '
            + 'hsl(var(--mmap-sheen) / var(--mmap-sheen-a)) 0%, '
            + 'hsl(var(--mmap-sheen) / var(--mmap-sheen-b)) 68%, '
            + 'transparent 100%), hsl(var(--mmap-stage))',
          border: '1px solid hsl(var(--border))', borderRadius: 22, padding: '20px 6px 14px', position: 'relative',
          boxShadow: 'var(--mmap-shadow)',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
            {[
              { k: 'front', label: tFallback('bodyMap.figure.front', 'FRONT'), F: FrontFigure },
              { k: 'back', label: tFallback('bodyMap.figure.back', 'BACK'), F: BackFigure },
            ].map(({ k, label, F }) => (
              <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: '100%' }}>
                  <F getFill={getFill} sel={sel} onSel={setSel} />
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 800, letterSpacing: '0.22em', color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* legend */}
          <div style={{ marginTop: 10, padding: '0 8px' }}>
            <div style={{
              height: 8, borderRadius: 999, marginBottom: 6,
              background: mode === 'recovery'
                ? 'linear-gradient(90deg, hsl(150 46% 44%), hsl(104 44% 46%), hsl(44 90% 52%), hsl(22 92% 53%), hsl(2 82% 52%))'
                : 'linear-gradient(90deg, hsl(214 12% 52%), hsl(32 84% 55%), hsl(26 93% 54%), hsl(12 88% 53%), hsl(2 82% 52%))',
            }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'hsl(var(--muted-foreground))' }}>
              <span>{mode === 'recovery' ? tFallback('bodyMap.legend.fresh', 'FRESH') : tFallback('bodyMap.legend.less', 'LESS')}</span>
              <span>{mode === 'recovery' ? tFallback('bodyMap.legend.fatigued', 'FATIGUED') : tFallback('bodyMap.legend.more', 'MORE VOLUME')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ranked list */}
      <div style={{ padding: '20px 0 0' }}>
        <Kicker>
          {mode === 'recovery'
            ? tFallback('bodyMap.list.recovery', 'Recovery by muscle')
            : tFallback('bodyMap.list.volume', 'Volume by muscle')}
          {' · '}{rangeShort}
        </Kicker>
      </div>
      <div style={{ margin: '10px 0 0', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 18, overflow: 'hidden' }}>
        {ranked.map((id, i) => {
          const m = muscles[id];
          const t = intensityOf(muscles, id, mode, maxVol);
          const col = colorFor(muscles, id, mode, maxVol);
          const valTxt = mode === 'recovery' ? `${m.recovery}%` : volumeText(m.vol, weightUnit);
          return (
            <div key={id} onClick={() => setSel(id)} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', minHeight: 44, cursor: 'pointer',
              borderBottom: i < ranked.length - 1 ? '1px solid hsl(var(--border))' : 'none',
              background: sel === id ? 'hsl(var(--secondary))' : 'transparent', transition: 'background .2s',
            }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: col, flexShrink: 0 }} />
              <div style={{ width: 84, flexShrink: 0 }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 13.5, letterSpacing: '-0.01em', color: 'hsl(var(--foreground))' }}>{muscleName(tFallback, m, id)}</div>
                {/* CSS uppercase, not `toUpperCase()`: the JS one is
                    locale-blind and gets Turkish i → I instead of İ. */}
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em', color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase' }}>{regionName(tFallback, m.region)}</div>
              </div>
              <div style={{ flex: 1, height: 6, borderRadius: 999, background: 'hsl(var(--secondary))', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.max(6, t * 100)}%`, background: col, borderRadius: 999, transition: 'width .5s, background .5s' }} />
              </div>
              <div style={{ width: 46, textAlign: 'right', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums', color: 'hsl(var(--foreground))' }}>
                {valTxt}{mode === 'volume' && <span style={{ fontSize: 9, color: 'hsl(var(--muted-foreground))', fontWeight: 600 }}> {weightUnit === 'lbs' ? 'lb' : weightUnit}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <DetailSheet muscles={muscles} id={sel} rangeLabel={rangeShort} weightUnit={weightUnit} onClose={() => setSel(null)} />
    </div>
  );
}
