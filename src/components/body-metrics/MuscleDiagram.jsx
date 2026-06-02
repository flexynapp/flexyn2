import React, { useState, useMemo } from "react";
import { useLanguage } from '@/lib/LanguageContext';

export const MUSCLE_CATEGORIES = {
  chest:     ["chest"],
  back:      ["lats", "traps", "lower_back"],
  shoulders: ["front_delts", "side_delts", "rear_delts"],
  biceps:    ["biceps"],
  triceps:   ["triceps"],
  legs:      ["quads", "hamstrings", "adductors", "calves_front", "calves_back"],
  glutes:    ["glutes"],
  core:      ["abs", "obliques"],
  forearms:  ["forearms"]
};

export const CATEGORY_IDS = Object.keys(MUSCLE_CATEGORIES);

export const MUSCLE_IDS = [
  "chest", "front_delts", "side_delts", "rear_delts",
  "biceps", "triceps", "forearms",
  "abs", "obliques",
  "quads", "adductors", "calves_front",
  "traps", "lats", "lower_back",
  "glutes", "hamstrings", "calves_back"
];

function expandMuscleId(id) {
  if (MUSCLE_CATEGORIES[id]) return MUSCLE_CATEGORIES[id];
  if (MUSCLE_IDS.includes(id)) return [id];
  return [];
}

const MUSCLE_TO_CATEGORY = (() => {
  const map = {};
  for (const [cat, muscles] of Object.entries(MUSCLE_CATEGORIES)) {
    for (const m of muscles) map[m] = cat;
  }
  return map;
})();

const HEAT_STOPS = [
  { t: 0.0,  color: "#6b7280" },
  { t: 0.15, color: "#1e4d6b" },
  { t: 0.4,  color: "#3a9b7a" },
  { t: 0.7,  color: "#e8a33d" },
  { t: 1.0,  color: "#d64545" }
];

function interpolateColor(t) {
  if (t <= 0) return HEAT_STOPS[0].color;
  if (t >= 1) return HEAT_STOPS[HEAT_STOPS.length - 1].color;
  for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
    const a = HEAT_STOPS[i], b = HEAT_STOPS[i + 1];
    if (t >= a.t && t <= b.t) {
      const local = (t - a.t) / (b.t - a.t);
      return mixHex(a.color, b.color, local);
    }
  }
  return HEAT_STOPS[0].color;
}

function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0")}`;
}

const RANGE_MS = {
  "7d":  7  * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  "all": Infinity
};

const MUSCLE_LABELS = {
  chest: "Chest", front_delts: "Front Delts", side_delts: "Side Delts",
  rear_delts: "Rear Delts", biceps: "Biceps", triceps: "Triceps",
  forearms: "Forearms", abs: "Abs", obliques: "Obliques", quads: "Quads",
  adductors: "Adductors", calves_front: "Calves (front)", traps: "Traps",
  lats: "Lats", lower_back: "Lower Back", glutes: "Glutes",
  hamstrings: "Hamstrings", calves_back: "Calves (back)"
};

function resolveVariant(gender) {
  if (gender === "male" || gender === "Male" || gender === "m") return "male";
  if (gender === "female" || gender === "Female" || gender === "f") return "female";
  return "unisex";
}

export default function MuscleDiagram({
  workoutHistory = [],
  timeRange: initialRange = "30d",
  gender = "unisex",
  customAssets = null,
  onMuscleClick
}) {
  const { t } = useLanguage();
  const [view, setView] = useState("front");
  const [timeRange, setTimeRange] = useState(initialRange);

  const variant = resolveVariant(gender);

  const volumeByMuscle = useMemo(() => {
    const cutoff = Date.now() - RANGE_MS[timeRange];
    const totals = Object.fromEntries(MUSCLE_IDS.map(id => [id, 0]));
    const sessionCount = Object.fromEntries(MUSCLE_IDS.map(id => [id, 0]));

    const applyVolume = (ids, work, weightFactor, touched) => {
      for (const rawId of ids || []) {
        const expanded = expandMuscleId(rawId);
        if (expanded.length === 0) continue;
        const perMuscle = (work * weightFactor) / expanded.length;
        for (const m of expanded) {
          totals[m] += perMuscle;
          touched.add(m);
        }
      }
    };

    for (const workout of workoutHistory) {
      const ts = new Date(workout.date).getTime();
      if (isNaN(ts) || ts < cutoff) continue;
      const touchedThisSession = new Set();
      for (const ex of workout.exercises || []) {
        // Count "hard sets" (sets with weight>0 OR reps>0) as the stimulus unit.
        const hardSets = Array.isArray(ex.sets)
          ? ex.sets.filter(s => (s?.weight > 0) || (s?.reps > 0)).length
          : (typeof ex.sets === 'number' ? ex.sets : 0);
        const work = hardSets;
        // Support both explicit muscles object and legacy muscle_group string
        if (ex.muscles?.primary || ex.muscles?.secondary) {
          applyVolume(ex.muscles?.primary, work, 1.0, touchedThisSession);
          applyVolume(ex.muscles?.secondary, work, 0.5, touchedThisSession);
        } else if (ex.muscle_group) {
          // Map legacy muscle_group string to category
          const categoryId = ex.muscle_group.toLowerCase().replace(/\s+/g, '_');
          applyVolume([categoryId], work, 1.0, touchedThisSession);
        }
      }
      touchedThisSession.forEach(m => sessionCount[m]++);
    }

    // Convert window length to weeks for an absolute sets-per-week scale.
    // For "all", use the actual data span with a 12-week floor so sparse
    // long-term users don't see artificially high intensity.
    let windowMs;
    if (timeRange === 'all') {
      let earliest = Infinity;
      for (const w of workoutHistory) {
        const ts = new Date(w.date).getTime();
        if (!isNaN(ts) && ts < earliest) earliest = ts;
      }
      const spanMs = isFinite(earliest) ? Date.now() - earliest : RANGE_MS['30d'];
      const TWELVE_WEEKS_MS = 12 * 7 * 24 * 60 * 60 * 1000;
      windowMs = Math.max(spanMs, TWELVE_WEEKS_MS);
    } else {
      windowMs = RANGE_MS[timeRange];
    }
    const weeks = Math.max(1, windowMs / (7 * 24 * 60 * 60 * 1000));

    // Piecewise-linear intensity curve mapped to evidence-based sets/week bands:
    //   0 → gray  |  ≤6/wk → blue  |  6-12 → green  |  12-20 → amber  |  20-28 → orange  |  28+ → red
    const setsPerWeekToIntensity = (spw) => {
      if (spw <= 0)  return 0;
      if (spw <= 6)  return (spw / 6) * 0.25;
      if (spw <= 12) return 0.25 + ((spw - 6) / 6) * 0.25;
      if (spw <= 20) return 0.50 + ((spw - 12) / 8) * 0.25;
      if (spw <= 28) return 0.75 + ((spw - 20) / 8) * 0.20;
      return 1.0;
    };

    const result = {};
    for (const id of MUSCLE_IDS) {
      const setsPerWeek = totals[id] / weeks;
      const intensity = setsPerWeekToIntensity(setsPerWeek);
      result[id] = {
        volume: totals[id],
        setsPerWeek,
        sessions: sessionCount[id],
        intensity,
        color: interpolateColor(intensity)
      };
    }
    return result;
  }, [workoutHistory, timeRange]);

  const handleMuscleClick = (id) => {
    if (onMuscleClick) {
      onMuscleClick(id, {
        ...volumeByMuscle[id],
        category: MUSCLE_TO_CATEGORY[id] || null
      });
    }
  };

  const hasWorkouts = workoutHistory.length > 0;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>{t('progress.bodyMetrics.title')}</div>
          <h2 style={styles.title}>{t('bodyDiagram.title')}</h2>
        </div>
        <div style={styles.controls}>
          <div style={styles.segmented}>
            {["7d", "30d", "90d", "all"].map(r => (
              <button key={r} onClick={() => setTimeRange(r)}
                style={{ ...styles.segBtn, ...(timeRange === r ? styles.segBtnActive : {}) }}>
                {r === "all" ? t('progress.all') : r}
              </button>
            ))}
          </div>
          <div style={styles.segmented}>
            {["front", "back"].map(v => (
              <button key={v} onClick={() => setView(v)}
                style={{ ...styles.segBtn, ...(view === v ? styles.segBtnActive : {}) }}>
                {v === 'front' ? t('bodyDiagram.front') : t('bodyDiagram.back')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!hasWorkouts && (
        <div style={styles.emptyMsg}>
          {t('bodyDiagram.emptyMessage')}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Legend — always on top */}
        <div style={styles.card}>
          <div style={styles.cardLabel}>{t('bodyDiagram.legend')}</div>
          <div style={styles.legendBar}>
            <div style={styles.legendGradient} />
            <div style={styles.legendLabels}>
              <span>{t('bodyDiagram.untrained')}</span>
              <span>{t('bodyDiagram.heavy')}</span>
            </div>
          </div>
          <div style={styles.legendNote}>
            {t('bodyDiagram.legendNote')}
          </div>
        </div>

        {/* Diagram — click a muscle to view exercises */}
        <div style={styles.diagramWrap}>
          <Body variant={variant} view={view} data={volumeByMuscle}
            customAssets={customAssets} onClick={handleMuscleClick} />
        </div>
      </div>
    </div>
  );
}


function Body({ variant, view, data, customAssets, onClick }) {
  const mProps = (id) => ({
    fill: data[id]?.color || "#2a2f3a",
    stroke: "#0a0c11",
    strokeWidth: 0.6,
    strokeLinejoin: "round",
    onClick: () => onClick(id),
    style: {
      cursor: "pointer",
      transition: "fill 280ms ease",
    }
  });

  const paths = customAssets?.[variant]?.[view] || getBodyPaths()[variant][view];
  const viewBox = customAssets?.viewBox || "0 0 280 600";

  return (
    <svg viewBox={viewBox} style={styles.svg} xmlns="http://www.w3.org/2000/svg">
      {Array.isArray(paths.silhouette)
        ? paths.silhouette.map((d, i) => (
            <path key={i} d={d} fill="#15181f" stroke="#0a0c11" strokeWidth="0.8" />
          ))
        : <path d={paths.silhouette} fill="#15181f" stroke="#0a0c11" strokeWidth="0.8" />
      }
      {paths.muscles.map((m, i) => (
        <path key={`${m.id}-${i}`} data-muscle={m.id} d={m.d} {...mProps(m.id)} />
      ))}
      {paths.details && (
        <g fill="none" stroke="#0a0c11" strokeWidth="0.5" opacity="0.4" pointerEvents="none">
          {paths.details.map((d, i) => <path key={i} d={d} />)}
        </g>
      )}
    </svg>
  );
}

const VARIANT_CONFIGS = {
  male:   { shoulderHalfWidth: 60, chestHalfWidth: 54, waistHalfWidth: 38, hipHalfWidth: 46, thighOuter: 50, armOuterOffset: 6, upperArmWidth: 20, forearmWidth: 17, headRadiusX: 22, headRadiusY: 28, pecProminence: 1.0, abProminence: 1.0, obliqueWidth: 1.0, glutesProminence: 1.0 },
  female: { shoulderHalfWidth: 50, chestHalfWidth: 46, waistHalfWidth: 30, hipHalfWidth: 52, thighOuter: 54, armOuterOffset: 5, upperArmWidth: 17, forearmWidth: 14, headRadiusX: 20, headRadiusY: 26, pecProminence: 0.75, abProminence: 0.85, obliqueWidth: 0.9, glutesProminence: 1.15 },
  unisex: { shoulderHalfWidth: 55, chestHalfWidth: 50, waistHalfWidth: 34, hipHalfWidth: 49, thighOuter: 52, armOuterOffset: 5, upperArmWidth: 18, forearmWidth: 15, headRadiusX: 21, headRadiusY: 27, pecProminence: 0.9, abProminence: 0.95, obliqueWidth: 0.95, glutesProminence: 1.0 }
};

function buildBody(cfg, isBack) {
  const cx = 140;
  const { shoulderHalfWidth: sw, chestHalfWidth: cw, waistHalfWidth: ww, hipHalfWidth: hw, thighOuter: th, armOuterOffset: aoff, headRadiusX: hrx, headRadiusY: hry } = cfg;
  const Y = { headTop: 24, headCenter: 52, chinY: 78, neckBottom: 92, shoulderPeak: 102, armpit: 128, chestMid: 140, ribCage: 190, waist: 240, navel: 220, hipTop: 292, hipBottom: 340, midThigh: 400, kneeTop: 460, kneeBottom: 480, midCalf: 530, ankle: 578 };
  const head = `M ${cx} ${Y.headTop - 4} a ${hrx} ${hry} 0 1 1 -0.01 0 Z`;
  const neckHalfW = 10;
  const neck = `M ${cx - neckHalfW} ${Y.chinY - 2} Q ${cx - neckHalfW - 1} ${Y.neckBottom - 2} ${cx - neckHalfW - 2} ${Y.neckBottom} L ${cx + neckHalfW + 2} ${Y.neckBottom} Q ${cx + neckHalfW + 1} ${Y.neckBottom - 2} ${cx + neckHalfW} ${Y.chinY - 2} Z`;
  const torso = `M ${cx - neckHalfW - 2} ${Y.neckBottom} Q ${cx - sw + 8} ${Y.shoulderPeak - 2} ${cx - sw} ${Y.shoulderPeak + 4} Q ${cx - sw - aoff} ${Y.armpit - 4} ${cx - sw + 4} ${Y.armpit + 4} Q ${cx - cw} ${Y.chestMid} ${cx - cw + 2} ${Y.ribCage} Q ${cx - ww - 2} ${Y.waist} ${cx - ww + 4} ${Y.hipTop - 10} Q ${cx - hw} ${Y.hipTop} ${cx - hw + 2} ${Y.hipBottom} L ${cx - 4} ${Y.hipBottom + 6} L ${cx + 4} ${Y.hipBottom + 6} L ${cx + hw - 2} ${Y.hipBottom} Q ${cx + hw} ${Y.hipTop} ${cx + ww - 4} ${Y.hipTop - 10} Q ${cx + ww + 2} ${Y.waist} ${cx + cw - 2} ${Y.ribCage} Q ${cx + cw} ${Y.chestMid} ${cx + sw - 4} ${Y.armpit + 4} Q ${cx + sw + aoff} ${Y.armpit - 4} ${cx + sw} ${Y.shoulderPeak + 4} Q ${cx + sw - 8} ${Y.shoulderPeak - 2} ${cx + neckHalfW + 2} ${Y.neckBottom} Z`;
  const armLeft = `M ${cx - sw + 2} ${Y.shoulderPeak + 6} Q ${cx - sw - aoff - 2} ${Y.armpit - 2} ${cx - sw - aoff - 6} ${Y.armpit + 14} L ${cx - sw - aoff - 10} ${Y.chestMid + 40} Q ${cx - sw - aoff - 12} ${Y.ribCage + 20} ${cx - sw - aoff - 12} ${Y.waist + 10} L ${cx - sw - aoff - 14} ${Y.hipTop + 20} Q ${cx - sw - aoff - 16} ${Y.hipBottom} ${cx - sw - aoff - 4} ${Y.hipBottom + 6} Q ${cx - sw - aoff - 2} ${Y.hipBottom + 16} ${cx - sw - aoff + 4} ${Y.hipBottom + 4} Q ${cx - sw + 2} ${Y.waist + 10} ${cx - sw + 4} ${Y.chestMid + 20} Q ${cx - sw + 8} ${Y.armpit + 10} ${cx - sw + 4} ${Y.armpit + 4} Z`;
  const armRight = `M ${cx + sw - 2} ${Y.shoulderPeak + 6} Q ${cx + sw + aoff + 2} ${Y.armpit - 2} ${cx + sw + aoff + 6} ${Y.armpit + 14} L ${cx + sw + aoff + 10} ${Y.chestMid + 40} Q ${cx + sw + aoff + 12} ${Y.ribCage + 20} ${cx + sw + aoff + 12} ${Y.waist + 10} L ${cx + sw + aoff + 14} ${Y.hipTop + 20} Q ${cx + sw + aoff + 16} ${Y.hipBottom} ${cx + sw + aoff + 4} ${Y.hipBottom + 6} Q ${cx + sw + aoff + 2} ${Y.hipBottom + 16} ${cx + sw + aoff - 4} ${Y.hipBottom + 4} Q ${cx + sw - 2} ${Y.waist + 10} ${cx + sw - 4} ${Y.chestMid + 20} Q ${cx + sw - 8} ${Y.armpit + 10} ${cx + sw - 4} ${Y.armpit + 4} Z`;
  const legLeft = `M ${cx - 4} ${Y.hipBottom + 6} L ${cx - hw + 2} ${Y.hipBottom} Q ${cx - th} ${Y.midThigh - 20} ${cx - th + 4} ${Y.midThigh} Q ${cx - th + 6} ${Y.kneeTop} ${cx - 22} ${Y.kneeBottom} L ${cx - 24} ${Y.midCalf - 10} Q ${cx - 26} ${Y.midCalf + 10} ${cx - 22} ${Y.ankle - 10} Q ${cx - 20} ${Y.ankle} ${cx - 14} ${Y.ankle} L ${cx - 6} ${Y.ankle} L ${cx - 6} ${Y.kneeBottom + 10} L ${cx - 4} ${Y.kneeTop} Z`;
  const legRight = `M ${cx + 4} ${Y.hipBottom + 6} L ${cx + hw - 2} ${Y.hipBottom} Q ${cx + th} ${Y.midThigh - 20} ${cx + th - 4} ${Y.midThigh} Q ${cx + th - 6} ${Y.kneeTop} ${cx + 22} ${Y.kneeBottom} L ${cx + 24} ${Y.midCalf - 10} Q ${cx + 26} ${Y.midCalf + 10} ${cx + 22} ${Y.ankle - 10} Q ${cx + 20} ${Y.ankle} ${cx + 14} ${Y.ankle} L ${cx + 6} ${Y.ankle} L ${cx + 6} ${Y.kneeBottom + 10} L ${cx + 4} ${Y.kneeTop} Z`;
  const silhouette = [head, neck, torso, armLeft, armRight, legLeft, legRight];
  const muscles = isBack ? buildBackMuscles(cfg, Y, cx) : buildFrontMuscles(cfg, Y, cx);
  const details = isBack
    ? [`M ${cx} ${Y.shoulderPeak + 6} L ${cx} ${Y.ribCage}`, `M ${cx} ${Y.ribCage + 20} L ${cx} ${Y.hipTop + 10}`, `M ${cx} ${Y.hipBottom} L ${cx} ${Y.hipBottom + 40}`]
    : [`M ${cx} ${Y.shoulderPeak + 10} L ${cx} ${Y.chestMid + 40}`, `M ${cx} ${Y.chestMid + 50} L ${cx} ${Y.hipTop - 10}`];
  return { silhouette, muscles, details };
}

function buildFrontMuscles(cfg, Y, cx) {
  const { chestHalfWidth: cw, waistHalfWidth: ww, hipHalfWidth: hw, thighOuter: th, shoulderHalfWidth: sw, armOuterOffset: aoff, pecProminence: pec, abProminence: ab, obliqueWidth: obl } = cfg;
  const muscles = [];
  const pecTop = Y.shoulderPeak + 16, pecBottom = pecTop + 38 * pec, pecOuter = cw - 8;
  muscles.push({ id: "chest", d: `M ${cx - 2} ${pecTop} C ${cx - pecOuter * 0.3} ${pecTop - 1} ${cx - pecOuter} ${pecTop + 4} ${cx - pecOuter} ${pecTop + 16} C ${cx - pecOuter} ${pecBottom - 2} ${cx - pecOuter * 0.5} ${pecBottom + 2} ${cx - 4} ${pecBottom} L ${cx - 2} ${pecBottom - 4} Z` });
  muscles.push({ id: "chest", d: `M ${cx + 2} ${pecTop} C ${cx + pecOuter * 0.3} ${pecTop - 1} ${cx + pecOuter} ${pecTop + 4} ${cx + pecOuter} ${pecTop + 16} C ${cx + pecOuter} ${pecBottom - 2} ${cx + pecOuter * 0.5} ${pecBottom + 2} ${cx + 4} ${pecBottom} L ${cx + 2} ${pecBottom - 4} Z` });
  const deltTop = Y.shoulderPeak + 4, deltBot = Y.armpit + 4;
  muscles.push({ id: "front_delts", d: `M ${cx - sw + 4} ${deltTop} C ${cx - sw - aoff + 2} ${deltTop + 4} ${cx - sw - aoff} ${deltTop + 14} ${cx - sw - aoff + 2} ${deltBot} L ${cx - sw + 8} ${deltBot - 4} C ${cx - sw + 10} ${deltTop + 14} ${cx - sw + 8} ${deltTop + 4} ${cx - sw + 4} ${deltTop} Z` });
  muscles.push({ id: "front_delts", d: `M ${cx + sw - 4} ${deltTop} C ${cx + sw + aoff - 2} ${deltTop + 4} ${cx + sw + aoff} ${deltTop + 14} ${cx + sw + aoff - 2} ${deltBot} L ${cx + sw - 8} ${deltBot - 4} C ${cx + sw - 10} ${deltTop + 14} ${cx + sw - 8} ${deltTop + 4} ${cx + sw - 4} ${deltTop} Z` });
  muscles.push({ id: "side_delts", d: `M ${cx - sw - aoff + 2} ${deltBot - 4} C ${cx - sw - aoff - 6} ${deltBot + 10} ${cx - sw - aoff - 8} ${deltBot + 26} ${cx - sw - aoff - 4} ${deltBot + 40} L ${cx - sw - aoff + 4} ${deltBot + 36} C ${cx - sw - aoff + 4} ${deltBot + 14} ${cx - sw - aoff + 4} ${deltBot + 4} ${cx - sw - aoff + 2} ${deltBot - 4} Z` });
  muscles.push({ id: "side_delts", d: `M ${cx + sw + aoff - 2} ${deltBot - 4} C ${cx + sw + aoff + 6} ${deltBot + 10} ${cx + sw + aoff + 8} ${deltBot + 26} ${cx + sw + aoff + 4} ${deltBot + 40} L ${cx + sw + aoff - 4} ${deltBot + 36} C ${cx + sw + aoff - 4} ${deltBot + 14} ${cx + sw + aoff - 4} ${deltBot + 4} ${cx + sw + aoff - 2} ${deltBot - 4} Z` });
  const bicepTop = deltBot + 6, bicepBot = Y.ribCage + 16;
  muscles.push({ id: "biceps", d: `M ${cx - sw - aoff - 4} ${bicepTop} C ${cx - sw - aoff - 10} ${bicepTop + 24} ${cx - sw - aoff - 8} ${bicepBot - 6} ${cx - sw - aoff} ${bicepBot} L ${cx - sw - aoff + 8} ${bicepBot - 2} C ${cx - sw - aoff + 10} ${bicepTop + 24} ${cx - sw - aoff + 4} ${bicepTop + 6} ${cx - sw - aoff - 4} ${bicepTop} Z` });
  muscles.push({ id: "biceps", d: `M ${cx + sw + aoff + 4} ${bicepTop} C ${cx + sw + aoff + 10} ${bicepTop + 24} ${cx + sw + aoff + 8} ${bicepBot - 6} ${cx + sw + aoff} ${bicepBot} L ${cx + sw + aoff - 8} ${bicepBot - 2} C ${cx + sw + aoff - 10} ${bicepTop + 24} ${cx + sw + aoff - 4} ${bicepTop + 6} ${cx + sw + aoff + 4} ${bicepTop} Z` });
  const farmTop = bicepBot, farmBot = Y.hipTop + 36;
  muscles.push({ id: "forearms", d: `M ${cx - sw - aoff - 2} ${farmTop} C ${cx - sw - aoff - 12} ${farmTop + 20} ${cx - sw - aoff - 14} ${farmBot - 10} ${cx - sw - aoff - 8} ${farmBot} L ${cx - sw - aoff + 6} ${farmBot - 2} C ${cx - sw - aoff + 8} ${farmTop + 20} ${cx - sw - aoff + 8} ${farmTop + 4} ${cx - sw - aoff - 2} ${farmTop} Z` });
  muscles.push({ id: "forearms", d: `M ${cx + sw + aoff + 2} ${farmTop} C ${cx + sw + aoff + 12} ${farmTop + 20} ${cx + sw + aoff + 14} ${farmBot - 10} ${cx + sw + aoff + 8} ${farmBot} L ${cx + sw + aoff - 6} ${farmBot - 2} C ${cx + sw + aoff - 8} ${farmTop + 20} ${cx + sw + aoff - 8} ${farmTop + 4} ${cx + sw + aoff + 2} ${farmTop} Z` });
  const abLeft = -8 * ab, abRight = 8 * ab, abStart = pecBottom + 6, abEnd = Y.hipTop - 16, rowH = (abEnd - abStart) / 4;
  muscles.push({ id: "abs", d: `M ${cx + abLeft} ${abStart} Q ${cx + abLeft - 2} ${abStart + rowH * 0.8} ${cx - 1} ${abStart + rowH} L ${cx - 1} ${abStart} Z` });
  muscles.push({ id: "abs", d: `M ${cx + abRight} ${abStart} Q ${cx + abRight + 2} ${abStart + rowH * 0.8} ${cx + 1} ${abStart + rowH} L ${cx + 1} ${abStart} Z` });
  for (let i = 1; i <= 3; i++) {
    const rowTop = abStart + rowH * i, rowBot = abStart + rowH * (i + 1);
    muscles.push({ id: "abs", d: `M ${cx - 1} ${rowTop} L ${cx + abLeft - 1} ${rowTop} Q ${cx + abLeft - 3} ${(rowTop + rowBot) / 2} ${cx + abLeft - 1} ${rowBot} L ${cx - 1} ${rowBot} Z` });
    muscles.push({ id: "abs", d: `M ${cx + 1} ${rowTop} L ${cx + abRight + 1} ${rowTop} Q ${cx + abRight + 3} ${(rowTop + rowBot) / 2} ${cx + abRight + 1} ${rowBot} L ${cx + 1} ${rowBot} Z` });
  }
  const oblInner = abLeft - 3, oblOuterL = -cw + 6, oblOuterW = -ww + 4;
  muscles.push({ id: "obliques", d: `M ${cx + oblInner} ${abStart + 2} L ${cx + oblOuterL * obl + 4} ${abStart + 4} C ${cx + oblOuterL * obl} ${Y.ribCage} ${cx + oblOuterW * obl} ${Y.waist + 4} ${cx + oblInner - 2} ${abEnd - 2} L ${cx + oblInner} ${abEnd} Z` });
  muscles.push({ id: "obliques", d: `M ${cx - oblInner} ${abStart + 2} L ${cx - oblOuterL * obl - 4} ${abStart + 4} C ${cx - oblOuterL * obl} ${Y.ribCage} ${cx - oblOuterW * obl} ${Y.waist + 4} ${cx - oblInner + 2} ${abEnd - 2} L ${cx - oblInner} ${abEnd} Z` });
  const quadTop = Y.hipBottom + 12, quadBot = Y.kneeTop - 6, quadOuter = th - 8;
  muscles.push({ id: "quads", d: `M ${cx - 6} ${quadTop} C ${cx - quadOuter} ${quadTop + 20} ${cx - quadOuter + 4} ${(quadTop + quadBot) / 2} ${cx - 18} ${quadBot} L ${cx - 6} ${quadBot} L ${cx - 6} ${quadTop} Z` });
  muscles.push({ id: "quads", d: `M ${cx + 6} ${quadTop} C ${cx + quadOuter} ${quadTop + 20} ${cx + quadOuter - 4} ${(quadTop + quadBot) / 2} ${cx + 18} ${quadBot} L ${cx + 6} ${quadBot} L ${cx + 6} ${quadTop} Z` });
  muscles.push({ id: "adductors", d: `M ${cx - 6} ${quadTop} L ${cx - 1} ${quadTop} L ${cx - 1} ${quadBot - 10} L ${cx - 7} ${quadBot - 10} Z` });
  muscles.push({ id: "adductors", d: `M ${cx + 6} ${quadTop} L ${cx + 1} ${quadTop} L ${cx + 1} ${quadBot - 10} L ${cx + 7} ${quadBot - 10} Z` });
  const calfTop = Y.kneeBottom + 6, calfBot = Y.ankle - 10;
  muscles.push({ id: "calves_front", d: `M ${cx - 22} ${calfTop} C ${cx - 25} ${calfTop + 20} ${cx - 24} ${calfBot - 10} ${cx - 20} ${calfBot} L ${cx - 10} ${calfBot} C ${cx - 10} ${calfBot - 10} ${cx - 12} ${calfTop + 20} ${cx - 14} ${calfTop} Z` });
  muscles.push({ id: "calves_front", d: `M ${cx + 22} ${calfTop} C ${cx + 25} ${calfTop + 20} ${cx + 24} ${calfBot - 10} ${cx + 20} ${calfBot} L ${cx + 10} ${calfBot} C ${cx + 10} ${calfBot - 10} ${cx + 12} ${calfTop + 20} ${cx + 14} ${calfTop} Z` });
  return muscles;
}

function buildBackMuscles(cfg, Y, cx) {
  const { chestHalfWidth: cw, waistHalfWidth: ww, hipHalfWidth: hw, thighOuter: th, shoulderHalfWidth: sw, armOuterOffset: aoff, glutesProminence: glute } = cfg;
  const muscles = [];
  muscles.push({ id: "traps", d: `M ${cx} ${Y.neckBottom + 2} C ${cx - 24} ${Y.shoulderPeak + 8} ${cx - 20} ${Y.armpit} ${cx} ${Y.armpit + 10} C ${cx + 20} ${Y.armpit} ${cx + 24} ${Y.shoulderPeak + 8} ${cx} ${Y.neckBottom + 2} Z` });
  const deltTop = Y.shoulderPeak + 4, deltBot = Y.armpit + 4;
  muscles.push({ id: "rear_delts", d: `M ${cx - sw + 4} ${deltTop} C ${cx - sw - aoff + 2} ${deltTop + 4} ${cx - sw - aoff} ${deltTop + 14} ${cx - sw - aoff + 2} ${deltBot} L ${cx - sw + 8} ${deltBot - 4} C ${cx - sw + 10} ${deltTop + 14} ${cx - sw + 8} ${deltTop + 4} ${cx - sw + 4} ${deltTop} Z` });
  muscles.push({ id: "rear_delts", d: `M ${cx + sw - 4} ${deltTop} C ${cx + sw + aoff - 2} ${deltTop + 4} ${cx + sw + aoff} ${deltTop + 14} ${cx + sw + aoff - 2} ${deltBot} L ${cx + sw - 8} ${deltBot - 4} C ${cx + sw - 10} ${deltTop + 14} ${cx + sw - 8} ${deltTop + 4} ${cx + sw - 4} ${deltTop} Z` });
  const latTop = Y.armpit + 8, latBot = Y.ribCage + 40;
  muscles.push({ id: "lats", d: `M ${cx - 22} ${latTop} C ${cx - cw + 2} ${latTop + 10} ${cx - cw - 2} ${Y.ribCage} ${cx - ww + 4} ${latBot} L ${cx - 8} ${latBot} L ${cx - 8} ${latTop + 4} Z` });
  muscles.push({ id: "lats", d: `M ${cx + 22} ${latTop} C ${cx + cw - 2} ${latTop + 10} ${cx + cw + 2} ${Y.ribCage} ${cx + ww - 4} ${latBot} L ${cx + 8} ${latBot} L ${cx + 8} ${latTop + 4} Z` });
  const tricepTop = deltBot + 6, tricepBot = Y.ribCage + 16;
  muscles.push({ id: "triceps", d: `M ${cx - sw - aoff - 4} ${tricepTop} C ${cx - sw - aoff - 10} ${tricepTop + 24} ${cx - sw - aoff - 8} ${tricepBot - 6} ${cx - sw - aoff} ${tricepBot} L ${cx - sw - aoff + 8} ${tricepBot - 2} C ${cx - sw - aoff + 10} ${tricepTop + 24} ${cx - sw - aoff + 4} ${tricepTop + 6} ${cx - sw - aoff - 4} ${tricepTop} Z` });
  muscles.push({ id: "triceps", d: `M ${cx + sw + aoff + 4} ${tricepTop} C ${cx + sw + aoff + 10} ${tricepTop + 24} ${cx + sw + aoff + 8} ${tricepBot - 6} ${cx + sw + aoff} ${tricepBot} L ${cx + sw + aoff - 8} ${tricepBot - 2} C ${cx + sw + aoff - 10} ${tricepTop + 24} ${cx + sw + aoff - 4} ${tricepTop + 6} ${cx + sw + aoff + 4} ${tricepTop} Z` });
  const farmTop = tricepBot, farmBot = Y.hipTop + 36;
  muscles.push({ id: "forearms", d: `M ${cx - sw - aoff - 2} ${farmTop} C ${cx - sw - aoff - 12} ${farmTop + 20} ${cx - sw - aoff - 14} ${farmBot - 10} ${cx - sw - aoff - 8} ${farmBot} L ${cx - sw - aoff + 6} ${farmBot - 2} C ${cx - sw - aoff + 8} ${farmTop + 20} ${cx - sw - aoff + 8} ${farmTop + 4} ${cx - sw - aoff - 2} ${farmTop} Z` });
  muscles.push({ id: "forearms", d: `M ${cx + sw + aoff + 2} ${farmTop} C ${cx + sw + aoff + 12} ${farmTop + 20} ${cx + sw + aoff + 14} ${farmBot - 10} ${cx + sw + aoff + 8} ${farmBot} L ${cx + sw + aoff - 6} ${farmBot - 2} C ${cx + sw + aoff - 8} ${farmTop + 20} ${cx + sw + aoff - 8} ${farmTop + 4} ${cx + sw + aoff + 2} ${farmTop} Z` });
  muscles.push({ id: "lower_back", d: `M ${cx - 10} ${latBot + 2} Q ${cx - 12} ${Y.hipTop - 10} ${cx - 8} ${Y.hipTop + 4} L ${cx + 8} ${Y.hipTop + 4} Q ${cx + 12} ${Y.hipTop - 10} ${cx + 10} ${latBot + 2} Z` });
  const gluteTop = Y.hipTop + 6, gluteBot = Y.hipBottom + 6, gluteOuter = hw - 2;
  muscles.push({ id: "glutes", d: `M ${cx - 3} ${gluteTop} C ${cx - gluteOuter * glute} ${gluteTop + 4} ${cx - gluteOuter * glute} ${gluteBot - 8} ${cx - 10} ${gluteBot} L ${cx - 2} ${gluteBot - 6} L ${cx - 2} ${gluteTop + 4} Z` });
  muscles.push({ id: "glutes", d: `M ${cx + 3} ${gluteTop} C ${cx + gluteOuter * glute} ${gluteTop + 4} ${cx + gluteOuter * glute} ${gluteBot - 8} ${cx + 10} ${gluteBot} L ${cx + 2} ${gluteBot - 6} L ${cx + 2} ${gluteTop + 4} Z` });
  const hamTop = gluteBot + 4, hamBot = Y.kneeTop - 4, hamOuter = th - 8;
  muscles.push({ id: "hamstrings", d: `M ${cx - 6} ${hamTop} C ${cx - hamOuter} ${hamTop + 20} ${cx - hamOuter + 4} ${(hamTop + hamBot) / 2} ${cx - 18} ${hamBot} L ${cx - 6} ${hamBot} L ${cx - 6} ${hamTop} Z` });
  muscles.push({ id: "hamstrings", d: `M ${cx + 6} ${hamTop} C ${cx + hamOuter} ${hamTop + 20} ${cx + hamOuter - 4} ${(hamTop + hamBot) / 2} ${cx + 18} ${hamBot} L ${cx + 6} ${hamBot} L ${cx + 6} ${hamTop} Z` });
  const calfTop = Y.kneeBottom + 6, calfBot = Y.ankle - 10;
  muscles.push({ id: "calves_back", d: `M ${cx - 16} ${calfTop} C ${cx - 24} ${calfTop + 20} ${cx - 22} ${calfBot - 20} ${cx - 14} ${calfBot} L ${cx - 6} ${calfBot} C ${cx - 8} ${calfBot - 20} ${cx - 8} ${calfTop + 20} ${cx - 10} ${calfTop} Z` });
  muscles.push({ id: "calves_back", d: `M ${cx + 16} ${calfTop} C ${cx + 24} ${calfTop + 20} ${cx + 22} ${calfBot - 20} ${cx + 14} ${calfBot} L ${cx + 6} ${calfBot} C ${cx + 8} ${calfBot - 20} ${cx + 8} ${calfTop + 20} ${cx + 10} ${calfTop} Z` });
  return muscles;
}

// Lazy cache — building the SVG paths at module-init time meant the
// `const BODY_PATHS = { male: buildBody(VARIANT_CONFIGS.male, false), ... }`
// initializer invoked buildBody / buildFront / buildBack BEFORE Rollup
// had decided their final order in the production bundle. When the
// minifier hoists this const above VARIANT_CONFIGS (it has done so in
// one round of audits when an adjacent statement was added), the
// initializer reads VARIANT_CONFIGS in TDZ → `ReferenceError: Cannot
// access 'VARIANT_CONFIGS' before initialization`. Building on first
// use side-steps the ordering question entirely.
let _bodyPathsCache = null;
function getBodyPaths() {
  if (_bodyPathsCache) return _bodyPathsCache;
  _bodyPathsCache = {
    male:   { front: buildBody(VARIANT_CONFIGS.male,   false), back: buildBody(VARIANT_CONFIGS.male,   true) },
    female: { front: buildBody(VARIANT_CONFIGS.female, false), back: buildBody(VARIANT_CONFIGS.female, true) },
    unisex: { front: buildBody(VARIANT_CONFIGS.unisex, false), back: buildBody(VARIANT_CONFIGS.unisex, true) },
  };
  return _bodyPathsCache;
}

const styles = {
  container: { width: "100%", background: "hsl(var(--card))", color: "hsl(var(--card-foreground))", borderRadius: 16, padding: 24, fontFamily: "'Inter', system-ui, sans-serif", boxSizing: "border-box", border: "1px solid hsl(var(--border))" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 20 },
  eyebrow: { fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 4 },
  title: { margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em", color: "hsl(var(--foreground))" },
  controls: { display: "flex", gap: 10, flexWrap: "wrap" },
  segmented: { display: "inline-flex", background: "hsl(var(--secondary))", borderRadius: 10, padding: 3, border: "1px solid hsl(var(--border))" },
  segBtn: { background: "transparent", border: "none", color: "hsl(var(--muted-foreground))", padding: "7px 14px", fontSize: 13, fontWeight: 500, borderRadius: 8, cursor: "pointer", transition: "all 150ms" },
  segBtnActive: { background: "hsl(var(--foreground))", color: "hsl(var(--background))" },
  emptyMsg: { background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "hsl(var(--muted-foreground))", marginBottom: 16, textAlign: "center" },
  stage: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 260px", gap: 20, alignItems: "stretch" },
  diagramWrap: { background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", borderRadius: 12, padding: 16, display: "flex", justifyContent: "center", alignItems: "center", minHeight: 480 },
  svg: { width: "100%", maxWidth: 280, height: "auto", display: "block" },
  sidebar: { display: "flex", flexDirection: "column", gap: 12 },
  card: { background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))", borderRadius: 12, padding: 16 },
  cardLabel: { fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 6 },
  cardTitle: { fontSize: 18, fontWeight: 600, marginBottom: 12, color: "hsl(var(--foreground))" },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 },
  stat: { background: "hsl(var(--background))", borderRadius: 8, padding: "8px 6px", textAlign: "center" },
  statValue: { fontSize: 16, fontWeight: 600, color: "hsl(var(--foreground))" },
  statLabel: { fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 2, letterSpacing: "0.05em" },
  detailBtn: { marginTop: 12, width: "100%", background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--muted-foreground))", padding: "8px 12px", fontSize: 13, cursor: "pointer", textAlign: "center" },
  legendBar: { marginTop: 4 },
  legendGradient: { height: 10, borderRadius: 5, background: "linear-gradient(90deg, #2a2f3a 0%, #1e4d6b 15%, #3a9b7a 40%, #e8a33d 70%, #d64545 100%)" },
  legendLabels: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 6 },
  legendNote: { fontSize: 11, color: "hsl(var(--muted-foreground))", lineHeight: 1.5, marginTop: 10 }
};