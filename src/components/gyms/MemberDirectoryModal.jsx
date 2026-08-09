// src/components/gyms/MemberDirectoryModal.jsx
//
// Modal listing every member of a gym, newest joins on top. Opens
// from the gym header's member-count chip. Owners get a small Crown
// next to their handle to set expectations about who's in charge.

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { X, Users, Loader2, Crown, Flame } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { listGymMembers } from '@/lib/data/gymBusinesses';
import EmptyState from '@/components/EmptyState';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

export default function MemberDirectoryModal({ open, onClose, gymId, gymOwnerId }) {
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);
  const navigate = useNavigate();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !gymId) return;
    setLoading(true);
    listGymMembers(gymId).then(rows => {
      setMembers(rows);
      setLoading(false);
    });
  }, [open, gymId]);

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[9999] bg-black/55 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4"
      >
        <motion.div
          initial={{ y: 24 }} animate={{ y: 0 }} exit={{ y: 24 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
          style={{ maxHeight: '85vh' }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <h2 className="font-heading font-bold text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Members
              {!loading && members.length > 0 && (
                <span className="text-xs text-muted-foreground font-normal tabular-nums">
                  · {members.length}
                </span>
              )}
            </h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-7 h-7 rounded-full bg-secondary text-muted-foreground hover:text-foreground active:text-foreground flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : members.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No members yet"
                body="Be the first to share the Flexyn Code with your gym crew."
              />
            ) : (
              <ul className="space-y-1.5">
                {members.map(m => {
                  const isOwner = m.user_id === gymOwnerId;
                  const handle = m.username || 'member';
                  // Members who haven't set a username can't be linked
                  // to via the /@:username route. Disable the button so
                  // the row still shows the user's info but doesn't
                  // look broken when tapped. (Audit 12 #46.)
                  const hasUsername = !!m.username;
                  return (
                    <li key={m.user_id}>
                      <button
                        type="button"
                        disabled={!hasUsername}
                        onClick={() => {
                          if (!hasUsername) return;
                          onClose();
                          navigate(`/@${m.username}`);
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-start transition-colors ${hasUsername ? 'hover:bg-secondary/40 active:bg-secondary/40 cursor-pointer' : 'cursor-default opacity-70'}`}
                        title={hasUsername ? `Open @${m.username}` : 'This member hasn’t set a username yet'}
                      >
                        {m.avatar_url
                          ? <img loading="lazy" src={m.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
                          : <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground">
                              {handle[0]?.toUpperCase() || '?'}
                            </div>}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold truncate">@{handle}</span>
                            {isOwner && (
                              <Crown className="w-3 h-3 text-amber-500 shrink-0" title="Gym owner" />
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-micro text-muted-foreground">
                            {m.workout_streak > 0 && (
                              <span className="inline-flex items-center gap-0.5">
                                <Flame className="w-2.5 h-2.5 text-orange-500" />
                                <span className="tabular-nums">{m.workout_streak}</span>
                              </span>
                            )}
                            <span>
                              Joined {(() => {
                                try { return format(parseISO(m.joined_at), 'MMM d, yyyy'); }
                                catch { return ''; }
                              })()}
                            </span>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
