// src/components/crews/CrewMemberDirectory.jsx
//
// Slide-in member panel. Roles: leader > moderator > member.
// Leaders can promote/demote to any role, or remove members.
// Moderators are displayed with a badge but cannot manage other roles.

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, ShieldCheck, Shield, Trash2, Ban, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import * as crewsData from '@/lib/data/crews';
import { banMember } from '@/lib/data/crewMembership';
import { useQueryClient } from '@tanstack/react-query';
import CrewJoinRequests from './CrewJoinRequests';
import CrewTreasuryPanel from './CrewTreasuryPanel';

const ROLE_LABELS = {
  leader:    { label: 'Leader',    color: 'hsl(var(--primary))',   bg: 'hsl(var(--primary) / 0.12)' },
  moderator: { label: 'Mod',       color: '#f59e0b',               bg: 'rgba(245,158,11,0.12)' },
  member:    { label: null,         color: null,                    bg: null },
};

function RoleBadge({ role }) {
  const cfg = ROLE_LABELS[role];
  if (!cfg?.label) return null;
  return (
    <span
      className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
      style={{ color: cfg.color, background: cfg.bg }}
    >
      <ShieldCheck className="w-2.5 h-2.5" />
      {cfg.label}
    </span>
  );
}

function MemberRow({ member, profile, currentUserRole, isSelf, crewId, onViewProfile }) {
  const [busy,     setBusy]     = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const qc = useQueryClient();

  const username  = profile?.username || member.user_id.slice(0, 8);
  const memberRole = member.role ?? (member.is_admin ? 'leader' : 'member');
  const canManage = currentUserRole === 'leader' && !isSelf && memberRole !== 'leader';

  const doAction = async (fn, successMsg) => {
    setBusy(true);
    setRoleOpen(false);
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

  const setRole = (role) =>
    doAction(
      () => crewsData.setMemberRole(crewId, member.user_id, role),
      role === 'moderator' ? 'Promoted to Moderator!' : 'Role updated.'
    );

  return (
    <div className="flex items-center gap-3 py-2.5 relative">
      {/* Avatar */}
      <button
        onClick={() => onViewProfile?.({ email: profile?.email, username: profile?.username, avatar_url: profile?.avatar_url })}
        className="shrink-0"
      >
        {profile?.avatar_url ? (
          <img loading="lazy" src={profile.avatar_url} className="w-9 h-9 rounded-full object-cover ring-1 ring-border" alt="" draggable={false} />
        ) : (
          <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground ring-1 ring-border">
            {username.slice(0, 2).toUpperCase()}
          </div>
        )}
      </button>

      {/* Name + role */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-foreground truncate">@{username}</span>
          <RoleBadge role={memberRole} />
          {isSelf && <span className="text-[10px] text-muted-foreground">(you)</span>}
        </div>
      </div>

      {/* Leader actions */}
      {canManage && (
        <div className="flex items-center gap-1 shrink-0">
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              {/* Role picker */}
              <div className="relative">
                <button
                  onClick={() => setRoleOpen(v => !v)}
                  className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  title="Change role"
                >
                  <Shield className="w-3.5 h-3.5" />
                </button>
                {roleOpen && (
                  <div className="absolute end-0 top-8 z-30 w-36 bg-card border border-border rounded-xl shadow-lg overflow-hidden">
                    {(['moderator', 'member']).map(r => (
                      <button
                        key={r}
                        onClick={() => setRole(r)}
                        disabled={memberRole === r}
                        className={`w-full text-start px-3 py-2 text-xs font-semibold transition-colors hover:bg-secondary ${memberRole === r ? 'opacity-40' : ''}`}
                      >
                        {r === 'moderator' ? '⚡ Make Moderator' : '👤 Make Member'}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Remove — they can come straight back if the crew is
                  public, which is the point of the separate Ban below. */}
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

              {/* Ban — removes AND blocks rejoining. Before migration 250
                  "remove" was reversible by the person being removed, which
                  made moderating a public crew impossible. Confirmed first
                  because unbanning is a different screen. */}
              <button
                onClick={() => {
                  if (!window.confirm(`Ban ${username}? They'll be removed and can't rejoin.`)) return;
                  doAction(async () => {
                    const res = await banMember(crewId, member.user_id);
                    if (!res?.ok) {
                      throw new Error(res?.reason === 'target_is_leader'
                        ? 'Demote them first.'
                        : 'Could not ban.');
                    }
                  }, `${username} was banned.`);
                }}
                className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-destructive/70 hover:text-destructive transition-colors"
                title="Ban from crew"
              >
                <Ban className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function CrewMemberDirectory({ crewId, members, profilesByUserId, currentUserId, isCurrentAdmin, maxCapacity, onClose, onViewProfile }) {
  // Determine current user's role
  const currentMember = members.find(m => m.user_id === currentUserId);
  const currentUserRole = currentMember?.role ?? (currentMember?.is_admin ? 'leader' : 'member');

  // Sort: leaders first, then moderators, then members, then by join date
  const roleOrder = { leader: 0, moderator: 1, member: 2 };
  const sorted = [...members].sort((a, b) => {
    const ra = roleOrder[a.role ?? (a.is_admin ? 'leader' : 'member')] ?? 2;
    const rb = roleOrder[b.role ?? (b.is_admin ? 'leader' : 'member')] ?? 2;
    return ra - rb;
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
          {/* Not hardcoded 16: the extra_seat perk (migration 251) raises
              the cap to as much as 20, and a header still reading /16 with
              17 members in the list reads as a bug. */}
          <p className="text-xs text-muted-foreground">{members.length} / {maxCapacity ?? 16}</p>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Pending approvals sit above the roster: "who wants in" is the
          only thing on this screen that's waiting on the leader. Self-hides
          for non-leaders and when the queue is empty. */}
      <CrewJoinRequests crewId={crewId} isLeader={currentUserRole === 'leader'} />

      {/* Treasury sits between "who wants in" and "who's in": both are crew
          management, and the seat count the perks buy is the number the
          roster header is showing. Members see the balance; only leaders
          get a buy control. */}
      <CrewTreasuryPanel crewId={crewId} isLeader={currentUserRole === 'leader'} />

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 divide-y divide-border/50">
        {sorted.map(member => (
          <MemberRow
            key={member.id}
            member={member}
            profile={profilesByUserId[member.user_id]}
            currentUserRole={currentUserRole}
            isSelf={member.user_id === currentUserId}
            crewId={crewId}
            onViewProfile={onViewProfile}
          />
        ))}
      </div>
    </motion.div>
  );
}
