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
import raw from '@/assets/flexyn-lockup.svg?raw';

const html = raw
  // Let the container's height drive size; keep aspect ratio.
  .replace(/\swidth="\d+"\s+height="\d+"/, ' style="height:100%;width:auto;display:block"')
  // Theme-aware wordmark.
  .replace(/fill="#000000"/g, 'fill="currentColor"')
  // Drop the embedded Google-Fonts import (already loaded app-wide).
  .replace(/<style>[\s\S]*?<\/style>/g, '');

export default function FlexynLogo({ className = '' }) {
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
