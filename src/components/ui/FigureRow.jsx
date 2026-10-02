// src/components/ui/FigureRow.jsx
//
// The "figure first" row: a number or an icon in a fixed left column, one
// short line beside it, hairlines between rows. It is how an explainer reads
// at a glance instead of as a stack of paragraphs (Kegan, 2026-10-02: visuals
// first, text only when it is needed).
//
// One component for both places that draw this row: the explainer sheets
// (How leagues work) and the Coach answer card, which passes its own drawn
// figures as `column` and motion.li as `as`. Kept as one copy so a rule in a
// sheet and a point in a Coach reply cannot drift apart. The sheets stay
// static; motion is the Coach card's, not this row's.

import React from 'react';

export function FigureRows({ children, className = '' }) {
  return (
    <ul className={`flex flex-col divide-y divide-border/60 border-y border-border/60 ${className}`}>
      {children}
    </ul>
  );
}

/** The fixed figure column: whatever figure it is given, then a small label. */
export function FigureColumn({ label, children }) {
  return (
    <span className="flex w-[4.5rem] shrink-0 flex-col items-start gap-1">
      {children}
      {label && <span className="text-micro leading-tight text-muted-foreground">{label}</span>}
    </span>
  );
}

/** A number drawn large with its unit small beside it. */
export function FigureValue({ figure, unit }) {
  return (
    <span className="flex items-baseline gap-0.5 leading-none">
      <span className="font-heading text-title font-semibold tabular-nums">{figure}</span>
      {unit && <span className="text-micro text-muted-foreground">{unit}</span>}
    </span>
  );
}

/**
 * @param {object} props
 * @param {React.ReactNode} [props.figure]  the number, drawn large
 * @param {React.ReactNode} [props.unit]    small unit after the number
 * @param {React.ComponentType} [props.icon] a lucide icon, used when there is no number
 * @param {React.ReactNode} [props.label]   small caption under the figure
 * @param {React.ReactNode} [props.column]  a whole figure column of the caller's own
 *                                          (the Coach draws rings, dots and bars)
 * @param {React.ElementType} [props.as]    the row element; the Coach card passes
 *                                          motion.li so its rows can stagger in
 * @param {React.ReactNode} props.children  the one line
 *
 * A row with no figure, icon or column is just its line.
 */
export default function FigureRow({ figure, unit, icon: Icon, label, column, as: Row = 'li', children, ...rest }) {
  let col = column || null;
  if (!col && Icon) {
    col = (
      <FigureColumn label={label}>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary">
          <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        </span>
      </FigureColumn>
    );
  } else if (!col && figure != null) {
    col = (
      <FigureColumn label={label}>
        <FigureValue figure={figure} unit={unit} />
      </FigureColumn>
    );
  }
  return (
    <Row className="flex items-center gap-2 py-2" {...rest}>
      {col}
      <span className="min-w-0 text-sm leading-snug">{children}</span>
    </Row>
  );
}
