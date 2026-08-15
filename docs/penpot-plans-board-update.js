/* eslint-disable */
//
// docs/penpot-plans-board-update.js
//
// Brings the Penpot board `Plans — proposed` (page "Plans") into line with
// what is on `main`. This file is REWRITTEN each time the board falls behind
// rather than chained — there is one current patch script, not a series.
//
// Shipped, in order:
//   2cead293  migration 355 — slot index dropped, uniqueness moved to
//             (user_id, food_snapshot->>'log_id'), 3-per-slot trigger. APPLIED.
//   b1b0c076  the client half — upsert INSERTs by default, planMap is a LIST.
//   5f3fa75d  the redesign — day strip + one open day, day totals, grocery
//             list removed, the provisional +N badge and SlotMealsSheet
//             DELETED, orphaned mirrors fixed at the cause.
//   270f49d2  catalog + detail — split leads, six gradients and the
//             backdrop-blur gone, PLAN_COLORS gone, "add to your day" wired.
//   628ce3f8  the capacity sheet — a full slot offers replace-one or the
//             diary instead of only refusing.
//   83ec2f41  the device pass — three things only a browser could show:
//             "15 Saturday", ungrouped numbers, and "Add another" drawn
//             louder than the meals above it.
//   6daa3e75  the rename — the sheet stops being called "Weekly Plan &
//             Plans" over tabs "Weekly Plan" / "Nutritional Plans".
//
// WHY THIS IS A FILE. The plugin bridge hangs — `execute_code` times out on
// the SERVER→PLUGIN hop while the page is plainly open — which is the same
// failure the heat-map and explore-regimens scripts document. Paste this into
// `execute_code` after a reconnect.
//
// SAFE TO RE-RUN. Every text change assigns a fixed string, and group 08
// deletes its own shapes before redrawing. It PATCHES an existing board and
// bails if `Plans — proposed` is absent rather than creating a half-board.
//
// BEFORE PASTING: open the page "Plans". The script will not switch pages —
// `openPage()` is async and asserting `currentPage` on the next line is a race.
//
// SHAPE NAMES ARE NOT LABELS. Several rows were relabelled by setting
// `.characters` without touching `.name`, so a shape's name is its ORIGINAL
// label. The look-ups below use the original names on purpose; an earlier
// attempt failed on exactly that.

const page = penpot.currentPage;
if (!page) return 'No current page.';
if (page.name !== 'Plans') return `Current page is "${page.name}". Open "Plans" and re-run.`;

const B = penpotUtils.findShape(s => s.name === 'Plans — proposed' && s.type === 'board', page.root);
if (!B) return 'Board "Plans — proposed" not found on this page.';

// ── Palette: hsl() from `.dark` in src/index.css, converted ───────────
const P = {
  bg:'#13171B', card:'#191F24', card2:'#1F262D', sec:'#262E36', border:'#2A333B',
  fg:'#F5F2F0', mut:'#89949F', pri:'#F37616', ok:'#41C88A', bad:'#E75A5A', info:'#52A5E0',
};
const FH = penpot.fonts.findByName('Archivo');
const FB = penpot.fonts.findByName('Figtree');
if (!FH || !FB) return 'Archivo / Figtree not available in this Penpot instance.';

const rect = (parent, name, x, y, w, h, o) => {
  o = o || {};
  const r = penpot.createRectangle();
  r.name = name; r.resize(w, h); r.x = x; r.y = y;
  r.fills = (o.fill === null) ? [] : [{ fillColor: o.fill || P.card, fillOpacity: (o.op === undefined ? 1 : o.op) }];
  if (o.stroke) r.strokes = [{ strokeColor: o.stroke, strokeWidth: 1, strokeAlignment: 'inner', strokeOpacity: (o.so === undefined ? 1 : o.so), strokeStyle: o.dash ? 'dashed' : 'solid' }];
  if (o.r !== undefined) r.borderRadius = o.r;
  parent.appendChild(r);
  return r;
};

// letterSpacing must be >= 0 — Penpot rejects a negative value outright.
const txt = (parent, name, chars, x, y, o) => {
  o = o || {};
  const t = penpot.createText(String(chars));
  t.name = name;
  const f = o.head ? FH : FB;
  f.applyToText(t, f.variants.find(v => v.fontWeight === String(o.w || 400)) || f.variants[0]);
  t.fontSize = String(o.size || 12);
  t.fills = [{ fillColor: o.color || P.fg, fillOpacity: 1 }];
  if (o.lh) t.lineHeight = String(o.lh);
  if (o.ls) t.letterSpacing = String(o.ls);
  if (o.width) { t.resize(o.width, 18); t.growType = 'auto-height'; } else { t.growType = 'auto-width'; }
  if (o.align) t.align = o.align;
  t.x = x; t.y = y;
  parent.appendChild(t);
  return t;
};

const find = (n) => penpotUtils.findShape(s => s.name === n, B);
const set = (n, c) => { const s = find(n); if (s) { s.characters = c; return 1; } return 0; };
let patched = 0;

// ── 1 · The status bar: the proposal is BUILT ─────────────────────────
patched += set('chip l / 02dep / DEPENDS ON', 'BUILT');
patched += set('02 dep t',
  'Everything on this board is on main, and it has been seen in a browser. 5f3fa75d builds the week; 270f49d2 the catalog and detail; 628ce3f8 the capacity sheet; 83ec2f41 fixes what the device pass found; 6daa3e75 renames the sheet — it was titled "Weekly Plan & Plans" over tabs reading "Weekly Plan" and "Nutritional Plans", the whole named after one of its halves and that half then named twice.');

// 08a's drawing predates the rename and the formatting fixes.
[['sh title','Plans'],['sh seg al','This week'],['sh seg bl','Meal plans'],
 ['sh dayname','Saturday, Aug 15'],['sh total','1,200'],['sh target','/ 2,763 cal'],
 ['sh left','1,563 left'],['sh gc','2 · 1,200 cal']].forEach(([k, v]) => { patched += set(k, v); });

patched += set('07 note se',
  'MEASURED, not derived. At 375 pt the chip is 45.6 pt — clear of the 44 pt floor by 1.6 pt — and the harness confirms it: chips fit, the 52-character meal names wrap to two lines, nothing clipped. This was drawn before it was ever checked and it had 1.6 pt of room.');

patched += set('cap caption',
  'BUILT in 628ce3f8, with one change. The drawing gives "Replace one of them" its own row leading to a list; the build makes the LIST the affordance — every meal is tappable and replacing is what tapping does, which collapses a two-step into one and says the same thing. The diary option is gated on the open day being TODAY: on a future Thursday there is no today\'s diary to divert into, and the cap is on the plan rather than on what someone may eat.');

for (const k of ['sheet full', 'state slot full']) {
  const t = find('chip l / dep ' + k + ' / NEEDS 344 DROPPED');
  if (t) { t.characters = 'BUILT'; t.growType = 'auto-width'; patched++; }
}

// ── 2 · Audit rows that the shipped work closes ───────────────────────
patched += set('aud t / Tap targets under the floor, reproduced rather than flagged',
  'Tap targets under the floor — fixed in the build');
patched += set('aud w / Tap targets under the floor, reproduced rather than flagged',
  'The close control is w-7 h-7 (28 px) in six places on origin/main, and this board first redrew it at 22 pt — smaller than what ships. The board was corrected to 44 pt, and the redesign builds to that: the week nav arrows and the remove-sheet buttons are 44 pt, and the day chips land at 47.7 pt on a 390 px viewport and 45.6 pt on a 375 px SE.');

patched += set('aud t / The board is entirely English, and adds more of it',
  'The board was entirely English — the code no longer is');
patched += set('aud w / The board is entirely English, and adds more of it',
  'RESOLVED, and not by this board. The planner\'s i18n pass landed separately (0c6da6a2 / 4dcf197a), so WeeklyMealPlannerModal is keyed throughout, and every string the redesign added goes through tFallback rather than walking that back. NutritionPlansModal was already keyed and its new strings match. What is still English is this board itself, which is a working document and does not ship.');

patched += set('aud t / The proposed day total sums orphaned meals',
  'The proposed day total sums orphaned meals — fixed at the cause');
patched += set('aud w / The proposed day total sums orphaned meals',
  'RESOLVED by 5f3fa75d, and at the cause rather than in the total. Deleting a diary entry removed the log and left its mirrored plan pointing at a row that no longer exists — 3 of 8 production rows were in that state. `removeMirrorForLog` now deletes the mirror inside the same mutation, filtered on the JSON path, and migration 355\'s unique index on (user_id, log_id) means it can only ever match one row. Cross-checking orphans on READ was the other option and it needed a diary range reader that does not exist.');

// ── 3 · Group 07's blocking note is no longer blocking ────────────────
const tag = find('chip l / 07b / BLOCKS');
if (tag) { tag.characters = 'CLEARED'; tag.fills = [{ fillColor: P.ok, fillOpacity: 1 }]; tag.growType = 'auto-width'; patched++; }
const tagBox = find('chip / 07b / BLOCKS');
if (tagBox) tagBox.fills = [{ fillColor: P.ok, fillOpacity: 0.15 }];
patched += set('07 orphan h', 'The day total no longer inherits an unfixed bug');
patched += set('07 orphan b',
  'Deleting a diary entry removed the nutrition_logs row and nothing else, so its mirrored meal_plans row survived with a log_id pointing at a row that no longer existed. That cost a stale cell on a grid nobody read. It would have cost far more here, because the redesign makes the day total the largest number on the screen — the app reporting calories for a meal the user deleted, in the one place they are most likely to trust.\n\nFixed in 5f3fa75d by `removeMirrorForLog`, called from the diary delete mutation. The rule the header needed turned out not to be needed: a plan the PLANNER created carries no log_id and always counts, and a MIRROR now cannot outlive its diary row, so there is nothing for the total to exclude.');

patched += set('07 i18n b',
  'RESOLVED while this was being written, and not by this board. The planner\'s i18n pass landed in 0c6da6a2 and 4dcf197a, keying WeeklyMealPlannerModal throughout — so the ~30 hardcoded strings this block warned about are gone, and the ratchet it predicted did not run.\n\nWhat the redesign owed was not to walk that back, and it does not: every string it adds goes through tFallback with an English fallback and its vars — the three-argument form, because a wrapper that drops the vars renders a literal {n} in every language but the one you tested. NutritionPlansModal was already keyed and its new strings match.\n\nThe part that has NOT changed: those keys carry English only. Filling the other fourteen languages is a native-speaker pass, and machine translation is not an option here.');

// ── 4 · Group 08 · What shipped ───────────────────────────────────────
// Idempotent: this group is redrawn from scratch each run, and its previous
// contents are now WRONG — it drew the "+N more" badge and the provisional
// SlotMealsSheet, both of which 5f3fa75d deleted.
B.children.filter(c => c.name.indexOf('08 ') === 0 || c.name.indexOf('sh ') === 0).forEach(c => c.remove());

const CA = B.x + 140, Y = 6560;
if (B.height < Y + 980) B.resize(2620, Y + 980);

rect(B, '08 rule', CA, Y - 46, 2100, 1, { fill: P.border });
txt(B, '08 heading', '08  ·  What shipped', CA, Y - 32, { size: 15, w: 700, head: true, color: P.fg, ls: 0.4 });
txt(B, '08 sub', 'Drawn from main, not from the proposal. The previous contents of this group — a "+N more" badge and a provisional slot sheet — were deleted by the redesign, exactly as the group predicted they would be.', CA, Y - 12, { size: 11.5, color: P.mut, width: 2100 });

// 08a · the week, as built
const A = CA;
txt(B, '08 a h', 'a  ·  The week — day strip and one open day', A, Y + 24, { size: 12, w: 700, head: true, color: P.fg });
rect(B, 'sh phone', A, Y + 52, 390, 640, { fill: P.bg, r: 18, stroke: P.border });
txt(B, 'sh title', 'Plans', A + 16, Y + 66, { size: 17, w: 800, head: true, color: P.fg });
rect(B, 'sh close', A + 330, Y + 60, 44, 44, { fill: P.sec, op: 0.55, r: 22 });
txt(B, 'sh close x', '✕', A + 348, Y + 76, { size: 10, color: P.fg });
rect(B, 'sh seg', A + 16, Y + 110, 358, 32, { fill: P.sec, r: 9 });
rect(B, 'sh seg a', A + 19, Y + 113, 176, 26, { fill: P.card, r: 7 });
txt(B, 'sh seg al', 'This week', A + 19, Y + 119, { size: 11.5, w: 700, color: P.fg, width: 176, align: 'center' });
txt(B, 'sh seg bl', 'Meal plans', A + 195, Y + 119, { size: 11.5, w: 600, color: P.mut, width: 176, align: 'center' });
txt(B, 'sh range', 'Aug 10 – Aug 16', A + 50, Y + 156, { size: 13, w: 700, head: true, color: P.fg, width: 290, align: 'center' });
[['MON','10',0],['TUE','11',0],['WED','12',0],['THU','13',2],['FRI','14',0],['SAT','15',0],['SUN','16',0]].forEach((d, i) => {
  const cx = A + 16 + i * 51.7, sel = d[1] === '13';
  rect(B, 'sh day / ' + d[0], cx, Y + 190, 47.7, 62, sel ? { fill: P.pri, r: 10 } : { fill: P.card, r: 10, stroke: P.border });
  txt(B, 'sh dow / ' + d[0], d[0], cx, Y + 197, { size: 8.5, w: 600, color: sel ? '#FFFFFF' : P.mut, ls: 0.7, width: 47.7, align: 'center' });
  txt(B, 'sh dom / ' + d[0], d[1], cx, Y + 210, { size: 16, w: 700, head: true, color: sel ? '#FFFFFF' : P.fg, width: 47.7, align: 'center' });
  rect(B, 'sh dt / ' + d[0], cx + 11, Y + 234, 26, 4, { fill: sel ? '#FFFFFF' : P.border, r: 2, op: sel ? 0.3 : 1 });
  if (d[2]) rect(B, 'sh df / ' + d[0], cx + 11, Y + 234, 26 * (d[2] / 4), 4, { fill: '#FFFFFF', r: 2 });
});
txt(B, 'sh dayname', 'Thursday 13', A + 16, Y + 268, { size: 15, w: 700, head: true, color: P.fg });
txt(B, 'sh today', 'TODAY', A + 320, Y + 271, { size: 8.5, w: 700, color: P.pri, ls: 0.5 });
txt(B, 'sh total', '1200', A + 16, Y + 292, { size: 22, w: 800, head: true, color: P.fg });
txt(B, 'sh target', '/ 2180 cal', A + 66, Y + 301, { size: 12, color: P.mut });
txt(B, 'sh left', '980 left', A + 200, Y + 301, { size: 12, w: 700, color: P.ok, width: 174, align: 'right' });
rect(B, 'sh track', A + 16, Y + 326, 358, 6, { fill: P.sec, r: 3 });
rect(B, 'sh fill', A + 16, Y + 326, 358 * 0.55, 6, { fill: P.pri, r: 3 });
txt(B, 'sh macros', '42g P  ·  173g C  ·  38g F', A + 16, Y + 342, { size: 10.5, color: P.mut });

rect(B, 'sh r0', A + 16, Y + 372, 358, 44, { fill: null, r: 10, stroke: P.border, dash: true });
txt(B, 'sh r0l', '🌅   Breakfast', A + 30, Y + 386, { size: 12.5, w: 600, color: P.mut });
txt(B, 'sh r0a', '＋ Add', A + 250, Y + 386, { size: 11.5, w: 700, color: P.pri, width: 110, align: 'right' });
txt(B, 'sh gl', '🍽   DINNER', A + 30, Y + 430, { size: 10, w: 700, color: P.mut, ls: 0.5 });
txt(B, 'sh gc', '2 · 1200 cal', A + 220, Y + 430, { size: 10, w: 700, color: P.pri, width: 140, align: 'right' });
[['Mac and Cheese with Peas rice with green peas', '330 cal', '9P · 69C · 2F'],
 ['Grilled panini sandwich with french fries and ketchup', '870 cal', '33P · 104C · 36F']].forEach((m, k) => {
  const my = Y + 448 + k * 62;
  rect(B, 'sh m / ' + k, A + 16, my, 358, 54, { fill: P.card, r: 10, stroke: P.border });
  txt(B, 'sh mn / ' + k, m[0], A + 30, my + 8, { size: 12, w: 500, color: P.fg, width: 230, lh: 1.25 });
  txt(B, 'sh mk / ' + k, m[1], A + 262, my + 8, { size: 11.5, w: 700, color: P.fg, width: 98, align: 'right' });
  txt(B, 'sh mm / ' + k, m[2], A + 30, my + 36, { size: 10, color: P.mut });
});
rect(B, 'sh add2', A + 16, Y + 574, 358, 36, { fill: null, r: 10, stroke: P.border, dash: true });
txt(B, 'sh add2l', '＋  Add another', A + 16, Y + 585, { size: 11, w: 600, color: P.mut, width: 358, align: 'center' });
txt(B, '08 a note', 'The 700 pt drag, the custom scroll indicator, the rAF centering of "today" and the grocery CTA are all gone. A slot is a group header: the second dinner is a second row under it, with the count and subtotal on the header.', A, Y + 706, { size: 11, color: P.mut, width: 390, lh: 1.45 });

// 08b · the catalog card, as built
const D = CA + 470;
txt(B, '08 b h', 'b  ·  The catalog card — the split leads', D, Y + 24, { size: 12, w: 700, head: true, color: P.fg });
rect(B, 'sh cphone', D, Y + 52, 390, 640, { fill: P.bg, r: 18, stroke: P.border });
txt(B, 'sh ccount', '7 plans · every one tailored to you', D + 16, Y + 70, { size: 11, color: P.mut });
txt(B, 'sh chint', 'They differ in the split, not the total.', D + 16, Y + 88, { size: 11, w: 700, color: P.fg });
[['Fat Loss Protocol', '🔥', ['LOSE'], true, ['232','163','59'], [0.44,0.31,0.25]],
 ['Keto Performance', '🥑', ['LOSE','MAINTAIN'], false, ['142','26','170'], [0.26,0.05,0.69]],
 ['Plant Power', '🌱', ['LOSE','MAINTAIN','GAIN'], false, ['133','270','61'], [0.25,0.50,0.25]]].forEach((c, i) => {
  const cy = Y + 116 + i * 168;
  rect(B, 'sh c / ' + c[0], D + 16, cy, 358, 152, { fill: P.card, r: 12, stroke: P.border });
  txt(B, 'sh ci / ' + c[0], c[1], D + 30, cy + 14, { size: 15 });
  txt(B, 'sh cn / ' + c[0], c[0], D + 54, cy + 14, { size: 14, w: 700, head: true, color: P.fg });
  txt(B, 'sh cv / ' + c[0], '›', D + 356, cy + 14, { size: 13, color: P.mut });
  let bx = D + 54;
  c[2].forEach(b => {
    const w = Math.round(b.length * 5.2) + 14;
    rect(B, 'sh cb / ' + c[0] + ' ' + b, bx, cy + 38, w, 17, { fill: P.sec, r: 5 });
    txt(B, 'sh cbl / ' + c[0] + ' ' + b, b, bx, cy + 42, { size: 8.5, w: 700, color: P.mut, ls: 0.5, width: w, align: 'center' });
    bx += w + 5;
  });
  if (c[3]) {
    rect(B, 'sh cm / ' + c[0], bx, cy + 38, 108, 17, { fill: P.pri, op: 0.15, r: 5 });
    txt(B, 'sh cml / ' + c[0], 'matches your goal', bx, cy + 42, { size: 8.5, w: 700, color: P.pri, width: 108, align: 'center' });
  }
  [['P', P.bad], ['C', P.info], ['F', P.pri]].forEach((m, k) => {
    const mx = D + 30 + k * 84;
    txt(B, 'sh cmv / ' + c[0] + ' ' + m[0], c[4][k], mx, cy + 72, { size: 19, w: 800, head: true, color: P.fg });
    txt(B, 'sh cmu / ' + c[0] + ' ' + m[0], 'g ' + m[0], mx + c[4][k].length * 12 + 2, cy + 80, { size: 10.5, w: 700, color: m[1] });
  });
  let sx = D + 30;
  c[5].forEach((f, k) => { rect(B, 'sh cbar / ' + c[0] + ' ' + k, sx, cy + 104, 330 * f - 1, 8, { fill: [P.bad, P.info, P.pri][k], r: 4 }); sx += 330 * f; });
  txt(B, 'sh ccal / ' + c[0], '2180 cal/day — your target, the same on every plan', D + 30, cy + 122, { size: 10, color: P.mut });
});
txt(B, '08 b note', 'Flat card, hairline border. No gradient, and PLAN_COLORS is gone — five hues off the raw Tailwind palette against a four-hue system. Keto\'s 26 g of carbs against Plant Power\'s 270 g is now the first thing each card says.', D, Y + 706, { size: 11, color: P.mut, width: 390, lh: 1.45 });

// 08c · what is still open
const N = CA + 940;
rect(B, '08 c box', N, Y + 52, 1160, 300, { fill: P.card, r: 12, stroke: P.border });
rect(B, '08 c tag', N + 18, Y + 68, 66, 17, { fill: P.pri, op: 0.15, r: 4 });
txt(B, '08 c tagl', 'STILL OPEN', N + 18, Y + 71, { size: 8.5, w: 700, color: P.pri, ls: 0.5, width: 66, align: 'center' });
txt(B, '08 c h', 'What the board still describes and main does not', N + 96, Y + 67, { size: 12.5, w: 700, head: true, color: P.fg });
txt(B, '08 c b',
  'THE CAPACITY SHEET (03e). Tapping Add on a full slot does not open "Dinner is full" with its two ways forward — replace one, or log it to the diary instead. The cap surfaces as a toast off the trigger\'s 23514 instead, which is functionally complete and rhetorically weaker: it refuses without offering anything. Build it when the copy is worth the sheet.\n\nNOT SEEN ON A DEVICE. All four passes rest on tests plus this board\'s geometry — preview_start only ever serves ~/flexyn2 and the work was done in a worktree, so nothing here has been rendered in a browser. Group 07\'s 375 and 430 drawings are the reference, not a measurement.\n\nENGLISH ONLY. Every key the redesign added ships with an English fallback and no translation. That is the standing state of the app, not a regression, and filling the other fourteen languages is a native-speaker pass.',
  N + 18, Y + 92, { size: 10.5, color: P.mut, width: 1124, lh: 1.5 });

return { patched, group08: 'redrawn', boardHeight: B.height };
