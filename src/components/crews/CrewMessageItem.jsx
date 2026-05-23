// src/components/crews/CrewMessageItem.jsx
//
// Renders one crew_message row based on message_type:
//   text         — standard chat bubble
//   xp_fuel      — system banner
//   roll_call    — interactive poll card
//   regimen      — shareable regimen card with Equip button
//   image_one_time — tap-to-view; local state blocks re-view
//   image_one_hour — normal photo (filtered by expires_at server-side)

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, ThumbsUp, ThumbsDown, Dumbbell, Eye, EyeOff, Loader2, Check } from 'lucide-react';
import { isVerified } from '@/lib/verifiedUsers';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import * as crewsData from '@/lib/data/crews';
import * as crewRxns from '@/lib/data/crewMessageReactions';
import { supabase } from '@/api/supabaseClient';
import { triggerHaptic } from '@/lib/haptic';
import { playSound, SOUND } from '@/lib/playSound';

// Quick emoji strip in long-press context menu (same set as DM reactions)
const QUICK_EMOJIS = ['👍', '❤️', '😂', '🔥', '😮'];

// Graceful fire-reaction write — falls back silently if table not yet migrated.
// Uses `emoji` column (migration 130). Previously used `reaction` — table
// didn't exist in production, so the column name change is safe.
async function writeFireReaction(msgId, userId, active) {
  if (!msgId || !userId) return;
  try {
    if (active) {
      await supabase
        .from('crew_message_reactions')
        .upsert(
          { message_id: msgId, user_id: userId, emoji: '🔥' },
          { onConflict: 'message_id,user_id,emoji', ignoreDuplicates: false }
        );
    } else {
      await supabase
        .from('crew_message_reactions')
        .delete()
        .eq('message_id', msgId)
        .eq('user_id', userId)
        .eq('emoji', '🔥');
    }
  } catch {
    // Table may not exist yet — localStorage already covers local state
  }
}

// ── Admin crown badge ─────────────────────────────────────────────────────────
function CrownBadge({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 14" fill="none" aria-label="Admin" title="Verified Admin">
      <path d="M1 12h14M2 12L1 4l4 3.5L8 1l3 6.5L15 4l-1 8H2z" fill="#f97316" stroke="#ea6c00" strokeWidth="0.8" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Bubble color palette per sender (soft, non-intrusive tints) ────────────────
const BUBBLE_PALETTE = [
  'rgba(13,202,240,0.10)',   // teal
  'rgba(34,197,94,0.10)',    // green
  'rgba(168,85,247,0.10)',   // purple
  'rgba(251,191,36,0.10)',   // amber
  'rgba(239,68,68,0.08)',    // red
  'rgba(99,102,241,0.10)',   // indigo
];
function senderBubbleColor(senderId) {
  if (!senderId) return '';
  let h = 0;
  for (let i = 0; i < senderId.length; i++) h = (h * 31 + senderId.charCodeAt(i)) >>> 0;
  return BUBBLE_PALETTE[h % BUBBLE_PALETTE.length];
}

// ── One-time view localStorage helpers (keyed by msg+user) ───────────────────
const otKey  = (msgId, userId) => `ot_viewed_${msgId}_${userId}`;
const isOtViewed = (msgId, userId) => {
  try { return localStorage.getItem(otKey(msgId, userId)) === '1'; } catch { return false; }
};
const markOtViewed = (msgId, userId) => {
  try { localStorage.setItem(otKey(msgId, userId), '1'); } catch {}
};

const fireKey = (id) => `fire_${id}`;
const loadFire = (id) => { try { return localStorage.getItem(fireKey(id)) === '1'; } catch { return false; } };
const saveFire = (id, val) => { try { val ? localStorage.setItem(fireKey(id), '1') : localStorage.removeItem(fireKey(id)); } catch {} };

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
        <div className="absolute -top-1.5 -left-1.5" style={{ lineHeight: 0, transform: 'rotate(-25deg)' }}>
          <CrownBadge size={13} />
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

function TextMessage({ msg, senderProfile, isOwn, currentUserId, isCurrentModerator, onPin }) {
  const qc = useQueryClient();
  const lastTapRef = useRef(0);
  const longPressTimer = useRef(null);
  const [reacted, setReacted] = useState(() => loadFire(msg.id));
  const [animating, setAnimating] = useState(false);
  const [showContext, setShowContext] = useState(false);
  // Optimistic emoji reactions state: { [emoji]: { count, myReacted } }
  const [optimisticRxns, setOptimisticRxns] = useState(null);
  const tint = isOwn ? '' : senderBubbleColor(msg.sender_id);

  // Fetch reactions from DB — keyed per message so all instances share the cache.
  const { data: rxnData } = useQuery({
    queryKey: ['crewMsgRxns', msg.id],
    queryFn: async () => {
      const map = await crewRxns.getReactionsForMessages([msg.id]);
      return map[msg.id] || [];
    },
    enabled: !String(msg.id).startsWith('temp-'),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  // Merge DB data with any in-flight optimistic state
  const rxnList = optimisticRxns !== null ? optimisticRxns : (rxnData || []);

  // Group by emoji for display
  const rxnGroups = (() => {
    const groups = {};
    for (const r of rxnList) {
      if (!groups[r.emoji]) groups[r.emoji] = { count: 0, myReacted: false };
      groups[r.emoji].count++;
      if (r.user_id === currentUserId) groups[r.emoji].myReacted = true;
    }
    return Object.entries(groups).map(([emoji, g]) => ({ emoji, ...g }));
  })();

  const setReactedPersisted = (val) => {
    setReacted(val);
    saveFire(msg.id, val);
    writeFireReaction(msg.id, currentUserId, val);
  };

  const handleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 320) {
      setAnimating(true);
      setTimeout(() => {
        setAnimating(false);
        setReactedPersisted(true);
      }, 500);
    }
    lastTapRef.current = now;
  };

  const startLong = (e) => {
    longPressTimer.current = setTimeout(() => {
      triggerHaptic('primary');
      setShowContext(true);
    }, 480);
  };
  const cancelLong = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  const handlePinToggle = () => {
    setShowContext(false);
    onPin?.(msg.id);
  };

  // Emoji reaction toggle — optimistic + async persist
  const handleEmojiReact = useCallback(async (emoji) => {
    if (!currentUserId || String(msg.id).startsWith('temp-')) return;
    setShowContext(false);

    // Optimistic update
    const base = rxnData || [];
    const alreadyReacted = base.some(r => r.user_id === currentUserId && r.emoji === emoji);
    const updated = alreadyReacted
      ? base.filter(r => !(r.user_id === currentUserId && r.emoji === emoji))
      : [...base, { user_id: currentUserId, emoji }];
    setOptimisticRxns(updated);

    if (!alreadyReacted) {
      playSound(SOUND.capsuleOpen);
      triggerHaptic('primary');
    }

    try {
      await crewRxns.toggleReaction(msg.id, currentUserId, emoji);
      // Invalidate so the DB truth replaces the optimistic state
      qc.invalidateQueries({ queryKey: ['crewMsgRxns', msg.id] });
    } catch {
      // Revert on failure
      setOptimisticRxns(null);
    } finally {
      setOptimisticRxns(null);
    }
  }, [currentUserId, msg.id, rxnData, qc]);

  // Handle tapping a reaction bubble inline (toggle)
  const handleBubbleTap = useCallback((emoji) => {
    handleEmojiReact(emoji);
  }, [handleEmojiReact]);

  return (
    <>
      <div className={`flex gap-2 items-end ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
        {!isOwn && <Avatar profile={senderProfile} />}
        <div className={`max-w-[72%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
          {!isOwn && (
            <span className="text-[10px] font-semibold text-muted-foreground mb-0.5 ml-1">
              {senderProfile?.username || 'member'}
            </span>
          )}
          <div className="relative">
            <div
              onClick={handleTap}
              onMouseDown={startLong}
              onMouseUp={cancelLong}
              onMouseLeave={cancelLong}
              onTouchStart={startLong}
              onTouchEnd={cancelLong}
              onTouchMove={cancelLong}
              className={`relative px-3.5 py-2.5 rounded-2xl text-sm leading-snug select-none cursor-default ${
                isOwn ? 'text-white rounded-br-sm' : 'text-foreground rounded-bl-sm bg-secondary/60'
              }`}
              style={isOwn ? { background: 'hsl(var(--primary))' } : { background: tint, border: '1px solid hsl(var(--border) / 0.6)' }}
            >
              {msg.content}
            </div>

            {/* Fire reaction — floats up on double-tap */}
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

            {/* Legacy local fire badge (double-tap) — kept for offline feel */}
            {reacted && !animating && rxnGroups.findIndex(g => g.emoji === '🔥') === -1 && (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className={`absolute -bottom-2.5 ${isOwn ? '-left-1' : '-right-1'} bg-card border border-border rounded-full px-1.5 py-0.5 text-xs shadow-sm flex items-center gap-0.5 cursor-pointer`}
                onClick={() => setReactedPersisted(false)}
                title="Tap to remove"
              >
                🔥
              </motion.div>
            )}
          </div>

          {/* Emoji reaction bubbles — fetched from DB */}
          {rxnGroups.length > 0 && (
            <div className={`flex flex-wrap gap-1 mt-1.5 ${isOwn ? 'justify-end' : 'justify-start'}`}>
              {rxnGroups.map(({ emoji, count, myReacted }) => (
                <motion.button
                  key={emoji}
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                  onClick={() => handleBubbleTap(emoji)}
                  className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                    myReacted
                      ? 'bg-primary/20 border-primary/40 text-foreground'
                      : 'bg-card border-border text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  <span>{emoji}</span>
                  {count > 1 && <span className="font-medium tabular-nums">{count}</span>}
                </motion.button>
              ))}
            </div>
          )}

          <Timestamp dateStr={msg.created_at} />
        </div>
      </div>

      {/* Long-press context menu */}
      <AnimatePresence>
        {showContext && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center pb-6"
            onClick={() => setShowContext(false)}
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-card border border-border rounded-2xl overflow-hidden w-72 shadow-xl"
            >
              {/* Quick emoji strip */}
              <div className="flex items-center justify-around px-3 py-3 border-b border-border">
                {QUICK_EMOJIS.map(emoji => {
                  const myReacted = (rxnData || []).some(r => r.user_id === currentUserId && r.emoji === emoji);
                  return (
                    <button
                      key={emoji}
                      onClick={() => handleEmojiReact(emoji)}
                      className={`text-2xl p-1.5 rounded-xl transition-all ${myReacted ? 'bg-primary/20 scale-110' : 'hover:bg-secondary hover:scale-110'}`}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>

              {isCurrentModerator && (
                <button
                  onClick={handlePinToggle}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-secondary transition-colors"
                >
                  <span className="text-base">📌</span>
                  Pin as announcement
                </button>
              )}
              <button
                onClick={() => setShowContext(false)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors ${isCurrentModerator ? 'border-t border-border' : ''}`}
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
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
  // 'idle' | 'checking' | 'equipping' | 'equipped' | 'duplicate'
  const [state, setState] = useState('idle');
  let meta = {};
  try { meta = JSON.parse(msg.content || '{}'); } catch {}

  // Feature: Regimen Adoption Rate — live clone count
  const { data: cloneCount = 0 } = useQuery({
    queryKey: ['regimenCloneCount', msg.regimen_id],
    queryFn: () => crewsData.getRegimenCloneCount(msg.regimen_id),
    enabled: !!msg.regimen_id,
    staleTime: 30_000,
  });

  const handleEquip = async () => {
    if (state !== 'idle' || !msg.regimen_id) return;
    setState('checking');
    try {
      // Feature 19: block if the user already cloned this regimen template
      const alreadyHave = await crewsData.hasClonedRegimen(msg.regimen_id, user?.email);
      if (alreadyHave) {
        setState('duplicate');
        return;
      }
      setState('equipping');
      await crewsData.equipRegimen(msg.regimen_id, user);
      setState('equipped');
      toast.success(`"${meta.name || 'Regimen'}" added to your routines!`);
    } catch {
      toast.error('Could not equip regimen — try again.');
      setState('idle');
    }
  };

  const isDuplicate = state === 'duplicate';

  return (
    <div className="flex justify-center my-2 px-2">
      <div className="rounded-2xl border border-border bg-card px-4 py-3.5 max-w-xs w-full shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Dumbbell className="w-4 h-4 text-primary shrink-0" />
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Shared Regimen</p>
        </div>
        <p className="text-sm font-bold text-foreground mb-0.5">{meta.name || 'Untitled Regimen'}</p>
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs text-muted-foreground">{meta.exercise_count ?? 0} exercises</p>
          {cloneCount > 0 && (
            <span className="text-xs font-semibold text-primary flex items-center gap-0.5">
              · Cloned {cloneCount} {cloneCount === 1 ? 'time' : 'times'}
            </span>
          )}
        </div>

        {(meta.preview_exercises || []).slice(0, 3).map((ex, i) => (
          <p key={i} className="text-[11px] text-muted-foreground truncate leading-tight">
            • {ex}
          </p>
        ))}

        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={handleEquip}
          disabled={state !== 'idle'}
          className={`mt-3 w-full py-2 rounded-xl text-sm font-bold text-white disabled:opacity-60 flex items-center justify-center gap-1.5 ${
            isDuplicate ? 'bg-muted/60 text-muted-foreground cursor-not-allowed' : ''
          }`}
          style={isDuplicate ? {} : { background: 'hsl(var(--primary))' }}
        >
          {(state === 'checking' || state === 'equipping') && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {state === 'equipped' && <Check className="w-3.5 h-3.5" />}
          {state === 'idle'      ? 'Equip Regimen'
            : state === 'checking'  ? 'Checking…'
            : state === 'equipping' ? 'Equipping…'
            : state === 'duplicate' ? '✓ Already Copied'
            : 'Equipped!'}
        </motion.button>
      </div>
    </div>
  );
}

// ── One-Time Image ────────────────────────────────────────────────────────────

function OneTimeImageMessage({ msg, senderProfile, isOwn, currentUserId }) {
  // Viewed state is tracked per-user in localStorage so it survives remounts.
  const [viewed,   setViewed]   = useState(() => isOtViewed(msg.id, currentUserId));
  const [open,     setOpen]     = useState(false);
  const lastTapRef = useRef(0);
  const [reacted, setReacted] = useState(() => loadFire(msg.id));
  const [animating, setAnimating] = useState(false);

  const setReactedPersisted = (val) => { setReacted(val); saveFire(msg.id, val); };

  // When the overlay closes (or the component unmounts while open), commit the
  // viewed state to localStorage immediately so the media URL is blocked forever.
  useEffect(() => {
    return () => {
      if (viewed) markOtViewed(msg.id, currentUserId);
    };
  }, [viewed, msg.id, currentUserId]);

  const handleView = () => {
    if (viewed) return;
    setOpen(true);
    setViewed(true);
    markOtViewed(msg.id, currentUserId);
  };

  // Close the overlay and permanently commit viewed state
  const handleClose = (e) => {
    e?.stopPropagation();
    setOpen(false);
    markOtViewed(msg.id, currentUserId);
  };

  const handleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 320) {
      setAnimating(true);
      setTimeout(() => { setAnimating(false); setReactedPersisted(true); }, 500);
    }
    lastTapRef.current = now;
  };

  return (
    <div className={`flex gap-2 items-end ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isOwn && <Avatar profile={senderProfile} />}
      <div className={`${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
        {!isOwn && (
          <span className="text-[10px] font-semibold text-muted-foreground mb-0.5 ml-1 block">
            @{senderProfile?.username || 'member'}
          </span>
        )}
        <div className="relative" onClick={handleTap}>
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
                  onClick={handleClose}
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
          {reacted && !animating && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className={`absolute -bottom-2.5 ${isOwn ? '-left-1' : '-right-1'} bg-card border border-border rounded-full px-1.5 py-0.5 text-xs shadow-sm flex items-center gap-0.5 cursor-pointer`}
              onClick={() => setReactedPersisted(false)}
              title="Tap to remove"
            >
              🔥
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Timed Image ───────────────────────────────────────────────────────────────

function TimedImageMessage({ msg, senderProfile, isOwn }) {
  const lastTapRef = useRef(0);
  const [reacted, setReacted] = useState(() => loadFire(msg.id));
  const [animating, setAnimating] = useState(false);

  const setReactedPersisted = (val) => { setReacted(val); saveFire(msg.id, val); };

  const handleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 320) {
      setAnimating(true);
      setTimeout(() => { setAnimating(false); setReactedPersisted(true); }, 500);
    }
    lastTapRef.current = now;
  };

  return (
    <div className={`flex gap-2 items-end ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isOwn && <Avatar profile={senderProfile} />}
      <div className={`max-w-[200px] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
        {!isOwn && (
          <span className="text-[10px] font-semibold text-muted-foreground mb-0.5 ml-1 block">
            @{senderProfile?.username || 'member'}
          </span>
        )}
        <div className="relative" onClick={handleTap}>
          <img src={msg.media_url} className="rounded-2xl w-full" alt="" draggable={false} />
          <div className="absolute top-2 right-2 bg-black/60 rounded-full px-2 py-0.5 text-[10px] text-white font-semibold">
            1h
          </div>
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
          {reacted && !animating && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className={`absolute -bottom-2.5 ${isOwn ? '-left-1' : '-right-1'} bg-card border border-border rounded-full px-1.5 py-0.5 text-xs shadow-sm flex items-center gap-0.5 cursor-pointer`}
              onClick={() => setReactedPersisted(false)}
              title="Tap to remove"
            >
              🔥
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────

export default function CrewMessageItem({ msg, senderProfile, currentUserId, user, crewId, isCurrentModerator, onPin }) {
  const isOwn = msg.sender_id === currentUserId;

  switch (msg.message_type) {
    case 'xp_fuel':
      return <XpFuelMessage msg={msg} currentUserId={currentUserId} crewId={crewId} />;
    case 'roll_call':
      return <RollCallMessage msg={msg} currentUserId={currentUserId} crewId={crewId} />;
    case 'regimen':
      return <RegimenMessage msg={msg} user={user} senderProfile={senderProfile} />;
    case 'image_one_time':
      return <OneTimeImageMessage msg={msg} senderProfile={senderProfile} isOwn={isOwn} currentUserId={currentUserId} />;
    case 'image_one_hour':
      return <TimedImageMessage msg={msg} senderProfile={senderProfile} isOwn={isOwn} />;
    default:
      return (
        <TextMessage
          msg={msg}
          senderProfile={senderProfile}
          isOwn={isOwn}
          currentUserId={currentUserId}
          isCurrentModerator={isCurrentModerator}
          onPin={onPin}
        />
      );
  }
}
