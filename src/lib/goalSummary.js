// src/lib/goalSummary.js
//
// One line naming a goal's target ("Bench Press 225 lb × 5", "running 5000m").
// Lived inside GoalsModal for the first-goal celebration; Today's goal card
// needs the same words, and GoalsModal is now lazy-loaded, so importing it
// from there would pull the whole modal into the Today chunk.
//
// target_weight is stored canonically in lbs, so it is converted to the
// viewer's unit (formatWeight adds the kg/lb/st label).

import { formatWeight } from '@/lib/weightUnit';

export function summarizeGoalTarget(g, weightUnit) {
  if (!g) return '';
  if (g.goal_type === 'cardio_distance' && g.target_distance_meters) {
    return `${g.cardio_activity || 'Cardio'} ${Math.round(g.target_distance_meters)}m`;
  }
  if (g.goal_type === 'cardio_duration' && g.target_duration_seconds) {
    return `${g.cardio_activity || 'Cardio'} ${Math.round(g.target_duration_seconds / 60)} min`;
  }
  if (g.goal_type === 'cardio_sessions' && g.target_sessions) {
    return `${g.cardio_activity || 'Cardio'} ${g.target_sessions}× / ${g.period || 'period'}`;
  }
  // Strength
  const name = g.exercise_name || 'lift';
  const w = g.target_weight != null ? formatWeight(g.target_weight, weightUnit) : null;
  if (w && g.target_reps) return `${name} ${w} × ${g.target_reps}`;
  if (w) return `${name} ${w}`;
  if (g.target_reps)   return `${name} ${g.target_reps} rep${g.target_reps === 1 ? '' : 's'}`;
  return name;
}
