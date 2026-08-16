// docs/penpot-crew-applications-board.js
//
// Builds the "Crew Applications" page in Penpot: eight boards A–H covering
// applying to a private crew, the reviewer's queue, both outcomes, the edge
// states and who is allowed to review.
//
// SELF-CONTAINED AND IDEMPOTENT — sweeps any board named "<letter> · …" off
// the page first, so a re-run after a half-finished draw is clean. Paste the
// whole file into the Penpot MCP `execute_code` tool.
//
// Requires the Penpot tab to be ON the "Crew Applications" page — openPage is
// async and cannot be asserted on the next line, so this bails with a message
// rather than switching.
//
// House style copied from the sibling pages Crew Wars / Crew Manage / Gym
// Rival: 390 × 852 device frames spaced 470, an 860-wide spec board, Archivo
// 700 for titles and figures, Figtree elsewhere, 11px type floor.
//
// GROUNDING. Every number on these boards was measured against production on
// 2026-08-16, most of it while verifying migrations 363–369:
//
//   * All 4 crews are PRIVATE. `crews.is_public` is false on every row, its
//     default is false, and NO code path sets it — `create_crew_atomic`
//     inserts only (name, created_by) and the one client UPDATE passes
//     avatar_url. So crew discovery returns 0 rows for all 56 users, and
//     applying is the only way into any crew that exists.
//   * `crew_join_requests` holds 0 rows. The pipeline works end to end — it
//     has simply never been used, because nothing surfaced it.
//   * `crew_invites` has never held a row: `invite_to_crew` has zero callers,
//     so a DM "invite" degrades into an application. Board B draws that.
//   * 0 members anywhere hold role='moderator'. 368's widening to rank>=2
//     currently applies to a population of zero.
//   * One crew had NO rank>=2 member at all, so its applications could never
//     be seen or decided. 369 added the fallback and backfilled it.

if (penpot.currentPage.name !== 'Crew Applications') {
  return { bail: 'Select the "Crew Applications" page in Penpot first. Current: ' + penpot.currentPage.name };
}
penpot.currentPage.root.children.slice().forEach(c => { if (/^[A-H] · /.test(c.name)) c.remove(); });

const P = {
  bg:'#0E1216', sheet:'#191F24', tile:'#1F262D', field:'#262E36', line:'#2A333C',
  fg:'#F5F2F0', mut:'#89949F', pri:'#F37616', grn:'#45C489', red:'#E5484D',
  blu:'#52A5E0', wht:'#FFFFFF', blk:'#000000',
  priDim:'#5C3A1C', priWash:'#1A1610', priTile:'#2A1B10',
  grnWash:'#111A16', grnDim:'#1E4A38', redWash:'#1C1214', redDim:'#5A2529'
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
function chrome(B,o){
  mk.txt(B,'title',20,28,250,o.title,{fs:20,fw:700,ff:'Archivo'});
  if(o.sub) mk.txt(B,'header sub',20,56,260,o.sub,{fs:12,c:P.mut});
  mk.ell(B,'close button',338,26,32,32,P.field);
  mk.txt(B,'close glyph',338,32,32,'✕',{fs:14,fw:600,c:P.mut,al:'center'});
  const hair=(y,x,w)=>mk.rect(B,'hairline',x==null?0:x,y,w==null?390:w,1,P.line,0);
  hair(92); return hair;
}
/** One applicant row in the reviewer's queue. */
function applicantRow(B,y,o){
  mk.ell(B,'avatar',20,y,40,40,o.av||P.priTile);
  mk.txt(B,'avatar initial',20,y+11,40,o.in,{fs:15,fw:700,ff:'Archivo',c:o.avc||P.pri,al:'center'});
  mk.txt(B,'name',72,y+2,180,o.name,{fs:15,fw:700,ff:'Archivo'});
  mk.txt(B,'meta',72,y+22,190,o.meta,{fs:11,c:P.mut});
  mk.stroke(mk.rect(B,'decline',248,y+4,54,32,null,10),P.line,1);
  mk.txt(B,'decline label',248,y+12,54,'Decline',{fs:11,fw:700,c:P.mut,al:'center'});
  mk.rect(B,'approve',310,y+4,60,32,P.pri,10);
  mk.txt(B,'approve label',310,y+12,60,'Approve',{fs:11,fw:700,c:P.wht,al:'center'});
  mk.rect(B,'row hairline',20,y+52,350,1,P.line,0);
}
const built = [];

/* ══ A · Apply to a private crew ═══════════════════════════════ */
{
  const B = mk.board('A · Apply to a private crew',0,0,390,852);
  const hair = chrome(B,{title:'Find a Crew',sub:'Discover'});
  mk.stroke(mk.rect(B,'search',20,112,350,44,P.field,12),P.line,1);
  mk.txt(B,'search placeholder',36,124,300,'Search crews',{fs:14,c:P.mut});

  mk.txt(B,'list label',20,178,350,'CREWS',{fs:11,fw:700,c:P.mut});
  function crewRow(y,o){
    mk.stroke(mk.rect(B,'crew / '+o.k,20,y,350,96,'#141A1F',16),o.br||P.line,1);
    mk.rect(B,'crew avatar',34,y+16,44,44,P.priTile,12);
    mk.txt(B,'crew initial',34,y+29,44,o.in,{fs:16,fw:700,ff:'Archivo',c:P.pri,al:'center'});
    mk.txt(B,'crew name',90,y+16,190,o.name,{fs:15,fw:700,ff:'Archivo'});
    mk.txt(B,'crew meta',90,y+37,200,o.meta,{fs:11,c:P.mut});
    mk.rect(B,'privacy chip',90,y+56,58,20,P.field,6);
    mk.txt(B,'privacy label',90,y+60,58,o.chip,{fs:11,fw:700,c:P.mut,al:'center'});
    if (o.cta) {
      mk.rect(B,'cta',256,y+52,100,32,o.ctaFill||P.pri,10);
      mk.txt(B,'cta label',256,y+60,100,o.cta,{fs:12,fw:700,c:o.ctaText||P.wht,al:'center'});
    }
  }
  crewRow(200,{k:'private',in:'IL',name:'Iron Legion',meta:'6 of 16 lifters  ·  Bronze III',chip:'Private',cta:'Apply'});
  crewRow(312,{k:'public',in:'AG',name:'Admin Grind',meta:'4 of 16 lifters  ·  Silver I',chip:'Open',cta:'Join',ctaFill:P.grn,ctaText:'#0B0E11'});
  crewRow(424,{k:'full',in:'BC',name:'Butt Crackers',meta:'16 of 16 lifters  ·  full',chip:'Private',cta:'Full',ctaFill:P.field,ctaText:P.mut});

  hair(548,20,350);
  mk.txt(B,'rule label',20,564,350,'HOW A PRIVATE CREW WORKS',{fs:11,fw:700,c:P.pri});
  mk.txt(B,'rule copy',20,584,350,'You can see every crew. Joining a private one is an application — a moderator or leader accepts it, and you are told either way.',{fs:13,c:P.mut,lh:1.45});

  mk.txt(B,'note / rules',20,668,350,'PRIVACY IS AT THE JOIN, NOT THE LISTING (kegan, 2026-08-16). A private crew still shows its name, tag, avatar and roster size — that is what makes it findable enough to apply to.',{fs:11,c:P.mut,lh:1.45});
  mk.txt(B,'note / blocker',20,742,350,'BLOCKER: this screen renders EMPTY today. All 4 crews are private, get_public_crews filters on is_public, and NOTHING in the product can set that column — create_crew_atomic inserts only (name, created_by). Discovery needs to list private crews, or crew creation needs a visibility control.',{fs:11,c:P.red,lh:1.45});
  built.push(B.name);
}

/* ══ B · The applicant has applied ════════════════════════════ */
{
  const B = mk.board('B · Applied — what the applicant sees',470,0,390,852);
  const hair = chrome(B,{title:'Find a Crew',sub:'Discover'});
  mk.txt(B,'caption 1',20,112,350,'1 · THE ROW AFTER APPLYING',{fs:11,fw:700,c:P.pri});
  mk.stroke(mk.rect(B,'crew row',20,136,350,96,'#141A1F',16),P.line,1);
  mk.rect(B,'crew avatar',34,152,44,44,P.priTile,12);
  mk.txt(B,'crew initial',34,165,44,'IL',{fs:16,fw:700,ff:'Archivo',c:P.pri,al:'center'});
  mk.txt(B,'crew name',90,152,190,'Iron Legion',{fs:15,fw:700,ff:'Archivo'});
  mk.txt(B,'crew meta',90,173,200,'6 of 16 lifters  ·  Bronze III',{fs:11,c:P.mut});
  mk.stroke(mk.rect(B,'pending chip',90,192,166,22,P.priWash,6),P.priDim,1);
  mk.txt(B,'pending label',90,197,166,'Awaiting review',{fs:11,fw:700,c:P.pri,al:'center'});

  hair(256,20,350);
  mk.txt(B,'caption 2',20,272,350,'2 · THE DM INVITE CARD, CORRECTED',{fs:11,fw:700,c:P.pri});
  mk.rect(B,'dm card',20,296,290,150,P.sheet,16);
  mk.rect(B,'dm band',20,296,290,34,P.pri,0);
  mk.txt(B,'dm band label',36,305,200,'CREW INVITE',{fs:11,fw:700,c:P.wht});
  mk.ell(B,'inviter avatar',36,344,28,28,P.field);
  mk.txt(B,'inviter initial',36,351,28,'K',{fs:11,fw:700,c:P.mut,al:'center'});
  mk.txt(B,'invited you',72,342,220,'invited you to join',{fs:11,c:P.mut});
  mk.txt(B,'dm crew',72,356,220,'Iron Legion',{fs:14,fw:700,ff:'Archivo'});
  mk.rect(B,'dm state',36,392,258,34,P.field,10);
  mk.txt(B,'dm state label',36,402,258,'Request sent — awaiting review',{fs:12,fw:700,c:P.mut,al:'center'});

  mk.txt(B,'note / dm',20,470,350,'THE CARD USED TO SAY "You joined Iron Legion!" HERE. join_crew_atomic returns status=\'requested\' for a private crew with no live invite and the handler discarded the return value, so it claimed a join that had not happened and then dropped you on an empty Crews tab.',{fs:11,c:P.red,lh:1.45});
  mk.txt(B,'note / invites',20,570,350,'AND IT IS ALWAYS THIS BRANCH: crew_invites has never held a row. invite_to_crew() exists and has ZERO callers — CrewCreationFlow sends a [CREW_INVITE_V1] DM and never files the invite, so an "invite" is an application wearing a different word.',{fs:11,c:P.red,lh:1.45});
  mk.txt(B,'note / fix',20,672,350,'FIX SHIPPED for the copy (the card now reads Request sent). Wiring inviteToCrew() so a real invite skips review is still open — that is the difference between status=joined and status=requested.',{fs:11,c:P.mut,lh:1.45});
  built.push(B.name);
}

/* ══ C · The application queue — the headline board ═══════════ */
{
  const B = mk.board('C · The application queue (reviewer)',940,0,390,852);
  const hair = chrome(B,{title:'Iron Legion',sub:'Roster  ·  6 lifters'});

  mk.txt(B,'section label',20,112,350,'REQUESTS TO JOIN',{fs:11,fw:700,c:P.pri});
  mk.txt(B,'count',20,132,350,'3 people want to join',{fs:15,fw:700,ff:'Archivo'});

  applicantRow(B,166,{in:'AB',name:'@tiptopaxle',meta:'Level 12  ·  asked 2h ago'});
  applicantRow(B,238,{in:'JG',name:'@jgustavsen',meta:'Level 4  ·  asked yesterday'});
  applicantRow(B,310,{in:'NS',name:'@nishet',meta:'Level 9  ·  asked 3 days ago'});

  mk.txt(B,'roster label',20,398,350,'ROSTER',{fs:11,fw:700,c:P.mut});
  function member(y,o){
    mk.ell(B,'m avatar',20,y,32,32,P.field);
    mk.txt(B,'m initial',20,y+8,32,o.in,{fs:12,fw:700,c:P.mut,al:'center'});
    mk.txt(B,'m name',62,y+1,180,o.name,{fs:13,fw:700});
    mk.txt(B,'m rank',250,y+3,120,o.rank,{fs:11,fw:700,c:o.c||P.mut,al:'right'});
    mk.rect(B,'m hairline',20,y+42,350,1,P.line,0);
  }
  member(422,{in:'K',name:'@kegan',rank:'Leader',c:P.pri});
  member(475,{in:'GS',name:'@gabe',rank:'Moderator',c:P.grn});
  member(528,{in:'ER',name:'@erik',rank:'Member'});

  mk.txt(B,'note / gate',20,600,350,'WHO SEES THIS BLOCK: leader (rank 3) and moderator (rank 2). A plain member gets an empty list rather than an error — the server returns [] so a non-reviewer has nothing to probe crew membership with.',{fs:11,c:P.mut,lh:1.45});
  mk.txt(B,'note / mods',20,690,350,'MODERATORS COULD NOT SEE THIS UNTIL MIG 368. Both RPCs gated on the legacy is_admin boolean, which only a leader carries, and the component mounted only for RANK.LEADER — so the tier existed in the rank vocabulary and nowhere in the queue.',{fs:11,c:P.red,lh:1.45});
  mk.txt(B,'note / empty',20,790,350,'EMPTY STATE: the whole block is absent, not a zero. See board F.',{fs:11,c:P.mut,lh:1.45});
  built.push(B.name);
}

/* ══ D · Deciding ═════════════════════════════════════════════ */
{
  const B = mk.board('D · Approve and decline',1410,0,390,852);
  const hair = chrome(B,{title:'Iron Legion',sub:'Reviewing a request'});

  mk.txt(B,'caption 1',20,112,350,'1 · APPROVED',{fs:11,fw:700,c:P.grn});
  mk.stroke(mk.rect(B,'toast ok',20,136,350,60,P.grnWash,12),P.grnDim,1);
  mk.txt(B,'toast ok title',36,148,300,'@tiptopaxle is in',{fs:14,fw:700,ff:'Archivo',c:P.grn});
  mk.txt(B,'toast ok body',36,168,318,'They are on the roster as a Member.',{fs:11,c:P.mut});
  mk.txt(B,'ok detail',20,208,350,'The row leaves the queue, the roster gains a member, and the applicant is notified. Re-approving is idempotent — the second call reports changed: false rather than a second row.',{fs:12,c:P.mut,lh:1.45});

  mk.txt(B,'caption 2',20,296,350,'2 · DECLINED',{fs:11,fw:700,c:P.mut});
  mk.stroke(mk.rect(B,'toast no',20,320,350,60,P.tile,12),P.line,1);
  mk.txt(B,'toast no title',36,332,300,'Request declined',{fs:14,fw:700,ff:'Archivo'});
  mk.txt(B,'toast no body',36,352,318,'They can apply again later.',{fs:11,c:P.mut});
  mk.txt(B,'no detail',20,392,350,'A decline is not a ban. Re-applying reopens the SAME row rather than stacking a new one, so the queue never grows with retries.',{fs:12,c:P.mut,lh:1.45});

  mk.txt(B,'caption 3',20,466,350,'3 · APPROVE THAT CANNOT SUCCEED',{fs:11,fw:700,c:P.red});
  mk.stroke(mk.rect(B,'toast err',20,490,350,68,P.redWash,12),P.redDim,1);
  mk.txt(B,'toast err title',36,502,300,'They joined another crew',{fs:14,fw:700,ff:'Archivo',c:P.red});
  mk.txt(B,'toast err body',36,522,318,'One crew per lifter — the request stays open so you can decline it.',{fs:11,c:P.mut,lh:1.35});

  mk.txt(B,'note / p7',20,584,350,'THIS SCREEN SAID "Approved — they\'re in" FOR THIS CASE. decide_crew_join_request has exactly one non-raising failure — {ok:false, reason:\'already_in_crew\'} — and the client wrapper hardcoded ok:true and never read data.ok, so the toast fired, the list refetched, and the same applicant reappeared with no member row written.',{fs:11,c:P.red,lh:1.45});
  mk.txt(B,'note / reach',20,704,350,'Reachable the ordinary way: nothing caps how many crews you may apply to while crewless, so two private applications and one acceptance is enough. Fixed in crewMembership.js with a regression test.',{fs:11,c:P.mut,lh:1.45});
  built.push(B.name);
}

/* ══ E · What the applicant is told ═══════════════════════════ */
{
  const B = mk.board('E · The applicant is told, either way',1880,0,390,852);
  chrome(B,{title:'Notifications'});
  function notif(y,o){
    mk.stroke(mk.rect(B,'notif / '+o.k,20,y,350,84,o.bg||'#141A1F',16),o.br||P.line,1);
    mk.rect(B,'icon tile',34,y+16,40,40,o.tile||P.priTile,12);
    mk.txt(B,'icon glyph',34,y+26,40,o.icon,{fs:18,al:'center'});
    mk.txt(B,'notif title',86,y+16,268,o.title,{fs:13,fw:700,lh:1.3});
    mk.txt(B,'notif body',86,y+40,270,o.body,{fs:11,c:P.mut,lh:1.35});
    mk.txt(B,'notif when',86,y+64,268,o.when,{fs:11,c:P.mut});
  }
  mk.txt(B,'caption 1',20,112,350,'TO THE APPLICANT',{fs:11,fw:700,c:P.pri});
  notif(136,{k:'approved',icon:'🎉',bg:P.grnWash,br:P.grnDim,tile:'#12241C',
    title:'You\'re in — welcome to Iron Legion',
    body:'Your request was accepted. Open the crew to meet the roster.',when:'just now'});
  notif(240,{k:'declined',icon:'📋',
    title:'Your request to join Iron Legion was declined',
    body:'You can apply again, or find another crew.',when:'2h ago'});
  mk.txt(B,'caption 2',20,356,350,'TO EVERY REVIEWER, WHEN IT ARRIVES',{fs:11,fw:700,c:P.pri});
  notif(380,{k:'incoming',icon:'📋',
    title:'Someone wants to join Iron Legion',
    body:'Review the request from the crew roster.',when:'just now'});
  mk.txt(B,'note / why',20,496,350,'WITHOUT THESE THE FEATURE IS INERT. join_crew_atomic filed the request silently, so an application landed in a queue nobody had a reason to open and the applicant never learned the outcome. That is the likeliest reason crew_join_requests holds 0 rows despite a door that has worked all along.',{fs:11,c:P.mut,lh:1.45});
  mk.txt(B,'note / fanout',20,608,350,'The arrival notification goes to every rank>=2 member — measured: 2 reviewers, 2 notifications, and the approve\'s own status UPDATE does not re-notify them.',{fs:11,c:P.mut,lh:1.45});
  mk.txt(B,'note / guest',20,684,350,'user_email is filled from user_profiles, never auth.users: the latter is NULL for every guest while notifications.user_email is NOT NULL, so the usual pattern would 23502 and abort the whole application. Migrations 366 and 369 close that.',{fs:11,c:P.mut,lh:1.45});
  built.push(B.name);
}

/* ══ F · Edge states ══════════════════════════════════════════ */
{
  const B = mk.board('F · Edge states',2350,0,390,852);
  chrome(B,{title:'Iron Legion',sub:'States that are not the happy path'});
  let y = 112;
  // Each block is laid out off the PREVIOUS one's measured bottom rather than
  // a fixed stride — a fixed stride overlaps the three-line notes and leaves
  // holes under the one-line ones.
  function state(o){
    mk.txt(B,'state / '+o.k+' label',20,y,350,o.label,{fs:11,fw:700,c:o.c||P.mut});
    mk.txt(B,'state / '+o.k+' copy',20,y+18,350,o.copy,{fs:13,lh:1.4});
    mk.txt(B,'state / '+o.k+' why',20,y+42,350,o.why,{fs:11,c:P.mut,lh:1.4});
    const bottom = y + 42 + Math.ceil(o.why.length / 62)*15 + 12;
    mk.rect(B,'state hairline',20,bottom,350,1,P.line,0);
    y = bottom + 16;
  }
  state({k:'empty',label:'NO REQUESTS',c:P.mut,
    copy:'The block is absent entirely.',
    why:'Not "0 requests" — an empty queue is not news, and a zero reads as a failure the reviewer did not commit.'});
  state({k:'crewed',label:'APPLICANT IS ALREADY IN A CREW',c:P.red,
    copy:'One crew per lifter — cannot be approved.',
    why:'crew_members_one_crew() raises 23505 on a second membership, so this is an invariant rather than a policy. Refused at apply time AND re-checked at approve time.'});
  state({k:'full',label:'CREW IS FULL',c:P.red,
    copy:'16 of 16 — the seat went while the request was open.',
    why:'Capacity is re-checked under a row lock at decide time, not trusted from the reviewer\'s screen. Raises 23514 crew_full.'});
  state({k:'banned',label:'APPLICANT IS BANNED FROM THIS CREW',c:P.red,
    copy:'The application is refused at the door.',
    why:'A ban has to beat an application, or the ban is decoration.'});
  state({k:'reapply',label:'RE-APPLYING AFTER A DECLINE',c:P.mut,
    copy:'The same row reopens as pending.',
    why:'ON CONFLICT (crew_id, user_id) DO UPDATE. Stacking rows would grow the reviewer\'s queue with every retry.'});
  mk.txt(B,'note / measured',20,y+8,350,'MEASURED, NOT ASSUMED: every one of these was executed against production inside a rolled-back transaction — apply, re-apply, list as a moderator, list as a member, self-approve refused 42501, approve, and the already-in-a-crew failure reproduced with three real users across two private crews.',{fs:11,c:P.mut,lh:1.45});
  built.push(B.name);
}

/* ══ G · Who may review ═══════════════════════════════════════ */
{
  const B = mk.board('G · Who may review',2820,0,390,852);
  const hair = chrome(B,{title:'Who may review'});

  mk.txt(B,'table label',20,112,350,'BY RANK',{fs:11,fw:700,c:P.mut});
  function rankRow(y,o){
    mk.txt(B,'rank / '+o.k+' n',20,y,28,String(o.n),{fs:15,fw:700,ff:'Archivo',c:o.c});
    mk.txt(B,'rank / '+o.k+' name',54,y,150,o.name,{fs:14,fw:700});
    mk.txt(B,'rank / '+o.k+' can',210,y,160,o.can,{fs:12,fw:700,c:o.c,al:'right'});
    mk.rect(B,'rank hairline',20,y+28,350,1,P.line,0);
  }
  rankRow(136,{k:'leader',n:3,name:'Leader',can:'Sees + decides',c:P.grn});
  rankRow(177,{k:'mod',n:2,name:'Moderator',can:'Sees + decides',c:P.grn});
  rankRow(218,{k:'member',n:1,name:'Member',can:'Sees nothing',c:P.mut});

  mk.txt(B,'fallback label',20,280,350,'THE EXCEPTION, AND WHY IT EXISTS',{fs:11,fw:700,c:P.pri});
  mk.txt(B,'fallback copy',20,300,350,'If a crew has NO member at rank 2 or 3, any member may review. It collapses back to the strict gate the moment somebody is promoted.',{fs:13,c:P.mut,lh:1.45});
  mk.stroke(mk.rect(B,'evidence',20,376,350,124,P.redWash,12),P.redDim,1);
  mk.txt(B,'evidence title',36,390,318,'Without it, a crew is a dead letter',{fs:13,fw:700,c:P.red});
  mk.txt(B,'evidence body',36,412,318,'A production crew was private with one rank-1 member who was also its created_by. An application filed, notified nobody, listed as empty and refused 42501 on decide — and he could not promote himself: a direct role UPDATE matches 0 rows under RLS and transfer_crew_leadership raises.',{fs:11,c:P.mut,lh:1.4});

  mk.txt(B,'backfill label',20,528,350,'BACKFILL',{fs:11,fw:700,c:P.mut});
  mk.txt(B,'backfill copy',20,548,350,'Migration 369 also promoted the oldest member of every reviewer-less crew to leader — which is what the roster should have said all along. Verified 0 remain.',{fs:12,c:P.mut,lh:1.45});

  mk.txt(B,'note / mods',20,632,350,'0 members anywhere currently hold role=\'moderator\'. The tier is correct code with no adoption — promoting one in a rolled-back transaction flipped the queue from 0 rows to 1 and decide from 42501 to ok, so it works and is simply unused.',{fs:11,c:P.mut,lh:1.45});
  mk.txt(B,'note / mirror',20,736,350,'src/lib/crewPermissions.js mirrors this table for the UI and is NOT the enforcement — crew_can_review() is. Add a capability to both or it is not a permission.',{fs:11,c:P.mut,lh:1.45});
  built.push(B.name);
}

/* ══ H · Spec ═════════════════════════════════════════════════ */
{
  const W = 860, X = 40, CW = 780;
  const B = mk.board('H · Spec — flow, evidence, what is new',3290,0,W,1500);
  mk.txt(B,'title',X,40,CW,'Crew applications — spec',{fs:26,fw:700,ff:'Archivo',h:34});
  mk.txt(B,'subtitle',X,80,CW,'Boards A–G. Evidence measured against production 2026-08-16.',{fs:13,c:P.mut});
  mk.rect(B,'rule',X,112,CW,1,P.line,0);

  let y = 140;
  const h2=(s)=>{ mk.txt(B,'section',X,y,CW,s,{fs:11,fw:700,c:P.pri}); y+=24; };
  const p =(s,c)=>{ mk.txt(B,'copy',X,y,CW,s,{fs:13,c:c||P.fg,lh:1.5}); y+=Math.ceil(s.length/104)*20+16; };

  h2('01 · THE FLOW');
  p('Apply → a pending row → every rank>=2 member is notified → a reviewer approves or declines → the applicant is notified. Applying is join_crew_atomic itself: for a crew that is not public and has no live invite it files the request and returns status = requested. There is no separate apply RPC and there must not be a second one.');
  y += 8;

  h2('02 · WHAT WAS ACTUALLY MISSING');
  p('The table, both RPCs and a review component all already existed and the table held 0 rows. Three things were missing and only the third is obvious in hindsight: moderators could not see or decide (both RPCs gated on the legacy is_admin boolean, which only a leader carries); nobody was notified, so an application landed where no one looks; and a crew with no rank>=2 member could never decide at all.');
  p('A fourth was a wrong diagnosis worth recording: the first attempt added a request_to_join_crew RPC on the grounds that no such function existed and crew_join_requests carries no INSERT policy. Both true, conclusion false — join_crew_atomic is SECURITY DEFINER, so it never needed the policy. Shipping it would have left two implementations of one rule. A name search plus a policy check is not a search for behaviour.', P.red);
  y += 8;

  h2('03 · MEASURED STATE');
  const rows = [
    ['crews', '4 — ALL private. is_public is false on every row and nothing can set it.'],
    ['crew_join_requests', '0 rows. The pipeline works; nothing surfaced it.'],
    ['crew_invites', '0 rows, ever. invite_to_crew() has zero callers.'],
    ['moderators', "0 members hold role='moderator' anywhere."],
    ['reviewer-less crews', '1 — fixed and backfilled by migration 369.'],
    ['crew discovery', 'Renders empty for all 56 users. See board A.'],
  ];
  rows.forEach(r => {
    mk.txt(B,'row / '+r[0],X,y,240,r[0],{fs:12,fw:700});
    mk.txt(B,'val / '+r[0],X+250,y,530,r[1],{fs:12,c:P.mut});
    y += 20; mk.rect(B,'row hairline',X,y,CW,1,P.line,0); y += 10;
  });
  y += 14;

  h2('04 · OPEN — NEEDS A PRODUCT DECISION, NOT A FIX');
  p('Crew discovery cannot list anything. Either it must show private crews (which is what boards A and B assume, and what "privacy is at the join" implies), or crew creation needs a visibility control. Today create_crew_atomic writes only (name, created_by) and every crew is therefore private and undiscoverable.');
  p('A DM invite is not an invite. invite_to_crew() writes crew_invites and would let join_crew_atomic return joined instead of requested — but nothing calls it, so an invited friend applies like a stranger and waits for review. Wiring it is one call beside the DM send in CrewCreationFlow.');
  y += 8;

  h2('05 · ELEMENT LEDGER');
  const el = [
    ['Board','390 × 852, background #0E1216'],
    ['Row / card','#141A1F on a #2A333C hairline, radius 16'],
    ['Approve','#F37616 filled, 60 × 32, radius 10'],
    ['Decline','hairline only — a destructive-looking button on a routine action reads as punishment'],
    ['Applicant row','40pt avatar, 15pt name, 11pt meta, 52pt stride'],
    ['Tap targets','32pt inline controls, 44pt rows, 56pt primary CTA'],
    ['Type','Archivo 700 for names and titles; Figtree 13 body / 12 sub / 11 label. 11px floor.'],
  ];
  el.forEach(e => {
    mk.txt(B,'el / '+e[0],X,y,230,e[0],{fs:12,fw:700});
    mk.txt(B,'elv / '+e[0],X+240,y,540,e[1],{fs:12,c:P.mut});
    y += 20; mk.rect(B,'el hairline',X,y,CW,1,P.line,0); y += 8;
  });
  B.resize(W, y + 40);
  built.push(B.name);
}

return { built, count: built.length };
