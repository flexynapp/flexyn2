// src/components/crews/CrewMessageItem.jsx
//
// Renders one crew_message row based on message_type:
//   text         — standard chat bubble
//   xp_fuel      — system banner
//   roll_call    — interactive poll card
//   regimen      — shareable regimen card with Equip button
//   image_one_time — tap-to-view; local state blocks re-view
//   image_one_hour — normal photo (filtered by expires_at server-side)

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, ThumbsUp, ThumbsDown, Dumbbell, Eye, EyeOff, Loader2, Check } from 'lucide-react';
import { isVerified } from '@/lib/verifiedUsers';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import * as crewsData from '@/lib/data/crews';

function Avatar({ profile }) {
  const initials = (profile?.username || '?').slice(0, 2).toUpperCase();
  const verified = isVerified(profile?.username);
  return (
    <div className="relative shrink-0">
      {profile?.avatar_url ? (
        <img src={profile.avatar_url} className="w-8 h-8 rounded-full object-cover" alt="" draggable={false} />
      ) : (
        <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground">
          {initials}
        </div>
      )}
      {verified && (
        <div
          className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center ring-2 ring-background"
          style={{ background: 'hsl(var(--primary))' }}
        >
          <Check className="w-2.5 h-2.5 text-white stroke-[3]" />
        </div>
      )}
    </div>
  );
}

function Timestamp({ dateStr }) {
  if (!dateStr) return null;
  try {
    return (
      <span className="text-[10px] text-muted-foreground/60 mt-0.5 block">
        {formatDistanceToNow(new Date(dateStr), { addSuffix: true })}
      </span>
    );
  } catch { return null; }
}

// ── Text bubble ───────────────────────────────────────────────────────────────

function TextMessage({ msg, senderProfile, isOwn }) {
  const lastTapRef = useRef(0);
  const [reacted, setReacted] = useState(false);
  const [animating, setAnimating] = useState(false);

  const handleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 320) {
      setAnimating(true);
      setTimeout(() => {
        setAnimating(false);
        setReacted(true);
      }, 500);
    }
    lastTapRef.current = now;
  };

  return (
    <div className={`flex gap-2 items-end ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isOwn && <Avatar profile={senderProfile} />}
      <div className={`max-w-[72%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
        {!isOwn && (
          <span className="text-[10px] font-semibold text-muted-foreground mb-0.5 ml-1">
            @{senderProfile?.username || 'member'}
          </span>
        )}
        <div className="relative">
          <div
            onClick={handleTap}
            className={`relative px-3.5 py-2.5 rounded-2xl text-sm leading-snug select-none cursor-default ${
              isOwn
                ? 'text-white rounded-br-sm'
                : 'bg-secondary text-foreground rounded-bl-sm'
            }`}
            style={isOwn ? { background: 'hsl(var(--primary))' } : {}}
          >
            {msg.content}
          </div>

          {/* Fire reaction — floats up on double-tap, then sticks as badge */}
          <AnimatePresence>
            {animating && (
              <motion.span
                key="float"
                initial={{ opacity: 0, scale: 0.6, y: 0 }}
                animate={{ opacity: 1, scale: 1.5, y: -20 }}
                exit={{ opacity: 0, scale: 0.8, y: -36 }}
                transition={{ duration: 0.45 }}
                className={`absolute -bottom-1 text-base pointer-events-none ${isOwn ? 'left-0' : 'right-0'}`}
              >
                🔥
              </motion.span>
            )}
          </AnimatePresence>

          {/* Persistent reaction badge */}
          {reacted && !animating && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className={`absolute -bottom-2.5 ${isOwn ? '-left-1' : '-right-1'} bg-card border border-border rounded-full px-1.5 py-0.5 text-xs shadow-sm flex items-center gap-0.5 cursor-pointer`}
              onClick={() => setReacted(false)}
              title="Tap to remove"
            >
              🔥
            </motion.div>
          )}
        </div>
        <Timestamp dateStr={msg.created_at} />
      </div>
    </div>
  );
}

// ── XP Fuel banner ────────────────────────────────────────────────────────────

function XpFuelMessage({ msg, currentUserId, crewId }) {
  const [claiming, setClaiming] = useState(false);
  const [claimed,  setClaimed]  = useState(false);

  let parsed = {};
  try { parsed = JSON.parse(msg.content || '{}'); } catch {}
  const { username = 'A member', xp = 500 } = parsed;

  const handleClaim = async () => {
    if (claiming || claimed) return;
    setClaiming(true);
    try {
      const wasNew = await crewsData.claimXpFuel(msg.id, currentUserId);
      if (wasNew) {
        // Award XP via existing RPC
        const { supabase } = await import('@/api/supabaseClient');
        await supabase.rpc('increment_user_xp', { p_user_id: currentUserId, p_amount: xp }).catch(() => {});
        toast.success(`+${xp} XP added to your account!`);
      } else {
        toast('You already claimed this fuel.');
      }
      setClaimed(true);
    } catch {
      toast.error('Could not claim XP — try again.');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="flex justify-center my-3">
      <div className="rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 max-w-xs w-full text-center">
        <div className="flex items-center justify-center gap-1.5 mb-1">
          <Zap className="w-4 h-4 text-primary fill-primary" />
          <span className="text-sm font-bold text-primary">XP Fuel</span>
        </div>
        <p className="text-xs text-foreground leading-snug mb-2.5">
          <span className="font-semibold">@{username}</span> just fueled the Crew with <span className="font-bold text-primary">{xp} XP!</span>
        </p>
        {!claimed ? (
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleClaim}
            disabled={claiming}
            className="px-4 py-1.5 rounded-full text-xs font-bold text-white disabled:opacity-60 flex items-center gap-1.5 mx-auto"
            style={{ background: 'hsl(var(--primary))' }}
          >
            {claiming && <Loader2 className="w-3 h-3 animate-spin" />}
            Claim +{xp} XP
          </motion.button>
        ) : (
          <div className="flex items-center justify-center gap-1 text-xs font-semibold text-muted-foreground">
            <Check className="w-3.5 h-3.5" /> Claimed
          </div>
        )}
      </div>
    </div>
  );
}

// ── Roll Call ─────────────────────────────────────────────────────────────────

function RollCallMessage({ msg, currentUserId, crewId }) {
  const question = msg.content || 'Did you work out today?';

  const { data: results, refetch } = useQuery({
    queryKey: ['rollCall', msg.id],
    queryFn:  () => crewsData.getRollCallResults(msg.id),
    refetchInterval: 8000,
    staleTime: 3000,
  });

  const [myVote, setMyVote] = useState(() => {
    if (!results) return null;
    return results.votes.find(v => v.user_id === currentUserId)?.vote ?? null;
  });

  const total = (results?.yes ?? 0) + (results?.no ?? 0);
  const yesPct = total > 0 ? Math.round(((results?.yes ?? 0) / total) * 100) : 0;
  const noPct  = total > 0 ? Math.round(((results?.no  ?? 0) / total) * 100) : 0;

  const handleVote = async (vote) => {
    if (myVote === vote) return;
    setMyVote(vote);
    await crewsData.respondToRollCall(msg.id, currentUserId, vote).catch(() => {});
    refetch();
  };

  return (
    <div className="flex justify-center my-3 px-2">
      <div className="rounded-2xl border border-border bg-card px-4 py-3.5 max-w-xs w-full shadow-sm">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
          📣 Roll Call
        </p>
        <p className="text-sm font-semibold text-foreground mb-3 leading-snug">{question}</p>

        {/* Tally bars */}
        {total > 0 && (
          <div className="space-y-1.5 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground w-16">👍 Yes</span>
              <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-green-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${yesPct}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground w-8 text-right">{results?.yes ?? 0}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground w-16">👎 No</span>
              <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-red-400"
                  initial={{ width: 0 }}
                  animate={{ width: `${noPct}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground w-8 text-right">{results?.no ?? 0}</span>
            </div>
          </div>
        )}

        {/* Vote buttons */}
        <div className="flex gap-2">
          <motion.button
            whileTap={{ scale: 0.93 }}
            onClick={() => handleVote('yes')}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 border transition-colors ${
              myVote === 'yes' ? 'bg-green-500 border-green-500 text-white' : 'border-border text-foreground hover:border-green-400'
            }`}
          >
            <ThumbsUp className="w-3.5 h-3.5" /> Yes
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.93 }}
            onClick={() => handleVote('no')}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 border transition-colors ${
              myVote === 'no' ? 'bg-red-400 border-red-400 text-white' : 'border-border text-foreground hover:border-red-400'
            }`}
          >
            <ThumbsDown className="w-3.5 h-3.5" /> No
          </motion.button>
        </div>
      </div>
    </div>
  );
}

// ── Shared Regimen ────────────────────────────────────────────────────────────

function RegimenMessage({ msg, user, senderProfile }) {
  const [state, setState] = useState('idle');
  let meta = {};
  try { meta = JSON.parse(msg.content || '{}'); } catch {}

  const handleEquip = async () => {
    if (state !== 'idle' || !msg.regimen_id) return;
    setState('equipping');
    try {
      await crewsData.equipRegimen(msg.regimen_id, user);
      setState('equipped');
      toast.success(`"${meta.name || 'Regimen'}" added to your routines!`);
    } catch {
      toast.error('Could not equip regimen — try again.');
      setState('idle');
    }
  };

  return (
    <div className="flex justify-center my-2 px-2">
      <div className="rounded-2xl border border-border bg-card px-4 py-3.5 max-w-xs w-full shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Dumbbell className="w-4 h-4 text-primary shrink-0" />
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Shared Regimen</p>
        </div>
        <p className="text-sm font-bold text-foreground mb-0.5">{meta.name || 'Untitled Regimen'}</p>
        <p className="text-xs text-muted-foreground mb-2">{meta.exercise_count ?? 0} exercises</p>

        {(meta.preview_exercises || []).slice(0, 3).map((ex, i) => (
          <p key={i} className="text-[11px] text-muted-foreground truncate leading-tight">
            • {ex}
          </p>
        ))}

        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={handleEquip}
          disabled={state !== 'idle'}
          className="mt-3 w-full py-2 rounded-xl text-sm font-bold text-white disabled:opacity-60 flex items-center justify-center gap-1.5"
          style={{ background: 'hsl(var(--primary))' }}
        >
          {state === 'equipping' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {state === 'equipped'  && <Check   className="w-3.5 h-3.5" />}
          {state === 'idle' ? 'Equip Regimen' : state === 'equipping' ? 'Equipping…' : 'Equipped!'}
        </motion.button>
      </div>
    </div>
  );
}

// ── One-Time Image ────────────────────────────────────────────────────────────

function OneTimeImageMessage({ msg, senderProfile, isOwn }) {
  const [viewed, setViewed] = useState(false);
  const [open,   setOpen]   = useState(false);

  const handleView = () => {
    if (viewed) return;
    setOpen(true);
    setViewed(true);
  };

  return (
    <div className={`flex gap-2 items-end ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isOwn && <Avatar profile={senderProfile} />}
      <div>
        {!isOwn && (
          <span className="text-[10px] font-semibold text-muted-foreground mb-0.5 ml-1 block">
            @{senderProfile?.username || 'member'}
          </span>
        )}
        <button
          onClick={handleView}
          className="relative overflow-hidden rounded-2xl w-40 h-40 bg-secondary flex items-center justify-center border border-border"
        >
          {!viewed ? (
            <div className="flex flex-col items-center gap-1 text-muted-foreground">
              <Eye className="w-6 h-6" />
              <span className="text-[10px] font-medium">Tap to view once</span>
            </div>
          ) : open ? (
            <>
              <img src={msg.media_url} className="w-full h-full object-cover" alt="one-time" draggable={false} />
              <button
                onClick={e => { e.stopPropagation(); setOpen(false); }}
                className="absolute inset-0 bg-transparent"
              />
            </>
          ) : (
            <div className="flex flex-col items-center gap-1 text-muted-foreground/50">
              <EyeOff className="w-6 h-6" />
              <span className="text-[10px]">Viewed</span>
            </div>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Timed Image ───────────────────────────────────────────────────────────────

function TimedImageMessage({ msg, senderProfile, isOwn }) {
  return (
    <div className={`flex gap-2 items-end ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isOwn && <Avatar profile={senderProfile} />}
      <div className="relative overflow-hidden rounded-2xl max-w-[200px]">
        {!isOwn && (
          <span className="text-[10px] font-semibold text-muted-foreground mb-0.5 ml-1 block">
            @{senderProfile?.username || 'member'}
          </span>
        )}
        <img src={msg.media_url} className="rounded-2xl w-full" alt="" draggable={false} />
        <div className="absolute top-2 right-2 bg-black/60 rounded-full px-2 py-0.5 text-[10px] text-white font-semibold">
          1h
        </div>
      </div>
    </div>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────

export default function CrewMessageItem({ msg, senderProfile, currentUserId, user, crewId }) {
  const isOwn = msg.sender_id === currentUserId;

  switch (msg.message_type) {
    case 'xp_fuel':
      return <XpFuelMessage msg={msg} currentUserId={currentUserId} crewId={crewId} />;
    case 'roll_call':
      return <RollCallMessage msg={msg} currentUserId={currentUserId} crewId={crewId} />;
    case 'regimen':
      return <RegimenMessage msg={msg} user={user} senderProfile={senderProfile} />;
    case 'image_one_time':
      return <OneTimeImageMessage msg={msg} senderProfile={senderProfile} isOwn={isOwn} />;
    case 'image_one_hour':
      return <TimedImageMessage msg={msg} senderProfile={senderProfile} isOwn={isOwn} />;
    default:
      return <TextMessage msg={msg} senderProfile={senderProfile} isOwn={isOwn} />;
  }
}
