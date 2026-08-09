// docs/penpot-journal-past-days-board.js
//
// Builds "My Journal — past days (group 09 resolved)" on Page 2 at
// x=11640, resolving the one open product call left on the My Journal
// slots board.
//
// ── HOW TO RUN ────────────────────────────────────────────────────
// The plugin's active page follows the BROWSER TAB and re-syncs between
// tool calls, so `penpot.openPage()` holds only INSIDE a single call. A
// switch in one call and a draw in the next stranded an empty board on
// whatever page the tab was showing. Either select Page 2 in the UI, or
// await openPage and re-assert currentPage in the SAME call as the draw.
//
// SELECT "Page 2" IN THE PENPOT UI FIRST, then paste this whole file
// into the Penpot MCP `execute_code` tool. Idempotent — it removes any
// previous board of the same name first, which also makes it safe to
// re-run after a bridge timeout (a timed-out call may have fully
// landed its writes; this one drew screen A before the bridge died).
//
// ── THE CALL ──────────────────────────────────────────────────────
// Editable for 7 days back, read-only beyond.
//
// The lock was never designed. `readOnly = !isToday` is one expression
// with no comment, and journal entries feed nothing scored — Readiness
// reads mood_logs, not journal_entries.mood_score, and no XP, coin or
// leaderboard path touches this table. So none of the invariants that
// justify a server-side lock elsewhere in this app apply here.
//
// What DOES argue for a boundary is what a journal is. An entry you can
// silently rewrite years later is not a record. Seven days covers the
// case the feature actually has — writing up last night's session the
// next morning, or the weekend you forgot — and matches the weekly frame
// the rest of the app already uses ("This week 0 / 3").
//
// Past the window the day is read-only AND SAYS SO, as a rule rather
// than a failure — the same standard the League seasons board set for
// locked and dead-end states. A greyed-out toolbar is not an
// explanation; it reads as the app being broken.
//
// One asymmetry this had to resolve: `upsertMoodLog` hard-coded today,
// so "edit yesterday's words but not yesterday's mood" would have been
// the accidental result. It now takes an optional date defaulting to
// today, so MoodLogCard is untouched and the window is coherent.

const PAGE = 'Page 2';
const NAME = 'My Journal — past days (group 09 resolved)';
// 60 pad + 390 + 10 + 390 (screens, right edge 850) + 10 + 300 rationale
// + 60 pad. It was 900, which put the entire third column outside the
// board — every one of its twelve shapes failed the containment pass.
const BX = 11640, BY = 0, BW = 1220;

const page = penpotUtils.getPageByName(PAGE);
if (!page) throw new Error(`page "${PAGE}" not found`);
if (penpot.currentPage.id !== page.id) {
  return { aborted: true, reason: `Select "${PAGE}" in the Penpot UI first, then re-run.`, on: penpot.currentPage.name };
}
const old = penpotUtils.findShape(s => s.name === NAME, page.root);
if (old) old.remove();

const tok = (n) => penpotUtils.findTokenByName(n);
const darkSet = penpot.library.local.tokens.sets.find(s => s.name === 'theme.dark');
const rc = (n) => {
  const t = (darkSet && darkSet.tokens.find(x => x.name === n)) || tok(n);
  return t ? t.resolvedValue : '#888888';
};
const C = {
  background: rc('color.background'), foreground: rc('color.foreground'),
  card: rc('color.card'), border: rc('color.border'), secondary: rc('color.secondary'),
  mutedFg: rc('color.muted-foreground'), primary: rc('color.primary'), destructive: rc('color.destructive'),
};
const ax = (x) => BX + x, ay = (y) => BY + y;

const board = penpot.createBoard();
board.name = NAME; board.x = BX; board.y = BY; board.resize(BW, 1180);   // verified: 0 escapes, 0 rect intersections
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
  if (o.align) { t.align = o.align; try { t.getRange(0, chars.length).align = o.align; } catch (e) { /* range may not be ready */ } }
  if (o.token) { const k = tok(o.token); if (k) t.applyToken(k, ['fill']); }
  t.name = o.name || `t / ${chars.slice(0, 22)}`;
  return t;
}
function rect(o) {
  const r = penpot.createRectangle();
  r.x = ax(o.x); r.y = ay(o.y); r.resize(o.w, o.h);
  r.borderRadius = o.radius == null ? 0 : o.radius;
  r.fills = o.fill === null ? [] : [{ fillColor: o.fill || C.secondary, fillOpacity: 1 }];
  if (o.stroke) r.strokes = [{ strokeColor: o.stroke, strokeOpacity: 1, strokeWidth: 1, strokeAlignment: 'center', strokeStyle: o.strokeStyle || 'solid' }];
  if (o.token && o.fill !== null) { const k = tok(o.token); if (k) r.applyToken(k, ['fill']); }
  r.name = o.name || 'rect';
  return r;
}
function ell(o) {
  const e = penpot.createEllipse();
  e.x = ax(o.x); e.y = ay(o.y); e.resize(o.d, o.d);
  e.fills = o.fill === null ? [] : [{ fillColor: o.fill || C.secondary, fillOpacity: 1 }];
  if (o.stroke) e.strokes = [{ strokeColor: o.stroke, strokeOpacity: 1, strokeWidth: 1, strokeAlignment: 'center', strokeStyle: o.strokeStyle || 'dashed' }];
  e.name = o.name || 'ellipse';
  return e;
}
function screen(name, x, y) {
  const s = penpot.createBoard();
  s.name = name; s.x = ax(x); s.y = ay(y); s.resize(390, 844);
  s.fills = [{ fillColor: C.background, fillOpacity: 1 }];
  s.borderRadius = 14;
  s.strokes = [{ strokeColor: C.border, strokeOpacity: 1, strokeWidth: 1, strokeAlignment: 'center' }];
  const k = tok('color.background'); if (k) s.applyToken(k, ['fill']);
  board.appendChild(s);
  return s;
}
// Bind a screen's local coordinates so a slip between the two screens is
// impossible — the first attempt at this board carried AX/AT/AR and BX/BT/BR
// side by side, which is one typo away from drawing screen B into screen A.
function pen(s, ox, oy) {
  return {
    T: (c, o) => s.appendChild(txt(c, { ...o, x: ox + o.x, y: oy + o.y })),
    R: (o) => s.appendChild(rect({ ...o, x: ox + o.x, y: oy + o.y })),
    E: (o) => s.appendChild(ell({ ...o, x: ox + o.x, y: oy + o.y })),
  };
}

board.appendChild(txt('Past days — group 09 resolved', { x: 60, y: 44, size: 26, weight: 700, color: C.foreground, w: 700, token: 'color.foreground' }));
board.appendChild(txt(
  'THE CALL: editable for 7 days back, read-only beyond. Journal entries feed nothing scored — Readiness reads mood_logs, not\n' +
  'journal_entries.mood_score — so there was never an anti-cheat reason for the lock; `readOnly = !isToday` was incidental, not designed.\n' +
  'Seven days covers the case the feature actually has (writing up last night, or the weekend you forgot) and matches the weekly frame the\n' +
  'app already uses. Older than that the entry stays a record: a journal you can silently rewrite forever is a different promise.',
  { x: 60, y: 84, size: 12, color: C.mutedFg, w: 780, token: 'color.muted-foreground' }));

// ── A · inside the window ─────────────────────────────────────────
const AXo = 60, AYo = 180;
const a = screen('screen / inside the window · editable (yesterday)', AXo, AYo);
{
  const { T, R, E } = pen(a, AXo, AYo);
  T('‹', { x: 14, y: 12, size: 20, color: C.mutedFg, w: 14, token: 'color.muted-foreground' });
  T('Back', { x: 30, y: 17, size: 13, color: C.mutedFg, w: 40, token: 'color.muted-foreground' });
  T('Log', { x: 336, y: 17, size: 13, color: C.mutedFg, w: 38, align: 'right', token: 'color.muted-foreground' });
  T('Saturday, August 8', { x: 16, y: 48, size: 22, weight: 700, color: C.foreground, w: 270, token: 'color.foreground' });
  T('Yesterday · Saved', { x: 16, y: 84, size: 11, color: C.mutedFg, w: 170, token: 'color.muted-foreground', name: 't / relative label' });
  E({ x: 330, y: 46, d: 44, fill: C.secondary, strokeStyle: 'solid', token: 'color.secondary', name: 'mood chip / settable inside the window' });
  T('🙂', { x: 341, y: 57, size: 20, w: 24, align: 'center' });
  R({ x: 0, y: 112, w: 390, h: 1, fill: C.border, token: 'color.border' });

  T('Title your day…', { x: 16, y: 132, size: 17, weight: 700, color: C.mutedFg, opacity: 0.5, w: 260 });
  R({ x: 16, y: 166, w: 168, h: 48, radius: 12, fill: C.secondary, token: 'color.secondary', name: 'toolbar / present on a past day now' });
  ['bullets', 'bold', 'dictate', 'attach'].forEach((n, i) =>
    R({ x: 24 + i * 40, y: 174, w: 32, h: 32, radius: 8, fill: C.card, token: 'color.card', name: `toolbar / ${n} 32` }));
  T('How was your session?', { x: 16, y: 234, size: 13, color: C.mutedFg, opacity: 0.6, w: 300 });

  T('FROM THAT DAY', { x: 16, y: 600, size: 11, weight: 700, color: C.mutedFg, w: 170, token: 'color.muted-foreground', name: 't / label follows the day' });
  R({ x: 16, y: 622, w: 358, h: 1, fill: C.border, token: 'color.border' });
  [
    { x: 16, y: 636, w: 150, l: 'Back Squat' },
    { x: 174, y: 636, w: 94, l: '9 sets' },
    { x: 16, y: 680, w: 176, l: '14,200 lb volume' },
    { x: 200, y: 680, w: 122, l: 'Slept 6.5 h' },
  ].forEach((c, i) => {
    R({ x: c.x, y: c.y, w: c.w, h: 34, radius: 10, fill: null, stroke: C.border, name: `chip / context ${i + 1}` });
    T(c.l, { x: c.x + 12, y: c.y + 9, size: 13, color: C.foreground, w: c.w - 24, token: 'color.foreground' });
  });
  T('The same block, keyed to THAT day — dayContext already takes a date. What changes is the label, not the query.',
    { x: 16, y: 728, size: 11, color: C.mutedFg, w: 350, token: 'color.muted-foreground' });
}

// ── B · past the window ───────────────────────────────────────────
const BXo = 460, BYo = 180;
const b = screen('screen / past the window · read-only, stated as a rule', BXo, BYo);
{
  const { T, R, E } = pen(b, BXo, BYo);
  T('‹', { x: 14, y: 12, size: 20, color: C.mutedFg, w: 14, token: 'color.muted-foreground' });
  T('Back', { x: 30, y: 17, size: 13, color: C.mutedFg, w: 40, token: 'color.muted-foreground' });
  T('Log', { x: 336, y: 17, size: 13, color: C.mutedFg, w: 38, align: 'right', token: 'color.muted-foreground' });
  T('Tuesday, July 28', { x: 16, y: 48, size: 22, weight: 700, color: C.foreground, w: 270, token: 'color.foreground' });
  T('12 days ago', { x: 16, y: 84, size: 11, color: C.mutedFg, w: 140, token: 'color.muted-foreground' });
  E({ x: 330, y: 46, d: 44, fill: C.secondary, strokeStyle: 'solid', token: 'color.secondary', name: 'mood chip / shown, not settable' });
  T('😄', { x: 341, y: 57, size: 20, w: 24, align: 'center' });
  R({ x: 0, y: 112, w: 390, h: 1, fill: C.border, token: 'color.border' });

  T('Leg day', { x: 16, y: 132, size: 17, weight: 700, color: C.foreground, w: 300, token: 'color.foreground' });
  T('Squats felt heavy from the first warm-up. Backed off to 80% and called it early — right call.',
    { x: 16, y: 172, size: 13, color: C.foreground, w: 350, token: 'color.foreground' });
  T('•  Front squat 4x6', { x: 16, y: 226, size: 13, color: C.foreground, w: 340, token: 'color.foreground' });

  // The rule. Stated, not implied by an absence of controls.
  R({ x: 16, y: 700, w: 358, h: 1, fill: C.border, token: 'color.border', name: 'hairline / rule' });
  T('Locked', { x: 16, y: 714, size: 11, weight: 700, color: C.mutedFg, w: 120, token: 'color.muted-foreground' });
  T('Entries older than 7 days are read-only.', { x: 16, y: 734, size: 13, color: C.foreground, w: 340, token: 'color.foreground', name: 't / the rule' });
  T('Reads as a RULE, not a failure — the standard the League seasons board set for locked and dead-end states. A greyed-out toolbar with no sentence reads as the app being broken.',
    { x: 16, y: 760, size: 11, color: C.mutedFg, w: 350, token: 'color.muted-foreground' });
}

// ── rationale column ──────────────────────────────────────────────
{
  let y = 180;
  const X = 860;
  const row = (h, bText) => {
    board.appendChild(txt(h, { x: X, y, size: 12, weight: 700, color: C.foreground, w: 300, token: 'color.foreground' }));
    y += 20;
    board.appendChild(txt(bText, { x: X, y, size: 11, color: C.mutedFg, w: 300, token: 'color.muted-foreground' }));
    y += Math.ceil(bText.length / 52) * 14 + 24;
  };
  board.appendChild(txt('WHY 7, AND WHAT IT TOUCHES', { x: X, y, size: 11, weight: 700, color: C.mutedFg, w: 300, token: 'color.muted-foreground' }));
  y += 18;
  board.appendChild(rect({ x: X, y, w: 300, h: 1, fill: C.border, token: 'color.border' }));
  y += 16;
  row('Nothing scored reads this table', 'No XP, coin, achievement or leaderboard path touches journal_entries, and Readiness reads mood_logs. The invariants that justify a server lock elsewhere do not apply, so this is a product decision and not a security one.');
  row('The edge has to speak', 'Past the window the screen states the rule in a sentence. Removing the controls and saying nothing was the old behaviour on EVERY past day, and it read as breakage.');
  row('Mood had to come along', 'upsertMoodLog hard-coded today, so the window would have meant "edit yesterday\'s words but not yesterday\'s mood". It now takes an optional date defaulting to today — MoodLogCard is untouched.');
  row('Day stepping changes inside the window', 'The arrows skip days with no entry so you never land on a blank page. Inside the window a blank day is now actionable, so stepping is day-by-day there and only skips beyond it.');
  row('Still not done', 'No edit marker. If an entry is amended four days later, nothing records that. Worth a slot on the next pass — see group 09 slot C.');
}

board.resize(BW, 1180);   // verified: 0 escapes, 0 rect intersections
return {
  board: NAME, x: BX, width: BW, height: 1180,
  screens: 2,
  next: 'Export each 390pt screen on its own and LOOK — the full board scales text to nothing.',
};
