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
  ['SHIPPED - the list leads with cost',
   'Sheet A is built. "Shoulders, serious" is a receipt for something they already know; the exercise count exists nowhere else. It comes from injuryImpact(), which walks the SAME catalog and the SAME group/part test generateWorkout filters on, so the number on screen cannot drift from the lifts actually withheld. Real values: serious shoulder 13 of 39, glutes 3.'],
  ['SHIPPED - "what it changed"',
   'Sheet C is built. Logging an injury produced a toast and a banner, and the first time you saw what it did was when a session arrived without the lifts you expected. It now names them, says what is still trainable, and offers the Coach a session around it. The synergist line shows only on a SERIOUS injury - the one case where the list is wider than the area you named.'],
  ['SHIPPED - cleared injuries collapse',
   'One row, one tap. History under a live list competes with the thing that is currently changing your training.'],
  ['SHIPPED - the way out',
   '0 of 6 injuries carry a recovery date, and that empty field silenced the whole check-in system - three sat open 26, 59 and 75 days with nothing offering the muscle group back. The check-in now fires on the injury AGE (7/14/28 by severity) and "Still hurts" is one tap. The duration chips on sheet B are still the better ask; the one-way door is closed either way.'],
  ['SHIPPED - severity states its consequence',
   'Mild and moderate were the identical primary chip, so the choice that decides whether a body part leaves every session looked like decoration. Muted / primary / destructive, inside the four-hue budget.'],
  ['SHIPPED - mild is excluded, everywhere',
   'The generator always removed a mild region; buildStarterRegimen kept it with an "Ease in" note, so a mild knee got squats on day one and never again. Both ends now agree, onboarding says so, and the coach names mild injuries in its avoid-list.'],
  ['SHIPPED - the valve widens, not lowers',
   'It kept "the three exercises hitting the fewest injured areas" - fewest, not none - so it programmed regions the user had just flagged. Now it searches the goal pool, then every curated pool, then the whole library, requiring NO injured area. Full Body and Cardio are not injury groups and slipped every filter; they now expand to what they load.'],
  ['SHIPPED - the note reaches the coach',
   'The field says "Any context for your coach" and the coach never saw it. Verified against claude-haiku-4-5: asked about overhead press on a serious shoulder it answered "your LEFT shoulder" - a detail that exists only in the note. Whitespace is collapsed both sides; the digest is newline-delimited and this is its only free text.'],
  ['SHIPPED - "Progress > Recovery" is gone',
   'Onboarding named that route twice and there is no such tab. Both strings now point at Profile > My Injuries.'],
  ['STILL SPEC - duration chips',
   'Sheet B four "how long" chips are not built. The date picker is still there, now optional rather than load-bearing. Chips would also make the countdown and the 3-day warning work, which have never run.'],
  ['NOT VERIFIED ON A DEVICE',
   'Everything above is lint, build and 3770 tests - including 12 that mount sheets A and C in jsdom and assert what is on screen. None of it has been seen on a phone: the screens sit behind the auth wall in a z-[200] portal. Worth one pass through log > check-in > clear, and one in a non-English locale.'],
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
