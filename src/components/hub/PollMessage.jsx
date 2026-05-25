// src/components/hub/PollMessage.jsx
//
// Renders an in-chat DM poll (PollBubble) and the create overlay (PollComposer).
// Poll data + tally come from src/lib/dmPolls.js; this file is presentation
// only. Translucent fills are used so the bars read on either bubble color
// (mine = primary, theirs = secondary).

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Plus, X, Check } from 'lucide-react';
import {
  MAX_POLL_OPTIONS,
  MIN_POLL_OPTIONS,
  MAX_QUESTION_LEN,
  MAX_OPTION_LEN,
  buildPollBody,
} from '@/lib/dmPolls';

/** Poll rendered inside a message bubble. */
export function PollBubble({ poll, results, onVote, disabled, tFallback }) {
  const { counts, total, myVote } = results;
  return (
    <div className="min-w-[200px] max-w-[260px]">
      <div className="flex items-center gap-1.5 mb-2 opacity-90">
        <BarChart3 className="w-3.5 h-3.5 shrink-0" />
        <span className="text-[13px] font-bold leading-snug break-words">{poll.question}</span>
      </div>
      <div className="space-y-1.5">
        {poll.options.map((opt, idx) => {
          const count = counts[idx] || 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const mine = myVote === idx;
          return (
            <button
              key={idx}
              type="button"
              onClick={(e) => { e.stopPropagation(); if (!disabled) onVote(idx); }}
              disabled={disabled}
              className={`relative w-full text-left rounded-lg overflow-hidden border transition-colors ${
                mine ? 'border-white/60' : 'border-white/20 hover:border-white/40'
              } ${disabled ? 'cursor-default' : ''}`}
            >
              <span
                className="absolute inset-y-0 start-0 bg-white/20 transition-[width] duration-300"
                style={{ width: `${pct}%` }}
                aria-hidden="true"
              />
              <span className="relative flex items-center justify-between gap-2 px-2.5 py-1.5">
                <span className="flex items-center gap-1.5 min-w-0">
                  {mine && <Check className="w-3.5 h-3.5 shrink-0" />}
                  <span className="text-[13px] truncate">{opt}</span>
                </span>
                {total > 0 && (
                  <span className="text-[11px] tabular-nums opacity-80 shrink-0">{pct}%</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] opacity-70 mt-1.5">
        {total === 0
          ? tFallback('hub.poll.beFirst', 'Tap an option to vote')
          : `${total} ${total === 1
              ? tFallback('hub.poll.voteSingular', 'vote')
              : tFallback('hub.poll.votePlural', 'votes')}`}
      </p>
    </div>
  );
}

/** Create-a-poll overlay — slides up above the composer. */
export function PollComposer({ onCreate, onClose, tFallback }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);

  const setOption = (i, val) => setOptions(prev => prev.map((o, idx) => (idx === i ? val : o)));
  const addOption = () => setOptions(prev => (prev.length < MAX_POLL_OPTIONS ? [...prev, ''] : prev));
  const removeOption = (i) =>
    setOptions(prev => (prev.length > MIN_POLL_OPTIONS ? prev.filter((_, idx) => idx !== i) : prev));

  const body = buildPollBody({ question, options });
  const valid = !!body;

  const submit = () => {
    if (!valid) return;
    onCreate({ question, options });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="absolute bottom-16 inset-x-0 z-40 mx-2 bg-card border border-border rounded-xl shadow-xl p-3"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4 text-primary" />
          <span className="text-sm font-bold">{tFallback('hub.poll.create', 'Create a poll')}</span>
        </div>
        <button onClick={onClose} aria-label="Close" className="p-1 rounded text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        maxLength={MAX_QUESTION_LEN}
        placeholder={tFallback('hub.poll.questionPlaceholder', 'Ask a question…')}
        className="w-full px-3 py-2 mb-2 bg-secondary/40 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      />

      <div className="space-y-1.5 mb-2">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={opt}
              onChange={(e) => setOption(i, e.target.value)}
              maxLength={MAX_OPTION_LEN}
              placeholder={`${tFallback('hub.poll.option', 'Option')} ${i + 1}`}
              className="flex-1 px-3 py-1.5 bg-secondary/40 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {options.length > MIN_POLL_OPTIONS && (
              <button
                onClick={() => removeOption(i)}
                aria-label="Remove option"
                className="p-1.5 rounded text-muted-foreground hover:text-foreground shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        {options.length < MAX_POLL_OPTIONS ? (
          <button
            onClick={addOption}
            className="flex items-center gap-1 text-xs font-semibold text-primary hover:opacity-80"
          >
            <Plus className="w-3.5 h-3.5" /> {tFallback('hub.poll.addOption', 'Add option')}
          </button>
        ) : <span />}
        <button
          onClick={submit}
          disabled={!valid}
          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          {tFallback('hub.poll.send', 'Send poll')}
        </button>
      </div>
    </motion.div>
  );
}
