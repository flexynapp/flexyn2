// src/components/duels/duelLabels.js
// The words for a duel's type and status, in one place, so the list, the
// detail sheet and the invite card cannot drift apart or print the raw enum
// ("open", "pending") the way the list and the sheet used to.

const TYPE_NAME = {
  open:     'Open Duel',
  mirror:   'Mirror Duel',
  exercise: 'Exercise Duel',
};

const STATUS_NAME = {
  pending:   'Pending',
  active:    'Active',
  completed: 'Complete',
  declined:  'Declined',
  expired:   'Expired',
};

export function duelTypeName(type, tFallback, mode) {
  // A session duel is a Mirror against the opponent's last workout, started
  // without them (20260927184500). It reads as its own kind.
  if (mode === 'session') return tFallback('duel.type.session.name', 'Session Duel');
  const key = type in TYPE_NAME ? type : 'open';
  return tFallback(`duel.type.${key}.name`, TYPE_NAME[key]);
}

export function duelStatusName(status, tFallback) {
  const key = status in STATUS_NAME ? status : 'expired';
  return tFallback(`duels.status.${key}`, STATUS_NAME[key]);
}

/**
 * A Mirror template's exercises as the server scores them: named exercises
 * and the sets that carry reps (_duel_mirror_metrics, 20260928061000). An
 * empty set row or an unnamed exercise is not something anyone can finish,
 * so listing it would show a target nobody can reach.
 */
export function templateExercises(template) {
  return (template?.exercises || [])
    .map((ex) => ({
      name: String(ex?.name ?? '').trim(),
      sets: (Array.isArray(ex?.sets) ? ex.sets : [])
        .filter((s) => typeof s?.reps === 'number' && s.reps > 0).length,
    }))
    .filter((ex) => ex.name && ex.sets > 0);
}

/** Total prescribed sets in a Mirror duel's template. */
export function templateSetCount(template) {
  return templateExercises(template).reduce((n, ex) => n + ex.sets, 0);
}

// What a finished duel paid its winner (20260928070000). The server records
// either {capsule: 'elite'} or {withheld: <reason>} on the duel; this turns
// that into the line the winner reads. Null when there is nothing to say:
// no prize column yet (a duel finished before prizes existed) or a reason
// this build does not know.
const WITHHELD = {
  walkover:    ['duels.prize.walkover',   'No prize this time. Your rival never trained.'],
  daily_limit: ['duels.prize.dailyLimit', 'No prize this time. You already won one today.'],
  pair_limit:  ['duels.prize.pairLimit',  'No prize this time. You already won one against this lifter this week.'],
  session:     ['duels.prize.session',    'Session Duels pay no prize.'],
  error:       ['duels.prize.error',      'The prize could not be paid.'],
};

export function duelPrize(prize, tFallback) {
  if (!prize || typeof prize !== 'object') return null;
  if (prize.capsule === 'elite') {
    return { paid: true, text: tFallback('duels.prize.elite', 'Elite capsule earned') };
  }
  const entry = WITHHELD[prize.withheld];
  return entry ? { paid: false, text: tFallback(entry[0], entry[1]) } : null;
}
