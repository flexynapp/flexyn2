/* eslint-disable */
//
// docs/penpot-regimens-board.js
//
// Builds the board `Regimens — proposed` on the Penpot page "Regimens".
// Proposes a new UI for the regimen library (`RegimensSection.jsx`, what
// the "Regimens" card on /workout opens) AND for every subpage it owns:
// the create/edit form, the session detail view, the empty state, and the
// three community browsers it currently offers.
//
// Sibling board: `Explore Regimens — proposed` on the page of that name,
// built by docs/penpot-explore-regimens-board.js and SHIPPED (67f2feb3,
// src/lib/regimenLoad.js). This board reuses its card grammar deliberately
// — cost line, muscle tags above the description, first three lifts with
// loads, zero-suppressed social proof — so the library and the store read
// as one surface rather than two.
//
// WHY THIS IS A FILE AND NOT A TOOL CALL: the plugin bridge went
// unresponsive before a single shape was drawn on 2026-08-11 —
// `execute_code` timed out on `return 1 + 1` for ~20 minutes while the
// MCP server itself answered normally, isolating it to the SERVER→PLUGIN
// hop. Same failure the Explore Regimens script hit mid-build the same
// day. So this follows the established pattern: self-contained and
// idempotent, pasted into `execute_code` in one go after a reconnect.
//
// It is SAFE TO RE-RUN. It deletes any board of the same name first, so a
// half-built board from a timed-out call is cleaned up rather than
// double-drawn. Do not try to resume it mid-board.
//
// IF IT TIMES OUT: set PARTS below to a subset and paste again. The seven
// groups are independent and each re-runs from scratch. 'shell' both
// creates the board and WIPES any existing one, so it goes in the first
// slice and no other:
//     ['shell','01','02']   then   ['03','04']   then   ['05','06']
// A slice without 'shell' appends to the board already on the page, and
// bails with a message if there isn't one.
//
// BEFORE PASTING: open the page "Regimens" in the Penpot UI. The script
// bails rather than switching pages itself — `openPage()` is async and
// asserting `currentPage` on the next line is a race that has cost a
// board before.
//
// ── Idiom: SLOTS, not resolved ───────────────────────────────────────
// This board is a PROPOSAL. Group 01 is the current page drawn from its
// own source; 02 is the proposal; 03 specs the card and states what the
// page can actually draw; 04 is the subpages; 05 the states the proposal
// has to survive; 06 the rationale. Kegan composes the final UI from
// this — per the standing rule, the design that ships is his, not the one
// an agent invented.
//
// ── Provenance of every number on this board ─────────────────────────
// QUERIED against production 2026-08-11. n = 33 regimens, 28 authors,
// avg 6.42 exercises, max 10, zero empty.
//
//   POPULATED
//     exercises[].name          33 of 33
//     exercises[].target_sets   30 of 30 exercises sampled (the 4 public)
//     exercises[].target_reps   30 of 30
//     exercises[].muscle_groups 32 of 33 regimens
//     description               31 of 33
//     exercises[].rest_seconds   6 of 33 regimens  (90–120 s where set)
//     is_active                  4 of 33
//     original_author_username   2 of 33
//
//   ZERO — eleven distinct signals this surface is built around
//     updated_at > created_at    0 of 33   nobody has EVER edited a regimen
//     exercises[].notes          0 of 33
//     exercises[].group_id       0 of 33   superset / circuit never used
//     difficulty                 0 of 33
//     days (jsonb)               0 of 33
//     is_template / template_id  0 of 33
//     copy_count / clone_count   0 of 33
//     workout_templates          0 rows, 0 authors  ← the "Templates" button
//     regimen_reviews            0 rows
//     scheduled_workouts         0 rows
//     workout_logs.title matching a regimen name   0 of 6
//
// The last one is why "Last performed" is NOT drawn anywhere on this
// board. It is the single highest-value addition to the card and it is
// not derivable today: `workout_logs.regimen_id` was dropped (see the
// comment at Workout.jsx:1782) and no log title has ever matched a
// regimen name. Drawing it would be inventing data.
//
// READ FROM SOURCE: every padding, radius, font size, colour role, icon
// and chip vocabulary in group 01 comes from RegimensSection.jsx,
// RegimenForm.jsx and RegimenDetailView.jsx at origin/main.
//
// GEOMETRY on this board is "as drawn", not measured in a browser. The
// Explore board learned that the hard way — figures derived by adding up
// Tailwind margins were optimistic in all four cases, reliably and in the
// flattering direction. Where a pt figure appears here it is labelled
// `as drawn`; render it in the Vite stub-alias harness before quoting it
// as fact.
//
// ── The one new function this board asks for ─────────────────────────
// `setsPerMuscle(regimens)` — Σ target_sets grouped by muscle_groups,
// across a set of regimens. Both inputs are populated today (30 of 30 and
// 32 of 33), so it needs no column, no backfill and no author input,
// exactly like `regimenLoad`. It belongs in src/lib/regimenLoad.js beside
// `totalSets`. Everything the coverage strip draws comes from it.
//
// The 10–20 band it is drawn against is the standard hypertrophy working
// range (MEV≈10 / MRV≈20 weekly hard sets per muscle). The strip is
// labelled "one pass through your library", NOT "per week", because
// `scheduled_workouts` holds 0 rows — the app has no schedule and must
// not claim a weekly number it cannot support.
// ─────────────────────────────────────────────────────────────────────

const BOARD_NAME = 'Regimens — proposed';
const ALLOWED_PAGES = ['Regimens'];

// Which groups to draw. Trim this if the call times out — see the header.
const PARTS = ['shell', '01', '02', '03', '04', '05', '06'];

// ── Guard rails ───────────────────────────────────────────────────────
const page = penpot.currentPage;
if (!page) return 'No current page.';
if (ALLOWED_PAGES.indexOf(page.name) === -1) {
  return `Current page is "${page.name}". Open "Regimens" in the Penpot UI and re-run — this script will not switch pages for you.`;
}

let B = penpotUtils.findShape(s => s.name === BOARD_NAME && s.type === 'board', page.root);
if (PARTS.indexOf('shell') !== -1) {
  if (B) B.remove();
  B = null;
}
if (!B && PARTS.indexOf('shell') === -1) return 'No board to append to — run with "shell" in PARTS first.';

// ── Palette ───────────────────────────────────────────────────────────
// hsl() from `.dark` in src/index.css, converted. Identical to the
// Explore Regimens board so the two read as one document.
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
  ink:    '#0B0E11',
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
const pill = (parent, label, x, y, o) => {
  o = o || {};
  const px = o.px === undefined ? 10 : o.px;
  const size = o.size || 11;
  const w = o.w || Math.round(label.length * size * 0.56) + px * 2;
  const h = o.h || 24;
  const key = o.key ? o.key + ' / ' + label : label;
  rect(parent, 'chip / ' + key, x, y, w, h, { fill: o.fill || P.card, r: (o.r === undefined ? h / 2 : o.r), stroke: o.stroke, so: o.so, dash: o.dash });
  txt(parent, 'chip label / ' + key, label, x, y + (h - size * 1.35) / 2, {
    size, w: o.fw || 600, color: o.color || P.mut, width: w, align: 'center', tt: o.tt, ls: o.ls, head: o.head,
  });
  return w;
};

// Phone frame. Every drawing on this board is 390 pt wide — Flexyn ships
// to iOS and Android only, so there is no desktop composition to draw.
const phone = (x, y, h, name) => rect(B, 'phone / ' + name, x, y, 390, h, { fill: P.bg, r: 18, stroke: P.border });

// Section heading, in the numbered idiom the Explore board established.
const heading = (n, label, x, y, color) =>
  txt(B, n + ' heading', n + '  ·  ' + label, x, y, { size: 15, w: 700, head: true, ls: 0.4, color: color || P.fg });

// A caption under a drawing: bold lead + prose, stacked.
const caption = (key, x, y, w, lead, body) => {
  txt(B, 'cap t / ' + key, lead, x, y, { size: 11.5, w: 700, color: P.fg });
  txt(B, 'cap b / ' + key, body, x, y + 17, { size: 10.5, color: P.mut, width: w, lh: 1.45 });
};

// ── Shell ─────────────────────────────────────────────────────────────
if (PARTS.indexOf('shell') !== -1) {
  B = penpot.createBoard();
  B.name = BOARD_NAME;
  B.resize(1960, 4700);
  B.x = 0; B.y = 0;
  B.fills = [{ fillColor: P.paper, fillOpacity: 1 }];

  txt(B, 'board title', 'Regimens', 40, 46, { size: 34, w: 800, head: true, color: P.fg, lh: 1.2 });
  txt(B, 'board subtitle',
    'A proposed redesign of the regimen library and every subpage it owns  ·  src/components/workout/RegimensSection.jsx  ·  drawn at 390 pt',
    40, 96, { size: 13, color: P.mut });
  rect(B, 'title rule', 40, 126, 1880, 1, { fill: P.border });
}

// ═══════════════════════════════════════════════════════════════════════
// 01 · TODAY
// Drawn from RegimensSection.jsx at origin/main. The page header is the
// Workout page's own PageHeader, swapped to workout.regimens /
// workout.regimensDesc when regimensOpen is true (Workout.jsx:2306).
// ═══════════════════════════════════════════════════════════════════════
if (PARTS.indexOf('01') !== -1) {
  const X = 140, Y = 186, L = X + 16, W = 358;
  heading('01', 'Today', X, 152);
  phone(X, Y, 640, 'today');

  txt(B, 'today / title', 'Regimens', L, Y + 20, { size: 20, w: 700, head: true, color: P.fg });
  txt(B, 'today / sub', 'Start from your custom plans', L, Y + 48, { size: 11, color: P.mut });

  // The Back button is a bare outline Button above the action row, not a
  // header control — Workout.jsx:2738.
  rect(B, 'today / back', L, Y + 76, 78, 32, { fill: P.card, r: 8, stroke: P.border });
  txt(B, 'today / back label', '←  Back', L, Y + 86, { size: 11, w: 600, color: P.mut, width: 78, align: 'center' });

  // Three top-level buttons. Two of them open browsers over the same
  // four rows; one opens a table with no rows at all. See group 04d.
  rect(B, 'today / btn templates', L, Y + 122, 96, 34, { fill: P.card, r: 8, stroke: P.border });
  txt(B, 'today / btn templates label', '▤  Templates', L, Y + 133, { size: 10.5, w: 600, color: P.fg, width: 96, align: 'center' });
  rect(B, 'today / btn browse', L + 104, Y + 122, 132, 34, { fill: P.card, r: 8, stroke: P.border });
  txt(B, 'today / btn browse label', '⊕  Browse Templates', L + 104, Y + 133, { size: 10.5, w: 600, color: P.fg, width: 132, align: 'center' });
  rect(B, 'today / btn create', L + 244, Y + 122, 114, 34, { fill: P.pri, r: 8 });
  txt(B, 'today / btn create label', '+  Create Regimen', L + 244, Y + 133, { size: 10.5, w: 700, color: '#FFFFFF', width: 114, align: 'center' });

  // The card, as shipped.
  const cy = Y + 172;
  rect(B, 'today / card', L, cy, W, 242, { fill: P.card, r: 12, stroke: P.border });
  txt(B, 'today / card title', 'Upper Body Power Day', L + 14, cy + 14, { size: 15, w: 700, head: true, color: P.fg });
  txt(B, 'today / card author', 'From @sjoudrie', L + 14, cy + 36, { size: 10.5, color: P.mut });
  // Clamped to the two lines the app actually renders (line-clamp-2).
  // Drawing the full string was both unfaithful and 48 pt taller than the
  // card, so it ran straight through the icon row.
  txt(B, 'today / card desc',
    'A complete upper body session hitting every muscle above the waist — ch…',
    L + 14, cy + 54, { size: 11.5, color: P.mut, width: 236, lh: 1.4 });
  rect(B, 'today / card start', L + 282, cy + 12, 62, 28, { fill: P.pri, r: 8 });
  txt(B, 'today / card start label', 'Start', L + 282, cy + 21, { size: 11, w: 700, color: '#FFFFFF', width: 62, align: 'center' });

  // Six ghost icons at equal weight and equal size. One publishes to the
  // world, one deletes, one is a mode switch. None is labelled.
  const glyphs = ['◉', '✎', '⌾', '⚡', '➤', '✕'];
  const names = ['view', 'edit', 'publish', 'make active', 'share', 'delete'];
  glyphs.forEach((g, i) => {
    rect(B, 'today / icon ' + names[i], L + 14 + i * 34, cy + 96, 28, 28, { fill: null, r: 6, stroke: P.border });
    txt(B, 'today / icon glyph ' + names[i], g, L + 14 + i * 34, cy + 104,
      { size: 12, color: i === 5 ? P.bad : P.mut, width: 28, align: 'center' });
  });
  txt(B, 'today / icon caption',
    'view · edit · publish · make active · share · delete — six ghost icons, equal weight, no labels',
    L + 14, cy + 132, { size: 9.5, color: P.mut, width: 330, lh: 1.4 });

  // Seven grey name badges. Identical treatment on every card, and the
  // only place the exercises appear without their numbers.
  let bx = L + 14, by = cy + 168;
  ['Bench Press', 'Barbell Row', 'Overhead Press', 'Pull-Up'].forEach(n => {
    bx += pill(B, n, bx, by, { key: 'today badge', h: 20, size: 10, fw: 400, fill: P.sec, color: P.mut, r: 10, px: 8 }) + 5;
  });
  bx = L + 14; by = cy + 194;
  ['Dumbbell Curl', 'Tricep Dip', 'Lateral Raise'].forEach(n => {
    bx += pill(B, n, bx, by, { key: 'today badge', h: 20, size: 10, fw: 400, fill: P.sec, color: P.mut, r: 10, px: 8 }) + 5;
  });

  // Chrome bracket. AS DRAWN — render before quoting.
  rect(B, 'bracket / today', X - 22, Y, 2, 172, { fill: P.pri });
  txt(B, 'bracket / today label', '172 pt', X - 78, Y + 74, { size: 11, w: 700, color: P.pri, width: 48, align: 'right' });
  txt(B, 'bracket / today sub', 'before the\nfirst regimen', X - 118, Y + 92, { size: 9.5, color: P.mut, width: 88, align: 'right', lh: 1.35 });

  caption('today', X, Y + 660, 390,
    'a · The library as it ships',
    'Three top-level buttons, then a card whose only numbers are on the Start button. The exercises are seven grey pills with '
    + 'no sets, no reps and no load; target_sets and target_reps are populated on every exercise in the database and appear '
    + 'nowhere on this card. is_active is set on 4 of 33 rows and renders as a 10 px chip.');
}

// ═══════════════════════════════════════════════════════════════════════
// 02 · PROPOSED
// ═══════════════════════════════════════════════════════════════════════

// The proposed library card. Same grammar as the shipped store card
// (regimenLoad cost line, tags above the description, first three lifts
// with loads) with two differences that follow from ownership: the
// repeated action is Start rather than Adopt, and the five secondary
// actions collapse into one overflow.
const CARD_W = 358, CARD_H = 242;
const libraryCard = (parent, x, y, d) => {
  rect(parent, 'card / ' + d.name, x, y, CARD_W, CARD_H, { fill: P.card, r: 12, stroke: P.border });

  txt(parent, 'c title / ' + d.name, d.name, x + 16, y + 14, { size: 16, w: 700, head: true, color: P.fg });
  txt(parent, 'c more menu / ' + d.name, '⋯', x + CARD_W - 34, y + 12, { size: 16, w: 700, color: P.mut, width: 20, align: 'center' });

  // Cost line. Every number populated on every row; two of the three are
  // already computed by src/lib/regimenLoad.js.
  const meta = d.author + '  ·  ' + d.ex + ' exercises  ·  ' + d.sets + ' sets';
  txt(parent, 'c meta / ' + d.name, meta, x + 16, y + 40, { size: 11, color: P.mut });
  txt(parent, 'c time / ' + d.name, '~' + d.min + ' min', x + 16 + Math.round(meta.length * 5.4) + 10, y + 40, { size: 11, w: 700, color: P.pri });

  // Muscle tags above the description, capped at MUSCLE_CHIP_CAP = 4.
  let bx = x + 16;
  d.muscles.forEach(m => { bx += pill(parent, m, bx, y + 60, { key: 'tag ' + d.name, h: 21, size: 10, fw: 600, fill: P.sec, color: P.fg, r: 5, px: 8 }) + 5; });

  txt(parent, 'c desc / ' + d.name, d.desc, x + 16, y + 90, { size: 12, color: P.mut, width: CARD_W - 32, lh: 1.4 });
  rect(parent, 'c rule / ' + d.name, x + 16, y + 128, CARD_W - 32, 1, { fill: P.border });

  // The product. Today this is a wall of name-only badges.
  d.lifts.forEach((l, i) => {
    txt(parent, 'c lift / ' + d.name + ' / ' + l[0], l[0], x + 16, y + 140 + i * 20, { size: 12.5, w: 500, color: P.fg, op: 0.92 });
    txt(parent, 'c load / ' + d.name + ' / ' + l[0], l[1], x + 16, y + 140 + i * 20, { size: 12, w: 600, color: P.mut, width: CARD_W - 32, align: 'right' });
  });

  txt(parent, 'c more / ' + d.name, 'Preview all ' + d.ex + '  ›', x + 16, y + 206, { size: 11.5, w: 600, color: P.mut });
  rect(parent, 'c start / ' + d.name, x + CARD_W - 100, y + 198, 84, 30, { fill: P.pri, r: 8 });
  txt(parent, 'c start label / ' + d.name, 'Start', x + CARD_W - 100, y + 207, { size: 11.5, w: 700, color: '#FFFFFF', width: 84, align: 'center' });
};

// One cell of the sets-per-muscle strip. The band is the whole point:
// a number with no range beside it is decoration, per the "data must be
// earned" rule in CLAUDE.md.
const BAND_LO = 10, BAND_HI = 20, BAND_MAX = 26;
const coverageCell = (parent, key, x, y, muscle, sets, cw) => {
  const colour = sets < BAND_LO ? P.pri : (sets > BAND_HI ? P.bad : P.ok);
  txt(parent, 'cov m / ' + key + ' / ' + muscle, muscle, x, y, { size: 10, w: 600, color: P.fg, op: 0.85 });
  txt(parent, 'cov n / ' + key + ' / ' + muscle, String(sets), x, y + 13, { size: 17, w: 700, head: true, color: colour });
  txt(parent, 'cov u / ' + key + ' / ' + muscle, 'sets', x + (String(sets).length * 10) + 5, y + 21, { size: 9.5, color: P.mut });
  rect(parent, 'cov track / ' + key + ' / ' + muscle, x, y + 38, cw - 12, 3, { fill: P.sec, r: 2 });
  rect(parent, 'cov fill / ' + key + ' / ' + muscle, x, y + 38, Math.max(3, Math.round((Math.min(sets, BAND_MAX) / BAND_MAX) * (cw - 12))), 3, { fill: colour, r: 2 });
};

const coverageStrip = (parent, key, x, y, data, label) => {
  txt(parent, 'cov label / ' + key, label, x, y, { size: 9, w: 700, ls: 0.7, tt: 'uppercase', color: P.mut, width: 358 });
  const cw = 121;
  data.forEach((d, i) => {
    coverageCell(parent, key, x + (i % 3) * cw, y + 22 + Math.floor(i / 3) * 56, d[0], d[1], cw);
  });
};

if (PARTS.indexOf('02') !== -1) {
  const X = 700, Y = 186, L = X + 16, W = 358;
  heading('02', 'Proposed', X, 152, P.pri);
  phone(X, Y, 1040, 'proposed');

  // Header. One primary action, top-right, where a thumb does not need it
  // often — Start lives on the cards and in the active band instead.
  txt(B, 'prop / back', '‹', L, Y + 20, { size: 17, w: 600, color: P.mut });
  txt(B, 'prop / title', 'Regimens', L + 20, Y + 18, { size: 20, w: 700, head: true, color: P.fg });
  txt(B, 'prop / sub', '7 sessions  ·  1 active', L + 20, Y + 46, { size: 11, color: P.mut });
  rect(B, 'prop / new', X + 306, Y + 20, 68, 28, { fill: P.pri, r: 14 });
  txt(B, 'prop / new label', '+  New', X + 306, Y + 28, { size: 11, w: 700, color: '#FFFFFF', width: 68, align: 'center' });

  // ── Active plan — the page's one dominant element, and the only thing
  // that bleeds past the page inset. is_active exists on 4 of 33 rows and
  // today it is a 10 px chip; here the layout carries it.
  const ab = Y + 76;
  rect(B, 'prop / active band', X, ab, 390, 118, { fill: P.card2 });
  rect(B, 'prop / active band top', X, ab, 390, 1, { fill: P.border });
  rect(B, 'prop / active band bottom', X, ab + 118, 390, 1, { fill: P.border });
  rect(B, 'prop / active accent', X, ab, 3, 118, { fill: P.pri });
  txt(B, 'prop / active kicker', 'Active plan', L, ab + 14, { size: 9.5, w: 700, ls: 0.8, tt: 'uppercase', color: P.pri });
  txt(B, 'prop / active title', 'Upper Body Power Day', L, ab + 32, { size: 18, w: 700, head: true, color: P.fg });
  txt(B, 'prop / active meta', '7 exercises  ·  23 sets', L, ab + 60, { size: 11, color: P.mut });
  txt(B, 'prop / active time', '~43 min', L + 128, ab + 60, { size: 11, w: 700, color: P.pri });
  let mx = L;
  ['Chest', 'Back', 'Shoulders', 'Biceps'].forEach(m => {
    mx += pill(B, m, mx, ab + 82, { key: 'active tag', h: 21, size: 10, fw: 600, fill: P.sec, color: P.fg, r: 5, px: 8 }) + 5;
  });
  rect(B, 'prop / active start', X + 272, ab + 26, 92, 36, { fill: P.pri, r: 10 });
  txt(B, 'prop / active start label', 'Start', X + 272, ab + 37, { size: 12.5, w: 700, color: '#FFFFFF', width: 92, align: 'center' });
  txt(B, 'prop / active more', '⋯', X + 352, ab + 12, { size: 16, w: 700, color: P.mut, width: 20, align: 'center' });

  // ── Sets per muscle. The one new signal, and it costs no new column.
  const cs = ab + 146;
  coverageStrip(B, 'prop', L, cs,
    [['Chest', 12], ['Back', 16], ['Shoulders', 11], ['Legs', 9], ['Arms', 14], ['Core', 4]],
    'Sets per muscle  ·  one pass through your library');
  txt(B, 'prop / cov note',
    '10–20 hard sets a week is the working range for a muscle. This counts one pass through your library — schedule your sessions and it becomes a real weekly number.',
    L, cs + 140, { size: 10.5, color: P.mut, width: 358, lh: 1.45 });

  // 32 px break — the one seam on the page, between the plan you run and
  // the library you keep. Exactly one per page, per CLAUDE.md.
  const sec = cs + 214;
  txt(B, 'prop / sessions label', 'Sessions', L, sec, { size: 9.5, w: 700, ls: 0.8, tt: 'uppercase', color: P.mut });
  txt(B, 'prop / sessions count', '6 more', X + 306, sec, { size: 9.5, w: 600, color: P.mut, width: 68, align: 'right' });

  libraryCard(B, L, sec + 22, {
    name: 'Legs & Core Destroyer', author: '@kegan', ex: 8, sets: 27, min: 50,
    muscles: ['Legs', 'Glutes', 'Core'],
    desc: 'Quads, hamstrings, glutes, calves — then core to finish. Heavy compound loading and isolation.',
    lifts: [['Squat', '4 × 8'], ['Romanian Deadlift', '4 × 10'], ['Leg Press', '3 × 12']],
  });
  libraryCard(B, L, sec + 276, {
    name: 'Back & Shoulders Builder', author: 'from @sjoudrie', ex: 8, sets: 28, min: 51,
    muscles: ['Back', 'Shoulders'],
    desc: 'Width and thickness built together. Pairs vertical and horizontal pulls for a thick back.',
    lifts: [['Pull-Up', '4 × 8'], ['Barbell Row', '4 × 10'], ['Lat Pulldown', '3 × 12']],
  });

  // The community entry point moves from a top-level button to a row at
  // the foot of the list — after the goods, like the Explore board's
  // publish slot.
  const fr = sec + 530;
  rect(B, 'prop / community', L, fr, W, 46, { fill: P.card, r: 10, stroke: P.border });
  txt(B, 'prop / community label', 'Browse community programs', L + 14, fr + 10, { size: 11.5, w: 600, color: P.fg });
  txt(B, 'prop / community sub', '4 shared by other athletes', L + 14, fr + 26, { size: 10, color: P.mut });
  txt(B, 'prop / community chev', '›', L + W - 26, fr + 14, { size: 13, w: 700, color: P.mut });

  rect(B, 'bracket / prop', X - 22, Y, 2, 76, { fill: P.ok });
  txt(B, 'bracket / prop label', '76 pt', X - 78, Y + 26, { size: 11, w: 700, color: P.ok, width: 48, align: 'right' });

  caption('prop', X, Y + 1060, 390,
    'b · The proposal',
    'One plan is promoted and everything else is a library beneath it. The header collapses three buttons into one; the '
    + 'community browser moves to a row at the foot of the list. The card carries the numbers that are already in the '
    + 'database. Sets per muscle is the only new thing on the page and it is derived, not stored.');
}

// ═══════════════════════════════════════════════════════════════════════
// 03 · CARD ANATOMY  +  WHAT THE PAGE CAN ACTUALLY DRAW
// ═══════════════════════════════════════════════════════════════════════
if (PARTS.indexOf('03') !== -1) {
  const Y = 1360;
  heading('03', 'Card anatomy', 140, Y - 34);

  rect(B, 'anatomy panel', 140, Y, 760, 470, { fill: P.bg, r: 14, stroke: P.border });
  const AX = 170, AY = Y + 30;
  libraryCard(B, AX, AY, {
    name: 'Back & Shoulders Builder', author: 'from @sjoudrie', ex: 8, sets: 28, min: 51,
    muscles: ['Back', 'Shoulders'],
    desc: 'Width and thickness built together. Pairs vertical and horizontal pulls for a thick back.',
    lifts: [['Pull-Up', '4 × 8'], ['Barbell Row', '4 × 10'], ['Lat Pulldown', '3 × 12']],
  });
  // The same card is drawn in 02 and again here, so its shape names
  // collide. Prefix this copy — a later findShape() edit aimed at one
  // silently hits the other otherwise, which is the exact trap the
  // Explore Regimens board's header documents.
  B.children.forEach(c => {
    if (c.y >= Y && c.y <= Y + 470 && c.x >= 140 && c.x <= 900 && c.name.indexOf('anat ') !== 0
        && (c.name.indexOf('card / ') === 0 || c.name.indexOf('c ') === 0 || c.name.indexOf('chip ') === 0)) {
      c.name = 'anat ' + c.name;
    }
  });

  // Callouts are stacked at a FIXED pitch here, then re-stacked off the
  // measured body heights in a second call (see the re-stack snippet at
  // the end of this block) — a fresh auto-height text reports no real
  // .height for ~500 ms and this script runs in one call. The estimate
  // below is deliberately generous; the re-stack tightens it.
  const specs = [
    [14, 'Title', '16 / 700 Archivo, full width. Start keeps a right-hand column; the other five actions do not.'],
    [40, 'Cost line', '@author · 8 exercises · 28 sets, then ~51 min in primary. regimenLoad.js already computes two of the three.'],
    [60, 'Muscle tags', 'Above the description, capped at 4 (MUSCLE_CHIP_CAP). muscle_groups is set on 32 of 33 regimens.'],
    [90, 'Description', '12 / 400, clamped to 2 lines. 31 of 33 regimens carry one.'],
    [140, 'First 3 lifts', 'target_sets and target_reps are populated on every exercise in the database and appear NOWHERE on today\'s card, which draws seven name-only badges instead.'],
    [206, 'Footer', 'One primary (Start), one disclosure (Preview all 8). Edit, publish, make active, share and delete move into ⋯.'],
  ];
  specs.forEach(([dy, label, body], i) => {
    const rowY = AY + dy + 6;
    const labY = Y + 22 + i * 74;
    txt(B, 'spec t / ' + label, label, 602, labY, { size: 11.5, w: 700, color: P.fg });
    txt(B, 'spec d / ' + label, body, 602, labY + 15, { size: 10.5, color: P.mut, width: 232, lh: 1.4 });
    // L-shaped leader from the card row to its label.
    rect(B, 'lead a / ' + label, AX + CARD_W + 6, rowY, 26, 1, { fill: P.border });
    const top = Math.min(rowY, labY + 6), bot = Math.max(rowY, labY + 6);
    rect(B, 'lead b / ' + label, AX + CARD_W + 32, top, 1, Math.max(1, bot - top), { fill: P.border });
    rect(B, 'lead c / ' + label, AX + CARD_W + 32, labY + 6, 38, 1, { fill: P.border });
  });
  // 400 pt wide, under the card — NOT 700, which ran straight through the
  // callout column.
  txt(B, 'anatomy note',
    'Drawn at 358 × 242, radius 12 (radius.lg), 1 px border, no shadow — resting elevation per the two-level rule in '
    + 'CLAUDE.md. Same geometry as the shipped store card, so a regimen looks the same whether you are browsing it or own it.',
    AX, Y + 296, { size: 10.5, color: P.mut, width: 400, lh: 1.45 });

  // ── The ledger ───────────────────────────────────────────────────────
  const LX = 940, LW = 940;
  txt(B, 'ledger heading', 'What the page is built on', LX, Y - 34, { size: 15, w: 700, head: true, ls: 0.4, color: P.fg });
  rect(B, 'ledger panel', LX, Y, LW, 470, { fill: P.bg, r: 14, stroke: P.border });

  const cols = [LX + 24, LX + 384, LX + 494];
  ['Signal the surface renders', 'Populated', 'What it draws today'].forEach((h, i) => {
    txt(B, 'ledger head ' + i, h, cols[i], Y + 18, { size: 9, w: 700, ls: 0.7, tt: 'uppercase', color: P.mut });
  });
  rect(B, 'ledger head rule', LX + 24, Y + 36, LW - 48, 1, { fill: P.border });

  const LEDGER = [
    ['exercises[].name', '33 of 33', 1, 'Seven identical grey badges. No numbers on any of them.'],
    ['exercises[].target_sets', '30 of 30', 1, 'Not on the card. Only inside the accordion.'],
    ['exercises[].target_reps', '30 of 30', 1, 'Same — one tap away from the thing you are choosing between.'],
    ['exercises[].muscle_groups', '32 of 33', 1, 'Below the fold, inside the accordion.'],
    ['description', '31 of 33', 1, 'Two lines, clamped. Correct.'],
    ['exercises[].rest_seconds', '6 of 33', 0, 'Nothing. Feeds the ~min estimate in the proposal.'],
    ['is_active', '4 of 33', 1, 'A 10 px chip, plus one of six identical ghost icons.'],
    ['original_author_username', '2 of 33', 0, 'The "From @x" line. Correct.'],
    ['updated_at > created_at', '0 of 33', -1, 'Nobody has ever edited a regimen. The pencil has never been used.'],
    ['exercises[].notes', '0 of 33', -1, 'A field in the create form that nobody fills.'],
    ['exercises[].group_id', '0 of 33', -1, 'Superset / circuit: a top-level button for a feature never once used.'],
    ['difficulty', '0 of 33', -1, 'Three of the store\'s four level chips can only return an empty list.'],
    ['days (jsonb)', '0 of 33', -1, 'Nothing reads it. A Flexyn regimen is one session, not a week.'],
    ['is_template / template_id', '0 of 33', -1, 'Nothing reads either.'],
    ['copy_count / clone_count', '0 of 33', -1, '"Cloned N times" has never rendered.'],
    ['workout_templates', '0 rows, 0 authors', -1, 'A whole parallel entity behind a top-level button.'],
    ['regimen_reviews', '0 rows', -1, 'The star block never renders.'],
    ['scheduled_workouts', '0 rows', -1, '"Schedule it" exists on the Coach card, never on a regimen.'],
    ['workout_logs.title = regimen.name', '0 of 6', -1, '"Last performed" is not derivable. regimen_id was dropped.'],
  ];
  LEDGER.forEach((row, i) => {
    const ry = Y + 48 + i * 20;
    const dotC = row[2] === 1 ? P.ok : (row[2] === -1 ? P.bad : P.mut);
    rect(B, 'sig dot ' + i, LX + 12, ry + 5, 5, 5, { fill: dotC, r: 3 });
    txt(B, 'sig k ' + i, row[0], cols[0], ry, { size: 10.5, w: 500, color: P.fg, op: 0.88 });
    txt(B, 'sig n ' + i, row[1], cols[1], ry, { size: 10.5, w: 700, color: dotC });
    txt(B, 'sig c ' + i, row[3], cols[2], ry, { size: 10.5, color: P.mut, width: LW - 518 });
  });
  txt(B, 'ledger foot',
    'Queried against production 2026-08-11 — 33 regimens, 28 authors, 6.42 exercises on average, none empty. '
    + 'ELEVEN of these nineteen signals are populated on zero rows, and the page is composed around them: a filter that cannot '
    + 'succeed, a button over an empty table, a counter that has never counted, and an edit affordance nobody has used.',
    LX + 24, Y + 432, { size: 10, color: P.mut, width: LW - 48, lh: 1.45 });
}

// ── RE-STACK THE ANATOMY CALLOUTS (run in a SECOND call) ─────────────
// The 74 pt pitch in group 03 is an estimate — a fresh auto-height text
// reports no real .height for ~500 ms and this script runs in one call.
// Paste this afterwards to tighten it off the measured heights; it is
// what the canvas currently carries. Without it the 56 pt "First 3 lifts"
// body runs into the "Footer" label under it.
/*
const B = penpotUtils.findShape(s => s.name === 'Regimens — proposed' && s.type === 'board', penpot.currentPage.root);
const f = n => penpotUtils.findShape(s => s.name === n, B);
const AX = 170, AY = 1390, CW = 358;
const ITEMS = [[14,'Title'],[40,'Cost line'],[60,'Muscle tags'],[90,'Description'],[140,'First 3 lifts'],[206,'Footer']];
const mk = (n, x, yy, w, h) => { const r = penpot.createRectangle(); r.name = n; r.resize(w, h); r.x = x; r.y = yy;
  r.fills = [{ fillColor: '#2A333B', fillOpacity: 1 }]; r.borderRadius = 0; B.appendChild(r); };
let y = 1382;
ITEMS.forEach(it => {
  const rowY = AY + it[0] + 6;
  const lab = f('spec t / ' + it[1]), body = f('spec d / ' + it[1]);
  lab.y = y; body.y = y + 15;
  ['lead a / ','lead b / ','lead c / '].forEach(p => { const s = f(p + it[1]); if (s) s.remove(); });
  mk('lead a / ' + it[1], AX + CW + 6, rowY, 26, 1);
  const top = Math.min(rowY, y + 6), bot = Math.max(rowY, y + 6);
  mk('lead b / ' + it[1], AX + CW + 32, top, 1, Math.max(1, bot - top));
  mk('lead c / ' + it[1], AX + CW + 32, y + 6, 38, 1);
  y += 15 + Math.round(body.height) + 18;
});
return { listBottom: y };   // 1818 against a panel bottom of 1830
*/

// ═══════════════════════════════════════════════════════════════════════
// 04 · SUBPAGES
// ═══════════════════════════════════════════════════════════════════════
if (PARTS.indexOf('04') !== -1) {
  const Y = 1934, H = 880;
  heading('04', 'Subpages', 140, Y - 34);

  // ── (a) Create / edit a session ─────────────────────────────────────
  {
    const X = 140, L = X + 16, W = 358;
    phone(X, Y, H, 'form');
    rect(B, 'form / header', X, Y, 390, 56, { fill: P.bg });
    rect(B, 'form / header rule', X, Y + 56, 390, 1, { fill: P.border });
    txt(B, 'form / close', '✕', L, Y + 20, { size: 13, w: 600, color: P.mut });
    txt(B, 'form / title', 'New session', L + 26, Y + 18, { size: 16, w: 700, head: true, color: P.fg });
    txt(B, 'form / more', '⋯', X + 352, Y + 18, { size: 16, w: 700, color: P.mut, width: 20, align: 'center' });

    const fl = (label, y, h, ph) => {
      txt(B, 'form / label ' + label, label, L, y, { size: 9, w: 700, ls: 0.7, tt: 'uppercase', color: P.mut });
      rect(B, 'form / field ' + label, L, y + 16, W, h, { fill: P.card, r: 8, stroke: P.border });
      txt(B, 'form / ph ' + label, ph, L + 14, y + 16 + (h > 44 ? 12 : (h - 15) / 2), { size: 12, color: P.mut, op: 0.7, width: W - 28 });
    };
    fl('Name', Y + 80, 40, 'Upper Body Power Day');
    fl('Description', Y + 148, 58, 'What this session is for, and who it suits.');

    txt(B, 'form / ex label', 'Exercises', L, Y + 236, { size: 9, w: 700, ls: 0.7, tt: 'uppercase', color: P.mut });
    rect(B, 'form / add', X + 300, Y + 230, 74, 26, { fill: P.pri, r: 13 });
    txt(B, 'form / add label', '+  Add', X + 300, Y + 237, { size: 10.5, w: 700, color: '#FFFFFF', width: 74, align: 'center' });

    // Three exercise rows. Sets / reps / rest as steppers, because these
    // are the three numbers a session is actually made of and they are
    // populated on every exercise in the database.
    const EX = [
      ['Bench Press', '4', '8', '90 s', ['Chest', 'Triceps']],
      ['Barbell Row', '4', '8', '90 s', ['Back', 'Biceps']],
      ['Overhead Press', '3', '10', '120 s', ['Shoulders']],
    ];
    EX.forEach((e, i) => {
      const ry = Y + 266 + i * 104;
      rect(B, 'form / row ' + e[0], L, ry, W, 94, { fill: P.card, r: 10, stroke: P.border });
      txt(B, 'form / grip ' + e[0], '⠿', L + 12, ry + 13, { size: 12, color: P.mut, op: 0.6 });
      txt(B, 'form / name ' + e[0], e[0], L + 32, ry + 11, { size: 13, w: 600, color: P.fg });
      // Muscle chips sit inline after the name — the row is 94 pt and the
      // steppers plus their labels take everything below it.
      let cx = L + 40 + Math.round(e[0].length * 7.1);
      e[4].forEach(m => { cx += pill(B, m, cx, ry + 11, { key: 'form ' + e[0], h: 17, size: 9, fw: 600, fill: P.sec, color: P.mut, r: 4, px: 6 }) + 4; });
      txt(B, 'form / del ' + e[0], '✕', L + W - 26, ry + 12, { size: 11, color: P.mut, op: 0.7 });
      const st = (label, val, sx) => {
        rect(B, 'form / step ' + e[0] + ' ' + label, sx, ry + 36, 100, 30, { fill: P.sec, r: 8 });
        txt(B, 'form / step- ' + e[0] + ' ' + label, '−', sx + 9, ry + 44, { size: 12, w: 700, color: P.mut });
        txt(B, 'form / step v ' + e[0] + ' ' + label, val, sx, ry + 43, { size: 13, w: 700, color: P.fg, width: 100, align: 'center' });
        txt(B, 'form / step+ ' + e[0] + ' ' + label, '+', sx + 83, ry + 44, { size: 12, w: 700, color: P.mut });
        txt(B, 'form / step l ' + e[0] + ' ' + label, label, sx, ry + 70, { size: 9, w: 600, ls: 0.5, tt: 'uppercase', color: P.mut, width: 100, align: 'center' });
      };
      st('sets', e[1], L + 12);
      st('reps', e[2], L + 122);
      st('rest', e[3], L + 232);
    });

    // Everything nobody uses, collapsed. notes 0 of 33, group_id 0 of 33.
    const dy = Y + 266 + 3 * 104;
    rect(B, 'form / more row', L, dy, W, 38, { fill: null, r: 8, stroke: P.border, dash: true });
    txt(B, 'form / more label', '⌄   More  ·  notes, superset & circuit, per-set rest', L + 14, dy + 13, { size: 10.5, w: 500, color: P.mut });

    // Pinned footer. The volume you are prescribing, visible while you
    // prescribe it — the research applied at the moment of authoring.
    const fy = Y + H - 172;
    rect(B, 'form / footer', X, fy, 390, 172, { fill: P.bg });
    rect(B, 'form / footer rule', X, fy, 390, 1, { fill: P.border });
    txt(B, 'form / foot kicker', 'This session', L, fy + 14, { size: 9, w: 700, ls: 0.7, tt: 'uppercase', color: P.mut });
    txt(B, 'form / foot total', '23 sets  ·  ~43 min', L, fy + 30, { size: 16, w: 700, head: true, color: P.fg });
    txt(B, 'form / foot muscles', 'Chest 8  ·  Back 8  ·  Shoulders 4  ·  Triceps 3', L, fy + 56, { size: 10.5, w: 500, color: P.mut });
    txt(B, 'form / pub label', 'Publish to the community', L, fy + 82, { size: 11, w: 500, color: P.fg });
    rect(B, 'form / pub track', X + 336, fy + 80, 34, 20, { fill: P.sec, r: 10 });
    rect(B, 'form / pub knob', X + 338, fy + 82, 16, 16, { fill: P.mut, r: 8 });
    txt(B, 'form / pub sub', 'Anyone can find it, preview it and adopt it.', L, fy + 100, { size: 9.5, color: P.mut, op: 0.8 });
    rect(B, 'form / cta', L, fy + 122, W, 48, { fill: P.pri, r: 10 });
    txt(B, 'form / cta label', 'Save session', L, fy + 137, { size: 13, w: 700, color: '#FFFFFF', width: W, align: 'center' });

    caption('form', X, Y + H + 22, 400,
      'a · Create / edit a session   (RegimenForm.jsx)',
      'Today this is a max-w-2xl, max-h-[90vh] dialog — a desktop-shaped modal on an app that ships only to phones. '
      + 'Here it is a full-screen sheet on .safe-page insets with a pinned CTA. The footer reads back the volume being '
      + 'prescribed, so a session that gives chest 3 sets and back 14 says so before it is saved. Notes and the '
      + 'superset / circuit builder collapse: both are used by 0 of 33 regimens and both currently share top billing '
      + 'with "Add exercise".');
  }

  // ── (b) Session detail ──────────────────────────────────────────────
  {
    const X = 590, L = X + 16, W = 358;
    phone(X, Y, H, 'detail');
    rect(B, 'det / header', X, Y, 390, 56, { fill: P.bg });
    rect(B, 'det / header rule', X, Y + 56, 390, 1, { fill: P.border });
    txt(B, 'det / back', '‹', L, Y + 18, { size: 17, w: 600, color: P.mut });
    txt(B, 'det / title', 'Upper Body Power Day', L + 20, Y + 19, { size: 15, w: 700, head: true, color: P.fg });
    txt(B, 'det / more', '⋯', X + 352, Y + 18, { size: 16, w: 700, color: P.mut, width: 20, align: 'center' });

    txt(B, 'det / meta', 'from @sjoudrie  ·  7 exercises  ·  23 sets', L, Y + 76, { size: 11, color: P.mut });
    txt(B, 'det / time', '~43 min', L + 210, Y + 76, { size: 11, w: 700, color: P.pri });
    let dx = L;
    ['Chest', 'Back', 'Shoulders', 'Biceps'].forEach(m => {
      dx += pill(B, m, dx, Y + 96, { key: 'det tag', h: 21, size: 10, fw: 600, fill: P.sec, color: P.fg, r: 5, px: 8 }) + 5;
    });
    coverageStrip(B, 'det', L, Y + 136,
      [['Chest', 8], ['Back', 8], ['Shoulders', 4]],
      'What this session trains');
    rect(B, 'det / rule', L, Y + 212, W, 1, { fill: P.border });

    const ROWS = [
      ['Bench Press', '4 × 8', '90 s rest  ·  Chest, Triceps'],
      ['Barbell Row', '4 × 8', '90 s rest  ·  Back, Biceps'],
      ['Overhead Press', '3 × 10', '120 s rest  ·  Shoulders'],
      ['Pull-Up', '4 × 8', '90 s rest  ·  Back, Biceps'],
      ['Dumbbell Curl', '3 × 12', '60 s rest  ·  Biceps'],
      ['Tricep Dip', '3 × 12', '60 s rest  ·  Triceps'],
      ['Lateral Raise', '2 × 15', '45 s rest  ·  Shoulders'],
    ];
    ROWS.forEach((r, i) => {
      const ry = Y + 228 + i * 62;
      rect(B, 'det / num ' + r[0], L, ry + 2, 24, 24, { fill: P.pri, op: 0.14, r: 6 });
      txt(B, 'det / num v ' + r[0], String(i + 1), L, ry + 9, { size: 11, w: 700, color: P.pri, width: 24, align: 'center' });
      txt(B, 'det / name ' + r[0], r[0], L + 34, ry + 2, { size: 13, w: 600, color: P.fg });
      txt(B, 'det / load ' + r[0], r[1], L, ry + 2, { size: 12.5, w: 700, color: P.fg, op: 0.9, width: W, align: 'right' });
      txt(B, 'det / sub ' + r[0], r[2], L + 34, ry + 21, { size: 10, color: P.mut });
      txt(B, 'det / how ' + r[0], 'How to  ›', L + 34, ry + 37, { size: 10, w: 600, color: P.pri, op: 0.85 });
      if (i < ROWS.length - 1) rect(B, 'det / row rule ' + r[0], L + 34, ry + 56, W - 34, 1, { fill: P.border, so: 0.5 });
    });

    const fy2 = Y + H - 92;
    rect(B, 'det / footer', X, fy2, 390, 92, { fill: P.bg });
    rect(B, 'det / footer rule', X, fy2, 390, 1, { fill: P.border });
    rect(B, 'det / edit', L, fy2 + 22, 108, 48, { fill: P.card, r: 10, stroke: P.border });
    txt(B, 'det / edit label', 'Edit', L, fy2 + 37, { size: 12.5, w: 600, color: P.fg, width: 108, align: 'center' });
    rect(B, 'det / start', L + 118, fy2 + 22, W - 118, 48, { fill: P.pri, r: 10 });
    txt(B, 'det / start label', 'Start session', L + 118, fy2 + 37, { size: 13, w: 700, color: '#FFFFFF', width: W - 118, align: 'center' });

    caption('detail', X, Y + H + 22, 400,
      'b · Session detail   (RegimenDetailView.jsx)',
      'Today this expands INSIDE the card, pushing the rest of the library down the page — so reading one session costs you '
      + 'the view of the others. As a sheet it gets the full column, the numbers get room, and the per-exercise "How to" '
      + 'disclosure is kept exactly as it is: reading a saved regimen is the calm moment to find out a lift is unfamiliar. '
      + 'The coverage strip is the same component as the library\'s, scoped to one session.');
  }

  // ── (c) Empty — start from a program ────────────────────────────────
  {
    const X = 1040, L = X + 16, W = 358;
    phone(X, Y, H, 'empty');
    txt(B, 'emp / title', 'Regimens', L, Y + 20, { size: 20, w: 700, head: true, color: P.fg });
    txt(B, 'emp / sub', 'Nothing saved yet', L, Y + 48, { size: 11, color: P.mut });
    txt(B, 'emp / lead', 'Pick a program and Flexyn builds its sessions for you. You can edit every one afterwards.',
      L, Y + 80, { size: 12.5, w: 500, color: P.fg, op: 0.9, width: W, lh: 1.45 });

    const PROGRAMS = [
      ['Starting Strength', 'beginner', '3 days a week  ·  creates 2 sessions', 'Linear progression for true beginners.'],
      ['Upper / Lower', 'beginner', '4 days a week  ·  creates 4 sessions', 'Classic 4-day split, beginner-friendly volume.'],
      ['Push / Pull / Legs', 'intermediate', '6 days a week  ·  creates 3 sessions', 'Classic 6-day hypertrophy split.'],
      ['5/3/1 (Wendler)', 'intermediate', '4 days a week  ·  creates 4 sessions', '4-week wave loading on the big 4 lifts.'],
      ['GZCLP', 'intermediate', '4 days a week  ·  creates 4 sessions', 'GZCL linear progression for hardgainers.'],
      ['nSuns 5/3/1 LP', 'advanced', '5 days a week  ·  creates 5 sessions', 'High-frequency, high-volume 5/3/1.'],
    ];
    const LEVEL = { beginner: P.ok, intermediate: P.pri, advanced: P.bad };
    PROGRAMS.forEach((p, i) => {
      const py = Y + 138 + i * 84;
      rect(B, 'emp / prog ' + p[0], L, py, W, 74, { fill: P.card, r: 10, stroke: P.border });
      txt(B, 'emp / prog name ' + p[0], p[0], L + 14, py + 12, { size: 13, w: 700, head: true, color: P.fg });
      pill(B, p[1], L + 14 + Math.round(p[0].length * 7.2) + 10, py + 12, {
        key: 'level ' + p[0], h: 17, size: 8.5, fw: 700, tt: 'uppercase', ls: 0.6, fill: LEVEL[p[1]], op: 0.16, color: LEVEL[p[1]], r: 4, px: 6,
      });
      txt(B, 'emp / prog days ' + p[0], p[2], L + 14, py + 32, { size: 10.5, w: 600, color: P.mut });
      txt(B, 'emp / prog sum ' + p[0], p[3], L + 14, py + 50, { size: 10.5, color: P.mut, op: 0.75, width: W - 44 });
      txt(B, 'emp / prog chev ' + p[0], '›', L + W - 26, py + 28, { size: 13, w: 700, color: P.mut });
    });

    const ey = Y + 138 + 6 * 84 + 10;
    rect(B, 'emp / own', L, ey, 174, 44, { fill: P.card, r: 10, stroke: P.border });
    txt(B, 'emp / own label', 'Build my own', L, ey + 15, { size: 11.5, w: 600, color: P.fg, width: 174, align: 'center' });
    rect(B, 'emp / browse', L + 184, ey, 174, 44, { fill: P.card, r: 10, stroke: P.border });
    txt(B, 'emp / browse label', 'Browse community', L + 184, ey + 15, { size: 11.5, w: 600, color: P.fg, width: 174, align: 'center' });

    caption('empty', X, Y + H + 22, 400,
      'c · Empty — start from a program   (ProgramTemplatePicker.jsx)',
      'The six built-in programs currently sit UNDER a dashed "no regimens yet" box, as a consolation prize. They are the '
      + 'fastest path from nothing to a real plan, so they lead. Each says how many sessions it will create, because '
      + 'picking Push / Pull / Legs creates three regimens, not one — handlePick already does this and the card has never '
      + 'said so. The level pill uses the app\'s existing success / primary / destructive hues; no new colour.');
  }

  // ── (d) Three browsers become one ───────────────────────────────────
  {
    const X = 1490, L = X + 24, W = 342;
    rect(B, 'merge panel', X, Y, 390, H, { fill: P.bg, r: 18, stroke: P.border });
    txt(B, 'merge / title', 'Three browsers become one', L, Y + 26, { size: 16, w: 700, head: true, color: P.fg, width: W });
    txt(B, 'merge / sub',
      'The library offers three ways into other people\'s programs. Two of them read the same four rows; the third reads a table with no rows in it.',
      L, Y + 56, { size: 11, color: P.mut, width: W, lh: 1.45 });

    const SURFACES = [
      ['Templates', 'TemplatesModal.jsx  ·  dialog', 'workout_templates', '0 rows, 0 authors', 'Delete', P.bad,
        'A separate entity with its own create form, share-to-Hub flow and public toggle. Nobody has ever made one.'],
      ['Browse Templates', 'RegimenTemplateStore.jsx  ·  dialog', 'regimens.listPublic()', 'the same 4 programs', 'Delete', P.bad,
        'A second, older browser over the identical query as the full-page store one level up. Two designs, one dataset.'],
      ['Explore Regimens', 'RegimenStorePage.jsx  ·  full page', 'regimens.listPublic()', '4 programs', 'Keep', P.ok,
        'Already redesigned and shipped (67f2feb3). This is the browser. The library links to it from a row at the foot of the sessions list.'],
    ];
    SURFACES.forEach((s, i) => {
      const sy = Y + 130 + i * 186;
      rect(B, 'merge / card ' + s[0], L, sy, W, 168, { fill: P.card, r: 10, stroke: P.border });
      rect(B, 'merge / accent ' + s[0], L, sy, 3, 168, { fill: s[5] });
      txt(B, 'merge / name ' + s[0], s[0], L + 16, sy + 14, { size: 13, w: 700, head: true, color: P.fg });
      pill(B, s[4], L + W - 74, sy + 13, { key: 'verdict ' + s[0], h: 19, size: 9, fw: 700, tt: 'uppercase', ls: 0.6, fill: s[5], op: 0.16, color: s[5], r: 4, px: 8 });
      txt(B, 'merge / src ' + s[0], s[1], L + 16, sy + 34, { size: 10, color: P.mut, op: 0.8 });
      rect(B, 'merge / rule ' + s[0], L + 16, sy + 54, W - 32, 1, { fill: P.border });
      txt(B, 'merge / reads ' + s[0], 'Reads', L + 16, sy + 66, { size: 9, w: 700, ls: 0.6, tt: 'uppercase', color: P.mut });
      txt(B, 'merge / readsv ' + s[0], s[2], L + 16, sy + 80, { size: 11, w: 600, color: P.fg, op: 0.9 });
      txt(B, 'merge / rows ' + s[0], 'Behind it today', L + 16, sy + 100, { size: 9, w: 700, ls: 0.6, tt: 'uppercase', color: P.mut });
      txt(B, 'merge / rowsv ' + s[0], s[3], L + 16, sy + 114, { size: 11, w: 700, color: s[5] });
      txt(B, 'merge / why ' + s[0], s[6], L + 16, sy + 134, { size: 10, color: P.mut, width: W - 32, lh: 1.4 });
    });

    txt(B, 'merge / foot',
      'Net effect on the header: three buttons become one "+ New", and the way to other people\'s programs moves below the '
      + 'goods rather than above them. Nothing is lost — the surviving browser is the one that was redesigned.',
      L, Y + 130 + 3 * 186 + 8, { size: 10.5, color: P.mut, width: W, lh: 1.45 });

    caption('merge', X, Y + H + 22, 400,
      'd · What happens to the three top buttons',
      'Queried 2026-08-11. workout_templates: 0 rows across the whole database, and its data layer '
      + '(src/lib/data/templates.js) carries a careful comment about stripping weights from templates that has never once run.');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 05 · STATES
// The page differs between states only at the top, so only the top is
// drawn. Each frame is the header + the active band + the coverage strip.
// ═══════════════════════════════════════════════════════════════════════
if (PARTS.indexOf('05') !== -1) {
  const Y = 3004, H = 470;
  heading('05', 'States', 140, Y - 34);

  const stateHeader = (X, sub) => {
    const L = X + 16;
    txt(B, 'st / title ' + X, 'Regimens', L + 20, Y + 18, { size: 20, w: 700, head: true, color: P.fg });
    txt(B, 'st / back ' + X, '‹', L, Y + 20, { size: 17, w: 600, color: P.mut });
    txt(B, 'st / sub ' + X, sub, L + 20, Y + 46, { size: 11, color: P.mut });
    rect(B, 'st / new ' + X, X + 306, Y + 20, 68, 28, { fill: P.pri, r: 14 });
    txt(B, 'st / new label ' + X, '+  New', X + 306, Y + 28, { size: 11, w: 700, color: '#FFFFFF', width: 68, align: 'center' });
  };

  // (a) Nothing saved — the band is not drawn empty, it is not drawn.
  {
    const X = 140, L = X + 16;
    phone(X, Y, H, 'state empty');
    stateHeader(X, 'Nothing saved yet');
    rect(B, 'st a / lead', L, Y + 90, 358, 108, { fill: P.card, r: 12, stroke: P.border, dash: true });
    txt(B, 'st a / lead t', 'Start from a program', L + 20, Y + 116, { size: 14, w: 700, head: true, color: P.fg });
    txt(B, 'st a / lead b', 'Six proven programs. Pick one and Flexyn builds its sessions — you can edit every one after.',
      L + 20, Y + 138, { size: 11, color: P.mut, width: 318, lh: 1.45 });
    rect(B, 'st a / cta', L + 20, Y + 168, 150, 34, { fill: P.pri, r: 8 });
    txt(B, 'st a / cta l', 'Choose a program', L + 20, Y + 178, { size: 11, w: 700, color: '#FFFFFF', width: 150, align: 'center' });
    txt(B, 'st a / note',
      'No active band, no coverage strip, no empty chart. A surface with no data must not render as zeros — a coverage strip '
      + 'of six greyed-out "0 sets" is the app telling someone they have failed at something they never started.',
      L, Y + 224, { size: 10.5, color: P.mut, width: 358, lh: 1.45 });
    caption('state a', X, Y + H + 22, 400, 'a · Nothing saved',
      'The programs take the slot the active plan would hold. This is the only state where the empty case is the whole page.');
  }

  // (b) Sessions, none active.
  {
    const X = 590, L = X + 16;
    phone(X, Y, H, 'state noactive');
    stateHeader(X, '6 sessions  ·  no active plan');
    const ab = Y + 76;
    rect(B, 'st b / band', X, ab, 390, 96, { fill: P.card2 });
    rect(B, 'st b / band top', X, ab, 390, 1, { fill: P.border });
    rect(B, 'st b / band bot', X, ab + 96, 390, 1, { fill: P.border });
    rect(B, 'st b / accent', X, ab, 3, 96, { fill: P.mut, op: 0.5 });
    txt(B, 'st b / kicker', 'No active plan', L, ab + 16, { size: 9.5, w: 700, ls: 0.8, tt: 'uppercase', color: P.mut });
    txt(B, 'st b / title', 'Pick the one you\'re running', L, ab + 34, { size: 16, w: 700, head: true, color: P.fg });
    txt(B, 'st b / body', 'It goes to the top of this page and the Dashboard\'s Today card reads from it.',
      L, ab + 58, { size: 10.5, color: P.mut, width: 250, lh: 1.4 });
    rect(B, 'st b / choose', X + 272, ab + 30, 92, 34, { fill: P.card, r: 8, stroke: P.pri, so: 0.6 });
    txt(B, 'st b / choose l', 'Choose', X + 272, ab + 40, { size: 11, w: 700, color: P.pri, width: 92, align: 'center' });
    coverageStrip(B, 'st b', L, ab + 128,
      [['Chest', 12], ['Back', 16], ['Shoulders', 11], ['Legs', 9], ['Arms', 14], ['Core', 4]],
      'Sets per muscle  ·  one pass through your library');
    caption('state b', X, Y + H + 22, 400, 'b · No active plan',
      'The band never renders empty and never disappears — it becomes the prompt. is_active is set on only 4 of 33 rows '
      + 'today, so this is the state most users are in, and the current UI gives them no reason to leave it.');
  }

  // (c) Coverage out of range.
  {
    const X = 1040, L = X + 16;
    phone(X, Y, H, 'state coverage');
    stateHeader(X, '9 sessions  ·  1 active');
    const ab = Y + 76;
    rect(B, 'st c / band', X, ab, 390, 76, { fill: P.card2 });
    rect(B, 'st c / band top', X, ab, 390, 1, { fill: P.border });
    rect(B, 'st c / band bot', X, ab + 76, 390, 1, { fill: P.border });
    rect(B, 'st c / accent', X, ab, 3, 76, { fill: P.pri });
    txt(B, 'st c / kicker', 'Active plan', L, ab + 12, { size: 9.5, w: 700, ls: 0.8, tt: 'uppercase', color: P.pri });
    txt(B, 'st c / title', 'Back & Shoulders Builder', L, ab + 28, { size: 16, w: 700, head: true, color: P.fg });
    txt(B, 'st c / meta', '8 exercises  ·  28 sets  ·  ~51 min', L, ab + 54, { size: 11, color: P.mut });
    rect(B, 'st c / start', X + 288, ab + 22, 76, 32, { fill: P.pri, r: 8 });
    txt(B, 'st c / start l', 'Start', X + 288, ab + 31, { size: 11.5, w: 700, color: '#FFFFFF', width: 76, align: 'center' });

    coverageStrip(B, 'st c', L, ab + 108,
      [['Chest', 13], ['Back', 24], ['Shoulders', 18], ['Legs', 4], ['Arms', 16], ['Core', 6]],
      'Sets per muscle  ·  one pass through your library');
    txt(B, 'st c / read',
      'Back is over the range and legs are barely trained. One sentence, no chart: "Back 24 is above the 10–20 range; '
      + 'legs at 4 is under it."',
      L, ab + 244, { size: 10.5, w: 500, color: P.fg, op: 0.9, width: 358, lh: 1.45 });
    caption('state c', X, Y + H + 22, 400, 'c · Coverage out of range',
      'The bar colour is the whole feature: orange under 10, green 10–20, red over 20. This is the one thing on the page '
      + 'that tells someone their library is unbalanced, and it is derived from two columns that are already populated.');
  }

  // Not-drawn note.
  {
    const X = 1490;
    rect(B, 'notdrawn panel', X, Y, 390, H, { fill: P.bg, r: 18, stroke: P.border });
    txt(B, 'notdrawn / title', 'Deliberately not drawn', X + 24, Y + 24, { size: 16, w: 700, head: true, color: P.fg });
    // Copy is deliberately short: six items have 402 pt of panel between
    // them. A longer version of this list overflowed the panel.
    const ND = [
      ['Last performed', 'Not derivable: workout_logs.regimen_id was dropped, and 0 of 6 log titles match a regimen name. Needs a column first.'],
      ['A weekly volume number', 'scheduled_workouts is 0 rows. No schedule, no "per week" — hence "one pass through your library".'],
      ['Difficulty', 'NULL on 33 of 33, and the create form has no field for it. It comes back as a FIELD or not at all.'],
      ['RIR / RPE targets', 'The strongest single addition to a prescription, and there is no column for it.'],
      ['Ratings on your own regimens', 'regimen_reviews is 0 rows, and stars on a library you own mean nothing anyway.'],
      ['Progression', 'target_sets and target_reps never move. Making them progress is a feature, not a redesign.'],
    ];
    let ny = Y + 56;
    ND.forEach(([t, b]) => {
      rect(B, 'nd dot / ' + t, X + 24, ny + 5, 5, 5, { fill: P.mut, r: 3 });
      txt(B, 'nd t / ' + t, t, X + 38, ny, { size: 11.5, w: 700, color: P.fg });
      txt(B, 'nd b / ' + t, b, X + 38, ny + 15, { size: 10, color: P.mut, width: 320, lh: 1.45 });
      ny += 15 + Math.max(1, Math.ceil(b.length / 58)) * 15 + 16;
    });
    caption('notdrawn', X, Y + H + 22, 400, 'd · What this board refuses to invent',
      'Every one of these would improve the card. None of them can be drawn from what the database holds today.');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 06 · WHAT CHANGED, AND WHY
// ═══════════════════════════════════════════════════════════════════════
if (PARTS.indexOf('06') !== -1) {
  const Y = 3664;
  heading('06', 'What changed, and why', 140, Y - 34);
  rect(B, 'why panel', 140, Y, 1740, 960, { fill: P.card, r: 14 });

  const ROWS = [
    ['One plan is promoted, not chipped',
      'is_active is set on 4 of 33 regimens and renders today as a 10 px "Active" chip beside the title plus one of six identical ghost icons. '
      + 'The plan you are actually running gets the page\'s one dominant element and its one bleed; everything else is a library beneath it.',
      'CLAUDE.md: one dominant element per screen, and only it may bleed. Today nothing on this page is dominant — every card is the same card.'],
    ['Six unlabelled icons become one overflow',
      'View, edit, publish, make active, share and delete sit at equal size and equal weight in one row. One of them publishes to the world and one deletes. '
      + 'Start stays a button; the rest move into ⋯.',
      'updated_at = created_at on 33 of 33 rows — nobody has ever edited a regimen, so the pencil has never earned its slot at the top level.'],
    ['Three top buttons become one',
      '"Templates" opens workout_templates. "Browse Templates" opens a dialog over the same listPublic() as the full-page Explore Regimens store one level up. '
      + 'Left: "+ New", with the community as a row at the foot of the list.',
      'workout_templates: 0 rows, 0 authors, whole database. The two regimen browsers return the identical four programs.'],
    ['The card carries numbers, not name badges',
      'Today the exercises are seven grey pills — the same treatment on every card, with no sets, no reps and no load. Proposed: the first three lifts with their '
      + 'prescriptions, plus a cost line of exercises, sets and an estimated duration.',
      'target_sets and target_reps are populated on 30 of 30 exercises across the public programs and appear nowhere on the card. '
      + 'src/lib/regimenLoad.js already computes the sets and the minutes — it shipped with the store redesign.'],
    ['Muscle tags move above the description',
      'They are the one line that separates "Legs & Core Destroyer" from "Back & Shoulders Builder". Today they are not on the card at all — they are inside the accordion.',
      'muscle_groups populated on 32 of 33 regimens. Capped at 4 chips, the same MUSCLE_CHIP_CAP the shipped store card uses.'],
    ['Sets per muscle is the one new thing, and it costs no new column',
      'Σ target_sets grouped by muscle_groups, drawn against the 10–20 weekly working range. Orange under, green in range, red over. It is the only thing on this page '
      + 'that can tell someone their library is unbalanced.',
      'Both inputs are already populated. One new pure function, setsPerMuscle(), beside totalSets() in regimenLoad.js. No column, no backfill, no author input.'],
    ['It says "one pass through your library", not "per week"',
      'A weekly number needs a schedule and there is not one. The strip states what it is counting and offers scheduling as the way to earn the weekly version.',
      'scheduled_workouts: 0 rows. schedule_workout() exists (mig 276) and is wired to the Coach plan card only — never to a regimen.'],
    ['The create form becomes a full-screen sheet',
      'It is a max-w-2xl, max-h-[90vh] dialog on an app that ships only to iOS and Android. Full-screen, .safe-page insets, pinned CTA, and a footer that reads back '
      + 'the volume being prescribed while it is being prescribed.',
      'The footer readout is the same setsPerMuscle() call as the library strip. A session that gives chest 3 sets and back 14 says so before it is saved.'],
    ['Notes and the superset builder collapse',
      'Both currently share top billing with "Add exercise". They stay — the grouping feature is good — but behind one disclosure.',
      'exercises[].notes: 0 of 33. exercises[].group_id: 0 of 33. Neither has been used once since either shipped.'],
    ['The empty state leads with the six programs',
      'They sit under a dashed "no regimens yet" box today, as a consolation prize. They are the fastest path from nothing to a real plan, so they go first — '
      + 'and each says how many sessions it will create.',
      'handlePick already creates one regimen per session (Push / Pull / Legs makes three, Starting Strength makes two) and the card has never said so.'],
    ['Session detail becomes a sheet, not an accordion',
      'Reading one session currently pushes the rest of the library down the page. The per-exercise "How to" panel is kept exactly as it is.',
      'Unchanged on purpose: reading a saved regimen is the calm moment to find out a lift is unfamiliar, before you are stood in front of a rack.'],
  ];

  // The panel is 1660 pt wide, so a 250-character line is one row at
  // 11.5 / 275 at 10.5. Estimating at 150 / 165 doubled every row and
  // pushed the close line 270 pt past the panel.
  let ry = Y + 26;
  ROWS.forEach(([t, w, e]) => {
    rect(B, 'why dot / ' + t, 164, ry + 5, 6, 6, { fill: P.pri, r: 3 });
    txt(B, 'why t / ' + t, t, 182, ry, { size: 12.5, w: 700, color: P.fg });
    const wLines = Math.max(1, Math.ceil(w.length / 250));
    txt(B, 'why w / ' + t, w, 182, ry + 18, { size: 11.5, color: P.mut, width: 1660, lh: 1.5 });
    const eLines = Math.max(1, Math.ceil(e.length / 275));
    txt(B, 'why e / ' + t, e, 182, ry + 18 + wLines * 18 + 4, { size: 10.5, color: P.ok, width: 1660, lh: 1.5 });
    ry += 18 + wLines * 18 + 4 + eLines * 17 + 22;
  });

  txt(B, 'why close',
    'Nothing here is a taste argument. Every change either removes a signal that cannot render, promotes one that is populated on every row and currently hidden, '
    + 'or derives a new one from two columns the database already has. The one thing this board wants that does not exist yet — "last performed" — is named in 05d '
    + 'and deliberately not drawn.',
    182, ry + 6, { size: 11, w: 500, color: P.fg, op: 0.85, width: 1660, lh: 1.5 });
}

return {
  board: BOARD_NAME,
  parts: PARTS,
  children: B.children.length,
  note: 'Containment / stacking checks report false strays in the SAME call that draws them — a fresh auto-height text has no real bounds for ~500 ms. Re-check in a separate call.',
};
