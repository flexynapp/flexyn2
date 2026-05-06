// src/lib/aiCoach/coach.js
//
// Main entry point for the AI Coach. Pipeline:
//   1. detectIntent(message) → which kind of question is this?
//   2. respond(intent, user) → generate a personalized reply using the
//      user's actual workout/profile/cardio data
//   3. (optional) enhanceWithLLM(reply, message) → if VITE_ANTHROPIC_API_KEY
//      is set, we send the rule-based reply + the user's question to Claude
//      for a polish pass. Falls back to the rule-based reply on any error.
//
// The fallback path is the production default — the app ships working without
// any API key. The LLM enhancement is opt-in by setting an env var.

import { detectIntent, INTENTS } from './intents';
import { respond } from './responders';

const LLM_TIMEOUT_MS = 8000;

/**
 * Ask the coach something. Returns:
 *   { reply: string, intent: { id, score, params }, source: 'rules' | 'llm' }
 */
export async function askCoach(user, message) {
  const intent = detectIntent(message);
  const baseReply = await respond({ user, intent });

  // Try to enhance with LLM if configured. On any error, return the
  // rule-based reply as-is.
  const apiKey = (import.meta.env && import.meta.env.VITE_ANTHROPIC_API_KEY) || '';
  if (apiKey) {
    try {
      const enhanced = await _enhanceWithClaude({ apiKey, message, baseReply, intent });
      if (enhanced && enhanced.length > 20) {
        return { reply: enhanced, intent, source: 'llm' };
      }
    } catch (err) {
      console.warn('[aiCoach] LLM enhancement failed (using rules):', err);
    }
  }

  return { reply: baseReply, intent, source: 'rules' };
}

/**
 * Optional: send the user's question + rule-based reply to Claude as context
 * and ask it to rephrase / personalize. Returns the enhanced reply or null
 * on failure.
 *
 * Note: this calls Anthropic's API directly from the browser. For production,
 * you'll want to proxy this through a server function so the API key isn't
 * exposed to the client. The current setup is fine for self-hosted Flexyn
 * instances where the env var stays on your build server.
 */
async function _enhanceWithClaude({ apiKey, message, baseReply, intent }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  const systemPrompt = [
    "You are Coach, a knowledgeable, warm, no-nonsense fitness coach inside the Flexyn app.",
    "A rules engine has already analyzed the user's data and prepared a draft reply.",
    "Your job: rewrite the draft to sound more natural and conversational, but keep ALL the specific data (numbers, names, dates) exactly as written.",
    "Do not add advice that isn't in the draft. Do not invent data. Stay under 150 words.",
    "If the draft includes markdown formatting, preserve it.",
  ].join(' ');

  const userPrompt = [
    `User asked: "${message}"`,
    '',
    `Draft reply (rule-based, factual):`,
    '---',
    baseReply,
    '---',
    '',
    `Rewrite the draft in a more natural coaching voice. Keep all numbers and details intact.`,
  ].join('\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key':       apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:       'claude-sonnet-4-5-20250929',
        max_tokens:  600,
        system:      systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    const data = await response.json();
    const text = data?.content?.[0]?.text;
    return typeof text === 'string' ? text.trim() : null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/** Suggested prompts to show on the coach welcome screen. */
export const SUGGESTED_PROMPTS = [
  { id: 'what_to_train',  text: 'What should I train today?' },
  { id: 'progress',       text: 'How am I doing this week?' },
  { id: 'should_inc',     text: 'Should I increase my squat weight?' },
  { id: 'sore',           text: "I'm sore — what now?" },
  { id: 'weak',           text: 'What muscles am I neglecting?' },
  { id: 'prs',            text: 'What are my PRs?' },
];
