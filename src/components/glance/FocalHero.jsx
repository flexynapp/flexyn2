// src/components/glance/FocalHero.jsx
//
// Hero option D, the layout half: the focal figure (usually a FocalRing) on
// the left, the sentence that says what it means today beside it, and a
// quieter line under that. Pages pass already-translated strings; the rules
// for which sentence live in src/lib/focalGoal.js.
//
// No card, no tint, no watermark. This is the page's one dominant element,
// and it earns that by being the only large thing on the screen rather than
// by being boxed. Spacing comes off the fluid scale (--fluid-section) because
// both pages that use it are phone-first and Progress is already converted.

import React from 'react';

export default function FocalHero({ figure, headline, detail, action, children, className = '' }) {
  return (
    <section className={`flex flex-col ${className}`} style={{ gap: 'var(--fluid-section)' }} data-testid="focal-hero">
      <div className="flex items-center" style={{ gap: 'var(--fluid-section)' }}>
        {figure}
        <div className="flex flex-col gap-2 min-w-0">
          <p className="text-title font-bold text-foreground text-balance" data-testid="focal-headline">{headline}</p>
          {detail && <p className="text-label text-muted-foreground leading-snug">{detail}</p>}
          {action}
        </div>
      </div>
      {children}
    </section>
  );
}
