// src/components/dashboard/questVisuals.jsx
//
// The two pieces of quest chrome that both DailyQuestsCard and QuestsSheet
// draw: the leading state tile, and the reward line under a title.
//
// They live here rather than in the card because the sheet is React.lazy'd
// FROM the card — importing them back out of it would make the card and its
// own lazy chunk mutually dependent, which either defeats the split or ships
// a cycle. One leaf module both sides import is the version with neither
// problem.

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { popIn } from '@/lib/motion';
import useCountUp from '@/hooks/useCountUp';
import { ACTION_TYPES } from '@/lib/questCatalog';
import {
  Sparkles,
  UtensilsCrossed, Droplet, Dumbbell, HeartPulse, Megaphone, Bike,
  Camera, Flame, Trophy, Zap, Target, Check,
  Moon, Smile, Footprints, Heart, Scale, Layers, Weight, Timer,
  MessageCircle, Users,
} from 'lucide-react';

// questCatalog stores `icon` as a lucide export NAME so that module stays
// free of React imports (it's also read by lib/data/quests.js and the
// server-mirroring tests). Resolution happens here, at the only place that
// renders a quest tile. Explicit map rather than a dynamic lookup on the
// lucide namespace so tree-shaking can still drop everything unused, and so
// a typo in the catalog fails loudly in review rather than silently
// rendering nothing.
//
// Adding a quest with a new icon means adding the name here too, or the row
// falls back to Sparkles. `questCatalog.test.js` asserts every catalog icon
// resolves, so that failure surfaces in the suite rather than on a phone.
export const QUEST_ICONS = {
  UtensilsCrossed, Droplet, Dumbbell, HeartPulse, Megaphone, Bike,
  Camera, Flame, Trophy, Zap, Target,
  Moon, Smile, Footprints, Heart, Scale, Layers, Weight, Timer,
  MessageCircle, Users,
};

/**
 * The 28px leading tile. Primary while the quest is live; --success with a
 * white check the moment it completes.
 *
 * The check is the thing this component exists for. Before it, a completed
 * quest looked exactly like an incomplete one except for a button appearing
 * at the far end of the row, and a CLAIMED quest was a grey outline glyph in
 * muted-foreground — the least emphatic mark in the app for the only state
 * that means "you did it". A filled green disc with a white tick is the
 * cheapest possible way to say done, and it reads at a glance down a column
 * of four rows in a way a colour change on a button never did.
 *
 * Green is --success, already one of the app's four hues (CLAUDE.md bans a
 * fifth), and it is the hue the app uses for this meaning everywhere else.
 */
export function QuestTile({ icon, completed, claimed }) {
  const QuestIcon = QUEST_ICONS[icon] || Sparkles;
  const done = completed || claimed;
  return (
    <div
      className={`shrink-0 w-7 h-7 rounded-sm flex items-center justify-center transition-colors ${
        done ? 'bg-success text-white' : 'bg-primary text-primary-foreground'
      }`}
      aria-hidden="true"
    >
      {/* `initial={false}` matters: without it an already-complete quest
          re-runs the spring on every 90s poll re-render, so the card
          twitches on its own while nobody is touching it. The animation is
          for the moment of completion, not for the state. */}
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.span
            key="done"
            // The shared completion pop (src/lib/motion.js): one overshoot
            // and settle, so a quest ticking done reads as a moment.
            {...popIn}
          >
            <Check className="w-4 h-4" strokeWidth={3.5} />
          </motion.span>
        ) : (
          <motion.span key="todo" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <QuestIcon className="w-3.5 h-3.5" />
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The reward line under a quest title: progress, coins, XP, and the crew's
 * share.
 *
 * XP comes off the ROW (`xp_reward`), not the catalog, because the row is
 * what the server stamped at seed time — a tier that gets re-priced must not
 * retroactively change what yesterday's quest claims to pay. The crew share
 * is the one figure taken from the catalog, since it is derived rather than
 * stored, and getQuestDefinition rounds it the same way the SQL does.
 */
export function QuestRewardLine({ quest, tFallback, className = '' }) {
  const crewXp = quest.definition?.crewXpReward ?? 0;
  const xp = quest.xp_reward ?? quest.definition?.xpReward ?? 0;
  // Progress rolls up to its value on first paint and between polls, so a
  // quest that moved while you were away visibly moves. Non numeric values
  // pass through untouched (useCountUp returns them as is).
  const counted = useCountUp(quest.progress, { duration: 500 });
  const progress = typeof counted === 'number' ? Math.round(counted) : counted;
  // Cardio quests count SECONDS (the cardio tracker reports duration that
  // way), and the line printed them raw: "Get 10 min of cardio · 0 / 600".
  // Shown in whole minutes to match the title; floor, so 9:59 of a 10 minute
  // quest never reads as done.
  const inSeconds = quest.definition?.actionType === ACTION_TYPES.CARDIO_SECONDS;
  const shown = inSeconds && typeof progress === 'number' ? Math.floor(progress / 60) : progress;
  const target = inSeconds && typeof quest.target === 'number' ? Math.round(quest.target / 60) : quest.target;
  return (
    <span className={`tabular-nums ${className}`}>
      {shown} / {target}{inSeconds && <> {tFallback('workout.min', 'min')}</>}
      {' · '}{quest.coin_reward} {tFallback('hub.coins', 'coins')}
      {xp > 0 && <> · {xp} XP</>}
      {crewXp > 0 && (
        <>
          {' · '}
          {/* The crew share is the one number here that is about someone
              else, so it takes the accent rather than the caption grey the
              rest of the line sits in. */}
          <span className="text-primary font-semibold">
            +{crewXp} {tFallback('quests.crewShort', 'crew')}
          </span>
        </>
      )}
    </span>
  );
}
