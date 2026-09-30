// src/lib/aiCoach/starterPlanCoach.js
//
// The AI Coach's write-up of the starter plan, for the end of onboarding.
//
// ── What this does and does NOT do ──────────────────────────────────────────
//
// It does NOT choose the exercises. `buildStarterRegimen` still does that, and
// has to: the plan is persisted as a real regimen, it has to survive an injury
// filter and an age cap, and it has to be reproducible. That is the same split
// the Coach already runs everywhere else — see the header of `coach.js`, where
// the model supplies the goal and the deterministic builder supplies the
// session. Onboarding is the same shape with the goal already known.
//
// What it DOES do is answer the question the reveal screen has never answered:
// why this plan, for this person. Every number on that screen came from ten
// form steps, and until now the only thing tying them together was a templated
// sentence. Two sentences from a model that read the whole picture — the goal,
// the level, the days, the injuries, the assessment — is the difference
// between "here is a plan" and "here is your plan, and here is why".
//
// ── Every failure is soft ───────────────────────────────────────────────────
//
// `coachChat.js` states this as its contract and onboarding needs it more than
// anywhere else: a user finishing signup must not be blocked by an Edge
// Function that isn't deployed, an unset API key, a daily cap, or a phone on a
// train. Nothing here throws. A failure returns { ok: false } and the reveal
// step renders exactly what it rendered before this existed.

import { askCoachLLM } from '@/lib/data/coachChat';

// Shorter than the chat default (12 s). This one sits inside the onboarding
// loading screen, which the user is already watching a progress list on —
// past about eight seconds the honest move is to show them their plan.
const TIMEOUT_MS = 8_000;

const KG_TO_LB = 2.20462;

const STARTER_KIT_PHRASES = {
  gym:        'a full gym',
  dumbbells:  'dumbbells only',
  minimal:    'minimal equipment (a band, a bench and a pull-up bar)',
  bodyweight: 'bodyweight only, no equipment',
};

const GOAL_PHRASES = {
  strength:  'build strength',
  muscle:    'add muscle',
  lose:      'lose fat',
  speed:     'run faster',
  endurance: 'run further',
  mobility:  'move better',
};

/**
 * Onboarding answers → the digest shape `formatDigest` in the Edge Function
 * knows how to read. Anything it has no formatter for is dropped there, so
 * inventing fields here would silently ship nothing.
 *
 * There is deliberately no `training`, `topLifts` or `streaks` block: this
 * user has none. The system prompt reads a sparse digest as "new user" and
 * says so plainly, which is the correct thing for it to do here.
 */
export function buildOnboardingContext(draft = {}) {
  const stats = draft.stats || {};
  const goals = (Array.isArray(draft.goal) ? draft.goal : [draft.goal])
    .filter(Boolean)
    .map((g) => GOAL_PHRASES[g] || g);

  // Every injury the user reported, at every severity. This used to drop the
  // mild ones, because buildStarterRegimen kept a mild region with a caution
  // note and naming it would have had the coach announce it was avoiding work
  // the card visibly contained. The plan now excludes mild too, so the reason
  // is gone — and leaving the filter in would invert the original bug: the
  // coach would talk about training a region the plan had just removed.
  const avoid = (Array.isArray(draft.onboardingInjuries) ? draft.onboardingInjuries : [])
    .map((i) => i && i.muscleGroup)
    .filter(Boolean);

  const profile = {
    sex: stats.gender || undefined,
    age: Number.isFinite(stats.age) ? stats.age : undefined,
    bodyweightLb: Number.isFinite(stats.weightKg)
      ? Math.round(stats.weightKg * KG_TO_LB)
      : undefined,
    skillLevel: draft.level || undefined,
    goals: goals.length ? goals : undefined,
    trainingDaysPerWeek: Array.isArray(draft.days) && draft.days.length
      ? draft.days.length
      : undefined,
  };

  return {
    profile,
    ...(avoid.length ? { injuries: { avoidMuscleGroups: avoid } } : {}),
  };
}

/**
 * Ask the Coach to introduce this user's starter plan.
 *
 * @param {object} draft     the onboarding answers (the page's `data`)
 * @param {string} language  app language code
 * @returns {Promise<{ok: true, reply: string, model: string|null}
 *                  | {ok: false, error: string}>}
 */
export async function askStarterPlanCoach({ draft = {}, language = 'en' } = {}) {
  const goals = (Array.isArray(draft.goal) ? draft.goal : [draft.goal])
    .filter(Boolean)
    .map((g) => GOAL_PHRASES[g] || g);

  // Phrased as a build request on purpose. The function's system prompt routes
  // "make me a…/build me a…" to kind='plan', and the plan branch is the one
  // that forbids naming specific exercises, sets and reps — which is exactly
  // the guarantee this screen needs, because the card underneath is the real
  // plan and prose that contradicted it would be worse than no prose.
  // Equipment and session length go in the MESSAGE, not the digest: the
  // Edge Function's formatDigest has no formatter for them and would drop
  // them silently. Said here, the write-up can't promise a barbell to someone
  // training at home.
  const kit = STARTER_KIT_PHRASES[draft.sharpen?.equipment];
  const mins = Number(draft.sharpen?.sessionMinutes);
  const constraints = [
    kit ? ` I train with ${kit}.` : '',
    mins > 0 ? ` I have about ${mins} minutes per session.` : '',
  ].join('');
  const message = (goals.length
    ? `Build me my starter training plan. My goal is to ${goals.join(' and ')}.`
    : 'Build me my starter training plan.') + constraints;

  let res;
  try {
    res = await askCoachLLM({
      message,
      history: [],
      context: buildOnboardingContext(draft),
      language,
      timeoutMs: TIMEOUT_MS,
      // Its own short Haiku prompt and its own quota, so the write-up no
      // longer spends one of a guest's five chat messages (coach-chat).
      purpose: 'starter_intro',
    });
  } catch (err) {
    // askCoachLLM does not throw, but onboarding is the wrong place to find
    // out that changed.
    return { ok: false, error: 'NETWORK' };
  }

  // `!res?.ok`, not `!res.ok`. askCoachLLM returns an object on every path it
  // has today, but this is the last screen of signup — a shape change there
  // must degrade to "no coach write-up", not throw a TypeError into the
  // loading step and strand the user one tap from the dashboard.
  if (!res?.ok) return { ok: false, error: res?.error || 'EMPTY' };

  // kind='answer' means the model read this as a general question and its
  // reply is free to name lifts, sets and reps — which the card below did not
  // generate and may well contradict. A plan whose description disagrees with
  // its own contents is worse than one with no description, so we fall back.
  if (res.kind !== 'plan') return { ok: false, error: 'NOT_A_PLAN' };

  const reply = String(res.reply || '').trim();
  if (!reply) return { ok: false, error: 'EMPTY_REPLY' };

  // `model` is not rendered anywhere — the reveal used to attribute the
  // write-up on screen and no longer does (see StarterPlanCoachCard). It stays
  // on the return because it is what actually answered, which is the thing you
  // want in hand when a reply reads oddly and the Edge Function's MODEL
  // constant has moved since.
  return { ok: true, reply, model: res.model || null };
}
