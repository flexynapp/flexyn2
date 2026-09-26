// Tags for a finished session, read from what was actually trained, so the
// finish sheet opens with them already picked instead of an empty chip row
// most people skip. The ids are WORKOUT_TAGS ids (components/workout/
// WorkoutTags.jsx). The lifter can still add or remove any of them.

const MUSCLE_TO_TAG = {
  chest: 'chest',
  back: 'back', lats: 'back', traps: 'back',
  shoulders: 'shoulders',
  biceps: 'biceps', forearms: 'biceps',
  triceps: 'triceps',
  legs: 'legs', quads: 'legs', hamstrings: 'legs', glutes: 'legs', calves: 'legs',
  core: 'core', abs: 'core', obliques: 'core',
};

const PUSH = new Set(['chest', 'shoulders', 'triceps']);
const PULL = new Set(['back', 'biceps']);

function musclesOf(ex) {
  if (Array.isArray(ex.muscle_groups) && ex.muscle_groups.length) return ex.muscle_groups;
  if (Array.isArray(ex.muscles) && ex.muscles.length) return ex.muscles;
  return ex.muscle_group ? [ex.muscle_group] : [];
}

export function deriveWorkoutTags(exercises = []) {
  const body = new Set();
  let cardio = false;
  for (const ex of exercises) {
    if (ex.kind === 'cardio') { cardio = true; continue; }
    for (const m of musclesOf(ex)) {
      const key = String(m).toLowerCase().replace(/\s+/g, '');
      if (key === 'fullbody') body.add('full_body');
      else if (MUSCLE_TO_TAG[key]) body.add(MUSCLE_TO_TAG[key]);
    }
  }

  const tags = [];
  const upper = [...body].filter((t) => PUSH.has(t) || PULL.has(t));
  const hasLegs = body.has('legs');
  if (body.has('full_body') || (hasLegs && upper.length >= 2)) {
    tags.push('full_body');
  } else if (upper.length && upper.every((t) => PUSH.has(t))) {
    tags.push('push');
  } else if (upper.length && upper.every((t) => PULL.has(t))) {
    tags.push('pull');
  }
  // Name at most three body parts; past that the row says nothing the
  // split tag doesn't.
  const parts = ['chest', 'back', 'legs', 'shoulders', 'biceps', 'triceps', 'core'].filter((t) => body.has(t));
  tags.push(...parts.slice(0, 3));
  if (cardio) tags.push('cardio');
  return tags;
}
