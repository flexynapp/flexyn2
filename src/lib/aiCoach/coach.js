// src/lib/aiCoach/coach.js
//
// Main entry point for the AI Coach.
//
// The routing decision used to be a scored regex table (intents.js) picking
// one of ~20 canned responders. That answers the twenty questions it knows and
// is confidently wrong on everything else — "I want to gain weight lean to get
// to 190, what should my nutrition plan be?" matched the generation pattern at
// score 12 and got handed a barbell program with no acknowledgement that the
// question was about food.
//
// So the pipeline is now:
//
//   1. askCoachLLM(...)  → the `coach-chat` Edge Function reads the question,
//      the recent thread and a digest of the user's real training data, then
//      either answers it or says "this is a build-me-a-session request".
//   2. If it asked for a plan → buildCoachPlan() runs locally, exactly as
//      before. A generated session stays deterministic and saveable; the model
//      supplies the goal, not the exercises.
//   3. On ANY failure — function not deployed, no API key, offline, daily cap
//      — fall through to the original detectIntent → respond() pipeline.
//
// Step 3 is not a nicety. The Coach has shipped working without an Anthropic
// key since launch and that stays true: with nothing deployed, this file
// behaves exactly as it did before, one wasted invoke aside (and coachChat.js
// latches that after the first 404).

import { detectIntent, INTENTS } from './intents';
import { respond } from './responders';
import { buildCoachPlan } from './planBuilder';
import { askCoachLLM } from '@/lib/data/coachChat';

/**
 * Ask the coach something. Returns:
 *   { reply, intent, source: 'llm' | 'plan' | 'rules', plan?, capped? }
 * When the user asks for a tailored workout/plan, `plan` carries a saveable
 * payload the chat renders as an interactive card.
 *
 * @param {object} user
 * @param {string} message
 * @param {object} ctx
 * @param {object} [ctx.profile]              already-fetched profile
 * @param {string[]} [ctx.excludeMuscleGroups] from active injuries
 * @param {object} [ctx.coachContext]         training digest for the LLM
 * @param {Array}  [ctx.history]              prior turns [{role, text}]
 * @param {string} [ctx.language]             app language code
 * @param {boolean} [ctx.llm]                 set false to force the rules path
 */
export async function askCoach(user, message, ctx = {}) {
  if (ctx.llm !== false) {
    const llm = await askCoachLLM({
      message,
      history:  ctx.history || [],
      context:  ctx.coachContext || {},
      language: ctx.language || 'en',
    });

    if (llm.ok && llm.kind === 'plan') {
      // The model decided this is a generation request and restated the goal;
      // the deterministic builder still produces the session. Its own intro
      // copy is replaced by the model's, which is written for what the user
      // actually asked rather than assembled from templates.
      try {
        const { reply, plan } = await buildCoachPlan({
          user,
          message: llm.goal || message,
          profile: ctx.profile || {},
          excludeMuscleGroups: ctx.excludeMuscleGroups,
          // The model writes the intro copy on this path, but the plan's
          // NOTES still come from trainingModifiers and need the language.
          t: ctx.t,
          language: ctx.language,
        });
        return {
          reply: llm.reply || reply,
          intent: { id: INTENTS.GENERATE_PLAN, score: 12, params: { raw: message } },
          source: 'plan',
          plan,
        };
      } catch (err) {
        // The builder failed, but the model's intro is still a real answer to
        // a real question — better than the generic "couldn't build that"
        // string, and it keeps the turn from looking broken.
        console.warn('[aiCoach] plan generation failed after LLM handoff:', err);
        return {
          reply: llm.reply,
          intent: { id: INTENTS.GENERATE_PLAN, score: 12, params: { raw: message } },
          source: 'llm',
        };
      }
    }

    if (llm.ok) {
      return {
        reply: llm.reply,
        // detectIntent is still run for the caller's benefit (follow-up chips
        // and analytics key off it) but it no longer decides the answer.
        intent: detectIntent(message),
        source: 'llm',
      };
    }

    // RATE_LIMIT is the one failure worth telling the user about — everything
    // else degrades silently. The rules answer still goes out; `capped` lets
    // the UI add a one-line note so a suddenly-more-basic coach isn't just
    // unexplained.
    if (llm.error === 'RATE_LIMIT') {
      const fallback = await _rulesReply(user, message, ctx);
      return { ...fallback, capped: true };
    }
  }

  return await _rulesReply(user, message, ctx);
}

/**
 * The original rule-based pipeline, unchanged in behaviour. Used whenever the
 * language model is unavailable, and directly by tests that pin the offline
 * contract.
 */
async function _rulesReply(user, message, ctx = {}) {
  const intent = detectIntent(message);

  // Workout/plan generation short-circuits the advice pipeline: we build a
  // concrete plan locally and attach it to the reply.
  if (intent.id === INTENTS.GENERATE_PLAN) {
    try {
      // ctx carries the caller's already-fetched profile and injury
      // exclusions, so the chat path personalizes the same way Quick pick
      // does. Passed in rather than fetched here to keep this module free of
      // @/api/db's auth side effect (see CLAUDE.md, Profile cache).
      const { reply, plan } = await buildCoachPlan({
        user,
        message,
        profile: ctx.profile || {},
        excludeMuscleGroups: ctx.excludeMuscleGroups,
        t: ctx.t,
        language: ctx.language,
      });
      return { reply, intent, source: 'plan', plan };
    } catch (err) {
      console.warn('[aiCoach] plan generation failed:', err);
      return {
        reply: "I couldn't build that plan just now — try rephrasing the goal (e.g. \"train for a faster 5K\" or \"help me PR my bench\").",
        intent,
        source: 'rules',
      };
    }
  }

  return { reply: await respond({ user, intent, t: ctx.t, language: ctx.language }), intent, source: 'rules' };
}

/** Suggested prompts to show on the coach welcome screen. */
export const SUGGESTED_PROMPTS = [
  { id: 'what_to_train',  text: 'What should I train today?' },
  { id: 'progress',       text: 'How am I doing this week?' },
  { id: 'should_inc',     text: 'Should I increase my squat weight?' },
  { id: 'sore',           text: "I'm sore. What now?" },
  { id: 'weak',           text: 'What muscles am I neglecting?' },
  { id: 'prs',            text: 'What are my PRs?' },
];
