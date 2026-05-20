// src/components/nemesis/NemesisCard.jsx
// Dashboard card showing the user's auto-assigned nemesis + weekly comparison bars.

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Target, TrendingUp, Flame, Dumbbell, ChevronRight, RefreshCw, Loader2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMyNemesis, getNemesisProfile, getWeeklyComparison, assignNemesis } from '@/lib/data/nemesis';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

function CompareBar({ label, myVal, theirVal, unit = '' }) {
  const total  = (myVal + theirVal) || 1;
  const myPct  = Math.min((myVal / total) * 100, 100);
  const winning = myVal >= theirVal;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span className={winning ? 'text-primary font-semibold' : ''}>
          {myVal.toLocaleString()}{unit} vs {theirVal.toLocaleString()}{unit}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden flex">
        <motion.div
          className={`h-full rounded-full ${winning ? 'bg-primary' : 'bg-rose-500'}`}
          initial={{ width: 0 }}
          animate={{ width: `${myPct}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

export default function NemesisCard({ currentUserId }) {
  const navigate = useNavigate();
  const qc       = useQueryClient();

  const { data: assignment, isLoading: assignLoading } = useQuery({
    queryKey:  ['myNemesis', currentUserId],
    queryFn:   getMyNemesis,
    enabled:   !!currentUserId,
    staleTime: 5 * 60_000,
  });

  const { data: nemesisProfile } = useQuery({
    queryKey:  ['nemesisProfile', assignment?.nemesis_id],
    queryFn:   () => getNemesisProfile(assignment?.nemesis_id),
    enabled:   !!assignment?.nemesis_id,
    staleTime: 5 * 60_000,
  });

  const { data: comparison } = useQuery({
    queryKey:  ['weeklyComparison', currentUserId, assignment?.nemesis_id],
    queryFn:   () => getWeeklyComparison(currentUserId, assignment?.nemesis_id),
    enabled:   !!currentUserId && !!assignment?.nemesis_id,
    staleTime: 5 * 60_000,
  });

  const assignMut = useMutation({
    mutationFn: assignNemesis,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['myNemesis'] });
      qc.invalidateQueries({ queryKey: ['weeklyComparison'] });
    },
  });

  if (assignLoading) return null;

  // No nemesis yet — show assign prompt
  if (!assignment) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-dashed border-border p-4 mb-4 text-center"
      >
        <Target className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm font-semibold text-muted-foreground">No Nemesis Assigned</p>
        <p className="text-xs text-muted-foreground/60 mt-1 mb-3">
          We'll find a rival slightly above your level
        </p>
        <button
          onClick={() => assignMut.mutate()}
          disabled={assignMut.isPending}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {assignMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
          Find My Nemesis
        </button>
      </motion.div>
    );
  }

  const name    = nemesisProfile?.username || '—';
  const avatar  = nemesisProfile?.avatar_url;
  const xpGap   = (nemesisProfile?.total_xp || 0) - 0; // user XP comes from parent

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-rose-500/20 bg-rose-500/3 overflow-hidden mb-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-rose-500/10">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-rose-500" />
          <span className="text-xs font-black uppercase tracking-wider text-rose-500">Your Nemesis</span>
        </div>
        <button
          onClick={() => assignMut.mutate()}
          disabled={assignMut.isPending}
          className="p-1.5 rounded-full hover:bg-secondary transition-colors"
          title="Reassign nemesis"
        >
          {assignMut.isPending
            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            : <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
          }
        </button>
      </div>

      {/* Nemesis identity */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/20 transition-colors"
        onClick={() => navigate(`/profile/${assignment.nemesis_id}`)}
      >
        {avatar ? (
          <img src={avatar} className="w-10 h-10 rounded-full object-cover" alt={name} />
        ) : (
          <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center">
            <span className="text-sm font-black text-rose-500">{name[0]?.toUpperCase()}</span>
          </div>
        )}
        <div className="flex-1">
          <p className="text-sm font-bold">@{name}</p>
          <p className="text-xs text-muted-foreground">
            Lv {nemesisProfile?.current_level || '?'} · {(nemesisProfile?.total_xp || 0).toLocaleString()} XP
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </button>

      {/* Weekly comparison bars */}
      {comparison && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">This Week</p>
          <CompareBar
            label="Volume"
            myVal={comparison.user.volume}
            theirVal={comparison.nemesis.volume}
            unit=" lbs"
          />
          <CompareBar
            label="Sessions"
            myVal={comparison.user.sessions}
            theirVal={comparison.nemesis.sessions}
          />
        </div>
      )}

      {/* Overthrow count */}
      {(nemesisProfile?.overthrow_count > 0) && (
        <div className="px-4 pb-3">
          <p className="text-[10px] text-muted-foreground text-center">
            You've overthrown <span className="font-bold text-rose-500">{nemesisProfile.overthrow_count}</span> nemeses
          </p>
        </div>
      )}
    </motion.div>
  );
}
