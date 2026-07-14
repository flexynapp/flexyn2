// src/components/crews/CrewChat.jsx
//
// Full crew chat interface:
//   - Pinned announcement banner (if a message is pinned)
//   - Assigned regimen panel (crew shared workout plan)
//   - Crew stories tray
//   - Message stream (CrewMessageItem)
//   - Composer: text + image attach + roll call + regimen
//   - Member directory slide-out panel
//   - Crew stats slide-out panel

import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Users, Send, Paperclip, X, Loader2, Camera, Dumbbell,
  Clock, Eye, Plus, BarChart3, PinOff, Megaphone, MessageCircle, Shield, Upload,
} from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import * as crewsData from '@/lib/data/crews';
import * as usersData from '@/lib/data/users';
import CrewMessageItem from './CrewMessageItem';
import CrewMemberDirectory from './CrewMemberDirectory';
import CrewChallengeCard from './CrewChallengeCard';
import CrewStatsPanel from './CrewStatsPanel';
import AvatarCropModal from './AvatarCropModal';

// ── Crew "hype" triggers ────────────────────────────────────────────────────
// Posting a hype phrase in crew chat pops a burst of emoji over the thread.
const HYPE_TRIGGERS = [
  { re: /(let'?s\s*go+|lfg|let'?s\s*get\s*it)/i, emoji: '🔥' },
  { re: /\bbeast\b/i,                            emoji: '💪' },
  { re: /\blight\s*weight\b/i,                   emoji: '🪶' },
  { re: /\b(pr|p\.r\.|personal record)\b/i,      emoji: '🏆' },
  { re: /(crush(ed|ing)?|sheesh|goat|insane)/i,  emoji: '⚡' },
];
function detectHype(text) {
  if (!text) return null;
  for (const { re, emoji } of HYPE_TRIGGERS) {
    if (re.test(text)) return emoji;
  }
  return null;
}

// Lightweight emoji explosion scoped to the chat container (the parent is
// position:relative overflow-hidden). Re-animates whenever `hype.id` changes.
function HypeBurst({ hype }) {
  return (
    <div className="absolute inset-0 z-[60] pointer-events-none overflow-hidden">
      <AnimatePresence>
        {hype && Array.from({ length: 12 }).map((_, i) => (
          <motion.span
            key={`${hype.id}-${i}`}
            className="absolute start-1/2 bottom-24"
            style={{ fontSize: 22 + Math.random() * 16 }}
            initial={{ opacity: 0, y: 0, x: 0, scale: 0.4 }}
            animate={{
              opacity: [0, 1, 1, 0],
              y: -(200 + Math.random() * 160),
              x: (Math.random() - 0.5) * 300,
              scale: 1,
              rotate: (Math.random() - 0.5) * 70,
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.4, delay: Math.random() * 0.18, ease: 'easeOut' }}
          >
            {hype.emoji}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ── Roll Call composer ────────────────────────────────────────────────────────

function RollCallComposer({ onSubmit, onCancel }) {
  const [question, setQuestion] = useState('Did you work out today?');
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 bg-card border-t border-border px-4 py-4">
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Roll Call</p>
      <textarea
        value={question}
        onChange={e => setQuestion(e.target.value.slice(0, 120))}
        rows={2}
        className="w-full rounded-xl border border-border bg-secondary/50 px-3 py-2 text-sm resize-none focus:outline-none focus:border-primary/50"
        placeholder="Ask your crew anything…"
      />
      <div className="flex gap-2 mt-2">
        <button onClick={onCancel} className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground font-semibold">
          Cancel
        </button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => question.trim() && onSubmit(question.trim())}
          disabled={!question.trim()}
          className="flex-1 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
          style={{ background: 'hsl(var(--primary))' }}
        >
          📣 Send Roll Call
        </motion.button>
      </div>
    </div>
  );
}

// ── Regimen picker ────────────────────────────────────────────────────────────

function RegimenPicker({ userEmail, onShare, onAssign, canAssign, onCancel }) {
  const [tab, setTab] = useState('share'); // 'share' | 'assign'
  const { data: regimenList = [] } = useQuery({
    queryKey: ['regimenPicker', userEmail],
    queryFn:  async () => {
      const { supabase } = await import('@/api/supabaseClient');
      const { data } = await supabase
        .from('regimens')
        .select('id, name, exercises')
        .eq('created_by', userEmail)
        .order('created_date', { ascending: false })
        .limit(20);
      return data ?? [];
    },
    enabled: !!userEmail,
    staleTime: 30_000,
  });

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 bg-card border-t border-border max-h-72 overflow-y-auto">
      <div className="px-4 pt-3 pb-1 flex items-center justify-between sticky top-0 bg-card border-b border-border/50">
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
            {tab === 'assign' ? 'Assign to Crew' : 'Share a Regimen'}
          </p>
          {canAssign && (
            <div className="flex gap-1">
              <button
                onClick={() => setTab('share')}
                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-colors ${
                  tab === 'share' ? 'bg-primary/15 text-primary' : 'text-muted-foreground'
                }`}
              >Share</button>
              <button
                onClick={() => setTab('assign')}
                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-colors ${
                  tab === 'assign' ? 'bg-primary/15 text-primary' : 'text-muted-foreground'
                }`}
              >Assign</button>
            </div>
          )}
        </div>
        <button onClick={onCancel} className="text-muted-foreground"><X className="w-4 h-4" /></button>
      </div>
      {regimenList.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No saved regimens yet.</p>
      ) : (
        <div className="px-3 py-2 space-y-0.5">
          {regimenList.map(r => (
            <button
              key={r.id}
              onClick={() => tab === 'assign' ? onAssign?.(r) : onShare(r)}
              className="w-full text-start px-3 py-2.5 rounded-xl hover:bg-secondary transition-colors"
            >
              <p className="text-sm font-semibold text-foreground truncate">{r.name}</p>
              <p className="text-xs text-muted-foreground">{(r.exercises || []).length} exercises
                {tab === 'assign' && <span className="ms-1 text-primary font-medium">· assign to crew</span>}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Assigned Regimen Banner ───────────────────────────────────────────────────

function AssignedRegimenBanner({ crewId, isAdmin, onEquip }) {
  const qc = useQueryClient();
  const { data: assigned = [] } = useQuery({
    queryKey: ['crewAssignedRegimens', crewId],
    queryFn:  () => crewsData.getCrewAssignedRegimens(crewId),
    enabled:  !!crewId,
    staleTime: 30_000,
  });

  if (!assigned.length) return null;
  const top = assigned[0];
  const regimen = top.regimens ?? {};
  const exCount = (regimen.exercises || []).length;

  return (
    <div
      className="mx-3 mt-2 rounded-xl border px-3 py-2.5 flex items-center gap-2.5"
      style={{ borderColor: 'hsl(var(--primary) / 0.3)', background: 'hsl(var(--primary) / 0.06)' }}
    >
      <Dumbbell className="w-4 h-4 shrink-0" style={{ color: 'hsl(var(--primary))' }} />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Crew Plan</p>
        <p className="text-sm font-bold text-foreground truncate">{regimen.name || 'Assigned Regimen'}</p>
        <p className="text-[10px] text-muted-foreground">{exCount} exercise{exCount !== 1 ? 's' : ''}
          {top.note ? ` · ${top.note}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={() => onEquip(top)}
          className="px-2.5 py-1 rounded-lg text-xs font-bold text-white"
          style={{ background: 'hsl(var(--primary))' }}
        >
          Start
        </motion.button>
        {isAdmin && (
          <button
            onClick={async () => {
              try {
                await crewsData.removeAssignedRegimen(top.id);
                qc.invalidateQueries({ queryKey: ['crewAssignedRegimens', crewId] });
                toast.success('Plan removed.');
              } catch { toast.error('Could not remove plan.'); }
            }}
            className="p-1 text-muted-foreground hover:text-destructive transition-colors"
            title="Remove plan"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Pinned Announcement Banner ────────────────────────────────────────────────

function PinnedBanner({ message, isAdmin, crewId, onUnpin }) {
  if (!message) return null;
  return (
    <div
      className="mx-3 mt-2 rounded-xl border px-3 py-2 flex items-start gap-2"
      style={{ borderColor: 'hsl(39 100% 57% / 0.35)', background: 'hsl(39 100% 57% / 0.08)' }}
    >
      <Megaphone className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-0.5">
          📌 Announcement
        </p>
        <p className="text-xs text-foreground leading-relaxed line-clamp-3">
          {message.content}
        </p>
      </div>
      {isAdmin && (
        <button
          onClick={onUnpin}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Unpin"
        >
          <PinOff className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Main chat ─────────────────────────────────────────────────────────────────

export default function CrewChat({ crew, onBack, onViewProfile }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const scrollerRef  = useRef(null);
  const fileInputRef = useRef(null);
  const stickRef     = useRef(true);

  const [draft,           setDraft]           = useState('');
  const [sending,         setSending]         = useState(false);
  const [hype,            setHype]            = useState(null); // { id, emoji } | null
  const [memberPanelOpen, setMemberPanelOpen] = useState(false);
  const [statsPanelOpen,  setStatsPanelOpen]  = useState(false);
  const [rollCallOpen,    setRollCallOpen]    = useState(false);
  const [regimenOpen,     setRegimenOpen]     = useState(false);
  const [attachment,      setAttachment]      = useState(null);
  const [imageMode,       setImageMode]       = useState('normal');
  const [storyViewIdx,    setStoryViewIdx]    = useState(null);
  const storyFileRef = useRef(null);

  // Queries
  const { data: messages = [] } = useQuery({
    queryKey: ['crewMessages', crew.id],
    queryFn:  () => crewsData.getCrewMessages(crew.id),
    enabled:  !!crew.id,
    refetchInterval: 4000,
    staleTime: 2000,
  });

  const { data: members = [] } = useQuery({
    queryKey: ['crewMembers', crew.id],
    queryFn:  () => crewsData.getCrewMembers(crew.id),
    enabled:  !!crew.id,
    staleTime: 30_000,
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsersForCrew'],
    queryFn:  () => usersData.list(),
    staleTime: 60_000,
  });

  const { data: crewStories = [], refetch: refetchStories } = useQuery({
    queryKey: ['crewStories', crew.id],
    queryFn:  () => crewsData.getCrewStories(crew.id),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: pinnedMessage } = useQuery({
    queryKey: ['crewPinnedMessage', crew.id],
    queryFn:  () => crewsData.getPinnedMessage(crew.id),
    enabled:  !!crew.id,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // Synchronous double-tap guards on every chat action. `sending`
  // (state) + per-action booleans lag React renders — a finger-bounce
  // double-tap on Send / Roll Call / Share / Pin / Story fires the
  // RPC twice. Roll Call in particular would post the question twice
  // + send 16×2 push notifications. Wave 57 (Crews audit) caught this
  // across SEVEN handlers. Declared at the top of the component so
  // they're in scope for every callback below.
  const storyRef       = useRef(false);

  const handleAddStory = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { toast.error('Image must be under 50 MB.'); return; }
    if (storyRef.current) return;
    storyRef.current = true;
    try {
      const url = await crewsData.uploadCrewMedia(file);
      await crewsData.postCrewStory(user.id, user.email, crew.id, url, file.type.startsWith('video/') ? 'video' : 'image', null);
      refetchStories();
      toast.success('Story posted to the Crew!');
    } catch {
      toast.error('Could not post story — try again.');
    } finally {
      storyRef.current = false;
    }
  };

  const profilesByUserId = {};
  for (const u of allUsers) {
    if (u.id) profilesByUserId[u.id] = u;
  }

  const myMember = members.find(m => m.user_id === user?.id);
  const myRole = myMember?.role ?? (myMember?.is_admin ? 'leader' : 'member');
  const isCurrentAdmin = myRole === 'leader';
  const isCurrentModerator = myRole === 'leader' || myRole === 'moderator';

  // ── Crew avatar upload (with crop/zoom) ──────────────────────────────────
  const avatarInputRef  = useRef(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [cropFile,        setCropFile]        = useState(null); // pending crop

  // Step 1 — user picks a file → open the crop modal instead of uploading directly.
  const handleAvatarFilePick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !crew?.id) return;
    setCropFile(file);
  };

  // Step 2 — user confirms crop → receive the cropped Blob and upload it.
  const handleCropConfirm = async (blob) => {
    setCropFile(null);
    if (!blob || !crew?.id) return;
    setAvatarUploading(true);
    try {
      // Convert blob to a File so uploadCrewMedia gets a filename + type.
      const croppedFile = new File([blob], 'crew-avatar.jpg', { type: 'image/jpeg' });
      const url = await crewsData.uploadCrewMedia(croppedFile);
      await crewsData.updateCrewProfile(crew.id, { avatar_url: url });
      qc.invalidateQueries({ queryKey: ['myCrews', user?.id] });
      qc.invalidateQueries({ queryKey: ['crewMembers', crew.id] });
      toast.success('Crew photo updated!');
    } catch {
      toast.error('Could not update crew photo — try again.');
    } finally {
      setAvatarUploading(false);
    }
  };

  // Auto-scroll
  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  useLayoutEffect(() => { scrollToBottom(false); }, [crew.id]);
  useEffect(() => { if (stickRef.current) scrollToBottom(true); }, [messages.length]);

  const handleScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const handleFilePick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { toast.error('Image must be under 50 MB.'); return; }
    setAttachment({ file, preview: URL.createObjectURL(file) });
  };

  const clearAttachment = () => {
    if (attachment?.preview) URL.revokeObjectURL(attachment.preview);
    setAttachment(null);
    setImageMode('normal');
  };

  // Remaining double-tap guards. See storyRef declaration above for
  // the full rationale; these stay near handleSend for locality.
  const sendingRef     = useRef(false);
  const rollCallRef    = useRef(false);
  const shareRef       = useRef(false);
  const assignRef      = useRef(false);
  const pinRef         = useRef(false);
  const equipRef       = useRef(false);

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed && !attachment) return;
    if (sending || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    stickRef.current = true;

    // Optimistic insert into the React Query cache so the message
    // appears immediately. Previously the send awaited the server +
    // the next refetchInterval (up to 4s) before the message echoed
    // back — felt broken on slow networks. Same pattern as HubChat.
    // (Audit 10 #18.)
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const isImageSend = !!attachment;
    if (!isImageSend) {
      qc.setQueryData(['crewMessages', crew.id], (old) => {
        const arr = Array.isArray(old) ? old : [];
        return [
          ...arr,
          {
            id: tempId,
            crew_id: crew.id,
            sender_id: user.id,
            message_type: 'text',
            content: trimmed,
            created_at: new Date().toISOString(),
            _optimistic: true,
          },
        ];
      });
    }

    try {
      if (attachment) {
        const fileToUpload = attachment.file;
        clearAttachment();
        const mediaUrl = await crewsData.uploadCrewMedia(fileToUpload);
        const type = imageMode === 'one_time' ? 'image_one_time'
                   : imageMode === 'one_hour' ? 'image_one_hour'
                   : 'image_one_hour';
        const extras = { media_url: mediaUrl };
        if (imageMode === 'one_hour') {
          extras.expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        }
        await crewsData.sendCrewMessage(crew.id, user.id, type, trimmed || null, extras);
      } else {
        await crewsData.sendCrewMessage(crew.id, user.id, 'text', trimmed);
      }
      // Server INSERT succeeded — refetch to swap the temp row for the
      // real one. Drop the optimistic row in case the refetch hasn't
      // picked up the real one yet so we don't show a dupe.
      qc.setQueryData(['crewMessages', crew.id], (old) => {
        const arr = Array.isArray(old) ? old : [];
        return arr.filter(m => m.id !== tempId);
      });
      qc.invalidateQueries({ queryKey: ['crewMessages', crew.id] });
      setDraft('');
      const hypeEmoji = detectHype(trimmed);
      if (hypeEmoji) {
        setHype({ id: Date.now(), emoji: hypeEmoji });
        setTimeout(() => setHype(null), 1700);
      }
      qc.invalidateQueries({ queryKey: ['crewMessages', crew.id] });
    } catch (err) {
      // Send failed — revert the optimistic row + restore the draft
      // so the user can retry without retyping.
      qc.setQueryData(['crewMessages', crew.id], (old) => {
        const arr = Array.isArray(old) ? old : [];
        return arr.filter(m => m.id !== tempId);
      });
      setDraft(trimmed);
      // Surface specific errors from mig 159 (crew_message_profanity).
      const msg = `${err?.message || ''} ${err?.hint || ''}`;
      if (/crew_message_profanity/i.test(msg) || err?.code === '23514') {
        toast.error('Crew message contains prohibited content. Edit it and try again.');
      } else {
        toast.error('Could not send message — try again.');
      }
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  };

  const handleRollCall = async (question) => {
    if (rollCallRef.current) return;
    rollCallRef.current = true;
    setRollCallOpen(false);
    try {
      await crewsData.sendCrewMessage(crew.id, user.id, 'roll_call', question);
      await crewsData.notifyCrewRollCall(crew.id, question, user.username || 'Someone');
      qc.invalidateQueries({ queryKey: ['crewMessages', crew.id] });
      toast.success('Roll Call sent!');
    } catch { toast.error('Could not send Roll Call.'); }
    finally { rollCallRef.current = false; }
  };

  const handleShareRegimen = async (regimen) => {
    if (shareRef.current) return;
    shareRef.current = true;
    setRegimenOpen(false);
    const exercises = (regimen.exercises || []).map(e => e.name || e.exercise_name || e).filter(Boolean);
    const meta = JSON.stringify({
      name:              regimen.name,
      exercise_count:    exercises.length,
      preview_exercises: exercises.slice(0, 3),
    });
    try {
      await crewsData.sendCrewMessage(crew.id, user.id, 'regimen', meta, { regimen_id: regimen.id });
      qc.invalidateQueries({ queryKey: ['crewMessages', crew.id] });
      toast.success(`"${regimen.name}" shared with the Crew!`);
    } catch { toast.error('Could not share regimen.'); }
    finally { shareRef.current = false; }
  };

  const handleAssignRegimen = async (regimen) => {
    if (assignRef.current) return;
    assignRef.current = true;
    setRegimenOpen(false);
    try {
      await crewsData.assignRegimenToCrew(crew.id, regimen.id, user.id, null);
      qc.invalidateQueries({ queryKey: ['crewAssignedRegimens', crew.id] });
      toast.success(`"${regimen.name}" assigned as the Crew Plan!`);
    } catch { toast.error('Could not assign regimen.'); }
    finally { assignRef.current = false; }
  };

  const handlePinMessage = async (msgId, pinned) => {
    // Per-message-id guard. A double-tap on the same Pin button is the
    // race; pinning two different messages in parallel is fine (each
    // has its own server lock).
    const key = `${msgId}:${pinned}`;
    if (pinRef.current === key) return;
    pinRef.current = key;
    try {
      await crewsData.pinMessage(msgId, pinned);
      qc.invalidateQueries({ queryKey: ['crewMessages', crew.id] });
      qc.invalidateQueries({ queryKey: ['crewPinnedMessage', crew.id] });
      toast.success(pinned ? '📌 Message pinned as announcement.' : 'Unpinned.');
    } catch { toast.error('Could not pin message.'); }
    finally { pinRef.current = false; }
  };

  const handleEquipAssignedRegimen = async (assignment) => {
    const regimen = assignment.regimens;
    if (!regimen) return;
    if (equipRef.current) return;
    equipRef.current = true;
    try {
      await crewsData.equipRegimen(regimen.id, user);
      toast.success(`"${regimen.name}" added to your regimens!`);
    } catch (err) {
      toast.error('Could not add regimen.', { description: err.message });
    } finally {
      equipRef.current = false;
    }
  };

  return (
    <div className="flex flex-col h-full relative overflow-hidden">

      {/* Hype-trigger emoji burst overlay */}
      <HypeBurst hype={hype} />

      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border shrink-0">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex-1 min-w-0 flex items-center gap-2">
          {/* Crew avatar — tap to upload if admin */}
          <div className="relative shrink-0">
            {crew.avatar_url ? (
              <img loading="lazy" src={crew.avatar_url} alt={crew.name}
                className="w-8 h-8 rounded-full object-cover border border-border" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary/10 border border-border flex items-center justify-center">
                <Shield className="w-4 h-4 text-primary/60" />
              </div>
            )}
            {isCurrentAdmin && (
              <>
                <button type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarUploading}
                  className="absolute -bottom-0.5 -end-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center"
                  title="Change crew photo">
                  {avatarUploading
                    ? <Loader2 className="w-2.5 h-2.5 text-white animate-spin" />
                    : <Upload className="w-2.5 h-2.5 text-white" />}
                </button>
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFilePick} />
              </>
            )}
          </div>
          <div className="min-w-0">
            <h2 className="font-heading font-bold text-base truncate leading-tight">{crew.name}</h2>
            <p className="text-xs text-muted-foreground leading-tight">{members.length} member{members.length !== 1 ? 's' : ''}</p>
          </div>

          {/* Story bubble */}
          {crewStories.length > 0 ? (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setStoryViewIdx(0)}
                className="rounded-full overflow-hidden shrink-0"
                style={{ width: 30, height: 30, border: '2.5px solid hsl(var(--primary))' }}
              >
                <img loading="lazy" src={crewStories[0].image_url} className="w-full h-full object-cover" alt="" draggable={false} />
              </button>
              <button
                onClick={() => storyFileRef.current?.click()}
                className="flex items-center gap-0.5 text-xs font-semibold shrink-0"
                style={{ color: 'hsl(var(--primary))' }}
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => storyFileRef.current?.click()}
              className="flex items-center justify-center shrink-0 rounded-full border-2 border-dashed"
              style={{ width: 30, height: 30, borderColor: 'hsl(var(--primary) / 0.6)' }}
              title="Add crew story"
            >
              <Plus className="w-3 h-3" style={{ color: 'hsl(var(--primary))' }} />
            </button>
          )}
        </div>

        {/* Stats button */}
        <button
          onClick={() => setStatsPanelOpen(true)}
          className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Crew Stats"
        >
          <BarChart3 className="w-4 h-4" />
        </button>

        {/* Members button */}
        <button
          onClick={() => setMemberPanelOpen(true)}
          className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Members"
        >
          <Users className="w-4 h-4" />
        </button>
      </div>

      {/* Pinned announcement banner */}
      <PinnedBanner
        message={pinnedMessage}
        isAdmin={isCurrentModerator}
        crewId={crew.id}
        onUnpin={() => handlePinMessage(pinnedMessage.id, false)}
      />

      {/* Assigned regimen banner */}
      <AssignedRegimenBanner
        crewId={crew.id}
        isAdmin={isCurrentAdmin}
        onEquip={handleEquipAssignedRegimen}
      />

      {/* Crew story viewer overlay */}
      <AnimatePresence>
        {storyViewIdx !== null && crewStories[storyViewIdx] && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-black flex items-center justify-center"
            onClick={() => setStoryViewIdx(null)}
          >
            <img loading="lazy" src={crewStories[storyViewIdx].image_url}
              className="max-w-full max-h-full object-contain"
              alt=""
              draggable={false}
              onClick={e => e.stopPropagation()}
            />
            <button
              onClick={() => setStoryViewIdx(null)}
              className="absolute top-4 end-4 w-9 h-9 rounded-full bg-black/60 flex items-center justify-center"
            >
              <X className="w-5 h-5 text-white" />
            </button>
            {crewStories.length > 1 && (
              <div className="absolute bottom-6 start-0 end-0 flex justify-center gap-1.5">
                {crewStories.map((_, i) => (
                  <button
                    key={i}
                    onClick={e => { e.stopPropagation(); setStoryViewIdx(i); }}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${i === storyViewIdx ? 'bg-white' : 'bg-white/40'}`}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden story file input */}
      <input ref={storyFileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleAddStory} />

      {/* Messages */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-2"
      >
        {/* Active crew challenges (A13) — admin can post a new
            challenge from the inline + button. All members see live
            progress bars. Self-hides when no challenges exist + the
            viewer is not an admin. */}
        <CrewChallengeCard crewId={crew?.id} isAdmin={!!crew?.is_admin} />

        {messages.length === 0 && (
          <EmptyState
            icon={MessageCircle}
            title="No messages yet"
            body="Be the first to fuel the Crew."
          />
        )}
        {messages.map(msg => (
          <CrewMessageItem
            key={msg.id}
            msg={msg}
            senderProfile={profilesByUserId[msg.sender_id]}
            currentUserId={user?.id}
            user={user}
            crewId={crew.id}
            isCurrentModerator={isCurrentModerator}
            onPin={(id) => handlePinMessage(id, true)}
          />
        ))}
        <div style={{ height: 1 }} />
      </div>

      {/* Attachment preview + mode toggles */}
      {attachment && (
        <div className="px-4 pb-2 shrink-0 border-t border-border pt-2">
          <div className="flex items-start gap-3">
            <div className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0">
              <img loading="lazy" src={attachment.preview} className="w-full h-full object-cover" alt="" />
              <button
                onClick={clearAttachment}
                className="absolute top-0.5 end-0.5 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center"
              >
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
            <div className="flex flex-col gap-1.5 pt-1">
              <p className="text-xs text-muted-foreground font-medium mb-0.5">View settings:</p>
              {[
                { id: 'normal',   label: 'Standard',    icon: <Camera className="w-3 h-3" /> },
                { id: 'one_time', label: 'One-time',     icon: <Eye    className="w-3 h-3" /> },
                { id: 'one_hour', label: '1-hour expiry',icon: <Clock  className="w-3 h-3" /> },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setImageMode(opt.id)}
                  className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                    imageMode === opt.id
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {opt.icon} {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="px-3 pb-3 pt-2 border-t border-border shrink-0 flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        <button
          onClick={() => { setRollCallOpen(true); setRegimenOpen(false); }}
          className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Roll Call"
        >
          <span className="text-base leading-none">📣</span>
        </button>

        <button
          onClick={() => { setRegimenOpen(true); setRollCallOpen(false); }}
          className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Share / assign regimen"
        >
          <Dumbbell className="w-4 h-4" />
        </button>

        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Message the Crew…"
          rows={1}
          className="flex-1 resize-none rounded-2xl border border-border bg-secondary/50 px-3.5 py-2 text-sm focus:outline-none focus:border-primary/50 leading-relaxed max-h-28 overflow-y-auto"
          style={{ minHeight: '40px' }}
        />

        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={handleSend}
          disabled={(!draft.trim() && !attachment) || sending}
          className="w-9 h-9 rounded-full flex items-center justify-center text-white disabled:opacity-40 shrink-0 transition-opacity"
          style={{ background: 'hsl(var(--primary))' }}
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </motion.button>
      </div>

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFilePick} />

      {/* Roll Call composer overlay */}
      <AnimatePresence>
        {rollCallOpen && (
          <RollCallComposer onSubmit={handleRollCall} onCancel={() => setRollCallOpen(false)} />
        )}
      </AnimatePresence>

      {/* Regimen picker overlay */}
      <AnimatePresence>
        {regimenOpen && (
          <RegimenPicker
            userEmail={user?.email}
            onShare={handleShareRegimen}
            onAssign={handleAssignRegimen}
            canAssign={isCurrentAdmin}
            onCancel={() => setRegimenOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Stats panel */}
      <AnimatePresence>
        {statsPanelOpen && (
          <CrewStatsPanel crewId={crew.id} onClose={() => setStatsPanelOpen(false)} />
        )}
      </AnimatePresence>

      {/* Member directory */}
      <AnimatePresence>
        {memberPanelOpen && (
          <CrewMemberDirectory
            crewId={crew.id}
            members={members}
            profilesByUserId={profilesByUserId}
            currentUserId={user?.id}
            isCurrentAdmin={isCurrentAdmin}
            onClose={() => setMemberPanelOpen(false)}
            onViewProfile={(u) => { setMemberPanelOpen(false); onViewProfile?.(u); }}
          />
        )}
      </AnimatePresence>

      {/* Avatar crop modal — mounts when admin picks a new crew photo */}
      <AnimatePresence>
        {cropFile && (
          <AvatarCropModal
            key="avatar-crop"
            file={cropFile}
            onCrop={handleCropConfirm}
            onClose={() => setCropFile(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
