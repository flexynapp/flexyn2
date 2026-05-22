// src/components/crews/CrewCreationFlow.jsx
//
// Two-step wizard: (1) pick friends to invite, (2) name the crew.
// After submit: createCrew → DM invites to all selected friends.

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowLeft, ArrowRight, Shield, Check, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import * as crewsData from '@/lib/data/crews';
import * as hubFollows from '@/lib/data/hubFollows';
import * as users from '@/lib/data/users';
import { containsProfanity } from '@/lib/profanityFilter';
import { titleCase } from '@/lib/textCase';
import * as hubMessages from '@/lib/data/hubMessages';
import { buildCrewInviteBody } from './CrewDMInviteCard';

export default function CrewCreationFlow({ onCreated, onClose }) {
  const { user } = useAuth();
  const [step, setStep]         = useState(1);
  const [selected, setSelected] = useState([]); // array of profile objects
  const [crewName, setCrewName] = useState('');
  const [query, setQuery]       = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Load following list + their profiles
  const { data: followingEmails = [] } = useQuery({
    queryKey: ['following', user?.email],
    queryFn:  () => hubFollows.listFollowing(user.email),
    enabled:  !!user?.email,
    staleTime: 60_000,
  });

  const { data: allProfiles = [] } = useQuery({
    queryKey: ['allProfiles'],
    queryFn:  () => users.list(),
    staleTime: 120_000,
  });

  const friends = allProfiles
    .filter(p => followingEmails.includes(p.email) && p.email !== user?.email)
    .filter(p => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (p.username || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q);
    });

  const toggle = (profile) => {
    setSelected(prev => {
      const has = prev.some(p => p.email === profile.email);
      if (has) return prev.filter(p => p.email !== profile.email);
      if (prev.length >= 15) { toast('Max 15 people per crew.'); return prev; }
      return [...prev, profile];
    });
  };

  const handleCreate = async () => {
    if (!crewName.trim()) { toast('Name your crew first!'); return; }
    if (submitting) return;
    setSubmitting(true);
    try {
      const crew = await crewsData.createCrew(user, crewName.trim());

      // Send DM invite to each selected friend
      const { data: myProfile } = await supabase
        .from('user_profiles')
        .select('username, avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      const inviterName   = myProfile?.username || user.email?.split('@')[0] || 'Someone';
      const inviterAvatar = myProfile?.avatar_url || null;
      const inviteBody    = buildCrewInviteBody(crew.id, crew.name, inviterName, inviterAvatar);

      await Promise.allSettled(
        selected.map(async (friend) => {
          try {
            const conv = await hubMessages.findOrCreateConversation(user.email, friend.email);
            if (conv) {
              await hubMessages.sendMessage({
                conversationId: conv.id,
                senderEmail:    user.email,
                recipientEmail: friend.email,
                body:           inviteBody,
              });
            }
          } catch { /* non-fatal */ }
        })
      );

      toast.success(`${crew.name} created!`);
      onCreated?.(crew);
    } catch (err) {
      toast.error(err?.message || 'Could not create crew — try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="absolute inset-0 bg-background z-30 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <button
          onClick={step === 1 ? onClose : () => setStep(1)}
          className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground"
        >
          {step === 1 ? <X className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
        </button>
        <div className="flex-1">
          <h3 className="font-heading font-bold text-base">Create Crew</h3>
          <p className="text-xs text-muted-foreground">Step {step} of 2</p>
        </div>
        {/* Step indicator */}
        <div className="flex gap-1.5">
          <div className={`w-5 h-1.5 rounded-full transition-colors ${step >= 1 ? 'bg-primary' : 'bg-secondary'}`} />
          <div className={`w-5 h-1.5 rounded-full transition-colors ${step >= 2 ? 'bg-primary' : 'bg-secondary'}`} />
        </div>
      </div>

      <AnimatePresence mode="wait">
        {step === 1 ? (
          <motion.div
            key="step1"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.18 }}
            className="flex-1 flex flex-col min-h-0"
          >
            {/* Search */}
            <div className="px-4 pt-3 pb-2 shrink-0">
              <p className="text-sm text-muted-foreground mb-3">
                Invite up to 15 friends. You can add more later.
              </p>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search friends…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="w-full bg-secondary rounded-xl pl-9 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            {/* Selected pills */}
            {selected.length > 0 && (
              <div className="px-4 pb-2 flex flex-wrap gap-1.5 shrink-0">
                {selected.map(p => (
                  <button
                    key={p.email}
                    onClick={() => toggle(p)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold text-white gap-1"
                    style={{ background: 'hsl(var(--primary))' }}
                  >
                    @{p.username || p.email.split('@')[0]}
                    <X className="w-2.5 h-2.5" />
                  </button>
                ))}
              </div>
            )}

            {/* Friend list */}
            <div className="flex-1 overflow-y-auto px-4 divide-y divide-border/50">
              {friends.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {query ? 'No matches.' : 'Follow some people first!'}
                </div>
              ) : (
                friends.map(p => {
                  const isSelected = selected.some(s => s.email === p.email);
                  const username = p.username || p.email.split('@')[0];
                  return (
                    <button
                      key={p.email}
                      onClick={() => toggle(p)}
                      className="w-full flex items-center gap-3 py-2.5 text-left"
                    >
                      <div className="relative shrink-0">
                        {p.avatar_url ? (
                          <img src={p.avatar_url} className="w-9 h-9 rounded-full object-cover" alt="" draggable={false} />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground">
                            {username.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        {isSelected && (
                          <div
                            className="absolute inset-0 rounded-full flex items-center justify-center"
                            style={{ background: 'hsl(var(--primary) / 0.85)' }}
                          >
                            <Check className="w-4 h-4 text-white" />
                          </div>
                        )}
                      </div>
                      <span className="flex-1 text-sm font-semibold text-foreground">@{username}</span>
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                          isSelected ? 'border-primary bg-primary' : 'border-border bg-transparent'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Next button */}
            <div className="px-4 py-4 shrink-0 border-t border-border">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => setStep(2)}
                className="w-full py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2"
                style={{ background: 'hsl(var(--primary))' }}
              >
                Next
                <ArrowRight className="w-4 h-4" />
              </motion.button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="step2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.18 }}
            className="flex-1 flex flex-col px-4 pt-6 min-h-0"
          >
            {/* Icon */}
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5 mx-auto"
              style={{ background: 'hsl(var(--primary) / 0.12)' }}
            >
              <Shield className="w-8 h-8" style={{ color: 'hsl(var(--primary))' }} />
            </div>

            <h4 className="text-center font-heading font-bold text-lg mb-1">Name Your Crew</h4>
            <p className="text-center text-sm text-muted-foreground mb-6">
              {selected.length > 0
                ? `Inviting ${selected.length} friend${selected.length > 1 ? 's' : ''}`
                : 'You can invite friends after creating.'}
            </p>

            <input
              type="text"
              autoFocus
              placeholder="e.g. Morning Grind, Leg Day Legends…"
              value={crewName}
              onChange={e => setCrewName(e.target.value)}
              onBlur={() => {
                // Smart title-case on blur — crew names like "morning
                // grind" become "Morning Grind". Stop words and
                // acronyms preserved per the standard rules.
                const cleaned = titleCase(crewName);
                if (cleaned !== crewName) setCrewName(cleaned);
              }}
              maxLength={40}
              className={`w-full bg-secondary rounded-2xl px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30 text-center font-semibold ${
                crewName && containsProfanity(crewName) ? 'ring-2 ring-destructive' : ''
              }`}
            />
            {/* Live profanity check — catches at creation rather than
                after the fact, saving the team moderation work. The
                Create button below is also disabled in this state. */}
            {crewName && containsProfanity(crewName) && (
              <p className="text-[11px] text-destructive mt-1.5 px-1 text-center">
                Please choose a different name.
              </p>
            )}
            <p className="text-right text-[10px] text-muted-foreground mt-1 pr-1">
              {crewName.length}/40
            </p>

            <div className="flex-1" />

            <div className="pb-8 pt-4">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleCreate}
                disabled={!crewName.trim() || submitting || containsProfanity(crewName)}
                className="w-full py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: 'hsl(var(--primary))' }}
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? 'Creating…' : 'Create Crew'}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
