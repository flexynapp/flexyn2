// src/components/ui/FigureRow.jsx
//
// The "figure first" row: a number or an icon in a fixed left column, one
// short line beside it, hairlines between rows. It is how an explainer reads
// at a glance instead of as a stack of paragraphs (Kegan, 2026-10-02: visuals
// first, text only when it is needed).
//
// The column is the same 4.5rem the Coach answer card uses for its figures
// (draft PR #317), so a rule in a sheet and a point in a Coach reply line up
// the same way. Static on purpose: motion for these rows waits for the shared
// motion tiers.

import React from 'react';

export function FigureRows({ children, className = '' }) {
  return (
    <ul className={`flex flex-col divide-y divide-border/60 border-y border-border/60 ${className}`}>
      {children}
    </ul>
  );
}

/**
 * @param {object} props
 * @param {React.ReactNode} [props.figure]  the number, drawn large
 * @param {React.ReactNode} [props.unit]    small unit after the number
 * @param {React.ComponentType} [props.icon] a lucide icon, used when there is no number
 * @param {React.ReactNode} [props.label]   small caption under the figure
 * @param {React.ReactNode} props.children  the one line
 */
export default function FigureRow({ figure, unit, icon: Icon, label, children }) {
  return (
    <li className="flex items-center gap-2 py-2">
      <span className="flex w-[4.5rem] shrink-0 flex-col items-start gap-1">
        {Icon ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary">
            <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
          </span>
        ) : (
          <span className="flex items-baseline gap-0.5 leading-none">
            <span className="font-heading text-title font-semibold tabular-nums">{figure}</span>
            {unit && <span className="text-micro text-muted-foreground">{unit}</span>}
          </span>
        )}
        {label && <span className="text-micro leading-tight text-muted-foreground">{label}</span>}
      </span>
      <span className="min-w-0 text-sm leading-snug">{children}</span>
    </li>
  );
}
