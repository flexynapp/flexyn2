// src/components/workout/WorkoutTags.jsx
//
// Colored muscle-group / session tags for workouts. A curated set (legs, back,
// chest, tris, …) each with its own hue, plus a display pill and a picker.
// Tags are stored as a string[] on the workout log (workout_logs.tags).
import { useLanguage } from '@/lib/LanguageContext';


export const WORKOUT_TAGS = [
  { id: 'chest',     label: 'Chest',     hue: '0 84% 60%' },
  { id: 'back',      label: 'Back',      hue: '217 91% 60%' },
  { id: 'legs',      label: 'Legs',      hue: '142 71% 45%' },
  { id: 'shoulders', label: 'Shoulders', hue: '38 92% 50%' },
  { id: 'biceps',    label: 'Bis',       hue: '271 81% 56%' },
  { id: 'triceps',   label: 'Tris',      hue: '330 81% 60%' },
  { id: 'core',      label: 'Core',      hue: '190 90% 45%' },
  { id: 'push',      label: 'Push',      hue: '25 95% 53%' },
  { id: 'pull',      label: 'Pull',      hue: '199 89% 48%' },
  { id: 'full_body', label: 'Full Body', hue: '160 84% 39%' },
  { id: 'cardio',    label: 'Cardio',    hue: '349 89% 60%' },
];

const BY_ID = Object.fromEntries(WORKOUT_TAGS.map(t => [t.id, t]));
export const getTag = (id) => BY_ID[id] || null;

/** Small colored pill for displaying a tag on a card. */
export function TagPill({ id, label, hue, className = '' }) {
  const { tFallback } = useLanguage();
  const def = id ? getTag(id) : { label, hue };
  if (!def) return null;
  const h = hue || def.hue;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-micro font-bold leading-none ${className}`}
      style={{ background: `hsl(${h} / 0.14)`, color: `hsl(${h})` }}
    >
      {def.id ? tFallback(`workoutTag.${def.id}`, def.label) : (def.label || label)}
    </span>
  );
}

/** Row of tag pills (deduped, in canonical order). */
export function TagPillRow({ tags = [], className = '' }) {
  const set = new Set(tags);
  const ordered = WORKOUT_TAGS.filter(t => set.has(t.id));
  if (ordered.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {ordered.map(t => <TagPill key={t.id} id={t.id} />)}
    </div>
  );
}

/** Multi-select tag picker — tap to toggle. `value` is a string[] of tag ids. */
export function TagSelector({ value = [], onChange }) {
  const selected = new Set(value);
  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(WORKOUT_TAGS.filter(t => next.has(t.id)).map(t => t.id)); // canonical order
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {WORKOUT_TAGS.map(t => {
        const on = selected.has(t.id);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => toggle(t.id)}
            aria-pressed={on}
            className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold border transition-colors"
            style={on
              ? { background: `hsl(${t.hue} / 0.16)`, color: `hsl(${t.hue})`, borderColor: `hsl(${t.hue} / 0.4)` }
              : { borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
