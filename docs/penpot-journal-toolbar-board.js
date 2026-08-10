// docs/penpot-journal-toolbar-board.js
//
// Builds "My Journal — toolbar & attachments (group 07 resolved)" on
// Page 2 at x=15120 (the Log board ends at 15000).
//
// ── HOW TO RUN ────────────────────────────────────────────────────
// The plugin's active page follows the BROWSER TAB and re-syncs between
// tool calls, so `penpot.openPage()` holds only INSIDE a single call.
// Select Page 2 in the UI first, or keep openPage + the assert in the
// same call as the draw. Idempotent — removes any previous board of the
// same name, so it is safe to re-run after a bridge timeout.
//
// ── WHAT GROUP 07 ASKED, AND WHAT SHIPPED ─────────────────────────
// Four defects, three of which were the app doing nothing at all:
//
//   1. THE CAP WAS A SILENT NO-OP. `slice(0, 12 - 12)` is an empty list,
//      so the chooser opened, you picked a photo, and it vanished. A day
//      holding more than 12 gave a NEGATIVE end index, and `slice(0,-1)`
//      drops the LAST item rather than taking none — it would have
//      uploaded all but one. Both the cap and a partial batch now say
//      what happened.
//   2. UPLOADS HID BEHIND ONE SPINNER on the attach button, so picking
//      four photos read as nothing happening until they appeared one at
//      a time. There is a placeholder chip per file in the grid now.
//   3. DICTATION ALWAYS APPENDED TO THE END, so a correction spoken into
//      the middle of an entry was filed at the bottom. It inserts at the
//      caret and walks that caret forward between chunks.
//   4. THE RENDERER ONLY UNDERSTOOD WHAT THE TOOLBAR EMITS — bold and
//      bullets — so typed markdown came back with its syntax attached.
//
// The chip grid uses tileRow(), not a fixed-80px flex-wrap: the COUNT
// comes from data, which is exactly the test CLAUDE.md sets. Three-up
// tiles fill the column instead of leaving a ragged strip.

const PAGE = 'Page 2';
const NAME = 'My Journal — toolbar & attachments (group 07 resolved)';
// 60 pad + three 390 sheets at 10 gaps (right edge 1250) + 10 + 300
// decisions + 60 pad.
const BX = 15120, BY = 0, BW = 1620;

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
  if (o.align) { t.align = o.align; try { t.getRange(0, chars.length).align = o.align; } catch (e) { /* not ready */ } }
  if (o.token) { const k = tok(o.token); if (k) t.applyToken(k, ['fill']); }
  t.name = o.name || `t / ${chars.slice(0, 20)}`;
  return t;
}
function rect(o) {
  const r = penpot.createRectangle();
  r.x = ax(o.x); r.y = ay(o.y); r.resize(o.w, o.h);
  r.borderRadius = o.radius == null ? 0 : o.radius;
  r.fills = o.fill === null ? [] : [{ fillColor: o.fill || C.secondary, fillOpacity: o.fillOpacity == null ? 1 : o.fillOpacity }];
  if (o.stroke) r.strokes = [{ strokeColor: o.stroke, strokeOpacity: 1, strokeWidth: 1, strokeAlignment: 'center', strokeStyle: o.strokeStyle || 'solid' }];
  if (o.token && o.fill !== null) { const k = tok(o.token); if (k) r.applyToken(k, ['fill']); }
  r.name = o.name || 'rect';
  return r;
}
function sheet(name, x, y) {
  const s = penpot.createBoard();
  s.name = name; s.x = ax(x); s.y = ay(y); s.resize(390, 700);
  s.fills = [{ fillColor: C.background, fillOpacity: 1 }];
  s.borderRadius = 14;
  s.strokes = [{ strokeColor: C.border, strokeOpacity: 1, strokeWidth: 1, strokeAlignment: 'center' }];
  const k = tok('color.background'); if (k) s.applyToken(k, ['fill']);
  board.appendChild(s);
  return s;
}
function pen(s, ox, oy) {
  return {
    T: (c, o) => s.appendChild(txt(c, { ...o, x: ox + o.x, y: oy + o.y })),
    R: (o) => s.appendChild(rect({ ...o, x: ox + o.x, y: oy + o.y })),
  };
}
// The toolbar as shipped: a grouped pill, not four glyphs floating on the
// page. It is interactive, so it earns a surface.
function toolbar(P, x, y, opts = {}) {
  P.R({ x, y, w: 168, h: 48, radius: 12, fill: C.secondary, token: 'color.secondary', name: 'toolbar / container' });
  ['bullets', 'bold', 'dictate', 'attach'].forEach((n, i) => {
    const active = opts.hot === n;
    P.R({
      x: x + 8 + i * 40, y: y + 8, w: 32, h: 32, radius: 8,
      fill: active ? C.destructive : C.card,
      fillOpacity: active ? 0.15 : 1,
      token: active ? null : 'color.card',
      name: `toolbar / ${n} 32${active ? ' (active)' : ''}`,
    });
  });
}

board.appendChild(txt('Toolbar & attachments — group 07 resolved', { x: 60, y: 44, size: 26, weight: 700, color: C.foreground, w: 800, token: 'color.foreground' }));
board.appendChild(txt(
  'Four defects, three of them the app doing nothing at all: hitting the 12-file cap discarded the photo in silence, uploads hid behind one\n' +
  'spinner, dictation always appended to the END of the entry, and the renderer only understood what the toolbar emits — so anything TYPED\n' +
  'came back with its syntax still attached. A keyboard is not the toolbar.',
  { x: 60, y: 84, size: 12, color: C.mutedFg, w: 1080, token: 'color.muted-foreground' }));

// ── A · the write surface ─────────────────────────────────────────
const AX = 60, AY = 180;
{
  const a = sheet('sheet / the write surface · grid + pending', AX, AY);
  const P = pen(a, AX, AY);
  P.T('Sunday, August 9', { x: 16, y: 20, size: 22, weight: 700, color: C.foreground, w: 270, token: 'color.foreground' });
  P.T('Today · Saved', { x: 16, y: 56, size: 11, color: C.mutedFg, w: 180, token: 'color.muted-foreground' });
  P.R({ x: 0, y: 84, w: 390, h: 1, fill: C.border, token: 'color.border' });
  P.T('Push day — felt strong', { x: 16, y: 100, size: 17, weight: 700, color: C.foreground, w: 300, token: 'color.foreground' });
  toolbar(P, 16, 134);
  P.T('Bench 3x5 @ 185. Everything moved well.', { x: 16, y: 200, size: 13, color: C.foreground, w: 350, token: 'color.foreground' });

  // tileRow gap-2 3-up: (390 - 32 pad - 16 gaps) / 3 ≈ 114 square.
  P.T('ATTACHMENTS — tileRow(), 3-up', { x: 16, y: 250, size: 11, weight: 700, color: C.mutedFg, w: 300, token: 'color.muted-foreground' });
  [0, 1].forEach(i => P.R({ x: 16 + i * 122, y: 272, w: 114, h: 114, radius: 8, fill: C.card, token: 'color.card', name: `attachment / uploaded ${i + 1}` }));
  P.R({ x: 16 + 2 * 122, y: 272, w: 114, h: 114, radius: 8, fill: null, stroke: C.border, strokeStyle: 'dashed', name: 'attachment / PENDING (one per file in flight)' });
  P.T('One placeholder per file still uploading, in the grid itself. A spinner on the attach button could not say HOW MANY were coming, so picking four photos read as nothing happening.',
    { x: 16, y: 400, size: 11, color: C.mutedFg, w: 350, token: 'color.muted-foreground' });
  P.T('Tiles fill the column because the COUNT comes from data — CLAUDE.md\'s test for tileRow() over a fixed-80px flex-wrap. They get bigger on a phone into the bargain: 114 against 80.',
    { x: 16, y: 470, size: 11, color: C.mutedFg, w: 350, token: 'color.muted-foreground' });
}

// ── B · toolbar states ────────────────────────────────────────────
const BXo = 460, BYo = 180;
{
  const b = sheet('sheet / toolbar states', BXo, BYo);
  const P = pen(b, BXo, BYo);
  P.T('TOOLBAR — three states', { x: 16, y: 20, size: 11, weight: 700, color: C.mutedFg, w: 300, token: 'color.muted-foreground' });
  P.R({ x: 0, y: 44, w: 390, h: 1, fill: C.border, token: 'color.border' });

  P.T('1 · RESTING', { x: 16, y: 62, size: 11, weight: 700, color: C.foreground, w: 300, token: 'color.foreground' });
  toolbar(P, 16, 82);
  P.T('Grouped on a surface, not four glyphs belonging to nothing.', { x: 16, y: 136, size: 11, color: C.mutedFg, w: 350, token: 'color.muted-foreground' });

  P.T('2 · DICTATING — the only loud state on the screen', { x: 16, y: 176, size: 11, weight: 700, color: C.foreground, w: 350, token: 'color.foreground' });
  toolbar(P, 16, 196, { hot: 'dictate' });
  P.T('Listening…', { x: 196, y: 210, size: 12, weight: 700, color: C.destructive, w: 120 });
  P.T('Speech now lands at the CARET, and the caret walks forward between chunks so consecutive phrases stay in spoken order instead of laying down back to front.',
    { x: 16, y: 250, size: 11, color: C.mutedFg, w: 350, token: 'color.muted-foreground' });

  P.T('3 · UPLOADING', { x: 16, y: 320, size: 11, weight: 700, color: C.foreground, w: 300, token: 'color.foreground' });
  toolbar(P, 16, 340, { hot: 'attach' });
  P.T('The attach button spins, and the grid grows a placeholder per file — the button alone could not say how many.',
    { x: 16, y: 396, size: 11, color: C.mutedFg, w: 350, token: 'color.muted-foreground' });

  P.R({ x: 16, y: 460, w: 358, h: 1, fill: C.border, token: 'color.border' });
  P.T('The picker offers only what BOTH gates accept — ATTACHMENT_MIMES and the uploads bucket. It advertised .pdf and .txt that the uploader then refused, so the chooser took your file and a "couldn\'t upload" toast arrived a second later.',
    { x: 16, y: 476, size: 11, color: C.mutedFg, w: 350, token: 'color.muted-foreground' });
}

// ── C · what the renderer understands ─────────────────────────────
const CXo = 860, CYo = 180;
{
  const c = sheet('sheet / the markdown vocabulary', CXo, CYo);
  const P = pen(c, CXo, CYo);
  P.T('WHAT RENDERS', { x: 16, y: 20, size: 11, weight: 700, color: C.mutedFg, w: 300, token: 'color.muted-foreground' });
  P.R({ x: 0, y: 44, w: 390, h: 1, fill: C.border, token: 'color.border' });

  let y = 62;
  const pair = (typed, rendered, note, opts = {}) => {
    P.T(typed, { x: 16, y, size: 12, color: C.mutedFg, w: 350, token: 'color.muted-foreground', name: `typed / ${typed.slice(0, 16)}` });
    const r = P.T(rendered, { x: 16, y: y + 18, size: 14, weight: opts.boldWord ? 400 : 700, color: C.foreground, w: 350, token: 'color.foreground' });
    if (opts.boldWord) {
      const i = rendered.indexOf(opts.boldWord);
      if (i >= 0) { try { r.getRange(i, i + opts.boldWord.length).fontWeight = '700'; } catch (e) { /* range not ready */ } }
    }
    if (note) P.T(note, { x: 16, y: y + 40, size: 11, color: C.mutedFg, w: 350, token: 'color.muted-foreground' });
    y += note ? 74 : 54;
  };
  pair('# Deload week', 'Deload week', 'One weight for every level — the title field above already owns the ramp.');
  pair('- Bench 3x5', '•  Bench 3x5');
  pair('1. Squats', '1.  Squats', 'Numbers become list markers, not text.');
  // Drawn with the WHOLE line bold at first, which is the one thing this row
  // exists to disprove: `**PR**` bolds the word INSIDE normal text. A spec
  // sheet about inline emphasis has to show inline emphasis.
  pair('Hit a **PR** today', 'Hit a PR today', 'Bold is what the toolbar emits.', { boldWord: 'PR' });

  P.R({ x: 16, y: y + 6, w: 358, h: 1, fill: C.border, token: 'color.border' });
  P.T('WHAT MUST NOT — the two false positives that matter in a lifting journal', { x: 16, y: y + 22, size: 11, weight: 700, color: C.mutedFg, w: 350, token: 'color.muted-foreground' });
  P.T('#3 was the hard set   →   stays literal (a hash needs a space)\n185 lb felt light         →   stays a sentence, not a list',
    { x: 16, y: y + 46, size: 12, color: C.foreground, w: 350, token: 'color.foreground' });
  P.T('Italics are deliberately absent: *one* and **two** cannot both be parsed by a splitter this small without one eating the other.',
    { x: 16, y: y + 96, size: 11, color: C.mutedFg, w: 350, token: 'color.muted-foreground' });
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
    ['The cap speaks', '"You can attach up to 12 files a day." And for a partial batch, "2 not attached — that would pass the 12-file limit." Both replace doing nothing.'],
    ['One number, two places', 'MAX_ATTACHMENTS mirrors the slice in upsertEntry. If they drift the UI accepts files the save then throws away without saying so.'],
    ['Pending chips live in the grid', 'Not on the button. The grid is where the count is legible.'],
    ['Dictation inserts at the caret', 'And the caret walks forward. Extracted to journalDictation.js because startDictation is an ES module binding a test cannot stub — which immediately caught a bug: spacing only the LEADING edge is invisible while you append and renders "felt sharpMain work" the moment you insert.'],
    ['The renderer covers a keyboard', 'Headings and ordered lists, because those are what people type. Not italics.'],
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
