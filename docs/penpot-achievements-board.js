// docs/penpot-achievements-board.js
//
// Builds the "Achievements — slots to draw" board in Penpot, in the same
// idiom as the existing "Badge system", "Toast & celebration" and
// "League seasons" boards: empty dashed slots, each holding the ANCHOR
// at its true app size, with surfaces and text bound to the Light/Dark
// mode tokens so one board draws both passes.
//
// ── HOW TO RUN ────────────────────────────────────────────────────
// SELECT "Page 2" IN THE PENPOT UI FIRST, then paste this whole file
// into the Penpot MCP `execute_code` tool. It is idempotent — it
// removes any previous board of the same name before building.
//
// ── CONVENTIONS ARE BORROWED, NOT INVENTED ────────────────────────
// Several decisions here are already settled on other boards in this
// file and are cited rather than re-litigated:
//   • Toast & celebration — a toast is 343pt (375 minus sonner's 16px
//     mobile offsets); its bottom sits at --above-nav (67+34+16=117pt);
//     sonner caps at 3 visible toasts and NEVER renders a 4th, and only
//     expands on hover, which a phone does not have.
//   • League seasons C — "one plate geometry, two variables … no new
//     artwork per season"; "result first, rewards as a receipt under
//     it"; a full sheet is reserved for the only moment that pays
//     something permanent; edge states "must read as a rule, not a
//     failure"; a new celebration needs its own haptic + confetti
//     signature.
//   • Badge system — the 36×36 ProfileMenu avatar count treatment.
//
// ── GEOMETRY IS VERIFIED, NOT GUESSED ─────────────────────────────
// Every slot height was set by exporting the board as a PNG and looking
// at it. The first pass passed every structural check — right child
// counts, nothing out of bounds, exact y-cursor arithmetic — while four
// groups rendered their anchors straight through their own captions,
// because a caption is pinned at `h - 62` and a 3-row stack or a 72pt
// circle simply ran past it. A second pass had two 4-line notes
// overlapping the slots below them by 12px. None of that is visible to
// a programmatic assertion.
//
// If you change an anchor's size, offset or count: re-derive the slot
// height (deepest anchor bottom + ~8pt clearance + the 62pt caption
// block), and re-export to LOOK at it. Do not trust the counts.

const PAGE_NAME = 'Page 2';
const BOARD_NAME = 'Achievements — slots to draw';
const BX = 7200, BY = 0, BW = 1320, PAD = 60;

// createBoard/createText target penpot.currentPage, NOT the page you
// read with getPageByName — the first build of this board landed on
// whatever page the tab was showing, at Page 2's x-coordinate, and
// there is no cross-page move in the API. penpot.openPage() is ASYNC,
// so switching and asserting on the next line is a race that sometimes
// passes. Bail out instead and let the operator switch.
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
const rc = (n) => {
  const t = (darkSet && darkSet.tokens.find(x => x.name === n)) || tok(n);
  return t ? t.resolvedValue : '#888888';
};
const C = {
  background: rc('color.background'), foreground: rc('color.foreground'),
  card: rc('color.card'), border: rc('color.border'),
  secondary: rc('color.secondary'), muted: rc('color.muted'),
  mutedFg: rc('color.muted-foreground'),
  // Used by the "met" requirement chip in group 09. Without it that
  // anchor fills with `undefined` and renders as a default grey, which
  // looks deliberate and is the kind of thing an export does not
  // obviously catch.
  success: rc('color.success'),
};
const ax = (dx) => BX + dx, ay = (dy) => BY + dy;

const board = penpot.createBoard();
board.name = BOARD_NAME;
board.x = BX; board.y = BY; board.resize(BW, 4400);
board.fills = [{ fillColor: C.background, fillOpacity: 1 }];
board.borderRadius = 16;
{ const k = tok('color.background'); if (k) board.applyToken(k, ['fill']); }

let y = 44;

function text(chars, o) {
  const t = penpot.createText(chars);
  t.x = o.x; t.y = o.y; t.growType = 'auto-height';
  t.fontSize = String(o.size || 12); t.fontFamily = 'Work Sans';
  if (o.bold) t.fontWeight = '700';
  t.fills = [{ fillColor: o.color || C.mutedFg, fillOpacity: 1 }];
  t.resize(o.w || 300, t.height); t.growType = 'auto-height';
  if (o.token) { const k = tok(o.token); if (k) t.applyToken(k, ['fill']); }
  return t;
}
function slot(name, o) {
  const b = penpot.createBoard();
  b.name = name; b.x = o.x; b.y = o.y; b.resize(o.w, o.h);
  b.fills = []; b.borderRadius = 10;
  b.strokes = [{ strokeColor: C.border, strokeOpacity: 1, strokeStyle: 'dashed', strokeWidth: 1, strokeAlignment: 'center' }];
  const k = tok('color.border'); if (k) b.applyToken(k, ['strokeColor']);
  return b;
}
function anchor(name, o) {
  const r = penpot.createRectangle();
  r.name = name; r.x = o.x; r.y = o.y; r.resize(o.w, o.h);
  r.borderRadius = o.radius == null ? 8 : o.radius;
  r.fills = [{ fillColor: o.color || C.secondary, fillOpacity: 1 }];
  const k = tok(o.token || 'color.secondary'); if (k) r.applyToken(k, ['fill']);
  return r;
}
function circle(name, o) {
  const e = penpot.createEllipse();
  e.name = name; e.x = o.x; e.y = o.y; e.resize(o.d, o.d);
  e.fills = [{ fillColor: C.secondary, fillOpacity: 1 }];
  const k = tok('color.secondary'); if (k) e.applyToken(k, ['fill']);
  return e;
}
function group(label) {
  board.appendChild(text(label, { x: ax(PAD), y: ay(y), size: 12, color: C.foreground, w: 1200, bold: true, token: 'color.foreground' }));
  y += 30;
}
// Advance by the ACTUAL line count. A flat allowance was the second
// defect found by exporting: two 4-line notes ran 12px into the slots
// underneath them, because the cursor moved a fixed 40 regardless.
function note(chars, size) {
  board.appendChild(text(chars, { x: ax(PAD), y: ay(y), size: size || 11, color: C.mutedFg, w: 1200, token: 'color.muted-foreground' }));
  y += chars.split('\n').length * 13 + 14;
}
function grid(items, o) {
  const gap = o.gap == null ? 15 : o.gap, rowGap = o.rowGap == null ? 34 : o.rowGap;
  items.forEach((it, i) => {
    const col = i % o.cols, row = Math.floor(i / o.cols);
    const sx = PAD + col * (o.w + gap), sy = y + row * (o.h + rowGap);
    const s = slot(it.name, { x: ax(sx), y: ay(sy), w: o.w, h: o.h });
    board.appendChild(s);
    if (o.build) o.build(s, it, sx, sy);
    if (it.label) s.appendChild(text(it.label, { x: ax(sx + 16), y: ay(sy + o.h - 62), size: 11, color: C.foreground, w: o.w - 32, token: 'color.foreground' }));
    if (it.note) s.appendChild(text(it.note, { x: ax(sx + 16), y: ay(sy + o.h - 44), size: 10, color: C.mutedFg, w: o.w - 32, token: 'color.muted-foreground' }));
  });
  y += Math.ceil(items.length / o.cols) * (o.h + rowGap) + 20;
}

board.appendChild(text('Achievements — states to draw', { x: ax(PAD), y: ay(y), size: 26, color: C.foreground, w: 800, bold: true, token: 'color.foreground' }));
y += 40;
board.appendChild(text(
  'Empty slots. Each cell holds the ANCHOR at its true app size — draw the badge / card onto it.\n' +
  'Surfaces + text are bound to tokens: flip the Mode theme (Light / Dark) to draw the other pass.\n' +
  'Full-screen overlay at 390pt, opened from ProfileMenu > Achievements. Reads user_trophies (migs 167 + 323).\n' +
  '73 named rungs across 22 ladders, and every laddered signal keeps generating rungs past the last named one.\n' +
  'Conventions below are taken from the Toast & celebration and League seasons boards — not re-decided here.',
  { x: ax(PAD), y: ay(y), size: 12, color: C.mutedFg, w: 980, token: 'color.muted-foreground' }));
y += 108;

// ── 01 · LADDER CARD ──────────────────────────────────────────────
group('01 · LADDER CARD — the core unit. 358 wide (390 page − 16 inset each side). One card per LADDER, showing the rung in play.');
note('The locked and dead-end cards follow the League seasons rule for edge states: "each must read as a rule, not a failure."');
grid([
  { name: 'slot / ladder-card / in progress',   label: 'Sessions · 47 / 50 → Committed', note: 'The default. Bar + next rung named.' },
  { name: 'slot / ladder-card / just cleared',  label: 'Committed cleared → Centurion',  note: 'The moment that matters: the rung falls and\nthe next takes its place in the SAME card.' },
  { name: 'slot / ladder-card / into the tail', label: 'Centurion III · 300 workouts',   note: 'Past the last named rung. Generated id\n(sessions_x2). Needs an infinity treatment.' },
  { name: 'slot / ladder-card / binary rung',   label: 'Gauntlet Cleared — yes / no',    note: 'No bar: not a count. Must NOT render\n"5 / 999" here.' },
  { name: 'slot / ladder-card / ladder locked', label: 'Crew wars — not in a crew yet',  note: 'A RULE, not a failure. Reads as "available\nlater", never as "you missed this".' },
  { name: 'slot / ladder-card / dead end',      label: 'Distance PB · marathon is the top', note: 'A RULE, not a failure. Deliberately terminal;\nmust not look broken or unfinished.' },
], { w: 390, h: 196, cols: 3, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / ladder card 358', { x: ax(sx + 16), y: ay(sy + 18), w: 358, h: 96, color: C.card, radius: 12, token: 'color.card' }));
}});

// ── 02 · MEDALLION ────────────────────────────────────────────────
group('02 · MEDALLION — the badge itself. Draw ONE and it has to survive all four sizes; the 20 is the one that breaks.');
note('ONE PLATE GEOMETRY, TWO VARIABLES — the rule already set on the League seasons board: "no new artwork per season; a profile\ncarrying four of these reads as a history." Here the two variables are the LADDER ICON and the TIER COLOURWAY. There are 73 named\nrungs plus generated tails, so per-badge artwork is not an option even if it were desirable — and a collection only reads as a\nhistory if the plate is constant.');
grid([
  { name: 'slot / medallion / 72 celebration',  d: 72, label: '72 · celebration',  note: 'Unlock moment, centre screen.' },
  { name: 'slot / medallion / 44 vault grid',   d: 44, label: '44 · vault grid',   note: 'The Achievements page grid.' },
  { name: 'slot / medallion / 28 profile rail', d: 28, label: '28 · profile rail', note: 'ProfileBadgeShowcase, 6 across.' },
  { name: 'slot / medallion / 20 inline',       d: 20, label: '20 · inline',       note: 'Next to a name in a list row.' },
], { w: 210, h: 176, cols: 4, build: (s, it, sx, sy) => {
  s.appendChild(circle(`anchor / ${it.d}pt medallion`, { x: ax(sx + (210 - it.d) / 2), y: ay(sy + 24), d: it.d }));
}});

note('TIER RAMP — five steps. Tier is the only thing separating a 10-workout badge from a 100-workout one, so it has to read at 28pt.\nThese five hexes are TROPHY_TIERS in trophyDefinitions.js, NOT theme tokens — they must not flip with the mode.');
grid([
  { name: 'slot / tier / bronze',    hex: '#CD7F32', label: 'Bronze',    note: '#CD7F32' },
  { name: 'slot / tier / silver',    hex: '#C0C0C0', label: 'Silver',    note: '#C0C0C0' },
  { name: 'slot / tier / gold',      hex: '#FFD700', label: 'Gold',      note: '#FFD700' },
  { name: 'slot / tier / platinum',  hex: '#7BE0E0', label: 'Platinum',  note: '#7BE0E0' },
  { name: 'slot / tier / legendary', hex: '#A855F7', label: 'Legendary', note: '#A855F7' },
  { name: 'slot / tier / tail',      hex: null,      label: 'Tail (infinite)', note: 'legendary ramp + infinity mark' },
  { name: 'slot / tier / locked',    hex: null,      label: 'Locked',    note: 'never earned — keeps its own art' },
], { w: 165, h: 142, cols: 7, gap: 8, build: (s, it, sx, sy) => {
  s.appendChild(circle('anchor / 44pt medallion', { x: ax(sx + (165 - 44) / 2), y: ay(sy + 16), d: 44 }));
  if (it.hex) {
    const chip = penpot.createRectangle();
    chip.name = `swatch / ${it.label} ${it.hex}`;
    chip.x = ax(sx + (165 - 44) / 2); chip.y = ay(sy + 66); chip.resize(44, 3);
    chip.fills = [{ fillColor: it.hex, fillOpacity: 1 }];
    s.appendChild(chip);
  }
}});

// ── 03 · NEXT UP ──────────────────────────────────────────────────
group('03 · NEXT UP — the rail that leads the page. Three closest rungs across ALL ladders. This is the answer to "what do I do now" and it is never empty.');
grid([
  { name: 'slot / next-up / rail of three', label: 'The default state', note: 'Ranked by % complete. Tapping one should\njump to its ladder.' },
  { name: 'slot / next-up / day one',       label: 'Brand-new account, everything at 0', note: 'Still has to offer three. WHICH three is a\nproduct call — draw your pick.' },
  { name: 'slot / next-up / one tap away',  label: 'A rung at 90%+', note: 'Worth a louder treatment — this is the hook.\nSame card, or a variant?' },
], { w: 390, h: 276, cols: 3, build: (s, it, sx, sy) => {
  for (let i = 0; i < 3; i++) {
    s.appendChild(anchor(`anchor / next-up row ${i + 1} (358x56)`, { x: ax(sx + 16), y: ay(sy + 18 + i * 62), w: 358, h: 56, color: C.card, radius: 12, token: 'color.card' }));
  }
}});

// ── 04 · COLLECTION HEADER ────────────────────────────────────────
group('04 · COLLECTION HEADER — the counter problem. Named rungs are 73; tails and league season trophies are UNBOUNDED and sit outside the denominator.');
grid([
  { name: 'slot / header / counter + bar', label: '"12 / 73  +3"', note: 'The +3 is tails & season trophies. Is a suffix\nright, or do they need their own line?' },
  { name: 'slot / header / at zero',       label: '"0 / 73" on day one', note: 'Must not read as failure. This is the exact\nstate the old page shipped and got wrong.' },
  { name: 'slot / header / deep account',  label: '"58 / 73  +21"', note: 'Someone well past the named catalog. The\ninfinite part should feel like the reward.' },
], { w: 390, h: 150, cols: 3, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / header block (358x52)', { x: ax(sx + 16), y: ay(sy + 20), w: 358, h: 52, color: C.card, radius: 12, token: 'color.card' }));
}});

// ── 05 · CATEGORY SECTION ─────────────────────────────────────────
group('05 · CATEGORY SECTION — 8 groups: Iron · Consistency · Endurance · Progression · Arena · Crew · Community · Collection. Each holds 2–3 ladders.');
grid([
  { name: 'slot / category / header + 3 ladders', label: 'Iron — Sessions, Tonnage, Variety', note: 'Group heading + the ladder rows under it.\nHow much weight does the heading carry?' },
  { name: 'slot / category / all 8 collapsed',    label: 'The whole page at a glance', note: '22 ladders is a long scroll. Should groups\ncollapse? Draw the answer.' },
], { w: 590, h: 330, cols: 2, gap: 20, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / section heading', { x: ax(sx + 16), y: ay(sy + 18), w: 200, h: 20, color: C.muted, radius: 4, token: 'color.muted' }));
  for (let i = 0; i < 3; i++) {
    s.appendChild(anchor(`anchor / ladder row ${i + 1} (358x64)`, { x: ax(sx + 16), y: ay(sy + 48 + i * 70), w: 358, h: 64, color: C.card, radius: 12, token: 'color.card' }));
  }
}});

// ── 06 · UNLOCK MOMENT ────────────────────────────────────────────
// 3 columns, not 4: the anchor is a REAL 343pt toast per the Toast &
// celebration board, and four of those do not fit the 1200pt content
// width. The fourth slot wraps to a second row.
group('06 · UNLOCK MOMENT — including the batch case. Migration 323 grants RETROACTIVELY, so the first open hands an established user 10–20 at once.');
note('TOAST IS 343pt — 375 minus sonner\'s 16px mobile offsets, per the Toast & celebration board. Bottom sits at --above-nav (67 + 34 + 16\n= 117pt); do not re-derive that here. SONNER CAPS AT 3 AND NEVER RENDERS A 4th (visibleToasts default 3), and it only expands on\nHOVER, which a phone does not have — so batching is REQUIRED, not polish: un-batched, 17 unlocks would show three and bin the rest.\nA new celebration needs its own haptic + confetti signature; the seven existing ones are all distinct and that must hold.');
grid([
  { name: 'slot / unlock / single',      label: 'One badge earned', note: 'Toast: emoji + name + criteria.\nResult first, reward as a receipt under it.' },
  { name: 'slot / unlock / batch',       label: '"17 trophies earned"', note: 'ONE toast + View action, naming the highest tier.\nStacking 17 is not an option — sonner renders 3.' },
  { name: 'slot / unlock / tail rung',   label: 'Centurion IV', note: 'An infinite rung landing. Should it feel\ndifferent from a named one?' },
  { name: 'slot / unlock / full screen', label: 'When does a sheet beat a toast?', note: 'League rule: a full sheet is reserved for the only\nmoment that pays something permanent. Rungs are\nfrequent — so which, if any, escalate?' },
], { w: 390, h: 250, cols: 3, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / toast 343 (375 − 2×16)', { x: ax(sx + 24), y: ay(sy + 18), w: 343, h: 64, color: C.card, radius: 12, token: 'color.card' }));
  s.appendChild(circle('anchor / 72pt medallion', { x: ax(sx + (390 - 72) / 2), y: ay(sy + 96), d: 72 }));
}});

// ── 07 · SURFACE TEST ─────────────────────────────────────────────
group('07 · SURFACE TEST — a medallion has to read on BOTH surfaces, in BOTH modes. Flip the Mode theme and check the same four cells.');
grid([
  { name: 'slot / surface / on card',        label: 'on color.card', note: 'Inside a ladder row.' },
  { name: 'slot / surface / on background',  label: 'on color.background', note: 'The page itself.' },
  { name: 'slot / surface / on secondary',   label: 'on color.secondary', note: 'Inside a Next-up row.' },
  { name: 'slot / surface / locked on card', label: 'locked, on color.card', note: 'The greyed state still has to be legible,\nnot a smudge.' },
], { w: 290, h: 166, cols: 4, gap: 12, build: (s, it, sx, sy) => {
  if (it.name.indexOf('on card') >= 0 || it.name.indexOf('locked') >= 0) {
    s.appendChild(anchor('surface / card', { x: ax(sx + 16), y: ay(sy + 16), w: 258, h: 76, color: C.card, radius: 12, token: 'color.card' }));
  }
  if (it.name.indexOf('secondary') >= 0) {
    s.appendChild(anchor('surface / secondary', { x: ax(sx + 16), y: ay(sy + 16), w: 258, h: 76, color: C.secondary, radius: 12, token: 'color.secondary' }));
  }
  s.appendChild(circle('anchor / 44pt medallion', { x: ax(sx + 16 + 107), y: ay(sy + 32), d: 44 }));
}});

// ── 08 · ENTRY POINT + EMPTY STATES ───────────────────────────────
group('08 · ENTRY POINT + EMPTY STATES.');
note('The Achievements row lives in ProfileMenu, so an unseen-trophies count is the 36×36 avatar case already drawn on the Badge system board — use that treatment, do not invent a second one.');
grid([
  { name: 'slot / entry / ProfileMenu row + count', label: 'ProfileMenu row, 3 unseen', note: 'Count badge on the 36 circle — see\n"Badge system", group 02.' },
  { name: 'slot / empty / nothing earned',          label: 'Earned tab, zero rows', note: 'Every user is here today. Should point at\nNext up rather than apologise.' },
  { name: 'slot / empty / ladder untouched',        label: 'A ladder at 0 of its first rung', note: 'e.g. Bounties for someone who has never\nopened the Arena.' },
], { w: 390, h: 180, cols: 3, build: (s, it, sx, sy) => {
  if (it.name.indexOf('entry') >= 0) {
    s.appendChild(anchor('anchor / ProfileMenu row (358x56)', { x: ax(sx + 16), y: ay(sy + 18), w: 358, h: 56, color: C.card, radius: 12, token: 'color.card' }));
    s.appendChild(circle('anchor / 36 avatar', { x: ax(sx + 28), y: ay(sy + 28), d: 36 }));
  } else {
    s.appendChild(anchor('anchor / empty block (358x96)', { x: ax(sx + 16), y: ay(sy + 18), w: 358, h: 96, color: C.muted, radius: 12, token: 'color.muted' }));
  }
}});

// ── 09 · CAPSTONE + LOCKED ────────────────────────────────────────
group('09 · CAPSTONE + LOCKED — the prerequisite tier. These are gated by OTHER achievements rather than a number, so none of the progress-bar vocabulary applies.');
note('A capstone has NO numeric criterion. It is earned purely by holding the top rung of every ladder in its category, and capstone_apex requires the other nine —\nthe only two-level chain in the catalog. 10 capstones + crewwar_1 means 11 sit locked on day one. The server refuses to grant a locked trophy even when the\nnumber is met, so this is a real state, not a UI affordance: whatever you draw here is what "you cannot have this yet, and here is exactly why" looks like.');

// The apex slot is TALLER than its three siblings on purpose. 358pt
// fits five chips at a 66pt pitch, and apex has nine requirements, so
// it needs two chip rows and a taller card. Drawing five and captioning
// it "9" would hide the only thing this slot is for — that the apex
// capstone does not fit the standard capstone card, which is a decision
// to make rather than a detail to round off.
const CAPSTONES_SLOTS = [
  { name: 'slot / capstone / locked',   h: 210, chips: 4, label: 'Iron Master — 1 of 4', note: 'The common case. Silhouette + the four\nrequirements, one met.' },
  { name: 'slot / capstone / one away', h: 210, chips: 4, label: 'Iron Master — 3 of 4', note: 'The motivating state. Worth being louder\nthan the row above?' },
  { name: 'slot / capstone / earned',   h: 210, chips: 4, label: 'Iron Master — earned', note: 'Legendary tier. Should feel like the biggest\nbadge on the page.' },
  { name: 'slot / capstone / apex',     h: 268, chips: 9, label: 'Flexyn Complete — 9 requirements', note: 'Requires the other nine capstones. Nine chips\nis a lot: does it need a different shape?' },
];
CAPSTONES_SLOTS.forEach((it, i) => {
  const col = i % 3, row = Math.floor(i / 3);
  const sx = PAD + col * (390 + 15);
  const sy = y + row * (210 + 34);
  const s = slot(it.name, { x: ax(sx), y: ay(sy), w: 390, h: it.h });
  board.appendChild(s);
  s.appendChild(anchor('anchor / capstone card 358', { x: ax(sx + 16), y: ay(sy + 16), w: 358, h: it.chips > 5 ? 172 : 116, color: C.card, radius: 12, token: 'color.card' }));
  s.appendChild(circle('anchor / 28pt medallion', { x: ax(sx + 28), y: ay(sy + 28), d: 28 }));
  for (let c = 0; c < it.chips; c += 1) {
    const cr = Math.floor(c / 5), cc = c % 5;
    s.appendChild(anchor(`anchor / requirement chip ${c + 1}`, { x: ax(sx + 28 + cc * 66), y: ay(sy + 100 + cr * 26), w: 60, h: 18, color: C.muted, radius: 6, token: 'color.muted' }));
  }
  s.appendChild(text(it.label, { x: ax(sx + 16), y: ay(sy + it.h - 62), size: 11, color: C.foreground, w: 358, token: 'color.foreground' }));
  s.appendChild(text(it.note, { x: ax(sx + 16), y: ay(sy + it.h - 44), size: 10, color: C.mutedFg, w: 358, token: 'color.muted-foreground' }));
});
// Second row is the tall apex slot, so advance by ITS height.
y += (210 + 34) + (268 + 34) + 20;

note('LOCKED ROW — the last thing on the page. Titled "Locked" with the count, then one entry per gated achievement carrying its requirements.');
grid([
  { name: 'slot / locked-row / default',   label: '"Locked   11" + entries', note: 'Day one for everyone: 10 capstones + crewwar_1.\nHeader count, then the list.' },
  { name: 'slot / locked-row / entry',     label: 'One entry, close up', note: '28 medallion, name, x / y count, and a chip per\nrequirement — done chips vs outstanding.' },
  { name: 'slot / locked-row / all clear', label: 'Nothing locked left', note: 'The row disappears entirely today. Should it\ninstead say something? Your call.' },
], { w: 390, h: 280, cols: 3, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / section header (358x22)', { x: ax(sx + 16), y: ay(sy + 16), w: 358, h: 22, color: C.muted, radius: 4, token: 'color.muted' }));
  for (let r = 0; r < 2; r += 1) {
    s.appendChild(anchor(`anchor / locked entry ${r + 1} (358x76)`, { x: ax(sx + 16), y: ay(sy + 46 + r * 84), w: 358, h: 76, color: C.card, radius: 12, token: 'color.card' }));
    s.appendChild(circle(`anchor / 28pt medallion ${r + 1}`, { x: ax(sx + 28), y: ay(sy + 56 + r * 84), d: 28 }));
  }
}});

note('REQUIREMENT CHIP — the smallest new element, and the one carrying the whole idea. It has to say "met" or "not met" at 11px next to four siblings.');
[
  { name: 'slot / chip / outstanding', w: 210, n: 1, ok: false, label: 'Not met', note: 'muted surface + lock glyph' },
  { name: 'slot / chip / met',         w: 210, n: 1, ok: true,  label: 'Met',     note: 'success tint + check glyph' },
  { name: 'slot / chip / row of four', w: 390, n: 4, ok: null,  label: 'Four in a row, 1 met', note: 'The real density. Do they wrap?' },
].forEach((it, i) => {
  const sx = PAD + i * (210 + 15);
  const s = slot(it.name, { x: ax(sx), y: ay(y), w: it.w, h: 120 });
  board.appendChild(s);
  for (let c = 0; c < it.n; c += 1) {
    const met = it.ok === true || (it.ok === null && c === 0);
    s.appendChild(anchor(`anchor / chip ${c + 1} (60x18)`, {
      x: ax(sx + 16 + c * 66), y: ay(y + 26), w: 60, h: 18,
      color: met ? C.success : C.muted, radius: 6, token: met ? 'color.success' : 'color.muted',
    }));
  }
  s.appendChild(text(it.label, { x: ax(sx + 16), y: ay(y + 120 - 62), size: 11, color: C.foreground, w: it.w - 32, token: 'color.foreground' }));
  s.appendChild(text(it.note, { x: ax(sx + 16), y: ay(y + 120 - 44), size: 10, color: C.mutedFg, w: it.w - 32, token: 'color.muted-foreground' }));
});
y += 120 + 34 + 20;

board.resize(BW, y + 40);

return {
  board: board.name,
  height: Math.round(board.height),
  slots: penpotUtils.findShapes(s => s.name && s.name.indexOf('slot / ') === 0, board).length,
};
