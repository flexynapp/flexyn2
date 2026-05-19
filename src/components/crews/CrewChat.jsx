// src/components/crews/CrewChat.jsx
//
// Full crew chat interface:
//   - Crew stories tray (pinned top)
//   - Message stream (CrewMessageItem)
//   - Composer: text + image attach (one-time / 1-hour) + roll call + regimen
//   - Member directory slide-out panel

import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Users, Send, Paperclip, X, Loader2, Camera, Dumbbell, Clock, Eye, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import * as crewsData from '@/lib/data/crews';
import * as usersData from '@/lib/data/users';
import CrewMessageItem from './CrewMessageItem';
import CrewMemberDirectory from './CrewMemberDirectory';

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

function RegimenPicker({ userEmail, onShare, onCancel }) {
  const { data: regimenList = [] } = useQuery({
    queryKey: ['regimenPicker', userEmail],
    queryFn:  async () => {
      const { supabase } = await import('@/api/supabaseClient');
      const { data } = await supabase.from('regimens').select('id, name, exercises').eq('created_by', userEmail).order('created_date', { ascending: false }).limit(20);
      return data ?? [];
    },
    enabled: !!userEmail,
    staleTime: 30_000,
  });

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 bg-card border-t border-border max-h-64 overflow-y-auto">
      <div className="px-4 pt-3 pb-1 flex items-center justify-between sticky top-0 bg-card border-b border-border/50">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Share a Regimen</p>
        <button onClick={onCancel} className="text-muted-foreground"><X className="w-4 h-4" /></button>
      </div>
      {regimenList.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No saved regimens yet.</p>
      ) : (
        <div className="px-3 py-2 space-y-0.5">
          {regimenList.map(r => (
            <button
              key={r.id}
              onClick={() => onShare(r)}
              className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-secondary transition-colors"
            >
              <p className="text-sm font-semibold text-foreground truncate">{r.name}</p>
              <p className="text-xs text-muted-foreground">{(r.exercises || []).length} exercises</p>
            </button>
          ))}
        </div>
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

  const [draft,         setDraft]         = useState('');
  const [sending,       setSending]       = useState(false);
  const [memberPanelOpen, setMemberPanelOpen] = useState(false);
  const [rollCallOpen,  setRollCallOpen]  = useState(false);
  const [regimenOpen,   setRegimenOpen]   = useState(false);
  const [attachment,    setAttachment]    = useState(null); // { file, preview, mode }
  const [imageMode,     setImageMode]     = useState('normal'); // normal | one_time | one_hour
  const [storyViewIdx,  setStoryViewIdx]  = useState(null); // index of story to fullscreen-view
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

  const handleAddStory = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { toast.error('Image must be under 50 MB.'); return; }
    try {
      const url = await crewsData.uploadCrewMedia(file);
      await crewsData.postCrewStory(user.id, user.email, crew.id, url, file.type.startsWith('video/') ? 'video' : 'image', null);
      refetchStories();
      toast.success('Story posted to the Crew!');
    } catch {
      toast.error('Could not post story — try again.');
    }
  };

  const profilesByUserId = {};
  for (const u of allUsers) {
    if (u.id) profilesByUserId[u.id] = u;
  }

  const isCurrentAdmin = members.some(m => m.user_id === user?.id && m.is_admin);

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

  // Attachment picking
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

  // Send message
  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed && !attachment) return;
    if (sending) return;
    setSending(true);
    stickRef.current = true;

    try {
      if (attachment) {
        const fileToUpload = attachment.file;
        clearAttachment();
        const mediaUrl = await crewsData.uploadCrewMedia(fileToUpload);
        const type = imageMode === 'one_time' ? 'image_one_time'
                   : imageMode === 'one_hour' ? 'image_one_hour'
                   : 'image_one_hour'; // normal = permanent photo (no expires_at)
        const extras = { media_url: mediaUrl };
        if (imageMode === 'one_hour') {
          extras.expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        }
        await crewsData.sendCrewMessage(crew.id, user.id, type, trimmed || null, extras);
      } else {
        await crewsData.sendCrewMessage(crew.id, user.id, 'text', trimmed);
      }
      setDraft('');
      qc.invalidateQueries({ queryKey: ['crewMessages', crew.id] });
    } catch {
      toast.error('Could not send message — try again.');
    } finally {
      setSending(false);
    }
  };

  // Roll Call submit
  const handleRollCall = async (question) => {
    setRollCallOpen(false);
    try {
      await crewsData.sendCrewMessage(crew.id, user.id, 'roll_call', question);
      await crewsData.notifyCrewRollCall(crew.id, question, user.username || user.email?.split('@')[0] || 'Someone');
      qc.invalidateQueries({ queryKey: ['crewMessages', crew.id] });
      toast.success('Roll Call sent!');
    } catch { toast.error('Could not send Roll Call.'); }
  };

  // Share regimen
  const handleShareRegimen = async (regimen) => {
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
  };

  return (
    <div className="flex flex-col h-full relative overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-heading font-bold text-base truncate">{crew.name}</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-muted-foreground">{members.length} member{members.length !== 1 ? 's' : ''}</p>

            {/* Crew story circles */}
            {crewStories.length > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground/40 text-xs">·</span>
                <div className="flex -space-x-1.5">
                  {crewStories.slice(0, 3).map((s, i) => (
                    <button
                      key={s.id}
                      onClick={() => setStoryViewIdx(i)}
                      className="w-5 h-5 rounded-full overflow-hidden ring-2 shrink-0"
                      style={{ ringColor: 'hsl(var(--primary))', border: '2px solid hsl(var(--primary))' }}
                    >
                      <img src={s.image_url} className="w-full h-full object-cover" alt="" draggable={false} />
                    </button>
                  ))}
                  {crewStories.length > 3 && (
                    <div className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-[8px] font-bold text-muted-foreground ring-2 ring-background">
                      +{crewStories.length - 3}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Add to story */}
            <button
              onClick={() => storyFileRef.current?.click()}
              className="flex items-center gap-0.5 text-[10px] font-semibold text-primary"
            >
              <Plus className="w-3 h-3" />
              Story
            </button>
          </div>
        </div>
        <button
          onClick={() => setMemberPanelOpen(true)}
          className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Members"
        >
          <Users className="w-4 h-4" />
        </button>
      </div>

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
            <img
              src={crewStories[storyViewIdx].image_url}
              className="max-w-full max-h-full object-contain"
              alt=""
              draggable={false}
              onClick={e => e.stopPropagation()}
            />
            <button
              onClick={() => setStoryViewIdx(null)}
              className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/60 flex items-center justify-center"
            >
              <X className="w-5 h-5 text-white" />
            </button>
            {crewStories.length > 1 && (
              <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-1.5">
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
        {messages.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm font-semibold">No messages yet.</p>
            <p className="text-xs">Be the first to fuel the Crew!</p>
          </div>
        )}
        {messages.map(msg => (
          <CrewMessageItem
            key={msg.id}
            msg={msg}
            senderProfile={profilesByUserId[msg.sender_id]}
            currentUserId={user?.id}
            user={user}
            crewId={crew.id}
            onFireReact={() => crewsData.sendCrewMessage(crew.id, user.id, 'text', '🔥')
              .then(() => qc.invalidateQueries({ queryKey: ['crewMessages', crew.id] }))
              .catch(() => {})}
          />
        ))}
        <div style={{ height: 1 }} />
      </div>

      {/* Attachment preview + mode toggles */}
      {attachment && (
        <div className="px-4 pb-2 shrink-0 border-t border-border pt-2">
          <div className="flex items-start gap-3">
            <div className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0">
              <img src={attachment.preview} className="w-full h-full object-cover" alt="" />
              <button
                onClick={clearAttachment}
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center"
              >
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
            <div className="flex flex-col gap-1.5 pt-1">
              <p className="text-xs text-muted-foreground font-medium mb-0.5">View settings:</p>
              {[
                { id: 'normal',   label: 'Standard',   icon: <Camera className="w-3 h-3" /> },
                { id: 'one_time', label: 'One-time',    icon: <Eye    className="w-3 h-3" /> },
                { id: 'one_hour', label: '1-hour expiry', icon: <Clock  className="w-3 h-3" /> },
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
        {/* Attach */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        {/* Roll Call */}
        <button
          onClick={() => { setRollCallOpen(true); setRegimenOpen(false); }}
          className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Roll Call"
        >
          <span className="text-base leading-none">📣</span>
        </button>

        {/* Regimen */}
        <button
          onClick={() => { setRegimenOpen(true); setRollCallOpen(false); }}
          className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Share regimen"
        >
          <Dumbbell className="w-4 h-4" />
        </button>

        {/* Text input */}
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Message the Crew…"
          rows={1}
          className="flex-1 resize-none rounded-2xl border border-border bg-secondary/50 px-3.5 py-2 text-sm focus:outline-none focus:border-primary/50 leading-relaxed max-h-28 overflow-y-auto"
          style={{ minHeight: '40px' }}
        />

        {/* Send */}
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
            onCancel={() => setRegimenOpen(false)}
          />
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
    </div>
  );
}
