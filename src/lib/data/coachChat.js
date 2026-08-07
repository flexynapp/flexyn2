// src/lib/data/coachChat.js
//
// Client half of the AI Coach's language-model turn. Sends the user's
// question, the recent thread and a digest of their real training data to the
// `coach-chat` Edge Function, which holds the Anthropic key server-side.
//
// The key point about this module: **every failure is soft.** The Coach has
// shipped without an LLM since launch and must keep working without one, so
// nothing here throws and nothing here is surfaced as an error bubble. A
// failure returns { ok: false, error } and coach.js falls back to the
// rule-based responders — the user gets the old answer, not a broken one.
// The single exception is RATE_LIMIT, which the caller may want to mention.
//
// Failure codes, all soft:
//   PIPELINE_MISSING     function not deployed yet (404)
//   SERVER_MISCONFIGURED ANTHROPIC_API_KEY unset on the project
//   RATE_LIMIT           daily cap reached (migration 305) or Anthropic 429
//   REFUSED / TRUNCATED  model declined, or ran out of output tokens
//   PARSE_ERROR          malformed upstream payload
//   TIMEOUT              no response inside the budget
//   NETWORK              never reached the function
//
// On success: { ok: true, kind: 'answer' | 'plan', reply, goal }.
// `kind: 'plan'` means "the user wants a session built" — the caller runs the
// deterministic planBuilder with `goal` rather than trusting prose.

import { supabase } from '@/api/supabaseClient';

// Shorter than recognize-meal's 30 s: this sits behind a "Thinking…" bubble
// in a chat, where 12 s already feels broken. Past that, the rules engine's
// instant answer is the better product than a spinner.
const DEFAULT_TIMEOUT_MS = 12_000;

// Once we learn the function isn't deployed, stop paying a failed round trip
// and ~1 s of latency on every subsequent message this session. Kegan deploys
// Edge Functions by hand, so "not deployed yet" is a real, sustained state and
// not a transient blip. Cleared on reload, which is when a deploy would land.
let _pipelineMissing = false;

/** Test seam — resets the not-deployed latch. */
export function _resetCoachChatAvailability() {
  _pipelineMissing = false;
}

async function parseFunctionError(error) {
  const ctx = error?.context;
  const status = ctx?.status ?? error?.status ?? null;
  try {
    if (ctx && typeof ctx.json === 'function') {
      const resp = typeof ctx.clone === 'function' ? ctx.clone() : ctx;
      const body = await resp.json();
      if (body?.error) return { code: String(body.error), status };
    }
  } catch { /* non-JSON body — fall through to status mapping */ }
  return { code: null, status };
}

/**
 * Ask the language model.
 *
 * @param {object}   args
 * @param {string}   args.message   the user's question
 * @param {Array}    [args.history] prior turns, [{ role: 'user'|'coach', text }]
 * @param {object}   [args.context] training-data digest (see buildCoachContext)
 * @param {string}   [args.language] app language code, e.g. 'es'
 * @param {number}   [args.timeoutMs]
 * @returns {Promise<{ok: true, kind: string, reply: string, goal: string} | {ok: false, error: string}>}
 */
export async function askCoachLLM({
  message,
  history = [],
  context = {},
  language = 'en',
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!message || !String(message).trim()) return { ok: false, error: 'MISSING_MESSAGE' };
  if (_pipelineMissing) return { ok: false, error: 'PIPELINE_MISSING' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { data, error } = await supabase.functions.invoke('coach-chat', {
      body: {
        message: String(message),
        // Only the two fields the function reads. Sending whole message
        // objects would ship `ts`, `source` and any future UI-only field to
        // the model as noise, and eventually as tokens we pay for.
        history: (history || [])
          .filter(m => m?.text && (m.role === 'user' || m.role === 'coach'))
          .map(m => ({ role: m.role, text: String(m.text) })),
        context,
        language,
      },
      signal: controller.signal,
    });

    if (error) {
      if (controller.signal.aborted) return { ok: false, error: 'TIMEOUT' };
      const { code, status } = await parseFunctionError(error);
      if (status === 404) {
        _pipelineMissing = true;
        return { ok: false, error: 'PIPELINE_MISSING' };
      }
      // A missing key is a project-level deploy problem, not a per-message
      // one — latch it like a missing function so we stop paying a round
      // trip for it on every turn.
      if (code === 'SERVER_MISCONFIGURED') {
        _pipelineMissing = true;
        return { ok: false, error: 'SERVER_MISCONFIGURED' };
      }
      if (code) return { ok: false, error: code };
      if (status === 429) return { ok: false, error: 'RATE_LIMIT' };
      // No HTTP status means the request never reached the function.
      if (status == null) return { ok: false, error: 'NETWORK' };
      return { ok: false, error: 'NETWORK' };
    }

    if (!data) return { ok: false, error: 'EMPTY' };
    // The function answers 200 with { ok: false } for soft upstream failures
    // (REFUSED, TRUNCATED) so the refund path can run — pass those through.
    if (data.ok !== true) return { ok: false, error: String(data.error || 'UNKNOWN') };
    if (!data.reply) return { ok: false, error: 'EMPTY_REPLY' };

    return {
      ok: true,
      kind: data.kind === 'plan' ? 'plan' : 'answer',
      reply: String(data.reply),
      goal: String(data.goal || ''),
    };
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, error: 'TIMEOUT' };
    return { ok: false, error: 'NETWORK' };
  } finally {
    clearTimeout(timer);
  }
}
