// docs/penpot-journal-board.js
//
// Builds the "My Journal — slots to draw" board in Penpot, in the same
// idiom as "Badge system", "Toast & celebration", "Daily Quests sheet",
// the nine Settings boards and "Achievements — slots to draw": empty
// dashed slots, each holding the ANCHOR at its true app size, with
// surfaces and text bound to the Light/Dark mode tokens so one board
// draws both passes.
//
// ── HOW TO RUN ────────────────────────────────────────────────────
// SELECT "Page 2" IN THE PENPOT UI FIRST, then paste this whole file
// into the Penpot MCP `execute_code` tool. It is idempotent — it
// removes any previous board of the same name before building. If the
// plugin bridge has dropped (a trivial `return 1` also times out), a
// reconnect in the browser is the only fix; re-running is not.
//
// ── WHAT THIS BOARD IS FOR ────────────────────────────────────────
// My Journal was audited on 2026-08-09. It had not been touched since
// it shipped, and the audit found it was not merely unpolished:
//
//   • The editor rendered as a 56px translucent sliver on EVERY phone.
//     JournalView sat inside Header.jsx's mobile bar, which carries
//     `backdrop-blur-md`, and a non-`none` backdrop-filter makes an
//     element a containing block for `position: fixed` children — so
//     `inset-0` resolved against the 56px header, not the viewport.
//     Measured 56px against a 812px viewport. Fixed in 7f3b18c7 by
//     portalling to <body>; the screen below is what it looks like now
//     that it actually opens.
//   • Six of production's twelve journal rows are MOOD-ONLY — a
//     mood_score written by MoodLogCard and nothing else. The journal
//     renders every one of them as "No entry for this day", and the
//     Log renders them as a bare date with nothing under it.
//   • ZERO of the twelve rows have a title. ZERO have an attachment.
//     Both features are on screen, permanently, earning nothing.
//
// So the design question this board exists to answer is not "make the
// editor prettier". It is: what does a day look like when half of the
// days have a mood and no words, nobody titles anything, and the empty
// state is 500pt of nothing?
//
// ── CONVENTIONS ARE BORROWED, NOT INVENTED ────────────────────────
//   • Page 2's slot idiom, 1320 wide for three 390pt phone slots per
//     row, `label / gN` group headings, `note / cN` at 11px muted —
//     from the Achievements board.
//   • 390 × 844 is the device frame used by board "05 · Above the fold
//     — light theme (390 × 844)".
//   • Two spacing registers and one dominant element per screen, from
//     CLAUDE.md's UI composition section. Section 02 exists because
//     this screen currently has three chrome strips and no dominant
//     element, which is the specific failure that reads as generated.
//   • No gradient, no glassmorphism, no coloured shadow — same section.
//
// ── GEOMETRY IS MEASURED, NOT GUESSED ─────────────────────────────
// Every strip height below was read off the live DOM at 375x812 with
// the overlay open: header row 49pt, date bar 56.75pt, toolbar buttons
// 32pt, attachment chips 80pt, footer ~33pt, history sheet capped at
// max-h-[80vh]. Anchors are drawn at those sizes.
//
// If you change an anchor's size or count: re-derive the slot height
// (deepest anchor bottom + ~8pt clearance + the 62pt caption block) and
// EXPORT THE BOARD AND LOOK AT IT. On the Achievements board every
// structural assertion passed while four groups rendered their anchors
// straight through their own captions. Counts prove nothing.
//
// Built 2026-08-09: 9 groups, 36 slots, 1320 × 6468. Verified three ways
// — a full-board PNG, a per-slot clearance pass (caption top vs deepest
// anchor bottom, min 7pt on the Log sheet), and rect intersection across
// every board-level child (zero). Note the intersection test has to be a
// real rect overlap: a first pass that compared each shape against the
// topmost thing at-or-below it flagged 25 false positives, every one of
// them a slot against its own ROW-MATE, each "overlap" exactly equal to
// the slot height. That signature is what gives it away.
//
// Exporting a single slot on its own is misleading: slots have no fill,
// so the export renders them on WHITE and the captions — bound to
// color.foreground, near-white in dark mode — vanish. That is an export
// artefact, not a contrast bug. Judge captions on the full-board export.

const PAGE_NAME = 'Page 2';
const BOARD_NAME = 'My Journal — slots to draw';
// Achievements occupies 7200 → 8520. Next free slot on Page 2.
const BX = 8760, BY = 0, BW = 1320, PAD = 60;

// createBoard/createText target penpot.currentPage, NOT the page you
// read with getPageByName, and penpot.openPage() is ASYNC so switching
// and asserting on the next line is a race that sometimes passes. Bail
// out and let the operator switch instead.
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
};
const ax = (dx) => BX + dx, ay = (dy) => BY + dy;

const board = penpot.createBoard();
board.name = BOARD_NAME;
board.x = BX; board.y = BY; board.resize(BW, 6400);
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
function group(label) {
  board.appendChild(text(label, { x: ax(PAD), y: ay(y), size: 12, color: C.foreground, w: 1200, bold: true, token: 'color.foreground' }));
  y += 30;
}
// Advance by the ACTUAL line count — a flat allowance ran 4-line notes
// into the slots beneath them on the Achievements board.
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
// A full-screen phone frame, flush to the slot edges. The overlay is
// edge-to-edge (px-4 lives inside it), so unlike a card anchor there is
// no 16pt page inset to honour here.
function screenFrame(s, sx, sy) {
  s.appendChild(anchor('anchor / screen 390x844', { x: ax(sx), y: ay(sy + 16), w: 390, h: 844, color: C.card, radius: 12, token: 'color.card' }));
}

board.appendChild(text('My Journal — states to draw', { x: ax(PAD), y: ay(y), size: 26, color: C.foreground, w: 800, bold: true, token: 'color.foreground' }));
y += 40;
board.appendChild(text(
  'Empty slots. Each cell holds the ANCHOR at its true app size — draw the screen / row / chip onto it.\n' +
  'Surfaces + text are bound to tokens: flip the Mode theme (Light / Dark) to draw the other pass.\n' +
  'Full-screen overlay at 390pt, opened from ProfileMenu > My Journal. One row per (user, day) in journal_entries (migs 145 + 165).\n' +
  'Audited 2026-08-09, untouched since it shipped. It rendered as a 56px sliver on every phone until 7f3b18c7 — nobody had seen it.\n' +
  'The three numbers that should drive every decision below: 6 of 12 production rows are MOOD-ONLY, 0 of 12 have a TITLE, 0 have an ATTACHMENT.',
  { x: ax(PAD), y: ay(y), size: 12, color: C.mutedFg, w: 1080, token: 'color.muted-foreground' }));
y += 108;

// ── 01 · THE SCREEN ───────────────────────────────────────────────
group('01 · THE SCREEN — five states at true size (390 × 844). This is the whole surface; everything below is a detail of it.');
note('Measured off the live overlay: header row 49pt, date bar 56.75pt (bg-secondary/20), title input at text-lg bold, toolbar 4 × 32pt,\nbody flex-1 with min-h-[40vh], footer ~33pt. On today\'s empty state that leaves roughly 500pt of nothing between the placeholder\nand the footer — the single loudest thing wrong with the screen, and what state 1 is really asking you to solve.');
grid([
  { name: 'slot / screen / today empty',
    label: 'Today · nothing written yet',
    note: 'The default, and what most opens land on.\n~500pt of void under one placeholder line.' },
  { name: 'slot / screen / today written',
    label: 'Today · title + body + 2 attachments',
    note: 'The state the feature was built for and that\nzero production rows are actually in.' },
  { name: 'slot / screen / past read-only',
    label: 'A past day · read-only',
    note: 'Body renders as markdown, toolbar hidden.\nSee 09 — read-only is a product call, not a fact.' },
  { name: 'slot / screen / mood only day',
    label: 'A day with a mood and no words',
    note: 'HALF THE REAL DATA. Today it says "No entry\nfor this day" over a mood it is holding.' },
  { name: 'slot / screen / save failed offline',
    label: 'Offline · save failed, draft held locally',
    note: 'Writing is stashed to localStorage and retried\nwith backoff. Currently only a toast says so.' },
], { w: 390, h: 940, cols: 3, build: (s, it, sx, sy) => screenFrame(s, sx, sy) });

// ── 02 · CHROME ───────────────────────────────────────────────────
group('02 · CHROME — three strips around one editor. CLAUDE.md: one dominant element per screen. Right now nothing is dominant.');
note('The header, the date bar and the footer are all permanent, all full-bleed, all hairline-separated, and together they take 139pt of\nan 844pt screen before a word is written. The date is the only one carrying information the user came for. Candidate move: fold the\nheader into the date bar so the DAY is the dominant element and Back / Log become affordances on it.');
grid([
  { name: 'slot / chrome / header 49', h: 49,
    label: 'Header · 49pt — Back · My Journal · Log',
    note: 'Title repeats the menu row that opened it.' },
  { name: 'slot / chrome / date bar 57', h: 57,
    label: 'Date bar · 57pt — ‹ · date + Today · ›',
    note: 'The only strip carrying real information.\nCandidate for the dominant element.' },
  { name: 'slot / chrome / footer 33', h: 33,
    label: 'Footer · 33pt — a permanent instruction',
    note: '"Auto-saved · swipe left/right to change days ·\ntap Log for history". Three clauses, forever.' },
], { w: 390, h: 150, cols: 3, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / strip 390', { x: ax(sx), y: ay(sy + 22), w: 390, h: it.h, color: C.secondary, radius: 0 }));
}});

// ── 03 · THE EMPTY STATE ──────────────────────────────────────────
group('03 · THE EMPTY STATE — the 500pt void. Draw what fills it.');
note('CLAUDE.md: "Data must be earned. A number gets screen space only with trend, history or comparison attached." The inverse applies\nhere — this screen is spending 500pt and showing nothing. The journal sits directly on top of workout_logs, mood_logs and\nsleep_logs and reads NONE of them. A day that already knows "Push day · 42 min · 8 sets · mood 😄" can offer that as a starting\npoint instead of a blank page. Three states worth drawing; the middle one is the proposal, and it is yours to accept or kill.');
grid([
  { name: 'slot / empty / as it is today',
    label: 'As shipped — placeholder and void',
    note: 'For comparison. Do not draw over this one.' },
  { name: 'slot / empty / prompted from the session',
    label: 'PROPOSAL · seeded from today\'s actual data',
    note: 'Chips from workout_logs / mood / sleep. Tapping\none writes a first line. Blank page problem, gone.' },
  { name: 'slot / empty / first ever entry',
    label: 'Day one — no entries have ever existed',
    note: 'Different job: explain what this is for.\nOnce only, never again.' },
], { w: 390, h: 500, cols: 3, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / body column 358', { x: ax(sx + 16), y: ay(sy + 18), w: 358, h: 400, color: C.card, radius: 12, token: 'color.card' }));
}});

// ── 04 · DAY NAVIGATION ───────────────────────────────────────────
group('04 · DAY NAVIGATION — ‹ › plus a horizontal swipe, and a skip-empty heuristic that has a hole in it.');
note('Today the arrows do not step one day: they jump to the nearest day that HAS a row, so you never land on a blank page. Except a\nmood-only row counts as "has a row", so the arrow lands you on "No entry for this day" — verified live, twice in four taps. A month\nstrip with a dot on every written day replaces both the heuristic and the Log\'s flat 365-row list, and makes the hole impossible\nrather than fixed. Draw the strip if you want it; draw the third slot either way, because that state exists until the strip lands.');
grid([
  { name: 'slot / nav / date bar as shipped',
    label: 'As shipped — ‹ date › with skip-empty',
    note: 'Swipe does the same thing. Both undiscoverable\nwithout the footer sentence.' },
  { name: 'slot / nav / month strip',
    label: 'PROPOSAL · month strip, dot per written day',
    note: 'Replaces skip-empty AND the Log list. Also the\nonly place a mood could show at a glance.' },
  { name: 'slot / nav / landed on nothing',
    label: 'Landed on a day with no words',
    note: 'Must not be a dead end. Offer the write action\nfor that day rather than a full stop.' },
], { w: 390, h: 240, cols: 3, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / date bar 390x57', { x: ax(sx), y: ay(sy + 20), w: 390, h: 57, color: C.secondary, radius: 0 }));
  s.appendChild(anchor('anchor / content 358', { x: ax(sx + 16), y: ay(sy + 89), w: 358, h: 78, color: C.card, radius: 12, token: 'color.card' }));
}});

// ── 05 · THE LOG ──────────────────────────────────────────────────
group('05 · THE LOG — the history sheet, opened from the header. Bottom sheet, rounded-t-2xl, capped at max-h-[80vh] ≈ 675pt.');
note('A flat list of up to 365 rows with no search, no month grouping and no scrubber. It is also where the mood-only rows are most\nvisibly broken: the row renders the date and then stops, because title and snippet are both empty. Six of twelve. If 04\'s month\nstrip lands, this sheet may not need to exist at all — draw it anyway so the decision is made against something.');
grid([
  { name: 'slot / log / sheet as shipped',
    label: 'The sheet — rows of date · title · snippet',
    note: 'Newest first, hairline divided, active row tinted.' },
  { name: 'slot / log / sheet grouped by month',
    label: 'PROPOSAL · grouped, with a scrubber',
    note: '365 flat rows is a scroll, not a history.' },
  { name: 'slot / log / sheet empty',
    label: 'No entries yet',
    note: 'Also what a FAILED read looks like today —\nthe two are indistinguishable to the user.' },
], { w: 390, h: 760, cols: 3, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / sheet 390x675', { x: ax(sx), y: ay(sy + 16), w: 390, h: 675, color: C.card, radius: 16, token: 'color.card' }));
}});
note('THE ROW ITSELF — 358 wide inside the sheet\'s px-4. Four shapes it has to survive, and the second one is the live defect.');
grid([
  { name: 'slot / log-row / written',   label: 'Date · title · one-line snippet', note: 'The designed case.' },
  { name: 'slot / log-row / mood only', label: 'DEFECT · date and nothing else',  note: 'No title, no body — so the row is a bare\ndate. Half the real rows look like this.' },
  { name: 'slot / log-row / untitled',  label: 'Body but no title',               note: '0 of 12 rows have a title. Assume this\nis the normal row, not the exception.' },
  { name: 'slot / log-row / active',    label: 'The day currently open',          note: 'bg-primary/10 today.' },
], { w: 292, h: 180, cols: 4, gap: 10, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / log row 260x64', { x: ax(sx + 16), y: ay(sy + 20), w: 260, h: 64, color: C.secondary, radius: 8 }));
}});

// ── 06 · MOOD ─────────────────────────────────────────────────────
group('06 · MOOD — already in the schema, already being written, and invisible on this screen. This is the highest-value group here.');
note('mood_score (1-5, migration 165) is set by tapping an emoji on MoodLogCard, which tags THAT DAY\'S JOURNAL ENTRY. MOOD_EMOJIS is\n😩 😐 🙂 😄 🔥. JournalView never reads the column; JournalHistoryModal returns it and never renders it. So the journal owns a\nmood for half its days and shows it nowhere, and until 7f3b18c7 clearing the text silently DELETED it. Where it goes is a\ncomposition decision: on the date bar it is chrome, in the body it is content, and only one of those makes a mood-only day a day.');
grid([
  { name: 'slot / mood / on the date bar',  label: 'A · beside the date', note: 'Cheapest. Reads as chrome.' },
  { name: 'slot / mood / leading the body', label: 'B · leading the entry', note: 'Makes a mood-only day a real entry\nrather than "No entry for this day".' },
  { name: 'slot / mood / settable here',    label: 'C · settable from the journal', note: 'Today it is write-only from the dashboard.\nA journal that shows it should set it.' },
  { name: 'slot / mood / the 5 steps',      label: 'The scale — 😩 😐 🙂 😄 🔥', note: 'Same 5 steps as MoodLogCard. Must not\nbecome a second, different scale.' },
], { w: 292, h: 260, cols: 4, gap: 10, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / 260 column', { x: ax(sx + 16), y: ay(sy + 20), w: 260, h: 150, color: C.card, radius: 12, token: 'color.card' }));
}});

// ── 07 · TOOLBAR & ATTACHMENTS ────────────────────────────────────
group('07 · TOOLBAR & ATTACHMENTS — four 32pt buttons and an 80pt chip grid, all of it currently unused by every production row.');
note('Bullets · Bold · Dictate · Attach. The markdown renderer handles bold and bullets ONLY, so a typed "# heading" renders a literal\nhash on a past day — the toolbar defines the whole vocabulary and should look like it. Attachments are images only (the picker used\nto offer .pdf / .txt that the uploader refused; narrowed in 7f3b18c7). Dictation appends at the END of the body, never at the caret.');
grid([
  { name: 'slot / toolbar / resting',   tool: true,  label: 'Four buttons, 32pt, naked on the page', note: 'No surface, no grouping, no separator.' },
  { name: 'slot / toolbar / dictating', tool: true,  label: 'Listening — red tint + pulsing label',  note: 'The only loud state on the screen.' },
  { name: 'slot / attach / chip grid',  tool: false, label: 'Chips — 80 × 80, wrapped, with remove', note: 'Use tileRow(), not grid-cols-N: the count\ncomes from data (CLAUDE.md).' },
  { name: 'slot / attach / uploading',  tool: false, label: 'Uploading / failed / over the 12 cap',  note: 'Hitting the cap is silent today — the\npicker just does nothing.' },
], { w: 292, h: 250, cols: 4, gap: 10, build: (s, it, sx, sy) => {
  if (it.tool) {
    for (let i = 0; i < 4; i++) {
      s.appendChild(anchor(`anchor / tool button ${i + 1} (32)`, { x: ax(sx + 16 + i * 40), y: ay(sy + 24), w: 32, h: 32, radius: 6 }));
    }
  } else {
    for (let i = 0; i < 3; i++) {
      s.appendChild(anchor(`anchor / attachment chip ${i + 1} (80)`, { x: ax(sx + 16 + i * 88), y: ay(sy + 24), w: 80, h: 80, radius: 8 }));
    }
  }
}});

// ── 08 · SAVE STATE ───────────────────────────────────────────────
group('08 · SAVE STATE — an 800ms debounce, a five-try backoff and a localStorage draft, all reported by one word under the date.');
note('There is more machinery here than the UI admits: on a failed save the snapshot is stashed under flexyn.journalDraft.<uid>.<date>,\nretried at 5s doubling to 60s, and preferred over the server copy on the next open if it is newer. The user sees "Saving…" and one\ntoast. A person writing on a train needs to know their words are held — this is the state most worth designing and least designed.');
grid([
  { name: 'slot / save / saving',    label: 'Saving… — spinner beside the date', note: '2.5pt spinner, text-micro.' },
  { name: 'slot / save / saved',     label: 'Saved — currently nothing at all',  note: 'The word simply disappears. No\nconfirmation that anything landed.' },
  { name: 'slot / save / held',      label: 'Offline — held locally, retrying',  note: 'Toast only, once. Nothing persistent\non the screen says the day is unsynced.' },
  { name: 'slot / save / gave up',   label: 'Five retries spent',                note: 'Silent. The draft survives but nothing\never says so again.' },
], { w: 292, h: 210, cols: 4, gap: 10, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / date bar 260x57', { x: ax(sx + 16), y: ay(sy + 20), w: 260, h: 57, color: C.secondary, radius: 0 }));
}});

// ── 09 · WRITING ON A PAST DAY ────────────────────────────────────
group('09 · WRITING ON A PAST DAY — the one open product call. Everything before today is read-only, and that is a decision, not a constraint.');
note('`readOnly = !isToday`. Toolbar hidden, inputs locked, and tapping the mic answers "Switch to today to write." For a TRAINING\njournal the most common real use is writing up last night\'s session the next morning — which the app refuses. Three shapes worth\ndrawing before it changes: leave it (and say why, on screen, instead of only in a toast), open a window of N days, or open\neverything and mark edits. The middle one is the usual answer; it is still yours.');
grid([
  { name: 'slot / past / locked as today',   label: 'A · stays read-only', note: 'Then the screen has to EXPLAIN it. A greyed\ntoolbar is not an explanation.' },
  { name: 'slot / past / window of n days',  label: 'B · editable for N days back', note: 'Yesterday is the case that matters.\nWhat happens at the edge of the window?' },
  { name: 'slot / past / always editable',   label: 'C · any day, edits marked', note: 'A journal you can rewrite is a different\npromise. Draw the mark if you want this.' },
], { w: 390, h: 300, cols: 3, build: (s, it, sx, sy) => {
  s.appendChild(anchor('anchor / date bar 390x57', { x: ax(sx), y: ay(sy + 18), w: 390, h: 57, color: C.secondary, radius: 0 }));
  s.appendChild(anchor('anchor / body column 358', { x: ax(sx + 16), y: ay(sy + 87), w: 358, h: 130, color: C.card, radius: 12, token: 'color.card' }));
}});

// ── FOOT ──────────────────────────────────────────────────────────
note('NOT DRAWN, ON PURPOSE — the dashboard JournalWidget (a separate collapsed card writing the same row) and the localStorage\nmigration path. Both are real surfaces; neither is this screen, and folding them in would make this board about the feature\nrather than about the day. Raise them as their own board if the widget survives the revamp.');
note('SHIPPED WITH THIS AUDIT (7f3b18c7) — the overlay now portals to <body> so it fills a phone; an empty save no longer deletes a\nrow that carries a mood; the dashboard widget no longer wipes titles; the file picker no longer offers types the uploader\nrefuses; the footer reads its translations again. None of that changed a pixel of the composition — that is what this board is for.');

board.resize(BW, y + 40);

return {
  board: BOARD_NAME,
  page: PAGE_NAME,
  x: BX, width: BW, height: y + 40,
  groups: 9,
  slots: penpotUtils.findShapes(s => s.name.indexOf('slot') === 0, board).length,
  next: 'Export the board as a PNG and LOOK at it — captions overlapping their own anchors is invisible to every structural check.',
};
