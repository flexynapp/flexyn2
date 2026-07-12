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
  // Let the container's height drive size; keep aspect ratio.
  .replace(/\swidth="\d+"\s+height="\d+"/, ' style="height:100%;width:auto;display:block"')
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
