/* eslint-disable */
//
// docs/penpot-exercise-trends-board.js
//
// Builds the board `Exercise Trends — resolved` on Penpot Page 2.
//
// WHY THIS IS A FILE AND NOT A TOOL CALL: the plugin bridge was dead for
// the whole session this was written in — `return 1` timed out, which per
// the notes in memory distinguishes a genuinely dead connection from a
// slow one. So this is written the way the Achievements and Journal
// boards were: self-contained and idempotent, to be pasted into
// `execute_code` in one go after a plugin reconnect.
//
// It is SAFE TO RE-RUN. It deletes any board of the same name first, so a
// half-built board from a timed-out call is cleaned up rather than
// double-drawn. Do not try to resume it mid-board.
//
// BEFORE PASTING: select the page **Exercise Trends — resolved** in the
// Penpot UI. The script bails with a message rather than switching pages
// itself — `penpot.openPage()` is async and asserting `currentPage` on
// the next line is a race that has cost a 22-child board before. (If the
// page does not exist yet: `const p = penpot.createPage(); p.name =
// 'Exercise Trends — resolved'; await penpot.openPage(p);` in its own
// call, then verify `penpot.currentPage.name` in a SECOND call, then run
// this one.)
//
// It gets its own page rather than a slot on Page 2 because that is where
// the convention went: Page 2 holds the older boards (Journal,
// Achievements, Settings, Daily Quests) while every recent one — League
// seasons, My Gym, Weekly Reviews, Injuries, Progress, Analytics — is a
// page per feature.
//
// ── What it draws ────────────────────────────────────────────────────
// Seven groups, left to right, at true phone size (390 pt). This is the
// RESOLVED idiom, not the slots idiom: the composition is already built
// and shipped, so the board documents what landed and why, and is the
// thing to edit if any of it should be different.
//
//   01  The tab as it renders, populated
//   02  Collapsed row anatomy — what a row states without opening
//   03  Expanded row — metric switch, chart, latest sets
//   04  Chart anatomy — the marks and axis spec
//   05  The four states (one session / none in period / no match / never)
//   06  Filter chip + its sheet
//   07  Decisions ledger
//
// Values come from the file's `theme.dark` token set where the token
// exists, and fall back to the hex conversions of `src/index.css`'s dark
// block otherwise — listed in FALLBACK below so a missing token is
// visible rather than silently wrong.

// ─────────────────────────────────────────────────────────────────────
// HOW TO JUDGE A COLUMN, and how to put it back.
//
// The board is BUILT and REVIEWED — all seven groups, all three columns,
// 222 shapes at 1362 × 2085. What follows is the technique, kept because
// it is needed again on any edit and it is not obvious.
//
// There is no region export in Penpot, and a full-width export puts 11px
// type at a third scale where none of it is readable. So judging one
// column means cropping the board to 486 wide, HIDING the other two, and
// sliding the one under inspection to x0 — then putting it all back.
// Column 2 sits 438pt right of column 1; column 3, 876pt.
//
// The restore below keys off `hidden` rather than child indices: at that
// moment the hidden shapes ARE the parked columns and everything visible
// IS the displaced one. So it survives a plugin reload, which wipes
// `storage`, and it does not care which column was under inspection —
// pass the right offset. It is a no-op on a healthy board (nothing hidden
// → nothing shifted), so it is always safe to run first.
//
// This mattered: the bridge died mid-inspection on 2026-08-10 and left the
// board cropped with two columns hidden for several hours. Nothing was
// lost, because the recovery needed no memory of what had been done.
/*
const OFFSET = 438;  // 876 if column 3 was the one under inspection
const b = penpotUtils.findShape(s => s.name === 'Exercise Trends — resolved' && s.type === 'board', penpot.currentPage.root);
const displaced = b.children.filter(c => !c.hidden);
const parked    = b.children.filter(c =>  c.hidden);
if (parked.length) {
  for (const c of displaced) c.x += OFFSET;
  for (const c of parked)    c.hidden = false;
}
let mx = 0, my = 0;
for (const c of b.children) { mx = Math.max(mx, c.bounds.x + c.bounds.width); my = Math.max(my, c.bounds.y + c.bounds.height); }
b.resize(Math.round(mx) + 48, Math.round(my) + 48);
return { restored: parked.length > 0, size: [b.width, b.height] };
*/
//
// Two defects this pass caught that NOTHING programmatic saw — both
// boards passed `isContainedIn`, shape counts and name lookups clean:
//   • a note running straight through the NEXT group's label, twice.
//     Re-anchor the following group off the note's measured bottom.
//   • a ledger laid out on a fixed 74pt stride, which overlapped its
//     three-line entries and left holes under the one-line ones. Stack
//     off each text's real `.height` instead.
// ─────────────────────────────────────────────────────────────────────

const BOARD_NAME = 'Exercise Trends — resolved';

// ── Guard rails ───────────────────────────────────────────────────────
const TARGET_PAGE = 'Exercise Trends — resolved';

const page = penpot.currentPage;
if (!page) return 'No current page.';
if (page.name !== TARGET_PAGE) {
  return `Current page is "${page.name}". Select "${TARGET_PAGE}" in the Penpot UI and re-run — this script will not switch pages for you.`;
}

// Idempotency: remove a previous build before drawing. `remove()` only
// works on the ACTIVE page, which is another reason for the guard above.
for (const sh of page.root.children.slice()) {
  if (sh.name === BOARD_NAME) sh.remove();
}

// ── Palette ───────────────────────────────────────────────────────────
// hsl() from src/index.css `.dark`, converted. Used only where the
// matching token is absent.
const FALLBACK = {
  'color.background':       '#13171B', // 210 18%  9%
  'color.card':             '#191F24', // 210 18% 12%
  'color.secondary':        '#262E36', // 210 18% 18%
  'color.border':           '#2A333B', // 210 18% 20%
  'color.foreground':       '#F5F2F0', // 30 20% 95%
  'color.muted-foreground': '#89949F', // 210 10% 58%
  'color.primary':          '#F37616', // 26 90% 52%
  'color.success':          '#41C88A', // 152 52% 52%
  'color.chart-1':          '#F37616', // 26 90% 52%
};

const tokenCache = new Map();
function tok(name) {
  if (!tokenCache.has(name)) tokenCache.set(name, penpotUtils.findTokenByName(name));
  return tokenCache.get(name);
}
/** Fill a shape from a token when one exists, else from FALLBACK. */
function fill(shape, name, opacity) {
  const hex = FALLBACK[name] || '#FF00FF';   // magenta = a name I got wrong
  shape.fills = [{ fillColor: hex, fillOpacity: opacity == null ? 1 : opacity }];
  const t = tok(name);
  if (t && opacity == null) { try { t.applyToShapes([shape], ['fill']); } catch (_) {} }
}

const missingTokens = [];
for (const n of Object.keys(FALLBACK)) if (!tok(n)) missingTokens.push(n);

// ── Primitives ────────────────────────────────────────────────────────
const board = penpot.createBoard();
board.name = BOARD_NAME;

// Place after everything already on the page, so this never lands on top
// of the Journal / Achievements / Settings boards.
let originX = 0;
for (const sh of page.root.children) {
  if (sh === board) continue;
  originX = Math.max(originX, sh.x + sh.width);
}
originX += 240;
const originY = 0;

const BOARD_W = 3 * 390 + 4 * 48;     // three phone slots per row
const BOARD_H = 3400;
board.resize(BOARD_W, BOARD_H);
board.x = originX;
board.y = originY;
fill(board, 'color.background');

function rect(px, py, w, h, colour, opacity, radius) {
  const r = penpot.createRectangle();
  r.resize(w, h);
  r.x = board.x + px;
  r.y = board.y + py;
  fill(r, colour, opacity);
  if (radius != null) r.borderRadius = radius;
  r.strokes = [];
  board.appendChild(r);
  return r;
}

function hairline(px, py, w, colour) {
  return rect(px, py, w, 1, colour || 'color.border');
}

function text(px, py, chars, opts) {
  const o = opts || {};
  const t = penpot.createText(chars);
  t.x = board.x + px;
  t.y = board.y + py;
  t.fontSize = o.size || 12;
  t.fontWeight = o.weight || '400';
  t.growType = 'auto-width';
  fill(t, o.colour || 'color.foreground');
  if (o.width) { t.resize(o.width, t.height); t.growType = 'auto-height'; }
  board.appendChild(t);
  t.name = o.name || `txt / ${chars.slice(0, 28)}`;
  return t;
}

// Column origins for the three-per-row grid.
const COL = [48, 48 + 390 + 48, 48 + 2 * (390 + 48)];

function groupLabel(px, py, n, title) {
  const t = text(px, py, `${n}  ${title}`, { size: 13, weight: '700', colour: 'color.foreground' });
  t.name = `label / g${n}`;
  return t;
}
function note(px, py, n, body, width) {
  const t = text(px, py, body, { size: 11, colour: 'color.muted-foreground', width: width || 390 });
  t.name = `note / c${n}`;
  return t;
}

/** A 390 × h phone slot on the card surface. */
function slot(px, py, h, name) {
  const r = rect(px, py, 390, h, 'color.card');
  r.name = `slot / ${name}`;
  return r;
}

// ── Row primitives, reused by several groups ──────────────────────────

/** A collapsed exercise row: name, value + metric + delta, sparkline. */
function exerciseRow(px, py, { name, value, metric, delta, deltaTone, spark }) {
  hairline(px, py, 358, 'color.border');
  text(px + 16, py + 10, name, { size: 14, weight: '700' });
  text(px + 16, py + 29, value, { size: 11, weight: '600' });
  const vw = 8 + value.length * 6;
  text(px + 16 + vw, py + 29, metric, { size: 11, colour: 'color.muted-foreground' });
  if (delta) {
    text(px + 16 + vw + 8 + metric.length * 6, py + 29,
      delta, { size: 11, weight: '600', colour: deltaTone || 'color.success' });
  }
  // Sparkline stand-in — the real one is a hand-rolled SVG polyline,
  // 56 × 20, drawn in `src/components/progress/Sparkline.jsx`.
  if (spark) {
    const n = spark.length;
    const maxV = Math.max(...spark), minV = Math.min(...spark);
    for (let i = 0; i < n; i++) {
      const h = 4 + (maxV === minV ? 8 : ((spark[i] - minV) / (maxV - minV)) * 16);
      rect(px + 300 + i * 9, py + 30 - h, 2, h, 'color.primary', 0.9, 1);
    }
  }
  // Chevron stand-in
  rect(px + 366, py + 22, 10, 2, 'color.muted-foreground', 0.8, 1);
  return py + 52;
}

/** The group header: a section label on a hairline, no surface. */
function groupHeader(px, py, label, count) {
  text(px + 16, py, label.toUpperCase(), { size: 11, weight: '700', colour: 'color.muted-foreground' });
  text(px + 16 + label.length * 8 + 12, py, String(count), { size: 11, weight: '500', colour: 'color.muted-foreground' });
  hairline(px + 16, py + 18, 358, 'color.border');
  return py + 26;
}

/** A filter chip — a pill whose LABEL IS ITS VALUE. */
function chip(px, py, label) {
  const w = 22 + label.length * 7;
  const r = rect(px, py, w, 36, 'color.background', 1, 18);
  r.strokes = [{ strokeColor: FALLBACK['color.border'], strokeWidth: 1, strokeAlignment: 'inner' }];
  r.name = `chip / ${label}`;
  text(px + 12, py + 10, label, { size: 13, weight: '500' });
  rect(px + w - 16, py + 17, 8, 2, 'color.muted-foreground', 0.8, 1);
  return w;
}

/** A single-axis line chart stand-in. */
function chart(px, py, w, h, series) {
  // Recessive grid: horizontal only, border at 50% opacity.
  for (let i = 0; i <= 2; i++) rect(px + 34, py + (h / 2) * i, w - 34, 1, 'color.border', 0.5);
  const maxV = Math.max(...series), minV = Math.min(...series);
  const pad = (maxV - minV) * 0.18 || 1;
  const lo = minV - pad, hi = maxV + pad;
  const xAt = (i) => px + 40 + (i / (series.length - 1)) * (w - 52);
  const yAt = (v) => py + h - ((v - lo) / (hi - lo)) * h;
  // 2 px line, approximated as segments.
  for (let i = 0; i < series.length - 1; i++) {
    const x1 = xAt(i), y1 = yAt(series[i]), x2 = xAt(i + 1), y2 = yAt(series[i + 1]);
    const seg = rect(x1, Math.min(y1, y2), Math.max(2, x2 - x1), Math.max(2, Math.abs(y2 - y1)), 'color.chart-1', 1, 1);
    seg.name = 'chart / segment';
  }
  // Dots: 6 pt with a 2 pt card-coloured ring.
  for (let i = 0; i < series.length; i++) {
    rect(xAt(i) - 4, yAt(series[i]) - 4, 8, 8, 'color.card', 1, 4);
    rect(xAt(i) - 3, yAt(series[i]) - 3, 6, 6, 'color.chart-1', 1, 3);
  }
  // Both real bounds ticked — the axis is deliberately NOT zero-based,
  // so the reader has to be able to see where it starts.
  text(px, py - 6, String(Math.round(hi)), { size: 11, colour: 'color.muted-foreground' });
  text(px, py + h - 6, String(Math.round(lo)), { size: 11, colour: 'color.muted-foreground' });
}

// ══ 01 · The tab, populated ═══════════════════════════════════════════
let x = COL[0], y = 48;
groupLabel(x, y, '01', 'The tab, populated');
y += 26;
const s1y = y;
slot(x, y, 620, '01 / trends tab');
let cy = y + 20;
text(x + 16, cy, 'Exercise Trends', { size: 17, weight: '700' }); cy += 22;
text(x + 16, cy, '7 exercises · Last 30 Days', { size: 11, colour: 'color.muted-foreground' }); cy += 24;
const w1 = chip(x + 16, cy, 'All muscle groups');
chip(x + 16 + w1 + 8, cy, 'Push A');
cy += 52;
cy = groupHeader(x, cy, 'Chest', 3);
cy = exerciseRow(x, cy, { name: 'Bench Press', value: '205 lb', metric: 'Top set', delta: '+10 lb', spark: [3, 4, 4, 6, 7, 9] });
cy = exerciseRow(x, cy, { name: 'Incline Dumbbell Press', value: '70 lb', metric: 'Top set', delta: '−5 lb', deltaTone: 'color.muted-foreground', spark: [6, 7, 8, 7, 6, 6] });
cy = exerciseRow(x, cy, { name: 'Push-Up', value: '24', metric: 'Reps', delta: '+4', spark: [2, 3, 5, 6, 8, 9] });
cy += 18;
cy = groupHeader(x, cy, 'Back', 2);
cy = exerciseRow(x, cy, { name: 'Barbell Row', value: '155 lb', metric: 'Top set', delta: '+5 lb', spark: [4, 4, 5, 6, 7, 8] });
cy = exerciseRow(x, cy, { name: 'Lat Pulldown', value: '120 lb', metric: 'Top set', spark: [5, 6, 6, 7, 7, 8] });

note(x, s1y + 636, '01',
  'Controls sit UNDER the heading they qualify — the old Filter button rendered above it. ' +
  'Each chip\'s LABEL IS ITS VALUE: the old trigger showed a count badge ("2"), which says how many ' +
  'things are filtered and nothing about what, so the tab\'s state could only be read by operating it. ' +
  'No card per exercise — 40 identical elevated surfaces is the generated look, and these are read-only ' +
  'data, so hairlines. The group header is a section label, not a filled pill.');

// ══ 02 · Collapsed row anatomy ════════════════════════════════════════
x = COL[1]; y = 48;
groupLabel(x, y, '02', 'Collapsed row — what it states without opening');
y += 26;
slot(x, y, 150, '02 / row anatomy');
exerciseRow(x, y + 30, { name: 'Bench Press', value: '205 lb', metric: 'Top set', delta: '+10 lb', spark: [3, 4, 4, 6, 7, 9] });
text(x + 16, y + 100, 'name · current value · what it measures · change · sparkline',
  { size: 11, colour: 'color.muted-foreground', width: 358 });
note(x, y + 166, '02',
  'A bare figure in a box is decoration; a number earns screen space only with trend, history or ' +
  'comparison attached. So the collapsed row carries all four, and the chart becomes optional rather ' +
  'than the only way to learn anything. The sparkline is a hand-rolled SVG polyline (~40 lines, no ' +
  'dependency) and is aria-hidden — the value and the delta are stated in text beside it, so it is ' +
  'never the sole carrier of anything. The delta is ABSENT on a first session: there is nothing to ' +
  'compare against, and "+205" would be a claim about a comparison that does not exist.');

// ══ 03 · Expanded row ═════════════════════════════════════════════════
y += 300;
groupLabel(x, y, '03', 'Expanded row');
y += 26;
const s3y = y;
slot(x, y, 400, '03 / expanded');
let ey = y + 16;
exerciseRow(x, ey, { name: 'Bench Press', value: '205 lb', metric: 'Top set', delta: '+10 lb', spark: [3, 4, 4, 6, 7, 9] });
ey += 56;
// Metric switch — only when the exercise's own sets support >1.
const metrics = ['TOP SET', 'EST. 1RM', 'VOLUME'];
let mx = x + 16;
metrics.forEach((m, i) => {
  const w = 16 + m.length * 6;
  if (i === 0) rect(mx, ey, w, 22, 'color.secondary', 1, 2);
  text(mx + 8, ey + 5, m, { size: 10, weight: '700', colour: i === 0 ? 'color.foreground' : 'color.muted-foreground' });
  mx += w + 4;
});
ey += 34;
chart(x + 16, ey, 358, 170, [180, 185, 185, 195, 200, 205]);
ey += 190;
hairline(x + 16, ey, 358, 'color.border');
text(x + 16, ey + 10, 'Latest sets', { size: 11, weight: '500', colour: 'color.muted-foreground' });
['185 lb × 5', '195 lb × 5', '205 lb × 3'].forEach((s, i) => {
  const w = 16 + s.length * 6;
  rect(x + 16 + i * (w + 4), ey + 28, w, 22, 'color.secondary', 1, 2);
  text(x + 24 + i * (w + 4), ey + 33, s, { size: 10, weight: '500' });
});
note(x, s3y + 416, '03',
  'The metric switch renders ONLY when the exercise\'s own sets support more than one measure — a ' +
  'switch with one option is chrome. Bodyweight work always lands there: weight, volume and 1RM are ' +
  'identically zero for it, so it is offered Reps and nothing else. recharts mounts on FIRST EXPAND ' +
  'and stays mounted; entering the tab used to mount one LineChart per exercise ever logged, all ' +
  'expanded, on screen or not.');

// ══ 04 · Chart anatomy ════════════════════════════════════════════════
x = COL[2]; y = 48;
groupLabel(x, y, '04', 'Chart anatomy — one series, one axis');
y += 26;
slot(x, y, 250, '04 / chart');
chart(x + 16, y + 30, 358, 180, [180, 185, 185, 195, 200, 205]);
note(x, y + 266, '04',
  'ONE series on ONE axis. The card this replaces drew max weight against a left scale and max reps ' +
  'against a right one — with two independent domains the crossings, the gaps and the relative slopes ' +
  'are artefacts of where the scales happened to land. A single series also means NO LEGEND: the ' +
  'switch names the metric, and a legend box spent a tenth of a 200 px plot restating it.\n\n' +
  'The x axis is REAL TIME, not a category axis of formatted date strings — recharts spaces categories ' +
  'evenly, so three sessions across ninety days drew as three equidistant points and a lift touched ' +
  'twice in January and once in March looked like steady weekly progress. Every x tick is a real ' +
  'session date, because automatic numeric ticks land on round milliseconds and would name days ' +
  'nobody trained.\n\n' +
  'Marks: 2 px line · 8 pt dots with a 2 px surface ring · grid horizontal only at 50% border · ' +
  'a session with no value for the metric BREAKS the line rather than being drawn through. ' +
  'The value axis is deliberately not zero-based — "did it go up" is the question — so both real ' +
  'bounds are always ticked.');

// ══ 05 · The four empty states ════════════════════════════════════════
y += 560;
groupLabel(x, y, '05', 'The states — all four were one');
y += 26;
const s5y = y;
slot(x, y, 340, '05 / states');
let sy = y + 16;
const state = (title, body) => {
  text(x + 16, sy, title, { size: 11, weight: '700', colour: 'color.primary' }); sy += 16;
  text(x + 16, sy, body, { size: 12, width: 358, colour: 'color.foreground' }); sy += 40;
  hairline(x + 16, sy - 12, 358, 'color.border');
};
state('ONE SESSION', 'One session so far. Log this lift again and the trend appears here.');
state('NONE IN PERIOD', 'No exercises logged in this period.');
state('NO MATCH', 'No exercises match these filters in this period.   [Clear filters]');
state('NEVER LOGGED', 'No exercise data yet + the four how-to-log steps.');
note(x, s5y + 356, '05',
  'These were ONE state. "No exercise data yet" plus four steps on how to log a workout is right for ' +
  'someone who has never logged one and exactly wrong for someone whose filter excluded everything — ' +
  'which, with the regimen filter comparing against a column workout_logs does not have, is what ' +
  'everyone got. It is also wrong for someone who simply trained nothing in the last seven days.\n\n' +
  'ONE SESSION is the state most real users are in: at the time of writing, production held three ' +
  'workout_logs and two exercise rows, so no exercise had two points. The old copy called it ' +
  '"no sets recorded" at a session that recorded sets.');

// ══ 06 · Filter chip and its sheet ════════════════════════════════════
x = COL[0]; y = 740;
groupLabel(x, y, '06', 'Filter chip → BottomSheet');
y += 26;
const s6y = y;
slot(x, y, 330, '06 / filter');
chip(x + 16, y + 16, 'All muscle groups');
rect(x + 16, y + 70, 358, 240, 'color.background', 1, 16);
rect(x + 180, y + 80, 30, 4, 'color.border', 1, 2);
text(x + 32, y + 96, 'Muscle group', { size: 14, weight: '700' });
['All muscle groups', 'Chest', 'Back', 'Legs', 'Shoulders'].forEach((label, i) => {
  const ry = y + 124 + i * 34;
  hairline(x + 32, ry, 326, 'color.border');
  text(x + 32, ry + 10, label, { size: 13, colour: i === 0 ? 'color.primary' : 'color.foreground', weight: i === 0 ? '600' : '400' });
  if (i === 0) text(x + 344, ry + 10, '✓', { size: 12, colour: 'color.primary' });
});
note(x, s6y + 346, '06',
  'A BottomSheet, not a hand-rolled popover. The old one positioned itself `fixed` off a ' +
  'getBoundingClientRect, re-measured on scroll and resize, and had no aria-expanded, no role, no ' +
  'Escape handler, no focus trap and no focus restore — and it dismissed on `mousedown` only. ' +
  'BottomSheet already solves all of that and is the idiom the rest of this phone-only app uses. ' +
  'Rows are 48 pt: a floor, not a gap, so it does not move with the spacing scale.\n\n' +
  'The period is NOT here. It binds to the page\'s existing Wk/Mo/Yr/All frame — the tab used to ship ' +
  'its own 7/30/90/365 range defaulting to 90 while the hero card above defaulted to week, so one ' +
  'page gave two answers to "what period am I looking at".');

// ══ 07 · Decisions ledger ═════════════════════════════════════════════
x = COL[1]; y = 1180;
groupLabel(x, y, '07', 'Decisions');
y += 26;
const LEDGER = [
  'Metric is derived, never fixed. All-zero-weight → Reps. Otherwise Top set, plus Est. 1RM and Volume only when each resolves on two sessions. A metric that would draw zeros is not offered.',
  'Primary metric needs ONE resolving session (a headline is worth showing); an alternative needs TWO (a switch that lands on one dot offers nothing).',
  'One series, one axis. No dual-axis, no legend.',
  'Real time x axis. Ticks are real session dates.',
  'parseLocalDate everywhere. A DATE column is UTC midnight to `new Date()` — every point was labelled a day early west of UTC.',
  'Collapsed rows earn their data; recharts mounts on first expand.',
  'Hairlines, not cards. Group headers are section labels.',
  'The Filter dropdown is gone. Chips show their own value; the period comes from the page.',
  'The regimen filter is gone — it compared against workout_logs.regimen_name, which is not a column. Its replacement derives options FROM THE LOGS, so an option that cannot return a row is never offered.',
  'No scroll-jacking. The old code scrolled the window on every filter change and again 450 ms after any accordion opened.',
  'Group label = the most COMMON first-listed muscle, not the most recent session\'s.',
];
LEDGER.forEach((line, i) => {
  const ly = y + i * 62;
  text(x, ly, String(i + 1).padStart(2, '0'), { size: 11, weight: '700', colour: 'color.primary' });
  text(x + 26, ly, line, { size: 11, colour: 'color.foreground', width: 360 });
});

note(x, y + LEDGER.length * 62 + 20, '07',
  'Audit and evidence: docs/exercise-trends-audit.md. Code: src/lib/exerciseTrend.js (the metric ' +
  'rule, with tests), src/components/progress/ExerciseTrends{Tab,Row,Chart}.jsx, Sparkline.jsx, ' +
  'TrendFilterChip.jsx.');

return {
  board: BOARD_NAME,
  at: { x: board.x, y: board.y, w: BOARD_W, h: BOARD_H },
  children: board.children.length,
  missingTokens,
  next: 'Export the board and LOOK at it — structural checks pass on boards whose text is wrong.',
};
