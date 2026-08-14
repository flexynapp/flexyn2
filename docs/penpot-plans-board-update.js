/* eslint-disable */
//
// docs/penpot-plans-board-update.js
//
// Reconciles the Penpot board `Plans — proposed` (page "Plans") with what
// actually shipped on 2026-08-13:
//
//   2cead293  migration 355 — slot index dropped, uniqueness moved to
//             (user_id, food_snapshot->>'log_id'), 3-per-slot trigger.
//             APPLIED to production.
//   b1b0c076  the client half — upsert INSERTs by default, SLOT_CAPACITY /
//             isSlotFull, planMap becomes a slot -> LIST, a "+N more" badge
//             and a provisional SlotMealsSheet.
//
// WHY THIS IS A FILE. The plugin bridge dropped mid-update on 2026-08-13
// ("No Penpot instance connected for user token"), which is the same
// SERVER->PLUGIN failure the heat-map and explore-regimens scripts document.
// This is the recovery artefact: self-contained, idempotent, pasted into
// `execute_code` in one go after a reconnect.
//
// SAFE TO RE-RUN. Every text change assigns a fixed string, and group 08
// deletes its own shapes before redrawing. It does NOT rebuild the board —
// if `Plans — proposed` is missing it bails rather than creating one.
//
// BEFORE PASTING: open the page "Plans" in the Penpot UI. The script bails
// with a message rather than switching pages itself — `openPage()` is async
// and asserting `currentPage` on the next line is a race.
//
// NOTE ON SHAPE NAMES: several rows were RELABELLED in earlier passes by
// setting `.characters` without touching `.name`, so a shape's name is its
// ORIGINAL label. Look-ups below use the original names on purpose; one
// earlier attempt failed exactly here.

const page = penpot.currentPage;
if (!page) return 'No current page.';
if (page.name !== 'Plans') {
  return `Current page is "${page.name}". Open "Plans" and re-run.`;
}

const B = penpotUtils.findShape(s => s.name === 'Plans — proposed' && s.type === 'board', page.root);
if (!B) return 'Board "Plans — proposed" not found on this page.';

// ── Palette: hsl() from `.dark` in src/index.css, converted ───────────
const P = {
  bg:'#13171B', card:'#191F24', card2:'#1F262D', sec:'#262E36', border:'#2A333B',
  fg:'#F5F2F0', mut:'#89949F', pri:'#F37616', ok:'#41C88A', bad:'#E75A5A',
  info:'#52A5E0', paper:'#0E1216',
};
const FH = penpot.fonts.findByName('Archivo');
const FB = penpot.fonts.findByName('Figtree');
if (!FH || !FB) return 'Archivo / Figtree not available in this Penpot instance.';

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

// letterSpacing must be >= 0 — Penpot rejects a negative value outright.
const txt = (parent, name, chars, x, y, o) => {
  o = o || {};
  const t = penpot.createText(String(chars));
  t.name = name;
  const font = o.head ? FH : FB;
  const variant = font.variants.find(v => v.fontWeight === String(o.w || 400)) || font.variants[0];
  font.applyToText(t, variant);
  t.fontSize = String(o.size || 12);
  t.fills = [{ fillColor: o.color || P.fg, fillOpacity: (o.op === undefined ? 1 : o.op) }];
  if (o.lh) t.lineHeight = String(o.lh);
  if (o.ls) t.letterSpacing = String(o.ls);
  if (o.tt) t.textTransform = o.tt;
  if (o.width) { t.resize(o.width, o.height || 18); t.growType = o.fixed ? 'fixed' : 'auto-height'; }
  else { t.growType = 'auto-width'; }
  if (o.align) t.align = o.align;
  t.x = x; t.y = y;
  parent.appendChild(t);
  return t;
};

const pill = (parent, label, x, y, o) => {
  o = o || {};
  const px = o.px === undefined ? 10 : o.px;
  const size = o.size || 11;
  const w = o.w || Math.round(label.length * size * 0.56) + px * 2;
  const h = o.h || 24;
  const key = o.key ? o.key + ' / ' + label : label;
  rect(parent, 'chip / ' + key, x, y, w, h, { fill: o.fill || P.card, r: (o.r === undefined ? h / 2 : o.r), stroke: o.stroke, so: o.so });
  txt(parent, 'chip l / ' + key, label, x, y + (h - size * 1.35) / 2, {
    size, w: o.fw || 600, color: o.color || P.mut, width: w, align: 'center', tt: o.tt, ls: o.ls, head: o.head });
  return w;
};

const find = (n) => penpotUtils.findShape(s => s.name === n, B);
const setChars = (n, chars) => { const s = find(n); if (s) { s.characters = chars; return 1; } return 0; };

let patched = 0;

// ── 1 · The status bar under 02: both halves have landed ──────────────
patched += setChars('chip l / 02dep / DEPENDS ON', 'SHIPPED');
patched += setChars('02 dep t',
  'Migration 355 (2cead293) and the client half (b1b0c076) are both on main. A slot holds up to three meals; uniqueness moved to (user_id, log_id) so the mirror stays idempotent; upsert INSERTs by default and planMap is a slot to LIST. Everything drawn below is now buildable — what is left is composing it, not unblocking it.');

// ── 2 · The two per-drawing tags ──────────────────────────────────────
for (const k of ['sheet full', 'state slot full']) {
  const t = find('chip l / dep ' + k + ' / NEEDS 344 DROPPED');
  if (t) { t.characters = 'BUILDABLE NOW'; t.growType = 'auto-width'; patched++; }
}

// ── 3 · Audit row: the client half closes it ──────────────────────────
patched += setChars('aud w / The central proposal is blocked by a live unique index',
  'The original claim ("nothing stops two meals in a slot") was wrong: it came from a pg_constraint query, which structurally cannot see a CREATE UNIQUE INDEX. RESOLVED in two commits. 2cead293 drops meal_plans_user_date_slot_uniq, moves uniqueness to (user_id, food_snapshot->>\'log_id\') and caps a slot at three by trigger — verified in a rolled-back transaction against production: three meals into one dinner slot accepted, the fourth refused with 23514, a duplicate log_id refused with 23505. b1b0c076 does the client half, without which the migration changed nothing a user could see.');

// ── 4 · Ledger: the client is where the rule actually lived ───────────
patched += setChars('led t / Two dinners is a plan, not a defect', 'Two dinners is a plan, and both halves now agree');
patched += setChars('led w / Two dinners is a plan, not a defect',
  'Migration 344 read the duplicate-row incident as "a slot holds one meal". That fit the incident and not the domain: the 6 unreachable rows were one diary entry mirrored repeatedly, never two different dinners. And no plan template could be applied whole while it existed, because snack1 and snack2 both map to the single snack type. 355 reverses the schema; b1b0c076 reverses the client, which is where the rule actually lived — upsert resolved the slot id and updated it, so a second dinner overwrote the first no matter what the index allowed. One-per-slot only ever looked like a rule because of the drawing: an 89.7 pt cell at min-h-[58px] renders one truncated name, so a limitation of the grid was mistaken for a property of the day.');

// ── 5 · i18n: the shipped work made this worse ────────────────────────
patched += setChars('07 i18n b',
  'The planner was ~30 hardcoded English strings with no t() or tFallback() anywhere, and the multi-meal work has just added five more: "+N more", "That slot already holds 3 meals.", "Add another", "<Slot> is full — N of 3", and the sheet heading "<Slot> · N meals". That is the ratchet this board warned about, running the wrong way — a surface being rewritten is the cheapest it will ever be to key, and every pass that ships in English hardens the debt.\n\nThe prior audit chose all-or-nothing deliberately, reasoning that a handful of keys among thirty is worse than either extreme. That still holds. The shape exists twice already — i18n-equipment.js and i18n-journal.js. Copy the journal one: a part file, English at minimum through tFallback(key, "English", vars), an exported ENGLISH_ONLY for prose that stays English on purpose, and a test asserting no non-English block fills those in. Note the three-argument call — a wrapper that drops the vars renders a literal {n} in every language but the one you tested.');

// ── 6 · Group 08 · What shipped ───────────────────────────────────────
// Idempotent: clear anything from a previous run first.
B.children.filter(c => c.name.indexOf('08 ') === 0 || c.name.indexOf('sh ') === 0).forEach(c => c.remove());

const CA = B.x + 140;
const Y = 6560;
if (B.height < Y + 940) B.resize(2620, Y + 940);

rect(B, '08 rule', CA, Y - 46, 2100, 1, { fill: P.border });
txt(B, '08 heading', '08  ·  What shipped', CA, Y - 32, { size: 15, w: 700, head: true, color: P.fg, ls: 0.4 });
txt(B, '08 sub', 'The proposal above is not what is on main. These two are — drawn so the difference is explicit, and so the provisional parts are recognisable when the redesign deletes them.', CA, Y - 12, { size: 11.5, color: P.mut, width: 2100 });

// 08a — the grid cell as it now ships, true size and enlarged.
txt(B, '08 a h', 'a  ·  The cell, unchanged except for a badge', CA, Y + 24, { size: 12, w: 700, head: true, color: P.fg });
txt(B, '08 a s', 'The 7-column grid is still there. A slot holding more than one meal shows the first name and a count.', CA, Y + 44, { size: 11, color: P.mut, width: 400, lh: 1.45 });

// True size: one 89.7 pt day column, four slots, dinner holding three.
const tx = CA, ty = Y + 96;
txt(B, '08 a true', 'true size — 89.7 pt', tx, ty - 16, { size: 9, w: 700, color: P.mut, ls: 0.5 });
const SLOTS = [['🌅','Breakfast',null,0],['🥗','Lunch','Grilled seasoned c…',0],['🍽','Dinner','Mac and Cheese wi…',2],['🍎','Snack',null,0]];
SLOTS.forEach((s, i) => {
  const sy = ty + i * 64;
  rect(B, 'sh cell / ' + s[1], tx, sy, 89.7, 58, s[2]
    ? { fill: P.ok, op: 0.15, r: 8, stroke: P.ok, so: 0.3 }
    : { fill: P.sec, op: 0.4, r: 8, stroke: P.border, dash: true });
  txt(B, 'sh ce / ' + s[1], s[0], tx + 6, sy + 7, { size: 8 });
  txt(B, 'sh cl / ' + s[1], s[1], tx + 17, sy + 8, { size: 8.5, color: P.mut });
  if (s[2]) {
    txt(B, 'sh cn / ' + s[1], s[2], tx + 6, sy + 22, { size: 8.5, w: 700, color: P.fg, width: 78, lh: 1.2 });
    if (s[3]) txt(B, 'sh cx / ' + s[1], '+' + s[3] + ' more', tx + 6, sy + 42, { size: 8.5, w: 600, color: P.ok });
  } else {
    txt(B, 'sh ca / ' + s[1], '+ Add', tx + 6, sy + 22, { size: 8.5, color: P.mut, op: 0.6 });
  }
});

// Enlarged 2.6x so the badge is legible on the board.
const ex = CA + 150, ey = ty, S = 2.6;
txt(B, '08 a zoom', 'enlarged 2.6x', ex, ey - 16, { size: 9, w: 700, color: P.mut, ls: 0.5 });
rect(B, 'sh zoom', ex, ey, 89.7 * S, 58 * S, { fill: P.ok, op: 0.15, r: 8 * S, stroke: P.ok, so: 0.3 });
txt(B, 'sh ze', '🍽', ex + 6 * S, ey + 7 * S, { size: 8 * S });
txt(B, 'sh zl', 'Dinner', ex + 17 * S, ey + 8 * S, { size: 8.5 * S, color: P.mut });
txt(B, 'sh zn', 'Mac and Cheese wi…', ex + 6 * S, ey + 22 * S, { size: 8.5 * S, w: 700, color: P.fg, width: 78 * S, lh: 1.2 });
txt(B, 'sh zx', '+2 more', ex + 6 * S, ey + 42 * S, { size: 8.5 * S, w: 600, color: P.ok });
txt(B, '08 a note', 'The badge is the minimum that stops the extra rows being HIDDEN — which is the 2026-08-11 defect exactly, and it would have returned the moment the database started accepting siblings. It is not a design; the redesign deletes it along with the grid.', ex, ey + 58 * S + 16, { size: 11, color: P.mut, width: 260, lh: 1.45 });

// 08b — the SlotMealsSheet as shipped.
const D = CA + 560;
txt(B, '08 b h', 'b  ·  SlotMealsSheet — a sixth sub-menu, marked PROVISIONAL in the source', D, Y + 24, { size: 12, w: 700, head: true, color: P.fg });
txt(B, '08 b s', 'Tapping a multi-meal cell opens this. It is not the "Dinner is full" sheet proposed in 03 — see the delta on the right.', D, Y + 44, { size: 11, color: P.mut, width: 420, lh: 1.45 });
rect(B, 'sh phone', D, Y + 96, 390, 620, { fill: P.bg, r: 18, stroke: P.border });
rect(B, 'sh dim', D + 1, Y + 97, 388, 618, { fill: '#000000', op: 0.55, r: 18 });
const st = Y + 96 + 620 - 330;
const sheet = rect(B, 'sh sheet', D + 1, st, 388, 330, { fill: P.card, r: 16, stroke: P.border });
sheet.borderRadiusBottomLeft = 0; sheet.borderRadiusBottomRight = 0;
txt(B, 'sh title', 'Dinner · 3 meals', D + 18, st + 16, { size: 13, w: 700, head: true, color: P.fg });
rect(B, 'sh close', D + 344, st + 6, 44, 44, { fill: P.sec, op: 0.55, r: 22 });
txt(B, 'sh close x', '✕', D + 362, st + 22, { size: 10, color: P.fg });
rect(B, 'sh rule', D + 1, st + 48, 388, 1, { fill: P.border });
[['Mac and Cheese with Peas rice with green peas', '330 cal'],
 ['Grilled panini sandwich with french fries and ketchup', '870 cal'],
 ['Steak & Red Potato', '676 cal']].forEach((m, k) => {
  const my = st + 62 + k * 52;
  rect(B, 'sh row / ' + k, D + 18, my, 354, 44, { fill: P.sec, op: 0.4, r: 8, stroke: P.border });
  txt(B, 'sh rn / ' + k, m[0], D + 30, my + 8, { size: 11.5, w: 500, color: P.fg, width: 240, lh: 1.25 });
  txt(B, 'sh rk / ' + k, m[1], D + 274, my + 14, { size: 10, w: 700, color: P.mut, width: 86, align: 'right' });
});
rect(B, 'sh foot rule', D + 1, st + 226, 388, 1, { fill: P.border });
rect(B, 'sh cta', D + 18, st + 240, 354, 44, { fill: P.sec, r: 12, op: 0.5 });
txt(B, 'sh cta l', 'Dinner is full — 3 of 3', D + 18, st + 254, { size: 12.5, w: 700, color: P.mut, width: 354, align: 'center' });
txt(B, 'sh cta n', 'Below capacity this reads "＋ Add another" and is enabled.', D + 18, st + 296, { size: 10, color: P.mut, width: 354, align: 'center' });

// 08c — the delta, and what deletes the provisional parts.
const N = CA + 1040;
rect(B, '08 c box', N, Y + 96, 900, 300, { fill: P.card, r: 12, stroke: P.border });
pill(B, 'DELTA', N + 18, Y + 112, { key: '08', h: 17, size: 8.5, fw: 700, ls: 0.5, fill: P.pri, so: 0.15, color: P.pri, r: 4, px: 7 });
txt(B, '08 c h', 'What shipped is not what 03 proposed, on purpose', N + 84, Y + 111, { size: 12.5, w: 700, head: true, color: P.fg });
txt(B, '08 c b',
  'Group 03 proposes a "Dinner is full" sheet that explains the cap and offers two ways forward — replace one, or log it to the diary instead. What shipped is a plain list with a disabled button, because the data-layer change had to land without inventing UI that is yours to compose.\n\nSo two things on this board are PROVISIONAL and are marked so in the source. The "+N more" badge exists only because an 89.7 pt cell cannot show a second meal. The sheet exists only because that cell cannot be tapped into two places. BOTH are deleted by the same change: the full-width day rows in 02a show every meal in a slot inline, with the slot subtotal on the group header, and neither affordance has anything left to do.\n\nUntil then they are load-bearing. Removing either one without the redesign puts the rows back out of reach — written, counted, walked by the grocery list, and invisible, which is the defect the whole 2026-08-11 audit was about.',
  N + 18, Y + 134, { size: 10.5, color: P.mut, width: 864, lh: 1.5 });

return { patched, group08: 'drawn', boardHeight: B.height };
