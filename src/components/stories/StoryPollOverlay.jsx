// src/components/stories/StoryPollOverlay.jsx
//
// Interactive poll overlay rendered on top of a story. Viewer sees
// the question + tappable option pills; tapping casts a vote via
// the cast_story_poll_vote RPC (mig 112). After voting, the pills
// swap to results bars showing the percentage split.
//
// Designed to be lightweight — one card, two-to-four options, no
// nested modals. The owner of the story sees the live results
// automatically (no need to vote on their own poll).

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import * as polls from '@/lib/data/storyPolls';

export default function StoryPollOverlay({ overlay, storyId, userId, isOwn }) {
  const [myVote, setMyVote] = useState(null);
  const [results, setResults] = useState(new Map());
  const [busy, setBusy] = useState(false);

  // Load initial state — viewer's own vote (if any) + current tally.
  // Owner gets the tally immediately without needing to vote.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!storyId) return;
      const [mine, agg] = await Promise.all([
        userId ? polls.getMyVote(storyId, userId) : Promise.resolve(null),
        (myVote || isOwn) ? polls.getResults(storyId) : Promise.resolve(new Map()),
      ]);
      if (cancelled) return;
      if (mine) {
        setMyVote(mine);
        // We need the tally too once we know they voted.
        const agg2 = await polls.getResults(storyId);
        if (!cancelled) setResults(agg2);
      } else {
        setResults(agg);
      }
    })();
    return () => { cancelled = true; };
  }, [storyId, userId, isOwn]);

  const options = Array.isArray(overlay?.options) ? overlay.options : [];
  const hasVoted = myVote != null || isOwn;
  const total = Array.from(results.values()).reduce((s, n) => s + n, 0) || 0;

  const handleVote = async (optionId) => {
    if (busy || myVote === optionId || isOwn) return;
    setBusy(true);
    try {
      await polls.castVote(storyId, optionId);
      setMyVote(optionId);
      const next = await polls.getResults(storyId);
      setResults(next);
    } catch { /* swallow — toast belongs to the parent */ }
    setBusy(false);
  };

  return (
    <div
      className="absolute pointer-events-auto"
      style={{
        left: `${(overlay.x ?? 0.5) * 100}%`,
        top:  `${(overlay.y ?? 0.5) * 100}%`,
        transform: 'translate(-50%, -50%)',
        width: '80%',
        maxWidth: 320,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-black/55 backdrop-blur-md border border-white/15 rounded-2xl p-3 shadow-lg">
        {overlay.question && (
          <p className="text-white text-sm font-semibold mb-2 text-center break-words">
            {overlay.question}
          </p>
        )}
        <div className="space-y-1.5">
          {options.map(o => {
            const count = results.get(o.id) || 0;
            const pct = hasVoted && total > 0 ? Math.round((count / total) * 100) : 0;
            const isMine = myVote === o.id;
            return (
              <button
                key={o.id}
                onClick={() => handleVote(o.id)}
                disabled={busy || isOwn}
                className={`relative w-full rounded-lg px-3 py-2 text-sm font-medium text-start overflow-hidden transition-colors ${
                  isMine ? 'border border-white/60 text-white' : 'border border-white/15 text-white/90 hover:bg-white/10 active:bg-white/10'
                } ${isOwn ? 'cursor-default' : 'cursor-pointer'}`}
              >
                {hasVoted && (
                  <motion.div
                    className="absolute inset-y-0 start-0 bg-white/15"
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                  />
                )}
                <span className="relative flex items-center justify-between">
                  <span className="truncate pe-2">{o.label}</span>
                  {hasVoted && <span className="tabular-nums text-xs">{pct}%</span>}
                </span>
              </button>
            );
          })}
        </div>
        {hasVoted && total > 0 && (
          <p className="text-micro text-white/50 mt-2 text-center tabular-nums">
            {total} {total === 1 ? 'vote' : 'votes'}
          </p>
        )}
      </div>
    </div>
  );
}
