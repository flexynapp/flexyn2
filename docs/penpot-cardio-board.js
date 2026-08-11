/* eslint-disable */
//
// docs/penpot-cardio-board.js
//
// Builds the board `Cardio — proposed` on the Penpot page "Cardio".
// Proposes a new flow for the whole cardio environment — the landing
// screen at src/components/cardio/CardioSection.jsx and the nine views
// it routes to.
//
// WHY THIS IS A FILE AND NOT A TOOL CALL: the plugin bridge was down on
// 2026-08-11 — `high_level_overview` returned instantly while every
// `execute_code` call timed out, which isolates it to the SERVER→PLUGIN
// hop rather than the relay. Same failure, same day, as the Explore
// Regimens board. So this follows that file's pattern: self-contained
// and idempotent, pasted into `execute_code` in one go after a reconnect.
//
// It is SAFE TO RE-RUN. It deletes any board of the same name first, so a
// half-built board from a timed-out call is cleaned up rather than
// double-drawn. Do not try to resume it mid-board.
//
// IF IT TIMES OUT: set PARTS below to a subset and paste again. The five
// groups are independent. 'shell' both creates the board and WIPES any
// existing one, so it goes in the first slice and no other. MEASURED on
// 2026-08-11 against this Penpot instance — one group per call, because
// ['shell','01'] landed 123 shapes fine and '02' alone (≈120 shapes)
// still timed out:
//     ['shell','01']   ['02']   ['03']   ['04']   ['05']
// A slice without 'shell' appends to the board already on the page and
// bails with a message if there isn't one.
//
// A TIMEOUT IS NOT A ROLLBACK. The call keeps running server-side, so a
// timed-out group may have landed in full, in part, or not at all. Check
// before re-running:
//     const B = penpotUtils.findShape(s => s.name === 'Cardio — proposed'
//               && s.type === 'board', penpot.currentPage.root);
//     return B.children.map(c => c.name).filter(n => /^02/.test(n)).length;
// If a group is partial, re-run the WHOLE script with 'shell' rather than
// re-running that group — a second pass over a partial group double-draws
// every shape it already made, and the duplicates sit exactly on top of
// the originals where nothing looks wrong.
//
// BEFORE PASTING: create/open the page "Cardio" in the Penpot UI. The
// script bails rather than switching pages itself — `openPage()` is async
// and asserting `currentPage` on the next line is a race that has cost a
// 22-child board before.
//
// ── Idiom: SLOTS, not resolved ───────────────────────────────────────
// This board is a PROPOSAL. Group 01 is the current flow drawn from its
// own Tailwind classes; 02 is the proposal; 03 specs the two new
// controls; 04 draws the states the proposal has to survive; 05 is the
// ledger of what is verified and what is still Kegan's call. Per the
// standing rule, the design that ships is his — this is the argument,
// not the answer.
//
// ── Provenance of every number on this board ─────────────────────────
// QUERIED against production 2026-08-11:
//     cardio_logs                5 rows
//       distance/duration_s/calories/pace/speed   5 of 5
//       avg_heart_rate  1 · vo2max_estimate  2 · elevation  2 · incline 1
//       gps_track       1 of 5 (the one live session, 60 points)
//       duration_min · cadence_spm · power_watts · pool_length_m ·
//       laps · stroke_type · route_name · notes    0 of 5, every one
//       calories = 0 on 2 of the 5 rows that "have" calories
//     cardio_templates           0 rows
//     planned_cardio             0 rows
//     goals   goal_type='cardio'            0 rows
//             goal_type='cardio_distance'   2 rows  ("Run a 5K" ×2)
//             goal_type='strength'          3 rows
//   The five real sessions, oldest first:
//     2026-05-13  running_outside   manual  11.27 km  2:38:00
//     2026-05-13  walking_outside   manual  16.09 km  5:00:00  1050 cal
//     2026-07-15  running_outside   manual   8.05 km  0:44:20   528 cal  155 bpm
//     2026-08-07  walking_outside   LIVE     0.72 km  0:04:17    39 cal  60 GPS pts
//     2026-08-09  running_treadmill manual   3.22 km  0:15:00     0 cal
// READ FROM SOURCE: every padding, radius, font size, colour role, tile
// label and route in group 01, from CardioSection.jsx and the nine
// components it imports.
// DERIVED, and marked as such on the board: the 5-tap depth in group 01.
// Counted from the Workout tab as rendered taps — Cardio card, activity,
// environment, input type, Start — not measured in a browser.
//
// ── One number on this board is an ESTIMATE ──────────────────────────
// "2 taps" for the proposal assumes the Start control opens pre-set from
// the user's last session, which is a design claim, not a measurement.
// It is 3 taps whenever the activity has to change. Both are on the board.
//
// ── RE-STACKING THE LEDGER (if a row collides with the next) ──────────
// Group 05's rows are stacked on an ESTIMATED height, because a freshly
// created auto-height text does not report a real `.height` for ~500 ms
// and this script runs in one call. If anything overlaps, run this in a
// SECOND call to re-stack off the real measured heights:
/*
const b = penpotUtils.findShape(s => s.name === 'Cardio — proposed' && s.type === 'board', penpot.currentPage.root);
const rows = {};
for (const c of b.children) {
  const m = /^led (t|w|e) \/ (.+)$/.exec(c.name);
  if (m) (rows[m[2]] ||= []).push(c);
}
const order = Object.values(rows).sort((a, p) => Math.min(...a.map(s => s.y)) - Math.min(...p.map(s => s.y)));
let cursor = null, moved = 0;
for (const group of order) {
  const top = Math.min(...group.map(s => s.y));
  const bottom = Math.max(...group.map(s => s.y + s.height));
  if (cursor !== null) {
    const delta = (cursor + 20) - top;
    if (Math.abs(delta) > 1) { group.forEach(s => { s.y += delta; }); moved++; }
  }
  cursor = (cursor === null ? bottom : bottom + ((cursor + 20) - top));
}
return { moved };
*/
// ─────────────────────────────────────────────────────────────────────

const BOARD_NAME = 'Cardio — proposed';
const ALLOWED_PAGES = ['Cardio'];

// Which groups to draw. Trim this if the call times out — see the header.
const PARTS = ['shell', '01', '02', '03', '04', '05'];

// ── Guard rails ───────────────────────────────────────────────────────
const page = penpot.currentPage;
if (!page) return 'No current page.';
if (ALLOWED_PAGES.indexOf(page.name) === -1) {
  return `Current page is "${page.name}". Create/open a page called "Cardio" in the Penpot UI and re-run — this script will not switch pages for you.`;
}

let B = penpotUtils.findShape(s => s.name === BOARD_NAME && s.type === 'board', page.root);
if (PARTS.indexOf('shell') !== -1) {
  if (B) B.remove();
  B = null;
}
if (!B && PARTS.indexOf('shell') === -1) return 'No board to append to — run with "shell" in PARTS first.';

// ── Palette ───────────────────────────────────────────────────────────
// hsl() from `.dark` in src/index.css, converted. Used only where the
// matching Penpot token is absent, so a missing token shows up in the
// return value rather than being silently wrong.
const P = {
  bg:     '#13171B',   // --background       210 18%  9%
  card:   '#191F24',   // --card             210 18% 12%
  card2:  '#1F262D',   // --muted            210 18% 15%
  sec:    '#262E36',   // --secondary        210 18% 18%
  border: '#2A333B',   // --border           210 18% 20%
  fg:     '#F5F2F0',   // --foreground        30 20% 95%
  mut:    '#89949F',   // --muted-foreground 210 10% 58%
  pri:    '#F37616',   // --primary           26 90% 52%
  ok:     '#41C88A',   // --success          152 52% 52%
  bad:    '#E5484D',   // --destructive
  warn:   '#E8A33D',
  cyan:   '#2BB6C4',
  paper:  '#0E1216',   // board ground, one step under --background
};

const FH = penpot.fonts.findByName('Archivo');   // --font-heading
const FB = penpot.fonts.findByName('Figtree');   // --font-body
if (!FH || !FB) return 'Archivo / Figtree not available in this Penpot instance.';

// ── Primitives ────────────────────────────────────────────────────────
const rect = (parent, name, x, y, w, h, o) => {
  o = o || {};
  const r = penpot.createRectangle();
  r.name = name; r.resize(w, h); r.x = x; r.y = y;
  r.fills = (o.fill === null) ? [] : [{ fillColor: o.fill || P.card, fillOpacity: (o.op === undefined ? 1 : o.op) }];
  if (o.stroke) r.strokes = [{ strokeColor: o.stroke, strokeWidth: o.sw || 1, strokeAlignment: 'inner', strokeOpacity: (o.so === undefined ? 1 : o.so), strokeStyle: o.dash ? 'dashed' : 'solid' }];
  if (o.r !== undefined) r.borderRadius = o.r;
  parent.appendChild(r);
  return r;
};

// NOTE: letterSpacing must be >= 0. Penpot rejects a negative value with
// `Value not valid: -0.6. Code: :letterSpacing` — it does not clamp.
const txt = (parent, name, chars, x, y, o) => {
  o = o || {};
  const t = penpot.createText(String(chars));
  t.name = name;
  const font = o.head ? FH : FB;
  const wt = String(o.w || 400);
  const variant = font.variants.find(v => v.fontWeight === wt) || font.variants[0];
  font.applyToText(t, variant);
  t.fontSize = String(o.size || 12);
  t.fills = [{ fillColor: o.color || P.fg, fillOpacity: (o.op === undefined ? 1 : o.op) }];
  if (o.lh) t.lineHeight = String(o.lh);
  if (o.ls) t.letterSpacing = String(o.ls);
  if (o.tt) t.textTransform = o.tt;
  // resize() forces growType 'fixed', so it is set back afterwards.
  if (o.width) { t.resize(o.width, o.height || 18); t.growType = o.fixed ? 'fixed' : 'auto-height'; }
  else { t.growType = 'auto-width'; }
  if (o.align) t.align = o.align;
  t.x = x; t.y = y;
  parent.appendChild(t);
  return t;
};

// Rounded chip with a centred label. Returns the width consumed, so chip
// rows are laid out by accumulating rather than by guessing a pitch.
// `o.key` disambiguates the SHAPE NAME only — the label is what renders.
// Keep the two separate: the same word appears as a filter chip and as a
// tile label on this board, and a shared name means a later findShape()
// edit silently hits the wrong one.
const pill = (parent, label, x, y, o) => {
  o = o || {};
  const px = o.px === undefined ? 10 : o.px;
  const size = o.size || 11;
  const w = o.w || Math.round(label.length * size * 0.56) + px * 2;
  const h = o.h || 24;
  const key = o.key ? o.key + ' / ' + label : label;
  rect(parent, 'chip / ' + key, x, y, w, h, { fill: o.fill || P.card, r: (o.r === undefined ? h / 2 : o.r), stroke: o.stroke, so: o.so });
  txt(parent, 'chip label / ' + key, label, x, y + (h - size * 1.35) / 2, {
    size, w: o.fw || 600, color: o.color || P.mut, width: w, align: 'center', tt: o.tt, ls: o.ls, head: o.head,
  });
  return w;
};

// A phone frame at 390 pt — the width every screen on this board is drawn
// at, matching the fluid-scale section of CLAUDE.md.
const phone = (name, x, y, h) => rect(B, 'phone / ' + name, x, y, 390, h, { fill: P.bg, r: 18, stroke: P.border });

// A full-width nav tile as CardioSection draws it today: p-5, dashed
// border, 40 pt icon square at rounded-xl, title over description.
const navTile = (x, y, o) => {
  const h = o.h || 76;
  rect(B, 'tile / ' + o.key, x, y, 358, h, { fill: null, r: 12, stroke: o.solid ? P.border : P.border, dash: !o.solid, so: 0.9 });
  rect(B, 'tile icon / ' + o.key, x + 16, y + (h - 40) / 2, 40, 40, { fill: o.tint || P.pri, op: 0.10, r: 10 });
  txt(B, 'tile glyph / ' + o.key, o.glyph, x + 16, y + (h - 40) / 2 + 10, { size: 17, width: 40, align: 'center', color: o.tint || P.pri });
  txt(B, 'tile title / ' + o.key, o.title, x + 68, y + (o.desc ? 18 : 28), { size: 13.5, w: 700, head: true, color: P.fg });
  if (o.desc) txt(B, 'tile desc / ' + o.key, o.desc, x + 68, y + 38, { size: 11, color: P.mut, width: 270 });
  return h;
};

// ── Shell ─────────────────────────────────────────────────────────────
if (!B) {
  B = penpot.createBoard();
  B.name = BOARD_NAME;
  // 5500 tall, not 4700: group 05's ten defect rows land at ~4930 and the
  // "deliberately unchanged" block runs to ~5280 under them.
  B.resize(2500, 5500);
  // Placed to the RIGHT of whatever is already on the page, so this is
  // safe to run on a page that is not empty.
  //
  // Compare by `.id`, NOT by object identity: the plugin API hands back a
  // fresh proxy on each property access, so `sh !== B` is true even for
  // the board itself. It would measure its own width and park itself
  // beyond its own right edge, pushing further right on every re-run.
  let rightEdge = 340;
  for (const sh of page.root.children) if (sh.id !== B.id) rightEdge = Math.max(rightEdge, sh.x + sh.width + 80);
  B.x = rightEdge; B.y = 0;
  B.fills = [{ fillColor: P.paper, fillOpacity: 1 }];

  txt(B, 'board title', 'Cardio', B.x + 40, 46, { size: 34, w: 800, head: true, color: P.fg });
  txt(B, 'board subtitle', 'A proposed flow for the cardio environment  ·  src/components/cardio/  ·  10 views  ·  drawn at 390 pt  ·  data queried 2026-08-11', B.x + 40, 96, { size: 13, w: 400, color: P.mut });
  rect(B, 'title rule', B.x + 40, 126, 2000, 1, { fill: P.border });
}
const BX = B.x;
// Phones are inset 140, not 40: each carries a bracket in its left margin
// whose label sits at X − 92, and at an inset of 40 those fall off-board.
const X1 = BX + 140;
const X2 = BX + 620;
const X3 = BX + 1100;
const X4 = BX + 1580;
const Y1 = 196;

// ══════════════════════════════════════════════════════════════════════
// 01 · TODAY
// ══════════════════════════════════════════════════════════════════════
if (PARTS.indexOf('01') !== -1) {
  txt(B, '01 heading', '01  ·  Today', X1, Y1 - 34, { size: 15, w: 700, head: true, color: P.fg, ls: 0.4 });
  txt(B, '01 sub', 'The cardio landing screen as it renders on main today, and the funnel behind it.', X1 + 130, Y1 - 31, { size: 12, color: P.mut });

  // ── The landing screen ──────────────────────────────────────────────
  phone('today', X1, Y1, 1180);
  let y = Y1 + 14;

  // Chrome this screen INHERITS from the Workout page. CardioSection is
  // an inline branch of /workout, not its own surface, so everything the
  // workout start screen draws above the branch renders here too.
  rect(B, 'today / inherited band', X1 + 1, y - 6, 388, 232, { fill: P.bad, op: 0.05, r: 0 });
  txt(B, 'today / inherited label', 'INHERITED FROM /workout', X1 + 16, y - 2, { size: 8.5, w: 700, color: P.bad, ls: 1.2, tt: 'uppercase' });
  y += 14;

  txt(B, 'today / header title', 'Cardio', X1 + 16, y, { size: 26, w: 700, head: true, color: P.fg });
  txt(B, 'today / header sub', 'Track running, walking, and cycling', X1 + 16, y + 34, { size: 12.5, color: P.mut });
  y += 62;

  // The late-night banner — 00:00 to 05:00 only. It is in Kegan's
  // screenshot because he took it at 00:4x.
  rect(B, 'today / latenight', X1 + 16, y, 358, 58, { fill: P.pri, op: 0.08, r: 12, stroke: P.pri, so: 0.25 });
  txt(B, 'today / latenight t', '🌙 Late-night session', X1 + 28, y + 10, { size: 12, w: 700, color: P.pri });
  txt(B, 'today / latenight d', 'Log as today (2026-08-11) — toggle to roll back', X1 + 28, y + 30, { size: 10.5, color: P.mut, width: 240 });
  rect(B, 'today / latenight sw', X1 + 330, y + 20, 34, 18, { fill: P.sec, r: 9 });
  y += 70;

  // Injury banner + the Today chip row, both also the Workout page's.
  rect(B, 'today / injury', X1 + 16, y, 358, 34, { fill: P.card, r: 10, stroke: P.border });
  txt(B, 'today / injury t', 'Log an injury', X1 + 28, y + 10, { size: 11, color: P.mut });
  y += 44;

  pill(B, 'TODAY', X1 + 16, y, { key: 'today chip', h: 28, size: 9.5, fw: 700, ls: 1.2, tt: 'uppercase', fill: P.pri, color: '#FFFFFF', px: 12 });
  rect(B, 'today / customize', X1 + 350, y + 3, 22, 22, { fill: P.sec, op: 0.5, r: 11, stroke: P.border, so: 0.5 });
  txt(B, 'today / customize g', '▦', X1 + 350, y + 8, { size: 10, width: 22, align: 'center', color: P.mut });
  y += 44;

  // ── Cardio's own content starts here ────────────────────────────────
  rect(B, 'today / back', X1 + 16, y, 84, 32, { fill: null, r: 8, stroke: P.border });
  txt(B, 'today / back l', '←  Back', X1 + 16, y + 9, { size: 11.5, w: 500, width: 84, align: 'center', color: P.fg });
  y += 46;

  // Repeat last — only when a cardio_logs row exists. It is the single
  // best affordance on this screen and it is buried under the fold.
  rect(B, 'today / repeat', X1 + 16, y, 358, 66, { fill: P.pri, op: 0.05, r: 12, stroke: P.pri, so: 0.3 });
  rect(B, 'today / repeat icon', X1 + 32, y + 13, 40, 40, { fill: P.pri, op: 0.15, r: 10 });
  txt(B, 'today / repeat g', '↻', X1 + 32, y + 23, { size: 17, width: 40, align: 'center', color: P.pri });
  txt(B, 'today / repeat t', 'Repeat last', X1 + 84, y + 16, { size: 13.5, w: 700, head: true, color: P.fg });
  txt(B, 'today / repeat d', 'Treadmill run · 2.00 mi', X1 + 84, y + 37, { size: 11, color: P.mut });
  y += 78;

  // The 2×2. Three of these four carry the SAME description string —
  // t('cardio.subtitle'), "Track running, walking, and cycling" — which
  // is also the page subtitle 300 pt above. See ledger T3.
  const QUAD = [
    { key: 'run',  glyph: '🏃', title: 'Running',  desc: 'Track running, walking,\nand cycling', tint: P.pri },
    { key: 'walk', glyph: '🚶', title: 'Walking',  desc: 'Track running, walking,\nand cycling', tint: P.ok },
    { key: 'bike', glyph: '🚴', title: 'Biking',   desc: 'Track running, walking,\nand cycling', tint: P.warn },
    { key: 'swim', glyph: '🏊', title: 'Swimming', desc: 'Pool or open water',                   tint: P.cyan },
  ];
  QUAD.forEach((q, i) => {
    const qx = X1 + 16 + (i % 2) * 184;
    const qy = y + Math.floor(i / 2) * 132;
    rect(B, 'q / ' + q.key, qx, qy, 174, 122, { fill: null, r: 12, stroke: P.border, dash: true, so: 0.9 });
    rect(B, 'q icon / ' + q.key, qx + 14, qy + 14, 40, 40, { fill: q.tint, op: 0.10, r: 10 });
    txt(B, 'q glyph / ' + q.key, q.glyph, qx + 14, qy + 24, { size: 17, width: 40, align: 'center' });
    txt(B, 'q title / ' + q.key, q.title, qx + 14, qy + 60, { size: 13.5, w: 700, head: true, color: P.fg });
    txt(B, 'q desc / ' + q.key, q.desc, qx + 14, qy + 80, { size: 10.5, color: (i < 3 ? P.bad : P.mut), width: 148, lh: 1.3 });
  });
  // Mark the repeated string.
  rect(B, 'today / dup mark', X1 + 16, y, 358, 254, { fill: null, r: 12, stroke: P.bad, so: 0.45, dash: true });
  txt(B, 'today / dup note', '3 of 4 share one description', X1 + 16, y + 258, { size: 10, w: 600, color: P.bad });
  y += 280;

  // The five utility tiles.
  const UTIL = [
    { key: 'saved',   glyph: '▤', title: 'Saved Workouts',  desc: 'View your past cardio sessions',   rows: '5 rows' },
    { key: 'tpl',     glyph: '＋', title: 'Templates',        desc: 'Quick-start saved configurations', rows: '0 rows' },
    { key: 'planned', glyph: '▦', title: 'Planned Sessions', desc: 'Schedule upcoming workouts',       rows: '0 rows' },
    { key: 'goals',   glyph: '◎', title: 'Cardio Goals',     desc: 'Weekly & monthly distance targets', rows: 'reads the wrong goal_type' },
    { key: 'dev',     glyph: '⌚', title: 'Devices & Apps',   desc: 'Apple Watch, Garmin, Fitbit…',     rows: 'stub — every button toasts' },
  ];
  UTIL.forEach(u => {
    navTile(X1 + 16, y, u);
    const bad = u.rows !== '5 rows';
    txt(B, 'tile rows / ' + u.key, u.rows, X1 + 16, y + 30, { size: 10, w: 700, color: bad ? P.bad : P.ok, width: 342, align: 'right' });
    y += 84;
  });

  // ── The funnel ──────────────────────────────────────────────────────
  const FX = X2 + 40;
  txt(B, '01 funnel h', 'The funnel', FX, Y1 + 6, { size: 14, w: 700, head: true, color: P.fg });
  txt(B, '01 funnel s', 'Every screen between the Workout tab and a running clock.', FX, Y1 + 28, { size: 11.5, color: P.mut, width: 340 });

  const STEPS = [
    ['/workout', 'The Cardio card, one of nine in a reorderable grid', 'tap 1'],
    ['Cardio home', 'The screen at left. 4 activities + 5 utilities + Repeat last', 'tap 2'],
    ['“How are you running?”', 'Outside / Treadmill. Two full-width tiles on an empty screen', 'tap 3'],
    ['“How do you want to log it?”', 'Manual entry / Live tracking', 'tap 4'],
    ['Tracker — idle', 'A play glyph, the weather, and a Start button', 'tap 5'],
    ['Tracking', 'The clock is finally running', ''],
  ];
  let fy = Y1 + 62;
  STEPS.forEach((s, i) => {
    const last = i === STEPS.length - 1;
    rect(B, 'fn / ' + i, FX, fy, 400, 58, { fill: last ? P.ok : P.card, op: last ? 0.10 : 1, r: 10, stroke: last ? P.ok : P.border, so: last ? 0.4 : 1 });
    txt(B, 'fn t / ' + i, s[0], FX + 14, fy + 11, { size: 12.5, w: 700, head: true, color: last ? P.ok : P.fg });
    txt(B, 'fn d / ' + i, s[1], FX + 14, fy + 31, { size: 10.5, color: P.mut, width: 300 });
    if (s[2]) txt(B, 'fn n / ' + i, s[2], FX + 14, fy + 20, { size: 10, w: 700, color: P.pri, width: 372, align: 'right' });
    if (!last) txt(B, 'fn arrow / ' + i, '↓', FX + 14, fy + 60, { size: 12, color: P.mut, op: 0.6 });
    fy += 76;
  });

  rect(B, 'fn total', FX, fy + 8, 400, 84, { fill: P.bad, op: 0.07, r: 10, stroke: P.bad, so: 0.35 });
  txt(B, 'fn total t', '5 taps and 4 screens to start a run', FX + 16, fy + 22, { size: 14, w: 700, head: true, color: P.bad });
  txt(B, 'fn total d', 'Six from anywhere that is not already the Workout tab. Two of the four questions — environment, then manual-vs-live — are asked on their own full screen with two options each.', FX + 16, fy + 46, { size: 10.5, color: P.mut, width: 368, lh: 1.4 });
  txt(B, 'fn total prov', 'DERIVED: counted from the route in CardioSection.jsx, not measured in a browser.', FX, fy + 102, { size: 9.5, color: P.mut, op: 0.7, width: 400 });

  // What the funnel is really sorting.
  const MTX = fy + 140;
  txt(B, '01 mtx h', 'What those two screens actually ask', FX, MTX, { size: 13, w: 700, head: true, color: P.fg });
  txt(B, '01 mtx d', 'Environment is a property of the activity and is nearly always predictable from the last session. Manual-vs-live is not a property of the activity at all — it is “am I doing this now, or writing down something I already did?”, which is the FIRST question a user has and the LAST one this flow asks.', FX, MTX + 22, { size: 11, color: P.mut, width: 400, lh: 1.45 });

  const M = [
    ['Run',  'Outside · Treadmill'],
    ['Walk', 'Outside · Treadmill'],
    ['Bike', 'Outside · Stationary'],
    ['Swim', 'Pool · Open water   — no live tracker'],
  ];
  let my = MTX + 108;
  M.forEach((m, i) => {
    txt(B, 'mtx a / ' + i, m[0], FX, my, { size: 11.5, w: 700, color: P.fg });
    txt(B, 'mtx b / ' + i, m[1], FX + 60, my, { size: 11, color: P.mut });
    my += 22;
  });
}

// ══════════════════════════════════════════════════════════════════════
// 02 · PROPOSED
// ══════════════════════════════════════════════════════════════════════
if (PARTS.indexOf('02') !== -1) {
  const PY = 1560;
  txt(B, '02 heading', '02  ·  Proposed', X1, PY - 34, { size: 15, w: 700, head: true, color: P.fg, ls: 0.4 });
  txt(B, '02 sub', 'One screen to start. The funnel becomes a control, not a corridor.', X1 + 160, PY - 31, { size: 12, color: P.mut });

  // ── A · the new cardio home ─────────────────────────────────────────
  txt(B, '02a label', 'A  ·  Cardio', X1, PY - 12, { size: 11, w: 700, color: P.pri, ls: 0.6 });
  phone('proposed home', X1, PY, 820);
  let y = PY + 18;

  txt(B, 'p / title', 'Cardio', X1 + 16, y, { size: 26, w: 700, head: true, color: P.fg });
  y += 46;

  // The week strip. State, not a menu — this is what makes the screen a
  // home. Absent entirely when there is nothing behind it (see 04-A).
  rect(B, 'p / week', X1 + 16, y, 358, 92, { fill: P.card, r: 12, stroke: P.border });
  txt(B, 'p / week l', 'THIS WEEK', X1 + 30, y + 14, { size: 9, w: 700, color: P.mut, ls: 1.4, tt: 'uppercase' });
  txt(B, 'p / week v', '11.4', X1 + 30, y + 30, { size: 27, w: 800, head: true, color: P.fg });
  txt(B, 'p / week u', 'mi', X1 + 88, y + 44, { size: 12, w: 600, color: P.mut });
  txt(B, 'p / week g', 'of 15 mi goal', X1 + 112, y + 44, { size: 11, color: P.mut });
  // 7 day dots — filled where a session landed.
  const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const HIT = [1, 0, 1, 0, 0, 1, 0];
  DAYS.forEach((d, i) => {
    const dx = X1 + 30 + i * 34;
    rect(B, 'p / dot ' + i, dx, y + 66, 22, 12, { fill: HIT[i] ? P.pri : P.sec, r: 6, op: HIT[i] ? 1 : 0.7 });
    txt(B, 'p / day ' + i, d, dx, y + 82, { size: 8.5, w: 600, color: P.mut, width: 22, align: 'center' });
  });
  rect(B, 'p / week bar', X1 + 288, y + 66, 72, 6, { fill: P.sec, r: 3 });
  rect(B, 'p / week bar f', X1 + 288, y + 66, 55, 6, { fill: P.pri, r: 3 });
  y += 108;

  // The start control — the whole proposal in one component.
  txt(B, 'p / start l', 'START', X1 + 16, y, { size: 9, w: 700, color: P.mut, ls: 1.4, tt: 'uppercase' });
  y += 18;
  const ACT = [['🏃', 'Run'], ['🚶', 'Walk'], ['🚴', 'Ride'], ['🏊', 'Swim']];
  ACT.forEach((a, i) => {
    const ax = X1 + 16 + i * 90;
    const on = i === 0;
    rect(B, 'p / act ' + a[1], ax, y, 82, 62, { fill: on ? P.pri : P.card, op: on ? 0.14 : 1, r: 12, stroke: on ? P.pri : P.border, so: on ? 0.8 : 1, sw: on ? 1.5 : 1 });
    txt(B, 'p / act g ' + a[1], a[0], ax, y + 12, { size: 19, width: 82, align: 'center' });
    txt(B, 'p / act t ' + a[1], a[1], ax, y + 40, { size: 11.5, w: 700, head: true, width: 82, align: 'center', color: on ? P.pri : P.mut });
  });
  y += 74;

  // Environment inline, pre-set from the last session of this activity.
  rect(B, 'p / env', X1 + 16, y, 358, 40, { fill: P.card, r: 10, stroke: P.border });
  txt(B, 'p / env l', 'Outside', X1 + 30, y + 12, { size: 12, w: 600, color: P.fg });
  txt(B, 'p / env h', 'from your last run', X1 + 84, y + 13, { size: 10.5, color: P.mut });
  pill(B, 'Treadmill', X1 + 268, y + 8, { key: 'env', h: 24, size: 10, fw: 600, fill: P.sec, color: P.mut, r: 7, px: 10 });
  y += 52;

  // The one dominant element on the screen. CLAUDE.md allows exactly one.
  rect(B, 'p / go', X1 + 16, y, 358, 60, { fill: P.pri, r: 14 });
  txt(B, 'p / go l', 'Start run', X1 + 16, y + 20, { size: 17, w: 800, head: true, color: '#FFFFFF', width: 358, align: 'center' });
  y += 72;

  txt(B, 'p / manual', 'Log a session I already did  ›', X1 + 16, y, { size: 12, w: 600, color: P.mut, width: 358, align: 'center' });
  y += 34;

  rect(B, 'p / rule', X1 + 16, y, 358, 1, { fill: P.border });
  y += 20;

  // Three utilities, one row. Down from five stacked full-width tiles.
  const U3 = [['▤', 'History'], ['◎', 'Goals'], ['⌚', 'Devices']];
  U3.forEach((u, i) => {
    const ux = X1 + 16 + i * 122;
    rect(B, 'p / u ' + u[1], ux, y, 114, 66, { fill: P.card, r: 12, stroke: P.border });
    txt(B, 'p / u g ' + u[1], u[0], ux, y + 13, { size: 15, width: 114, align: 'center', color: P.mut });
    txt(B, 'p / u t ' + u[1], u[1], ux, y + 40, { size: 11.5, w: 600, width: 114, align: 'center', color: P.fg });
  });
  y += 82;

  txt(B, 'p / last l', 'RECENT', X1 + 16, y, { size: 9, w: 700, color: P.mut, ls: 1.4, tt: 'uppercase' });
  y += 18;
  // Real rows from production.
  const RECENT = [
    ['Treadmill run', '2.00 mi · 15:00 · 7:31 /mi', 'Aug 9'],
    ['Walk',          '0.45 mi · 4:17 · 9:33 /mi',  'Aug 7'],
  ];
  RECENT.forEach((r, i) => {
    rect(B, 'p / rec ' + i, X1 + 16, y, 358, 54, { fill: P.card, r: 10, stroke: P.border });
    txt(B, 'p / rec t ' + i, r[0], X1 + 30, y + 10, { size: 12.5, w: 600, color: P.fg });
    txt(B, 'p / rec d ' + i, r[1], X1 + 30, y + 30, { size: 10.5, color: P.mut });
    txt(B, 'p / rec x ' + i, r[2], X1 + 30, y + 20, { size: 10.5, color: P.mut, width: 330, align: 'right' });
    y += 62;
  });

  // ── B · the log-after form ──────────────────────────────────────────
  txt(B, '02b label', 'B  ·  Log a session I already did', X2, PY - 12, { size: 11, w: 700, color: P.pri, ls: 0.6 });
  phone('proposed manual', X2, PY, 820);
  let z = PY + 18;

  txt(B, 'm / back', '←', X2 + 16, z + 2, { size: 15, color: P.mut });
  txt(B, 'm / title', 'Log a run', X2 + 44, z, { size: 22, w: 700, head: true, color: P.fg });
  z += 46;

  // Activity + environment carried through, editable in place — not two
  // screens the user already answered.
  let bx = X2 + 16;
  bx += pill(B, '🏃  Run', bx, z, { key: 'm', h: 30, size: 11.5, fw: 600, fill: P.pri, color: '#FFFFFF', r: 9, px: 12 }) + 8;
  bx += pill(B, 'Outside', bx, z, { key: 'm', h: 30, size: 11.5, fw: 600, fill: P.sec, color: P.fg, r: 9, px: 12 }) + 8;
  pill(B, 'Today', bx, z, { key: 'm', h: 30, size: 11.5, fw: 600, fill: P.sec, color: P.fg, r: 9, px: 12 });
  z += 46;

  // The three fields production says people actually fill.
  const FIELDS = [
    ['Duration', '44:20', 'h : m : s'],
    ['Distance', '5.00', 'mi'],
  ];
  FIELDS.forEach((f, i) => {
    txt(B, 'm / fl ' + i, f[0], X2 + 16, z, { size: 11, w: 600, color: P.mut });
    rect(B, 'm / fi ' + i, X2 + 16, z + 18, 358, 52, { fill: P.card, r: 10, stroke: P.border });
    txt(B, 'm / fv ' + i, f[1], X2 + 30, z + 32, { size: 20, w: 700, head: true, color: P.fg });
    txt(B, 'm / fu ' + i, f[2], X2 + 30, z + 38, { size: 11, color: P.mut, width: 330, align: 'right' });
    z += 84;
  });

  // Derived, live, and never asked for.
  rect(B, 'm / derived', X2 + 16, z, 358, 62, { fill: P.pri, op: 0.06, r: 10, stroke: P.pri, so: 0.25 });
  txt(B, 'm / d1', '8:52 /mi', X2 + 30, z + 14, { size: 15, w: 700, head: true, color: P.pri });
  txt(B, 'm / d1l', 'pace', X2 + 30, z + 38, { size: 10, color: P.mut });
  txt(B, 'm / d2', '6.8 mph', X2 + 148, z + 14, { size: 15, w: 700, head: true, color: P.fg });
  txt(B, 'm / d2l', 'speed', X2 + 148, z + 38, { size: 10, color: P.mut });
  txt(B, 'm / d3', '≈ 528 cal', X2 + 258, z + 14, { size: 15, w: 700, head: true, color: P.fg });
  txt(B, 'm / d3l', 'estimated · tap to edit', X2 + 258, z + 38, { size: 10, color: P.mut });
  z += 78;

  txt(B, 'm / est note', 'Calories estimate on blur instead of behind a Calculator button. 2 of the 5 real logs carry calories = 0 — nobody tapped it.', X2 + 16, z, { size: 10.5, color: P.mut, width: 358, lh: 1.4 });
  z += 44;

  // Everything else, collapsed. The manual form asks 13 questions today.
  rect(B, 'm / more', X2 + 16, z, 358, 48, { fill: null, r: 10, stroke: P.border, dash: true });
  txt(B, 'm / more l', '＋   More details', X2 + 30, z + 16, { size: 12.5, w: 600, color: P.fg });
  txt(B, 'm / more c', 'heart rate, cadence, elevation, notes…', X2 + 150, z + 18, { size: 10.5, color: P.mut });
  z += 60;

  txt(B, 'm / more why', 'Collapsed because production says so: cadence, power, pool length, laps, stroke, route name and notes are populated on 0 of 5 rows. Heart rate on 1. The form asks 13 questions to capture 4 answers.', X2 + 16, z, { size: 10.5, color: P.mut, width: 358, lh: 1.4 });
  z += 62;

  rect(B, 'm / save', X2 + 16, z, 358, 54, { fill: P.pri, r: 12 });
  txt(B, 'm / save l', 'Save', X2 + 16, z + 17, { size: 15, w: 800, head: true, color: '#FFFFFF', width: 358, align: 'center' });

  // ── C · the argument ────────────────────────────────────────────────
  const CX = X3 + 40;
  txt(B, '02c label', 'C  ·  Why', CX, PY - 12, { size: 11, w: 700, color: P.pri, ls: 0.6 });
  const WHY = [
    ['Start is one tap, not five', 'The activity chips, the environment and the button are one control on one screen. The control opens pre-set from the last session of that activity — which the home screen already queries for “Repeat last”. 2 taps from the Workout tab; 3 when the activity changes.'],
    ['“Now” and “already did it” fork first', 'A big Start and a quiet text link, rather than a full screen asking manual-vs-live after two activity questions. The question a user arrives with gets answered by where their thumb lands, not by a screen.'],
    ['The top of the screen earns itself', 'A week strip with day dots and goal progress. CLAUDE.md: a number gets screen space only with trend, history or comparison attached — the dots are the history and the goal is the comparison. When there is nothing behind it the strip does not render as zeros; see 04-A.'],
    ['Five utility tiles become three', 'History, Goals, Devices in one row. Templates and Planned Sessions come off the landing screen — both hold 0 rows in production, and Planned duplicates a scheduler that already has cron, push and deep links. Those are decisions, not deletions: see the ledger.'],
    ['Recent sessions replace the menu', 'The two most recent rows sit on the home screen. Tapping one opens it; long-pressing offers “Start again”, which is what Templates was for and what nobody found.'],
  ];
  let wy = PY + 8;
  WHY.forEach((w, i) => {
    txt(B, 'why t / ' + i, w[0], CX, wy, { size: 12.5, w: 700, head: true, color: P.fg });
    txt(B, 'why d / ' + i, w[1], CX, wy + 20, { size: 11, color: P.mut, width: 400, lh: 1.45 });
    wy += 118;
  });

  rect(B, 'why compare', CX, wy + 4, 400, 92, { fill: P.ok, op: 0.08, r: 10, stroke: P.ok, so: 0.35 });
  txt(B, 'why compare t', '5 taps  →  2', CX + 16, wy + 20, { size: 16, w: 800, head: true, color: P.ok });
  txt(B, 'why compare d', 'Three when the activity changes from last time. ESTIMATE, not a measurement — it assumes the control opens pre-set, which is the design claim this board is making.', CX + 16, wy + 46, { size: 10.5, color: P.mut, width: 368, lh: 1.4 });
}

// ══════════════════════════════════════════════════════════════════════
// 03 · THE TWO NEW CONTROLS
// ══════════════════════════════════════════════════════════════════════
if (PARTS.indexOf('03') !== -1) {
  const SY = 2560;
  txt(B, '03 heading', '03  ·  The two new controls', X1, SY - 34, { size: 15, w: 700, head: true, color: P.fg, ls: 0.4 });
  txt(B, '03 sub', 'Drawn at 2×. Everything else on the proposed screen already exists somewhere in the app.', X1 + 250, SY - 31, { size: 12, color: P.mut });

  // ── Start control, 2× ───────────────────────────────────────────────
  txt(B, '03a', 'Start control', X1, SY, { size: 12.5, w: 700, head: true, color: P.pri });
  const s = SY + 26;
  rect(B, 'spec / start bg', X1, s, 716, 320, { fill: P.bg, r: 16, stroke: P.border });

  const ACT2 = [['🏃', 'Run'], ['🚶', 'Walk'], ['🚴', 'Ride'], ['🏊', 'Swim']];
  ACT2.forEach((a, i) => {
    const ax = X1 + 32 + i * 168;
    const on = i === 0;
    rect(B, 'spec / act ' + a[1], ax, s + 32, 152, 112, { fill: on ? P.pri : P.card, op: on ? 0.14 : 1, r: 20, stroke: on ? P.pri : P.border, so: on ? 0.8 : 1, sw: on ? 3 : 2 });
    txt(B, 'spec / actg ' + a[1], a[0], ax, s + 56, { size: 34, width: 152, align: 'center' });
    txt(B, 'spec / actt ' + a[1], a[1], ax, s + 106, { size: 20, w: 700, head: true, width: 152, align: 'center', color: on ? P.pri : P.mut });
  });

  rect(B, 'spec / env', X1 + 32, s + 164, 652, 68, { fill: P.card, r: 18, stroke: P.border, sw: 2 });
  txt(B, 'spec / envl', 'Outside', X1 + 56, s + 186, { size: 21, w: 600, color: P.fg });
  txt(B, 'spec / envh', 'from your last run', X1 + 156, s + 190, { size: 17, color: P.mut });
  pill(B, 'Treadmill', X1 + 500, s + 180, { key: 'spec env', h: 40, size: 16, fw: 600, fill: P.sec, color: P.mut, r: 12, px: 18 });

  rect(B, 'spec / go', X1 + 32, s + 248, 652, 56, { fill: P.pri, r: 18 });
  txt(B, 'spec / gol', 'Start run', X1 + 32, s + 264, { size: 22, w: 800, head: true, color: '#FFFFFF', width: 652, align: 'center' });

  const SPECS = [
    'Activity chips 152×112 at 2× = 76×56 shipped. Above the 48 pt HIG floor with room for the glyph.',
    'Selected chip: primary at 14% with a 1.5 pt primary border. No shadow — resting elevation is a hairline, per the two-level rule.',
    'Environment row is a single line, not a screen. The label states the inference and names its source (“from your last run”) so it never looks like a guess.',
    'The chip on the right is the ONLY other option for this activity — swap, not a dropdown. Swim reads Pool / Open water.',
    'Start is the one dominant element on the screen and the only full-width primary.',
    'The button label names the activity — “Start run”, not “Start” — so the chosen chip is confirmed twice.',
  ];
  let sy = s + 340;
  SPECS.forEach((t, i) => {
    txt(B, 'spec bullet / ' + i, '·', X1, sy, { size: 12, color: P.pri, w: 700 });
    txt(B, 'spec text / ' + i, t, X1 + 14, sy, { size: 11, color: P.mut, width: 700, lh: 1.45 });
    sy += 38;
  });

  // ── Week strip, 2× ──────────────────────────────────────────────────
  txt(B, '03b', 'Week strip', X3, SY, { size: 12.5, w: 700, head: true, color: P.pri });
  const w0 = SY + 26;
  rect(B, 'spec / week bg', X3, w0, 716, 184, { fill: P.card, r: 16, stroke: P.border, sw: 2 });
  txt(B, 'spec / weekl', 'THIS WEEK', X3 + 28, w0 + 26, { size: 15, w: 700, color: P.mut, ls: 2, tt: 'uppercase' });
  txt(B, 'spec / weekv', '11.4', X3 + 28, w0 + 54, { size: 52, w: 800, head: true, color: P.fg });
  txt(B, 'spec / weeku', 'mi', X3 + 140, w0 + 82, { size: 22, w: 600, color: P.mut });
  txt(B, 'spec / weekg', 'of 15 mi goal', X3 + 180, w0 + 84, { size: 20, color: P.mut });
  const D2 = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const H2 = [1, 0, 1, 0, 0, 1, 0];
  D2.forEach((d, i) => {
    const dx = X3 + 28 + i * 62;
    rect(B, 'spec / dot ' + i, dx, w0 + 126, 42, 20, { fill: H2[i] ? P.pri : P.sec, r: 10, op: H2[i] ? 1 : 0.7 });
    txt(B, 'spec / day ' + i, d, dx, w0 + 154, { size: 15, w: 600, color: P.mut, width: 42, align: 'center' });
  });
  rect(B, 'spec / wbar', X3 + 508, w0 + 126, 178, 12, { fill: P.sec, r: 6 });
  rect(B, 'spec / wbarf', X3 + 508, w0 + 126, 135, 12, { fill: P.pri, r: 6 });

  const WSPECS = [
    'Distance is the headline because it is the one figure populated on 5 of 5 production rows. Duration is on every row too, but a week of minutes is not how anyone talks about a running week.',
    'Day dots are pills, not circles — a circle at 22×22 reads as a bullet, a pill reads as a bar you filled in.',
    'The goal comparison renders ONLY when a cardio goal exists. Without one the strip shows distance and dots and no bar — not a bar at 0%.',
    'The whole strip is absent on a week with no sessions. CLAUDE.md: a section with no data must not render as zeros, and “0.0 mi” at someone who has not run this week is the app calling them lazy.',
    'The bar reads against the goal for the CURRENT period only. The two production cardio goals are period “lifetime”, which has no week to compare against — see ledger D7.',
  ];
  let wy2 = w0 + 210;
  WSPECS.forEach((t, i) => {
    txt(B, 'wspec bullet / ' + i, '·', X3, wy2, { size: 12, color: P.pri, w: 700 });
    txt(B, 'wspec text / ' + i, t, X3 + 14, wy2, { size: 11, color: P.mut, width: 700, lh: 1.45 });
    wy2 += 46;
  });
}

// ══════════════════════════════════════════════════════════════════════
// 04 · STATES THE PROPOSAL HAS TO SURVIVE
// ══════════════════════════════════════════════════════════════════════
if (PARTS.indexOf('04') !== -1) {
  const TY = 3260;
  txt(B, '04 heading', '04  ·  States', X1, TY - 34, { size: 15, w: 700, head: true, color: P.fg, ls: 0.4 });
  txt(B, '04 sub', 'Four of these are reachable in production today. The first is what every new account sees.', X1 + 140, TY - 31, { size: 12, color: P.mut });

  const W = 340;
  const col = (i) => X1 + i * 400;

  // A — nothing logged, ever.
  txt(B, '04a', 'A  ·  First run, no history', col(0), TY, { size: 11.5, w: 700, color: P.pri });
  rect(B, 'st / a', col(0), TY + 22, W, 420, { fill: P.bg, r: 16, stroke: P.border });
  txt(B, 'st / a title', 'Cardio', col(0) + 16, TY + 40, { size: 22, w: 700, head: true, color: P.fg });
  txt(B, 'st / a note', 'No week strip. Nothing to put in it, and a row of empty dots over “0.0 mi” is a scoreboard of a failure the user has not had yet.', col(0) + 16, TY + 76, { size: 10.5, color: P.mut, width: 308, lh: 1.4 });
  let ay = TY + 132;
  [['🏃', 'Run'], ['🚶', 'Walk'], ['🚴', 'Ride'], ['🏊', 'Swim']].forEach((a, i) => {
    const ax = col(0) + 16 + i * 78;
    const on = i === 0;
    rect(B, 'st / a act ' + a[1], ax, ay, 70, 56, { fill: on ? P.pri : P.card, op: on ? 0.14 : 1, r: 12, stroke: on ? P.pri : P.border, so: on ? 0.8 : 1 });
    txt(B, 'st / a actg ' + a[1], a[0], ax, ay + 10, { size: 16, width: 70, align: 'center' });
    txt(B, 'st / a actt ' + a[1], a[1], ax, ay + 34, { size: 10, w: 700, width: 70, align: 'center', color: on ? P.pri : P.mut });
  });
  ay += 68;
  rect(B, 'st / a env', col(0) + 16, ay, 308, 36, { fill: P.card, r: 10, stroke: P.border });
  txt(B, 'st / a envl', 'Outside', col(0) + 30, ay + 11, { size: 11.5, w: 600, color: P.fg });
  txt(B, 'st / a envh', 'default — no history yet', col(0) + 84, ay + 12, { size: 10, color: P.mut });
  ay += 48;
  rect(B, 'st / a go', col(0) + 16, ay, 308, 54, { fill: P.pri, r: 13 });
  txt(B, 'st / a gol', 'Start run', col(0) + 16, ay + 17, { size: 15, w: 800, head: true, color: '#FFFFFF', width: 308, align: 'center' });
  ay += 68;
  txt(B, 'st / a rest', 'No Recent section. The three utility tiles stay — Devices is the one thing a brand-new user might genuinely want first.', col(0) + 16, ay, { size: 10.5, color: P.mut, width: 308, lh: 1.4 });

  // B — a session was interrupted.
  txt(B, '04b', 'B  ·  Recoverable session', col(1), TY, { size: 11.5, w: 700, color: P.pri });
  rect(B, 'st / b', col(1), TY + 22, W, 420, { fill: P.bg, r: 16, stroke: P.border });
  txt(B, 'st / b title', 'Cardio', col(1) + 16, TY + 40, { size: 22, w: 700, head: true, color: P.fg });
  rect(B, 'st / b banner', col(1) + 16, TY + 78, 308, 106, { fill: P.warn, op: 0.10, r: 12, stroke: P.warn, so: 0.4 });
  txt(B, 'st / b bt', 'Run in progress', col(1) + 30, TY + 92, { size: 13, w: 700, head: true, color: P.warn });
  txt(B, 'st / b bd', 'Paused 20 minutes ago · 1.2 mi', col(1) + 30, TY + 114, { size: 11, color: P.mut });
  rect(B, 'st / b resume', col(1) + 30, TY + 138, 140, 34, { fill: P.warn, r: 9 });
  txt(B, 'st / b resumel', 'Resume', col(1) + 30, TY + 147, { size: 12, w: 700, color: '#1A1206', width: 140, align: 'center' });
  txt(B, 'st / b discard', 'Discard', col(1) + 190, TY + 147, { size: 12, w: 600, color: P.mut });
  txt(B, 'st / b note', 'Today this is an AlertDialog that fires on mount and blocks the screen before you have seen it. `cardioSession.js` keeps a snapshot for 12 hours; a banner in the flow can wait, a modal cannot.', col(1) + 16, TY + 200, { size: 10.5, color: P.mut, width: 308, lh: 1.4 });
  txt(B, 'st / b note2', 'It also lands you in a PAUSED tracker regardless of what you were doing, and the recovery path only matches when the snapshot\'s mode equals the mode you happen to open. Recovering into the wrong activity silently does nothing.', col(1) + 16, TY + 286, { size: 10.5, color: P.mut, width: 308, lh: 1.4 });

  // C — GPS refused.
  txt(B, '04c', 'C  ·  Location denied', col(2), TY, { size: 11.5, w: 700, color: P.pri });
  rect(B, 'st / c', col(2), TY + 22, W, 420, { fill: P.bg, r: 16, stroke: P.border });
  txt(B, 'st / c title', 'Run', col(2) + 16, TY + 40, { size: 22, w: 700, head: true, color: P.fg });
  rect(B, 'st / c box', col(2) + 16, TY + 82, 308, 150, { fill: P.card, r: 12, stroke: P.border });
  txt(B, 'st / c g', '⚠', col(2) + 16, TY + 102, { size: 26, width: 308, align: 'center', color: P.bad });
  txt(B, 'st / c t', 'Location is off', col(2) + 16, TY + 142, { size: 14, w: 700, head: true, width: 308, align: 'center', color: P.fg });
  txt(B, 'st / c d', 'Time and distance still work — enter distance from your watch when you finish.', col(2) + 36, TY + 166, { size: 10.5, color: P.mut, width: 268, align: 'center', lh: 1.4 });
  rect(B, 'st / c go', col(2) + 16, TY + 248, 308, 50, { fill: P.pri, r: 13 });
  txt(B, 'st / c gol', 'Start anyway', col(2) + 16, TY + 264, { size: 14, w: 800, head: true, color: '#FFFFFF', width: 308, align: 'center' });
  txt(B, 'st / c alt', 'Turn on location  ›', col(2) + 16, TY + 312, { size: 11.5, w: 600, color: P.mut, width: 308, align: 'center' });
  txt(B, 'st / c note', 'Today a denial dead-ends: the tracker offers only “Switch to manual”, which throws away the session you were about to start. The indoor tracker already runs a clock with a typed distance — the outdoor one can fall back to exactly that instead of refusing.', col(2) + 16, TY + 344, { size: 10.5, color: P.mut, width: 308, lh: 1.4 });

  // D — swim, which has no live tracker.
  txt(B, '04d', 'D  ·  Swim', col(3), TY, { size: 11.5, w: 700, color: P.pri });
  rect(B, 'st / d', col(3), TY + 22, W, 420, { fill: P.bg, r: 16, stroke: P.border });
  txt(B, 'st / d title', 'Cardio', col(3) + 16, TY + 40, { size: 22, w: 700, head: true, color: P.fg });
  let dy = TY + 78;
  [['🏃', 'Run'], ['🚶', 'Walk'], ['🚴', 'Ride'], ['🏊', 'Swim']].forEach((a, i) => {
    const ax = col(3) + 16 + i * 78;
    const on = i === 3;
    rect(B, 'st / d act ' + a[1], ax, dy, 70, 56, { fill: on ? P.cyan : P.card, op: on ? 0.16 : 1, r: 12, stroke: on ? P.cyan : P.border, so: on ? 0.8 : 1 });
    txt(B, 'st / d actg ' + a[1], a[0], ax, dy + 10, { size: 16, width: 70, align: 'center' });
    txt(B, 'st / d actt ' + a[1], a[1], ax, dy + 34, { size: 10, w: 700, width: 70, align: 'center', color: on ? P.cyan : P.mut });
  });
  dy += 68;
  rect(B, 'st / d env', col(3) + 16, dy, 308, 36, { fill: P.card, r: 10, stroke: P.border });
  txt(B, 'st / d envl', 'Pool', col(3) + 30, dy + 11, { size: 11.5, w: 600, color: P.fg });
  pill(B, 'Open water', col(3) + 210, dy + 6, { key: 'st d', h: 24, size: 10, fw: 600, fill: P.sec, color: P.mut, r: 7, px: 10 });
  dy += 48;
  rect(B, 'st / d go', col(3) + 16, dy, 308, 54, { fill: P.cyan, r: 13 });
  txt(B, 'st / d gol', 'Log a swim', col(3) + 16, dy + 17, { size: 15, w: 800, head: true, color: '#04212A', width: 308, align: 'center' });
  dy += 70;
  txt(B, 'st / d note', 'Swim has no live tracker — GPS in a pool is meaningless and the code excludes it. So the button says what it does. Today the flow asks “how do you want to log it?” and then shows one option.', col(3) + 16, dy, { size: 10.5, color: P.mut, width: 308, lh: 1.4 });
  txt(B, 'st / d note2', 'BLOCKED: swimming has no cardio.type.* keys. A pool swim renders the literal string “cardio.type.swimming_pool” in the form title, the detail modal, Repeat last and three Hub surfaces. Ledger T2 — fix before drawing more swim UI.', col(3) + 16, dy + 78, { size: 10.5, color: P.bad, width: 308, lh: 1.4 });
}

// ══════════════════════════════════════════════════════════════════════
// 05 · LEDGER
// ══════════════════════════════════════════════════════════════════════
if (PARTS.indexOf('05') !== -1) {
  const LY = 3860;
  txt(B, '05 heading', '05  ·  Ledger', X1, LY - 34, { size: 15, w: 700, head: true, color: P.fg, ls: 0.4 });
  txt(B, '05 sub', 'What is verified, and what is still a decision. Nothing here is drawn as settled.', X1 + 130, LY - 31, { size: 12, color: P.mut });

  // ── Verified defects ────────────────────────────────────────────────
  txt(B, '05 defects h', 'Verified against production, 2026-08-11', X1, LY + 6, { size: 12.5, w: 700, head: true, color: P.bad });
  const DEFECTS = [
    ['T1', 'Cardio Goals reads a goal_type nothing else writes',
     'CardioGoals.jsx queries goal_type = \'cardio\'. The rest of the app writes cardio_distance / cardio_duration / cardio_sessions (GoalForm, GoalsList, GoalsModal, GoalsAlmostComplete). Production holds 2 cardio_distance goals and 0 cardio. So the screen says “No cardio goals yet” to a user who has two — and a goal created there is invisible to every other goal surface: GoalsList has no branch for it, so it renders the literal key path “goals.type.cardio (Running)” at 0%, because goals.type.cardio does not exist either.'],
    ['T2', 'Swimming has no type translations',
     'cardio.type.swimming_pool and cardio.type.swimming_openwater exist only as speed limits in cardioLimits.js, never as i18n keys. getTranslation returns the KEY on a total miss, so a swim log renders “cardio.type.swimming_pool” verbatim in CardioManualForm, CardioDetailModal, the Repeat-last row, PostActivityBlock and HubComposer ×2. Swimming was added to the picker without the keys the rest of the flow reads.'],
    ['T3', 'Three of four activity tiles share one description',
     'Running, Walking and Biking all pass t(\'cardio.subtitle\') — “Track running, walking, and cycling” — which is also the page subtitle directly above them. Only Swimming has its own.'],
    ['T4', 'Two of five utility tiles have never held a row',
     'cardio_templates 0 rows, planned_cardio 0 rows. Templates can only be created from a button at the bottom of the manual form, below the Save button.'],
    ['T5', 'planned_cardio.completed_cardio_id is read and never written',
     'CardioPlanned.jsx:319 branches on it to show “Completed” vs “Not logged”. Nothing in the codebase writes it, so a past plan can only ever say “Not logged” — including one you did. Third shape from the denormalised-columns section of CLAUDE.md: a reader with no writer.'],
    ['T6', 'Two schedulers, and the empty one has no reminders',
     'planned_cardio duplicates scheduled_workouts (mig 276), which resolves against the user\'s local hour, fires an hourly cron, pushes a notification and deep-links into the session. planned_cardio does none of that and holds 0 rows.'],
    ['T7', 'Two cardio systems that never reconcile',
     'CardioSection writes cardio_logs. CardioLogger — the “+ Cardio” block inside a live workout — writes a kind:\'cardio\' entry into workout_logs.exercises JSONB. A treadmill mile logged inside a workout counts toward no cardio distance, goal, PR, VO2max or total_distance_meters. The vocabularies differ too: CardioLogger says cycling, CardioSection says biking.'],
    ['T8', 'The manual form asks 13 questions to capture 4 answers',
     'Across 5 production rows: cadence, power, pool length, laps, stroke, route name and notes are populated 0 times. Heart rate once, VO2max twice (derived). Distance, duration, pace and speed 5 of 5 — and calories is 0 on 2 of the 5 rows that have it, i.e. nobody tapped Estimate.'],
    ['T9', 'Cardio inherits the Workout page\'s chrome',
     'CardioSection renders as an inline branch of /workout, below GoalsAlmostComplete, the late-night banner, InjuryBanner, the duel/bounty pills, the Today chip and the grid-customize button. All six belong to the workout start screen. Visible in the screenshot this board started from.'],
    ['T10', 'MAX_MODE_SPEED_MPS keys on a vocabulary the modes do not use',
     'The outdoor tracker\'s GPS-outlier rejection keys on running / walking / cycling / hiking. The modes it receives are running / walking / biking / swimming. Biking gets the right cap only because the ?? fallback happens to be cycling; hiking is unreachable. Benign today, wrong the moment anyone edits either list.'],
  ];
  let dy = LY + 32;
  DEFECTS.forEach(d => {
    txt(B, 'led t / ' + d[0], d[0], X1, dy, { size: 11, w: 800, head: true, color: P.bad, width: 34 });
    txt(B, 'led w / ' + d[0], d[1], X1 + 40, dy, { size: 12, w: 700, color: P.fg, width: 500 });
    txt(B, 'led e / ' + d[0], d[2], X1 + 560, dy, { size: 10.5, color: P.mut, width: 620, lh: 1.5 });
    dy += 104;
  });

  // ── Decisions ───────────────────────────────────────────────────────
  const DX = X3 + 300;
  txt(B, '05 dec h', 'Decisions — yours, not the board\'s', DX, LY + 6, { size: 12.5, w: 700, head: true, color: P.pri });
  const DECISIONS = [
    ['D1', 'Collapse activity → environment → input type into one Start control.',
     'The core of the proposal. Costs the two intermediate screens; buys 5 taps → 2. Reversible — the screens still exist as the “More” path if the control proves too dense.'],
    ['D2', 'Take Templates off the landing screen; fold “Start again” into a history row.',
     '0 rows in production and an entry point below the Save button. Keeping the table costs nothing; keeping the tile costs a fifth of the landing screen.'],
    ['D3', 'Retire planned_cardio; route cardio scheduling through scheduled_workouts.',
     'One scheduler with cron, push and deep-links instead of two, one of which has 0 rows and cannot notify. Needs a decision about what happens to the planned_cardio table — it is empty, so dropping it is free.'],
    ['D4', 'Make in-workout cardio write a cardio_logs row.',
     'Fixes T7, and is the largest item here: it touches XP, quests, streaks, distance accumulation and PR detection, all of which are server-authoritative. The alternative — decide explicitly that in-workout cardio is warm-up only and does not count — is also a valid answer and much cheaper.'],
    ['D5', 'Give cardio its own route instead of an inline branch of /workout.',
     'Fixes T9 outright and makes the back button mean one thing. Costs a route, a lazy chunk and the ?openCardio=1 deep link that quests use.'],
    ['D6', 'Manual form: three fields, then “More details”.',
     'Backed by T8. The risk is the reverse reading — that nobody fills those fields BECAUSE the form is a wall, not the other way round. Cheap to test: ship the collapse and watch whether the populated-column counts move.'],
    ['D7', 'Point Cardio Goals at the real goal_type vocabulary.',
     'Fixes T1. Free right now: zero rows carry goal_type = \'cardio\', so there is nothing to migrate — only code to change. That window closes the first time someone creates a goal from that screen. Also decide what the week strip compares against: both production cardio goals are period “lifetime”.'],
  ];
  let cy = LY + 32;
  DECISIONS.forEach(d => {
    txt(B, 'led t / dec ' + d[0], d[0], DX, cy, { size: 11, w: 800, head: true, color: P.pri, width: 34 });
    txt(B, 'led w / dec ' + d[0], d[1], DX + 40, cy, { size: 12, w: 700, color: P.fg, width: 460, lh: 1.35 });
    txt(B, 'led e / dec ' + d[0], d[2], DX + 40, cy + 34, { size: 10.5, color: P.mut, width: 460, lh: 1.5 });
    cy += 118;
  });

  // ── What this board does NOT propose ────────────────────────────────
  txt(B, '05 no h', 'Deliberately unchanged', X1, dy + 24, { size: 12.5, w: 700, head: true, color: P.ok });
  const KEEP = [
    'The live trackers themselves. The outdoor one carries GPS outlier rejection, null-speed-aware auto-pause, background-time exclusion, a frozen finish time, wake lock, a 10-second snapshot and voice milestones — every one of which is a fix for a real bug, documented at its call site. Nothing on this board touches that file except the denied-location fallback in 04-C.',
    'The anti-cheat limits. checkCardioSpeed, getMaxRealisticCalories and checkDailyHours stay exactly as they are; migration 262 caps cardio XP server-side regardless.',
    'The Devices tile. It is a stub whose buttons all toast “coming soon”, which is honest, and it is the one thing a new user may look for first.',
    'VO2max, PR detection and the splits table. All three are earned data, correctly gated on having something to show.',
  ];
  let ky = dy + 50;
  KEEP.forEach((k, i) => {
    txt(B, 'keep b / ' + i, '·', X1, ky, { size: 12, color: P.ok, w: 700 });
    txt(B, 'keep t / ' + i, k, X1 + 14, ky, { size: 10.5, color: P.mut, width: 1100, lh: 1.5 });
    ky += 74;
  });
}

return {
  board: BOARD_NAME,
  parts: PARTS,
  x: B.x,
  size: [B.width, B.height],
  children: B.children.length,
};
