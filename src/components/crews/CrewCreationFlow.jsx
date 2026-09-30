// src/components/crews/CrewCreationFlow.jsx
//
// Two-step wizard: (1) pick friends to invite, (2) name the crew.
// After submit: createCrew → DM invites to all selected friends.

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowLeft, ArrowRight, Shield, Check, Loader2, Search, Globe2, Lock } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import * as crewsData from '@/lib/data/crews';
import * as crewMembership from '@/lib/data/crewMembership';
import * as hubFollows from '@/lib/data/hubFollows';
import * as users from '@/lib/data/users';
import { containsProfanity } from '@/lib/profanityFilter';
import { titleCase } from '@/lib/textCase';
import * as hubMessages from '@/lib/data/hubMessages';
import { buildCrewInviteBody } from '@/lib/crewInviteBody';
import { displayName, handle } from '@/lib/userDisplay';
import { useLanguage } from '@/lib/LanguageContext';

export default function CrewCreationFlow({ onCreated, onClose }) {
  const { tFallback } = useLanguage();
  const { user } = useAuth();
  const [step, setStep]         = useState(1);
  const [selected, setSelected] = useState([]); // array of profile objects
  const [crewName, setCrewName] = useState('');
  // Defaults to application-gated, which is what create_crew_atomic stores
  // anyway (crews.is_public defaults to false). Choosing the open option is
  // therefore the only branch that has to do extra work.
  const [isPublic, setIsPublic] = useState(false);
  const [query, setQuery]       = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Load following list (id-keyed) + their profiles
  const { data: followingIds = [] } = useQuery({
    queryKey: ['followingIds', user?.id],
    queryFn:  () => hubFollows.listFollowingIds(user.id),
    enabled:  !!user?.id,
    staleTime: 60_000,
  });

  const { data: allProfiles = [] } = useQuery({
    queryKey: ['allProfiles'],
    queryFn:  () => users.list(),
    staleTime: 120_000,
  });

  const friends = allProfiles
    .filter(p => followingIds.includes(p.id) && p.id !== user?.id)
    .filter(p => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (p.username || '').toLowerCase().includes(q);
    });

  const toggle = (profile) => {
    setSelected(prev => {
      const has = prev.some(p => p.id === profile.id);
      if (has) return prev.filter(p => p.id !== profile.id);
      // toast.warning, not toast(): src/lib/toast.js drops a plain toast that
      // carries no action, so this refusal has never reached anyone — the
      // 16th tap just did nothing. Same defect class as the 2026-08-04/05
      // sweeps documented in CLAUDE.md's toast policy.
      if (prev.length >= 15) {
        toast.warning(tFallback('crewCreationFlow.maxMembers', 'Max 15 people per crew.'));
        return prev;
      }
      return [...prev, profile];
    });
  };

  // Synchronous in-flight guard. Without this, a fast double-tap on
  // "Create crew" could fire crewsData.createCrew twice before
  // `submitting` state propagated, producing two duplicate crews +
  // two sets of invite DMs to every selected friend.
  const createRef = useRef(false);

  const handleCreate = async () => {
    if (!crewName.trim()) {
      toast.warning(tFallback('crewCreationFlow.nameRequired', 'Name your crew first!'));
      return;
    }
    if (submitting || createRef.current) return;
    createRef.current = true;
    setSubmitting(true);
    try {
      const crew = await crewsData.createCrew(user, crewName.trim());

      // create_crew_atomic takes only (p_name text) — checked against the
      // installed signature, not the migration — so visibility is a second
      // statement rather than an argument. Deliberately not fatal and
      // deliberately second: the crew already exists and the founder is its
      // leader, so a failure here leaves it application-gated, which is the
      // safe direction and is fixable from the crew settings sheet. Failing
      // the whole creation over it would be worse.
      if (isPublic) {
        try {
          await crewsData.updateCrewProfile(crew.id, { is_public: true });
          crew.is_public = true;
        } catch {
          toast.warning(tFallback('crewCreationFlow.visibilityFailed', 'Crew created, but people will have to apply to join. You can change that in crew settings.',
          ));
        }
      }

      // Send DM invite to each selected friend
      const { data: myProfile } = await supabase
        .from('user_profiles')
        .select('username, avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      const inviterName   = myProfile?.username || 'Someone';
      const inviterAvatar = myProfile?.avatar_url || null;
      const inviteBody    = buildCrewInviteBody(crew.id, crew.name, inviterName, inviterAvatar);

      // Bind each invite to the PERSON before the DM that announces it.
      //
      // Until this call existed, `crew_invites` had never held a single row,
      // so a DM invite was not an invite: join_crew_atomic takes the
      // invite-bypass branch only for a live unexpired row, and every crew in
      // production is application-gated, so an invited friend landed in the
      // review queue behind the strangers. Verified against production —
      // private crew, no invite: status 'requested'; same crew with an invite
      // row: status 'joined', and the row is stamped accepted_at.
      //
      // Ordering is load-bearing and free: the row must exist before the
      // message arrives, or a friend who taps Accept immediately still files
      // a request. The invite is also independent of the DM — if the message
      // fails the person can still join, and if the invite fails the DM still
      // goes and degrades to the application it used to be.
      const inviteFailures = [];
      await Promise.allSettled(
        selected.map(async (friend) => {
          try {
            const inv = await crewMembership.inviteToCrew(crew.id, friend.id);
            if (!inv?.ok) inviteFailures.push(inv?.reason || 'db_error');
          } catch { inviteFailures.push('db_error'); }

          try {
            const conv = await hubMessages.findOrCreateConversation(user.email, friend.id);
            if (conv) {
              await hubMessages.sendMessage({
                conversationId: conv.id,
                senderEmail:    user.email,
                recipientId:    friend.id,
                body:           inviteBody,
              });
            }
          } catch { /* non-fatal */ }
        })
      );

      toast.success(tFallback('notice.crewCreated', '{name} created!', { name: crew.name }));

      // Said once, after the success, and only when it is true. Those friends
      // are not lost — their DM still arrives and the card files a request —
      // but they will be waiting on a review the founder thinks they skipped.
      if (inviteFailures.length) {
        toast.warning(tFallback(
          'crewCreationFlow.inviteFailed',
          '{n} of your invites could not be sent. Those friends will have to apply instead.',
          { n: inviteFailures.length },
        ));
      }
      onCreated?.(crew);
    } catch (err) {
      toast.error(err?.message || tFallback('crewCreationFlow.createFailed', 'Could not create crew. Try again.'));
    } finally {
      createRef.current = false;
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
          <h3 className="font-heading font-bold text-base">{tFallback("crewCreationFlow.createCrew", "Create Crew")}</h3>
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
                {tFallback('crewCreationFlow.inviteHint', 'Invite up to 15 friends. You can add more later.')}
              </p>
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder={tFallback("crewCreationFlow.searchFriends", "Search friends…")}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="w-full bg-secondary rounded-xl ps-9 pe-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            {/* Selected pills */}
            {selected.length > 0 && (
              <div className="px-4 pb-2 flex flex-wrap gap-1.5 shrink-0">
                {selected.map(p => (
                  <button
                    key={p.id}
                    onClick={() => toggle(p)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-white gap-1"
                    style={{ background: 'hsl(var(--primary))' }}
                  >
                    {handle(p)}
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
                  const isSelected = selected.some(s => s.id === p.id);
                  const username = displayName(p);
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggle(p)}
                      className="w-full flex items-center gap-3 py-2.5 text-start"
                    >
                      <div className="relative shrink-0">
                        {p.avatar_url ? (
                          <img loading="lazy" src={p.avatar_url} className="w-9 h-9 rounded-full object-cover" alt="" draggable={false} />
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
                {tFallback("common.next", "Next")}
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
            // overflow-y-auto because the visibility picker added ~180px to a
            // step that previously fit any viewport by construction. Without
            // it the Create button is pushed below the fold on a 390x640
            // device and the wizard has no way forward.
            className="flex-1 flex flex-col px-4 pt-6 min-h-0 overflow-y-auto"
          >
            {/* Icon */}
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5 mx-auto"
              style={{ background: 'hsl(var(--primary) / 0.12)' }}
            >
              <Shield className="w-8 h-8" style={{ color: 'hsl(var(--primary))' }} />
            </div>

            <h4 className="text-center font-heading font-bold text-lg mb-1">{tFallback("crewCreationFlow.nameYourCrew", "Name Your Crew")}</h4>
            <p className="text-center text-sm text-muted-foreground mb-6">
              {selected.length > 0
                ? `Inviting ${selected.length} friend${selected.length > 1 ? 's' : ''}`
                : 'You can invite friends after creating.'}
            </p>

            <input
              type="text"
              autoFocus
              placeholder={tFallback('crewCreationFlow.namePlaceholder', 'e.g. Morning Grind, Leg Day Legends…')}
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
              <p className="text-xs text-destructive mt-1.5 px-1 text-center">
                {tFallback('crewCreationFlow.chooseAnotherName', 'Please choose a different name.')}
              </p>
            )}
            <p className="text-end text-xs text-muted-foreground mt-1 pe-1">
              {crewName.length}/40
            </p>

            {/* Who can join. Same two options and the same wording as the
                crew settings sheet, because they set the same column and a
                leader who learns the words here should recognise them there.
                Copy is written from what join_crew_atomic does: is_public
                inserts the member row, otherwise it files a join request. */}
            <div className="mt-6">
              <p className="text-sm font-bold mb-2">
                {tFallback('crewSettings.visibility', 'Who can join')}
              </p>
              <div role="radiogroup" className="flex flex-col gap-2">
                {[
                  {
                    open: true,
                    icon: <Globe2 className="w-4 h-4" aria-hidden="true" />,
                    title: tFallback('crewSettings.public', 'Open'),
                    body: tFallback('crewSettings.publicBody', 'Anyone can join straight away.'),
                  },
                  {
                    open: false,
                    icon: <Lock className="w-4 h-4" aria-hidden="true" />,
                    title: tFallback('crewSettings.private', 'By application'),
                    body: tFallback('crewSettings.privateBody', 'People ask to join and you decide.'),
                  },
                ].map(opt => (
                  <button
                    key={String(opt.open)}
                    type="button"
                    role="radio"
                    aria-checked={isPublic === opt.open}
                    onClick={() => setIsPublic(opt.open)}
                    className={`w-full text-start flex items-start gap-2 p-3 rounded-2xl border transition-colors ${
                      isPublic === opt.open ? 'border-primary bg-primary/10' : 'border-border'
                    }`}
                  >
                    <span className={`shrink-0 mt-0.5 ${isPublic === opt.open ? 'text-primary' : 'text-muted-foreground'}`}>
                      {opt.icon}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1">
                        <span className="text-sm font-bold">{opt.title}</span>
                        {isPublic === opt.open && <Check className="w-3.5 h-3.5 text-primary" aria-hidden="true" />}
                      </span>
                      <span className="block text-xs text-muted-foreground">{opt.body}</span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {tFallback(
                  'crewSettings.listedEither',
                  'Your crew is listed in the directory either way.',
                )}
              </p>
            </div>

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
