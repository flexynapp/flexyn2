// docs/penpot-injuries-decisions.js
//
// Finishes "Injuries & Recovery — resolved": adds the DECISIONS column and
// applies the one correction the render exposed. Sheets A, B and C are
// already drawn and were checked by exporting them, so this deliberately
// does NOT redraw them — re-running the full board script would replace
// verified output with an untested redraw for no gain.
//
// ── HOW TO RUN ────────────────────────────────────────────────────
// Select "Injuries & Recovery" in the Penpot UI, then paste this into the
// plugin console. It asserts the page and refuses to draw anywhere else.
//
// `penpot.openPage()` works, but only from the NEXT call onwards — inside
// the call that invokes it, `penpot.currentPage` is still the old page, and
// `createText` lands on whatever page is active NOW. So an unguarded script
// that opens a page and immediately draws builds on the previous one. That
// already happened once, to "Weekly Reviews — dashboard". Open in one call,
// draw in the next, and keep the assert regardless: the active page follows
// the browser tab and drifts back on its own.
//
// Idempotent: removes anything it previously added before adding it again.
//
// ── THE CORRECTION ────────────────────────────────────────────────
// The severity rows tinted Moderate and Serious with their own hue, to make
// the three "visibly different". Exported and looked at, the problem is
// immediate: TWO rows read as selected. Fill is selection state and nothing
// else here; severity identity belongs on the label colour. So Moderate
// loses its tint and every label takes its own hue.

const PAGE = 'Injuries & Recovery';
const NAME = 'Injuries & Recovery — resolved';

const page = penpot.currentPage;
if (page.name !== PAGE) {
  return {
    aborted: true,
    on: page.name,
    fix: `Select "${PAGE}" in the Penpot UI, then re-run. A page that is not active cannot be modified.`,
  };
}
const board = (page.root.children || []).find(c => c.name === NAME);
if (!board) return { aborted: true, reason: `board "${NAME}" not found on this page` };

const tok = (n) => penpotUtils.findTokenByName(n);
const dk = penpot.library.local.tokens.sets.find(s => s.name === 'theme.dark');
const rc = (n) => { const t = (dk && dk.tokens.find(x => x.name === n)) || tok(n); return t ? t.resolvedValue : '#888888'; };
const C = {
  foreground: rc('color.foreground'), border: rc('color.border'),
  mutedFg: rc('color.muted-foreground'), primary: rc('color.primary'),
  destructive: rc('color.destructive'),
};

// ── 1 · the correction ────────────────────────────────────────────
const fixed = [];
const sheetB = (board.children || []).find(c => c.name.startsWith('B ·'));
if (sheetB) {
  const moderate = penpotUtils.findShape(s => s.name === 'severity / Moderate', sheetB);
  if (moderate) {
    moderate.fills = [];
    moderate.strokes = [{ strokeColor: C.border, strokeOpacity: 1, strokeWidth: 1, strokeAlignment: 'center' }];
    fixed.push('severity / Moderate — tint removed, so only the selected row reads as selected');
  }
  // Labels carry the severity, now that the fill does not.
  for (const [label, color] of [['Mild', C.mutedFg], ['Moderate', C.primary]]) {
    const t = penpotUtils.findShape(s => s.type === 'text' && s.characters === label, sheetB);
    if (t) {
      t.fills = [{ fillColor: color, fillOpacity: 1 }];
      fixed.push(`label "${label}" → its own hue`);
    }
  }
}

// ── 2 · the decisions column ──────────────────────────────────────
(board.children || [])
  .filter(c => c.name === 'DECISIONS' || c.name.startsWith('d /'))
  .forEach(c => c.remove());

function txt(chars, o) {
  const t = penpot.createText(chars);
  t.x = o.x; t.y = o.y; t.growType = 'auto-height';
  t.fontSize = String(o.size || 13); t.fontFamily = 'Work Sans';
  t.fontWeight = String(o.weight || 400);
  t.fills = [{ fillColor: o.color || C.foreground, fillOpacity: 1 }];
  t.resize(o.w || 300, t.height); t.growType = 'auto-height';
  if (o.token) { const k = tok(o.token); if (k) t.applyToken(k, ['fill']); }
  t.name = o.name || `d / ${chars.slice(0, 28)}`;
  return t;
}

const X = board.x + 1260;
let y = board.y + 180;

board.appendChild(txt('DECISIONS', { x: X, y, size: 11, weight: 700, color: C.mutedFg, w: 300, token: 'color.muted-foreground', name: 'DECISIONS' }));
y += 18;
{
  const rule = penpot.createRectangle();
  rule.x = X; rule.y = y; rule.resize(300, 1);
  rule.fills = [{ fillColor: C.border, fillOpacity: 1 }];
  rule.name = 'd / rule';
  board.appendChild(rule);
}
y += 16;

// Each of these is forced by something measured against the six injuries in
// production, not by taste. The measurement is in the text on purpose — a
// decision whose reason is not written down gets reversed by the next person
// who finds it inconvenient.
const DECISIONS = [
  ['Duration chips, not a date picker',
   '0 of 6 production injuries carry an estimated_recovery_date, and that one empty field silences the 3-day warning, the clearance prompt, the countdown and Extend. Four taps, and "Not sure" still books a check-in.'],
  ['Severity states its consequence',
   'It decides whether a body part leaves every session. Both mild and moderate were the identical primary chip, so the choice looked like decoration. Muted / primary / destructive reads as a ramp, inside the four-hue budget.'],
  ['A "what it changed" screen',
   'The largest automatic change the app makes to your training, and the only one that never explained itself. Naming the removed lifts is also the only way a user can catch a mis-tap.'],
  ['The list leads with cost, not label',
   '"Shoulders, serious" is a receipt for something they already know. "8 exercises are out" is the fact that exists nowhere else — and it only became true on 2026-08-09, when the exclusion finally matched the catalog.'],
  ['Cleared injuries collapse',
   'History under a live list competes with the thing that is currently changing your training. One row, one tap.'],
  ['OPEN — mild trains around, or not',
   'buildStarterRegimen keeps a mild region and attaches an "Ease in" note. The runtime generator removes it at every severity. So onboarding is true of the starter plan and false of every session after it. A behaviour split, not a copy bug.'],
  ['"Progress > Recovery" is not a route',
   'Onboarding named it twice and there is no such tab. Both strings now point at Profile > My Injuries. If Injuries ever becomes a real route, this design is the page.'],
];

for (const [h, b] of DECISIONS) {
  board.appendChild(txt(h, { x: X, y, size: 12, weight: 700, color: C.foreground, w: 300, token: 'color.foreground' }));
  y += 20;
  board.appendChild(txt(b, { x: X, y, size: 11, color: C.mutedFg, w: 300, token: 'color.muted-foreground' }));
  y += Math.ceil(b.length / 52) * 14 + 24;
}

const height = Math.max(1180, (y - board.y) + 40);
board.resize(1620, height);

return {
  page: PAGE,
  board: NAME,
  decisions: DECISIONS.length,
  corrections: fixed,
  boardHeight: Math.round(board.height),
  next: 'Export sheet B on its own and check that only Serious reads as selected.',
};
