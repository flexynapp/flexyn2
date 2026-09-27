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
  // without them (20260927180000). It reads as its own kind.
  if (mode === 'session') return tFallback('duel.type.session.name', 'Session Duel');
  const key = type in TYPE_NAME ? type : 'open';
  return tFallback(`duel.type.${key}.name`, TYPE_NAME[key]);
}

export function duelStatusName(status, tFallback) {
  const key = status in STATUS_NAME ? status : 'expired';
  return tFallback(`duels.status.${key}`, STATUS_NAME[key]);
}

/** Total prescribed sets in a Mirror duel's template. */
export function templateSetCount(template) {
  return (template?.exercises || []).reduce((n, ex) => n + (ex.sets?.length || 0), 0);
}
