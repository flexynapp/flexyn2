// src/components/dashboard/DailyQuestsCard.jsx
//
// Renders today's quests on the Dashboard. Auto-creates them on mount
// (idempotent), polls for progress changes, and lets the user claim coin +
// XP rewards when quests complete. Tapping the header opens QuestsSheet —
// the full surface, in the shape ReadinessSheet uses.

import React, { useEffect, useRef, useState, Suspense } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { CheckCircle2, ChevronRight, Users } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as quests from '@/lib/data/quests';
import { questDestinationRoute } from '@/lib/questCatalog';
import { announceQuestCompleted, markQuestsSeen } from '@/lib/questCompletion';
import { claimQuestWithFeedback } from '@/lib/questClaim';
import { QuestProgress } from '@/components/dashboard/questVisuals';
import useCountUp from '@/hooks/useCountUp';
import { prefersReducedMotion } from '@/lib/reducedMotion';

// Lazy — the sheet is a modal that only mounts on tap, per the lazy-loading
// rule in CLAUDE.md. It pulls in the stats RPC and the streak strip, none of
// which the resting card needs.
const QuestsSheet = React.lazy(() => import('@/components/dashboard/QuestsSheet'));

// `title` and `goalSlot` are how Today makes this its "To do" block: the
// goal row sits above the quests so the two read as one list to finish.
// StatsHubModal renders the card bare and keeps the Daily Quests title.
export default function DailyQuestsCard({ onNavigated, title, goalSlot = null }) {
  // There was a collapse chevron here, and board 07 doesn't draw one. It
  // existed to buy back vertical space from a card that ran ~220px in a
  // 171px column; the card is ~150px on its own row now, so the control was
  // paying for a problem that no longer exists. The section is still
  // collapsible — and hideable — from edit mode, which is where every other
  // widget's version of this lives.
  const { user } = useAuth();
  const { t, tFallback } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Claim feedback: the row's XP rises into the header total. Rows and the
  // total are measured at claim time, so these refs are read, never rendered.
  const cardRef = useRef(null);
  const xpTotalRef = useRef(null);
  const rowRefs = useRef(new Map());
  const [floats, setFloats] = useState([]);

  // Navigate to the page where this quest can be completed. Notifies the
  // parent (e.g. StatsHubModal) so it can close itself first — otherwise
  // the modal stays mounted and intercepts the new page's UI.
  const goToQuest = (questRow) => {
    const route = questDestinationRoute(questRow.quest_id);
    if (!route) {
      // Surface a toast when we have no destination — previously the
      // tap was a silent no-op and the user couldn't tell whether the
      // row was tappable. Catalog drift (new quest_id in DB but no
      // route in questCatalog.js) is the common cause.
      toast.info(tFallback('dashboard.questNoRoute', "Open the app's main pages to make progress on this quest."));
      return;
    }
    onNavigated?.();
    navigate(route);
  };

  // Ensure today's quests exist on mount, then read them.
  const { data: rows = [] } = useQuery({
    queryKey: ['dailyQuests', user?.id, quests.todayDateString()],
    // ensureTodaysQuests already reads the day's full rows (or returns the
    // ones it just inserted), so its result IS the list. Reading the same
    // rows a second time doubled every 90s poll.
    queryFn: async () => quests.sortQuestRows(await quests.ensureTodaysQuests(user)),
    enabled: !!user?.id,
    // Quest progress also invalidates on action (workout save, meal log, etc.)
    // so we don't need to poll aggressively. 90s is fine for the rare async
    // bump case while saving battery on mobile.
    refetchInterval: 90_000,
    refetchOnWindowFocus: true,
  });

  // We previously ran a setInterval(refetch, 60s) to handle the midnight
  // rollover case. That was a duplicate signal — useQuery already polls
  // at refetchInterval: 90_000 AND refetches on window focus, both of
  // which cover the same case AND honor visibility (so a backgrounded
  // PWA isn't burning battery + Supabase reads). Removed entirely. If a
  // future midnight-precision case appears, gate it on
  // `document.visibilityState === 'visible'`.

  const launchXpFloat = (questId, xp) => {
    if (!xp || prefersReducedMotion()) return;
    const card = cardRef.current?.getBoundingClientRect();
    const row = rowRefs.current.get(questId)?.getBoundingClientRect();
    const total = xpTotalRef.current?.getBoundingClientRect();
    if (!card || !row || !total) return;
    // Start over the row's own XP figure (its right edge) and end on the
    // header total, both in the card's coordinates.
    const x = row.right - card.left - 64;
    const y = row.top - card.top + row.height / 2 - 10;
    setFloats((all) => [...all, {
      id: `${questId}-${Date.now()}`,
      xp,
      x,
      y,
      dx: total.left - card.left - x,
      dy: total.top - card.top - y,
    }]);
  };

  // Claiming, its feedback and the perfect-day bonus live in lib/questClaim,
  // shared with the app-wide completion cue so a Claim pressed in the pill on
  // any page behaves exactly like one pressed here. The card adds only its
  // own flourish: the XP rising into the header total.
  const handleClaim = async (questRow) => {
    const result = await claimQuestWithFeedback({ user, row: questRow, t, tFallback, queryClient });
    if (result) {
      launchXpFloat(questRow.id, result.xpAwarded > 0 ? result.xpAwarded : (questRow.xp_reward ?? 0));
    }
  };

  // Completions this card sees on a refetch. A quest completed on THIS device
  // was already announced by recordActions, wherever the user was, and the
  // shared de-dup means announcing it again here is a no-op. What this still
  // catches is progress made on another device. The first set of rows only
  // seeds the de-dup: a quest completed before the card mounted must not
  // announce retroactively.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      markQuestsSeen(rows);
      return;
    }
    rows.forEach((r) => { if (r.completed_at) announceQuestCompleted(r); });
  }, [rows]);

  // The XP today's claims banked, from the rows the server stamped. Counted
  // up so a claim visibly adds to it. Above the early return: it is a hook.
  const xpToday = rows.reduce((sum, r) => sum + (r.claimed_at ? (Number(r.xp_reward) || 0) : 0), 0);
  const countedXp = useCountUp(xpToday, { duration: 500 });

  if (!user?.id || rows.length === 0) return null;

  // Drop rows missing a stable id too — the map(key={q.id}) below
  // would collide on `undefined` keys if multiple corrupt rows slip
  // through and we'd lose state on the duplicates.
  // Order comes from listTodaysQuests (difficultyRank: easy → hard → crew);
  // annotate preserves it.
  const annotated = rows
    .map(quests.annotateQuest)
    .filter(q => q && q.definition && q.id);

  const claimedCount = annotated.filter(q => q.claimed_at).length;
  const crewTotal = annotated.reduce((sum, q) => sum + (q.definition?.crewXpReward ?? 0), 0);
  const allClaimed = annotated.length > 0 && claimedCount === annotated.length;

  return (
    <Card ref={cardRef} className="relative p-0 overflow-hidden">
      {/* The header is the way into the sheet. Its right side is the day's
          score twice over: a pip per quest that turns green when claimed,
          and the XP those claims banked, which counts up as each one lands. */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="w-full flex items-center gap-2 px-4 pt-3.5 pb-3 text-start hover:bg-secondary/25 active:bg-secondary/40 transition-colors"
      >
        <h3 className="font-heading font-bold text-sm tracking-tight truncate">
          {title ?? t('dashboard.dailyQuests')}
        </h3>
        <span className="ms-auto flex items-center gap-2 shrink-0">
          <QuestPips quests={annotated} />
          <span ref={xpTotalRef} className="font-heading font-bold text-xs tabular-nums text-foreground">
            {Math.round(countedXp ?? xpToday)} XP
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />
        </span>
      </button>

      {goalSlot}

      {annotated.map((q) => (
        <QuestRow
          key={q.id}
          rowRef={(el) => { if (el) rowRefs.current.set(q.id, el); else rowRefs.current.delete(q.id); }}
          quest={q}
          onClaim={() => handleClaim(q)}
          onGo={() => goToQuest(q)}
          onOpenSheet={() => setSheetOpen(true)}
          t={t}
          tFallback={tFallback}
        />
      ))}

      {/* The crew's share, said once for the day instead of once per row.
          It turns green when the last claim lands, which is the moment the
          perfect-day bonus is asked for. */}
      {(crewTotal > 0 || allClaimed) && (
        <div
          className={`flex items-center gap-2 border-t border-border px-4 py-2.5 text-xs transition-colors ${
            allClaimed ? 'text-success font-semibold' : 'text-muted-foreground'
          }`}
        >
          {allClaimed ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> : <Users className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
          <span>
            {allClaimed
              ? (crewTotal > 0
                ? tFallback('today.todo.crewBanked', 'All done. Your crew banked {n} XP.', { n: crewTotal })
                : t('dashboard.allQuestsClaimed'))
              : tFallback('today.todo.crewAhead', 'Finish all {count} and your crew banks {n} XP.', { count: annotated.length, n: crewTotal })}
          </span>
        </div>
      )}

      {/* XP rising from a claimed row into the header total. Positioned in
          the card's own coordinates, measured at claim time. */}
      <AnimatePresence>
        {floats.map((f) => (
          <motion.span
            key={f.id}
            aria-hidden="true"
            className="pointer-events-none absolute z-10 font-heading font-extrabold text-sm text-success tabular-nums"
            style={{ left: f.x, top: f.y }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: f.dx, y: f.dy, opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], opacity: { duration: 0.7, ease: 'easeIn' } }}
            onAnimationComplete={() => setFloats((all) => all.filter((x) => x.id !== f.id))}
          >
            +{f.xp}
          </motion.span>
        ))}
      </AnimatePresence>

      {sheetOpen && (
        <Suspense fallback={null}>
          <QuestsSheet
            open
            onClose={() => setSheetOpen(false)}
            quests={annotated}
            onClaim={handleClaim}
            onGo={(q) => { setSheetOpen(false); goToQuest(q); }}
          />
        </Suspense>
      )}
    </Card>
  );
}

/** One pip per quest, green once claimed. A pip that turns pops once. */
function QuestPips({ quests: list }) {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {list.map((q) => (
        <motion.span
          key={q.id}
          className={`block w-3.5 h-1 rounded-full transition-colors duration-300 ${q.claimed_at ? 'bg-success' : 'bg-border'}`}
          animate={q.claimed_at ? { scaleY: [1, 2, 1] } : { scaleY: 1 }}
          initial={false}
          transition={{ duration: 0.35 }}
        />
      ))}
    </span>
  );
}

/**
 * The leading check. Empty ring while the quest is live, a green ring once it
 * is done and waiting to be claimed, and a filled disc whose tick draws itself
 * the moment it is claimed. Plain CSS transitions, so an already-claimed quest
 * renders filled on first paint without replaying the draw.
 */
export function QuestCheck({ ready, done }) {
  return (
    <motion.svg
      viewBox="0 0 22 22"
      className="w-[22px] h-[22px] shrink-0 overflow-visible"
      aria-hidden="true"
      // initial={false}: a quest already claimed when the card mounts shows
      // filled with no bump. The bump is for the moment of claiming.
      initial={false}
      animate={done ? { scale: [1, 1.25, 1] } : { scale: 1 }}
      transition={{ duration: 0.4 }}
    >
      <circle
        cx="11" cy="11" r="10"
        strokeWidth="1.5"
        className="transition-[fill,stroke] duration-300"
        style={{
          fill: done ? 'hsl(var(--success))' : 'transparent',
          stroke: done || ready ? 'hsl(var(--success))' : 'hsl(var(--border))',
        }}
      />
      <path
        d="M6.5 11.5l3 3 6-6.5"
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="14"
        className="transition-[stroke-dashoffset] duration-300 delay-100 motion-reduce:transition-none"
        style={{ stroke: 'hsl(var(--background))', strokeDashoffset: done ? 0 : 14 }}
      />
    </motion.svg>
  );
}

/**
 * A quest row is TWO tap targets, and which half you hit decides what happens.
 *
 *   [ check · title · progress ][ ......... ][ +XP · Claim ]
 *   └────── go to the quest ────┘└──── open the quests sheet ────┘
 *
 * It used to be one: the whole row navigated. That made the sheet nearly
 * unreachable, because the only other way in is the card header, and every
 * other pixel of a four-row card sent you to another page instead.
 *
 * The empty middle is the reason this is a layout contract and not just an
 * onClick move. The text block sizes to its content and a separate spacer owns
 * the gap, which is what makes "tap the grey space" mean the sheet.
 *
 * `min-w-0` on both the nav zone and the text block is load-bearing: it is
 * what lets a long title shrink below its intrinsic width so `truncate` can
 * ellipsis it.
 *
 * One reward shows, in XP. Coins and the crew share still arrive in the claim
 * toast; three currencies on every row was most of why the list read as a
 * spreadsheet.
 */
// Exported for questRowZones.test.jsx. The two-zone split is a layout
// contract, not just a handler arrangement, and testing it against the real
// row rather than a reproduction is the only way the test can catch someone
// putting `flex-1` back on the text block.
export function QuestRow({ quest, onClaim, onGo, onOpenSheet, t, tFallback, rowRef }) {
  if (!quest || !quest.definition) return null;
  const def = quest.definition;
  const completed = !!quest.completed_at;
  const claimed = !!quest.claimed_at;
  const xp = quest.xp_reward ?? def.xpReward ?? 0;
  // Look up translated quest copy via the catalog convention `quest.<id>.label`.
  const label = (() => { const k = `quest.${def.id}.label`; const v = t(k); return v === k ? def.label : v; })();
  // A yes-or-no quest has nothing to count, so "0 / 1" under it was noise.
  // Only a quest with a real count (glasses, minutes, sets) shows one.
  const showProgress = typeof quest.target === 'number' && quest.target > 1 && !claimed;

  // Claimed quests are read-only — there is nowhere useful to send someone for
  // a quest they have already finished and banked.
  const canGo = !claimed && !!onGo;

  return (
    <div
      ref={rowRef}
      onClick={onOpenSheet}
      // Deliberately no role / tabIndex here. Nesting a button inside a button
      // is invalid, and every action on this row is already keyboard-reachable
      // without it: the nav zone below is a real control, Claim is a real
      // button, and the card header opens this same sheet.
      className="relative flex items-center gap-3 min-h-12 px-4 border-t border-border cursor-pointer active:bg-secondary/20 transition-colors"
    >
      {/* ── Zone 1: go to the quest ────────────────────────────────────── */}
      <div
        role={canGo ? 'button' : undefined}
        tabIndex={canGo ? 0 : undefined}
        aria-label={canGo ? tFallback('quests.goTo', 'Go to: {label}', { label }) : undefined}
        onClick={canGo ? (e) => { e.stopPropagation(); onGo(); } : undefined}
        onKeyDown={canGo ? (e) => {
          // Gate on currentTarget so Enter on a focusable descendant doesn't
          // also navigate away.
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGo(); }
        } : undefined}
        className={`flex items-center gap-3 min-w-0 py-2.5 rounded-sm ${
          canGo ? 'cursor-pointer hover:bg-secondary/30 active:bg-secondary/45 transition-colors' : ''
        }`}
      >
        <QuestCheck ready={completed} done={claimed} />
        <div className="min-w-0">
          <p className={`relative text-sm font-medium leading-tight truncate cq-clamp2 transition-colors duration-300 ${claimed ? 'text-muted-foreground' : ''}`}>
            {label}
            {/* The strike draws left to right when the claim lands, rather
                than the title snapping to line-through. */}
            <span
              aria-hidden="true"
              className="absolute start-0 top-[55%] h-px bg-muted-foreground transition-[width] duration-500 delay-100 motion-reduce:transition-none"
              style={{ width: claimed ? '100%' : 0 }}
            />
          </p>
          {showProgress && (
            <QuestProgress quest={quest} tFallback={tFallback} className="block mt-0.5 text-micro text-muted-foreground" />
          )}
        </div>
      </div>

      {/* ── Zone 2: the grey space ─────────────────────────────────────── */}
      <div className="flex-1 self-stretch" aria-hidden="true" />

      <span
        className={`text-xs font-semibold tabular-nums shrink-0 transition-colors duration-300 ${
          claimed || completed ? 'text-success' : 'text-muted-foreground'
        }`}
      >
        +{xp} XP
      </span>
      <AnimatePresence initial={false}>
        {completed && !claimed && (
          <motion.button
            key="claim"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            whileTap={{ scale: 0.94 }}
            onClick={(e) => { e.stopPropagation(); onClaim(); }}
            className="px-3 py-1 rounded-sm bg-success text-success-foreground text-xs font-bold hover:brightness-110 shrink-0"
          >
            {t('dashboard.claim')}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
