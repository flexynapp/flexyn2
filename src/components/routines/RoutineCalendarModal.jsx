// src/components/routines/RoutineCalendarModal.jsx
//
// Dashboard "My Week" popup — a glance at your active routine's calendar with
// today highlighted, one tap to start any day's session. "Manage" opens the
// full routine editor (MyRoutineSheet).

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { X as XIcon, Play, Moon, CalendarDays, Settings2 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getActiveRoutine, todayIndex, DAY_NAMES, DAY_NAMES_FULL } from '@/lib/data/routines';
import MyRoutineSheet from './MyRoutineSheet';

export default function RoutineCalendarModal({ open, onClose }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);

  const { data: routine } = useQuery({
    queryKey: ['activeRoutine', user?.id],
    queryFn: getActiveRoutine,
    enabled: !!user?.id && !!open,
    staleTime: 30_000,
  });

  if (!open) return null;
  const today = todayIndex();

  const startDay = (day) => {
    if (!day || day.isRest || !day.exercises?.length) return;
    navigate('/workout', { state: { startRoutineExercises: day.exercises, routineDayLabel: day.label } });
    onClose();
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9997] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-card w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-border max-h-[85vh] flex flex-col"
        style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-center gap-2 p-4 border-b border-border shrink-0">
          <CalendarDays className="w-5 h-5 text-primary" />
          <h2 className="font-heading font-bold text-lg flex-1 truncate">
            {routine ? routine.name : 'My Week'}
          </h2>
          <button onClick={() => setEditOpen(true)} aria-label="Manage routines"
            className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary">
            <Settings2 className="w-4 h-4" />
          </button>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-3 space-y-2">
          {!routine ? (
            <button onClick={() => setEditOpen(true)} className="w-full rounded-2xl border border-dashed border-primary/40 bg-primary/[0.05] p-4 text-start">
              <p className="font-heading font-bold text-sm">No active routine yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">Tap to build your week — label your days and add your lifts.</p>
            </button>
          ) : (
            (routine.days || []).map((day, idx) => {
              const isToday = idx === today;
              const canStart = !day.isRest && day.exercises?.length > 0;
              return (
                <div key={idx} className={`flex items-center gap-3 rounded-2xl border p-3 ${isToday ? 'border-primary/60 bg-primary/[0.04]' : 'border-border'}`}>
                  <div className="w-10 shrink-0 text-center">
                    <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground">{DAY_NAMES[idx]}</p>
                    {isToday && <p className="text-micro font-bold text-primary">TODAY</p>}
                  </div>
                  <div className="flex-1 min-w-0">
                    {day.isRest ? (
                      <span className="text-sm text-muted-foreground flex items-center gap-1.5"><Moon className="w-3.5 h-3.5" /> Rest</span>
                    ) : (
                      <>
                        <p className="font-heading font-bold text-sm truncate">{day.label || DAY_NAMES_FULL[idx]}</p>
                        <p className="text-micro text-muted-foreground">{day.exercises?.length || 0} exercise{(day.exercises?.length || 0) === 1 ? '' : 's'}</p>
                      </>
                    )}
                  </div>
                  {canStart && (
                    <button onClick={() => startDay(day)} aria-label={`Start ${day.label || DAY_NAMES_FULL[idx]}`}
                      className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </motion.div>

      <MyRoutineSheet open={editOpen} onClose={() => setEditOpen(false)} />
    </motion.div>,
    document.body,
  );
}
