import { describe, it, expect } from 'vitest';
import {
  buildPollBody,
  parsePoll,
  buildVoteBody,
  parseVote,
  buildVoteIndex,
  pollResults,
  isPoll,
  isPollVote,
  POLL_PREFIX,
  VOTE_PREFIX,
} from '@/lib/dmPolls';

describe('dmPolls — poll body', () => {
  it('builds and round-trips a valid poll', () => {
    const body = buildPollBody({ question: 'Leg day or rest?', options: ['Leg day', 'Rest'] });
    expect(body.startsWith(POLL_PREFIX)).toBe(true);
    const parsed = parsePoll(body);
    expect(parsed).toEqual({ question: 'Leg day or rest?', options: ['Leg day', 'Rest'] });
  });

  it('trims and drops blank options', () => {
    const body = buildPollBody({ question: '  Q  ', options: ['  A ', '', '   ', 'B'] });
    expect(parsePoll(body)).toEqual({ question: 'Q', options: ['A', 'B'] });
  });

  it('rejects fewer than two options', () => {
    expect(buildPollBody({ question: 'Q', options: ['only one'] })).toBeNull();
    expect(buildPollBody({ question: 'Q', options: [] })).toBeNull();
  });

  it('rejects an empty question', () => {
    expect(buildPollBody({ question: '   ', options: ['A', 'B'] })).toBeNull();
  });

  it('caps options at four', () => {
    const body = buildPollBody({ question: 'Q', options: ['A', 'B', 'C', 'D', 'E'] });
    expect(parsePoll(body).options).toHaveLength(4);
  });

  it('parsePoll returns null for non-poll or malformed bodies', () => {
    expect(parsePoll('just a message')).toBeNull();
    expect(parsePoll(`${POLL_PREFIX}\nnot json`)).toBeNull();
    expect(parsePoll(`${POLL_PREFIX}\n{"q":"Q","options":["A"]}`)).toBeNull();
  });

  it('isPoll / isPollVote discriminate', () => {
    expect(isPoll(`${POLL_PREFIX}\n{}`)).toBe(true);
    expect(isPoll('hello')).toBe(false);
    expect(isPollVote(`${VOTE_PREFIX} abc 0`)).toBe(true);
    expect(isPollVote('hello')).toBe(false);
  });
});

describe('dmPolls — votes', () => {
  it('round-trips a vote body', () => {
    expect(parseVote(buildVoteBody('poll-123', 2))).toEqual({ pollId: 'poll-123', optionIndex: 2 });
  });

  it('rejects malformed votes', () => {
    expect(parseVote('not a vote')).toBeNull();
    expect(parseVote(`${VOTE_PREFIX} onlyid`)).toBeNull();
    expect(parseVote(`${VOTE_PREFIX} id notanumber`)).toBeNull();
    expect(parseVote(`${VOTE_PREFIX} id -1`)).toBeNull();
  });
});

describe('dmPolls — tally', () => {
  const msgs = [
    { sender_email: 'A@x.com', body: buildVoteBody('p1', 0) },
    { sender_email: 'B@x.com', body: buildVoteBody('p1', 1) },
    { sender_email: 'A@x.com', body: buildVoteBody('p1', 1) }, // A changed their vote
    { sender_email: 'C@x.com', body: buildVoteBody('p2', 0) },
    { sender_email: 'D@x.com', body: 'a normal message' },
  ];

  it('keeps each voter latest vote per poll', () => {
    const index = buildVoteIndex(msgs);
    const p1 = index.get('p1');
    expect(p1.get('a@x.com')).toBe(1); // changed from 0 → 1
    expect(p1.get('b@x.com')).toBe(1);
    expect(index.get('p2').get('c@x.com')).toBe(0);
  });

  it('computes counts, total and my vote', () => {
    const index = buildVoteIndex(msgs);
    const res = pollResults(index.get('p1'), 2, 'A@x.com');
    expect(res.counts).toEqual([0, 2]); // both A and B on option 1
    expect(res.total).toBe(2);
    expect(res.myVote).toBe(1);
  });

  it('ignores out-of-range option indices', () => {
    const index = buildVoteIndex([{ sender_email: 'A@x.com', body: buildVoteBody('p', 9) }]);
    const res = pollResults(index.get('p'), 2, 'A@x.com');
    expect(res.total).toBe(0);
    expect(res.myVote).toBeNull();
  });

  it('handles a poll with no votes', () => {
    const res = pollResults(undefined, 3, 'A@x.com');
    expect(res.counts).toEqual([0, 0, 0]);
    expect(res.total).toBe(0);
    expect(res.myVote).toBeNull();
  });
});
