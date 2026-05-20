// src/components/duels/CreateDuelModal.jsx
// Challenge flow — challenger picks duel type, builds or selects a session, sends invite.

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Swords, Dumbbell, Timer, Trophy, ChevronRight, Loader2 } from 'lucide-react';
import { createDuel } from '@/lib/data/duels';
import { toast } from 'sonner';

const DUEL_TYPES = [
  {
    id:          'mirror',
    label:       'Mirror Duel',
    icon:        Dumbbell,
    color:       'text-violet-500',
    bg:          'bg-violet-500/10 border-violet-500/30',
    activeBg:    'bg-violet-500 border-violet-500',
    description: 'Opponent completes the exact same session. Scored on completion % + volume matched.',
  },
  {
    id:          'open',
    label:       'Open Duel',
    icon:        Timer,
    color:       'text-primary',
    bg:          'bg-primary/10 border-primary/30',
    activeBg:    'bg-primary border-primary',
    description: 'Both train freely within a time window. Most total volume wins.',
  },
  {
    id:          'exercise',
    label:       'Exercise Duel',
    icon:        Trophy,
    color:       'text-amber-500',
    bg:          'bg-amber-500/10 border-amber-500/30',
    activeBg:    'bg-amber-500 border-amber-500',
    description: 'Single exercise showdown — most reps or highest weight. Narrow, quick, shareable.',
  },
];

export default function CreateDuelModal({ opponentId, opponentUsername, recentSession = null, onClose, onCreated }) {
  const [selectedType, setSelectedType] = useState('open');
  const [windowHours,  setWindowHours]  = useState(24);
  const [loading,      setLoading]      = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const sessionTemplate = selectedType === 'mirror' && recentSession
        ? { exercises: recentSession.exercises, name: recentSession.regimen_name }
        : null;

      const duel = await createDuel({
        opponentId,
        type:            selectedType,
        sessionTemplate,
        windowHours,
      });

      toast.success(`Duel challenge sent to @${opponentUsername}!`, {
        description: `They have ${windowHours}h to accept.`,
      });
      onCreated?.(duel);
      onClose();
    } catch (err) {
      toast.error('Failed to send challenge', { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        className="relative w-full max-w-md bg-background border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Swords className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold">Challenge to a Duel</p>
              <p className="text-xs text-muted-foreground">@{opponentUsername}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-secondary transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {/* Duel type selection */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Select Type</p>
            {DUEL_TYPES.map(({ id, label, icon: Icon, color, bg, activeBg, description }) => {
              const active = selectedType === id;
              return (
                <button
                  key={id}
                  onClick={() => setSelectedType(id)}
                  className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                    active ? `${activeBg} text-white` : `${bg} hover:opacity-80`
                  }`}
                >
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${active ? 'text-white' : color}`} />
                  <div>
                    <p className={`text-sm font-semibold ${active ? 'text-white' : ''}`}>{label}</p>
                    <p className={`text-xs mt-0.5 ${active ? 'text-white/80' : 'text-muted-foreground'}`}>{description}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Mirror — show which session will be used */}
          {selectedType === 'mirror' && (
            <div className="rounded-xl bg-secondary/50 border border-border p-3">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Session Template</p>
              {recentSession ? (
                <p className="text-sm font-medium">{recentSession.regimen_name || 'Last workout'}</p>
              ) : (
                <p className="text-xs text-muted-foreground italic">No recent session found — opponent will see a blank template.</p>
              )}
            </div>
          )}

          {/* Window hours */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Time Window</p>
            <div className="flex gap-2">
              {[12, 24, 48, 72].map(h => (
                <button
                  key={h}
                  onClick={() => setWindowHours(h)}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all ${
                    windowHours === h
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:border-primary/40'
                  }`}
                >
                  {h}h
                </button>
              ))}
            </div>
          </div>

          {/* Send button */}
          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Swords className="w-4 h-4" />
                Send Challenge
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
