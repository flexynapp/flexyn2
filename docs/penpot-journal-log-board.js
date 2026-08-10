// docs/penpot-journal-log-board.js
//
// Builds "My Journal — the Log (group 05 resolved)" on Page 2 at x=13380.
//
// ── HOW TO RUN ────────────────────────────────────────────────────
// The plugin's active page follows the BROWSER TAB and re-syncs between
// tool calls, so `penpot.openPage()` holds only INSIDE a single call.
// Either select Page 2 in the UI first, or keep the openPage + assert in
// the same call as the draw. Idempotent — removes any previous board of
// the same name, which makes it safe to re-run after a bridge timeout
// (a timed-out call may have landed its writes; this one may have drawn
// screen A before the bridge died).
//
// ── WHAT GROUP 05 ASKED, AND WHAT THIS ANSWERS ────────────────────
// The Log is a flat list of up to 365 rows, newest first, no grouping,
// no search, no scrubber — and, more seriously, no way to tell an empty
// log from a broken one. Three changes:
//
//   1. MONTH HEADERS, sticky. They replace the scrubber the slots board
//      floated: with a year of rows the real question is "roughly when",
//      and a sticky header answers it continuously while you scroll. A
//      scrubber would be a second control for the same job, and it is
//      the one that has to be designed for touch.
//   2. A MOOD-ONLY ROW RENDERS ITS MOOD. This is the defect the slots
//      board named — half of production's rows have no title and no body,
//      so the row drew a bare date and stopped. The day screen was fixed
//      for this; the Log was not, and a list of bare dates is exactly
//      where it reads worst.
//   3. A FAILED READ STOPS IMPERSONATING AN EMPTY LOG. `listEntries`
//      returns [] on error, so "you have never written anything" and "we
//      could not reach the server" were the same screen. The first is a
//      fact about the user, the second is a fact about us, and only one
//      of them should be phrased as an invitation to start writing.
//
// Deliberately NOT here: full-text search. It is a different feature with
// its own empty state and its own performance question (365 bodies are
// not shipped to the client — `listEntries` sends a 90-char snippet), and
// month headers plus the day screen's navigation cover "find that day".
// Raise it as its own slot if it is wanted.

const PAGE = 'Page 2';
const NAME = 'My Journal — the Log (group 05 resolved)';
// 60 pad + three 390 sheets at 10 gaps (right edge 1250) + 10 + 300
// decisions + 60 pad.
const BX = 13380, BY = 0, BW = 1620;

const page = penpotUtils.getPageByName(PAGE);
if (!page) throw new Error(`page "${PAGE}" not found`);
if (penpot.currentPage.id !== page.id) {
  return { aborted: true, reason: `Select "${PAGE}" in the Penpot UI first, then re-run.`, on: penpot.currentPage.name };
}
const old = penpotUtils.findShape(s => s.name === NAME, page.root);
if (old) old.remove();

const tok = (n) => penpotUtils.findTokenByName(n);
const dk = penpot.library.local.tokens.sets.find(s => s.name === 'theme.dark');
const rc = (n) => { const t = (dk && dk.tokens.find(x => x.name === n)) || tok(n); return t ? t.resolvedValue : '#888888'; };
const C = {
  background: rc('color.background'), foreground: rc('color.foreground'), card: rc('color.card'),
  border: rc('color.border'), secondary: rc('color.secondary'), mutedFg: rc('color.muted-foreground'),
  primary: rc('color.primary'), destructive: rc('color.destructive'),
};
const ax = (x) => BX + x, ay = (y) => BY + y;

const board = penpot.createBoard();
board.name = NAME; board.x = BX; board.y = BY; board.resize(BW, 1010);
board.fills = [{ fillColor: C.background, fillOpacity: 1 }];
board.borderRadius = 16;
{ const k = tok('color.background'); if (k) board.applyToken(k, ['fill']); }

function txt(chars, o) {
  const t = penpot.createText(chars);
  t.x = ax(o.x); t.y = ay(o.y); t.growType = 'auto-height';
  t.fontSize = String(o.size || 13); t.fontFamily = 'Work Sans';
  t.fontWeight = String(o.weight || 400);
  t.fills = [{ fillColor: o.color || C.foreground, fillOpacity: o.opacity == null ? 1 : o.opacity }];
  t.resize(o.w || 200, t.height); t.growType = 'auto-height';
  if (o.align) { t.align = o.align; try { t.getRange(0, chars.length).align = o.align; } catch (e) { /* range not ready */ } }
  if (o.token) { const k = tok(o.token); if (k) t.applyToken(k, ['fill']); }
  t.name = o.name || `t / ${chars.slice(0, 20)}`;
  return t;
}
function rect(o) {
  const r = penpot.createRectangle();
  r.x = ax(o.x); r.y = ay(o.y); r.resize(o.w, o.h);
  r.borderRadius = o.radius == null ? 0 : o.radius;
  r.fills = o.fill === null ? [] : [{ fillColor: o.fill || C.secondary, fillOpacity: o.fillOpacity == null ? 1 : o.fillOpacity }];
  if (o.stroke) r.strokes = [{ strokeColor: o.stroke, strokeOpacity: 1, strokeWidth: 1, strokeAlignment: 'center' }];
  if (o.token && o.fill !== null) { const k = tok(o.token); if (k) r.applyToken(k, ['fill']); }
  r.name = o.name || 'rect';
  return r;
}
// The Log is a BOTTOM SHEET (rounded-t-2xl, max-h-[80vh] ≈ 675 on an 844
// phone), so it is drawn at its own size rather than inside a device frame.
function sheet(name, x, y) {
  const s = penpot.createBoard();
  s.name = name; s.x = ax(x); s.y = ay(y); s.resize(390, 700);
  s.fills = [{ fillColor: C.card, fillOpacity: 1 }];
  s.borderRadiusTopLeft = 16; s.borderRadiusTopRight = 16;
  s.strokes = [{ strokeColor: C.border, strokeOpacity: 1, strokeWidth: 1, strokeAlignment: 'center' }];
  const k = tok('color.card'); if (k) s.applyToken(k, ['fill']);
  board.appendChild(s);
  return s;
}
// Bind local coordinates per sheet so a slip between the three is impossible.
function pen(s, ox, oy) {
  return {
    T: (c, o) => s.appendChild(txt(c, { ...o, x: ox + o.x, y: oy + o.y })),
    R: (o) => s.appendChild(rect({ ...o, x: ox + o.x, y: oy + o.y })),
  };
}

board.appendChild(txt('The Log — group 05 resolved', { x: 60, y: 44, size: 26, weight: 700, color: C.foreground, w: 700, token: 'color.foreground' }));
board.appendChild(txt(
  'A flat list of up to 365 rows, newest first, with no grouping and no way to tell an empty log from a broken one. Three changes: month\n' +
  'headers so a year of entries is navigable; a mood-only row renders its MOOD instead of a bare date (the defect the slots board named,\n' +
  'still live in the Log after the day screen was fixed); and a failed read stops impersonating an empty log.',
  { x: 60, y: 84, size: 12, color: C.mutedFg, w: 1080, token: 'color.muted-foreground' }));

// ── A · the sheet, grouped by month ───────────────────────────────
const AX = 60, AY = 180;
{
  const a = sheet('sheet / grouped by month', AX, AY);
  const { T, R } = pen(a, AX, AY);
  T('Journal log', { x: 44, y: 18, size: 16, weight: 700, color: C.foreground, w: 200, token: 'color.foreground' });
  T('×', { x: 352, y: 14, size: 18, color: C.mutedFg, w: 20, token: 'color.muted-foreground' });
  R({ x: 0, y: 49, w: 390, h: 1, fill: C.border, token: 'color.border' });

  let y = 50;
  const monthHeader = (label) => {
    R({ x: 0, y, w: 390, h: 28, fill: C.secondary, token: 'color.secondary', name: `month header / ${label} (sticky)` });
    T(label, { x: 16, y: y + 8, size: 11, weight: 700, color: C.mutedFg, w: 200, token: 'color.muted-foreground' });
    y += 28;
  };
  const row = (date, line1, line2, rail, active) => {
    if (active) R({ x: 0, y, w: 390, h: 64, fill: C.primary, fillOpacity: 0.1, name: 'row / active tint' });
    T(date, { x: 16, y: y + 10, size: 11, weight: 700, color: C.mutedFg, w: 180, token: 'color.muted-foreground' });
    if (rail) T(rail, { x: 250, y: y + 10, size: 11, color: C.mutedFg, w: 124, align: 'right', token: 'color.muted-foreground' });
    if (line1) T(line1, { x: 16, y: y + 26, size: 14, weight: 700, color: C.foreground, w: 340, token: 'color.foreground' });
    if (line2) T(line2, { x: 16, y: y + 44, size: 12, color: C.mutedFg, w: 340, token: 'color.muted-foreground' });
    y += 64;
    R({ x: 0, y, w: 390, h: 1, fill: C.border, token: 'color.border' });
  };
  monthHeader('AUGUST');
  row('SUN, AUG 9', 'Push day — felt strong', 'Bench 3x5 @ 185. Everything moved well.', '\u{1F4CE} 2', true);
  // Untitled rows lead with their snippet — 0 of 12 production rows carry a
  // title, so this is the NORMAL shape. Drawn as the muted second line at
  // first, which contradicted the code and was only visible in an export.
  row('SAT, AUG 8', 'Wrote this up the next morning. Squats moved well.', null, 'edited');
  row('THU, AUG 6', '\u{1F604}  You felt Good', null, null);
  row('SUN, AUG 2', 'Easy 5k', 'Legs heavy.', 'edited');
  monthHeader('JULY');
  row('TUE, JUL 28', 'Leg day', 'Squats felt heavy from the first warm-up.', '\u{1F642}');
  row('SAT, JUL 25', '\u{1F629}  You felt Awful', null, null);
  T('Sticky month headers replace the scrubber the slots board floated. With 365 rows the question is "roughly when", and a header answers it continuously while you scroll; a scrubber is a second control for the same job.',
    { x: 16, y: 560, size: 11, color: C.mutedFg, w: 350, token: 'color.muted-foreground' });
}

// ── B · row anatomy ───────────────────────────────────────────────
const BXo = 460, BYo = 180;
{
  const b = sheet('sheet / row anatomy · four shapes at 390', BXo, BYo);
  const { T, R } = pen(b, BXo, BYo);
  T('THE ROW', { x: 16, y: 18, size: 11, weight: 700, color: C.mutedFg, w: 200, token: 'color.muted-foreground' });
  R({ x: 0, y: 49, w: 390, h: 1, fill: C.border, token: 'color.border' });

  let y = 60;
  const spec = (caption, draw) => {
    T(caption, { x: 16, y, size: 11, weight: 700, color: C.foreground, w: 350, token: 'color.foreground' });
    y += 20;
    draw(y);
    y += 76;
    R({ x: 16, y, w: 358, h: 1, fill: C.border, token: 'color.border' });
    y += 16;
  };

  spec('1 · WRITTEN — the designed case', (yy) => {
    T('SUN, AUG 9', { x: 16, y: yy + 6, size: 11, weight: 700, color: C.mutedFg, w: 180, token: 'color.muted-foreground' });
    T('\u{1F642}   \u{1F4CE} 2   edited', { x: 230, y: yy + 6, size: 11, color: C.mutedFg, w: 144, align: 'right', token: 'color.muted-foreground' });
    T('Push day — felt strong', { x: 16, y: yy + 22, size: 14, weight: 700, color: C.foreground, w: 340, token: 'color.foreground' });
    T('Bench 3x5 @ 185. Everything moved well.', { x: 16, y: yy + 42, size: 12, color: C.mutedFg, w: 340, token: 'color.muted-foreground' });
  });

  spec('2 · UNTITLED — assume this is NORMAL: 0 of 12 rows have a title', (yy) => {
    T('SAT, AUG 8', { x: 16, y: yy + 6, size: 11, weight: 700, color: C.mutedFg, w: 180, token: 'color.muted-foreground' });
    T('Wrote this up the next morning. Squats moved well.', { x: 16, y: yy + 24, size: 14, color: C.foreground, w: 340, token: 'color.foreground' });
  });

  spec('3 · MOOD ONLY — THE FIX. Half the real rows. Was a bare date.', (yy) => {
    T('THU, AUG 6', { x: 16, y: yy + 6, size: 11, weight: 700, color: C.mutedFg, w: 180, token: 'color.muted-foreground' });
    T('\u{1F604}  You felt Good', { x: 16, y: yy + 24, size: 14, weight: 700, color: C.foreground, w: 340, token: 'color.foreground' });
  });

  spec('4 · ACTIVE — the day currently open behind the sheet', (yy) => {
    R({ x: 0, y: yy - 4, w: 390, h: 60, fill: C.primary, fillOpacity: 0.1, name: 'row / active tint' });
    T('SUN, AUG 2', { x: 16, y: yy + 6, size: 11, weight: 700, color: C.mutedFg, w: 180, token: 'color.muted-foreground' });
    T('Easy 5k', { x: 16, y: yy + 24, size: 14, weight: 700, color: C.foreground, w: 340, token: 'color.foreground' });
  });

  T('The right rail carries mood / attachments / edited only when the row HAS words — on a mood-only row the mood is the content, so repeating it in the rail would say the same thing twice on one line.',
    { x: 16, y: 560, size: 11, color: C.mutedFg, w: 350, token: 'color.muted-foreground' });
}

// ── C · empty vs failed ───────────────────────────────────────────
const CXo = 860, CYo = 180;
{
  const c = sheet('sheet / empty vs failed — two states, not one', CXo, CYo);
  const { T, R } = pen(c, CXo, CYo);
  T('Journal log', { x: 44, y: 18, size: 16, weight: 700, color: C.foreground, w: 200, token: 'color.foreground' });
  R({ x: 0, y: 49, w: 390, h: 1, fill: C.border, token: 'color.border' });

  T('EMPTY — a fact about the user', { x: 16, y: 70, size: 11, weight: 700, color: C.mutedFg, w: 300, token: 'color.muted-foreground' });
  R({ x: 16, y: 92, w: 358, h: 120, radius: 12, fill: null, stroke: C.border, name: 'slot / empty state' });
  T('No entries yet', { x: 16, y: 128, size: 15, weight: 700, color: C.foreground, w: 358, align: 'center', token: 'color.foreground' });
  T('Write your first entry and it shows up here.', { x: 16, y: 152, size: 12, color: C.mutedFg, w: 358, align: 'center', token: 'color.muted-foreground' });

  T('FAILED — a fact about US', { x: 16, y: 240, size: 11, weight: 700, color: C.mutedFg, w: 300, token: 'color.muted-foreground' });
  R({ x: 16, y: 262, w: 358, h: 140, radius: 12, fill: null, stroke: C.border, name: 'slot / failed state' });
  T('Couldn’t load your log', { x: 16, y: 296, size: 15, weight: 700, color: C.foreground, w: 358, align: 'center', token: 'color.foreground' });
  T('Your entries are safe — this is us, not you.', { x: 16, y: 320, size: 12, color: C.mutedFg, w: 358, align: 'center', token: 'color.muted-foreground' });
  R({ x: 155, y: 348, w: 80, h: 34, radius: 10, fill: C.secondary, token: 'color.secondary', name: 'button / Try again' });
  T('Try again', { x: 155, y: 357, size: 13, weight: 700, color: C.foreground, w: 80, align: 'center', token: 'color.foreground' });

  T('These were ONE screen. `listEntries` returns [] on error, so a broken read told the user they had never written anything — and invited them to start, over a log that may be full. An empty state is a claim about the world, and we may only make it when the read actually succeeded.',
    { x: 16, y: 430, size: 11, color: C.mutedFg, w: 350, token: 'color.muted-foreground' });
  T('Same rule as the gym picker: "there are no gyms near you" is only sayable when the lookup succeeded (CLAUDE.md, Home gym).',
    { x: 16, y: 520, size: 11, color: C.mutedFg, w: 350, token: 'color.muted-foreground' });
}

// ── decisions ─────────────────────────────────────────────────────
{
  let y = 180;
  const X = 1260;
  board.appendChild(txt('DECISIONS', { x: X, y, size: 11, weight: 700, color: C.mutedFg, w: 300, token: 'color.muted-foreground' }));
  y += 18;
  board.appendChild(rect({ x: X, y, w: 300, h: 1, fill: C.border, token: 'color.border' }));
  y += 16;
  [
    ['Month headers, not a scrubber', 'One control, not two, and it works while scrolling rather than instead of it. Sticky so the answer to "when am I" is always on screen.'],
    ['A mood-only row shows its mood', 'The slots board flagged the bare-date row and the day screen got the fix; the Log did not. It is half the rows, and a list is where a column of bare dates reads worst.'],
    ['Empty and failed are different screens', 'listEntries returns [] on error, so the two were identical. Only one of them should invite you to start writing.'],
    ['The rail stays off mood-only rows', 'The mood is the content there. Repeating it in the right rail says the same thing twice on one line.'],
    ['No search', 'A different feature with its own empty state and its own cost — bodies are not shipped to the client, only a 90-char snippet. Month headers plus day navigation cover "find that day".'],
  ].forEach(([h, b]) => {
    board.appendChild(txt(h, { x: X, y, size: 12, weight: 700, color: C.foreground, w: 300, token: 'color.foreground' }));
    y += 20;
    board.appendChild(txt(b, { x: X, y, size: 11, color: C.mutedFg, w: 300, token: 'color.muted-foreground' }));
    y += Math.ceil(b.length / 52) * 14 + 24;
  });
}

board.resize(BW, 1010);
return {
  board: NAME, x: BX, width: BW, height: 1010, sheets: 3,
  next: 'Export each 390pt sheet on its own and LOOK — the full board scales text to nothing.',
};
