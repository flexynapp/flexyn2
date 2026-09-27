import { motion } from 'framer-motion';

/**
 * The fill bar under every goal row.
 *
 * Three things this had to stop doing:
 *
 *   • `bg-green-500` / a decorative gradient. CLAUDE.md allows four hues and
 *     bans gradient-as-decoration outright — a shimmer sweeping a finished bar
 *     forever is exactly the "generated UI" tell that rule exists to catch.
 *     Completion now reads as `bg-success`, the token every other completed
 *     state in the app already uses.
 *
 *   • Trusting `progress`. `Math.min(Math.max(NaN, 0), 100)` is NaN, so a goal
 *     whose target is null or 0 — a cardio goal saved before its target was
 *     required, say — produced `width: "NaN%"`. The browser drops the
 *     declaration and the bar silently renders at its LAST width, which on
 *     first paint is 0 and after an update is whatever the previous goal had.
 *     Non-finite input is now 0, which is the honest answer.
 *
 *   • Being invisible to assistive tech. A bar with no role is decoration; this
 *     one carries the only quantitative answer on the row.
 */
export default function GoalProgressBar({ progress, animated = true, complete = false, label }) {
  // Coerce first, clamp second. A string percentage from a JSONB round-trip is
  // as likely here as a number, and `Number('') === 0` is the right reading of
  // "nothing logged yet".
  const n = Number(progress);
  const clampedProgress = Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : 0;
  // Neutral until the target is hit, then green: the same two states Today's
  // "To do" block uses. Orange on every bar made every goal look urgent.
  const barColor = complete ? 'bg-success' : 'bg-foreground';

  return (
    <div
      className="relative h-1 bg-border rounded-full overflow-hidden"
      role="progressbar"
      aria-valuenow={Math.round(clampedProgress)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <motion.div
        className={`h-full rounded-full ${barColor}`}
        initial={animated ? { width: '0%' } : { width: `${clampedProgress}%` }}
        animate={{ width: `${clampedProgress}%` }}
        transition={animated ? { duration: 0.8, ease: 'easeOut' } : { duration: 0 }}
      />
    </div>
  );
}
