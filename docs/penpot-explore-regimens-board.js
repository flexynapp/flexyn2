/* eslint-disable */
//
// docs/penpot-explore-regimens-board.js
//
// Builds the board `Explore Regimens — proposed` on the Penpot page
// "Explore Regimens". Proposes a new UI for the in-app regimen store
// (`src/components/regimens/RegimenStorePage.jsx`), which is what the
// "Explore Regimens" button on /workout opens.
//
// WHY THIS IS A FILE AND NOT A TOOL CALL: the plugin bridge died halfway
// through the build on 2026-08-11 — `high_level_overview` kept returning
// instantly while `execute_code` timed out, which isolates it to the
// SERVER→PLUGIN hop rather than the relay, exactly as the heat-map
// script's header describes. Groups 01 and 02 had already landed; 03/04/05
// had not. So this follows the Achievements / Journal / Heat-map pattern:
// self-contained and idempotent, pasted into `execute_code` in one go
// after a reconnect.
//
// It is SAFE TO RE-RUN. It deletes any board of the same name first, so a
// half-built board from a timed-out call is cleaned up rather than
// double-drawn. Do not try to resume it mid-board.
//
// IF IT TIMES OUT: set PARTS below to a subset and paste again. The five
// groups are independent and each re-runs from scratch. 'shell' both
// creates the board and WIPES any existing one, so it goes in the first
// slice and no other:
//     ['shell','01','02']   then   ['03','04']   then   ['05']
// A slice without 'shell' appends to the board already on the page, and
// bails with a message if there isn't one. Nothing else has to change.
//
// BEFORE PASTING: open the page "Explore Regimens" in the Penpot UI. The
// script bails with a message rather than switching pages itself —
// `openPage()` is async and asserting `currentPage` on the next line is a
// race that has cost a 22-child board before.
//
// ── Idiom: SLOTS, not resolved ───────────────────────────────────────
// This board is a PROPOSAL, not a record of a shipped composition. Group
// 01 is the current page drawn from its own Tailwind classes; 02 is the
// proposal; 03 specs the card; 04 draws the states the proposal has to
// survive; 05 is the ledger. Kegan composes the final UI from this — per
// the standing rule, the design that ships is his, not the one an agent
// invented.
//
// ── Provenance of every number on this board ─────────────────────────
// QUERIED against production on 2026-08-11 (public regimens only, n=4):
//     copy_count      0 on 4 of 4      max(copy_count) = 0
//     difficulty      NULL on 4 of 4
//     regimen_reviews 0 rows, all four
//     description     4 of 4, 152–177 chars
//     target_sets     30 of 30 exercises      23–28 sets per program
//     rest_seconds    30 of 30 exercises      90–120 s
//     est. duration   43–51 min, = Σ sets × (rest + 40 s) − the trailing rest
//   The four programs, with their real first three lifts:
//     Back & Shoulders Builder  8 ex  28 sets  ~51 min
//        Pull-Up 4×8 · Barbell Row 4×10 · Lat Pulldown 3×12
//     Legs & Core Destroyer     8 ex  27 sets  ~51 min
//        Squat 4×8 · Romanian Deadlift 4×10 · Leg Press 3×12
//     Full Body Strength        7 ex  23 sets  ~51 min
//        Squat 4×6 · Deadlift 4×5 · Bench Press 3×6
//     Upper Body Power Day      7 ex  23 sets  ~43 min
//        Bench Press 4×8 · Barbell Row 4×8 · Overhead Press 3×10
// READ FROM SOURCE (RegimenStorePage.jsx): every padding, radius, font
// size, colour role and chip vocabulary in group 01.
// MEASURED on 2026-08-11, in a Vite stub-alias render harness at 390 pt,
// against the four real rows: 371 pt of chrome above the first regimen
// card before, 109 pt after; card 190 pt before, 285 pt after.
//
// The first draft of this board DERIVED those from the Tailwind classes
// and said so — 324 → 96, card 150 → 242 — and every one of the four was
// optimistic. Adding up a stack of margins under-counts what a browser
// actually lays out, reliably and in the flattering direction. The
// caveat on the board was doing real work; the lesson is that the fix is
// to render it, not to derive more carefully.
//
// ── The 40 s in the duration estimate ────────────────────────────────
// `Σ sets × (rest_seconds + 40)` assumes 40 s of work per set. That is an
// assumption, not data, and it is the only invented number on the board.
// It is stated on the board as `~51 min` with the tilde for that reason.
// If it ships, put the constant in one place and name it — do not inline
// 40 at the call site.
//
// ── PATCHING THE NUMBERS ON A BOARD THAT IS ALREADY DRAWN ────────────
// The measured figures landed after the board was on the canvas. Running
// this whole script re-draws it, which is fine — it is idempotent. If you
// only want the numbers corrected in place, paste THIS into execute_code
// instead; it is a few text edits and touches nothing else.
/*
const B = penpotUtils.findShape(s => s.name === 'Explore Regimens — proposed' && s.type === 'board', penpot.currentPage.root);
if (!B) return 'board not found — open the Explore Regimens page';
const f = n => penpotUtils.findShape(s => s.name === n, B);
const set = (name, chars) => { const sh = f(name); if (sh) { sh.characters = chars; return 1; } return 0; };
const done = {};

done.bracket1 = set('bracket / label', '371 pt');
done.bracket2 = set('bracket2 / label', '109 pt');
done.chrome   = set('led t / Chrome before the first regimen: 324 pt → 96 pt',
                    'Chrome before the first regimen: 371 pt → 109 pt');
done.evidence = set('led e / Chrome before the first regimen: 324 pt → 96 pt',
                    'MEASURED 2026-08-11 at 390 pt in a render harness, against the four real rows. '
                  + 'This board first carried 324 → 96, derived from the Tailwind classes; both were optimistic. Shipped in 67f2feb3.');
done.trade    = set('led t / The trade, stated: the card grows 150 → 242 pt',
                    'The trade, stated: the card grows 190 → 285 pt');
done.tradeWhy = set('led w / The trade, stated: the card grows 150 → 242 pt',
                    'About 2.3 cards fit a screen instead of 3.5, measured at 390 × 800. With four programs in the store that is the '
                  + 'right side of the trade — the scroll was never the constraint, the emptiness was. Revisit past roughly 20 regimens, '
                  + 'which is also the point at which the ranking signals start to mean something and state (c) becomes the default.');
done.anatomy  = set('anatomy note',
                    'Drawn here at 358 × 242. AS BUILT it measures 285 tall — this drawing is the proposal, not the shipped card. '
                  + 'Radius 12, 1 px border, no shadow (resting elevation), padding 16. Grew from a measured 190 pt — see the trade at the end of 05.');
done.costSpec = set('spec d / Cost line',
                    '@author · 8 exercises · 28 sets, then ~51 min in primary. All four numbers come from columns populated on every row.');
done.restRow  = set('sig c 8', 'Not used. Gives ~43–51 min per session.');

// These two were MISSED by the first version of this patch. The tool
// call reported 14 of 14 edits applied and the board still carried
// "~52 min" and "44–52" in the ledger — the count only ever proves the
// shapes it was ASKED for were found. Re-scan the board's text for the
// stale values afterwards; that is what caught these.
done.timeWhy = set('led w / Time and volume replace difficulty as the deciding signal',
  'The question a browser actually has is "can I fit this today?". target_sets and rest_seconds are set on every exercise '
  + 'in the store, so ~51 min and 28 sets are derivable right now — no new column, no backfill, no author input.');
done.timeEvidence = set('led e / Time and volume replace difficulty as the deciding signal',
  'target_sets and rest_seconds populated on 30 of 30 exercises across the 4 programs. Range 23–28 sets, 43–51 min. '
  + 'The 40 s of work per set inside that estimate is an assumption, not data — hence the tilde. Shipped as '
  + 'src/lib/regimenLoad.js, which also deducts the rest after the final set; that is why these are a minute under the '
  + 'figures this board first carried.');

// The four durations on the drawn cards. The shipped helper deducts the
// rest after the final set, which the board's SQL-derived figures did not.
const MIN = { 'Back & Shoulders Builder': 51, 'Legs & Core Destroyer': 50 };
done.times = penpotUtils.findShapes(sh => sh.name.indexOf('c time / ') === 0, B)
  .map(sh => { const m = MIN[sh.name.slice(9)]; if (m) { sh.characters = '~' + m + ' min'; return 1; } return 0; })
  .reduce((a, b) => a + b, 0);

return done;
*/
//
// ── A containment check run in the SAME call reports false strays ─────
// `penpotUtils.isContainedIn` reads a text's bounds, and a freshly
// created auto-height / auto-width text does not report real ones for
// ~500 ms. Checking group 05 at the end of the call that drew it flagged
// all 27 of its texts as outside the board; the same check in the NEXT
// call returned zero. Validate containment in a separate call, or the
// result is noise.
//
// ── RE-STACKING THE LEDGER (if a row collides with the next) ──────────
// Group 05's rows are stacked on an ESTIMATED height, because a freshly
// created auto-height text does not report a real `.height` for ~500 ms
// and this script runs in one call. If anything overlaps, run this in a
// SECOND call to re-stack off the real measured heights:
/*
const b = penpotUtils.findShape(s => s.name === 'Explore Regimens — proposed' && s.type === 'board', penpot.currentPage.root);
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

const BOARD_NAME = 'Explore Regimens — proposed';
const ALLOWED_PAGES = ['Explore Regimens'];

// Which groups to draw. Trim this if the call times out — see the header.
const PARTS = ['shell', '01', '02', '03', '04', '05'];

// ── Guard rails ───────────────────────────────────────────────────────
const page = penpot.currentPage;
if (!page) return 'No current page.';
if (ALLOWED_PAGES.indexOf(page.name) === -1) {
  return `Current page is "${page.name}". Open "Explore Regimens" in the Penpot UI and re-run — this script will not switch pages for you.`;
}

// Idempotency. `remove()` only works on the ACTIVE page, which is the
// other reason for the guard above. A slice run (no 'shell') appends to
// the board that is already there.
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
  bad:    '#E5484D',   // --destructive (light value; used as an ink here)
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
//
// `o.key` disambiguates the SHAPE NAME only — the label is what renders.
// The two must stay separate: the same word appears as a filter chip and
// as a card tag on this board, and a shared name means a later
// findShape() edit silently hits the wrong one. That already happened
// once here — a patch aimed at two card tags renamed the "Back" and
// "Shoulders" filter chips instead, on the reference drawing of the
// current page.
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

// ── The proposed card ─────────────────────────────────────────────────
// 358 × 242, radius 12 (radius.lg), 1 px border, no shadow — resting
// elevation per the two-level rule in CLAUDE.md.
//
// Order of the rows is the whole argument: what DIFFERS between the four
// programs comes before what they share. Muscle tags sit above the
// description; the cost line (exercises · sets · minutes) sits above
// both, because "can I fit this today?" is the question a browser has.
const CARD_W = 358, CARD_H = 242;
const card = (parent, x, y, d) => {
  rect(parent, 'card / ' + d.name, x, y, CARD_W, CARD_H, { fill: P.card, r: 12, stroke: P.border });

  // Title — full width. Nothing shares the line, unlike today's card
  // where an Adopt button and a Preview toggle take a right-hand column.
  txt(parent, 'c title / ' + d.name, d.name, x + 16, y + 14, { size: 16, w: 700, head: true, color: P.fg });
  if (d.badge) {
    pill(parent, d.badge, x + 16 + Math.round(d.name.length * 8.6) + 8, y + 16, {
      key: 'badge ' + d.name, h: 18, size: 9, fw: 700, tt: 'uppercase', ls: 0.6, fill: P.pri, color: '#FFFFFF', r: 9, px: 7,
    });
  }

  // Cost line. Every number here is populated on every row today.
  const meta = d.author + '  ·  ' + d.ex + ' exercises  ·  ' + d.sets + ' sets';
  txt(parent, 'c meta / ' + d.name, meta, x + 16, y + 38, { size: 11, color: P.mut });
  txt(parent, 'c time / ' + d.name, '~' + d.min + ' min', x + 16 + Math.round(meta.length * 5.4) + 10, y + 38, { size: 11, w: 700, color: P.pri });

  // Muscle tags — promoted above the description because they are the one
  // line that actually separates these four programs from each other.
  let bx = x + 16;
  d.muscles.forEach(m => { bx += pill(parent, m, bx, y + 58, { key: 'tag ' + d.name, h: 21, size: 10, fw: 600, fill: P.sec, color: P.fg, r: 5, px: 8 }) + 5; });

  txt(parent, 'c desc / ' + d.name, d.desc, x + 16, y + 88, { size: 12, color: P.mut, width: CARD_W - 32, lh: 1.4 });
  rect(parent, 'c rule / ' + d.name, x + 16, y + 126, CARD_W - 32, 1, { fill: P.border });

  // The first three lifts with their real loads. This is the product;
  // today it is one truncated "Includes: A · B · C" line.
  d.lifts.forEach((l, i) => {
    txt(parent, 'c lift / ' + d.name + ' / ' + l[0], l[0], x + 16, y + 138 + i * 20, { size: 12.5, w: 500, color: P.fg, op: 0.92 });
    txt(parent, 'c load / ' + d.name + ' / ' + l[0], l[1], x + 16, y + 138 + i * 20, { size: 12, w: 600, color: P.mut, width: CARD_W - 32, align: 'right' });
  });

  // Social proof, only when it exists. See group 05 — all of these are
  // zero across the whole store today, so they are drawn only in the
  // "once it has traction" state.
  if (d.social) {
    txt(parent, 'c social / ' + d.name, d.social, x + 16, y + 204, { size: 11, w: 600, color: P.mut });
  } else {
    txt(parent, 'c more / ' + d.name, 'Preview all ' + d.ex + '  ›', x + 16, y + 204, { size: 11.5, w: 600, color: P.mut });
  }

  // One repeated action per card, not a full-width primary — four
  // full-width primaries stacked would fight for the page, and CLAUDE.md
  // allows exactly one dominant element per screen.
  rect(parent, 'c cta / ' + d.name, x + CARD_W - 16 - 92, y + 194, 92, 34, { fill: P.pri, r: 9 });
  txt(parent, 'c cta l / ' + d.name, '＋  Add', x + CARD_W - 16 - 92, y + 203, { size: 12.5, w: 700, color: '#FFFFFF', width: 92, align: 'center' });
};

// The four real programs. Numbers queried 2026-08-11; see the header.
const CARDS = [
  { name: 'Back & Shoulders Builder', author: '@kegan', ex: 8, sets: 28, min: 51, muscles: ['Back', 'Shoulders'],
    desc: 'Width and thickness built together. Pairs vertical and horizontal pulls for a thick back.',
    lifts: [['Pull-Up', '4 × 8'], ['Barbell Row', '4 × 10'], ['Lat Pulldown', '3 × 12']] },
  { name: 'Legs & Core Destroyer', author: '@kegan', ex: 8, sets: 27, min: 50, muscles: ['Legs', 'Glutes', 'Core'],
    desc: 'Quads, hamstrings, glutes, calves — then core to finish. Heavy compound loading and isolation.',
    lifts: [['Squat', '4 × 8'], ['Romanian Deadlift', '4 × 10'], ['Leg Press', '3 × 12']] },
  { name: 'Full Body Strength', author: '@kegan', ex: 7, sets: 23, min: 50, muscles: ['Legs', 'Chest', 'Back', 'Core'],
    desc: 'Five compound lifts, zero fluff. Squat, hinge, push, pull — every major pattern in one session.',
    lifts: [['Squat', '4 × 6'], ['Deadlift', '4 × 5'], ['Bench Press', '3 × 6']] },
  { name: 'Upper Body Power Day', author: '@kegan', ex: 7, sets: 23, min: 43, muscles: ['Chest', 'Back', 'Shoulders'],
    desc: 'A complete upper body session hitting every muscle above the waist — chest, back, shoulders, arms.',
    lifts: [['Bench Press', '4 × 8'], ['Barbell Row', '4 × 8'], ['Overhead Press', '3 × 10']] },
];

// ── Shell ─────────────────────────────────────────────────────────────
if (!B) {
  B = penpot.createBoard();
  B.name = BOARD_NAME;
  B.resize(1960, 3560);
  // Placed to the RIGHT of whatever is already on the page, so this is
  // safe to run on a page that is not empty.
  //
  // Compare by `.id`, NOT by object identity: the plugin API hands back a
  // fresh proxy on each property access, so `sh !== B` is true even for
  // the board itself. It measured its own 1960 pt width and parked itself
  // at x = 2040 — harmless once, but every re-run would push it another
  // 2040 to the right.
  let rightEdge = 340;
  for (const sh of page.root.children) if (sh.id !== B.id) rightEdge = Math.max(rightEdge, sh.x + sh.width + 80);
  B.x = rightEdge; B.y = 0;
  B.fills = [{ fillColor: P.paper, fillOpacity: 1 }];

  txt(B, 'board title', 'Explore Regimens', B.x + 40, 46, { size: 34, w: 800, head: true, color: P.fg });
  txt(B, 'board subtitle', 'A proposed redesign of the in-app regimen store  ·  src/components/regimens/RegimenStorePage.jsx  ·  drawn at 390 pt', B.x + 40, 96, { size: 13, w: 400, color: P.mut });
  rect(B, 'title rule', B.x + 40, 126, 1500, 1, { fill: P.border });
}
const BX = B.x;
// The phones are inset 140, not 40: each carries a chrome bracket in its
// left margin whose label sits at X − 92, and at an inset of 40 those two
// texts fell outside the board.
const X1 = BX + 140;     // column 1 — the 390 pt phone
const X3 = BX + 900;     // column 2 — the 390 pt phone
const Y1 = 186;

// ── 01 · TODAY ────────────────────────────────────────────────────────
// Drawn from the Tailwind classes in RegimenStorePage.jsx. The bracket
// down the left is the chrome above the first regimen card.
if (PARTS.indexOf('01') !== -1) {
  txt(B, '01 heading', '01  ·  Today', X1, Y1 - 34, { size: 15, w: 700, head: true, color: P.fg, ls: 0.4 });
  rect(B, 'phone / today', X1, Y1, 390, 800, { fill: P.bg, r: 18, stroke: P.border });
  let y = Y1 + 16;

  txt(B, 'today / back', '‹  Back', X1 + 16, y + 12, { size: 13, w: 500, color: P.mut });
  txt(B, 'today / title', 'Explore Regimens', X1 + 82, y + 2, { size: 20, w: 700, head: true, color: P.fg });
  txt(B, 'today / sub', '4 public programs', X1 + 82, y + 30, { size: 11, color: P.mut });
  y += 64;   // h-auto header + mb-5

  // h-11 search, autofocused on mount — see 05, the keyboard opens over
  // the list before anyone has looked at it.
  rect(B, 'today / search', X1 + 16, y, 358, 44, { fill: P.card, r: 8, stroke: P.border });
  txt(B, 'today / search icon', '⌕', X1 + 28, y + 11, { size: 15, color: P.mut });
  txt(B, 'today / search ph', 'Search regimens, exercises…', X1 + 48, y + 14, { size: 13, color: P.mut, op: 0.75 });
  y += 56;   // 44 + mb-3

  // ALL_MUSCLE_GROUPS + 'All' = 12 chips, horizontally scrolled.
  let cx = X1 + 16;
  ['All', 'Chest', 'Back', 'Traps', 'Shoulders', 'Biceps', 'Triceps', 'Legs'].forEach((m, i) => {
    const on = i === 0;
    cx += pill(B, m, cx, y, { key: 'today muscle', h: 28, size: 11, fw: 600, fill: on ? P.pri : P.card, color: on ? '#FFFFFF' : P.mut, stroke: on ? null : P.border }) + 6;
  });
  txt(B, 'today / chips cut', '›', X1 + 366, y + 6, { size: 14, color: P.mut, op: 0.5 });
  y += 52;   // 28 + pb-2 + mb-4

  // Difficulty (mig 120). NULL on 4 of 4 rows, so three of these four
  // return an empty store.
  cx = X1 + 16;
  ['Any level', 'Beginner', 'Intermediate', 'Advanced'].forEach((d, i) => {
    const on = i === 0;
    cx += pill(B, d, cx, y, { key: 'today difficulty', h: 24, size: 9.5, fw: 700, tt: 'uppercase', ls: 0.5, fill: on ? P.fg : P.card, color: on ? P.ink : P.mut, stroke: on ? null : P.border, so: 0.6 }) + 6;
  });
  y += 48;   // 24 + pb-2 + mb-4

  txt(B, 'today / count', '4 regimens · ranked by downloads', X1 + 18, y, { size: 11, color: P.mut });
  y += 26;   // + mb-3

  rect(B, 'today / publish', X1 + 16, y, 358, 78, { fill: P.card, r: 12, stroke: P.border, sw: 2, dash: true });
  rect(B, 'today / publish tile', X1 + 36, y + 19, 40, 40, { fill: P.pri, op: 0.12, r: 12, stroke: P.pri, so: 0.25 });
  txt(B, 'today / publish plus', '+', X1 + 51, y + 26, { size: 20, w: 600, color: P.pri });
  txt(B, 'today / publish t', 'Publish a Regimen', X1 + 90, y + 22, { size: 13, w: 700, head: true, color: P.fg });
  txt(B, 'today / publish s', 'Build your own program and share it', X1 + 90, y + 42, { size: 11, color: P.mut });
  y += 90;
  const firstCardY = y;

  const todayCard = (yy, d) => {
    rect(B, 'today / card ' + d.name, X1 + 16, yy, 358, 150, { fill: P.card, r: 12, stroke: P.border });
    txt(B, 'tc title ' + d.name, d.name, X1 + 32, yy + 14, { size: 15, w: 700, head: true, color: P.fg });
    txt(B, 'tc author ' + d.name, d.author, X1 + 32, yy + 36, { size: 11, color: P.mut });
    txt(B, 'tc desc ' + d.name, d.short, X1 + 32, yy + 54, { size: 12, color: P.mut, width: 232, lh: 1.35 });
    txt(B, 'tc inc ' + d.name, 'Includes: ' + d.lifts.map(l => l[0]).join(' · '), X1 + 32, yy + 90, { size: 11, color: P.mut, op: 0.8 });
    // Both of these are the same on every card in the store today.
    txt(B, 'tc stats ' + d.name, '⬇ 0          ⬚ ' + d.ex + ' exercises', X1 + 32, yy + 108, { size: 11, color: P.mut, op: 0.55 });
    let bx = X1 + 32;
    d.muscles.slice(0, 2).forEach(m => { bx += pill(B, m, bx, yy + 126, { key: 'today tag ' + d.name, h: 17, size: 9.5, fw: 400, fill: P.sec, color: P.mut, r: 4 }) + 5; });
    rect(B, 'tc adopt ' + d.name, X1 + 282, yy + 14, 76, 32, { fill: P.pri, r: 8 });
    txt(B, 'tc adopt l ' + d.name, '⬇ Adopt', X1 + 282, yy + 23, { size: 11, w: 700, color: '#FFFFFF', width: 76, align: 'center' });
    txt(B, 'tc prev ' + d.name, '⌄ Preview', X1 + 292, yy + 56, { size: 11, color: P.mut });
  };
  todayCard(y, Object.assign({}, CARDS[0], { short: 'Width and thickness built together. Pairs vertical and horizontal pulls…' }));
  todayCard(y + 162, Object.assign({}, CARDS[1], { short: 'Quads, hamstrings, glutes, calves — then core to finish. Heavy loading…' }));

  // Chrome bracket. 371 pt, MEASURED 2026-08-11 in a render harness at
  // 390 pt against the four real rows. The first draft of this board
  // derived 324 from the Tailwind classes and said so; the real figure is
  // worse. Deriving a stack of margins under-counts, every time.
  const bTop = Y1 + 16, bBot = firstCardY - 12;
  rect(B, 'bracket / line', X1 - 24, bTop, 2, bBot - bTop, { fill: P.bad, op: 0.85 });
  rect(B, 'bracket / cap top', X1 - 30, bTop, 14, 2, { fill: P.bad, op: 0.85 });
  rect(B, 'bracket / cap bot', X1 - 30, bBot - 2, 14, 2, { fill: P.bad, op: 0.85 });
  txt(B, 'bracket / label', '371 pt', X1 - 92, bTop + (bBot - bTop) / 2 - 8, { size: 11, w: 700, color: P.bad, width: 60, align: 'right' });
  txt(B, 'bracket / label2', 'before the\nfirst regimen', X1 - 92, bTop + (bBot - bTop) / 2 + 8, { size: 10, color: P.mut, width: 60, align: 'right', lh: 1.3 });
}

// ── 02 · PROPOSED ─────────────────────────────────────────────────────
if (PARTS.indexOf('02') !== -1) {
  txt(B, '02 heading', '02  ·  Proposed', X3, Y1 - 34, { size: 15, w: 700, head: true, color: P.pri, ls: 0.4 });
  rect(B, 'phone / proposed', X3, Y1, 390, 800, { fill: P.bg, r: 18, stroke: P.border });
  let y = Y1 + 16;

  // Search collapses to a 36 pt icon button until the store is bigger.
  txt(B, 'new / back', '‹', X3 + 18, y + 8, { size: 20, w: 500, color: P.mut });
  txt(B, 'new / title', 'Explore Regimens', X3 + 40, y + 4, { size: 20, w: 700, head: true, color: P.fg });
  txt(B, 'new / sub', '4 programs shared by the community', X3 + 40, y + 32, { size: 11, color: P.mut });
  rect(B, 'new / search btn', X3 + 336, y + 4, 36, 36, { fill: P.card, r: 18, stroke: P.border });
  txt(B, 'new / search icon', '⌕', X3 + 348, y + 12, { size: 16, color: P.mut });
  y += 60;

  // One filter row, and only the muscle groups the catalogue contains.
  let cx = X3 + 16;
  ['All', 'Back', 'Chest', 'Shoulders', 'Legs', 'Glutes', 'Core', 'Biceps'].forEach((m, i) => {
    const on = i === 0;
    cx += pill(B, m, cx, y, { key: 'new muscle', h: 30, size: 11.5, fw: 600, fill: on ? P.pri : P.card, color: on ? '#FFFFFF' : P.mut, stroke: on ? null : P.border }) + 6;
  });
  y += 42;
  const firstCardY = y;

  CARDS.slice(0, 2).forEach((d, i) => card(B, X3 + 16, y + i * 254, d));
  y += 2 * 254;

  // Publish, moved off the top slot and below the goods.
  rect(B, 'new / publish row', X3 + 16, y, 358, 56, { fill: null, stroke: P.border, r: 12 });
  txt(B, 'new / publish t', 'Built something that works?', X3 + 32, y + 12, { size: 12.5, w: 600, color: P.fg, op: 0.9 });
  txt(B, 'new / publish s', 'Publish a regimen for the community', X3 + 32, y + 30, { size: 11, color: P.mut });
  txt(B, 'new / publish arrow', '›', X3 + 352, y + 18, { size: 16, color: P.mut });

  const bTop = Y1 + 16, bBot = firstCardY - 6;
  rect(B, 'bracket2 / line', X3 - 24, bTop, 2, bBot - bTop, { fill: P.ok, op: 0.9 });
  rect(B, 'bracket2 / cap top', X3 - 30, bTop, 14, 2, { fill: P.ok, op: 0.9 });
  rect(B, 'bracket2 / cap bot', X3 - 30, bBot - 2, 14, 2, { fill: P.ok, op: 0.9 });
  txt(B, 'bracket2 / label', '109 pt', X3 - 92, bTop + (bBot - bTop) / 2 - 6, { size: 11, w: 700, color: P.ok, width: 60, align: 'right' });
}

// ── 03 · CARD ANATOMY + the signal inventory ──────────────────────────
if (PARTS.indexOf('03') !== -1) {
  const X = BX + 60, Y = 1090;
  txt(B, '03 heading', '03  ·  Card anatomy', X - 20, Y - 34, { size: 15, w: 700, head: true, color: P.fg, ls: 0.4 });
  rect(B, 'anatomy bg', X - 20, Y, 700, 460, { fill: P.bg, r: 14, stroke: P.border });
  card(B, X, Y + 44, CARDS[0]);

  const LX = X + 396;
  const spec = (yy, label, detail) => {
    rect(B, 'lead / ' + label, X + 374, yy + 7, 16, 1, { fill: P.pri, op: 0.55 });
    txt(B, 'spec / ' + label, label, LX, yy, { size: 11.5, w: 700, color: P.fg });
    txt(B, 'spec d / ' + label, detail, LX, yy + 15, { size: 10.5, color: P.mut, width: 268, lh: 1.4 });
  };
  // The y offsets are the running total of each block's real height, not
  // a guessed pitch: a 268 pt column at 10.5 / 1.4 takes ~51 characters
  // per line and ~14.7 pt per line, so a label + detail block is 44 pt at
  // two lines and 59 pt at three, stacked with a 12 pt gap. The first
  // draft used a flat ~50 pt pitch and every three-line detail ran into
  // the label below it.
  spec(Y + 48,  'Title',         '16 / 700 Archivo — text.title. Full width; nothing competes for the line.');
  spec(Y + 104, 'Cost line',     '@author · 8 exercises · 28 sets, then ~51 min in primary. All four numbers come from columns populated on every row.');
  spec(Y + 175, 'Muscle tags',   '10 / 600 on secondary, radius 5. Promoted ABOVE the description — this is what actually differs between the four programs.');
  spec(Y + 246, 'Description',   '12 / 400 muted, clamped to 2 lines. Every public regimen has one (152–177 chars).');
  spec(Y + 302, 'First 3 lifts', 'Name 12.5 / 500, load 12 / 600 muted and right-aligned, 20 pt rows. The product, visible without a tap.');
  spec(Y + 358, 'Add',           '92 × 34, radius.lg. One repeated action per card, not a full-width primary — four of those would fight for the page.');

  txt(B, 'anatomy note', 'Drawn here at 358 × 242. AS BUILT it measures 285 tall — this drawing is the proposal, not the shipped card. Radius 12, 1 px border, no shadow (resting elevation), padding 16. Grew from a measured 190 pt — see the trade at the end of 05.', X, Y + 300, { size: 10.5, color: P.mut, op: 0.75, width: 360, lh: 1.4 });

  // ── The signal inventory. The strongest single artefact on this board:
  // it is why the redesign is a data question before it is a taste one.
  const SX = BX + 800, SY = 1090;
  txt(B, 'signals heading', 'What the current page is built on', SX, SY - 34, { size: 15, w: 700, head: true, color: P.fg, ls: 0.4 });
  // 400 tall, not 340: ten rows at a 27 pt pitch from SY+56 end at
  // SY+326, and the footnote sits below them.
  rect(B, 'signals bg', SX, SY, 1100, 460, { fill: P.bg, r: 14, stroke: P.border });
  const cols = [0, 300, 420, 560];
  ['Signal the store renders', 'Populated', 'What it draws today', ''].forEach((h, i) => {
    if (h) txt(B, 'sig h ' + i, h, SX + 24 + cols[i], SY + 20, { size: 10, w: 700, tt: 'uppercase', ls: 0.7, color: P.mut, op: 0.8 });
  });
  rect(B, 'signals head rule', SX + 24, SY + 40, 1052, 1, { fill: P.border });
  const SIG = [
    ['copy_count  →  "⬇ N"',           '0 of 4',       'A grey "⬇ 0" on every card, on every row of the store.', 'dead'],
    ['copy_count  →  Top / Hot badge', '0 of 4',       'Never fires. Needs > 0 for Top, ≥ 10 for Hot.', 'dead'],
    ['copy_count  →  sort order',      '0 of 4',       '"ranked by downloads" over an ordering that does not exist.', 'dead'],
    ['difficulty  →  4 filter chips',  '0 of 4',       'Three of the four chips return an empty store.', 'dead'],
    ['regimen_reviews  →  ★ rating',   '0 rows',       'The star block never renders on any card.', 'dead'],
    ['ALL_MUSCLE_GROUPS  →  12 chips', '8 of 11 used', 'Traps, Full Body and Cardio are chips that match nothing.', 'part'],
    ['description',                    '4 of 4',       'Rendered, clamped to 2 lines. Real copy, 152–177 chars.', 'live'],
    ['exercises[].target_sets',        '30 of 30',     'Not used. 23–28 sets per program.', 'unused'],
    ['exercises[].rest_seconds',       '30 of 30',     'Not used. Gives ~43–51 min per session.', 'unused'],
    ['exercises[].name / reps',        '30 of 30',     'One truncated "Includes: A · B · C" line.', 'part'],
  ];
  const TONE = { dead: P.bad, part: P.pri, live: P.ok, unused: P.ok };
  SIG.forEach((row, i) => {
    const ry = SY + 56 + i * 27;
    rect(B, 'sig dot ' + i, SX + 24, ry + 5, 6, 6, { fill: TONE[row[3]], r: 3 });
    txt(B, 'sig a ' + i, row[0], SX + 40, ry, { size: 11, w: 500, color: P.fg, op: 0.92 });
    txt(B, 'sig b ' + i, row[1], SX + 24 + cols[1], ry, { size: 11, w: 700, color: TONE[row[3]] });
    txt(B, 'sig c ' + i, row[2], SX + 24 + cols[2], ry, { size: 11, color: P.mut });
  });
  txt(B, 'signals note', 'Queried against production 2026-08-11, public regimens only (n = 4). Five of the ten signals the page is composed around cannot render anything but a zero, and two that are populated on every row are unused.', SX + 24, SY + 344, { size: 10.5, color: P.mut, op: 0.8, width: 1040, lh: 1.4 });
}

// ── 04 · STATES ───────────────────────────────────────────────────────
// The three the proposal has to survive. (c) matters most: it is the
// proof that hiding the dead signals is not the same as removing them.
if (PARTS.indexOf('04') !== -1) {
  // 1620, not 1560: group 03's panels grew to 460 and ended at 1550.
  const SY = 1620;
  txt(B, '04 heading', '04  ·  States', BX + 40, SY - 34, { size: 15, w: 700, head: true, color: P.fg, ls: 0.4 });

  // 700 tall, not 560: state (c) carries two full 242 pt cards below a
  // header and a chip row, which is 2174 − SY of content.
  const state = (x, label, sub) => {
    rect(B, 'phone / ' + label, x, SY, 390, 700, { fill: P.bg, r: 18, stroke: P.border });
    txt(B, 'st label / ' + label, label, x, SY + 716, { size: 12, w: 700, color: P.fg });
    txt(B, 'st sub / ' + label, sub, x, SY + 734, { size: 10.5, color: P.mut, width: 380, lh: 1.4 });
    txt(B, 'st back / ' + label, '‹', x + 18, SY + 24, { size: 20, w: 500, color: P.mut });
    txt(B, 'st title / ' + label, 'Explore Regimens', x + 40, SY + 20, { size: 20, w: 700, head: true, color: P.fg });
    return SY + 76;
  };

  // (a) an empty store — no chip row at all, because there is nothing to
  //     filter. Publish is the only thing on the page, so it leads.
  let y = state(BX + 40, 'a · Empty store', 'No public regimens. The filter row is absent — there is nothing to filter — and publishing is the only action, so it takes the page.');
  txt(B, 'sa sub', 'Nothing published yet', BX + 80, SY + 48, { size: 11, color: P.mut });
  rect(B, 'sa icon', BX + 40 + 163, y + 90, 64, 64, { fill: P.card, r: 32, stroke: P.border });
  txt(B, 'sa icon g', '⬚', BX + 40 + 163, y + 108, { size: 24, color: P.mut, op: 0.5, width: 64, align: 'center' });
  txt(B, 'sa t', 'No public regimens yet', BX + 56, y + 176, { size: 15, w: 700, head: true, color: P.fg, width: 358, align: 'center' });
  txt(B, 'sa s', 'Build a program you actually run, then share it.\nYours would be the first.', BX + 56, y + 200, { size: 12, color: P.mut, width: 358, align: 'center', lh: 1.45 });
  rect(B, 'sa cta', BX + 40 + 95, y + 250, 200, 44, { fill: P.pri, r: 10 });
  txt(B, 'sa cta l', 'Publish a regimen', BX + 40 + 95, y + 263, { size: 13, w: 700, color: '#FFFFFF', width: 200, align: 'center' });

  // (b) a filter with no matches. The claim is scoped to the filter, and
  //     the way out is one tap — not a dead end with a dashed box on it.
  y = state(BX + 480, 'b · Filter with no match', 'The message names the filter that emptied the list and offers the way back. Chips that can never match are not drawn, so this is rarer than it is today.');
  txt(B, 'sb sub', '4 programs shared by the community', BX + 520, SY + 48, { size: 11, color: P.mut });
  let cx = BX + 496;
  ['All', 'Back', 'Chest', 'Shoulders', 'Legs'].forEach(m => {
    const on = m === 'Shoulders';
    cx += pill(B, m, cx, y, { key: 'state b', h: 30, size: 11.5, fw: 600, fill: on ? P.pri : P.card, color: on ? '#FFFFFF' : P.mut, stroke: on ? null : P.border }) + 6;
  });
  txt(B, 'sb t', 'Nothing for Shoulders on its own', BX + 496, y + 120, { size: 14, w: 700, head: true, color: P.fg, width: 358, align: 'center' });
  txt(B, 'sb s', 'Two programs train shoulders alongside other groups.', BX + 496, y + 144, { size: 12, color: P.mut, width: 358, align: 'center', lh: 1.45 });
  rect(B, 'sb cta', BX + 480 + 115, y + 180, 160, 38, { fill: P.card, r: 9, stroke: P.border });
  txt(B, 'sb cta l', 'Show all 4', BX + 480 + 115, y + 190, { size: 12.5, w: 700, color: P.fg, width: 160, align: 'center' });

  // (c) the same card once the store has traction. Nothing about the
  //     layout changes — the dead signals simply become live and fill
  //     slots that were already reserved for them.
  y = state(BX + 920, 'c · Once it has traction', 'The identical card with copy_count and reviews non-zero. Downloads, the Top badge and the rating occupy slots the layout already holds — hiding a zero is not the same as removing the feature.');
  txt(B, 'sc sub', '4 programs  ·  1,204 downloads', BX + 960, SY + 48, { size: 11, color: P.mut });
  cx = BX + 936;
  ['All', 'Back', 'Chest', 'Shoulders', 'Legs'].forEach((m, i) => {
    const on = i === 0;
    cx += pill(B, m, cx, y, { key: 'state c', h: 30, size: 11.5, fw: 600, fill: on ? P.pri : P.card, color: on ? '#FFFFFF' : P.mut, stroke: on ? null : P.border }) + 6;
  });
  card(B, BX + 936, y + 42, Object.assign({}, CARDS[0], { badge: 'Top', social: '⬇ 412   ★ 4.6 (23)   ·   Preview all 8  ›' }));
  card(B, BX + 936, y + 42 + 254, Object.assign({}, CARDS[1], { social: '⬇ 188   ★ 4.4 (9)   ·   Preview all 8  ›' }));
}

// ── 05 · WHAT CHANGED, AND WHY ────────────────────────────────────────
if (PARTS.indexOf('05') !== -1) {
  const LX = BX + 40, LY = 2500;
  txt(B, '05 heading', '05  ·  What changed, and why', LX, LY - 34, { size: 15, w: 700, head: true, color: P.fg, ls: 0.4 });
  rect(B, 'ledger bg', LX, LY, 1520, 960, { fill: P.bg, r: 14, stroke: P.border });
  rect(B, 'ledger rule', LX + 26, LY + 26, 1, 908, { fill: P.border });

  let ly = LY + 30;
  // Rows are stacked on an ESTIMATED height — a fresh auto-height text
  // does not report a real `.height` for ~500 ms. See the re-stacking
  // snippet in the header if anything collides.
  const led = (title, why, ev, tone) => {
    rect(B, 'dot / ' + title, LX + 22, ly + 5, 7, 7, { fill: tone || P.pri, r: 4 });
    txt(B, 'led t / ' + title, title, LX + 46, ly, { size: 12.5, w: 700, color: P.fg, width: 1440 });
    txt(B, 'led w / ' + title, why, LX + 46, ly + 19, { size: 11.5, color: P.mut, width: 1440, lh: 1.45 });
    let h = 19 + Math.ceil(why.length / 185) * 17;
    if (ev) {
      txt(B, 'led e / ' + title, ev, LX + 46, ly + h + 3, { size: 10.5, w: 500, color: P.ok, op: 0.85, width: 1440, lh: 1.4 });
      h += 3 + Math.ceil(ev.length / 200) * 15;
    }
    ly += h + 20;
  };

  led('The difficulty filter is dropped',
      'Four chips that filter on a column no row has. Choosing anything but "Any level" returns an empty store — the filter cannot succeed, only fail.',
      'regimens.difficulty is NULL on 4 of 4 public rows. Queried 2026-08-11.');

  led('Downloads, Top / Hot and stars appear only once they are non-zero',
      'Every card renders "⬇ 0" today, and the count line claims an order that does not exist. A zero on every row is the app telling the reader nobody wanted any of this. The slots stay in the layout — see state (c) — they just do not draw a zero.',
      'copy_count = 0 on 4 of 4 · max(copy_count) = 0 · regimen_reviews holds 0 rows.');

  led('Time and volume replace difficulty as the deciding signal',
      'The question a browser actually has is "can I fit this today?". target_sets and rest_seconds are set on every exercise in the store, so ~51 min and 28 sets are derivable right now — no new column, no backfill, no author input.',
      'target_sets and rest_seconds populated on 30 of 30 exercises across the 4 programs. Range 23–28 sets, 43–51 min. The 40 s of work per set inside that estimate is an assumption, not data — hence the tilde. Shipped as src/lib/regimenLoad.js, which also deducts the rest after the final set; that is why these are a minute under the figures this board first carried.');

  led('Muscle chips are derived from the catalogue, not hardcoded',
      'ALL_MUSCLE_GROUPS lists 11 and the store contains 8. Traps, Full Body and Cardio are drawable chips that match nothing — the same defect class as the difficulty filter, one step less obvious.',
      'Present today: Back, Chest, Shoulders, Legs, Glutes, Core, Biceps, Triceps.');

  led('Search collapses into the header until the store is bigger',
      'A 44 pt search field over four items is furniture. Tapping the icon expands it in place. The mount-time autofocus goes with it — it opens the keyboard over the list before anyone has looked at it.',
      null);

  led('Muscle tags move above the description',
      'They are the one line that separates "Legs & Core Destroyer" from "Back & Shoulders Builder". Today they are last, under a stats row on which every number is identical across every card.',
      null);

  led('The first three lifts get real rows',
      'One truncated "Includes: A · B · C" line becomes three rows with sets × reps. That is the thing being adopted, and it is already in the payload the card is rendering from.',
      null);

  led('Publish moves from the top slot to a footer row',
      'A 78 pt dashed box currently takes the most valuable position on the page to advertise authoring to somebody who arrived to browse. It stays reachable, below the goods — except in the empty state, where it is the only thing there is.',
      null);

  led('Chrome before the first regimen: 371 pt → 109 pt',
      'A header, a search field, two chip rows and a count line push the first card most of a small phone down the page. One header and one chip row do the same job for four items.',
      'MEASURED 2026-08-11 at 390 pt in a render harness, against the four real rows. This board first carried 324 → 96, derived from the Tailwind classes; both were optimistic. Shipped in 67f2feb3.',
      P.ok);

  led('The trade, stated: the card grows 190 → 285 pt',
      'About 2.3 cards fit a screen instead of 3.5, measured at 390 × 800. With four programs in the store that is the right side of the trade — the scroll was never the constraint, the emptiness was. Revisit past roughly 20 regimens, which is also the point at which the ranking signals start to mean something and state (c) becomes the default.',
      null, P.bad);

  txt(B, 'ledger footer', 'Nothing here is a taste argument. Every change removes a signal that cannot render, or promotes one that is populated on every row and currently unused.', LX + 46, ly + 6, { size: 11, w: 600, color: P.fg, op: 0.85, width: 1440 });
}

return { board: BOARD_NAME, x: B.x, parts: PARTS, children: B.children.length };
