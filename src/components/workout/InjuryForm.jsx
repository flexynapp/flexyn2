// src/components/workout/InjuryForm.jsx
// Full-page overlay for logging a new injury or viewing injury history.
// Accessible from the InjuryBanner "Log Injury" button and ProfileMenu.

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { ChevronLeft, Plus, Trash2, CheckCircle2, Clock, AlertTriangle, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/reportError';
import { format, addDays, differenceInDays } from 'date-fns';
import * as injuries from '@/lib/data/injuries';
import { injuryImpact } from '@/lib/aiCoach/workoutGenerator';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useOverlayBackButton } from '@/hooks/useOverlayBackButton';
import { useLanguage } from '@/lib/LanguageContext';
import { useDateFormatter } from '@/lib/intl';

// The STORED value stays the English name — `injury_logs.muscle_group` is
// matched by string downstream (getExcludedMuscleGroups lowercases it, the
// workout generator tests group and part against it), so translating what we
// write would silently stop injuries excluding anything. Only the LABEL is
// localized, out of `src/locales/*.json`, which already carries these eight
// in all 15 languages and is the same lookup the onboarding injury step uses.
// The regions a user can report an injury in. 'Forearms' was added when the
// grip and wrist work was retagged off 'Back': until then a wrist injury was
// inexpressible, and the only thing keeping wrist curls away from someone who
// had one was those exercises wrongly claiming to be back work. Retagging them
// correctly removed that accident, so the protection had to become real.
// Duplicated as OB_MUSCLES in Onboarding.jsx — the two pickers must agree, or
// an injury reportable at signup vanishes from the in-app form.
const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Legs', 'Glutes', 'Core'];

// Each option states what it DOES, not only how it feels. Severity is the one
// control here that changes someone's training, and all three descriptions
// used to describe the sensation instead — "Mild: some soreness, can train
// around it" while `getExcludedMuscleGroups` removes the group from every
// generated session at ANY severity, mild included. The app was promising to
// train around something it was in fact taking out.
//
// Mild and moderate were also the identical `text-primary` chip, so the choice
// that decides whether a body part disappears from your sessions looked like
// it made no difference. Muted / primary / destructive now reads as a ramp,
// inside the four-hue budget.
const SEVERITY_OPTIONS = [
  { id: 'mild',     label: 'Mild',     desc: 'Sore. That area comes out until you clear it',       color: 'text-foreground border-border bg-secondary' },
  { id: 'moderate', label: 'Moderate', desc: 'Hurts to move. That area comes out',                 color: 'text-primary border-primary/30 bg-primary/10' },
  { id: 'serious',  label: 'Serious',  desc: 'Sharp pain — that area and what it helps move go',   color: 'text-destructive border-destructive/30 bg-destructive/10' },
];

/** English label → the muscle-group key `src/locales/*.json` publishes. */
const muscleKey = (name) => String(name || '').toLowerCase();

const STATUS_ICON = {
  active:     <AlertTriangle className="w-4 h-4 text-primary" />,
  recovering: <Clock className="w-4 h-4 text-primary" />,
  cleared:    <CheckCircle2 className="w-4 h-4 text-success" />,
};

// (A STATUS_COLOR map sat here with no readers. The card colours status
// through STATUS_ICON's own classes, so it had never been used.)

function InjuryCard({ injury, cost, onClear, onSnooze, onExtend, onDelete }) {
  const { tFallback } = useLanguage();
  // Intl rather than date-fns' 'MMM d': the month name is the only part of
  // this that carries language, and date-fns would need a locale bundle per
  // language to say it in anything but English.
  const fmtDate = useDateFormatter();
  const shortDate = (d) => fmtDate(d, { month: 'short', day: 'numeric' });
  const area = tFallback(muscleKey(injury.muscle_group), injury.muscle_group);
  const [extendDate, setExtendDate] = useState('');
  const [showExtend, setShowExtend] = useState(false);
  // Delete was one tap with no confirm and no undo, on a control that silently
  // changes what the app programs for you — clearing an injury and deleting it
  // look identical afterwards, but only one of them is recoverable.
  //
  // Confirmed INLINE rather than with the Radix AlertDialog used elsewhere:
  // this form is a `z-[200]` portal and AlertDialog's overlay and content are
  // both `z-50`, so the dialog would render BEHIND the screen that opened it.
  // A second full-screen modal over a full-screen modal is also the wrong
  // shape on a phone.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isActive = injury.status !== 'cleared';
  const daysLeft = injury.estimated_recovery_date
    ? differenceInDays(new Date(injury.estimated_recovery_date), new Date())
    : null;

  return (
    <div className={`rounded-xl border p-3 ${isActive ? 'border-border bg-card' : 'border-border/50 bg-secondary/30 opacity-70'}`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          {STATUS_ICON[injury.status]}
          <span className="font-semibold text-sm">{area}</span>
          <span className={`text-xs font-medium capitalize px-1.5 py-0.5 rounded-full border ${
            SEVERITY_OPTIONS.find(s => s.id === injury.severity)?.color || ''
          }`}>
            {tFallback(`injuries.severity.${injury.severity}`, injury.severity)}
          </span>
        </div>
        <button
          onClick={() => setConfirmDelete(true)}
          aria-label={tFallback('injuries.delete.aria', 'Delete {area} injury', { area })}
          className="p-1 text-muted-foreground hover:text-destructive active:text-destructive transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Delete confirmation. Replaces the action row rather than sitting
          beside it, so the destructive choice is the only thing to answer and
          the card cannot grow taller mid-list. Names what is lost: an active
          injury is also holding exercises out of your sessions, and deleting
          it silently hands them back. */}
      {confirmDelete ? (
        <div className="mt-1">
          <p className="text-xs text-muted-foreground mb-2">
            {tFallback('injuries.delete.question', 'Delete this {area} entry?', { area: area.toLowerCase() })}{' '}
            {isActive
              ? tFallback('injuries.delete.activeWarning', 'Those exercises come back into your sessions straight away.')
              : tFallback('injuries.delete.clearedWarning', 'It leaves your history for good.')}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs h-8"
              onClick={() => setConfirmDelete(false)}
            >
              {tFallback('injuries.delete.cancel', 'Cancel')}
            </Button>
            <Button
              size="sm"
              className="flex-1 text-xs h-8 bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/90"
              onClick={() => { setConfirmDelete(false); onDelete(injury.id); }}
            >
              {tFallback('injuries.delete.confirm', 'Delete')}
            </Button>
          </div>
        </div>
      ) : (
      <>
      {injury.notes && <p className="text-xs text-muted-foreground mb-2">{injury.notes}</p>}

      {/* The consequence leads. "Shoulders, serious" is a receipt for
          something the user already knows; the number of lifts it is holding
          out of their sessions exists nowhere else in the app, and it only
          became a true statement once the exclusion actually matched the
          catalog. Counted from the same catalog and the same group/part test
          generateWorkout filters on, so it cannot drift from reality. */}
      {isActive && cost > 0 && (
        <p className="text-sm font-medium mb-1">
          {cost === 1
            ? tFallback('injuries.card.costOne', '1 exercise is out of your sessions')
            : tFallback('injuries.card.cost', '{count} exercises are out of your sessions', { count: cost })}
        </p>
      )}

      <div className="flex items-center gap-3 text-micro text-muted-foreground flex-wrap">
        <span>{tFallback('injuries.card.logged', 'Logged {date}', { date: shortDate(injury.injured_at) })}</span>
        {daysLeft !== null && isActive && (
          <span className={daysLeft <= 0 ? 'text-primary font-semibold' : ''}>
            {daysLeft <= 0
              ? tFallback('injuries.card.dateReached', 'Recovery date reached')
              : tFallback('injuries.card.daysLeft', '{days}d until recovery', { days: daysLeft })}
          </span>
        )}
        {injury.cleared_at && (
          <span className="text-success">
            {tFallback('injuries.card.clearedOn', 'Cleared {date}', { date: shortDate(injury.cleared_at) })}
          </span>
        )}
      </div>

      {/* Same two answers as the check-in prompt on the Workout tab, worded
          the same way. They used to be "Clear injury" and "Extend date", and
          the second opened a date field — the same field nobody fills in on
          the way in, so deferring meant typing a date. "Still hurts" pushes
          the next check-in out by this injury's own interval instead.
          The date picker is still reachable below for anyone who wants to name
          a specific day. */}
      {isActive && (
        <div className="flex gap-2 mt-3">
          <Button
            size="sm"
            className="flex-1 text-xs h-8"
            onClick={() => onClear(injury.id)}
          >
            <CheckCircle2 className="w-3 h-3 me-1" /> {tFallback('injuries.checkIn.cleared', "I'm cleared")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs h-8"
            onClick={() => onSnooze(injury.id, injury.severity)}
          >
            {tFallback('injuries.checkIn.stillHurts', 'Still hurts')}
          </Button>
        </div>
      )}
      {isActive && (
        <button
          type="button"
          onClick={() => setShowExtend(v => !v)}
          className="mt-2 text-micro text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
        >
          {tFallback('injuries.card.extend', 'Extend date')}
        </button>
      )}

      {showExtend && (
        <div className="flex gap-2 mt-2">
          <input
            type="date"
            value={extendDate}
            onChange={e => setExtendDate(e.target.value)}
            className="flex-1 text-xs h-8 rounded-md border border-border bg-background px-2"
            min={format(addDays(new Date(), 1), 'yyyy-MM-dd')}
          />
          <Button size="sm" className="h-8 text-xs" onClick={() => { if (extendDate) { onExtend(injury.id, extendDate); setShowExtend(false); } }}>
            {tFallback('injuries.card.save', 'Save')}
          </Button>
        </div>
      )}
      </>
      )}
    </div>
  );
}

export default function InjuryForm({ onClose }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Lock the page underneath + portal the overlay to <body> so a parent
  // with `transform`/`filter`/`backdrop-filter` in its ancestor chain
  // doesn't hijack the `fixed` positioning and render the modal behind
  // the dashboard.
  useBodyScrollLock(true);

  // ── Form state ─────────────────────────────────────────────────────────────
  // 'changed' is sheet C — the screen that says what the injury just did.
  const [view, setView] = useState('list'); // 'list' | 'new' | 'changed'
  // Cleared injuries are history. Under a live list they compete for
  // attention with the thing that is currently changing your training.
  const [showCleared, setShowCleared] = useState(false);
  // The impact of the injury just logged, captured at the moment it landed so
  // sheet C describes THAT injury rather than re-deriving from a list that has
  // since refetched.
  const [justLogged, setJustLogged] = useState(null);
  const [muscleGroup, setMuscleGroup] = useState('');
  const [severity, setSeverity] = useState('mild');
  const [notes, setNotes] = useState('');
  const [injuredAt, setInjuredAt] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [recoveryDate, setRecoveryDate] = useState('');

  // Back mirrors the header chevron exactly: from the New form it
  // returns to the list, and from the list it closes. Two registrations,
  // not one, because they are two real levels — with a single history
  // entry, backing out of the New form would consume it and the NEXT
  // press would navigate the page underneath while this overlay stayed
  // on screen, which is the bug being fixed in the first place.
  //
  // Backing out of the New form does NOT discard what was typed: the
  // field state is only reset in logMutation.onSuccess, and this
  // component stays mounted, so reopening New still has it. Closing the
  // whole overlay does drop it — same as the chevron has always done,
  // and it takes a deliberate second press from the list to get there.
  useOverlayBackButton(true, onClose);
  useOverlayBackButton(view === 'new' || view === 'changed', () => setView('list'));

  // ── Data ───────────────────────────────────────────────────────────────────
  // Distinct key from InjuryBanner's ['injuries','active',uid]: this query
  // returns ALL injuries (incl. cleared, for the history list); sharing a
  // key with the active-only banner query corrupted both caches.
  const { data: injuryList = [], isLoading } = useQuery({
    queryKey: ['injuries', 'all', user?.id],
    queryFn: injuries.listInjuries,
    enabled: !!user?.id,
  });

  // Prefix invalidation refreshes BOTH the form's ['injuries','all',uid]
  // and the banner's ['injuries','active',uid] after any mutation.
  const invalidate = () => qc.invalidateQueries({ queryKey: ['injuries'] });

  const logMutation = useMutation({
    mutationFn: () => injuries.logInjury({
      userId: user.id,
      userEmail: user.email,
      muscleGroup,
      severity,
      notes,
      injuredAt,
      estimatedRecoveryDate: recoveryDate || null,
    }),
    onSuccess: () => {
      invalidate();
      toast.success(tFallback('injuries.toast.logged', '{area} injury logged. Recovery Mode active.', {
        area: tFallback(muscleKey(muscleGroup), muscleGroup),
      }));
      // Sheet C, not the list. Logging an injury is the largest automatic
       // change the app makes to someone's training and it used to produce a
       // toast and nothing else — the first time you saw what it did was when
       // a session arrived without the lifts you expected.
      setJustLogged({ muscleGroup, severity });
      setView('changed');
      setMuscleGroup('');
      setSeverity('mild');
      setNotes('');
      setRecoveryDate('');
    },
    onError: (err) => {
      reportError(err, { feature: 'injuries.log', level: 'warning', userEmail: user?.email });
      toast.error(tFallback('injuries.toast.logFailed', 'Could not log injury. Try again.'));
    },
  });

  const clearMutation = useMutation({
    mutationFn: injuries.clearInjury,
    onSuccess: () => { invalidate(); toast.success(tFallback('injuries.toast.cleared', 'Injury cleared.')); },
    onError: (err) => {
      reportError(err, { feature: 'injuries.clear', level: 'warning', userEmail: user?.email });
      toast.error(tFallback('injuries.toast.clearFailed', 'Could not clear injury. Try again.'));
    },
  });

  // "Still hurts" — the same one-tap defer the Workout-tab check-in offers, so
  // the two surfaces answer the same question the same way.
  const snoozeMutation = useMutation({
    mutationFn: ({ id, severity: sev }) => injuries.snoozeCheckIn(id, sev),
    onSuccess: (_d, { severity: sev }) => {
      invalidate();
      toast.success(tFallback(
        'injuries.toast.snoozed',
        "Keeping it out of your sessions. We'll ask again in {days} days.",
        { days: injuries.checkInIntervalDays(sev) },
      ));
    },
    onError: (err) => {
      reportError(err, { feature: 'injuries.snooze', level: 'warning', userEmail: user?.email });
      toast.error(tFallback('injuries.toast.snoozeFailed', 'Could not update. Try again.'));
    },
  });

  const extendMutation = useMutation({
    mutationFn: ({ id, date }) => injuries.extendRecovery(id, date),
    onSuccess: () => { invalidate(); toast.success(tFallback('injuries.toast.dateUpdated', 'Recovery date updated.')); },
    onError: (err) => {
      reportError(err, { feature: 'injuries.extend', level: 'warning', userEmail: user?.email });
      toast.error(tFallback('injuries.toast.dateFailed', 'Could not update recovery date. Try again.'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: injuries.deleteInjury,
    onSuccess: () => { invalidate(); },
    onError: (err) => {
      reportError(err, { feature: 'injuries.delete', level: 'warning', userEmail: user?.email });
      toast.error(tFallback('injuries.toast.deleteFailed', 'Could not delete injury. Try again.'));
    },
  });

  const activeList  = injuryList.filter(i => i.status !== 'cleared');
  const clearedList = injuryList.filter(i => i.status === 'cleared');

  // What each injury costs, ON ITS OWN. Per-injury rather than cumulative so a
  // card states its own consequence — two injuries that both rule out chest
  // each say so, which is what the user asked about by looking at that card.
  const costById = useMemo(() => {
    const out = {};
    for (const inj of activeList) {
      out[inj.id] = injuryImpact(injuries.getExcludedMuscleGroups([inj])).removedCount;
    }
    return out;
  }, [activeList]);

  // Sheet C's numbers come from the FULL active set including the one just
  // logged, because that is what the generator will actually apply — an injury
  // described in isolation would under-report a user who already had one.
  const changed = useMemo(() => {
    if (!justLogged) return null;
    const impact = injuryImpact(injuries.getExcludedMuscleGroups(activeList));
    return { ...impact, ...justLogged };
  }, [justLogged, activeList]);

  return createPortal(
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 32 }}
      transition={{ type: 'spring', stiffness: 340, damping: 32 }}
      className="fixed inset-0 z-[200] bg-background flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <button
          onClick={view === 'new' ? () => setView('list') : onClose}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          {view === 'list'
            ? tFallback('injuries.action.close', 'Close')
            : tFallback('injuries.action.back', 'Back')}
        </button>
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="w-4 h-4 text-primary" />
          <span className="font-heading font-bold text-base">
            {view === 'new'
              ? tFallback('injuries.title.new', 'Log Injury')
              : view === 'changed'
                ? tFallback('injuries.title.changed', 'Injury logged')
                : tFallback('injuries.title.list', 'Injury Log')}
          </span>
        </div>
        {view === 'list' && (
          <button
            onClick={() => setView('new')}
            className="flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 active:text-primary/80 transition-colors"
          >
            <Plus className="w-4 h-4" /> {tFallback('injuries.action.log', 'Log')}
          </button>
        )}
        {view !== 'list' && <div className="w-12" />}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <AnimatePresence mode="wait">
          {/* ── List View ─────────────────────────────────────────────────── */}
          {view === 'list' && (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {isLoading ? (
                <div className="space-y-2">
                  {[1,2].map(i => <div key={i} className="h-20 rounded-xl bg-secondary animate-pulse" />)}
                </div>
              ) : activeList.length === 0 && clearedList.length === 0 ? (
                <div className="flex flex-col items-center py-16 gap-3 text-center">
                  <ShieldAlert className="w-10 h-10 text-muted-foreground/40" />
                  <p className="font-heading font-bold">{tFallback('injuries.empty.title', 'No injuries logged')}</p>
                  <p className="text-sm text-muted-foreground">{tFallback('injuries.empty.body', 'Tap Log to record an injury.')}</p>
                  <Button onClick={() => setView('new')} className="mt-2 gap-2">
                    <Plus className="w-4 h-4" /> {tFallback('injuries.empty.cta', 'Log Injury')}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeList.length > 0 && (
                    <>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{tFallback('injuries.section.active', 'Active')}</p>
                      {activeList.map(inj => (
                        <InjuryCard
                          key={inj.id}
                          injury={inj}
                          cost={costById[inj.id] || 0}
                          onClear={id => clearMutation.mutate(id)}
                          onSnooze={(id, sev) => snoozeMutation.mutate({ id, severity: sev })}
                          onExtend={(id, date) => extendMutation.mutate({ id, date })}
                          onDelete={id => deleteMutation.mutate(id)}
                        />
                      ))}
                    </>
                  )}
                  {/* Cleared injuries collapse. They are history, and history
                      under a live list competes for attention with the thing
                      that is currently changing your training. One row, one
                      tap — and the count is the whole summary. */}
                  {clearedList.length > 0 && (
                    <>
                      {!showCleared ? (
                        <button
                          type="button"
                          onClick={() => setShowCleared(true)}
                          className="w-full mt-4 flex items-center justify-between rounded-lg border border-border/60 px-4 py-3 text-start hover:border-border active:border-border transition-colors"
                        >
                          <span className="text-sm font-medium text-muted-foreground">
                            {clearedList.length === 1
                              ? tFallback('injuries.cleared.countOne', '1 cleared')
                              : tFallback('injuries.cleared.count', '{count} cleared', { count: clearedList.length })}
                          </span>
                          <span className="text-xs font-medium text-muted-foreground">
                            {tFallback('injuries.cleared.show', 'Show')} ›
                          </span>
                        </button>
                      ) : (
                        <>
                          <div className="flex items-center justify-between mt-4">
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{tFallback('injuries.section.cleared', 'Cleared')}</p>
                            <button
                              type="button"
                              onClick={() => setShowCleared(false)}
                              className="text-xs font-medium text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
                            >
                              {tFallback('injuries.cleared.hide', 'Hide')}
                            </button>
                          </div>
                          {clearedList.map(inj => (
                            <InjuryCard
                              key={inj.id}
                              injury={inj}
                              cost={0}
                              onClear={id => clearMutation.mutate(id)}
                              onSnooze={(id, sev) => snoozeMutation.mutate({ id, severity: sev })}
                              onExtend={(id, date) => extendMutation.mutate({ id, date })}
                              onDelete={id => deleteMutation.mutate(id)}
                            />
                          ))}
                        </>
                      )}
                    </>
                  )}

                  {/* The Coach knows about these — and until 2026-08-09 it did
                      not, on any path. Worth saying out loud on the screen
                      where someone has just told the app they are hurt. */}
                  {activeList.length > 0 && (
                    <div className="pt-6 mt-2 border-t border-border">
                      <p className="text-sm font-semibold">
                        {activeList.length === 1
                          ? tFallback('injuries.coach.knowsOne', 'Coach knows about this.')
                          : tFallback('injuries.coach.knows', 'Coach knows about all of these.')}
                      </p>
                      <button
                        type="button"
                        onClick={() => { onClose?.(); navigate('/coach'); }}
                        className="mt-0.5 text-sm text-primary hover:text-primary/80 active:text-primary/80 transition-colors"
                      >
                        {tFallback('injuries.coach.ask', 'Ask it what to train instead')} ›
                      </button>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {/* ── What it changed ──────────────────────────────────────────────
              The screen that did not exist. Logging an injury used to produce
              a toast and a banner, and the first time you saw what it had done
              was when a session arrived without the lifts you expected.
              CLAUDE.md already requires the Coach to explain every automatic
              change it makes to someone's training — this is the largest one
              in the app, and it was the one that never explained itself.

              Naming the lifts is also the only way a user can catch a mis-tap
              before it quietly reshapes a month of training. */}
          {view === 'changed' && changed && (
            <motion.div key="changed" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <h2 className="font-heading font-bold text-2xl leading-tight">
                {tFallback('injuries.changed.title', 'Your sessions just changed.')}
              </h2>

              {/* Only for a serious injury, because only then is the list
                  wider than the body part the user actually named — and an
                  unexplained "why is chest gone too?" reads as a bug. */}
              {changed.severity === 'serious' && (
                <p className="text-sm text-muted-foreground mt-2">
                  {tFallback(
                    'injuries.changed.synergists',
                    'A serious {area} injury also takes out what it helps move — that is why more than one group is on this list.',
                    { area: tFallback(muscleKey(changed.muscleGroup), changed.muscleGroup).toLowerCase() },
                  )}
                </p>
              )}

              {changed.removed.length > 0 && (
                <div className="mt-6">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    {tFallback('injuries.changed.out', "Out, until you're cleared")}
                  </p>
                  <div className="rounded-lg border border-border bg-card p-3">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {changed.removed.map(name => (
                        <span key={name} className="text-xs text-muted-foreground">{name}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {changed.remainingGroups.length > 0 && (
                <div className="mt-6">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    {tFallback('injuries.changed.still', 'Still yours')}
                  </p>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-sm font-bold capitalize">
                      {changed.remainingGroups
                        .map(g => tFallback(muscleKey(g), g))
                        .join('  ·  ')}
                    </p>
                  </div>
                </div>
              )}

              {/* The offer that turns a restriction into a session. It goes to
                  the Coach rather than generating here, because the Coach now
                  knows about the injury — severity, age and the note — and can
                  say what it is working around. */}
              <div className="mt-6">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => { onClose?.(); navigate('/coach'); }}
                >
                  {tFallback('injuries.changed.cta', 'Build me a session around it')}
                </Button>
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className="w-full mt-2 py-2 text-sm font-medium text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
                >
                  {tFallback('injuries.changed.notNow', 'Not now')}
                </button>
              </div>
            </motion.div>
          )}

          {/* ── New Injury Form ────────────────────────────────────────────── */}
          {view === 'new' && (
            <motion.div key="new" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              {/* Muscle group */}
              <div className="mb-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{tFallback('injuries.form.area', 'Affected area')}</p>
                <div className="flex flex-wrap gap-2">
                  {MUSCLE_GROUPS.map(mg => (
                    <button
                      key={mg}
                      onClick={() => setMuscleGroup(mg)}
                      aria-pressed={muscleGroup === mg}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        muscleGroup === mg
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background border-border hover:border-primary/50'
                      }`}
                    >
                      {tFallback(muscleKey(mg), mg)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Severity */}
              <div className="mb-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{tFallback('injuries.form.severity', 'Severity')}</p>
                <div className="space-y-2">
                  {SEVERITY_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setSeverity(opt.id)}
                      className={`w-full text-start px-3 py-2.5 rounded-xl border transition-colors ${
                        severity === opt.id ? opt.color : 'border-border hover:border-border/80 bg-card'
                      }`}
                    >
                      <p className="font-semibold text-sm">{tFallback(`injuries.severity.${opt.id}`, opt.label)}</p>
                      <p className="text-xs text-muted-foreground">{tFallback(`injuries.severity.${opt.id}.desc`, opt.desc)}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{tFallback('injuries.form.injuredOn', 'Injured on')}</p>
                  <input
                    type="date"
                    value={injuredAt}
                    onChange={e => setInjuredAt(e.target.value)}
                    max={format(new Date(), 'yyyy-MM-dd')}
                    min={format(addDays(new Date(), -3650), 'yyyy-MM-dd')}
                    className="w-full h-9 text-sm rounded-md border border-border bg-background px-2"
                  />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{tFallback('injuries.form.estRecovery', 'Est. recovery')}</p>
                  <input
                    type="date"
                    value={recoveryDate}
                    onChange={e => setRecoveryDate(e.target.value)}
                    min={format(addDays(new Date(), 1), 'yyyy-MM-dd')}
                    className="w-full h-9 text-sm rounded-md border border-border bg-background px-2"
                  />
                </div>
              </div>

              {/* Notes */}
              <div className="mb-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{tFallback('injuries.form.notes', 'Notes (optional)')}</p>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder={tFallback('injuries.form.notesPlaceholder', 'What happened? Any context for your coach…')}
                  rows={3}
                  className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <Button
                onClick={() => { if (!muscleGroup) { toast.error(tFallback('injuries.toast.selectArea', 'Select an affected area')); return; } logMutation.mutate(); }}
                disabled={logMutation.isPending || !muscleGroup}
                className="w-full"
                size="lg"
              >
                {logMutation.isPending
                  ? tFallback('injuries.form.submitting', 'Logging…')
                  : tFallback('injuries.form.submit', 'Log Injury')}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>,
    document.body,
  );
}
