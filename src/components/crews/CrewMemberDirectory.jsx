// src/components/crews/CrewMemberDirectory.jsx
//
// Slide-in member panel. Admins first, [Admin] tag, remove/promote controls.

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, ShieldCheck, Trash2, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import * as crewsData from '@/lib/data/crews';
import { useQueryClient } from '@tanstack/react-query';

function MemberRow({ member, profile, isCurrentAdmin, isSelf, crewId, onViewProfile }) {
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  const username = profile?.username || member.user_id.slice(0, 8);

  const doAction = async (fn, successMsg) => {
    setBusy(true);
    try {
      await fn();
      toast.success(successMsg);
      qc.invalidateQueries({ queryKey: ['crewMembers', crewId] });
    } catch {
      toast.error('Action failed — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 py-2.5">
      {/* Avatar */}
      <button
        onClick={() => onViewProfile?.({ email: profile?.email, username: profile?.username, avatar_url: profile?.avatar_url })}
        className="shrink-0"
      >
        {profile?.avatar_url ? (
          <img src={profile.avatar_url} className="w-9 h-9 rounded-full object-cover ring-1 ring-border" alt="" draggable={false} />
        ) : (
          <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground ring-1 ring-border">
            {username.slice(0, 2).toUpperCase()}
          </div>
        )}
      </button>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-foreground truncate">@{username}</span>
          {member.is_admin && (
            <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-0.5">
              <ShieldCheck className="w-3 h-3" /> Admin
            </span>
          )}
          {isSelf && <span className="text-[10px] text-muted-foreground">(you)</span>}
        </div>
      </div>

      {/* Admin actions */}
      {isCurrentAdmin && !isSelf && (
        <div className="flex items-center gap-1 shrink-0">
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              <button
                onClick={() => doAction(
                  () => crewsData.setAdmin(crewId, member.user_id, !member.is_admin),
                  member.is_admin ? 'Admin removed.' : 'Promoted to Admin!'
                )}
                className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                title={member.is_admin ? 'Remove admin' : 'Make admin'}
              >
                {member.is_admin ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => doAction(
                  () => crewsData.removeMember(crewId, member.user_id),
                  'Member removed.'
                )}
                className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-destructive/70 hover:text-destructive transition-colors"
                title="Remove from crew"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function CrewMemberDirectory({ crewId, members, profilesByUserId, currentUserId, isCurrentAdmin, onClose, onViewProfile }) {
  // Admins first, then by join date (already sorted from server)
  const sorted = [...members].sort((a, b) => {
    if (a.is_admin && !b.is_admin) return -1;
    if (!a.is_admin && b.is_admin) return 1;
    return 0;
  });

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="absolute inset-0 bg-background z-20 flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div>
          <h3 className="font-heading font-bold text-base">Members</h3>
          <p className="text-xs text-muted-foreground">{members.length} / 16</p>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 divide-y divide-border/50">
        {sorted.map(member => (
          <MemberRow
            key={member.id}
            member={member}
            profile={profilesByUserId[member.user_id]}
            isCurrentAdmin={isCurrentAdmin}
            isSelf={member.user_id === currentUserId}
            crewId={crewId}
            onViewProfile={onViewProfile}
          />
        ))}
      </div>
    </motion.div>
  );
}
