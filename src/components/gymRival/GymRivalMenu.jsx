// src/components/gymRival/GymRivalMenu.jsx
//
// Full-screen Gym Rival menu. Opened from the Workout-page card. On first
// view of a new rival it plays a subtle reveal animation ("who am I facing
// this week?"), then shows the live head-to-head net-rating comparison
// (volume + workouts + distance), the week countdown, and the prize.

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Target, Swords, RefreshCw, Loader2, Dumbbell, Flame, Footprints, Trophy, Coins, Package } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  getRivalProfile, getWeeklyRivalStats, msUntilWeekEnd, computeRivalReward,
} from '@/lib/data/gymRival';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { formatDistance } from '@/lib/distanceUnit';
import { useNumberFormatter } from '@/lib/intl';

const revealedKey = (id) => `flexyn.gymRival.revealed.${id}`;

function fmtCountdown(ms) {
  if (ms <= 0) return 'Week over';
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

function Avatar({ profile, size = 'w-20 h-20', ring = 'ring-rose-500/40' }) {
  const name = profile?.username || '';
  return profile?.avatar_url ? (
    <img loading="lazy" src={profile.avatar_url} alt={name}
      className={`${size} rounded-full object-cover ring-2 ${ring} shrink-0`} />
  ) : (
    <div className={`${size} rounded-full bg-rose-500/20 ring-2 ${ring} flex items-center justify-center shrink-0`}>
      <span className="text-2xl font-black text-rose-500">{name[0]?.toUpperCase() || '?'}</span>
    </div>
  );
}

function StatRow({ icon: Icon, label, userVal, rivalVal, userWins }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <span className={`flex-1 text-end text-sm font-bold tabular-nums ${userWins === true ? 'text-emerald-500' : 'text-foreground'}`}>{userVal}</span>
      <span className="flex items-center gap-1 w-28 justify-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0">
        <Icon className="w-3 h-3" /> {label}
      </span>
      <span className={`flex-1 text-start text-sm font-bold tabular-nums ${userWins === false ? 'text-emerald-500' : 'text-foreground'}`}>{rivalVal}</span>
    </div>
  );
}

export default function GymRivalMenu({ open, onClose, assignment, currentUserId, onReroll, rerolling, onChallenge }) {
  const navigate = useNavigate();
  const { distanceUnit } = useDistanceUnit();
  const fmt = useNumberFormatter();
  const rivalId = assignment?.rival_id;

  const { data: rival } = useQuery({
    queryKey: ['gymRivalProfile', rivalId],
    queryFn:  () => getRivalProfile(rivalId),
    enabled:  open && !!rivalId,
    staleTime: 5 * 60_000,
  });
  const { data: me } = useQuery({
    queryKey: ['gymRivalProfile', currentUserId],
    queryFn:  () => getRivalProfile(currentUserId),
    enabled:  open && !!currentUserId,
    staleTime: 5 * 60_000,
  });
  const { data: stats } = useQuery({
    queryKey: ['gymRivalStats', currentUserId, rivalId],
    queryFn:  () => getWeeklyRivalStats(currentUserId, rivalId),
    enabled:  open && !!currentUserId && !!rivalId,
    staleTime: 60_000,
  });

  // Reveal once per assignment. Read the flag FRESH each time the menu
  // opens (the component instance persists across open/close, so a memo
  // would go stale). Plays only once the rival profile has loaded so the
  // avatar can un-blur into place.
  const [stage, setStage] = useState('done'); // 'searching' | 'revealing' | 'done'

  useEffect(() => {
    if (!open || !rival || !assignment?.id) return;
    let revealed = false;
    try { revealed = !!localStorage.getItem(revealedKey(assignment.id)); } catch { /* ignore */ }
    if (revealed) { setStage('done'); return; }

    setStage('searching');
    const t1 = setTimeout(() => setStage('revealing'), 1400);
    const t2 = setTimeout(() => {
      setStage('done');
      try { localStorage.setItem(revealedKey(assignment.id), '1'); } catch { /* ignore */ }
    }, 2900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [open, rival, assignment?.id]);

  // Live countdown.
  const [nowTick, setNowTick] = useState(() => 0);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [open]);
  const countdown = useMemo(() => fmtCountdown(msUntilWeekEnd()), [nowTick, open]);

  if (!open) return null;

  const u = stats?.user;
  const r = stats?.rival;
  const userLeads = u && r ? (u.netRating === r.netRating ? null : u.netRating > r.netRating) : null;
  const reward = computeRivalReward(me?.current_level, rival?.current_level);

  const dist = (m) => formatDistance(m || 0, distanceUnit, m >= 1000 ? 1 : 2);

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] bg-background overflow-y-auto"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 h-14 bg-background/90 backdrop-blur-md border-b border-border">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-rose-500" />
            <h2 className="font-heading font-black text-base">Gym Rival</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-secondary transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="max-w-lg mx-auto px-4 pt-6 pb-24">
          <AnimatePresence mode="wait">
            {stage !== 'done' ? (
              // ── Reveal ──────────────────────────────────────────────
              <motion.div
                key="reveal"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }}
                className="min-h-[60vh] flex flex-col items-center justify-center text-center"
              >
                <motion.div
                  animate={stage === 'searching' ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                  transition={{ duration: 1.1, repeat: stage === 'searching' ? Infinity : 0 }}
                  className="relative mb-6"
                >
                  <div className="absolute inset-0 rounded-full blur-2xl bg-rose-500/30" />
                  <div className="relative">
                    {stage === 'searching' ? (
                      <div className="w-24 h-24 rounded-full border-2 border-dashed border-rose-500/50 flex items-center justify-center">
                        <Target className="w-10 h-10 text-rose-500" />
                      </div>
                    ) : (
                      <motion.div
                        initial={{ filter: 'blur(14px)', scale: 0.8, opacity: 0.4 }}
                        animate={{ filter: 'blur(0px)', scale: 1, opacity: 1 }}
                        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <Avatar profile={rival} size="w-24 h-24" />
                      </motion.div>
                    )}
                  </div>
                </motion.div>

                {stage === 'searching' ? (
                  <motion.p
                    animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.4, repeat: Infinity }}
                    className="text-sm font-bold text-muted-foreground"
                  >
                    Finding your Gym Rival for this week…
                  </motion.p>
                ) : (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-rose-500 mb-1">Your rival this week</p>
                    <p className="font-heading font-black text-2xl">@{rival?.username || '—'}</p>
                    <p className="text-xs text-muted-foreground mt-1">Level {rival?.current_level ?? '—'}</p>
                  </motion.div>
                )}
              </motion.div>
            ) : (
              // ── Comparison ──────────────────────────────────────────
              <motion.div key="compare" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                {/* Versus header */}
                <div className="flex items-stretch justify-between gap-3 mb-5">
                  <div className="flex-1 flex flex-col items-center text-center">
                    <Avatar profile={me} ring="ring-emerald-500/40" />
                    <p className="mt-2 text-sm font-black truncate max-w-full">You</p>
                    <p className="text-[10px] text-muted-foreground">Lv {me?.current_level ?? '—'}</p>
                  </div>
                  <div className="flex flex-col items-center justify-center shrink-0">
                    <span className="font-heading font-black text-lg text-muted-foreground">VS</span>
                    <Swords className="w-4 h-4 text-rose-500 mt-1" />
                    <span className="mt-1 text-[10px] font-bold text-muted-foreground text-center tabular-nums whitespace-nowrap">{countdown}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => rival?.id && navigate(`/hub?profile=${encodeURIComponent(rival.id)}`)}
                    className="flex-1 flex flex-col items-center text-center"
                  >
                    <Avatar profile={rival} />
                    <p className="mt-2 text-sm font-black truncate max-w-full">@{rival?.username || '—'}</p>
                    <p className="text-[10px] text-muted-foreground">Lv {rival?.current_level ?? '—'}</p>
                  </button>
                </div>

                {/* Net rating */}
                <div className="rounded-2xl border border-border bg-card p-4 mb-4">
                  <p className="text-center text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-2">Net Rating</p>
                  <div className="flex items-center justify-center gap-4">
                    <span className={`font-heading font-black text-4xl tabular-nums ${userLeads === true ? 'text-emerald-500' : 'text-foreground'}`}>{u ? fmt(u.netRating) : '—'}</span>
                    <span className="text-muted-foreground font-bold">—</span>
                    <span className={`font-heading font-black text-4xl tabular-nums ${userLeads === false ? 'text-emerald-500' : 'text-foreground'}`}>{r ? fmt(r.netRating) : '—'}</span>
                  </div>
                  <p className="text-center text-xs font-bold mt-2">
                    {userLeads === null ? <span className="text-muted-foreground">Dead even — keep training.</span>
                      : userLeads ? <span className="text-emerald-500">You're winning 🔥</span>
                      : <span className="text-rose-500">You're behind — catch up!</span>}
                  </p>
                </div>

                {/* Component breakdown */}
                <div className="rounded-2xl border border-border bg-card px-4 py-2 mb-4 divide-y divide-border/60">
                  <div className="flex items-center gap-2 pb-1">
                    <span className="flex-1 text-end text-[10px] font-black uppercase tracking-wider text-emerald-500">You</span>
                    <span className="w-28" />
                    <span className="flex-1 text-start text-[10px] font-black uppercase tracking-wider text-rose-500">Rival</span>
                  </div>
                  <StatRow icon={Dumbbell} label="Volume" userVal={u ? `${fmt(Math.round(u.volume))}` : '—'} rivalVal={r ? `${fmt(Math.round(r.volume))}` : '—'} userWins={u && r ? (u.volume === r.volume ? null : u.volume > r.volume) : null} />
                  <StatRow icon={Flame} label="Workouts" userVal={u ? u.sessions : '—'} rivalVal={r ? r.sessions : '—'} userWins={u && r ? (u.sessions === r.sessions ? null : u.sessions > r.sessions) : null} />
                  <StatRow icon={Footprints} label="Distance" userVal={u ? dist(u.distanceMeters) : '—'} rivalVal={r ? dist(r.distanceMeters) : '—'} userWins={u && r ? (u.distanceMeters === r.distanceMeters ? null : u.distanceMeters > r.distanceMeters) : null} />
                </div>

                {/* Prize */}
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 mb-5">
                  <div className="flex items-center gap-1.5 mb-3">
                    <Trophy className="w-4 h-4 text-amber-500" />
                    <p className="text-[11px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">Winner's prize</p>
                    {reward.levelGap > 0 && (
                      <span className="ms-auto text-[10px] font-bold text-amber-600 dark:text-amber-400">+{Math.round((reward.multiplier - 1) * 100)}% (higher-level rival)</span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <Trophy className="w-4 h-4 text-amber-500 mx-auto mb-1" />
                      <p className="font-heading font-black text-base tabular-nums">{fmt(reward.xp)}</p>
                      <p className="text-[10px] text-muted-foreground">XP</p>
                    </div>
                    <div>
                      <Coins className="w-4 h-4 text-amber-500 mx-auto mb-1" />
                      <p className="font-heading font-black text-base tabular-nums">{fmt(reward.coins)}</p>
                      <p className="text-[10px] text-muted-foreground">Coins</p>
                    </div>
                    <div>
                      <Package className="w-4 h-4 text-amber-500 mx-auto mb-1" />
                      <p className="font-heading font-black text-base tabular-nums">{reward.capsules}</p>
                      <p className="text-[10px] text-muted-foreground">Capsules</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-3 text-center">Higher net rating when the week ends takes the prize.</p>
                </div>

                {/* Actions */}
                <div className="space-y-2">
                  <button
                    onClick={onChallenge}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-rose-500 text-white font-black text-sm hover:bg-rose-600 active:scale-[0.98] transition-all"
                  >
                    <Swords className="w-4 h-4" /> Challenge @{rival?.username || 'rival'} to a duel
                  </button>
                  <button
                    onClick={onReroll}
                    disabled={rerolling}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50 transition-colors"
                  >
                    {rerolling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {rerolling ? 'Finding someone…' : 'Reroll rival'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
