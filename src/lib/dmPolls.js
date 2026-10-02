// src/lib/dmPolls.js
//
// In-chat DM polls — migration-free. A poll is an ordinary hub_message whose
// body carries a protocol marker (mirroring the existing [TRADE_OFFER_V1] /
// [DUEL_INVITE_V1] convention in hubMessages.js). Votes are separate "control"
// messages that reference the poll's message id; they're filtered out of the
// visible thread and never affect unread badges. Tally is computed client-side
// by taking each voter's most recent vote.
//
//   Poll  body: "[POLL_V1]\n{\"q\":\"…\",\"options\":[\"A\",\"B\"]}"
//   Vote  body: "[POLL_VOTE_V1] <pollMessageId> <optionIndex>"

export const POLL_PREFIX = '[POLL_V1]';
export const VOTE_PREFIX = '[POLL_VOTE_V1]';

export const MAX_POLL_OPTIONS = 4;
export const MIN_POLL_OPTIONS = 2;
export const MAX_QUESTION_LEN = 200;
export const MAX_OPTION_LEN = 80;

export function isPoll(body) {
  return typeof body === 'string' && body.startsWith(POLL_PREFIX);
}

export function isPollVote(body) {
  return typeof body === 'string' && body.startsWith(VOTE_PREFIX);
}

/** Build the message body for a new poll. Returns null if invalid. */
export function buildPollBody({ question, options }) {
  const q = (question || '').trim().slice(0, MAX_QUESTION_LEN);
  const opts = (options || [])
    .map(o => (o || '').trim().slice(0, MAX_OPTION_LEN))
    .filter(Boolean);
  if (!q || opts.length < MIN_POLL_OPTIONS) return null;
  return `${POLL_PREFIX}\n${JSON.stringify({ q, options: opts.slice(0, MAX_POLL_OPTIONS) })}`;
}

/** Parse a poll message body → { question, options } or null. */
export function parsePoll(body) {
  if (!isPoll(body)) return null;
  try {
    const json = body.slice(POLL_PREFIX.length).trim();
    const parsed = JSON.parse(json);
    const question = typeof parsed?.q === 'string' ? parsed.q : '';
    const options = Array.isArray(parsed?.options)
      ? parsed.options.filter(o => typeof o === 'string')
      : [];
    if (!question || options.length < MIN_POLL_OPTIONS) return null;
    return { question, options };
  } catch {
    return null;
  }
}

/** Build a vote control-message body. */
export function buildVoteBody(pollMessageId, optionIndex) {
  return `${VOTE_PREFIX} ${pollMessageId} ${optionIndex}`;
}

/** Parse a vote body → { pollId, optionIndex } or null. */
export function parseVote(body) {
  if (!isPollVote(body)) return null;
  const parts = body.slice(VOTE_PREFIX.length).trim().split(/\s+/);
  if (parts.length < 2) return null;
  const pollId = parts[0];
  const optionIndex = Number(parts[1]);
  if (!pollId || !Number.isInteger(optionIndex) || optionIndex < 0) return null;
  return { pollId, optionIndex };
}

/**
 * Build a lookup of pollId → Map(voterUserId → optionIndex) from a list of
 * messages, keeping each voter's LATEST vote. `messages` should be in
 * chronological (oldest-first) order so later votes overwrite earlier ones.
 */
export function buildVoteIndex(messages) {
  const index = new Map();
  for (const m of messages || []) {
    const body = m.body || m.content || '';
    const vote = parseVote(body);
    if (!vote) continue;
    const voter = m.user_id ? String(m.user_id) : '';
    if (!voter) continue;
    if (!index.has(vote.pollId)) index.set(vote.pollId, new Map());
    index.get(vote.pollId).set(voter, vote.optionIndex);
  }
  return index;
}

/**
 * Reduce a single poll's vote map into per-option counts + the caller's vote.
 * @param {Map<string,number>|undefined} voteMap  voterUserId → optionIndex
 * @param {number} optionCount
 * @param {string} myId
 * @returns {{ counts: number[], total: number, myVote: number|null }}
 */
export function pollResults(voteMap, optionCount, myId) {
  const counts = new Array(optionCount).fill(0);
  let total = 0;
  let myVote = null;
  const me = myId ? String(myId) : null;
  if (voteMap) {
    for (const [voter, idx] of voteMap.entries()) {
      if (idx < 0 || idx >= optionCount) continue;
      counts[idx] += 1;
      total += 1;
      if (me && voter === me) myVote = idx;
    }
  }
  return { counts, total, myVote };
}
