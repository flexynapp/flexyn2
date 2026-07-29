// src/components/leaderboard/LeaderboardPodium.jsx
//
// Top-three podium for the global leaderboards.
//
// Derived from `leaderboard-podium.tsx` in https://github.com/trophyso/ui
// (MIT). Ported TS → JSX to match this codebase, and rewired in three ways:
//
//   • Their rank colours reference `text-rank-1/2/3` design tokens that don't
//     exist here. Mapped onto the gold / slate / orange palette the row list
//     was already using, so the podium and the list agree.
//   • Their avatar fallback hits an external placeholder service
//     (i.pravatar.cc). We render initials instead — no third-party request,
//     and it works offline in the PWA.
//   • Sized for 375 px. Their `default` size assumes desktop width.
//
// MIT License — Copyright (c) Trophy Labs, Inc.

import React from 'react';
import { motion } from 'framer-motion';
import { Crown, Trophy, Flame } from 'lucide-react';

// Rank → visual treatment. Heights are graduated so first place reads as
// first place at a glance; that ordering is the entire point of a podium and
// is what a list of same-height rows with a coloured ring can't do.
const PODIUM_CONFIG = {
  1: { Icon: Crown,  text: 'text-yellow-400', block: 'from-yellow-400/80 to-amber-500/40', ring: 'ring-yellow-400/70', h: 'h-14' },
  2: { Icon: Trophy, text: 'text-slate-300',  block: 'from-slate-300/70 to-slate-400/30',  ring: 'ring-slate-300/70',  h: 'h-10' },
  3: { Icon: Flame,  text: 'text-orange-400', block: 'from-orange-400/70 to-orange-500/30', ring: 'ring-orange-400/70', h: 'h-8'  },
};

// Visual order — silver, gold, bronze — so first place sits centre and tallest.
const DISPLAY_ORDER = [2, 1, 3];

function initialsOf(name) {
  const src = (name || '').trim();
  if (!src) return '?';
  const parts = src.split(/\s+/).filter(Boolean);
  const raw = parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2);
  return raw.toUpperCase();
}

/**
 * @param {Object}   props
 * @param {Array}    props.rankings  rows shaped { id, rank, full_name, _display, avatar_url }
 * @param {string}   [props.currentUserId]
 * @param {Function} [props.onSelect]
 */
export default function LeaderboardPodium({ rankings = [], currentUserId, onSelect }) {
  const top3 = rankings.slice(0, 3);
  if (top3.length === 0) return null;

  // Fixed three-slot grid rather than a flex row of however many exist.
  // With flex, a board where only one athlete has scored (every board on a
  // young account) gave that single entry `flex-1` and stretched its block
  // across the full width — a solo winner rendered as a slab. Holding the
  // columns keeps first place centred whether there are one, two or three.
  const ordered = DISPLAY_ORDER.map(rank => top3.find(r => r.rank === rank) || null);

  return (
    <div
      className="grid grid-cols-3 items-end gap-2 pt-1"
      role="list"
      aria-label="Top 3"
    >
      {ordered.map((row, i) => {
        if (!row) return <div key={`empty-${i}`} aria-hidden="true" />;
        const cfg = PODIUM_CONFIG[row.rank];
        if (!cfg) return null;
        const isMe = row.id === currentUserId;
        const name = row.full_name || '';

        return (
          <motion.div
            key={row.id}
            role="listitem"
            aria-label={`Rank ${row.rank}: ${name}, ${row._display}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            // First place lands last so the eye is drawn to it.
            transition={{ delay: 0.05 * i, type: 'spring', stiffness: 320, damping: 24 }}
            className="flex flex-col items-center min-w-0"
          >
            {/* Avatar + rank badge */}
            <div className="relative mb-1.5">
              {row.avatar_url ? (
                <img
                  src={row.avatar_url}
                  alt=""
                  className={`rounded-full object-cover ring-2 ${cfg.ring} ${row.rank === 1 ? 'w-14 h-14' : 'w-11 h-11'}`}
                />
              ) : (
                <div
                  className={`rounded-full bg-secondary flex items-center justify-center font-heading font-bold ring-2 ${cfg.ring} ${
                    row.rank === 1 ? 'w-14 h-14 text-base' : 'w-11 h-11 text-xs'
                  }`}
                  aria-hidden="true"
                >
                  {initialsOf(name)}
                </div>
              )}
              <div className="absolute -bottom-1 -end-1 w-5 h-5 rounded-full bg-card shadow flex items-center justify-center">
                <cfg.Icon className={`w-3 h-3 ${cfg.text}`} aria-hidden="true" />
              </div>
            </div>

            <p
              className={`w-full truncate text-center text-[11px] font-heading font-bold leading-tight ${isMe ? 'text-primary' : ''}`}
              title={name}
            >
              {name}
            </p>
            <p className="w-full truncate text-center text-[10px] text-muted-foreground tabular-nums leading-tight">
              {row._display}
            </p>

            {/* Podium block — graduated height carries the ranking. */}
            <button
              type="button"
              onClick={onSelect ? () => onSelect(row) : undefined}
              disabled={!onSelect}
              aria-hidden="true"
              tabIndex={-1}
              className={`mt-1.5 w-full ${cfg.h} rounded-t-lg bg-gradient-to-b ${cfg.block} flex items-start justify-center pt-1 disabled:cursor-default`}
            >
              <span className={`font-heading font-black text-sm ${cfg.text} drop-shadow`}>
                {row.rank}
              </span>
            </button>
          </motion.div>
        );
      })}
    </div>
  );
}
