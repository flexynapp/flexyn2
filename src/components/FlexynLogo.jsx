// src/components/FlexynLogo.jsx
//
// The Flexyn lockup (flame symbol + wordmark) from
// src/assets/flexyn-lockup.svg, inlined so the wordmark can follow the
// theme instead of the exported black — the flame keeps its fire gradient,
// the "Flexyn" wordmark renders in currentColor (matching the old header
// text, which was theme-aware). The bundled Leckerli One font (index.css)
// draws the wordmark, so the SVG's own Google-Fonts @import is stripped.
//
// Size it with a height utility on `className` (e.g. "h-8"); width scales
// to the lockup's aspect ratio.
import { useId } from 'react';
import raw from '@/assets/flexyn-lockup.svg?raw';

const base = raw
  // Tighten the viewBox to the actual mark bounds. The exported lockup's
  // viewBox is "0 0 489 141", but the flame + wordmark only occupy
  // x:36→333 / y:25→112 — leaving ~156px of dead space on the right (and
  // uneven top/bottom padding). With width:auto that padding rendered as a
  // gap: the mark hugged the left on mobile and sat left-of-centre in the
  // centered desktop sidebar. Reframe to the content (with ~4px breathing
  // room) so the lockup fills its box and centers correctly everywhere.
  .replace(/viewBox="0 0 489 141"/, 'viewBox="32 21 305 95"')
  // Let the container's height drive size; keep aspect ratio.
  // overflow:visible — the wordmark is live <text> in Leckerli One, which
  // loads async; before it lands, the fallback cursive can render a few px
  // wider than the tightened viewBox (only ~4px slack) and would clip at
  // the SVG edge. Visible overflow makes the FOUT frame draw fully.
  .replace(/\swidth="\d+"\s+height="\d+"/, ' style="height:100%;width:auto;display:block;overflow:visible"')
  // Theme-aware wordmark.
  .replace(/fill="#000000"/g, 'fill="currentColor"')
  // Drop the embedded Google-Fonts import (already loaded app-wide).
  .replace(/<style>[\s\S]*?<\/style>/g, '');

export default function FlexynLogo({ className = '' }) {
  // Unique gradient id per instance. The mobile header and the desktop
  // sidebar both render this logo; with a shared id, url(#flexynFire)
  // resolved to whichever copy is first in the DOM — the sidebar's, which
  // sits in a display:none subtree on mobile, so the flame painted nothing.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const html = base.replace(/flexynFire/g, `flexynFire${uid}`);
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
