// src/components/hub/NewGroupDMModal.jsx
//
// "New group" modal. Multi-select from the viewer's follows + optional
// group name. On Create, calls the create_group_conversation RPC
// (mig 116), then routes the user into the new thread.
//
// Constraints (enforced server-side, surfaced inline):
//   • Min 2 other people (3 total including creator)
//   • Max 9 other people (10 total cap; larger groups should be a Crew)

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { Users, X, Loader2, Search } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { handle } from '@/lib/userDisplay';
import * as hubFollows from '@/lib/data/hubFollows';
import * as users from '@/lib/data/users';
import { createGroupConversation } from '@/lib/data/hubMessages';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

const MAX_OTHERS = 9;

export default function NewGroupDMModal({ open, onClose, onCreated }) {
  const { tFallback } = useLanguage();
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]); // array of emails
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setQuery('');
      setSelected([]);
    }
  }, [open]);

  // listFollowingPairs returns { id, email } — NOT hub_follows rows.
  //
  // This used to call listFollowing() and read `.followee_email` /
  // `.username` / `.avatar_url` off each entry, but that function returns
  // an Array<string> of emails: every one of those reads was undefined, so
  // every row fell out of the trailing `.filter(f => f.email)` and the
  // picker rendered "Follow some people to start a group" at users who
  // follow plenty of people. Group DMs could not be created at all. Same
  // defect HubMessages fixed in its partition query (audit 10 #1); this
  // copy of it was missed.
  //
  // Display info is resolved by id against public_profiles — the address
  // itself is never shown, only used to build the group.
  const { data: follows = [], isLoading } = useQuery({
    queryKey: ['myFollowsForGroupDM', user?.email],
    queryFn:  async () => {
      const pairs = await hubFollows.listFollowingPairs(user.email).catch(() => []);
      if (pairs.length === 0) return [];
      const ids = pairs.map(p => p.id).filter(Boolean);
      const byId = {};
      if (ids.length > 0) {
        const { data } = await users.selectProfiles((from) => from
          .select('id, username, avatar_url')
          .in('id', ids));
        for (const u of (data ?? [])) byId[u.id] = u;
      }
      return pairs.map(p => ({
        email:    p.email,
        username: byId[p.id]?.username   || null,
        avatar:   byId[p.id]?.avatar_url || null,
      }));
    },
    enabled: !!user?.email && open,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return follows;
    return follows.filter(f =>
      f.email.includes(q) || (f.username || '').toLowerCase().includes(q)
    );
  }, [follows, query]);

  const toggle = (email) => {
    setSelected(curr => {
      if (curr.includes(email)) return curr.filter(e => e !== email);
      if (curr.length >= MAX_OTHERS) {
        toast.error('That\'s the most people a group DM can hold. Create a Crew for larger groups.');
        return curr;
      }
      return [...curr, email];
    });
  };

  const handleCreate = async () => {
    if (selected.length < 2) {
      toast.error('Pick at least 2 other people.');
      return;
    }
    setCreating(true);
    try {
      const convId = await createGroupConversation(selected, title.trim() || null);
      onCreated?.(convId);
      onClose?.();
    } catch (err) {
      const code = err?.code || '';
      if (code === '22023') toast.error('Group must have 3–10 people total.');
      else toast.error(`Could not create: ${err?.message || 'try again'}`);
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[9999] bg-black/55 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-xl"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="font-heading font-bold text-base flex items-center gap-2">
            <Users className="w-4 h-4" /> {tFallback("newGroupDMModal.newGroup", "New group")}
          </h2>
          <button onClick={onClose} aria-label={tFallback("common.close", "Close")} className="relative before:absolute before:content-[''] before:-inset-2.5 w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-4 pb-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={tFallback("newGroupDMModal.groupNameOptional", "Group name (optional)")}
            maxLength={60}
            className="w-full px-3 py-2 bg-secondary/40 border border-border rounded-lg text-sm outline-none focus:border-primary/50"
          />
        </div>

        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/40 border border-border">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tFallback("newGroupDMModal.searchPeopleYouFollow", "Search people you follow…")}
              className="flex-1 bg-transparent text-sm outline-none placeholder-muted-foreground/60"
            />
          </div>
        </div>

        {/* Selected chips */}
        {selected.length > 0 && (
          <div className="px-4 pb-2 flex flex-wrap gap-1.5">
            {/* The chip shows the handle, never the address. `selected` is a
                list of emails because that is what createGroupConversation
                takes — but the rows above this already render handle(f), so
                picking someone turned their @name into their email address
                on screen. Following someone is not consent to see it. */}
            {selected.map(email => {
              const f = follows.find(x => x.email === email);
              return (
                <button
                  key={email}
                  onClick={() => toggle(email)}
                  className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30 flex items-center gap-1"
                >
                  {f ? handle(f) : '@athlete'} <X className="w-3 h-3" />
                </button>
              );
            })}
          </div>
        )}

        <div className="px-4 pb-4 max-h-72 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">
              {follows.length === 0
                ? 'Follow some people to start a group.'
                : 'No matches.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {filtered.map(f => {
                const isSel = selected.includes(f.email);
                return (
                  <li key={f.email}>
                    <button
                      onClick={() => toggle(f.email)}
                      className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg transition-colors ${
                        isSel ? 'bg-primary/10' : 'hover:bg-secondary/50 active:bg-secondary/50'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center overflow-hidden">
                        {f.avatar
                          ? <img loading="lazy" src={f.avatar} alt="" className="w-full h-full object-cover" />
                          : (f.username || '?').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0 text-start">
                        <p className="text-sm font-semibold truncate">{handle(f)}</p>
                      </div>
                      <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                        isSel ? 'bg-primary border-primary text-primary-foreground' : 'border-border'
                      }`}>
                        {isSel && <span className="text-xs font-bold">✓</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border">
          <p className="text-xs text-muted-foreground">
            {selected.length}/{MAX_OTHERS} selected · group of {selected.length + 1} total
          </p>
          <button
            onClick={handleCreate}
            disabled={creating || selected.length < 2}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50 flex items-center gap-2"
          >
            {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Create group
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
