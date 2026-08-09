// docs/penpot-achievements-board.js
//
// Builds the "Achievements — slots to draw" board in Penpot, in the same
// idiom as the existing "Badge system", "Toast & celebration" and
// "League seasons" boards: empty dashed slots, each holding the ANCHOR
// at its true app size, with surfaces and text bound to the Light/Dark
// mode tokens so one board draws both passes.
//
// HOW TO RUN
//   Paste the whole file into the Penpot MCP `execute_code` tool. It is
//   self-contained and idempotent — it removes any previous board of the
//   same name first, so re-running it is safe.
//
// The first two groups (ladder card, medallion) were already built in
// the session of 2026-08-09 before the plugin bridge dropped; this
// script rebuilds the board from scratch including those, so it does not
// depend on what is currently on the canvas.

const PAGE_NAME = 'Page 2';
const BOARD_NAME = 'Achievements — slots to draw';
const BX = 7200, BY = 0, BW = 1320, PAD = 60;

// ── SELECT PAGE 2 IN THE PENPOT UI BEFORE RUNNING THIS ────────────
//
// createBoard/createText target penpot.currentPage, NOT the page you
// read with getPageByName. This bit me for real on 2026-08-09: the
// first build read Page 2 but the tab was showing another page, so a
// 22-child board landed there at Page 2's x-coordinate — thousands of
// px from anything on it, and invisible to a findShape scoped to Page
// 2. There is no cross-page move in the API; the only fix is a rebuild.
//
// penpot.openPage() is ASYNC, so asserting currentPage on the very next
// line is a race that sometimes passes and sometimes throws. Don't
// assert-and-throw: bail out with a message and let the operator switch
// pages, which is both reliable and obvious.
//
// Two further constraints learned the same day:
//   • remove() raises "Cannot modify a page that is not currently
//     active" — you cannot clean up a stray board on another page
//     without opening that page first.
//   • The bridge drops on long call sequences. If it dies mid-build,
//     re-run: this is idempotent on the active page.
const page = penpotUtils.getPageByName(PAGE_NAME);
if (!page) throw new Error(`page "${PAGE_NAME}" not found`);
if (penpot.currentPage.id !== page.id) {
  return {
    aborted: true,
    reason: `Select "${PAGE_NAME}" in the Penpot UI first, then re-run.`,
    currentPage: penpot.currentPage.name,
  };
}

const existing = penpotUtils.findShape(s => s.name === BOARD_NAME, page.root);
if (existing) existing.remove();

const tok = (n) => penpotUtils.findTokenByName(n);
const darkSet = penpot.library.local.tokens.sets.find(s => s.name === 'theme.dark');
const readColor = (n) => {
  const t = (darkSet && darkSet.tokens.find(x => x.name === n)) || tok(n);
  return t ? t.resolvedValue : '#888888';
};
const C = {
  background: readColor('color.background'), foreground: readColor('color.foreground'),
  card: readColor('color.card'), border: readColor('color.border'),
  secondary: readColor('color.secondary'), muted: readColor('color.muted'),
  mutedFg: readColor('color.muted-foreground'), primary: readColor('color.primary'),
  success: readColor('color.success'), info: readColor('color.info'),
};

const ax = (dx) => BX + dx, ay = (dy) => BY + dy;

function text(chars, { x, y, size = 12, color = C.mutedFg, w = 300, bold = false, token = null }) {
  const t = penpot.createText(chars);
  t.x = x; t.y = y;
  t.growType = 'auto-height';
  t.fontSize = String(size);
  t.fontFamily = 'Work Sans';
  if (bold) t.fontWeight = '700';
  t.fills = [{ fillColor: color, fillOpacity: 1 }];
  t.resize(w, t.height);
  t.growType = 'auto-height';
  if (token) { const k = tok(token); if (k) t.applyToken(k, ['fill']); }
  return t;
}
function slot(name, { x, y, w, h }) {
  const b = penpot.createBoard();
  b.name = name; b.x = x; b.y = y; b.resize(w, h);
  b.fills = []; b.borderRadius = 10;
  b.strokes = [{ strokeColor: C.border, strokeOpacity: 1, strokeStyle: 'dashed', strokeWidth: 1, strokeAlignment: 'center' }];
  const k = tok('color.border'); if (k) b.applyToken(k, ['strokeColor']);
  return b;
}
function anchor(name, { x, y, w, h, color = C.secondary, radius = 8, token = 'color.secondary' }) {
  const r = penpot.createRectangle();
  r.name = name; r.x = x; r.y = y; r.resize(w, h); r.borderRadius = radius;
  r.fills = [{ fillColor: color, fillOpacity: 1 }];
  const k = tok(token); if (k) r.applyToken(k, ['fill']);
  return r;
}
function circle(name, { x, y, d, color = C.secondary, token = 'color.secondary' }) {
  const e = penpot.createEllipse();
  e.name = name; e.x = x; e.y = y; e.resize(d, d);
  e.fills = [{ fillColor: color, fillOpacity: 1 }];
  const k = tok(token); if (k) e.applyToken(k, ['fill']);
  return e;
}

const board = penpot.createBoard();
board.name = BOARD_NAME;
board.x = BX; board.y = BY; board.resize(BW, 4200);
board.fills = [{ fillColor: C.background, fillOpacity: 1 }];
board.borderRadius = 16;
{ const k = tok('color.background'); if (k) board.applyToken(k, ['fill']); }

let y = 44;
board.appendChild(text('Achievements — states to draw', { x: ax(PAD), y: ay(y), size: 26, color: C.foreground, w: 800, bold: true, token: 'color.foreground' }));
y += 40;
board.appendChild(text(
  'Empty slots. Each cell holds the ANCHOR at its true app size — draw the badge / card onto it.\n' +
  'Surfaces + text are bound to tokens: flip the Mode theme (Light / Dark) to draw the other pass.\n' +
  'Full-screen overlay at 390pt, opened from ProfileMenu › Achievements. Reads user_trophies (migs 167 + 323).\n' +
  '73 named rungs across 22 ladders, and ladders continue past their last named rung forever.',
  { x: ax(PAD), y: ay(y), size: 12, color: C.mutedFg, w: 950, token: 'color.muted-foreground' }));
y += 90;

function group(label) {
  board.appendChild(text(label, { x: ax(PAD), y: ay(y), size: 12, color: C.foreground, w: 1200, bold: true, token: 'color.foreground' }));
  y += 30;
}
function grid(items, { w, h, cols, gap = 15, rowGap = 34, build }) {
  items.forEach((it, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const sx = PAD + col * (w + gap), sy = y + row * (h + rowGap);
    const s = slot(it.name, { x: ax(sx), y: ay(sy), w, h });
    board.appendChild(s);
    build(s, it, sx, sy);
    if (it.label) s.appendChild(text(it.label, { x: ax(sx + 16), y: ay(sy + h - 62), size: 11, color: C.foreground, w: w - 32, token: 'color.foreground' }));
    if (it.note) s.appendChild(text(it.note, { x: ax(sx + 16), y: ay(sy + h - 44), size: 10, color: C.mutedFg, w: w - 32, token: 'color.muted-foreground' }));
  });
  y += Math.ceil(items.length / cols) * (h + rowGap) + 20;
}

// ── 01 · LADDER CARD ──────────────────────────────────────────────
group('01 · LADDER CARD — the core unit. 358 wide (390 page − 16 inset each side). One card per LADDER, showing the rung in play.');
grid([
  { name: 'slot / ladder-card / in progress',   label: 'Sessions · 47 / 50 → Committed', note: 'The default. Bar + next rung named.' },
  { name: 'slot / ladder-card / just cleared',  label: 'Committed cleared → Centurion',  note: 'The moment that matters: rung falls, next\ntakes its place in the SAME card.' },
  { name: 'slot / ladder-card / into the tail', label: 'Centurion III · 300 workouts',   note: 'Past the last named rung. Generated id\n(sessions_x2). Needs an ∞ treatment.' },
  { name: 'slot / ladder-card / binary rung',   label: 'Gauntlet Cleared — yes / no',    note: 'No bar: not a count. Must NOT render\n"5 / 999" here.' },
  { name: 'slot / ladder-card / ladder locked', label: 'Crew wars — not in a crew yet',  note: 'Feature not entered. Reads as "available\nlater", not "failed".' },
  { name: 'slot / ladder-card / dead end',      label: 'Distance PB · marathon is the top', note: 'Deliberately terminal. Must not look\nbroken or unfinished.' },
], { w: 390, h: 196, cols: 3, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / ladder card 358', { x: ax(sx + 16), y: ay(sy + 18), w: 358, h: 96, color: C.card, radius: 12, token: 'color.card' }));
}});

// ── 02 · MEDALLION ────────────────────────────────────────────────
group('02 · MEDALLION — the badge itself. Draw ONE and it has to survive all four sizes; the 20 is the one that breaks.');
grid([
  { name: 'slot / medallion / 72 celebration', d: 72, label: '72 · celebration',  note: 'Unlock moment, centre screen.' },
  { name: 'slot / medallion / 44 vault grid',  d: 44, label: '44 · vault grid',   note: 'The Achievements page grid.' },
  { name: 'slot / medallion / 28 profile rail',d: 28, label: '28 · profile rail', note: 'ProfileBadgeShowcase, 6 across.' },
  { name: 'slot / medallion / 20 inline',      d: 20, label: '20 · inline',       note: 'Next to a name in a list row.' },
], { w: 210, h: 150, cols: 4, build: (s, it, sx, sy) => {
  s.appendChild(circle(`anchor / ${it.d}pt medallion`, { x: ax(sx + (210 - it.d) / 2), y: ay(sy + 26), d: it.d }));
}});

board.appendChild(text('TIER RAMP — five steps. Tier is the only thing separating a 10-workout badge from a 100-workout one, so it has to read at 28pt. These five hexes are TROPHY_TIERS in trophyDefinitions.js, NOT theme tokens — they must not flip with the mode.',
  { x: ax(PAD), y: ay(y), size: 11, color: C.mutedFg, w: 1200, token: 'color.muted-foreground' }));
y += 34;
grid([
  { name: 'slot / tier / bronze',    hex: '#CD7F32', label: 'Bronze',    note: '#CD7F32' },
  { name: 'slot / tier / silver',    hex: '#C0C0C0', label: 'Silver',    note: '#C0C0C0' },
  { name: 'slot / tier / gold',      hex: '#FFD700', label: 'Gold',      note: '#FFD700' },
  { name: 'slot / tier / platinum',  hex: '#7BE0E0', label: 'Platinum',  note: '#7BE0E0' },
  { name: 'slot / tier / legendary', hex: '#A855F7', label: 'Legendary', note: '#A855F7' },
  { name: 'slot / tier / tail',      hex: null,      label: '∞ Tail',    note: 'legendary ramp + ∞ mark' },
  { name: 'slot / tier / locked',    hex: null,      label: 'Locked',    note: 'never earned — keeps its art' },
], { w: 165, h: 132, cols: 7, gap: 8, build: (s, it, sx, sy) => {
  s.appendChild(circle('anchor / 44pt medallion', { x: ax(sx + (165 - 44) / 2), y: ay(sy + 20), d: 44 }));
  if (it.hex) {
    const chip = penpot.createRectangle();
    chip.name = `swatch / ${it.label} ${it.hex}`;
    chip.x = ax(sx + (165 - 44) / 2); chip.y = ay(sy + 68); chip.resize(44, 3);
    chip.fills = [{ fillColor: it.hex, fillOpacity: 1 }];
    s.appendChild(chip);
  }
}});

// ── 03 · NEXT UP ──────────────────────────────────────────────────
group('03 · NEXT UP — the rail that leads the page. Three closest rungs across ALL ladders. This is the answer to "what do I do now" and it is never empty.');
grid([
  { name: 'slot / next-up / rail of three', label: 'The default state', note: 'Ranked by % complete. Tapping one should\njump to its ladder.' },
  { name: 'slot / next-up / day one',       label: 'Brand-new account, everything at 0', note: 'Still has to offer three. Which three is a\nproduct call — draw your pick.' },
  { name: 'slot / next-up / one tap away',  label: 'A rung at 90%+', note: 'Worth a louder treatment — this is the\nhook. Same card or a variant?' },
], { w: 390, h: 210, cols: 3, build: (s, it, sx, sy) => {
  for (let i = 0; i < 3; i++) {
    s.appendChild(anchor(`anchor / next-up row ${i + 1} (358×56)`, { x: ax(sx + 16), y: ay(sy + 18 + i * 62), w: 358, h: 56, color: C.card, radius: 12, token: 'color.card' }));
  }
}});

// ── 04 · COLLECTION HEADER ────────────────────────────────────────
group('04 · COLLECTION HEADER — the counter problem. Named rungs are 73; tails and league season trophies are UNBOUNDED and sit outside the denominator.');
grid([
  { name: 'slot / header / counter + bar', label: '"12 / 73  +3"', note: 'The +3 is tails & season trophies. Is a\nsuffix right, or do they need their own line?' },
  { name: 'slot / header / at zero',       label: '"0 / 73" on day one', note: 'Must not read as failure. This is the exact\nstate the old page shipped and got wrong.' },
  { name: 'slot / header / deep account',  label: '"58 / 73  +21"', note: 'Someone well past the named catalog.\nThe ∞ part should feel like the reward.' },
], { w: 390, h: 150, cols: 3, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / header block (358×52)', { x: ax(sx + 16), y: ay(sy + 20), w: 358, h: 52, color: C.card, radius: 12, token: 'color.card' }));
}});

// ── 05 · CATEGORY SECTION ─────────────────────────────────────────
group('05 · CATEGORY SECTION — 8 groups: Iron · Consistency · Endurance · Progression · Arena · Crew · Community · Collection. Each holds 2–3 ladders.');
grid([
  { name: 'slot / category / header + 3 ladders', label: 'Iron — Sessions, Tonnage, Variety', note: 'Group heading + the ladder rows under it.\nHow much weight does the heading carry?' },
  { name: 'slot / category / all 8 collapsed',    label: 'The whole page at a glance', note: '22 ladders is a long scroll. Should groups\ncollapse? Draw the answer.' },
], { w: 590, h: 300, cols: 2, gap: 20, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / section heading', { x: ax(sx + 16), y: ay(sy + 18), w: 200, h: 20, color: C.muted, radius: 4, token: 'color.muted' }));
  for (let i = 0; i < 3; i++) {
    s.appendChild(anchor(`anchor / ladder row ${i + 1} (358×64)`, { x: ax(sx + 16), y: ay(sy + 48 + i * 70), w: 358, h: 64, color: C.card, radius: 12, token: 'color.card' }));
  }
}});

// ── 06 · UNLOCK MOMENT ────────────────────────────────────────────
group('06 · UNLOCK MOMENT — including the batch case. Migration 323 grants RETROACTIVELY, so the first open hands an established user 10–20 at once.');
grid([
  { name: 'slot / unlock / single',      label: 'One badge earned', note: 'Toast: emoji + name + criteria.' },
  { name: 'slot / unlock / batch',       label: '"17 trophies earned"', note: 'Collapsed summary + View action. Names the\nhighest tier one. Do NOT stack 17 toasts.' },
  { name: 'slot / unlock / tail rung',   label: 'Centurion IV', note: 'An ∞ rung landing. Should it feel different\nfrom a named one?' },
  { name: 'slot / unlock / full screen', label: 'Is a toast even enough?', note: 'A legendary rung may deserve the 72pt\ncelebration treatment instead.' },
], { w: 290, h: 200, cols: 4, gap: 12, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / toast (358 scaled to 258)', { x: ax(sx + 16), y: ay(sy + 20), w: 258, h: 64, color: C.card, radius: 12, token: 'color.card' }));
  s.appendChild(circle('anchor / 72pt medallion', { x: ax(sx + 16 + 93), y: ay(sy + 98), d: 72 }));
}});

// ── 07 · SURFACE TEST ─────────────────────────────────────────────
group('07 · SURFACE TEST — a medallion has to read on BOTH surfaces, in BOTH modes. Flip the Mode theme and check the same four cells.');
grid([
  { name: 'slot / surface / on card',       label: 'on color.card', note: 'Inside a ladder row.' },
  { name: 'slot / surface / on background', label: 'on color.background', note: 'The page itself.' },
  { name: 'slot / surface / on secondary',  label: 'on color.secondary', note: 'Inside a Next-up row.' },
  { name: 'slot / surface / locked on card',label: 'locked, on color.card', note: 'The greyed state still has to be legible,\nnot a smudge.' },
], { w: 290, h: 150, cols: 4, gap: 12, build: (s, it, sx, sy) => {
  if (it.name.includes('on card') || it.name.includes('locked')) {
    s.appendChild(anchor('surface / card', { x: ax(sx + 16), y: ay(sy + 16), w: 258, h: 76, color: C.card, radius: 12, token: 'color.card' }));
  }
  if (it.name.includes('secondary')) {
    s.appendChild(anchor('surface / secondary', { x: ax(sx + 16), y: ay(sy + 16), w: 258, h: 76, color: C.secondary, radius: 12, token: 'color.secondary' }));
  }
  s.appendChild(circle('anchor / 44pt medallion', { x: ax(sx + 16 + 107), y: ay(sy + 32), d: 44 }));
}});

// ── 08 · EMPTY STATES ─────────────────────────────────────────────
group('08 · EMPTY STATES — the two that used to be the whole experience.');
grid([
  { name: 'slot / empty / nothing earned', label: 'Earned tab, zero rows', note: 'Every user is here today. Should point at\nNext up rather than apologise.' },
  { name: 'slot / empty / ladder untouched', label: 'A ladder at 0 of its first rung', note: 'e.g. Bounties for someone who has never\nopened the Arena.' },
], { w: 390, h: 180, cols: 3, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / empty block (358×96)', { x: ax(sx + 16), y: ay(sy + 18), w: 358, h: 96, color: C.muted, radius: 12, token: 'color.muted' }));
}});

// Trim the board to the content.
board.resize(BW, y + 40);

return {
  board: board.name,
  height: Math.round(board.height),
  slots: penpotUtils.findShapes(s => s.name && s.name.startsWith('slot / '), board).length,
};
