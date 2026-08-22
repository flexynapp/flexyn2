// src/components/crews/CrewMemberDirectory.jsx
//
// Slide-in member panel. Three ranks: 3 leader > 2 moderator > 1 member.
//
// Which controls a row offers comes from src/lib/crewPermissions.js, so
// this file holds no rank logic of its own — it used to, as
// `currentUserRole === 'leader' && !isSelf && memberRole !== 'leader'`,
// which bundled promote, remove and ban behind one boolean and left
// moderators with nothing. Migration 357 gave moderators the power to
// remove rank-1 members, and a UI that hides a control the server allows
// is the same defect as one that offers a control the server refuses.
//
// Enforcement is 357, not this file. See the header of crewPermissions.js.

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, ShieldCheck, Shield, Trash2, Ban, Loader2, Crown } from 'lucide-react';
import { toast } from '@/lib/toast';
import * as crewsData from '@/lib/data/crews';
import { banMember } from '@/lib/data/crewMembership';
import { useQueryClient } from '@tanstack/react-query';
import CrewJoinRequests from './CrewJoinRequests';
import CrewTreasuryPanel from './CrewTreasuryPanel';
import { useLanguage } from '@/lib/LanguageContext';
import {
  RANK, rankOf, can, canActOn, assignableRanks,
} from '@/lib/crewPermissions';

// The moderator badge was #f59e0b — a fifth hue, against the four-hue rule
// in CLAUDE.md. --info carries "this person holds a position" without
// inventing a colour, and matches the rank pills on the Penpot
// "Crew Manage" page.
// `label` is the English fallback for `crewRank.<role>`, resolved below.
const ROLE_LABELS = {
  leader:    { label: 'Leader', color: 'hsl(var(--primary))', bg: 'hsl(var(--primary) / 0.12)' },
  moderator: { label: 'Mod',    color: 'hsl(var(--info))',    bg: 'hsl(var(--info) / 0.12)' },
  member:    { label: null,     color: null,                  bg: null },
};

function RoleBadge({ role }) {
  const { tFallback } = useLanguage();
  const cfg = ROLE_LABELS[role];
  if (!cfg?.label) return null;
  return (
    <span
      className="text-xs font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
      style={{ color: cfg.color, background: cfg.bg }}
    >
      <ShieldCheck className="w-2.5 h-2.5" />
      {tFallback(`crewRank.${role}`, cfg.label)}
    </span>
  );
}

function MemberRow({ member, profile, myRank, isSelf, crewId, onViewProfile }) {
  const { tFallback } = useLanguage();
  const [busy,     setBusy]     = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const qc = useQueryClient();

  const username  = profile?.username || member.user_id.slice(0, 8);
  const memberRole = member.role ?? (member.is_admin ? 'leader' : 'member');

  // Each control asks its own question rather than sharing one boolean.
  // A moderator may remove a rank-1 member and nothing else; a leader may
  // also change ranks and ban. Nobody may act on a peer — canActOn is
  // strictly greater — so two moderators cannot eject each other.
  const targetRank = rankOf(member);
  const assignable = isSelf ? [] : assignableRanks(myRank, targetRank);
  const mayRemove  = !isSelf && can(myRank, 'KICK_MEMBER') && canActOn(myRank, targetRank);
  const mayBan     = !isSelf && myRank === RANK.LEADER && canActOn(myRank, targetRank);
  // Handing over the crew is not a rank change and is not in the picker —
  // it is its own confirmed action, because the leader loses their own
  // powers the moment it lands and cannot undo it themselves.
  const mayHandOver = !isSelf
    && can(myRank, 'TRANSFER_LEADERSHIP')
    && canActOn(myRank, targetRank);
  const canManage  = assignable.length > 0 || mayRemove || mayBan || mayHandOver;

  const doAction = async (fn, successMsg) => {
    setBusy(true);
    setRoleOpen(false);
    try {
      await fn();
      toast.success(successMsg);
      qc.invalidateQueries({ queryKey: ['crewMembers', crewId] });
    } catch {
      toast.error(tFallback('crewMembers.actionFailed', 'Action failed. Try again.'));
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
        // `id`, not `email`. public_profiles has had no email column since
        // mig 220, so `profile.email` was always undefined and HubProfile —
        // which is id-first — disabled every one of its queries and rendered
        // the placeholder header. `member.user_id` is the crew row's own key
        // and is NOT NULL, so it is right even when the profile join missed.
        onClick={() => onViewProfile?.({ id: member.user_id, username: profile?.username, avatar_url: profile?.avatar_url })}
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
          {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
        </div>
      </div>

      {/* Leader actions */}
      {canManage && (
        <div className="flex items-center gap-1 shrink-0">
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              {/* Role picker — leader only, and never offers LEADER:
                  handing over the crew is a transfer, not a list row. */}
              {assignable.length > 0 && <div className="relative">
                <button
                  onClick={() => setRoleOpen(v => !v)}
                  className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
                  title={tFallback("crewMemberDirectory.changeRole", "Change role")}
                >
                  <Shield className="w-3.5 h-3.5" />
                </button>
                {roleOpen && (
                  <div className="absolute end-0 top-8 z-30 w-36 bg-card border border-border rounded-xl shadow-lg overflow-hidden">
                    {assignable.map(r => (
                      <button
                        key={r}
                        onClick={() => setRole(r === RANK.MODERATOR ? 'moderator' : 'member')}
                        className="w-full text-start px-3 py-2 text-xs font-semibold transition-colors hover:bg-secondary active:bg-secondary"
                      >
                        {r === RANK.MODERATOR
                          ? tFallback('crew.rank.makeModerator', 'Make Moderator')
                          : tFallback('crew.rank.makeMember', 'Make Member')}
                      </button>
                    ))}
                  </div>
                )}
              </div>}

              {/* Remove — they can come straight back if the crew is
                  public, which is the point of the separate Ban below. */}
              {mayRemove && <button
                onClick={() => doAction(
                  () => crewsData.removeMember(crewId, member.user_id),
                  'Member removed.'
                )}
                className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-destructive/70 hover:text-destructive active:text-destructive transition-colors"
                title={tFallback("crewMemberDirectory.removeFromCrew", "Remove from crew")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>}

              {/* Ban — removes AND blocks rejoining. Before migration 250
                  "remove" was reversible by the person being removed, which
                  made moderating a public crew impossible. Confirmed first
                  because unbanning is a different screen. */}
              {mayHandOver && <button
                onClick={() => {
                  if (!window.confirm(
                    `Make ${username} the leader of this crew?\n\n`
                    + `You become a Member. Only they will be able to hand it back.`
                  )) return;
                  doAction(
                    () => crewsData.transferLeadership(crewId, member.user_id),
                    `${username} now leads the crew.`,
                  );
                }}
                className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-primary/70 hover:text-primary active:text-primary transition-colors"
                title={tFallback("crewMemberDirectory.transferLeadership", "Transfer leadership")}
              >
                <Crown className="w-3.5 h-3.5" />
              </button>}

              {mayBan && <button
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
                className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-destructive/70 hover:text-destructive active:text-destructive transition-colors"
                title={tFallback("crewMemberDirectory.banFromCrew", "Ban from crew")}
              >
                <Ban className="w-3.5 h-3.5" />
              </button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function CrewMemberDirectory({ crewId, members, profilesByUserId, currentUserId, isCurrentAdmin, maxCapacity, inline, onClose, onViewProfile }) {
  const { tFallback } = useLanguage();
  // `inline` renders the roster as a normal block inside the Crew page's
  // tab instead of a slide-in overlay. The panel form is kept because
  // CrewChat still opens it from its own header when it isn't embedded.
  //
  // profilesByUserId is optional now: getCrewMembers already enriches each
  // row with username and avatar_url, so the Crew page passes nothing and
  // the member row falls back to its own fields.
  const profiles = profilesByUserId ?? {};
  // Determine current user's role
  const currentMember = members.find(m => m.user_id === currentUserId);
  // Numeric rank drives every control below. Falls back to the caller's
  // isCurrentAdmin when the roster row for the viewer has not arrived —
  // rankOf(undefined) is 0, which would strip a real leader's controls
  // for as long as the query is in flight.
  const myRank = currentMember
    ? rankOf(currentMember)
    : (isCurrentAdmin ? RANK.LEADER : RANK.MEMBER);

  // Sort: leaders first, then moderators, then members, then by join date
  const roleOrder = { leader: 0, moderator: 1, member: 2 };
  const sorted = [...members].sort((a, b) => {
    const ra = roleOrder[a.role ?? (a.is_admin ? 'leader' : 'member')] ?? 2;
    const rb = roleOrder[b.role ?? (b.is_admin ? 'leader' : 'member')] ?? 2;
    return ra - rb;
  });

  const Wrapper = inline ? 'div' : motion.div;
  const wrapperProps = inline
    ? { className: 'h-full min-h-0 flex flex-col' }
    : {
        initial: { x: '100%' },
        animate: { x: 0 },
        exit: { x: '100%' },
        transition: { type: 'spring', damping: 30, stiffness: 300 },
        className: 'absolute inset-0 bg-background z-20 flex flex-col',
      };

  return (
    <Wrapper {...wrapperProps}>
      {/* Header — only in the overlay form. Inline, the Crew page header
          already names the crew and the tab already says Roster, so this
          would be a second title for the same thing. */}
      {!inline && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div>
            <h3 className="font-heading font-bold text-base">{tFallback("crewChat.members", "Members")}</h3>
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
      )}

      {/* Pending approvals sit above the roster: "who wants in" is the
          only thing on this screen that's waiting on the leader. Self-hides
          for non-leaders and when the queue is empty. */}
      <CrewJoinRequests crewId={crewId} canReview={myRank >= RANK.MODERATOR} />

      {/* Treasury sits between "who wants in" and "who's in": both are crew
          management, and the seat count the perks buy is the number the
          roster header is showing. Members see the balance; only leaders
          get a buy control. */}
      <CrewTreasuryPanel crewId={crewId} isLeader={myRank === RANK.LEADER} />

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 divide-y divide-border/50">
        {sorted.map(member => (
          <MemberRow
            key={member.id}
            member={member}
            profile={profiles[member.user_id] ?? member}
            myRank={myRank}
            isSelf={member.user_id === currentUserId}
            crewId={crewId}
            onViewProfile={onViewProfile}
          />
        ))}
      </div>
    </Wrapper>
  );
}
