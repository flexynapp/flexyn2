// src/lib/aiCoach/followUps.js
//
// Contextual follow-up chips for the coach's prompt strip.
//
// The strip used to show the same six static prompts before and after every
// reply, which is the worst moment for them: once the coach has handed you a
// workout, "Train for a faster 5K" is not the next thing you want. The next
// thing you want is *this* workout, shorter — or without a barbell.
//
// ── Why the chips carry their own message text ──────────────────────────────
//
// Every message is parsed independently; `askCoach` holds no conversation
// state, so "make it 45 minutes" on its own parses to nothing at all. A chip
// therefore ships a `send` string that re-encodes the WHOLE request — goal,
// duration, equipment — with one field changed. The label stays short ("45
// min"); the message is what actually round-trips.
//
// ── Why the phrasing looks stilted ──────────────────────────────────────────
//
// Each `send` string is written to satisfy three independent matchers at once,
// and the shape is load-bearing:
//
//   • intents.js needs "give me a workout" / "build me a … plan" with the noun
//     within ~24 chars of the verb, or the message never reaches buildCoachPlan.
//   • parseWorkoutGoal checks planCue BEFORE sessionCue, so a session message
//     must contain "today" and must NOT contain plan/program/routine/weekly.
//   • detectDuration / detectEquipment / the goal patterns each need their own
//     keyword present.
//
// followUps.test.js asserts the round trip for every chip this can emit, so a
// change to any of those matchers fails here rather than silently degrading a
// chip into a coach shrug.

// Goal → a phrase that re-triggers the same goal in parseWorkoutGoal.
// Cardio goals are absent on purpose: they always build a weekly plan, so
// there is no session variant of them to offer.
const GOAL_PHRASE = {
  compete:  'max points for my crew war',
  strength: 'get stronger',
  muscle:   'build muscle',
  lose:     'lose fat',
  mobility: 'move better',
  general:  '',
};

const EQUIPMENT_PHRASE = {
  gym:        'full gym',
  dumbbells:  'dumbbells only',
  minimal:    'minimal equipment',
  bodyweight: 'bodyweight only',
};

const EQUIPMENT_LABEL = {
  gym:        'Full gym',
  dumbbells:  'Dumbbells only',
  minimal:    'Minimal kit',
  bodyweight: 'Bodyweight only',
};

const DURATIONS = [30, 45, 60, 90];

/** The goal clause for a message, preferring the specific lift when there is one. */
function goalClause(parsed) {
  if (parsed?.goal === 'strength' && parsed.lift) return `pr my ${parsed.lift.toLowerCase()}`;
  return GOAL_PHRASE[parsed?.goal] ?? '';
}

/**
 * A single-session request carrying the full context.
 * "give me a workout for today — max points for my crew war, 60 minutes, full gym"
 */
function sessionMessage(parsed, { minutes, equipment }) {
  const parts = [goalClause(parsed), `${minutes} minutes`, EQUIPMENT_PHRASE[equipment] || EQUIPMENT_PHRASE.gym]
    .filter(Boolean);
  return `give me a workout for today — ${parts.join(', ')}`;
}

/** A weekly-plan request carrying the goal. */
function planMessage(parsed) {
  const goal = goalClause(parsed);
  return goal ? `build me a weekly plan — ${goal}` : 'build me a weekly plan';
}

/**
 * Follow-up chips for the coach's most recent plan.
 *
 * @param   {object|null} plan  a CoachChat message's `plan` payload
 * @returns {Array<{ id: string, text: string, send: string }>}
 *          `text` is the chip label; `send` is the message to submit.
 *          Empty for anything we can't offer a verified follow-up on — the
 *          caller falls back to its static prompts.
 */
export function followUpsFor(plan) {
  const parsed = plan?.parsed;
  if (!parsed) return [];

  const chips = [];

  if (plan.kind === 'session') {
    const minutes = DURATIONS.includes(plan.workout?.duration_minutes)
      ? plan.workout.duration_minutes
      : parsed.durationMinutes;
    const equipment = parsed.equipment || 'gym';

    // One shorter and one longer, so the pair reads as a dial rather than a
    // menu. At an end of the range only one of them exists.
    const shorter = [...DURATIONS].reverse().find(d => d < minutes);
    const longer = DURATIONS.find(d => d > minutes);
    for (const d of [shorter, longer]) {
      if (d == null) continue;
      chips.push({
        id: `dur_${d}`,
        text: `${d} min`,
        send: sessionMessage(parsed, { minutes: d, equipment }),
      });
    }

    // Equipment: from a full gym the useful moves are downward (the gym isn't
    // available); from anything else the useful move is back to the gym.
    const equipAlts = equipment === 'gym' ? ['dumbbells', 'bodyweight'] : ['gym'];
    for (const e of equipAlts) {
      chips.push({
        id: `equip_${e}`,
        text: EQUIPMENT_LABEL[e],
        send: sessionMessage(parsed, { minutes, equipment: e }),
      });
    }

    // Always available: a session answers "what do I do in the next hour",
    // and the natural next question is "…and for the rest of the week". With
    // no goal named, planMessage falls back to a bare weekly-plan ask, which
    // buildStarterRegimen serves fine.
    chips.push({ id: 'as_plan', text: 'Make it a weekly plan', send: planMessage(parsed) });
  } else if (plan.kind === 'plan') {
    // The inverse move: a plan is the week, and the question it leaves open is
    // what to actually do in the next hour.
    chips.push({
      id: 'today',
      // A cardio plan has no session form, so this one is honestly generic.
      text: "Just today's workout",
      send: sessionMessage(parsed, {
        minutes: parsed.durationMinutes || 45,
        equipment: parsed.equipment || 'gym',
      }),
    });
  }

  return chips;
}
