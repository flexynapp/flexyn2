// docs/penpot-gym-rival-board.js
//
// Builds the "Gym Rival" page in Penpot: twelve boards A–L covering the
// Workout-page entry card, every state of the full-screen menu, the Cardio
// Rival variant, the duel hand-off, and a spec board.
//
// SELF-CONTAINED AND IDEMPOTENT — it sweeps any board named "<letter> · …"
// off the page first, so a re-run after a half-finished draw is clean.
// Paste the whole file into the Penpot MCP `execute_code` tool.
//
// Requires the Penpot tab to be ON the "Gym Rival" page (penpot.openPage is
// async and cannot be asserted on the next line — the script bails with a
// message instead of switching).
//
// House style copied from the sibling page "Crew Wars" (values read off its
// board A, not guessed): 390 × 852 device frames spaced 470 apart, an
// 860-wide spec board, Archivo 700 for titles/figures, Figtree elsewhere,
// 11px type floor.
//
// The design is built on production evidence queried 2026-08-16 — see the
// findings ledger on board L. The short version: the rival's column is
// structurally always 0 (owner-only RLS), the live matches are 69–77 days
// old and can never settle, and net rating is volume / 100 drawn twice.

if (penpot.currentPage.name !== 'Gym Rival') {
  return { bail: 'Select the "Gym Rival" page in Penpot first. Current: ' + penpot.currentPage.name };
}
penpot.currentPage.root.children.slice().forEach(c => { if (/^[A-L] · /.test(c.name)) c.remove(); });

const P = {
  bg:'#0E1216', sheet:'#191F24', tile:'#1F262D', field:'#262E36', line:'#2A333C',
  fg:'#F5F2F0', mut:'#89949F', pri:'#F37616', grn:'#45C489', red:'#E5484D',
  blu:'#52A5E0', on:'#0B0E11', blk:'#000000', wht:'#FFFFFF',
  priDim:'#5C3A1C', priWash:'#1A1610', priTile:'#2A1B10', grnWash:'#111A16', grnDim:'#1E4A38'
};
const mk = {
  board(name,x,y,w,h,fill){ const b=penpot.createBoard(); b.name=name; b.resize(w,h); b.x=x; b.y=y;
    b.fills=[{fillColor:fill||P.bg,fillOpacity:1}]; return b; },
  rect(p,name,x,y,w,h,fill,r,op){ const s=penpot.createRectangle(); s.name=name; s.resize(w,h);
    p.appendChild(s); penpotUtils.setParentXY(s,x,y);
    s.fills=fill?[{fillColor:fill,fillOpacity:op==null?1:op}]:[]; if(r!=null)s.borderRadius=r; return s; },
  stroke(s,c,w){ s.strokes=[{strokeColor:c,strokeWidth:w||1,strokeAlignment:'inner'}]; return s; },
  ell(p,name,x,y,w,h,fill){ const s=penpot.createEllipse(); s.name=name; s.resize(w,h);
    p.appendChild(s); penpotUtils.setParentXY(s,x,y);
    s.fills=fill?[{fillColor:fill,fillOpacity:1}]:[]; return s; },
  txt(p,name,x,y,w,ch,o){ o=o||{}; const t=penpot.createText(ch); t.name=name; p.appendChild(t);
    t.resize(w,o.h||16); penpotUtils.setParentXY(t,x,y); t.growType='auto-height';
    t.fontFamily=o.ff||'Figtree'; t.fontSize=String(o.fs||13); t.fontWeight=String(o.fw||400);
    t.fills=[{fillColor:o.c||P.fg,fillOpacity:1}];
    if(o.al){ t.align=o.al; try{ t.getRange(0,ch.length).align=o.al; }catch(e){} }
    if(o.lh) t.lineHeight=String(o.lh);
    return t; }
};
// Shared chrome: the menu is a full-screen portal, so every state carries the
// same 92pt header. Returns a hairline helper bound to the board.
function chrome(B,{title,sub}){
  mk.txt(B,'title',20,28,240,title,{fs:20,fw:700,ff:'Archivo'});
  if(sub) mk.txt(B,'header sub',20,56,260,sub,{fs:12,c:P.mut});
  mk.ell(B,'close button',338,26,32,32,P.field);
  mk.txt(B,'close glyph',338,32,32,'✕',{fs:14,fw:600,c:P.mut,al:'center'});
  const hair=(y,x,w)=>mk.rect(B,'hairline',x==null?0:x,y,w==null?390:w,1,P.line,0);
  hair(92);
  return hair;
}
// The 48h AFK gate, given a real affordance — it is the rule that actually
// voids matches, and the old screen buried it in a one-line warning strip.
function afkStrip(B,y,them){
  mk.stroke(mk.rect(B,'afk strip',20,y,350,56,P.priWash,12),P.priDim,1);
  mk.ell(B,'dot / you',34,y+16,10,10,P.grn);
  mk.txt(B,'dot / you label',50,y+14,110,'You logged',{fs:11,fw:700,c:P.grn});
  mk.ell(B,'dot / them',176,y+16,10,10,P.priTile);
  mk.txt(B,'dot / them label',192,y+14,150,them,{fs:11,fw:700,c:P.mut});
  mk.txt(B,'afk rule',34,y+34,322,'Both must log a workout by Thu 9:00 pm — or the match voids.',{fs:11,c:P.mut});
}
const built = [];

/* ══ A · Entry card on Workout — six states ══════════════════════ */
{
  const B = mk.board('A · Entry card on Workout — six states',0,0,390,852);
  mk.txt(B,'board label',20,24,350,'WORKOUT PAGE  ·  ENTRY CARD',{fs:11,fw:700,c:P.mut});
  const cap=(y,s)=>mk.txt(B,'caption',20,y,350,s,{fs:11,fw:700,c:P.pri});

  cap(52,'NO MATCH — PICK A TYPE');
  mk.stroke(mk.rect(B,'card / no match',20,69,350,170,'#141A1F',16),'#4A2E17',1);
  mk.rect(B,'icon tile',175,87,40,40,P.priTile,12);
  mk.rect(B,'ic slot 18',186,98,18,18,P.pri,4);
  mk.txt(B,'title',20,137,350,'Find your rival',{fs:15,fw:700,ff:'Archivo',al:'center'});
  mk.txt(B,'desc',45,159,300,'We match you with someone near your level for the week. Out-train them to win.',{fs:12,c:P.mut,al:'center',lh:1.4});
  mk.rect(B,'btn / gym',32,193,155,34,P.pri,12);
  mk.txt(B,'btn / gym label',32,203,155,'Gym  ·  Volume',{fs:13,fw:700,c:P.wht,al:'center'});
  mk.stroke(mk.rect(B,'btn / cardio',203,193,155,34,P.tile,12),P.line,1);
  mk.txt(B,'btn / cardio label',203,203,155,'Cardio  ·  Distance',{fs:13,fw:700,al:'center'});

  function chip(y,o){
    mk.stroke(mk.rect(B,'card / '+o.k,20,y,350,78,o.bg||'#141A1F',16),o.br||P.line,1);
    mk.ell(B,'avatar',34,y+17,44,44,o.av||P.priTile);
    mk.txt(B,'avatar initial',34,y+29,44,o.in||'A',{fs:17,fw:700,ff:'Archivo',c:o.avc||P.pri,al:'center'});
    mk.txt(B,'kicker',90,y+16,230,o.kick,{fs:11,fw:700,c:o.kc||P.pri});
    mk.txt(B,'name',90,y+32,230,o.name,{fs:15,fw:700,ff:'Archivo'});
    mk.txt(B,'sub',90,y+53,240,o.sub,{fs:12,c:P.mut});
    mk.txt(B,'chevron',330,y+28,20,'›',{fs:18,fw:700,c:P.mut,al:'center'});
  }
  cap(255,'PENDING — YOUR ACCEPT IS NEEDED');
  chip(272,{k:'pending',br:P.priDim,bg:P.priWash,kick:'CONFIRM YOUR GYM RIVAL',name:'@tiptopaxle',sub:'Tap to accept  ·  expires in 2d',in:'AB'});
  cap(366,'PENDING — WAITING ON THEM');
  chip(383,{k:'waiting',kick:'WAITING FOR THEM TO ACCEPT',kc:P.mut,name:'@tiptopaxle',sub:"You're in. They haven't accepted yet.",in:'AB'});
  cap(477,'ACTIVE — REDESIGNED: THE GAP, NOT THE LEVEL');
  chip(494,{k:'active',kick:'GYM RIVAL  ·  ENDS MON',name:'@tiptopaxle',sub:'You lead by 1,240 lb',in:'AB'});
  cap(588,'VOID — SOMEONE WENT AFK');
  chip(605,{k:'void',kick:'CHALLENGE VOIDED',kc:P.mut,name:'No rewards given',sub:'Next roll in 1d 14h',in:'!',avc:P.mut,av:'#22282E'});
  cap(699,'SETTLED — RESULT (NEVER SEEN IN PROD)');
  chip(716,{k:'settled',br:P.grnDim,bg:P.grnWash,kick:"LAST WEEK'S RESULT",kc:P.grn,name:'You won  🏆',sub:'Tap for the result & roll again',in:'AB',avc:P.grn,av:'#12241C'});
  built.push(B.name);
}

/* ══ B · Reveal ═══════════════════════════════════════════════════ */
{
  const B = mk.board('B · Menu — Reveal (searching → revealed)',470,0,390,852);
  const hair = chrome(B,{title:'Rivals'});
  mk.txt(B,'caption 1',20,112,350,'1 · SEARCHING — 1.4 s, PULSING',{fs:11,fw:700,c:P.pri});
  mk.stroke(mk.ell(B,'reticle',147,168,96,96,null),P.priDim,2);
  mk.rect(B,'ic slot 34',178,199,34,34,P.pri,10);
  mk.txt(B,'searching copy',45,296,300,'Finding your Gym Rival for this week…',{fs:13,fw:700,c:P.mut,al:'center'});
  hair(370,20,350);
  mk.txt(B,'caption 2',20,392,350,'2 · REVEALED — HOLDS 1.5 s, THEN THE MATCH SCREEN',{fs:11,fw:700,c:P.pri});
  mk.ell(B,'avatar',147,440,96,96,P.priTile);
  mk.txt(B,'avatar initial',147,472,96,'AB',{fs:34,fw:700,ff:'Archivo',c:P.pri,al:'center'});
  mk.txt(B,'kicker',20,566,350,'YOUR RIVAL THIS WEEK',{fs:11,fw:700,c:P.pri,al:'center'});
  mk.txt(B,'name',20,588,350,'@tiptopaxle',{fs:26,fw:700,ff:'Archivo',al:'center',h:32});
  mk.txt(B,'meta',20,626,350,'Level 1  ·  0–0 record  ·  Gym Rival',{fs:12,c:P.mut,al:'center'});
  mk.rect(B,'cta / continue',20,668,350,56,P.pri,16);
  mk.txt(B,'cta / continue label',20,687,350,'See the matchup',{fs:15,fw:700,ff:'Archivo',c:P.wht,al:'center'});
  mk.txt(B,'note / rules',20,748,350,'Plays once per assignment — gated on localStorage flexyn.gymRival.revealed.<id>, so it survives a remount but not a new device. ADDED: the record line, and a tappable CTA so the reveal is not a timed wait you cannot skip.',{fs:11,c:P.mut,lh:1.45});
  built.push(B.name);
}

/* ══ C · Pending, both must accept ════════════════════════════════ */
{
  const B = mk.board('C · Menu — Pending, both must accept',940,0,390,852);
  const hair = chrome(B,{title:'Gym Rival',sub:'Pending  ·  neither side has accepted'});
  mk.txt(B,'ready label',20,112,350,'READY TO START',{fs:11,fw:700,c:P.mut});
  mk.ell(B,'dot / you',20,134,10,10,P.priTile);
  mk.txt(B,'dot / you label',36,132,150,'You — not yet',{fs:13,fw:700,c:P.mut});
  mk.ell(B,'dot / them',200,134,10,10,P.priTile);
  mk.txt(B,'dot / them label',216,132,154,'@tiptopaxle — not yet',{fs:13,fw:700,c:P.mut});
  hair(164,20,350);

  mk.txt(B,'table label',20,182,350,'SIZE THEM UP',{fs:11,fw:700,c:P.mut});
  mk.txt(B,'col / you',20,204,110,'YOU',{fs:11,fw:700,c:P.grn});
  mk.txt(B,'col / them',260,204,110,'@TIPTOPAXLE',{fs:11,fw:700,c:P.pri,al:'right'});
  function row(y,label,a,b,win){
    mk.txt(B,'row / '+label+' label',150,y+3,90,label.toUpperCase(),{fs:11,fw:700,c:P.mut,al:'center'});
    mk.txt(B,'row / '+label+' you',20,y,120,a,{fs:15,fw:700,ff:'Archivo',c:win==='a'?P.grn:P.fg});
    mk.txt(B,'row / '+label+' them',250,y,120,b,{fs:15,fw:700,ff:'Archivo',c:win==='b'?P.grn:P.fg,al:'right'});
    mk.rect(B,'row hairline',20,y+30,350,1,P.line,0);
  }
  row(226,'Level','3','1','a');
  row(268,'Record','0–0','0–0');
  row(310,'Volume','118,400 lb','96,200 lb','a');
  mk.txt(B,'table note',20,352,350,'Lifetime figures from their public profile — this week starts level.',{fs:12,c:P.mut});

  hair(392,20,350);
  mk.txt(B,'rule label',20,408,350,'HOW IT STARTS',{fs:11,fw:700,c:P.pri});
  mk.txt(B,'rule copy',20,428,350,'Both of you accept, then you each have 48 hours to log a workout. Miss it and the match voids with no rewards for either side.',{fs:13,c:P.mut,lh:1.45});
  mk.rect(B,'cta / accept',20,506,350,56,P.pri,16);
  mk.txt(B,'cta / accept label',20,525,350,'Accept challenge',{fs:15,fw:700,ff:'Archivo',c:P.wht,al:'center'});
  mk.stroke(mk.rect(B,'cta / decline',20,574,169,48,null,16),P.line,1);
  mk.txt(B,'cta / decline label',20,590,169,'Decline',{fs:14,fw:700,c:P.mut,al:'center'});
  mk.stroke(mk.rect(B,'cta / reroll',201,574,169,48,null,16),P.line,1);
  mk.txt(B,'cta / reroll label',201,590,169,'Reroll',{fs:14,fw:700,c:P.mut,al:'center'});
  mk.txt(B,'note / waiting',20,648,350,'AFTER YOU ACCEPT — the primary button becomes a waiting state: your dot turns green, the CTA reads "Waiting for @tiptopaxle" and Decline stays available, Reroll does not.',{fs:11,c:P.mut,lh:1.45});
  mk.txt(B,'note / rules',20,714,350,'NEVER EXERCISED IN PRODUCTION: 0 of 44 assignment rows have ever been confirmed by either side, and the newest row predates this flow by five weeks. Everything on this board is unproven.',{fs:11,c:P.red,lh:1.45});
  built.push(B.name);
}

/* ══ D · Active match — THE REDESIGN ══════════════════════════════ */
{
  const B = mk.board('D · Menu — Active match (THE REDESIGN)',1410,0,390,852);
  const hair = chrome(B,{title:'Gym Rival',sub:'@tiptopaxle  ·  Level 1'});
  afkStrip(B,112,"They haven't");

  // HERO: one metric, one bar, one gap sentence.
  mk.txt(B,'metric label',20,192,350,'TOTAL VOLUME THIS WEEK  ·  LB',{fs:11,fw:700,c:P.mut});
  mk.txt(B,'side / you',20,214,120,'YOU',{fs:11,fw:700,c:P.grn});
  mk.ell(B,'side / rival avatar',350,208,20,20,P.priTile);
  mk.txt(B,'side / rival avatar initial',350,212,20,'A',{fs:11,fw:700,c:P.pri,al:'center'});
  mk.txt(B,'side / rival',190,214,152,'@TIPTOPAXLE',{fs:11,fw:700,c:P.pri,al:'right'});
  mk.txt(B,'figure / you',20,232,160,'14,820',{fs:30,fw:700,ff:'Archivo',c:P.grn,h:38});
  mk.txt(B,'figure / rival',210,232,160,'13,580',{fs:30,fw:700,ff:'Archivo',al:'right',h:38});
  mk.rect(B,'track / bg',20,282,350,10,P.line,5);
  mk.rect(B,'track / your share',20,282,186,10,P.grn,5);
  mk.txt(B,'gap sentence',20,304,350,'You lead by 1,240 lb',{fs:15,fw:700,ff:'Archivo',c:P.grn});
  mk.txt(B,'gap note',20,326,350,'Higher total when the week ends takes the prize.',{fs:12,c:P.mut});

  hair(360,20,350);
  mk.txt(B,'clock / ends label',20,376,160,'ENDS',{fs:11,fw:700,c:P.mut});
  mk.txt(B,'clock / ends value',20,394,190,'Mon 18 Aug, 00:05',{fs:15,fw:700,ff:'Archivo'});
  mk.txt(B,'clock / left label',210,376,160,'REMAINING',{fs:11,fw:700,c:P.mut,al:'right'});
  mk.txt(B,'clock / left value',210,394,160,'3d 6h',{fs:15,fw:700,ff:'Archivo',al:'right'});
  mk.txt(B,'clock / started',20,422,350,'Started Mon 11 Aug  ·  accepted by both',{fs:12,c:P.mut});
  hair(450,20,350);
  mk.txt(B,'prize label',20,466,350,'WINNER TAKES',{fs:11,fw:700,c:P.pri});
  mk.txt(B,'prize value',20,484,350,'5,000 XP   ·   500 coins   ·   5 capsules',{fs:15,fw:700,ff:'Archivo'});
  hair(520,20,350);
  mk.rect(B,'cta / primary',20,544,350,56,P.pri,16);
  mk.txt(B,'cta / primary label',20,563,350,'Log a workout',{fs:15,fw:700,ff:'Archivo',c:P.wht,al:'center'});
  mk.stroke(mk.rect(B,'cta / secondary',20,612,350,48,null,16),P.line,1);
  mk.txt(B,'cta / secondary label',20,628,350,'Challenge @tiptopaxle to a duel',{fs:14,fw:700,al:'center'});
  mk.txt(B,'cta / tertiary',20,676,350,'View their profile',{fs:13,fw:700,c:P.mut,al:'center'});
  mk.txt(B,'note / rules',20,724,350,'REPLACES: the 80pt avatar pair, the "0 — 0" net-rating box, the duplicate VOLUME stat row and the 3-tile prize panel. Net rating IS volume / 100 — the old screen drew one metric twice.',{fs:11,c:P.mut,lh:1.45});
  built.push(B.name);
}

/* ══ E · Active, rival's total not yet known ══════════════════════ */
{
  const B = mk.board("E · Menu — Active, rival's total not yet known",1880,0,390,852);
  const hair = chrome(B,{title:'Gym Rival',sub:'@tiptopaxle  ·  Level 1'});
  afkStrip(B,112,'They — not visible');
  mk.txt(B,'metric label',20,192,350,'TOTAL VOLUME THIS WEEK  ·  LB',{fs:11,fw:700,c:P.mut});
  mk.txt(B,'side / you',20,214,120,'YOU',{fs:11,fw:700,c:P.grn});
  mk.txt(B,'side / rival',190,214,180,'@TIPTOPAXLE',{fs:11,fw:700,c:P.mut,al:'right'});
  mk.txt(B,'figure / you',20,232,180,'14,820',{fs:30,fw:700,ff:'Archivo',c:P.grn,h:38});
  // Words, not an em dash: CLAUDE.md warns that a column of em dashes reads
  // as a broken stat rather than as an absent one.
  mk.txt(B,'figure / rival — absent',150,244,220,'scored at settlement',{fs:13,fw:700,c:'#5B666F',al:'right'});
  mk.rect(B,'track / bg',20,282,350,10,'#22282E',5);
  mk.rect(B,'track / your share',20,282,148,10,P.grn,5);
  for(let i=0;i<12;i++) mk.rect(B,'track / hatch '+i,178+i*16,282,6,10,'#2F3840',3);
  mk.txt(B,'state sentence',20,304,350,'Your total so far',{fs:15,fw:700,ff:'Archivo'});
  mk.txt(B,'state note',20,326,350,'Their total is scored server-side when the week settles. The app cannot read another user’s workout logs.',{fs:12,c:P.mut,lh:1.45});
  hair(378,20,350);
  mk.txt(B,'clock / ends label',20,394,160,'ENDS',{fs:11,fw:700,c:P.mut});
  mk.txt(B,'clock / ends value',20,412,190,'Mon 18 Aug, 00:05',{fs:15,fw:700,ff:'Archivo'});
  mk.txt(B,'clock / left label',210,394,160,'REMAINING',{fs:11,fw:700,c:P.mut,al:'right'});
  mk.txt(B,'clock / left value',210,412,160,'3d 6h',{fs:15,fw:700,ff:'Archivo',al:'right'});
  hair(450,20,350);
  mk.txt(B,'prize label',20,466,350,'WINNER TAKES',{fs:11,fw:700,c:P.pri});
  mk.txt(B,'prize value',20,484,350,'5,000 XP   ·   500 coins   ·   5 capsules',{fs:15,fw:700,ff:'Archivo'});
  hair(520,20,350);
  mk.rect(B,'cta / primary',20,544,350,56,P.pri,16);
  mk.txt(B,'cta / primary label',20,563,350,'Log a workout',{fs:15,fw:700,ff:'Archivo',c:P.wht,al:'center'});
  mk.stroke(mk.rect(B,'cta / secondary',20,612,350,48,null,16),P.line,1);
  mk.txt(B,'cta / secondary label',20,628,350,'Challenge @tiptopaxle to a duel',{fs:14,fw:700,al:'center'});
  mk.txt(B,'note / rules',20,690,350,'THIS IS WHAT PRODUCTION RENDERS TODAY, drawn honestly. getWeeklyRivalStats reads workout_logs / cardio_logs for the rival id from the client, and both tables are owner-only RLS — so the rival column is structurally 0, never an empty week. The old screen printed a confident "0" and a "Dead even" verdict on top of it.',{fs:11,c:P.red,lh:1.45});
  mk.txt(B,'note / fix',20,790,350,'FIX: call the SECURITY DEFINER RPC gym_rival_net_rating(uid, since, type) — it already exists (mig 225) and has never been called from the client. Then board D is reachable and this board is only a loading state.',{fs:11,c:P.mut,lh:1.45});
  built.push(B.name);
}

/* ══ F · Stalled match — NEW STATE ════════════════════════════════ */
{
  const B = mk.board('F · Menu — Stalled match (NEW STATE)',2350,0,390,852);
  chrome(B,{title:'Gym Rival'});
  mk.rect(B,'icon tile',167,132,56,56,P.priTile,16);
  mk.txt(B,'icon glyph',167,148,56,'!',{fs:26,fw:700,ff:'Archivo',c:P.pri,al:'center'});
  mk.txt(B,'state title',20,212,350,'This match can’t finish',{fs:20,fw:700,ff:'Archivo',al:'center'});
  mk.txt(B,'state copy',35,246,320,'It was assigned 69 days ago and never accepted by either side, so the weekly settlement skips it. Nothing you log will score against it.',{fs:13,c:P.mut,al:'center',lh:1.45});
  mk.txt(B,'ledger label',20,330,350,'WHY',{fs:11,fw:700,c:P.mut});
  function led(y,k,v,c){
    mk.txt(B,'ledger / '+k+' key',20,y,180,k,{fs:12,c:P.mut});
    mk.txt(B,'ledger / '+k+' val',180,y,190,v,{fs:13,fw:700,c:c||P.fg,al:'right'});
    mk.rect(B,'ledger hairline',20,y+26,350,1,P.line,0);
  }
  led(352,'Assigned','8 Jun 2026');
  led(388,'Accepted','never',P.red);
  led(424,'Status in the table','active');
  led(460,'Settles','never',P.red);
  mk.txt(B,'ledger note',20,500,350,'gym_rival_settle_week() only picks up rows where accepted_at IS NOT NULL.',{fs:11,c:P.mut,lh:1.45});
  mk.rect(B,'cta / primary',20,556,350,56,P.pri,16);
  mk.txt(B,'cta / primary label',20,575,350,'Clear it and find a new rival',{fs:15,fw:700,ff:'Archivo',c:P.wht,al:'center'});
  mk.txt(B,'note / rules',20,648,350,'THE STATE A REAL USER SEES TODAY. All 3 live rows are like this — 69, 71 and 77 days old, accepted_at NULL. The old screen rendered them as a healthy active match because its countdown is msUntilWeekEnd(), pure calendar arithmetic that never reads the assignment. So a 69-day-old match re-arms itself every Monday and prints "14h 18m left" forever.',{fs:11,c:P.red,lh:1.45});
  mk.txt(B,'note / fix',20,764,350,'DETECTION: status active AND accepted_at IS NULL AND assigned_at older than the current week. No new column needed.',{fs:11,c:P.mut,lh:1.45});
  built.push(B.name);
}

/* ══ G · Void — AFK ═══════════════════════════════════════════════ */
{
  const B = mk.board('G · Menu — Void (someone went AFK)',2820,0,390,852);
  chrome(B,{title:'Gym Rival'});
  mk.rect(B,'icon tile',167,132,56,56,P.priTile,16);
  mk.txt(B,'icon glyph',167,148,56,'!',{fs:26,fw:700,ff:'Archivo',c:P.pri,al:'center'});
  mk.txt(B,'state title',20,212,350,'Challenge voided',{fs:20,fw:700,ff:'Archivo',al:'center'});
  mk.txt(B,'state copy',35,246,320,'A workout wasn’t logged within 48 hours of accepting, so the week was cancelled. No rewards for either side.',{fs:13,c:P.mut,al:'center',lh:1.45});

  // Name who missed it — the old screen said "someone", which reads as blame.
  mk.txt(B,'who label',20,330,350,'WHO LOGGED',{fs:11,fw:700,c:P.mut});
  mk.ell(B,'dot / you',20,354,10,10,P.grn);
  mk.txt(B,'dot / you label',36,352,160,'You  —  Tue 6:40 pm',{fs:13,fw:700,c:P.grn});
  mk.rect(B,'who hairline',20,382,350,1,P.line,0);
  mk.ell(B,'dot / them',20,400,10,10,P.red);
  mk.txt(B,'dot / them label',36,398,220,'@tiptopaxle  —  never',{fs:13,fw:700,c:P.mut});
  mk.rect(B,'who hairline 2',20,428,350,1,P.line,0);
  mk.txt(B,'who note',20,444,350,'Your workout still counts for XP, quests and your league — only the rival match was cancelled.',{fs:12,c:P.mut,lh:1.45});

  mk.stroke(mk.rect(B,'reset chip',20,500,350,56,P.tile,12),P.line,1);
  mk.txt(B,'reset label',36,514,200,'NEXT RIVAL ROLL',{fs:11,fw:700,c:P.mut});
  mk.txt(B,'reset value',36,530,200,'Monday, in 1d 14h',{fs:15,fw:700,ff:'Archivo'});
  mk.txt(B,'note / rules',20,588,350,'ADDED: the who-logged rows and the "your workout still counts" line. The old screen said only that "someone went AFK", which on a two-person match reads as an accusation and gives the user nothing to check.',{fs:11,c:P.mut,lh:1.45});
  mk.txt(B,'note / cardio',20,672,350,'DEFECT — gym_rival_void_stale_all() checks workout_logs ONLY. A Cardio Rival match therefore voids at 48 h even when both runners logged every day, because their sessions land in cardio_logs. See board J.',{fs:11,c:P.red,lh:1.45});
  mk.txt(B,'note / unreached',20,756,350,'Also never reached in production: the voider requires accepted_at IS NOT NULL, and no row has one.',{fs:11,c:P.mut,lh:1.45});
  built.push(B.name);
}

/* ══ H · Settled — you won ════════════════════════════════════════ */
{
  const B = mk.board('H · Menu — Settled, you won',3290,0,390,852);
  chrome(B,{title:'Gym Rival'});
  mk.rect(B,'icon tile',167,132,56,56,'#12241C',16);
  mk.txt(B,'icon glyph',167,146,56,'🏆',{fs:26,al:'center'});
  mk.txt(B,'state title',20,212,350,'You won the week',{fs:24,fw:700,ff:'Archivo',al:'center',h:30});
  mk.txt(B,'state copy',35,250,320,'You out-trained @tiptopaxle. Rewards are already on your account.',{fs:13,c:P.mut,al:'center',lh:1.45});

  // The final scoreline, in the same vocabulary as board D.
  mk.txt(B,'final label',20,314,350,'FINAL  ·  TOTAL VOLUME  ·  LB',{fs:11,fw:700,c:P.mut});
  mk.txt(B,'figure / you',20,334,160,'18,240',{fs:30,fw:700,ff:'Archivo',c:P.grn,h:38});
  mk.txt(B,'figure / rival',210,334,160,'13,580',{fs:30,fw:700,ff:'Archivo',c:P.mut,al:'right',h:38});
  mk.rect(B,'track / bg',20,384,350,10,P.line,5);
  mk.rect(B,'track / your share',20,384,206,10,P.grn,5);
  mk.txt(B,'margin',20,406,350,'Won by 4,660 lb',{fs:13,fw:700,c:P.grn});

  mk.rect(B,'reward hairline',20,444,350,1,P.line,0);
  mk.txt(B,'reward label',20,460,350,'PAID OUT',{fs:11,fw:700,c:P.grn});
  function rw(x,v,k){
    mk.txt(B,'reward / '+k+' value',x,480,110,v,{fs:20,fw:700,ff:'Archivo',al:'center',h:26});
    mk.txt(B,'reward / '+k+' label',x,508,110,k,{fs:11,fw:700,c:P.mut,al:'center'});
  }
  rw(20,'5,000','XP'); rw(140,'500','COINS'); rw(260,'5','CAPSULES');
  mk.rect(B,'reward hairline 2',20,538,350,1,P.line,0);

  mk.txt(B,'record',20,554,350,'Your Gym Rival record: 1–0',{fs:13,fw:700});
  mk.rect(B,'cta / primary',20,594,350,56,P.pri,16);
  mk.txt(B,'cta / primary label',20,613,350,'Find a new rival',{fs:15,fw:700,ff:'Archivo',c:P.wht,al:'center'});
  mk.txt(B,'cta / tertiary',20,668,350,'Share the win',{fs:13,fw:700,c:P.mut,al:'center'});
  mk.txt(B,'note / rules',20,712,350,'NEVER RENDERED FOR ANYONE: 0 of 44 rows carry a winner_id or a settled_at, so this screen, the payout and the two settlement notifications are all unexercised. Prove it end to end before trusting the numbers — the RPC grants 5,000 XP through increment_user_xp, which is capped at 100k per call and rate-limited per 24 h (mig 042 / 188).',{fs:11,c:P.red,lh:1.45});
  built.push(B.name);
}

/* ══ I · Settled — loss and draw ══════════════════════════════════ */
{
  const B = mk.board('I · Menu — Settled, loss & draw',3760,0,390,852);
  const hair = chrome(B,{title:'Gym Rival'});
  mk.txt(B,'caption 1',20,112,350,'LOSS',{fs:11,fw:700,c:P.pri});
  mk.rect(B,'icon tile / loss',167,136,56,56,P.priTile,16);
  mk.rect(B,'ic slot 26 / loss',180,149,30,30,P.pri,8);
  mk.txt(B,'state title / loss',20,208,350,'@tiptopaxle took the week',{fs:20,fw:700,ff:'Archivo',al:'center'});
  mk.txt(B,'final label / loss',20,248,350,'FINAL  ·  TOTAL VOLUME  ·  LB',{fs:11,fw:700,c:P.mut});
  mk.txt(B,'figure / you loss',20,268,160,'11,120',{fs:26,fw:700,ff:'Archivo',al:'left',h:32});
  mk.txt(B,'figure / rival loss',210,268,160,'13,580',{fs:26,fw:700,ff:'Archivo',c:P.pri,al:'right',h:32});
  mk.rect(B,'track / bg loss',20,310,350,10,P.line,5);
  mk.rect(B,'track / your share loss',20,310,157,10,P.mut,5);
  mk.txt(B,'margin / loss',20,332,350,'2,460 lb short — about four sets.',{fs:13,fw:700,c:P.mut});
  mk.stroke(mk.rect(B,'cta / loss',20,364,350,48,null,16),P.line,1);
  mk.txt(B,'cta / loss label',20,380,350,'Find a new rival',{fs:14,fw:700,al:'center'});
  hair(438,20,350);

  mk.txt(B,'caption 2',20,456,350,'DRAW',{fs:11,fw:700,c:P.pri});
  mk.rect(B,'icon tile / draw',167,480,56,56,P.tile,16);
  mk.rect(B,'ic slot 26 / draw',180,493,30,30,P.mut,8);
  // The draw state demonstrates the recommendation rather than the thing being
  // criticised: an exact non-zero tie is vanishingly rare, so a draw in practice
  // IS the empty week and the screen says so.
  mk.txt(B,'state title / draw',20,552,350,'Neither of you logged',{fs:20,fw:700,ff:'Archivo',al:'center'});
  mk.txt(B,'final label / draw',20,592,350,'FINAL  ·  TOTAL VOLUME  ·  LB',{fs:11,fw:700,c:P.mut});
  mk.txt(B,'figure / you draw',20,612,160,'0',{fs:26,fw:700,ff:'Archivo',h:32});
  mk.txt(B,'figure / rival draw',210,612,160,'0',{fs:26,fw:700,ff:'Archivo',al:'right',h:32});
  mk.rect(B,'track / bg draw',20,654,350,10,P.line,5);
  mk.txt(B,'margin / draw',20,676,350,'No winner, and no rewards — the week ran out empty on both sides.',{fs:13,fw:700,c:P.mut});
  mk.txt(B,'note / rules',20,720,350,'A true tie needs both sides at the same volume to the nearest 100 lb, which is vanishingly rare. In practice a draw IS the empty week — so the screen names that, instead of "dead even", which flatters it.',{fs:11,c:P.mut,lh:1.45});
  built.push(B.name);
}

/* ══ J · Cardio Rival variant ═════════════════════════════════════ */
{
  const B = mk.board('J · Menu — Cardio Rival variant',4230,0,390,852);
  const hair = chrome(B,{title:'Cardio Rival',sub:'@tiptopaxle  ·  Level 1'});
  afkStrip(B,112,"They haven't");
  mk.txt(B,'metric label',20,192,350,'TOTAL DISTANCE THIS WEEK  ·  MI',{fs:11,fw:700,c:P.mut});
  mk.txt(B,'side / you',20,214,120,'YOU',{fs:11,fw:700,c:P.grn});
  mk.txt(B,'side / rival',190,214,180,'@TIPTOPAXLE',{fs:11,fw:700,c:P.pri,al:'right'});
  mk.txt(B,'figure / you',20,232,160,'18.4',{fs:30,fw:700,ff:'Archivo',c:P.grn,h:38});
  mk.txt(B,'figure / rival',210,232,160,'21.9',{fs:30,fw:700,ff:'Archivo',al:'right',h:38});
  mk.rect(B,'track / bg',20,282,350,10,P.line,5);
  mk.rect(B,'track / your share',20,282,160,10,P.mut,5);
  mk.txt(B,'gap sentence',20,304,350,'You’re 3.5 mi behind',{fs:15,fw:700,ff:'Archivo',c:P.pri});
  mk.txt(B,'gap note',20,326,350,'Higher total when the week ends takes the prize.',{fs:12,c:P.mut});
  hair(360,20,350);
  mk.txt(B,'clock / ends label',20,376,160,'ENDS',{fs:11,fw:700,c:P.mut});
  mk.txt(B,'clock / ends value',20,394,190,'Mon 18 Aug, 00:05',{fs:15,fw:700,ff:'Archivo'});
  mk.txt(B,'clock / left label',210,376,160,'REMAINING',{fs:11,fw:700,c:P.mut,al:'right'});
  mk.txt(B,'clock / left value',210,394,160,'3d 6h',{fs:15,fw:700,ff:'Archivo',al:'right'});
  hair(432,20,350);
  mk.rect(B,'cta / primary',20,456,350,56,P.pri,16);
  mk.txt(B,'cta / primary label',20,475,350,'Start a cardio session',{fs:15,fw:700,ff:'Archivo',c:P.wht,al:'center'});

  mk.txt(B,'note / units',20,538,350,'UNITS FOLLOW THE USER — DistanceUnitContext, so this reads km for most of the world. The figure is the distance itself, not the net rating (km × 20), for the same reason board D shows volume rather than volume / 100.',{fs:11,c:P.mut,lh:1.45});
  mk.txt(B,'note / defect',20,614,350,'DEFECT — the 48 h AFK gate above is a LIE on this variant. gym_rival_void_stale_all() only looks in workout_logs, so two runners who log every day still get voided at 48 h unless one of them lifts. Either widen the voider to cardio_logs or drop the strip from this variant.',{fs:11,c:P.red,lh:1.45});
  mk.txt(B,'note / never',20,714,350,'NEVER ROLLED: all 44 rows in production are rival_type = gym. The Cardio button exists on the entry card and nobody has ever pressed it through to a row.',{fs:11,c:P.red,lh:1.45});
  built.push(B.name);
}

/* ══ K · Duel hand-off ════════════════════════════════════════════ */
{
  const B = mk.board('K · Duel hand-off (CreateDuelModal)',4700,0,390,852);
  mk.rect(B,'backdrop scrim',0,0,390,852,P.blk,0,0.6);
  mk.txt(B,'behind: gym rival menu (dimmed)',20,60,350,'GYM RIVAL  ·  ACTIVE',{fs:11,fw:700,c:P.mut});
  const S = mk.board('Sheet',0,352,390,500,P.sheet); B.appendChild(S); penpotUtils.setParentXY(S,0,352);
  S.borderRadius = 16;
  mk.rect(S,'grabber',177,10,36,4,P.mut,2);
  mk.txt(S,'title',20,30,260,'Challenge to a duel',{fs:20,fw:700,ff:'Archivo'});
  mk.txt(S,'sub',20,58,260,'vs @tiptopaxle  ·  head to head',{fs:12,c:P.mut});
  mk.ell(S,'close button',338,28,32,32,P.field);
  mk.txt(S,'close glyph',338,34,32,'✕',{fs:14,fw:600,c:P.mut,al:'center'});
  mk.rect(S,'header hairline',0,92,390,1,P.line,0);
  mk.txt(S,'field label',20,112,350,'METRIC',{fs:11,fw:700,c:P.mut});
  mk.stroke(mk.rect(S,'field / metric',20,132,350,48,P.field,12),P.line,1);
  mk.txt(S,'field / metric value',36,148,300,'Total volume',{fs:14,fw:700});
  mk.txt(S,'field label 2',20,196,350,'LENGTH',{fs:11,fw:700,c:P.mut});
  mk.rect(S,'seg / 3d',20,216,110,44,P.field,12);
  mk.txt(S,'seg / 3d label',20,229,110,'3 days',{fs:13,fw:700,c:P.mut,al:'center'});
  mk.rect(S,'seg / 7d',140,216,110,44,P.pri,12);
  mk.txt(S,'seg / 7d label',140,229,110,'7 days',{fs:13,fw:700,c:P.wht,al:'center'});
  mk.rect(S,'seg / 14d',260,216,110,44,P.field,12);
  mk.txt(S,'seg / 14d label',260,229,110,'14 days',{fs:13,fw:700,c:P.mut,al:'center'});
  mk.txt(S,'field label 3',20,276,350,'STAKE',{fs:11,fw:700,c:P.mut});
  mk.stroke(mk.rect(S,'field / stake',20,296,350,48,P.field,12),P.line,1);
  mk.txt(S,'field / stake value',36,312,300,'100 coins each',{fs:14,fw:700});
  mk.rect(S,'cta / send',20,368,350,56,P.pri,16);
  mk.txt(S,'cta / send label',20,387,350,'Send challenge',{fs:15,fw:700,ff:'Archivo',c:P.wht,al:'center'});
  mk.txt(S,'note',20,440,350,'A duel is a separate feature with its own stake and clock — it does not affect the rival week.',{fs:11,c:P.mut,al:'center',lh:1.45});
  mk.txt(B,'note / rules',20,112,350,'UNCHANGED FEATURE, RE-LAYOUT ONLY. Drawn here because the rival menu is its only entry point from this surface — and because on the old screen this was the ONLY button, which made "open another modal" the primary action of a screen whose actual job is to get you training. On board D it is demoted to secondary.',{fs:11,c:P.mut,lh:1.45});
  built.push(B.name);
}

/* ══ L · Spec ═════════════════════════════════════════════════════ */
{
  const W = 860, B = mk.board('L · Spec — findings, states, deltas',5170,0,W,2040);
  const X = 40, CW = 780;
  mk.txt(B,'title',X,40,CW,'Gym Rival — redesign spec',{fs:26,fw:700,ff:'Archivo',h:34});
  mk.txt(B,'subtitle',X,80,CW,'Boards A–K. Evidence queried against production 2026-08-16.',{fs:13,c:P.mut});
  mk.rect(B,'rule',X,112,CW,1,P.line,0);

  let y = 140;
  const h2=(s)=>{ mk.txt(B,'section',X,y,CW,s,{fs:11,fw:700,c:P.pri}); y+=24; };
  const p =(s,c)=>{ const t=mk.txt(B,'copy',X,y,CW,s,{fs:13,c:c||P.fg,lh:1.5}); y+=Math.ceil(s.length/108)*20+16; return t; };

  h2('01 · WHAT THE PRODUCTION DATA SAYS');
  p('44 assignment rows exist. 0 have ever been confirmed by either side, 0 have an accepted_at, 0 have a winner_id, 0 have a settled_at, and all 44 are rival_type = gym. The newest row is 8 Jun 2026; the confirm-and-settle flow shipped 15 Jul 2026. So gym_rival_roll() has never produced a row, and every screen downstream of the accept — pending, active, void, settled, the payout and both settlement notifications — is unexercised.');
  p('The three live rows are 69, 71 and 77 days old with accepted_at NULL. gym_rival_settle_week() selects only rows WHERE status = \'active\' AND accepted_at IS NOT NULL, so the settler cannot see them and never will. Meanwhile the menu\'s countdown is msUntilWeekEnd() — pure calendar arithmetic that never reads the assignment — so those rows re-arm every Monday and print a fresh "14h 18m left" indefinitely. That is the screen in the bug report.', P.red);
  p('getWeeklyRivalStats(userId, rivalId) reads workout_logs and cardio_logs for the RIVAL from the client. Both tables carry one owner-only policy (auth.uid() = user_id OR email = created_by) with no rival exception, so the rival column is structurally 0 — it is not an empty week. The screen then renders "0 — 0" and concludes "Dead even — keep training."', P.red);
  p('The fix already exists and has never been called: gym_rival_net_rating(p_uid, p_since, p_type) is SECURITY DEFINER (mig 225) and computes exactly this figure cross-user. Grep finds zero client call sites — the only mention in the repo is a comment in aiCoach/planBuilder.js.');
  p('gym_rival_void_stale_all() checks workout_logs ONLY. A Cardio Rival match therefore voids at 48 h even if both runners logged every day.', P.red);
  p('assignGymRival(), checkOverthrow() and performOverthrow() have no callers anywhere in src/ — the legacy pre-221 path that created all 44 rows.');
  y += 8;

  h2('02 · THE COMPOSITION MOVE');
  p('The old screen is a scoreboard whose four elements are, in order of size: two 80pt avatars, a "0 — 0" net-rating box, a VOLUME stat row, and a bordered three-tile prize panel. Net rating IS volume / 100, so the box and the row are one metric drawn twice; the right-hand half of both can never be non-zero; and the prize has never once been paid. The largest, most confident things on the screen are the ones with nothing behind them.');
  p('The redesign makes the week\'s work the subject and the rival the frame. One metric, in its own units, on one divided track, under one sentence that states the GAP — which is the number a user can act on, where two abstract net ratings are not. The clock is derived from the match rather than the calendar, so a stalled match cannot masquerade as live. The prize becomes a line. The 48 h rule gets a two-dot indicator, because it is the rule that actually decides most matches. And the primary button becomes "Log a workout" — on the old screen the only button opened a different feature.');
  y += 8;

  h2('03 · STATES AND WHERE THEY LIVE');
  const rows = [
    ['A','Entry card — 6 states','Workout page','re-layout + new ACTIVE subtitle (the gap)'],
    ['B','Reveal — searching / revealed','GymRivalMenu','re-layout + skip CTA'],
    ['C','Pending — both must accept','GymRivalMenu','re-layout, card stack → hairline table'],
    ['D','Active — the redesign','GymRivalMenu','NEW composition'],
    ['E','Active — rival total unknown','GymRivalMenu','NEW state (what prod renders today)'],
    ['F','Stalled match','GymRivalMenu','NEW state'],
    ['G','Void — AFK','GymRivalMenu','re-layout + who-logged rows'],
    ['H','Settled — won','GymRivalMenu','re-layout + final scoreline'],
    ['I','Settled — loss & draw','GymRivalMenu','re-layout + honest draw copy'],
    ['J','Cardio Rival variant','GymRivalMenu','NEW board (never rolled in prod)'],
    ['K','Duel hand-off','CreateDuelModal','unchanged, demoted to secondary'],
  ];
  mk.txt(B,'th 1',X,y,30,'',{fs:11,fw:700,c:P.mut});
  mk.txt(B,'th 2',X+34,y,240,'BOARD',{fs:11,fw:700,c:P.mut});
  mk.txt(B,'th 3',X+290,y,170,'COMPONENT',{fs:11,fw:700,c:P.mut});
  mk.txt(B,'th 4',X+470,y,310,'STATUS',{fs:11,fw:700,c:P.mut});
  y += 20; mk.rect(B,'rule',X,y,CW,1,P.line,0); y += 12;
  rows.forEach(r => {
    mk.txt(B,'row / '+r[0]+' key',X,y,30,r[0],{fs:13,fw:700,ff:'Archivo',c:P.pri});
    mk.txt(B,'row / '+r[0]+' name',X+34,y,250,r[1],{fs:13,fw:700});
    mk.txt(B,'row / '+r[0]+' comp',X+290,y,180,r[2],{fs:12,c:P.mut});
    const isNew = r[3].indexOf('NEW') === 0;
    mk.txt(B,'row / '+r[0]+' status',X+470,y,310,r[3],{fs:12,c:isNew?P.grn:P.mut});
    y += 22; mk.rect(B,'row hairline',X,y,CW,1,P.line,0); y += 10;
  });
  y += 14;

  h2('04 · ELEMENT LEDGER');
  const el = [
    ['Board','390 × 852, background #0E1216'],
    ['Sheet / card','#191F24, radius 16'],
    ['Tile / field','#1F262D and #262E36, radius 12'],
    ['Hairline','#2A333C, 1 px'],
    ['Text','#F5F2F0 primary, #89949F muted'],
    ['Accent','#F37616 primary, #45C489 ahead, #E5484D defect notes'],
    ['Titles / figures','Archivo 700 — 26 / 20 / 15 pt, hero figure 30 pt'],
    ['Body / labels','Figtree — 13 body, 12 sub, 11 label (uppercase 700)'],
    ['Tap targets','CTA 56 pt, secondary 48 pt, rows 44 pt floor'],
    ['Track','350 × 10, radius 5 — divided, never two separate bars'],
  ];
  el.forEach(e => {
    mk.txt(B,'el / '+e[0]+' key',X,y,230,e[0],{fs:12,fw:700});
    mk.txt(B,'el / '+e[0]+' val',X+240,y,540,e[1],{fs:12,c:P.mut});
    y += 20; mk.rect(B,'el hairline',X,y,CW,1,P.line,0); y += 8;
  });
  y += 14;

  h2('05 · BEFORE SHIPPING ANY OF THIS');
  p('Type floor — every label on these boards is 11 pt, which is the app\'s own --text-micro floor. Do not let a drawn label go under it; the Recipes and History boards both drew 8.5–10.5 pt and both had to be corrected on the way to code.');
  p('i18n — the strings here are English. gymRival.* currently holds only four keys (findTitle, findDesc, findButton, searching) and their non-English values still say "Nemesis", which the product stopped calling it. Every new string needs tFallback(key, \'English\') and the existing four need re-translating, not extending.');
  p('Units — volume goes through formatWeight/weightUnit and distance through formatDistance/distanceUnit. The figures drawn here are lb and mi; most users will see kg and km, which is wider — check the two figures still fit side by side at 390 pt.');
  p('Bar weight — workout_logs.total_volume is RAW and must stay raw (include_bar_in_volume is display-only). The rival comparison is a ranking, so it takes the raw figure like the gym leaderboard does. Do not pass includeBarWeight here.');
  p('Settlement — nothing on boards H or I has ever run. Prove the payout end to end on a seeded pair before trusting the reward numbers; increment_user_xp caps a single grant at 100k and enforces a rolling 24 h per-user ceiling (migs 042 / 188).');
  built.push(B.name);
}

return { built, count: built.length };
