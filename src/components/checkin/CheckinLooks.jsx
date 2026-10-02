// src/components/checkin/CheckinLooks.jsx
//
// Design proposals for the first-week check-in (2026-10-02, Kegan: "make some
// design suggestions"). Preview builds only: FirstWeekCheckin renders this
// when VITE_CHECKIN_LOOK is set, and a normal build never includes it. Once a
// look is picked, it moves into FirstWeekCheckin.jsx and this file goes.
//
//   A  rising   the week as bars sized by each day's XP, so day 7 reads as
//               the thing to come back for
//   B  level    today's XP drawn onto the level bar it will land on
//   C  flyout   a compact card that drops from the top and leaves the page
//               usable, instead of a sheet that covers it

import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import BottomSheet from '@/components/ui/BottomSheet';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import { useLanguage } from '@/lib/LanguageContext';
import { SPRING, TIER, EASE_IN } from '@/lib/motion';
import { calculateLevelFromXp } from '@/lib/xpSystem';

const MAX_XP = 100;

function ClaimButton({ claimed, busy, onClaim, className = 'h-12 w-full rounded-lg' }) {
  const { tFallback } = useLanguage();
  return (
    <motion.button
      type="button"
      onClick={onClaim}
      disabled={busy || claimed}
      whileTap={claimed ? undefined : { scale: 0.97 }}
      transition={TIER.answer.spring}
      className={`${className} font-semibold transition-colors ${
        claimed ? 'bg-secondary text-muted-foreground' : 'bg-primary text-primary-foreground'
      }`}
    >
      {claimed ? (
        <span className="inline-flex items-center gap-1.5">
          <Check className="h-4 w-4" aria-hidden="true" />
          {tFallback('firstWeekCheckin.done', 'Checked in')}
        </span>
      ) : tFallback('firstWeekCheckin.cta', 'Check in')}
    </motion.button>
  );
}

function Prize({ entry, claimed, size = 'display' }) {
  if (!entry) return null;
  return (
    <span className="flex items-center gap-5">
      <span className="flex items-baseline gap-1">
        <span className={`font-heading text-${size} font-semibold tabular-nums ${claimed ? 'text-success' : ''}`}>+{entry.xp}</span>
        <span className="text-caption text-muted-foreground">XP</span>
      </span>
      <span className="flex items-center gap-1.5">
        <FlexCoinIcon size={size === 'display' ? 22 : 18} />
        <span className="font-heading text-title font-semibold tabular-nums">{entry.coins}</span>
      </span>
    </span>
  );
}

// ── A: rising bars ─────────────────────────────────────────────────────────

function RisingWeek({ days, today, justClaimed }) {
  return (
    <ol className="flex items-end justify-between gap-2">
      {days.map((d) => {
        const status = d.day === today && justClaimed ? 'claimed' : d.status;
        const h = Math.round(20 + (d.xp / MAX_XP) * 76); // px, 35 to 96
        const fill = {
          claimed: 'bg-success',
          today: 'bg-primary',
          missed: 'border border-dashed border-border',
          future: 'bg-secondary',
        }[status];
        return (
          <li key={d.day} className="flex flex-1 flex-col items-center gap-1">
            <span className={`text-micro tabular-nums ${status === 'today' ? 'font-semibold text-foreground' : 'text-muted-foreground'} ${status === 'missed' ? 'line-through opacity-50' : ''}`}>
              {d.xp}
            </span>
            <motion.span
              className={`flex w-full items-end justify-center rounded-sm pb-1.5 ${fill}`}
              style={{ height: h, transformOrigin: 'bottom' }}
              initial={status === 'claimed' && d.day === today ? { scaleY: 0.85 } : false}
              animate={{ scaleY: 1 }}
              transition={TIER.reward.spring}
            >
              {status === 'claimed' && <Check className="h-3.5 w-3.5 text-success-foreground" strokeWidth={3} aria-hidden="true" />}
            </motion.span>
            <span className={`text-caption tabular-nums ${status === 'today' ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>{d.day}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ── B: where it lands ──────────────────────────────────────────────────────

function LevelLanding({ totalXp = 0, entry, claimed }) {
  const { tFallback } = useLanguage();
  const before = Number(totalXp) || 0;
  const base = claimed ? before - (entry?.xp || 0) : before;
  const lv = calculateLevelFromXp(base);
  const gain = entry?.xp || 0;
  const startPct = lv.progressPercent;
  const gainPct = Math.min(100 - startPct, (gain / (lv.xpNeeded || 1)) * 100);
  const crosses = lv.xpInLevel + gain >= lv.xpNeeded;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-caption">
        <span className="font-semibold">{tFallback('createDuelModal.level', 'Lv. {n}', { n: lv.level })}</span>
        <span className={crosses ? 'font-semibold text-primary' : 'text-muted-foreground'}>
          {tFallback('createDuelModal.level', 'Lv. {n}', { n: lv.level + 1 })}
        </span>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary">
        <span className="absolute inset-y-0 start-0 rounded-full bg-foreground/70" style={{ width: `${startPct}%` }} />
        <motion.span
          className={`absolute inset-y-0 rounded-e-full ${claimed ? 'bg-success' : 'bg-primary/35'}`}
          style={{ insetInlineStart: `${startPct}%`, width: `${gainPct}%`, transformOrigin: 'left' }}
          initial={false}
          animate={{ scaleX: 1 }}
          transition={TIER.reward.spring}
        />
      </div>
      <div className="flex justify-between text-micro tabular-nums text-muted-foreground">
        <span>{Math.round(lv.xpInLevel + (claimed ? gain : 0))} / {lv.xpNeeded}</span>
        <span className={claimed ? 'text-success' : 'text-primary'}>+{gain}</span>
      </div>
    </div>
  );
}

function DotWeek({ days, today, justClaimed }) {
  return (
    <ol className="relative flex items-center justify-between">
      <span aria-hidden="true" className="absolute inset-x-3 top-1/2 h-px bg-border" />
      {days.map((d) => {
        const status = d.day === today && justClaimed ? 'claimed' : d.status;
        const cls = {
          claimed: 'bg-success text-success-foreground',
          today: 'bg-background text-primary ring-2 ring-primary font-semibold',
          missed: 'border border-dashed border-border bg-background text-muted-foreground/50',
          future: 'border border-border bg-background text-muted-foreground',
        }[status];
        return (
          <li key={d.day} className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-micro tabular-nums ${cls}`}>
            {status === 'claimed' ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /> : d.day}
          </li>
        );
      })}
    </ol>
  );
}

// ── C: top flyout ──────────────────────────────────────────────────────────

function TopFlyout({ open, title, days, today, todayEntry, claimed, justClaimed, busy, failed, onClaim, onClose }) {
  const { tFallback } = useLanguage();
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="checkin-flyout"
          role="dialog"
          aria-label={title}
          className="fixed inset-x-3 z-[201] flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 shadow-md"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
          initial={{ y: -140, opacity: 0 }}
          animate={{ y: 0, opacity: 1, transition: SPRING.settle }}
          exit={{ y: -140, opacity: 0, transition: { duration: 0.2, ease: EASE_IN } }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.4, bottom: 0 }}
          onDragEnd={(_e, info) => { if (info.offset.y < -40 || info.velocity.y < -300) onClose(); }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="text-caption text-muted-foreground">{title}</span>
              <Prize entry={todayEntry} claimed={claimed} size="title" />
            </div>
            <div className="flex items-center gap-2">
              <ClaimButton claimed={claimed} busy={busy} onClaim={onClaim} className="h-10 rounded-full px-5" />
              <button type="button" onClick={onClose} aria-label={tFallback('common.close', 'Close')}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <DotWeek days={days} today={today} justClaimed={justClaimed} />
          {failed && <p className="text-caption text-destructive">{tFallback('firstWeekCheckin.failed', 'Could not check in. Try again.')}</p>}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default function CheckinLook(props) {
  const { look, open, title, days, today, todayEntry, claimed, justClaimed, busy, failed, onClaim, onClose, totalXp } = props;
  const { tFallback } = useLanguage();

  if (look === 'C') return <TopFlyout {...props} />;

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-6 pt-2">
        {look === 'A' && <RisingWeek days={days} today={today} justClaimed={justClaimed} />}
        {look === 'B' && <DotWeek days={days} today={today} justClaimed={justClaimed} />}
        {look === 'A' && <div className="flex justify-center"><Prize entry={todayEntry} claimed={claimed} /></div>}
        {look === 'B' && (
          <div className="flex flex-col gap-4">
            <div className="flex justify-center"><Prize entry={todayEntry} claimed={claimed} /></div>
            <LevelLanding totalXp={totalXp} entry={todayEntry} claimed={claimed} />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <ClaimButton claimed={claimed} busy={busy} onClaim={onClaim} />
          {failed && <p className="text-center text-caption text-destructive">{tFallback('firstWeekCheckin.failed', 'Could not check in. Try again.')}</p>}
        </div>
      </div>
    </BottomSheet>
  );
}
