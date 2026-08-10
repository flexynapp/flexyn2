// docs/penpot-injuries-board.js
//
// Builds "Injuries & Recovery — resolved" on its own page.
//
// ── HOW TO RUN ────────────────────────────────────────────────────
// Paste into the Penpot MCP plugin console. Creates the page if it does
// not exist, then SELECT that page in the Penpot UI and re-run — the
// plugin's active page follows the browser tab and re-syncs between
// calls, so `openPage()` only holds inside a single call. Idempotent:
// it removes any previous board of the same name, which makes it safe
// to re-run after a bridge timeout (a timed-out call may still have
// landed its writes).
//
// ── WHAT THE AUDIT FOUND, AND WHAT THIS ANSWERS ───────────────────
// Six injuries exist in production. Every design decision below is
// forced by something measured against them, not by taste:
//
//   1. 0 OF 6 CARRY AN estimated_recovery_date. The field is an
//      unlabelled date picker offered with no reason to fill it, so
//      nobody does — and it is the trigger for the ENTIRE check-in
//      system. The 3-day warning, the clearance prompt, the "Nd until
//      recovery" line and the Extend-date control are all live, all
//      correct, and not one of them has ever fired for any user. Four
//      duration chips replace the picker; "Not sure" still schedules a
//      check-in, because the honest answer must not switch the feature
//      off.
//   2. MILD AND MODERATE ARE THE SAME COLOUR. Both severity chips are
//      `text-primary border-primary/30 bg-primary/10`, so the choice
//      that decides whether a body part is removed from every session
//      looks like no choice at all.
//   3. NOTHING SHOWS WHAT THE INJURY DID. A toast, then a banner.
//      CLAUDE.md's own rule for the Coach — "an automatic change to
//      someone's training that isn't explained reads as a bug" — was
//      never applied to the thing that makes the largest automatic
//      change there is. Sheet C is that screen.
//   4. "PROGRESS → RECOVERY" DOES NOT EXIST. Onboarding says it twice
//      (the 5-injury cap message and the save-failure toast). There is
//      no such route and no such tab. Injuries live in Profile → My
//      Injuries and the Workout-tab banner.
//   5. THREE OF THE EIGHT BODY PARTS WERE INERT. Biceps, Triceps and
//      Glutes matched no exercise, so reporting them changed nothing.
//      Fixed in code on 2026-08-09; the list now states what each
//      injury actually costs, which is only honest once it costs
//      something.
//
// The one thing here that is NOT resolved is marked PROPOSED on sheet
// B: making `mild` train-around-at-reduced-load instead of removing the
// group. It is what InjuryForm's own description promises ("Some
// soreness, can train around it"), what onboarding promises, and what
// starterPlanCoach already does — but the runtime generator removes the
// group at every severity, and its test pins that deliberately. It
// changes injury protection, so it needs a human yes.

const PAGE = 'Injuries & Recovery';
const NAME = 'Injuries & Recovery — resolved';
const BX = 0, BY = 0, BW = 1620, BH = 1180;

let page = penpotUtils.getPageByName(PAGE);
if (!page) {
  page = penpot.createPage();
  page.name = PAGE;
  return {
    created: PAGE,
    next: `Select "${PAGE}" in the Penpot UI, then re-run this script to draw the board.`,
  };
}
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
  primary: rc('color.primary'), destructive: rc('color.destructive'), success: rc('color.success'),
};
const ax = (x) => BX + x, ay = (y) => BY + y;

const board = penpot.createBoard();
board.name = NAME; board.x = BX; board.y = BY; board.resize(BW, BH);
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
  if (o.stroke) r.strokes = [{ strokeColor: o.stroke, strokeOpacity: o.strokeOpacity == null ? 1 : o.strokeOpacity, strokeWidth: 1, strokeAlignment: 'center' }];
  if (o.token && o.fill !== null) { const k = tok(o.token); if (k) r.applyToken(k, ['fill']); }
  r.name = o.name || 'rect';
  return r;
}
// Full-screen surfaces at the phone size the app actually ships to.
// 390 × 844 is the iPhone 15; the fluid scale (CLAUDE.md) is what makes
// the same layout survive a 667 SE, so these are drawn at the design max.
function sheet(name, x, y, h) {
  const s = penpot.createBoard();
  s.name = name; s.x = ax(x); s.y = ay(y); s.resize(390, h || 844);
  s.fills = [{ fillColor: C.background, fillOpacity: 1 }];
  s.borderRadius = 16;
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

board.appendChild(txt('Injuries & Recovery — resolved', { x: 60, y: 44, size: 26, weight: 700, color: C.foreground, w: 700, token: 'color.foreground' }));
board.appendChild(txt(
  'Three screens. The list stops being a receipt and starts saying what each injury COSTS; the form stops asking for a date nobody has ever\n' +
  'filled in and asks how long instead; and a third screen — which does not exist today — shows what the injury just did to your sessions.\n' +
  'Measured against the six injuries in production: 0 carry a recovery date, so the whole check-in system has never fired for anyone.',
  { x: 60, y: 84, size: 12, color: C.mutedFg, w: 1080, token: 'color.muted-foreground' }));

// ── A · the list ──────────────────────────────────────────────────
const AXo = 60, AYo = 180;
{
  const a = sheet('A · Injuries — the list', AXo, AYo);
  const { T, R } = pen(a, AXo, AYo);

  T('‹  Close', { x: 16, y: 20, size: 13, weight: 500, color: C.mutedFg, w: 100, token: 'color.muted-foreground' });
  T('Injuries', { x: 145, y: 18, size: 16, weight: 700, color: C.foreground, w: 100, align: 'center', token: 'color.foreground' });
  T('＋ Log', { x: 300, y: 20, size: 13, weight: 500, color: C.primary, w: 74, align: 'right', token: 'color.primary' });
  R({ x: 0, y: 50, w: 390, h: 1, fill: C.border, token: 'color.border' });

  let y = 74;
  T('ACTIVE', { x: 16, y, size: 11, weight: 700, color: C.mutedFg, w: 200, token: 'color.muted-foreground' });
  y += 24; // intra→inter boundary: 8px register below, 24 between sections

  // The card leads with the CONSEQUENCE, not the label. "Shoulders ·
  // serious" is a receipt for something the user already knows; "8
  // exercises are out of your sessions" is the thing they cannot see
  // anywhere else in the app.
  const injuryCard = (part, sev, sevColor, sevFill, cost, age, eta, tall) => {
    const h = tall ? 150 : 122;
    R({ x: 16, y, w: 358, h, radius: 12, fill: C.card, token: 'color.card', stroke: C.border, name: `card / ${part}` });
    T(part, { x: 32, y: y + 14, size: 15, weight: 700, color: C.foreground, w: 200, token: 'color.foreground' });
    // Severity: outline / filled / destructive — three visibly different
    // weights inside the SAME hue budget. Mild and moderate are currently
    // the identical primary chip, so the choice reads as decoration.
    R({ x: 268, y: y + 13, w: 90, h: 22, radius: 999, fill: sevFill, fillOpacity: sevFill === null ? 0 : 0.12, stroke: sevColor, strokeOpacity: 0.45, name: `chip / ${sev}` });
    T(sev, { x: 268, y: y + 18, size: 11, weight: 700, color: sevColor, w: 90, align: 'center' });
    T(cost, { x: 32, y: y + 40, size: 13, weight: 500, color: C.foreground, w: 326, token: 'color.foreground' });
    T(age + (eta ? '  ·  ' + eta : ''), { x: 32, y: y + 60, size: 11, color: C.mutedFg, w: 326, token: 'color.muted-foreground' });
    // Two buttons, because "are you better yet?" is the question the app
    // needs answered and it currently only asks when a recovery date
    // exists — which is never.
    R({ x: 32, y: y + 84, w: 155, h: 32, radius: 8, fill: C.secondary, token: 'color.secondary', name: 'button / cleared' });
    T('I’m cleared', { x: 32, y: y + 93, size: 12, weight: 700, color: C.foreground, w: 155, align: 'center', token: 'color.foreground' });
    R({ x: 203, y: y + 84, w: 155, h: 32, radius: 8, fill: null, stroke: C.border, name: 'button / still hurts' });
    T('Still hurts', { x: 203, y: y + 93, size: 12, weight: 500, color: C.mutedFg, w: 155, align: 'center', token: 'color.muted-foreground' });
    y += h + 8; // 8 = intra-group register
  };

  injuryCard('Shoulders', 'serious', C.destructive, C.destructive,
    '8 exercises are out of your sessions', 'Logged 16 days ago', 'check-in due');
  injuryCard('Glutes', 'mild', C.mutedFg, null,
    '3 exercises are out of your sessions', 'Logged 3 days ago', null);

  y += 16; // 8 + 16 = the 24 inter-section register
  T('CLEARED', { x: 16, y, size: 11, weight: 700, color: C.mutedFg, w: 200, token: 'color.muted-foreground' });
  y += 24;
  // Collapsed by default. Cleared injuries are history, and history under
  // a live list competes for the same attention as the thing that is
  // currently changing your training.
  R({ x: 16, y, w: 358, h: 44, radius: 12, fill: null, stroke: C.border, strokeOpacity: 0.6, name: 'row / cleared, collapsed' });
  T('3 cleared', { x: 32, y: y + 14, size: 13, weight: 500, color: C.mutedFg, w: 200, token: 'color.muted-foreground' });
  T('Show  ›', { x: 268, y: y + 14, size: 12, weight: 500, color: C.mutedFg, w: 90, align: 'right', token: 'color.muted-foreground' });
  y += 68;

  R({ x: 16, y, w: 358, h: 1, fill: C.border, token: 'color.border' });
  y += 16;
  T('Coach knows about both of these.', { x: 16, y, size: 12, weight: 700, color: C.foreground, w: 358, token: 'color.foreground' });
  T('Ask it what to train instead  ›', { x: 16, y: y + 18, size: 12, color: C.primary, w: 358, token: 'color.primary' });

  T('The costs are only sayable since the exclusion fix — Biceps, Triceps and Glutes matched no exercise at all, so a Glutes injury cost exactly nothing and a card claiming otherwise would have been a lie.',
    { x: 16, y: 760, size: 11, color: C.mutedFg, w: 358, token: 'color.muted-foreground' });
}

// ── B · the form ──────────────────────────────────────────────────
const BXo = 460, BYo = 180;
{
  const b = sheet('B · Log an injury', BXo, BYo);
  const { T, R } = pen(b, BXo, BYo);

  T('‹  Back', { x: 16, y: 20, size: 13, weight: 500, color: C.mutedFg, w: 100, token: 'color.muted-foreground' });
  T('Log an injury', { x: 125, y: 18, size: 16, weight: 700, color: C.foreground, w: 140, align: 'center', token: 'color.foreground' });
  R({ x: 0, y: 50, w: 390, h: 1, fill: C.border, token: 'color.border' });

  let y = 74;
  T('WHERE', { x: 16, y, size: 11, weight: 700, color: C.mutedFg, w: 200, token: 'color.muted-foreground' });
  y += 24;
  // Eight parts, wrapped and centred — tileRow(), never grid-cols-N. A
  // grid packs the last row into its leading columns, which is what put
  // two chips against the left edge with a dead column beside them
  // everywhere else in the app (CLAUDE.md, UI composition).
  const parts = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Glutes', 'Core'];
  let cx = 16, cy = y;
  parts.forEach((p, i) => {
    const w = 24 + p.length * 8;
    if (cx + w > 374) { cx = 16; cy += 40; }
    const on = p === 'Shoulders';
    R({ x: cx, y: cy, w, h: 32, radius: 999, fill: on ? C.primary : null, stroke: on ? null : C.border, name: `chip / ${p}` });
    T(p, { x: cx, y: cy + 8, size: 13, weight: on ? 700 : 500, color: on ? C.background : C.foreground, w, align: 'center' });
    cx += w + 8;
  });
  y = cy + 32 + 24;

  T('HOW BAD', { x: 16, y, size: 11, weight: 700, color: C.mutedFg, w: 200, token: 'color.muted-foreground' });
  y += 24;
  // Each row states the CONSEQUENCE, because that is the only thing the
  // choice actually controls. Today all three say only how it feels, and
  // two of them are drawn in the identical primary chip.
  const sevRow = (label, consequence, color, fill, selected) => {
    R({ x: 16, y, w: 358, h: 60, radius: 12, fill: fill === null ? null : fill, fillOpacity: fill === null ? 0 : 0.12, stroke: selected ? color : C.border, name: `severity / ${label}` });
    T(label, { x: 32, y: y + 12, size: 14, weight: 700, color: selected ? color : C.foreground, w: 200 });
    T(consequence, { x: 32, y: y + 33, size: 12, color: C.mutedFg, w: 326, token: 'color.muted-foreground' });
    y += 68;
  };
  sevRow('Mild', 'PROPOSED: stays in, at lighter loads.', C.mutedFg, null, false);
  sevRow('Moderate', 'That area comes out of your sessions.', C.primary, C.primary, false);
  sevRow('Serious', 'That area and everything it helps move comes out.', C.destructive, C.destructive, true);
  y += 4;

  T('HOW LONG', { x: 16, y, size: 11, weight: 700, color: C.mutedFg, w: 200, token: 'color.muted-foreground' });
  y += 24;
  // Replaces a bare `<input type="date">`. 0 of 6 production injuries
  // carry one, and that single empty field is what silences the 3-day
  // warning, the clearance prompt, the countdown and the Extend control.
  const durs = ['A week', '2 weeks', '6 weeks', 'Not sure'];
  let dx = 16;
  durs.forEach((d, i) => {
    const on = i === 1;
    R({ x: dx, y, w: 84, h: 36, radius: 8, fill: on ? C.primary : null, fillOpacity: on ? 0.12 : 0, stroke: on ? C.primary : C.border, name: `chip / ${d}` });
    T(d, { x: dx, y: y + 11, size: 12, weight: on ? 700 : 500, color: on ? C.primary : C.foreground, w: 84, align: 'center' });
    dx += 92;
  });
  y += 44;
  T('“Not sure” still books a check-in in two weeks — an honest answer must not switch the feature off.',
    { x: 16, y, size: 11, color: C.mutedFg, w: 358, token: 'color.muted-foreground' });
  y += 40;

  T('ANYTHING ELSE  ·  optional', { x: 16, y, size: 11, weight: 700, color: C.mutedFg, w: 260, token: 'color.muted-foreground' });
  y += 24;
  R({ x: 16, y, w: 358, h: 64, radius: 12, fill: null, stroke: C.border, name: 'input / notes' });
  T('What happened? Coach reads this.', { x: 32, y: y + 12, size: 12, color: C.mutedFg, w: 326, opacity: 0.7, token: 'color.muted-foreground' });
  y += 88;

  R({ x: 16, y, w: 358, h: 52, radius: 12, fill: C.primary, token: 'color.primary', name: 'cta / log' });
  T('Log it', { x: 16, y: y + 17, size: 15, weight: 700, color: C.background, w: 358, align: 'center' });

  T('The notes field says “Coach reads this” because it now does — the digest carries severity, status and age, and the notes are the only place a user can say “left side, hurts overhead only”.',
    { x: 16, y: 770, size: 11, color: C.mutedFg, w: 358, token: 'color.muted-foreground' });
}

// ── C · what it changed ───────────────────────────────────────────
const CXo = 860, CYo = 180;
{
  const c = sheet('C · What it changed — NEW', CXo, CYo);
  const { T, R } = pen(c, CXo, CYo);

  T('Injury logged', { x: 16, y: 18, size: 16, weight: 700, color: C.foreground, w: 260, token: 'color.foreground' });
  T('Done', { x: 300, y: 20, size: 13, weight: 700, color: C.primary, w: 74, align: 'right', token: 'color.primary' });
  R({ x: 0, y: 50, w: 390, h: 1, fill: C.border, token: 'color.border' });

  let y = 82;
  T('Your sessions just changed.', { x: 16, y, size: 22, weight: 700, color: C.foreground, w: 358, token: 'color.foreground' });
  y += 34;
  T('A serious shoulder also takes out what the shoulder helps move — that is why chest and triceps are on this list.',
    { x: 16, y, size: 13, color: C.mutedFg, w: 358, token: 'color.muted-foreground' });
  y += 56;

  T('OUT, UNTIL YOU’RE CLEARED', { x: 16, y, size: 11, weight: 700, color: C.mutedFg, w: 300, token: 'color.muted-foreground' });
  y += 24;
  R({ x: 16, y, w: 358, h: 140, radius: 12, fill: C.card, token: 'color.card', stroke: C.border, name: 'panel / removed' });
  const removed = [
    'Overhead Press', 'Dumbbell Shoulder Press', 'Lateral Raise', 'Pike Push-up',
    'Bench Press', 'Incline Dumbbell Press', 'Tricep Pushdown', 'Skull Crusher',
  ];
  removed.forEach((n, i) => {
    T(n, { x: 32 + (i % 2) * 168, y: y + 16 + Math.floor(i / 2) * 28, size: 12, color: C.mutedFg, w: 160, token: 'color.muted-foreground' });
  });
  y += 156;

  T('STILL YOURS', { x: 16, y, size: 11, weight: 700, color: C.mutedFg, w: 300, token: 'color.muted-foreground' });
  y += 24;
  R({ x: 16, y, w: 358, h: 76, radius: 12, fill: null, stroke: C.border, name: 'panel / kept' });
  T('Back  ·  Legs  ·  Core  ·  Biceps', { x: 32, y: y + 16, size: 14, weight: 700, color: C.foreground, w: 326, token: 'color.foreground' });
  T('Enough for four full sessions a week.', { x: 32, y: y + 40, size: 12, color: C.mutedFg, w: 326, token: 'color.muted-foreground' });
  y += 100;

  R({ x: 16, y, w: 358, h: 52, radius: 12, fill: C.primary, token: 'color.primary', name: 'cta / coach' });
  T('Build me a session around it', { x: 16, y: y + 17, size: 15, weight: 700, color: C.background, w: 358, align: 'center' });
  y += 62;
  T('Not now', { x: 16, y: y + 6, size: 13, weight: 500, color: C.mutedFg, w: 358, align: 'center', token: 'color.muted-foreground' });

  T('This screen does not exist. Today logging an injury produces a toast and a banner, and the first time you see what it did is when a workout you did not ask for arrives without the lifts you expected. CLAUDE.md already requires the Coach to explain every automatic change it makes to someone’s training — this is the largest one in the app, and it was the one that never explained itself.',
    { x: 16, y: 740, size: 11, color: C.mutedFg, w: 358, token: 'color.muted-foreground' });
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
    ['Duration chips, not a date picker',
     '0 of 6 production injuries carry an estimated_recovery_date, and that one empty field silences the 3-day warning, the clearance prompt, the countdown and Extend. Four taps, and "Not sure" still books a check-in.'],
    ['Severity states its consequence',
     'It decides whether a body part leaves every session. Mild and moderate are currently the same primary chip, so the choice looks like decoration. Outline / filled / destructive — three weights, no fifth hue.'],
    ['A "what it changed" screen',
     'The largest automatic change the app makes to your training, and the only one that never explained itself. Naming the removed lifts is also the only way a user can catch a mis-tap.'],
    ['The list leads with cost, not label',
     '"Shoulders · serious" is a receipt for something they already know. "8 exercises are out" is the fact that exists nowhere else — and it only became true on 2026-08-09.'],
    ['Cleared injuries collapse',
     'History under a live list competes with the thing that is currently changing your training. One row, one tap.'],
    ['PROPOSED — mild trains around',
     'InjuryForm says "can train around it", onboarding says mild stays in, starterPlanCoach does exactly that. The runtime generator removes the group at every severity and its test pins that on purpose. Changing it weakens protection, so it needs a yes.'],
    ['Fix "Progress → Recovery"',
     'Onboarding names that route twice and it does not exist. Either point both strings at Profile → My Injuries, or give Injuries a real route. Copy is cheaper.'],
  ].forEach(([h, b]) => {
    board.appendChild(txt(h, { x: X, y, size: 12, weight: 700, color: C.foreground, w: 300, token: 'color.foreground' }));
    y += 20;
    board.appendChild(txt(b, { x: X, y, size: 11, color: C.mutedFg, w: 300, token: 'color.muted-foreground' }));
    y += Math.ceil(b.length / 52) * 14 + 24;
  });
}

board.resize(BW, BH);
return {
  board: NAME, page: PAGE, x: BX, width: BW, height: BH, sheets: 3,
  next: 'Export each 390pt sheet on its own and LOOK — the full board scales text to nothing.',
};
