// src/components/workout/InjuryForm.jsx
// Full-page overlay for logging a new injury or viewing injury history.
// Accessible from the InjuryBanner "Log Injury" button and ProfileMenu.

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { ChevronLeft, Plus, Trash2, CheckCircle2, Clock, AlertTriangle, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { reportError } from '@/lib/reportError';
import { format, addDays, differenceInDays } from 'date-fns';
import * as injuries from '@/lib/data/injuries';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Glutes', 'Core'];

const SEVERITY_OPTIONS = [
  { id: 'mild',     label: 'Mild',     desc: 'Some soreness, can train around it',           color: 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10' },
  { id: 'moderate', label: 'Moderate', desc: 'Pain during movement, needs rest',              color: 'text-orange-500 border-orange-500/30 bg-orange-500/10' },
  { id: 'serious',  label: 'Serious',  desc: 'Sharp pain or structural concern — avoid area', color: 'text-red-500 border-red-500/30 bg-red-500/10' },
];

const STATUS_ICON = {
  active:     <AlertTriangle className="w-4 h-4 text-orange-500" />,
  recovering: <Clock className="w-4 h-4 text-yellow-500" />,
  cleared:    <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
};

const STATUS_COLOR = {
  active:     'text-orange-500',
  recovering: 'text-yellow-500',
  cleared:    'text-emerald-500',
};

function InjuryCard({ injury, onClear, onExtend, onDelete }) {
  const [extendDate, setExtendDate] = useState('');
  const [showExtend, setShowExtend] = useState(false);
  const isActive = injury.status !== 'cleared';
  const daysLeft = injury.estimated_recovery_date
    ? differenceInDays(new Date(injury.estimated_recovery_date), new Date())
    : null;

  return (
    <div className={`rounded-xl border p-3 ${isActive ? 'border-border bg-card' : 'border-border/50 bg-secondary/30 opacity-70'}`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          {STATUS_ICON[injury.status]}
          <span className="font-semibold text-sm">{injury.muscle_group}</span>
          <span className={`text-xs font-medium capitalize px-1.5 py-0.5 rounded-full border ${
            SEVERITY_OPTIONS.find(s => s.id === injury.severity)?.color || ''
          }`}>
            {injury.severity}
          </span>
        </div>
        <button onClick={() => onDelete(injury.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {injury.notes && <p className="text-xs text-muted-foreground mb-2">{injury.notes}</p>}

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
        <span>Logged {format(new Date(injury.injured_at), 'MMM d')}</span>
        {daysLeft !== null && isActive && (
          <span className={daysLeft <= 0 ? 'text-primary font-semibold' : ''}>
            {daysLeft <= 0 ? 'Recovery date reached' : `${daysLeft}d until recovery`}
          </span>
        )}
        {injury.cleared_at && (
          <span className="text-emerald-500">
            Cleared {format(new Date(injury.cleared_at), 'MMM d')}
          </span>
        )}
      </div>

      {isActive && (
        <div className="flex gap-2 mt-3">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs h-8 text-emerald-600 border-emerald-600/30 hover:bg-emerald-600/10"
            onClick={() => onClear(injury.id)}
          >
            <CheckCircle2 className="w-3 h-3 mr-1" /> Clear injury
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs h-8"
            onClick={() => setShowExtend(v => !v)}
          >
            Extend date
          </Button>
        </div>
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
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

export default function InjuryForm({ onClose }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  // Lock the page underneath + portal the overlay to <body> so a parent
  // with `transform`/`filter`/`backdrop-filter` in its ancestor chain
  // doesn't hijack the `fixed` positioning and render the modal behind
  // the dashboard.
  useBodyScrollLock(true);

  // ── Form state ─────────────────────────────────────────────────────────────
  const [view, setView] = useState('list'); // 'list' | 'new'
  const [muscleGroup, setMuscleGroup] = useState('');
  const [severity, setSeverity] = useState('mild');
  const [notes, setNotes] = useState('');
  const [injuredAt, setInjuredAt] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [recoveryDate, setRecoveryDate] = useState('');

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
      toast.success(`${muscleGroup} injury logged. Recovery Mode active.`);
      setView('list');
      setMuscleGroup('');
      setSeverity('mild');
      setNotes('');
      setRecoveryDate('');
    },
    onError: (err) => {
      reportError(err, { feature: 'injuries.log', level: 'warning', userEmail: user?.email });
      toast.error('Could not log injury. Try again.');
    },
  });

  const clearMutation = useMutation({
    mutationFn: injuries.clearInjury,
    onSuccess: () => { invalidate(); toast.success('Injury cleared.'); },
    onError: (err) => {
      reportError(err, { feature: 'injuries.clear', level: 'warning', userEmail: user?.email });
      toast.error('Could not clear injury. Try again.');
    },
  });

  const extendMutation = useMutation({
    mutationFn: ({ id, date }) => injuries.extendRecovery(id, date),
    onSuccess: () => { invalidate(); toast.success('Recovery date updated.'); },
    onError: (err) => {
      reportError(err, { feature: 'injuries.extend', level: 'warning', userEmail: user?.email });
      toast.error('Could not update recovery date. Try again.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: injuries.deleteInjury,
    onSuccess: () => { invalidate(); },
    onError: (err) => {
      reportError(err, { feature: 'injuries.delete', level: 'warning', userEmail: user?.email });
      toast.error('Could not delete injury. Try again.');
    },
  });

  const activeList  = injuryList.filter(i => i.status !== 'cleared');
  const clearedList = injuryList.filter(i => i.status === 'cleared');

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
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          {view === 'new' ? 'Back' : 'Close'}
        </button>
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="w-4 h-4 text-orange-500" />
          <span className="font-heading font-bold text-base">
            {view === 'new' ? 'Log Injury' : 'Injury Log'}
          </span>
        </div>
        {view === 'list' && (
          <button
            onClick={() => setView('new')}
            className="flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
          >
            <Plus className="w-4 h-4" /> Log
          </button>
        )}
        {view === 'new' && <div className="w-12" />}
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
                  <p className="font-heading font-bold">No injuries logged</p>
                  <p className="text-sm text-muted-foreground">Tap Log to record an injury.</p>
                  <Button onClick={() => setView('new')} className="mt-2 gap-2">
                    <Plus className="w-4 h-4" /> Log Injury
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeList.length > 0 && (
                    <>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active</p>
                      {activeList.map(inj => (
                        <InjuryCard
                          key={inj.id}
                          injury={inj}
                          onClear={id => clearMutation.mutate(id)}
                          onExtend={(id, date) => extendMutation.mutate({ id, date })}
                          onDelete={id => deleteMutation.mutate(id)}
                        />
                      ))}
                    </>
                  )}
                  {clearedList.length > 0 && (
                    <>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-4">Cleared</p>
                      {clearedList.map(inj => (
                        <InjuryCard
                          key={inj.id}
                          injury={inj}
                          onClear={id => clearMutation.mutate(id)}
                          onExtend={(id, date) => extendMutation.mutate({ id, date })}
                          onDelete={id => deleteMutation.mutate(id)}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {/* ── New Injury Form ────────────────────────────────────────────── */}
          {view === 'new' && (
            <motion.div key="new" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              {/* Muscle group */}
              <div className="mb-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Affected area</p>
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
                      {mg}
                    </button>
                  ))}
                </div>
              </div>

              {/* Severity */}
              <div className="mb-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Severity</p>
                <div className="space-y-2">
                  {SEVERITY_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setSeverity(opt.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors ${
                        severity === opt.id ? opt.color : 'border-border hover:border-border/80 bg-card'
                      }`}
                    >
                      <p className="font-semibold text-sm">{opt.label}</p>
                      <p className="text-xs text-muted-foreground">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Injured on</p>
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
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Est. recovery</p>
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
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Notes (optional)</p>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="What happened? Any context for your coach..."
                  rows={3}
                  className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <Button
                onClick={() => { if (!muscleGroup) { toast.error('Select an affected area'); return; } logMutation.mutate(); }}
                disabled={logMutation.isPending || !muscleGroup}
                className="w-full"
                size="lg"
              >
                {logMutation.isPending ? 'Logging…' : 'Log Injury'}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>,
    document.body,
  );
}
