// scripts/pose-sheet.mjs
//
// Render every drawn exercise pose to a standalone HTML contact sheet.
//
//   node scripts/pose-sheet.mjs [outfile]      (default: dist/pose-sheet.html)
//
// Joint angles that read fine as numbers are wrong on screen far more often
// than you would expect, and there is no substitute for looking at them all
// at once — a figure can be individually plausible and still be the only one
// facing the wrong way. Open this after touching exercisePoses.js.
//
// It imports the same geometry the app renders with, so what you see here is
// what ships. No React, no bundler, no dev server.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { figureMarkup } from '../src/lib/exerciseFigureGeometry.js';
import { POSES } from '../src/lib/data/exercisePoses.js';

const out = process.argv[2] || 'dist/pose-sheet.html';

const panel = (pose, label, isMiddle) => `
  <figure class="panel">
    <svg viewBox="0 0 200 200" fill="none" stroke-linecap="round" stroke-linejoin="round"
         class="${isMiddle ? 'mid' : ''}">${figureMarkup(pose, { accent: isMiddle })}</svg>
    <figcaption>${label}</figcaption>
  </figure>`;

const rows = Object.entries(POSES).map(([name, { frames, labels }]) => `
  <section class="row">
    <h2>${name}</h2>
    <div class="panels">
      ${frames.map((p, i) => panel(p, labels?.[i] || ['Start', 'Middle', 'End'][i], i === 1)).join('')}
    </div>
  </section>`).join('');

const html = `<!doctype html>
<meta charset="utf-8">
<title>Flexyn — exercise pose contact sheet</title>
<style>
  :root { --bg:#0d0d10; --fg:#e7e7ea; --muted:#8b8b94; --accent:#f97316; --line:#26262c; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; background:var(--bg); color:var(--fg);
         font:14px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif; }
  h1 { font-size:18px; margin:0 0 4px; }
  .sub { color:var(--muted); margin:0 0 24px; font-size:12px; }
  .row { border-top:1px solid var(--line); padding:16px 0; }
  .row h2 { font-size:14px; margin:0 0 10px; font-weight:600; }
  .panels { display:grid; grid-template-columns:repeat(3,180px); gap:12px; }
  .panel { margin:0; }
  .panel svg { width:180px; height:180px; background:#141419;
               border:1px solid var(--line); border-radius:10px;
               stroke:var(--fg); color:var(--fg); }
  .panel svg.mid { stroke:var(--accent); color:var(--accent); }
  figcaption { color:var(--muted); font-size:11px; margin-top:5px; text-align:center; }
</style>
<h1>Exercise pose contact sheet</h1>
<p class="sub">${Object.keys(POSES).length} exercises &middot; middle frame in accent &middot; dashed line is the floor</p>
${rows}
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} — ${Object.keys(POSES).length} exercises, ${Object.keys(POSES).length * 3} figures`);
