// src/components/EmptyState.jsx
//
// Shared empty-state placeholder. Use anywhere a list could be empty:
//   <EmptyState
//     icon={Users}
//     title="No posts yet"
//     body="Follow some athletes or share your first workout to fill your feed."
//     action={{ label: 'Share workout', onClick: () => navigate('/workout') }}
//   />
//
// Designed to feel friendly, not error-y: large icon in a soft circle,
// clear hierarchy, optional action button so the user knows the next move.

import React from 'react';
import { motion } from 'framer-motion';

export default function EmptyState({
  icon: Icon,
  title,
  body,
  action,         // { label, onClick }  or undefined
  secondaryAction, // same shape — optional
  className = '',
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={`flex flex-col items-center justify-center text-center py-12 px-6 ${className}`}
    >
      {Icon && (
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
          <Icon className="w-7 h-7" strokeWidth={1.75} />
        </div>
      )}
      {title && (
        <h3 className="font-heading font-bold text-base mb-1.5 max-w-xs">{title}</h3>
      )}
      {body && (
        <p className="text-sm text-muted-foreground max-w-xs leading-relaxed mb-5">
          {body}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {action && (
          <button
            onClick={action.onClick}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-opacity"
          >
            {action.label}
          </button>
        )}
        {secondaryAction && (
          <button
            onClick={secondaryAction.onClick}
            className="px-4 py-2 rounded-lg border border-border text-foreground text-sm font-medium hover:bg-secondary transition-colors"
          >
            {secondaryAction.label}
          </button>
        )}
      </div>
    </motion.div>
  );
}
