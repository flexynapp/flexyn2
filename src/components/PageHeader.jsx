import React from 'react';
import { motion } from 'framer-motion';

/**
 * PageHeader — the unified top-of-page header used across Workout, Progress,
 * and Nutrition. It establishes a consistent vertical rhythm and
 * type hierarchy that matches the Dashboard's hero greeting block.
 *
 * Layout (top to bottom):
 *   - kicker:   tiny uppercase eyebrow, e.g. "TUESDAY · APRIL 25" or "STRENGTH"
 *   - title:    bold display heading
 *   - subtitle: muted descriptor under the title
 *   - action:   optional right-side slot (button, icon-button, etc.)
 *
 * `action` sits on the TITLE's row and is centred against it, not against the
 * header as a whole. The header used to be one flex row with the action
 * bottom-aligned (`items-end`), which put a 24px control level with the
 * SUBTITLE — reading as an orphan below the heading rather than as something
 * belonging to it. Pairing it with the title is what makes it look attached.
 * (No caller passed `action` at the time this changed, so nothing had to be
 * re-checked; Workout's grid-customize button is the first.)
 *
 * A long title still wraps under the action rather than colliding with it —
 * the row is flex with the heading `min-w-0` and the action `shrink-0`.
 *
 * The component handles its own entrance animation so pages don't have to
 * wrap it in motion.div themselves.
 */
export default function PageHeader({ kicker, title, subtitle, action, className = '', hidePeriod = false }) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={`mb-6 md:mb-7 ${className}`}
    >
      {kicker && (
        <span className="block text-micro font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-1.5">
          {kicker}
        </span>
      )}
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-3xl md:text-4xl font-bold tracking-tight leading-tight min-w-0">
          {title}
          {!hidePeriod && <span className="text-primary">.</span>}
        </h1>
        {action && <div className="shrink-0 flex items-center">{action}</div>}
      </div>
      {subtitle && (
        <p className="text-muted-foreground mt-1.5 text-sm md:text-base max-w-prose">
          {subtitle}
        </p>
      )}
    </motion.header>
  );
}