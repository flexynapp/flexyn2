// src/components/journal/MarkdownBody.jsx
//
// The journal's read-only body renderer, extracted from JournalView so the
// rendering rules can be tested directly rather than through a full editor
// with a language context, a supabase client and a portal behind it.
//
// It understood exactly what the toolbar produces — bold and bullets — and
// nothing else, so anything a person TYPED came back at them literally on a
// read-only day: "# Deload week" rendered with the hash still on it, and
// "1. Squats" kept its "1.". The toolbar is not the only way text gets in
// here (a keyboard is), so the renderer has to cover the shapes people
// reach for unprompted.
//
// Headings and ordered lists are the two that come up. Italics are
// deliberately absent: `*one*` and `**two**` cannot both be parsed by a
// splitter this small without one eating the other.

import React from 'react';

export function renderInline(text) {
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g);
  return parts.map((p, i) =>
    /^\*\*[^*\n]+\*\*$/.test(p)
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{p}</React.Fragment>
  );
}
export default function MarkdownBody({ text, placeholder }) {
  if (!text || !text.trim()) return <p className="text-muted-foreground/50 text-sm">{placeholder}</p>;
  const lines = text.split('\n');
  const nodes = [];
  let bullets = [];
  let numbers = [];
  const flushBullets = () => {
    if (bullets.length) { nodes.push(<ul key={`ul-${nodes.length}`} className="list-disc list-inside space-y-0.5 my-1">{bullets}</ul>); bullets = []; }
  };
  const flushNumbers = () => {
    if (numbers.length) { nodes.push(<ol key={`ol-${nodes.length}`} className="list-decimal list-inside space-y-0.5 my-1">{numbers}</ol>); numbers = []; }
  };
  const flush = () => { flushBullets(); flushNumbers(); };

  lines.forEach((line, i) => {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (/^[-*]\s/.test(line)) {
      flushNumbers();
      bullets.push(<li key={i} className="text-sm leading-relaxed">{renderInline(line.slice(2))}</li>);
    } else if (ordered) {
      flushBullets();
      numbers.push(<li key={i} className="text-sm leading-relaxed">{renderInline(ordered[1])}</li>);
    } else if (heading) {
      flush();
      // One visual weight for every level. The entry already has a title
      // field above it, so a three-step heading ramp inside the body would
      // compete with it and break the screen's single focal point.
      nodes.push(
        <p key={i} className="font-heading font-bold text-sm text-foreground mt-3 first:mt-0">
          {renderInline(heading[2])}
        </p>
      );
    } else {
      flush();
      if (line.trim() === '') { nodes.push(<div key={i} className="h-3" />); }
      else { nodes.push(<p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>); }
    }
  });
  flush();
  return <div className="space-y-0.5">{nodes}</div>;
}
