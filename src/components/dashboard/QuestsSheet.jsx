// src/components/dashboard/QuestsSheet.jsx
//
// The Daily Quests explainer, in the shape ReadinessSheet uses. The card on
// the page answers "what are today's quests"; this answers everything the
// card has no room for — why finishing all of them is worth more than the
// sum of the parts, what your crew gets out of it, and how long your run is.
//
// It is deliberately NOT a second place to do the work. Every quest row here
// routes to the same destination the card's row does, and closes on the way,
// so the sheet is a reading surface and the app is where you complete things.
// (Readiness is the opposite case — its three signals have nowhere else to be
// logged, so the sheet owns their forms.)
//
// Lazy-loaded from DailyQuestsCard per the lazy-loading rule in CLAUDE.md.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Flame, Coins, Zap, Users, ChevronRight } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import ReadinessRing from '@/components/dashboard/ReadinessRing';
import { QuestTile, QuestRewardLine } from '@/components/dashboard/questVisuals';
import { PERFECT_DAY_BONUS } from '@/lib/questCatalog';
import * as quests from '@/lib/data/quests';
import SheetShell from '@/components/sheets/SheetShell';

// The tier chip beside a quest title. Crew is the odd one out and says so —
// it is the only tier whose reward leaves the individual, which is the whole
// reason someone should care that a row is marked crew rather than hard.
const TIER_STYLE = {
  easy:   'bg-success/10 text-success',
  medium: 'bg-primary/10 text-primary',
  hard:   'bg-destructive/10 text-destructive',
  crew:   'bg-primary/10 text-primary',
};

export default function QuestsSheet({ open, onClose, quests: rows = [], onClaim, onGo }) {
  // Pin the page behind this overlay — see @/lib/scrollLock.
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();


  // Streak + lifetime counters. `enabled: open` so the RPC never fires for a
  // sheet nobody opened — this component is lazy, but React.lazy only defers
  // the CHUNK, and a query in a mounted-but-closed sheet would still run.
  const { data: stats } = useQuery({
    queryKey: ['questStats', user?.id],
    queryFn: () => quests.getQuestStats(user),
    enabled: !!user?.id && !!open,
    staleTime: 60_000,
  });

  if (!open) return null;

  const total = rows.length;
  const claimed = rows.filter(q => q.claimed_at).length;
  const completed = rows.filter(q => q.completed_at).length;
  const pct = total > 0 ? Math.round((claimed / total) * 100) : 0;
  const perfect = total > 0 && claimed === total;

  // Today's haul, read off the rows rather than fetched. `xp_reward` is the
  // server's stamped value on the row, so this is what the day was worth —
  // not what the catalog currently says a tier pays.
  const haul = rows.reduce((acc, q) => {
    if (!q.claimed_at) return acc;
    acc.coins += q.coin_reward || 0;
    acc.xp    += q.xp_reward || 0;
    acc.crew  += q.definition?.crewXpReward || 0;
    return acc;
  }, { coins: 0, xp: 0, crew: 0 });

  // Only claim the bonus into the haul once it has actually been paid — the
  // server, not this component, decides that.
  if (stats?.bonusClaimedToday) {
    haul.coins += PERFECT_DAY_BONUS.coinReward;
    haul.xp    += PERFECT_DAY_BONUS.xpReward;
  }

  const streakLive = stats?.isCurrent ? (stats?.currentStreak ?? 0) : 0;

  // No AnimatePresence: DailyQuestsCard unmounts this component on close, so
  // an exit animation would never get to run. Entry animates, exit is
  // instant — same as every other dismissible surface on the page today.
  return (
    <SheetShell open={open} onClose={onClose} kicker={tFallback('quests.kicker', 'DAILY QUESTS · TODAY')} labelledBy="quests-sheet-title">

          {/* ── the dial ────────────────────────────────────────────────
              Same component the Readiness sheet leads with, wound by
              quests claimed rather than a recovery score. It goes green
              only when the day is actually finished — a ring that is
              primary at 3/4 and green at 4/4 is the whole story in one
              glyph. */}
          <div className="flex items-center gap-3 mt-2">
            <ReadinessRing
              score={pct}
              color={perfect ? 'hsl(var(--success))' : 'hsl(var(--primary))'}
            >
              <span className="font-heading font-black text-title tabular-nums">
                {claimed}<span className="text-muted-foreground font-bold">/{total}</span>
              </span>
            </ReadinessRing>
            <div className="min-w-0">
              <p className="font-heading font-bold text-title leading-tight">
                {perfect
                  ? tFallback('quests.headingPerfect', 'Perfect day')
                  : tFallback('quests.heading', '{n} to go', { n: total - claimed })}
              </p>
              <p className="text-caption text-muted-foreground leading-snug mt-1">
                {perfect
                  ? tFallback('quests.subPerfect', 'Everything today is claimed. New set at midnight, your local time.')
                  : tFallback('quests.sub', 'Claim every quest today for the perfect-day bonus and to keep your streak alive.')}
              </p>
            </div>
          </div>

          {/* ── streak ─────────────────────────────────────────────────
              Three fixed cells, so grid-cols-3 rather than tileRow() —
              the count isn't decided by data (CLAUDE.md). Hairline
              dividers, no card: this is read-only data that isn't a
              widget, so it gets no surface of its own. */}
          <div className="mt-6 grid grid-cols-3 divide-x divide-border rtl:divide-x-reverse border-y border-border">
            <StatCell
              value={streakLive}
              label={tFallback('quests.streak', 'Day streak')}
              accent={streakLive > 0}
              Icon={Flame}
            />
            <StatCell
              value={stats?.longestStreak ?? 0}
              label={tFallback('quests.longest', 'Best run')}
            />
            <StatCell
              value={stats?.perfectDays ?? 0}
              label={tFallback('quests.perfectDays', 'Perfect days')}
            />
          </div>
          {streakLive === 0 && (stats?.longestStreak ?? 0) > 0 && (
            <p className="text-micro text-muted-foreground/80 leading-snug mt-2">
              {tFallback('quests.streakBroken', 'Your run ended. Claim everything today to start a new one.')}
            </p>
          )}

          {/* ── the quests ─────────────────────────────────────────── */}
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />
              <h3 className="font-heading font-bold text-body tracking-tight">
                {tFallback('quests.listHeading', "Today's set")}
              </h3>
            </div>
            <p className="text-micro text-muted-foreground mb-2 px-1">
              {tFallback('quests.listSub', 'Tap a quest to go where you can finish it.')}
            </p>
            <ul className="space-y-2">
              {rows.map(q => (
                <QuestDetailRow
                  key={q.id}
                  quest={q}
                  onClaim={() => onClaim(q)}
                  onGo={() => onGo(q)}
                  t={t}
                  tFallback={tFallback}
                />
              ))}
            </ul>
          </div>

          {/* ── the perfect-day bonus ──────────────────────────────────
              Stated as a promise before it is earned and as a receipt
              after. A bonus nobody knows about is not an incentive, and
              the card has no room to explain one. */}
          <div className="mt-6 pt-4 border-t border-border">
            <p className="text-micro font-semibold tracking-[0.04em] text-muted-foreground mb-3">
              {tFallback('quests.bonusHeading', 'FINISH ALL {n}').replace('{n}', total)}
            </p>
            <div className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${
              stats?.bonusClaimedToday ? 'bg-success/10' : 'bg-secondary/40'
            }`}>
              <span className={`shrink-0 w-8 h-8 rounded-sm flex items-center justify-center ${
                stats?.bonusClaimedToday ? 'bg-success text-white' : 'bg-primary text-primary-foreground'
              }`}>
                <Flame className="w-4 h-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-caption font-semibold leading-tight">
                  {stats?.bonusClaimedToday
                    ? tFallback('quests.bonusEarned', 'Perfect-day bonus banked')
                    : tFallback('quests.bonusPending', 'Perfect-day bonus')}
                </p>
                <p className="text-micro text-muted-foreground tabular-nums mt-0.5">
                  +{PERFECT_DAY_BONUS.coinReward} {tFallback('hub.coins', 'coins')}
                  {' · '}+{PERFECT_DAY_BONUS.xpReward} XP
                  {' · '}
                  <span className="text-primary font-semibold">
                    +{PERFECT_DAY_BONUS.crewXp} {tFallback('quests.crewShort', 'crew')}
                  </span>
                </p>
              </div>
              {!stats?.bonusClaimedToday && (
                <span className="shrink-0 text-micro font-bold tabular-nums text-muted-foreground">
                  {claimed}/{total}
                </span>
              )}
            </div>
            {/* The bonus pays itself the moment the last quest is claimed —
                there is no button, and saying so stops someone hunting for
                one. */}
            <p className="text-micro text-muted-foreground/80 leading-snug mt-2">
              {tFallback('quests.bonusAuto', 'Paid automatically when you claim the last one.')}
            </p>
          </div>

          {/* ── today's haul ───────────────────────────────────────── */}
          <div className="mt-6 pt-4 border-t border-border">
            <p className="text-micro font-semibold tracking-[0.04em] text-muted-foreground mb-3">
              {tFallback('quests.haulHeading', 'BANKED TODAY')}
            </p>
            <div className="grid grid-cols-3 gap-2">
              <HaulCell Icon={Coins} value={haul.coins} label={tFallback('hub.coins', 'coins')} />
              <HaulCell Icon={Zap} value={haul.xp} label="XP" />
              <HaulCell Icon={Users} value={haul.crew} label={tFallback('quests.crewXp', 'crew XP')} accent />
            </div>
            <p className="text-micro text-muted-foreground/80 leading-relaxed mt-3">
              {haul.crew > 0
                ? tFallback('quests.haulCrew', "A quarter of every quest's XP goes to your crew on top of your own. A crew quest sends all of it. Nothing is taken from you to pay it.")
                : tFallback('quests.haulNoCrew', 'Join a crew and a share of every quest you claim goes to their level too. On top of your own XP, not out of it.')}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            // Drawn at 52px, which is no step on the height scale.
            // --fluid-cta-h is the app's own answer for exactly this control
            // (clamp 48→56) and lands on ~52 at the 390pt these boards are
            // drawn at.
            className="w-full mt-5 rounded-2xl bg-primary text-primary-foreground font-heading font-bold text-body h-[var(--fluid-cta-h)] shadow-md hover:brightness-105 active:scale-[0.98] transition-all"
          >
            {tFallback('common.done', 'Done')}
          </button>
    </SheetShell>
  );
}

function StatCell({ value, label, accent = false, Icon }) {
  return (
    <div className="px-2 py-3 text-center">
      <p className={`font-heading font-black text-title tabular-nums leading-none flex items-center justify-center gap-1 ${
        accent ? 'text-primary' : 'text-foreground'
      }`}>
        {Icon && accent && <Icon className="w-4 h-4" aria-hidden="true" />}
        {value}
      </p>
      <p className="text-micro text-muted-foreground mt-1 leading-tight">{label}</p>
    </div>
  );
}

function HaulCell({ Icon, value, label, accent = false }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg bg-secondary/40 py-2.5">
      <Icon className={`w-4 h-4 ${accent ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden="true" />
      <p className="font-heading font-bold text-body tabular-nums leading-none">{value}</p>
      <p className="text-micro text-muted-foreground leading-tight">{label}</p>
    </div>
  );
}

function QuestDetailRow({ quest, onClaim, onGo, t, tFallback }) {
  const def = quest.definition;
  if (!def) return null;
  const completed = !!quest.completed_at;
  const claimed = !!quest.claimed_at;
  const tappable = !claimed;

  const label = (() => { const k = `quest.${def.id}.label`; const v = t(k); return v === k ? def.label : v; })();
  const desc = (() => { const k = `quest.${def.id}.desc`; const v = t(k); return v === k ? def.description : v; })();

  // Guard the division: a corrupt seed row with target 0 would make this
  // Infinity (or NaN when both are 0) and render an invalid `width: NaN%`.
  const pct = quest.target > 0
    ? Math.max(0, Math.min(100, Math.round((quest.progress / quest.target) * 100)))
    : 0;

  const tierLabel = tFallback(`quests.tier.${quest.difficulty}`, quest.difficulty);

  return (
    <li>
      <div
        role={tappable ? 'button' : undefined}
        tabIndex={tappable ? 0 : undefined}
        onClick={tappable ? onGo : undefined}
        onKeyDown={tappable ? (e) => {
          // Gate on currentTarget — the Claim button inside is focusable, and
          // Enter on it would otherwise also fire onGo via bubbling and
          // navigate away mid-claim.
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGo(); }
        } : undefined}
        className={`flex gap-3 items-start rounded-lg -mx-1 px-1 py-1 ${
          tappable ? 'cursor-pointer hover:bg-secondary/25 active:bg-secondary/40 transition-colors' : ''
        }`}
      >
        <span className="mt-0.5">
          <QuestTile icon={def.icon} completed={completed} claimed={claimed} />
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <p className={`text-caption font-semibold leading-tight ${claimed ? 'text-muted-foreground line-through decoration-1' : ''}`}>
              {label}
            </p>
            <span className={`shrink-0 px-1.5 py-px rounded-full text-micro font-bold uppercase tracking-[0.03em] ${
              TIER_STYLE[quest.difficulty] || 'bg-secondary text-muted-foreground'
            }`}>
              {tierLabel}
            </span>
          </div>
          <p className="text-micro text-muted-foreground/80 leading-snug mt-0.5">{desc}</p>

          <div className="flex items-center gap-2 mt-1.5">
            {/* 4px on foreground/12, matching the readiness breakdown rows.
                h-1.5 on --secondary reads as a filled bar of its own next to
                the tile beside it. */}
            <div className="flex-1 h-1 rounded-full bg-foreground/[0.12] overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${completed ? 'bg-success' : 'bg-primary'}`}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>
            {!claimed && !completed && (
              <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60 rtl:scale-x-[-1]" aria-hidden="true" />
            )}
          </div>

          <QuestRewardLine
            quest={quest}
            tFallback={tFallback}
            className="block text-micro text-muted-foreground mt-1"
          />
        </div>

        {completed && !claimed && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClaim(); }}
            className="shrink-0 self-center px-3 py-1 rounded-sm bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity"
          >
            {t('dashboard.claim')}
          </button>
        )}
      </div>
    </li>
  );
}
