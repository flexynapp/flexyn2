// src/lib/notificationIcon.js
//
// The line icon for a notification row, by type.
//
// Rows used to draw `notifications.icon`, an emoji the writer stored, and
// most titles opened with the same emoji again, so every row showed its
// icon twice ("⏳" in the tile, "⏳ 3 quests left today" beside it). Emoji
// as decoration is the look this app has been removing everywhere else
// (panel audit, 2026-09-30). The icon now comes from the type, in the same
// line set as the rest of the app, and `stripLeadingEmoji` takes the copy
// off the title.
//
// No Sparkles here: that icon belongs to the AI Coach only.

import {
  ArrowDown, ArrowLeftRight, ArrowUp, Bell, CalendarCheck, CalendarClock,
  CircleCheck, Coins, Crosshair, Flag, Flame, Gift, Heart, Hourglass,
  LifeBuoy, Medal, Megaphone, MessageCircle, MessageSquareText, Mountain,
  Package, Shield, ShieldCheck, SmilePlus, Sticker, Swords, Target, Trophy,
  UserPlus, Users,
} from 'lucide-react';

const ICON_BY_TYPE = {
  // social
  friend_post:              MessageSquareText,
  friend_follow:            UserPlus,
  comment_reply:            MessageCircle,
  post_reaction:            SmilePlus,
  sticker_reaction:         Sticker,
  trade_offer:              ArrowLeftRight,
  post_like:                Heart,
  crew_everyone:            Megaphone,
  coin_gift:                Gift,
  // competitive
  duel_invite:              Swords,
  duel_result:              Swords,
  bounty_claim:             Crosshair,
  bounty_beaten:            Crosshair,
  crew_war_started:         Shield,
  crew_war_resolved:        Shield,
  nemesis_assigned:         Target,
  nemesis_overthrown:       Target,
  crew_challenge_started:   Flag,
  crew_challenge_completed: Flag,
  weekly_gauntlet_started:  Mountain,
  // achievements
  quest_claimed:            CircleCheck,
  streak_milestone:         Flame,
  league_promoted:          ArrowUp,
  league_demoted:           ArrowDown,
  league_held:              Trophy,
  league_trophy:            Trophy,
  pr_set:                   Medal,
  capsule_earned:           Package,
  coin_milestone:           Coins,
  referral_success:         Users,
  gauntlet_completed:       Mountain,
  gauntlet_path_completed:  Mountain,
  streak_rescue_available:  LifeBuoy,
  weekly_review_ready:      CalendarCheck,
  // reminders (live types are not listed, but keep them drawable)
  streak_break_warning:     Flame,
  quest_expiry_warning:     Hourglass,
  workout_reminder:         CalendarClock,
  report_resolved:          ShieldCheck,
};

/** The row's icon component. Unknown types get the bell. */
export function iconFor(type) {
  return (type && ICON_BY_TYPE[type]) || Bell;
}

// Emoji, variation selectors, joiners and keycap marks, then any spacing.
const LEADING_EMOJI = /^(?:[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}︎️‍⃣]+\s*)+/u;

/**
 * A title with its leading emoji removed. Only the START: "reacted with 🔥"
 * carries the reaction itself as content and keeps it. A title that is
 * nothing but emoji is returned unchanged rather than emptied.
 */
export function stripLeadingEmoji(text) {
  if (typeof text !== 'string') return text;
  const out = text.replace(LEADING_EMOJI, '');
  return out.length > 0 ? out : text;
}
