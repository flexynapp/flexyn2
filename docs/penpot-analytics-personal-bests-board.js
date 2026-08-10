// docs/penpot-analytics-personal-bests-board.js
//
// Builds "Analytics + Personal Bests — as sheets" on its own page.
// Spec and reasoning: docs/analytics-personal-bests-sheets.md
//
// ── HOW TO RUN ────────────────────────────────────────────────────
// Paste into the Penpot MCP plugin console. On the first run it creates
// the page and stops. Then SELECT "Analytics + Personal Bests" in the
// Penpot UI and run it again to draw.
//
// Idempotent: it removes any previous board of the same name first, so
// it is safe to re-run after a bridge timeout — and that matters here,
// because this file was written during a two-hour stretch where the
// plugin would not answer at all. **A timed-out call may still have
// landed its writes.** An earlier timed-out run DID create an empty page
// called "Analytics + Personal Bests — as sheets", so the page name below
// matches it exactly and this script adopts it rather than leaving litter
// beside it.
//
// `penpot.openPage()` takes effect on the NEXT tool call, never inside
// the one that calls it — see the head of penpot-injuries-board.js for
// the measurement. Hence the create-then-abort dance below.
//
// ── THE ASK ───────────────────────────────────────────────────────
// kegan, 2026-08-10: audit and revamp Advanced Analytics and Personal
// Bests, and make both open and appear the way Daily Quests and
// Readiness do.
//
// ── WHAT THE AUDIT FOUND ──────────────────────────────────────────
// These are NOT the same job twice, and that is the first useful thing
// the audit produced:
//
//   · Advanced Analytics is a centered Radix Dialog (max-w-2xl,
//     max-h-[80vh]). It changes presentation AND content.
//   · Personal Bests already uses the generic BottomSheet, so it slides
//     up and swipe-dismisses today. It mostly changes content, and
//     adopts the bespoke chrome.
//
// Advanced Analytics, seven findings:
//   1. Wrong presentation (the ask).
//   2. Ten identical rows, no hierarchy — each a card with a 40px icon
//      tile, so "Total Workouts" reads exactly like "Most Reps".
//   3. Hue as a palette, not as state: primary ×4, accent, success,
//      info ×3, destructive ×1, assigned with no meaning behind the
//      assignment. `text-destructive` on "Top Muscle" renders a neutral
//      fact as a warning.
//   4. shadow-sm + hover:shadow-md on every row. Banned by the
//      elevation rule, and the hover half cannot fire on a phone.
//   5. 'N/A' hardcoded English, four times.
//   6. Math.max(...spread) over every exercise (audit 11 #32).
//   7. "Total Time" and "Avg Duration" were permanently 0 min.
//
// Finding 7 turned out to be a real data bug rather than a design one:
// workout_logs has a column `duration_min`, the client wrote
// `duration_minutes`, and db.js's strip-and-retry dropped it on every
// save. Fixed in d0a15d2b. It changes THIS board rather than merely
// preceding it — the two rows are no longer structurally dead, so they
// stay in board B, but historical rows carry no duration and cannot be
// backfilled, so the zero-state rule still governs them: drop the row,
// do not render 0.
//
// Personal Bests, five findings:
//   1. Generic BottomSheet, not the bespoke shape.
//   2. Sorted ALPHABETICALLY — wrong order for a list someone opens to
//      see their heaviest lifts.
//   3. A pulsing trophy per row (repeat: Infinity), plus a staggered
//      mount spring and a whileHover scale a phone can never trigger.
//   4. Two stat boxes per row inside a card — surfaces inside a surface,
//      for read-only data.
//   5. No way to find anything. A lifter with 60 exercises scrolls.
//
// ── THE ONE DELIBERATE DEVIATION ──────────────────────────────────
// Both reference sheets LEAD WITH A DIAL (ReadinessRing). Neither of
// these surfaces has a number that belongs in a ring — Analytics is
// lifetime reference data, Personal Bests is a list — so forcing one
// would be cargo-culting the shape. The precedent for differing below
// the chrome is in QuestsSheet's own head comment, which already
// distinguishes itself from Readiness as "a reading surface" against one
// that "owns their forms". Shell adopted exactly; the dial's slot holds
// one hero figure instead.

const PAGE = 'Analytics + Personal Bests — as sheets';
const NAME = 'Analytics + Personal Bests — as sheets';
const BX = 0, BY = 0, BW = 1860, BH = 1900;

let page = penpotUtils.getPageByName(PAGE);
if (!page) {
  page = penpot.createPage();
  page.name = PAGE;
  return {
    created: PAGE,
    next: `Select "${PAGE}" in the Penpot UI, then re-run this script to draw.`,
  };
}
if (penpot.currentPage.id !== page.id) {
  return { aborted: true, reason: `Select "${PAGE}" in the Penpot UI first, then re-run.`, on: penpot.currentPage.name };
}
const old = penpotUtils.findShape(s => s.name === NAME, page.root);
if (old) old.remove();

// Colours from the file's own dark token set, not hardcoded hex, so the
// board tracks index.css if the tokens are regenerated.
const tok = (n) => penpotUtils.findTokenByName(n);
const dk = penpot.library.local.tokens.sets.find(s => s.name === 'theme.dark');
const rc = (n) => { const t = (dk && dk.tokens.find(x => x.name === n)) || tok(n); return t ? t.resolvedValue : '#888888'; };
const C = {
  background: rc('color.background'), foreground: rc('color.foreground'), card: rc('color.card'),
  border: rc('color.border'), secondary: rc('color.secondary'), mutedFg: rc('color.muted-foreground'),
  primary: rc('color.primary'), destructive: rc('color.destructive'), success: rc('color.success'),
  info: rc('color.info'),
};
const ax = (x) => BX + x, ay = (y) => BY + y;

const board = penpot.createBoard();
board.name = NAME; board.x = BX; board.y = BY; board.resize(BW, BH);
board.fills = [{ fillColor: C.background, fillOpacity: 1 }];
board.borderRadius = 16;
{ const k = tok('color.background'); if (k) board.applyToken(k, ['fill']); }

function txt(chars, o) {
  const t = penpot.createText(String(chars));
  t.x = ax(o.x); t.y = ay(o.y); t.growType = 'auto-height';
  t.fontSize = String(o.size || 13); t.fontFamily = 'Work Sans';
  t.fontWeight = String(o.weight || 400);
  t.fills = [{ fillColor: o.color || C.foreground, fillOpacity: o.opacity == null ? 1 : o.opacity }];
  t.resize(o.w || 200, t.height); t.growType = 'auto-height';
  if (o.token) { const k = tok(o.token); if (k) t.applyToken(k, ['fill']); }
  t.name = o.name || `t / ${String(chars).slice(0, 20)}`;
  return t;
}
function rect(o) {
  const r = penpot.createRectangle();
  r.x = ax(o.x); r.y = ay(o.y); r.resize(o.w, o.h);
  r.borderRadius = o.radius == null ? 0 : o.radius;
  r.fills = o.fill === null ? [] : [{ fillColor: o.fill || C.secondary, fillOpacity: o.fillOpacity == null ? 1 : o.fillOpacity }];
  if (o.stroke) r.strokes = [{ strokeColor: o.stroke, strokeOpacity: o.strokeOpacity == null ? 1 : o.strokeOpacity, strokeWidth: 1, strokeAlignment: 'center' }];
  r.name = o.name || 'rect';
  return r;
}
// 390 × 844 is the iPhone 15 — the design max. The fluid scale is what
// makes the same layout survive a 667 SE; neither sheet has been checked
// there yet, and the Progress work showed measuring first changes what
// is worth converting.
function sheet(name, x, y) {
  const s = penpot.createBoard();
  s.name = name; s.x = ax(x); s.y = ay(y); s.resize(390, 844);
  s.fills = [{ fillColor: C.background, fillOpacity: 1 }];
  s.borderRadius = 16;
  s.strokes = [{ strokeColor: C.border, strokeOpacity: 1, strokeWidth: 1, strokeAlignment: 'center' }];
  board.appendChild(s);
  return s;
}
// A numbered audit marker. Red on the as-shipped boards, green on the
// proposals, so the eye can pair them across the page.
function mark(host, n, x, y, good) {
  const d = rect({ x, y, w: 18, h: 18, fill: good ? C.success : C.destructive, radius: 999, name: `mark / ${n}` });
  host.appendChild(d);
  host.appendChild(txt(String(n), { x: x + 5, y: y + 3, w: 14, size: 11, weight: 700, color: good ? '#0d1a12' : '#ffffff' }));
}
// The sheet chrome every proposal board shares: dimmed backdrop, panel
// anchored to the bottom edge, grab handle, kicker, resting-fill close.
// Panel height is 88vh of 844 ≈ 743, so it starts 101px down.
function sheetChrome(host, sx, sy, kicker) {
  const PANEL_Y = sy + 101;
  host.appendChild(rect({ x: sx, y: sy, w: 390, h: 101, fill: '#000000', fillOpacity: 0.55, name: 'backdrop' }));
  host.appendChild(rect({ x: sx, y: PANEL_Y, w: 390, h: 743, fill: C.card, radius: 16, name: 'panel' }));
  host.appendChild(rect({ x: sx, y: PANEL_Y, w: 390, h: 1, fill: C.border, name: 'panel / top hairline' }));
  host.appendChild(rect({ x: sx + 175, y: PANEL_Y + 10, w: 40, h: 4, fill: C.foreground, fillOpacity: 0.2, radius: 999, name: 'grab handle' }));
  host.appendChild(txt(kicker, { x: sx + 16, y: PANEL_Y + 28, w: 260, size: 11, weight: 700, color: C.primary }));
  host.appendChild(rect({ x: sx + 346, y: PANEL_Y + 22, w: 28, h: 28, fill: C.foreground, fillOpacity: 0.08, radius: 999, name: 'close' }));
  host.appendChild(txt('✕', { x: sx + 355, y: PANEL_Y + 28, w: 20, size: 12, weight: 700, color: C.mutedFg }));
  return PANEL_Y;
}

board.appendChild(txt(NAME, { x: 60, y: 44, w: 1200, size: 26, weight: 700 }));
board.appendChild(txt(
  'A and C ship today. B and D are the proposal, in the shape QuestsSheet and ReadinessSheet already use. E is the ledger.\nSpec: docs/analytics-personal-bests-sheets.md',
  { x: 60, y: 84, w: 1300, size: 13, color: C.mutedFg }));

// ══ A · Advanced Analytics — as shipped ═══════════════════════════
// Drawn as a CENTERED dialog inset from all four edges, because that is
// the finding: it does not touch the bottom of the screen, has no grab
// handle, and reads as a desktop modal on a phone.
{
  const S = sheet('A · Advanced Analytics — as shipped', 60, 180);
  const x = 60, y = 180;
  S.appendChild(rect({ x, y, w: 390, h: 844, fill: '#000000', fillOpacity: 0.5, name: 'backdrop' }));
  S.appendChild(rect({ x: x + 16, y: y + 85, w: 358, h: 675, fill: C.card, radius: 12, stroke: C.border, name: 'dialog' }));
  S.appendChild(txt('Advanced Analytics', { x: x + 32, y: y + 105, w: 280, size: 20, weight: 700 }));
  mark(S, 1, x + 340, y + 100);

  // four hero tiles
  const tiles = [['1d', 'STREAK', C.primary], ['3', 'WORKOUTS', C.info], ['12K', 'VOLUME', C.success], ['Lv 4', 'LEVEL', C.primary]];
  tiles.forEach((t, i) => {
    const tx = x + 32 + i * 84;
    S.appendChild(rect({ x: tx, y: y + 142, w: 76, h: 76, fill: C.card, radius: 12, stroke: C.border }));
    S.appendChild(rect({ x: tx + 26, y: y + 152, w: 24, h: 24, fill: t[2], fillOpacity: 0.15, radius: 8 }));
    S.appendChild(txt(t[0], { x: tx, y: y + 184, w: 76, size: 15, weight: 700, color: t[2] }));
    S.appendChild(txt(t[1], { x: tx + 8, y: y + 202, w: 68, size: 9, weight: 500, color: C.mutedFg }));
  });

  // ten identical rows — only the first five fit above the fold, which
  // is itself part of the finding.
  const rows = [
    ['Total Workouts', '3', C.primary], ['Total Volume', '12,480 lbs', C.primary],
    ['Total Time', '0 min', C.primary], ['Favorite Exercise', 'Bench Press', C.destructive],
    ['Strongest Lift', '185 lbs (Bench Press)', C.primary], ['Most Reps', '12 reps', C.success],
    ['Unique Exercises', '9', C.info], ['Top Muscle Group', 'Chest', C.destructive],
    ['Avg Duration', '0 min', C.info], ['Most Performed', 'Bench Press', C.info],
  ];
  rows.forEach((r, i) => {
    const ry = y + 236 + i * 62;
    S.appendChild(rect({ x: x + 32, y: ry, w: 326, h: 54, fill: C.card, radius: 8, stroke: C.border, strokeOpacity: 0.5 }));
    S.appendChild(rect({ x: x + 42, y: ry + 11, w: 32, h: 32, fill: C.secondary, radius: 8 }));
    S.appendChild(txt(r[0], { x: x + 84, y: ry + 10, w: 200, size: 10, color: C.mutedFg }));
    S.appendChild(txt(r[1], { x: x + 84, y: ry + 24, w: 240, size: 14, weight: 700, color: r[2] }));
    if (i === 2) mark(S, 5, x + 330, ry + 6);
    if (i === 3) mark(S, 3, x + 330, ry + 6);
  });
  mark(S, 2, x + 340, y + 250);
  mark(S, 4, x + 340, y + 560);
}

// ══ B · Advanced Analytics — proposed ═════════════════════════════
{
  const S = sheet('B · Advanced Analytics — proposed', 510, 180);
  const x = 510, y = 180;
  const P = sheetChrome(S, x, y, 'ADVANCED ANALYTICS');
  const cx = x + 16;

  // Hero — the dial's slot, holding the number someone opens this for.
  S.appendChild(txt('412,880', { x: cx, y: P + 52, w: 300, size: 40, weight: 700 }));
  S.appendChild(txt('lbs lifted, all time', { x: cx, y: P + 100, w: 300, size: 13, color: C.mutedFg }));
  S.appendChild(txt('148 workouts  ·  since March', { x: cx, y: P + 120, w: 300, size: 11, color: C.mutedFg }));
  mark(S, 1, x + 346, P + 60, true);

  // Three labelled groups. The labels ARE the hierarchy — restyling ten
  // identical rows can never make one read differently from another.
  const groups = [
    ['LOAD', [['Strongest lift', '185 lb  ·  Bench Press'], ['Most reps', '12  ·  Lat Pulldown'], ['Total volume', '412,880 lb']]],
    ['CONSISTENCY', [['Total workouts', '148'], ['Total time', '96 h 20 m'], ['Avg session', '39 min']]],
    ['RANGE', [['Unique exercises', '34'], ['Most performed', 'Bench Press  ·  61×'], ['Top muscle group', 'Chest']]],
  ];
  let gy = P + 158;
  groups.forEach(([label, rows], gi) => {
    S.appendChild(txt(label, { x: cx, y: gy, w: 200, size: 11, weight: 700, color: C.mutedFg }));
    gy += 22;
    rows.forEach(([k, v]) => {
      S.appendChild(txt(k, { x: cx, y: gy + 4, w: 190, size: 13, color: C.mutedFg }));
      S.appendChild(txt(v, { x: cx + 150, y: gy + 4, w: 208, size: 13, weight: 700 }));
      S.appendChild(rect({ x: cx, y: gy + 28, w: 358, h: 1, fill: C.border, name: 'rule' }));
      gy += 36;
    });
    if (gi === 0) mark(S, 2, x + 346, gy - 100, true);
    if (gi === 1) mark(S, 5, x + 346, gy - 64, true);
    gy += 14;
  });
  mark(S, 3, x + 346, P + 300, true);

  S.appendChild(txt('Charts', { x: cx, y: gy + 6, w: 200, size: 11, weight: 700, color: C.mutedFg }));
  S.appendChild(rect({ x: cx, y: gy + 26, w: 358, h: 92, fill: C.background, radius: 12, stroke: C.border }));
  [26, 34, 30, 44, 52, 48, 60, 68].forEach((h, i) => {
    S.appendChild(rect({ x: cx + 16 + i * 42, y: gy + 26 + (92 - 14 - h), w: 24, h, fill: C.primary, fillOpacity: 0.85, radius: 3 }));
  });
}

// ══ C · Personal Bests — as shipped ═══════════════════════════════
{
  const S = sheet('C · Personal Bests — as shipped', 960, 180);
  const x = 960, y = 180;
  const P = y + 101;
  S.appendChild(rect({ x, y, w: 390, h: 101, fill: '#000000', fillOpacity: 0.5, name: 'backdrop' }));
  S.appendChild(rect({ x, y: P, w: 390, h: 743, fill: C.card, radius: 16, name: 'BottomSheet' }));
  S.appendChild(rect({ x: x + 175, y: P + 10, w: 40, h: 4, fill: C.foreground, fillOpacity: 0.2, radius: 999 }));
  S.appendChild(txt('Personal Bests', { x: x + 16, y: P + 26, w: 260, size: 16, weight: 700 }));
  mark(S, 1, x + 346, P + 24);

  // Alphabetical, one card per exercise, two nested stat boxes, trophy.
  const pbs = [['Bench Press', '185 lbs', '8 reps'], ['Deadlift', '315 lbs', '5 reps'], ['Lat Pulldown', '120 lbs', '12 reps'], ['Overhead Press', '95 lbs', '10 reps']];
  pbs.forEach((p, i) => {
    const ry = P + 60 + i * 154;
    S.appendChild(rect({ x: x + 16, y: ry, w: 358, h: 142, fill: C.card, radius: 12, stroke: C.border, strokeOpacity: 0.5 }));
    S.appendChild(rect({ x: x + 30, y: ry + 14, w: 28, h: 28, fill: C.primary, fillOpacity: 0.1, radius: 8, name: 'trophy / pulsing' }));
    S.appendChild(txt(p[0], { x: x + 68, y: ry + 20, w: 200, size: 13, weight: 700 }));
    S.appendChild(txt('History ›', { x: x + 300, y: ry + 21, w: 70, size: 10, weight: 600, color: C.primary }));
    S.appendChild(rect({ x: x + 30, y: ry + 54, w: 164, h: 72, fill: C.primary, fillOpacity: 0.05, radius: 8 }));
    S.appendChild(txt('Best Weight', { x: x + 42, y: ry + 64, w: 140, size: 10, color: C.mutedFg }));
    S.appendChild(txt(p[1], { x: x + 42, y: ry + 82, w: 140, size: 18, weight: 700, color: C.primary }));
    S.appendChild(rect({ x: x + 200, y: ry + 54, w: 164, h: 72, fill: C.info, fillOpacity: 0.05, radius: 8 }));
    S.appendChild(txt('Best Reps', { x: x + 212, y: ry + 64, w: 140, size: 10, color: C.mutedFg }));
    S.appendChild(txt(p[2], { x: x + 212, y: ry + 82, w: 140, size: 18, weight: 700, color: C.info }));
    if (i === 0) { mark(S, 3, x + 346, ry + 8); mark(S, 4, x + 346, ry + 60); }
  });
  S.appendChild(txt('A → Z', { x: x + 16, y: P + 46, w: 100, size: 10, weight: 700, color: C.destructive }));
  mark(S, 2, x + 100, P + 42);
}

// ══ D · Personal Bests — proposed ═════════════════════════════════
{
  const S = sheet('D · Personal Bests — proposed', 1410, 180);
  const x = 1410, y = 180;
  const P = sheetChrome(S, x, y, 'PERSONAL BESTS');
  const cx = x + 16;

  S.appendChild(txt('315 lb', { x: cx, y: P + 52, w: 300, size: 40, weight: 700 }));
  S.appendChild(txt('Deadlift — your heaviest lift', { x: cx, y: P + 100, w: 300, size: 13, color: C.mutedFg }));
  S.appendChild(txt('34 exercises with a recorded best', { x: cx, y: P + 120, w: 300, size: 11, color: C.mutedFg }));
  mark(S, 1, x + 346, P + 60, true);

  // Filter — client-side, no network. Appears past ~12 exercises.
  S.appendChild(rect({ x: cx, y: P + 152, w: 358, h: 34, fill: C.background, radius: 8, stroke: C.border }));
  S.appendChild(txt('Filter exercises', { x: cx + 12, y: P + 161, w: 200, size: 12, color: C.mutedFg }));
  mark(S, 5, x + 346, P + 154, true);

  // Heaviest first, rows on hairlines, whole row through to history.
  const rows = [
    ['Deadlift', 'best 5 reps  ·  12 Aug', '315 lb'],
    ['Back Squat', 'best 3 reps  ·  9 Aug', '245 lb'],
    ['Bench Press', 'best 8 reps  ·  12 Aug', '185 lb'],
    ['Barbell Row', 'best 8 reps  ·  5 Aug', '155 lb'],
    ['Lat Pulldown', 'best 12 reps  ·  2 Aug', '120 lb'],
    ['Overhead Press', 'best 10 reps  ·  28 Jul', '95 lb'],
    ['Dumbbell Curl', 'best 12 reps  ·  28 Jul', '40 lb'],
  ];
  rows.forEach((r, i) => {
    const ry = P + 206 + i * 52;
    S.appendChild(txt(r[0], { x: cx, y: ry, w: 220, size: 13, weight: 700 }));
    S.appendChild(txt(r[1], { x: cx, y: ry + 18, w: 240, size: 11, color: C.mutedFg }));
    S.appendChild(txt(r[2], { x: cx + 250, y: ry + 4, w: 90, size: 14, weight: 700, color: C.primary }));
    S.appendChild(txt('›', { x: cx + 344, y: ry + 4, w: 14, size: 14, color: C.mutedFg }));
    S.appendChild(rect({ x: cx, y: ry + 40, w: 358, h: 1, fill: C.border, name: 'rule' }));
    if (i === 0) { mark(S, 2, x + 346, ry - 4, true); mark(S, 3, x + 346, ry + 44, true); }
    if (i === 1) mark(S, 4, x + 346, ry + 44, true);
  });
}

// ══ E · Ledger ════════════════════════════════════════════════════
{
  const L = penpot.createBoard();
  L.name = 'E · What changed, and which rule asks for it';
  L.x = ax(60); L.y = ay(1080); L.resize(1740, 620);
  L.fills = [{ fillColor: C.background, fillOpacity: 1 }];
  L.borderRadius = 16;
  L.strokes = [{ strokeColor: C.border, strokeOpacity: 1, strokeWidth: 1, strokeAlignment: 'center' }];
  board.appendChild(L);
  const lx = 84, ly = 1104;
  L.appendChild(txt('What changed, and which rule asks for it', { x: lx, y: ly, w: 900, size: 16, weight: 700 }));
  L.appendChild(rect({ x: lx, y: ly + 30, w: 1692, h: 1, fill: C.border }));

  const items = [
    [1, 'Centered dialog  →  bottom sheet   ·   generic BottomSheet  →  the bespoke shape',
     'The ask. Both now use the QuestsSheet/ReadinessSheet shell exactly: slide-up on a 0.32s [0.22,1,0.36,1] ease, max-w-md, max-h-[88vh], grab handle, micro kicker in primary, safe-area bottom padding, body scroll lock, Escape to close, and queries gated on `enabled: open` — React.lazy defers the chunk, not the query.'],
    [2, 'Ten flat stats  →  nine rows in three labelled groups   ·   A→Z  →  heaviest first',
     'Restyling ten identical rows cannot make "Total Workouts" read differently from "Most Reps"; three labels saying what KIND of question each number answers can. Personal Bests was alphabetical, which is the wrong order for a list you open to see your heaviest lifts — and it is why no sort toggle ships with this: the list has never had a defensible order at all, so give it one good one first.'],
    [3, 'Per-row hue  →  one hero in primary, everything else foreground/muted',
     '"Four hues, no exceptions." Ten rows carried primary ×4, accent, success, info ×3 and destructive ×1, assigned with no meaning — `text-destructive` on "Top Muscle" rendered a neutral fact as a warning. Resolved by DELETION rather than by re-deciding: there is no per-row colour left to assign wrongly.'],
    [4, 'Cards and nested stat boxes  →  rows on hairlines',
     '"Cards mark discrete, user-arranged objects. Read-only data that is not a widget gets hairline dividers instead." Neither a stat row nor a PR is arranged or configurable. Personal Bests also loses two nested tinted boxes per row — surfaces inside a surface — and the per-row pulsing trophy, which ran `repeat: Infinity` once per exercise.'],
    [5, 'Zeros  →  dropped rows   ·   a filter for long lists',
     '"A section with no data must not render as zeros — a 0 reads as a failure the user did not commit." Total Time and Avg Duration showed 0 min for everyone because the client wrote a column the table does not have (fixed, d0a15d2b) — but historical rows still carry no duration and cannot be backfilled, so those rows drop rather than render 0. On the other sheet, a lifter with 60 exercises had no way to find one.'],
  ];
  let iy = ly + 52;
  items.forEach(([n, head, body]) => {
    L.appendChild(rect({ x: lx, y: iy + 1, w: 18, h: 18, fill: C.success, radius: 999 }));
    L.appendChild(txt(String(n), { x: lx + 5, y: iy + 4, w: 14, size: 11, weight: 700, color: '#0d1a12' }));
    L.appendChild(txt(head, { x: lx + 30, y: iy, w: 1660, size: 13, weight: 700 }));
    L.appendChild(txt(body, { x: lx + 30, y: iy + 22, w: 1660, size: 11, color: C.mutedFg }));
    iy += 22 + Math.ceil(String(body).length / 200) * 15 + 30;
  });
}

// ══ DECISIONS ═════════════════════════════════════════════════════
{
  const dx = 60;
  let dy = 1740;
  board.appendChild(txt('DECISIONS', { x: dx, y: dy, w: 400, size: 13, weight: 700 }));
  board.appendChild(rect({ x: dx, y: dy + 24, w: 1740, h: 1, fill: C.border, name: 'd / rule' }));
  dy += 48;
  const pairs = [
    ['PROPOSAL — not shipped, not started',
     'Nothing in B or D exists in code. The only thing already shipped from this audit is the duration column fix (d0a15d2b), which is a data bug rather than a layout one.'],
    ['NEITHER SHEET GETS A DIAL, AND THAT IS THE ARGUABLE ONE',
     'Both reference sheets lead with a ReadinessRing. Neither of these has a number that belongs in a ring, so the dial slot holds a hero figure instead. If you want the shape held exactly, Analytics could wind a ring on "exercises trained / exercises in your regimens" — but that is a number nobody asked for, and inventing one to fill a component is how a pattern becomes a cargo cult.'],
    ['"FAVORITE EXERCISE" IS DROPPED, NOT RENAMED',
     'It and "Most performed" were the same number under two labels until audit 11 #14 split them. The distinction still does not survive being said out loud, so nine rows, not ten.'],
    ['NOT CHECKED AT 375×667',
     'Both boards are drawn at the 390×844 design max. The Progress work found that measuring the SE first changes what is worth converting — do that before committing to the group order.'],
  ];
  pairs.forEach(([h, b]) => {
    board.appendChild(txt(h, { x: dx, y: dy, w: 1740, size: 12, weight: 700, color: C.primary, name: `d / ${h.slice(0, 28)}` }));
    board.appendChild(txt(b, { x: dx, y: dy + 20, w: 1500, size: 11, color: C.mutedFg, name: `d / ${b.slice(0, 28)}` }));
    dy += 20 + Math.ceil(b.length / 210) * 15 + 28;
  });
  board.resize(BW, Math.max(BH, dy + 40));
}

return {
  built: NAME,
  boards: penpotUtils.findShapes(s => s.type === 'board', board).map(b => b.name),
  containmentViolations: penpotUtils
    .analyzeDescendants(board, (root, s) => penpotUtils.isContainedIn(s, root) ? null : s.name)
    .map(v => v.result),
};
