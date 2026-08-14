// src/components/settings/SettingsPrimitives.jsx
//
// The row vocabulary every Settings section is built from.
//
// Why this file exists: Settings used to be ~40 controls hand-rolled inline
// in one 1,585-line component living inside the ProfileMenu dropdown. That
// container is `start-4 end-4` — 361px on an iPhone 15 — so every control
// had been shrunk to fit it: 71 text nodes at exactly two sizes (12px and
// 11px, i.e. the bottom two of the six steps in tailwind.config), section
// headings the same size as the rows they headed, and 15 switches at
// `h-5` = 20px tall. Nothing led, nothing receded, and nothing was
// comfortably tappable. Splitting Settings onto its own route freed the
// width; these primitives are what spend it.
//
// Three rules they encode, all from CLAUDE.md's UI composition section:
//
//   1. TWO SPACING REGISTERS. `gap-2` (8px) inside a group, `gap-6` (24px)
//      between groups. The 12–20px middle is banned — the old panel had 15
//      uses of it, which is most of why the rhythm read as drift.
//   2. HIERARCHY BY WEIGHT AND SIZE, in that order, and only ON the named
//      scale — `text-body` (15) for a row label, `text-caption` (12) for a
//      hint, `text-caption` + uppercase + semibold for a group heading, and
//      `text-micro` (11) reserved for badges as index.css says. Tailwind's
//      numeric steps are off this scale: `text-sm` is 14px, which is not one
//      of the six. Note the heading is SMALLER than the rows it heads and
//      still reads as a heading — weight and letter-spacing carry it.
//   3. NO CARDS. A settings row is not a user-arranged object, so it gets
//      a hairline divider and no surface. `Group` draws one border around
//      the set and divides within it.
//
// And one that isn't from the design system but from d5bed469: a control
// gets a real 44px touch target. `ToggleRow` makes the ENTIRE row the
// switch — one accessible control spanning the full width, which is both
// the iOS convention and the largest target available. Rows that need a
// second control (the push categories carry a snooze button) can't nest a
// button inside a button, so they compose `Row` + a standalone `Switch`
// whose padding restores the 44px height around a 24px track.

import { Loader2, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/lib/LanguageContext';

// ── The switch track ────────────────────────────────────────────────────
// Presentation only — no role, no handler. Both ToggleRow and Switch
// render it so the two never drift apart visually.
function SwitchTrack({ checked }) {
  return (
    <span
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${
          checked ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0'
        }`}
      />
    </span>
  );
}

/**
 * A standalone switch, for rows that carry another control beside it.
 *
 * The visual track is 24px but the button is `h-11`, so the hit area is a
 * full 44px tall. The negative inline margin pulls that padding back out
 * of the layout so the row doesn't look loose.
 *
 * Must be passed `labelledBy` (the id of a visible label) or `ariaLabel` —
 * without one it announces as "switch, on" with no subject.
 */
export function Switch({ checked, onChange, labelledBy, ariaLabel, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={!labelledBy ? ariaLabel : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="h-11 px-1 -me-1 flex items-center shrink-0 cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
    >
      <SwitchTrack checked={checked} />
    </button>
  );
}

/**
 * A toggle whose control IS the whole row.
 *
 * One `role="switch"` button, full width, `min-h-11`. The label and hint
 * live inside it, so the accessible name comes from the content and there
 * is nothing to wire up with an id.
 *
 * `busy` swaps the track for a spinner and blocks input — used by the push
 * toggle, which waits on a browser permission prompt.
 */
export function ToggleRow({ icon: Icon, label, hint, checked, onChange, busy, disabled }) {
  const { tFallback } = useLanguage();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className="w-full min-h-11 py-2 flex items-center gap-2 text-start rounded-lg transition-colors hover:bg-secondary/50 active:bg-secondary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
    >
      {Icon && <Icon className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />}
      <span className="flex-1 min-w-0">
        <span className="block text-body text-foreground leading-snug">{label}</span>
        {hint && (
          <span className="block text-caption text-muted-foreground leading-snug mt-0.5">{hint}</span>
        )}
      </span>
      {busy ? (
        <Loader2
          className="w-5 h-5 animate-spin text-muted-foreground shrink-0"
          role="status"
          aria-label={tFallback("settingsPrimitives.loading", "Loading")}
        />
      ) : (
        <SwitchTrack checked={checked} />
      )}
    </button>
  );
}

/**
 * A non-interactive row. For anything that isn't a single toggle — a label
 * beside a segmented control, a value, or a switch plus a second button.
 * Carries the same 44px floor so a mixed group keeps one rhythm.
 */
export function Row({ icon: Icon, label, hint, labelId, children, className = '' }) {
  return (
    <div className={`min-h-11 py-2 flex items-center justify-between gap-2 ${className}`}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {Icon && <Icon className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />}
        <div className="min-w-0">
          <p id={labelId} className="text-body text-foreground leading-snug">{label}</p>
          {hint && <p className="text-caption text-muted-foreground leading-snug mt-0.5">{hint}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * A row that navigates. `to` renders a Link, `onClick` renders a button.
 * The chevron flips under RTL — it points at the reading direction, not at
 * the right-hand side of the screen.
 */
export function NavRow({ icon: Icon, label, hint, to, onClick, tone = 'default', trailing }) {
  const tint = tone === 'warn' ? 'text-amber-500' : 'text-muted-foreground';
  const body = (
    <>
      {Icon && <Icon className={`w-4 h-4 shrink-0 ${tint}`} aria-hidden="true" />}
      <span className="flex-1 min-w-0">
        <span className={`block text-body leading-snug ${tone === 'warn' ? 'text-amber-500' : 'text-foreground'}`}>
          {label}
        </span>
        {hint && <span className="block text-caption text-muted-foreground leading-snug mt-0.5">{hint}</span>}
      </span>
      {trailing}
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 rtl:scale-x-[-1]" aria-hidden="true" />
    </>
  );
  const cls =
    'w-full min-h-11 py-2 flex items-center gap-2 text-start rounded-lg transition-colors hover:bg-secondary/50 active:bg-secondary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
  if (to) return <Link to={to} className={cls}>{body}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{body}</button>;
}

/**
 * A row that performs an action and shows no state — export, bug report.
 * Same target as everything else; no chevron, because nothing comes next.
 */
export function ActionRow({ icon: Icon, label, hint, onClick, disabled, busy, tone = 'default' }) {
  const tint =
    tone === 'destructive' ? 'text-destructive'
    : tone === 'warn' ? 'text-amber-500'
    : 'text-foreground';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="w-full min-h-11 py-2 flex items-center gap-2 text-start rounded-lg transition-colors hover:bg-secondary/50 active:bg-secondary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
    >
      {busy
        ? <Loader2 className={`w-4 h-4 shrink-0 animate-spin ${tint}`} aria-hidden="true" />
        : Icon && <Icon className={`w-4 h-4 shrink-0 ${tint}`} aria-hidden="true" />}
      <span className="flex-1 min-w-0">
        <span className={`block text-body leading-snug ${tint}`}>{label}</span>
        {hint && <span className="block text-caption text-muted-foreground leading-snug mt-0.5">{hint}</span>}
      </span>
    </button>
  );
}

/**
 * A full-width segmented control — units, appearance, sex.
 *
 * Options are laid out `flex-1` rather than in a grid: the count is fixed
 * per call site (2 or 3), so there is no partial row to centre and
 * `tileRow()` would be the wrong tool. `min-h-11` on each segment is the
 * point — these were `py-1.5` (~28px) before.
 */
export function SegmentedControl({ value, onChange, options, ariaLabel, disabled }) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex gap-2">
      {options.map(opt => {
        const active = value === opt.value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            disabled={disabled}
            className={`flex-1 min-h-11 px-2 inline-flex items-center justify-center gap-1 text-body rounded-lg border transition-colors disabled:opacity-50 ${
              active
                ? 'border-primary bg-primary/10 text-primary font-semibold'
                : 'border-border text-muted-foreground hover:bg-secondary active:bg-secondary'
            }`}
          >
            {Icon && <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A labelled group of rows.
 *
 * One hairline around the set, hairlines between the rows, no shadow —
 * "resting" elevation per CLAUDE.md, which has exactly two levels and this
 * is the lower one. The heading sits OUTSIDE the border so the border
 * describes the controls rather than the label.
 *
 * `description` is for a caveat that applies to the whole group. Put
 * per-row explanation in the row's own `hint` instead.
 */
export function Group({ title, description, children, className = '' }) {
  return (
    <section className={className}>
      {title && (
        <h2 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground mb-2 px-1">
          {title}
        </h2>
      )}
      {description && (
        <p className="text-caption text-muted-foreground leading-snug mb-2 px-1">{description}</p>
      )}
      <div className="rounded-lg border border-border divide-y divide-border px-3">
        {children}
      </div>
    </section>
  );
}

/**
 * A block nested under its parent toggle — the push categories under Push
 * notifications, the hour pickers under Quiet hours.
 *
 * The start-edge rule is what says "these belong to the row above" without
 * spending a card on it. Logical property, so it moves to the right edge
 * under Arabic.
 */
export function SubGroup({ children, ariaLabel }) {
  return (
    <div
      role={ariaLabel ? 'group' : undefined}
      aria-label={ariaLabel}
      className="ps-3 ms-1 border-s border-border/60 divide-y divide-border/60"
    >
      {children}
    </div>
  );
}
