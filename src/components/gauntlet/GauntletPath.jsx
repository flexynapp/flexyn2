// src/components/gauntlet/GauntletPath.jsx
// Vertical scrolling node path for the 10-challenge Gauntlet progression.
import { motion } from 'framer-motion';
import { Trophy, Lock, CheckCircle, Flame, ChevronRight } from 'lucide-react';

const TYPE_LABEL = {
  single_session: 'Session',
  weekly_volume:  'Weekly Vol.',
  streak:         'Streak',
  nutrition:      'Nutrition',
  pr:             'PR',
  final:          'Final',
};

function NodeIcon({ status, size = 28 }) {
  if (status === 'completed') {
    return <CheckCircle size={size} className="text-emerald-400" strokeWidth={2} />;
  }
  if (status === 'active') {
    return <Flame size={size} className="text-amber-400" strokeWidth={2} />;
  }
  if (status === 'next') {
    return <Trophy size={size} className="text-muted-foreground/40" strokeWidth={1.5} />;
  }
  return <Lock size={size} className="text-muted-foreground/25" strokeWidth={1.5} />;
}

function ChallengeNode({ challenge, status, isLast, onClick }) {
  const isClickable = status === 'active' || status === 'completed';

  const ringColor = {
    completed: 'border-emerald-400/60 bg-emerald-950/30',
    active:    'border-amber-400/80 bg-amber-950/30',
    next:      'border-border/40 bg-secondary/40',
    locked:    'border-border/20 bg-secondary/20',
  }[status];

  const titleColor = {
    completed: 'text-foreground',
    active:    'text-foreground font-bold',
    next:      'text-muted-foreground',
    locked:    'text-muted-foreground/40',
  }[status];

  return (
    <div className="flex gap-4 items-start">
      {/* Left: connector line + node circle */}
      <div className="flex flex-col items-center flex-shrink-0 w-12">
        <motion.button
          type="button"
          disabled={!isClickable}
          onClick={isClickable ? onClick : undefined}
          whileTap={isClickable ? { scale: 0.92 } : {}}
          className={`relative w-12 h-12 rounded-full border-2 flex items-center justify-center transition-colors ${ringColor} ${isClickable ? 'cursor-pointer' : 'cursor-default'}`}
        >
          {status === 'active' && (
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-amber-400/50"
              animate={{ scale: [1, 1.35, 1], opacity: [0.8, 0, 0.8] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
            />
          )}
          <NodeIcon status={status} />
        </motion.button>
        {/* Connector */}
        {!isLast && (
          <div className={`w-0.5 flex-1 mt-1 min-h-[32px] ${
            status === 'completed' ? 'bg-emerald-400/40' : 'bg-border/20'
          }`} />
        )}
      </div>

      {/* Right: text content */}
      <div
        className={`flex-1 pb-8 ${isClickable ? 'cursor-pointer' : ''}`}
        onClick={isClickable ? onClick : undefined}
      >
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ${
            status === 'active'
              ? 'bg-amber-500/20 text-amber-400'
              : status === 'completed'
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-secondary text-muted-foreground/50'
          }`}>
            {TYPE_LABEL[challenge.type] ?? challenge.type}
          </span>
          <span className="text-[10px] text-muted-foreground/50">#{challenge.sequence_number}</span>
        </div>

        <p className={`text-sm leading-snug mb-1 ${titleColor}`}>
          {challenge.title}
        </p>

        {(status === 'active' || status === 'completed') && (
          <>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">
              {status === 'active' ? challenge.description : challenge.flavor_text}
            </p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="text-amber-400">⚡</span> {challenge.xp_reward} XP
              </span>
              <span className="flex items-center gap-1">
                <span className="text-yellow-400">🪙</span> {challenge.coin_reward}
              </span>
              {status === 'active' && (
                <span className="flex items-center gap-0.5 text-amber-400 font-medium ml-auto">
                  Start <ChevronRight className="w-3 h-3" />
                </span>
              )}
            </div>
          </>
        )}

        {status === 'next' && (
          <p className="text-xs text-muted-foreground/40">Complete the challenge above to unlock.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Props:
 *  challenges      — array of gauntlet_challenges rows (ordered by sequence_number)
 *  currentSequence — the user's current_challenge_sequence (1 if never started)
 *  completedSeqs   — Set of sequence_numbers the user has completed
 *  onChallengeClick(challenge) — called when user taps an active/completed node
 */
export default function GauntletPath({ challenges = [], currentSequence = 1, completedSeqs = new Set(), onChallengeClick }) {
  return (
    <div className="pt-2">
      {challenges.map((ch, idx) => {
        let status;
        if (completedSeqs.has(ch.sequence_number)) {
          status = 'completed';
        } else if (ch.sequence_number === currentSequence) {
          status = 'active';
        } else if (ch.sequence_number === currentSequence + 1) {
          status = 'next';
        } else {
          status = 'locked';
        }

        return (
          <motion.div
            key={ch.id}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.04, duration: 0.25 }}
          >
            <ChallengeNode
              challenge={ch}
              status={status}
              isLast={idx === challenges.length - 1}
              onClick={() => onChallengeClick?.(ch)}
            />
          </motion.div>
        );
      })}
    </div>
  );
}
