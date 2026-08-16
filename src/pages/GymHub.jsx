// src/pages/GymHub.jsx
//
// Individual Gym Hub page (route: /gym/:id). Three tabs:
//   • Feed       — local community posts (gym_feed_posts, member-only RLS)
//   • Events     — upcoming events (gym_events)
//   • Leaderboard — local ranking by volume / XP / streak
//
// Header: gym name + location (when it has one) + member count, then
// the Flexyn Code + QR on any gym that has members — see mig 325 for
// why that is not owner-only.

import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Building2, Users, MapPin, Trophy, Calendar, MessageSquare,
  Loader2, Plus, Crown, Share2, Pencil, LogOut, Trash2, Dumbbell,
  CheckCircle2, QrCode,
} from 'lucide-react';
import { leaveGym, getGymPublicPreview } from '@/lib/data/gymBusinesses';
import { GYM_CHECKIN_XP_MULTIPLIER } from '@/lib/data/gymCheckins';

const GymSignageCard = lazy(() => import('@/components/gyms/GymSignageCard'));
const GymFeedTab            = lazy(() => import('@/components/gyms/GymFeedTab'));
const MemberDirectoryModal  = lazy(() => import('@/components/gyms/MemberDirectoryModal'));
const GymAboutCard          = lazy(() => import('@/components/gyms/GymAboutCard'));
const GymEquipmentTab       = lazy(() => import('@/components/gyms/GymEquipmentTab'));
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/lib/toast';
import { format, parseISO } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import EmptyState from '@/components/EmptyState';
import {
  getGym, getLeaderboard, listEvents, createEvent,
} from '@/lib/data/gymBusinesses';
import { useLanguage } from '@/lib/LanguageContext';

const TABS = [
  { id: 'feed',       label: 'Feed',        Icon: MessageSquare },
  { id: 'events',     label: 'Events',      Icon: Calendar },
  { id: 'equipment',  label: 'Equipment',   Icon: Dumbbell },
  { id: 'leaderboard', label: 'Leaderboard', Icon: Trophy },
];

const LB_MODES = [
  { id: 'volume',      label: 'Volume',      suffix: 'lb' },
  { id: 'consistency', label: 'Consistency', suffix: 'days' },
  { id: 'xp',          label: 'XP',          suffix: 'xp' },
  { id: 'streak',      label: 'Streak',      suffix: 'd' },
];

/**
 * Activity without identity — what a non-member may see (mig 301).
 *
 * Below five members everything but the count is withheld, and the copy
 * says why rather than implying the gym is dead. That threshold is not
 * squeamishness: the roster is visible to members, so at four people an
 * individual's attendance is derivable from the aggregate by
 * subtraction. Names being absent is not what protects anyone here.
 */
function GymActivityPreview({ preview }) {
  if (!preview) return null;

  if (!preview.meetsThreshold) {
    return (
      <div className="mb-4">
        <p className="font-heading font-bold text-2xl tabular-nums leading-none">
          {preview.memberCount}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {preview.memberCount === 1 ? 'member' : 'members'} on Flexyn ·
          too few to show activity yet
        </p>
      </div>
    );
  }

  const peak = Math.max(1, ...preview.shape);
  return (
    <div className="mb-4">
      <p className="text-sm font-semibold mb-1">
        <span className="tabular-nums">{preview.activeMembers}</span> of{' '}
        <span className="tabular-nums">{preview.memberCount}</span> trained this week
      </p>
      {/* Bare day counts, tallest first. No names, no avatars, and
          nothing orderable against the roster — see the RPC. */}
      {preview.shape.length > 0 && (
        <div className="flex items-end justify-center gap-1 h-10 mt-2" aria-hidden="true">
          {preview.shape.map((d, i) => (
            <div key={i} className="w-3 rounded-t bg-primary/70"
              style={{ height: `${Math.max(8, (d / peak) * 100)}%` }} />
          ))}
        </div>
      )}
      <p className="text-micro text-muted-foreground mt-2">
        {preview.sessionCount} sessions · {preview.activeDays} gym days · last 7 days
      </p>
    </div>
  );
}

export default function GymHub() {
  const { tFallback } = useLanguage();
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [gym, setGym] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('feed');
  const [signageOpen, setSignageOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  // Membership check — false until proven true so we don't flash the
  // full member-only feed/leaderboard to a non-member on first render.
  const [isMember, setIsMember] = useState(false);
  // Anonymised activity for non-members (mig 301). Fetched regardless of
  // membership — the RPC is cheap and the block only renders for people
  // who aren't in yet.
  const [preview, setPreview] = useState(null);
  const [membershipChecked, setMembershipChecked] = useState(false);

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    getGymPublicPreview(id).then(p => { if (!cancelled) setPreview(p); });
    return () => { cancelled = true; };
  }, [id]);

  // The map's "View Members" arrives with ?members=1. This page has no
  // members tab — it opens on Feed and the roster is a modal — so
  // without this the button lands two taps short of what it promises.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('members') === '1') {
      setMembersOpen(true);
    }
  }, [id]);

  // A printed-signage QR scan lands on /checkin/<CODE>, which checks the
  // user in and then forwards here — the gym's own page is the thing worth
  // arriving at, and checking in is what the scan DOES rather than where it
  // goes. The result rides along in ?checkin= so the 1.2x day still gets
  // announced instead of being swallowed by the redirect.
  const [checkin, setCheckin] = useState(null); // 'ok' | 'already' | null
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const v = params.get('checkin');
    if (v !== 'ok' && v !== 'already') return;
    setCheckin(v);
    // Strip the param. Otherwise a refresh — or this URL being shared —
    // re-announces a check-in that happened once, hours ago.
    params.delete('checkin');
    const qs = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, [id]);

  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getGym(id).then(g => { setGym(g); setLoading(false); });
  }, [id]);

  // Check membership separately so the gym detail can render while
  // membership resolves. The gym_members table has a public-read RLS
  // so this query is allowed for any authenticated user.
  useEffect(() => {
    if (!id || !user?.id) { setMembershipChecked(true); return; }
    let cancelled = false;
    (async () => {
      const { supabase } = await import('@/api/supabaseClient');
      const { data } = await supabase
        .from('gym_members')
        .select('id')
        .eq('gym_id', id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!cancelled) {
        setIsMember(!!data);
        setMembershipChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [id, user?.id]);

  const isOwner = !!(gym && user?.id && gym.owner_id === user.id);

  // Join from the hub itself (used by the "Join this gym" preview CTA).
  const handleJoinHere = async () => {
    if (!gym || joining) return;
    setJoining(true);
    const { joinByCode } = await import('@/lib/data/gymBusinesses');
    const res = await joinByCode(gym.flexyn_code);
    setJoining(false);
    if (res.ok) {
      toast.success(`Joined ${gym.name}.`);
      setIsMember(true);
    } else {
      toast.error("Couldn't join. Try again.");
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!gym) {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <EmptyState icon={Building2} title={tFallback("gymHub.gymNotFound", "Gym not found")} body="That gym ID doesn't exist or has been deactivated." />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto p-4 pb-24"
    >
      <button
        type="button"
        onClick={() => navigate('/my-gym')}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground active:text-foreground mb-3"
      >
        <ArrowLeft className="w-4 h-4" /> {tFallback("myGym.title", "My Gym")}
      </button>

      {/* Arrived from a signage QR scan — say what the scan bought you. */}
      {checkin && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 mb-4 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-heading font-bold text-sm">
              {checkin === 'already' ? "You're already checked in" : 'Checked in'}
            </p>
            <p className="text-xs text-muted-foreground">
              {GYM_CHECKIN_XP_MULTIPLIER}x XP on today&apos;s workouts.
            </p>
          </div>
          <Button size="sm" onClick={() => navigate('/workout')} className="shrink-0 gap-2">
            <Dumbbell className="w-3.5 h-3.5" /> {tFallback("cardio.live.start", "Start")}
          </Button>
        </div>
      )}

      {/* Header card */}
      <div className="rounded-2xl overflow-hidden border border-border bg-card mb-4">
        {gym.cover_url && (
          <div className="h-32 bg-gradient-to-br from-primary/20 to-violet-500/20 relative">
            <img loading="lazy" src={gym.cover_url} alt="" className="w-full h-full object-cover" />
          </div>
        )}
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              {gym.logo_url
                ? <img loading="lazy" src={gym.logo_url} alt="" className="w-full h-full rounded-2xl object-cover" />
                : <Building2 className="w-6 h-6 text-primary" />}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-heading text-xl font-bold tracking-tight">{gym.name}</h1>
              {/* Only when there IS a location. A community gym promoted
                  from OpenStreetMap often has no address at all, and this
                  rendered unconditionally — so those gyms showed a map pin
                  pointing at an empty string, which reads as a failed load
                  rather than as a gym nobody has filled in yet. */}
              {[gym.street_address, gym.city, gym.state_code].filter(Boolean).length > 0 && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <MapPin className="w-3 h-3 shrink-0" />
                  {[gym.street_address, gym.city, gym.state_code].filter(Boolean).join(', ')}
                </p>
              )}
              <div className="flex items-center gap-3 mt-2 text-xs">
                {/* Tappable only for members. The roster is members-only
                    since mig 301, and this button sits in the HEADER —
                    visible to everyone — so a non-member tapping it got
                    a silently empty directory. That migration's own note
                    claimed listGymMembers was "only rendered on a
                    members-only tab", which was wrong: it is right here.
                    The COUNT stays visible either way; member_count is
                    public and on the map pins already. */}
                {(isMember || isOwner) ? (
                  <button
                    type="button"
                    onClick={() => setMembersOpen(true)}
                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
                    aria-label={tFallback("gymHub.viewMembers", "View members")}
                  >
                    <Users className="w-3 h-3" /> <span className="tabular-nums">{gym.member_count}</span>
                    {(gym.member_count === 1 ? ' member' : ' members')}
                  </button>
                ) : (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Users className="w-3 h-3" /> <span className="tabular-nums">{gym.member_count}</span>
                    {(gym.member_count === 1 ? ' member' : ' members')}
                  </span>
                )}
                {isOwner && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-600 dark:text-amber-300 border border-amber-400/30 font-bold uppercase tracking-wide text-micro">
                    <Crown className="w-2.5 h-2.5" /> {tFallback("gymHub.owner", "Owner")}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* The Flexyn Code, and the QR built from it, used to be
              owner-only. A community gym has no owner BY DESIGN (mig 275)
              — nobody claimed the business — so its code was generated at
              promotion and then shown to nobody, which is the same as not
              having one. It now appears on any gym that has members: a
              code's only power is "join this gym", it is printed on the
              wall of the building it belongs to, and someone has to be
              able to get it there. `isMember` is in the condition because
              member_count is a denormalised counter and a stale zero must
              not hide the code from a person standing in the gym.

              It sits OUTSIDE the header's flex row on purpose. Inside it,
              it was a child of the text column beside the 56px logo, so
              its left edge started 68px in while the action row below
              began at the card's padding — two stacked blocks in one card
              with two different left edges, which is what reads as the
              page being crooked. */}
          {gym.flexyn_code && (isOwner || isMember || (gym.member_count ?? 0) > 0) && (
            <div className="mt-3 rounded-xl bg-primary/10 border border-primary/20 p-2.5">
              <p className="text-micro font-bold uppercase tracking-wider text-primary mb-0.5">
                {isOwner ? 'Your Flexyn Code' : 'Flexyn Code'}
              </p>
              <p className="font-mono text-lg tracking-[0.3em] font-bold text-foreground">{gym.flexyn_code}</p>
              <p className="text-micro text-muted-foreground mt-1 mb-2">
                {isOwner
                  ? 'Members scan or type this inside the gym to join.'
                  : 'Scan or type this inside the gym to join.'}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSignageOpen(true)}
                className="gap-1.5 h-7"
              >
                <QrCode className="w-3 h-3" />
                {tFallback("gymHub.qrAndSignage", "QR code & signage")}
              </Button>
            </div>
          )}

          {/* Action row — share / edit (owner) / leave (member) */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/60">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const shareUrl = `${window.location.origin}/gym/${gym.id}`;
                const text = `Join me at ${gym.name} on Flexyn — code ${gym.flexyn_code}`;
                if (navigator.share) {
                  try {
                    await navigator.share({ title: gym.name, text, url: shareUrl });
                    return;
                  } catch (err) {
                    if (err?.name === 'AbortError') return;
                  }
                }
                try {
                  await navigator.clipboard.writeText(`${text}\n${shareUrl}`);
                  toast.success('Copied to clipboard.');
                } catch {
                  toast.error("Couldn't share or copy.");
                }
              }}
              className="gap-1.5"
            >
              <Share2 className="w-3.5 h-3.5" /> {tFallback("common.share", "Share")}
            </Button>
            {isOwner && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/gym/${gym.id}/edit`)}
                className="gap-1.5"
              >
                <Pencil className="w-3.5 h-3.5" /> {tFallback("coach.plan.edit", "Edit")}
              </Button>
            )}
            {!isOwner && isMember && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (!confirm(`Leave ${gym.name}?`)) return;
                  const res = await leaveGym(gym.id);
                  if (res.ok) {
                    toast.success('Left gym.');
                    navigate('/my-gym');
                  } else {
                    toast.error("Couldn't leave. Try again.");
                  }
                }}
                className="gap-1.5 text-muted-foreground hover:text-destructive active:text-destructive"
              >
                <LogOut className="w-3.5 h-3.5" /> {tFallback("gymHub.leave", "Leave")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* About — hours, amenities, photos, description. Auto-hides
          when nothing has been set. Lazy-loaded since most gym
          visits won't need to crack open the chunk. */}
      <Suspense fallback={null}>
        <GymAboutCard gym={gym} />
      </Suspense>

      {/* Non-member preview — when you arrive from the map or a
          shared link without belonging to the gym yet, the feed /
          events / leaderboard are RLS-empty anyway. Skip the tabs
          entirely and render a clean "join to unlock" preview
          instead. Owners always count as members for this check. */}
      {/* p-4, not p-5. The header card above it is p-4, so a 20px inset
          here put the two cards' contents on left edges 4px apart — close
          enough to look like a mistake rather than a choice, which is
          exactly how a page reads as crooked. */}
      {membershipChecked && !isMember && !isOwner && (
        <div className="rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-4 text-center">
          {/* Activity WITHOUT identity (mig 301). This used to be a flat
              "join to unlock", which asks someone to commit to a gym
              before telling them whether anyone trains there. */}
          <GymActivityPreview preview={preview} />
          <p className="text-sm text-muted-foreground mb-3">
            Join to access the local feed, events, and member leaderboard.
          </p>
          <Button onClick={handleJoinHere} disabled={joining} className="gap-2 px-6">
            {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />}
            {joining ? 'Joining…' : 'Join this gym'}
          </Button>
        </div>
      )}

      {(isMember || isOwner) && (
        <>
          <div className="flex gap-1 border-b border-border mb-4">
            {TABS.map(({ id: tid, label, Icon }) => (
              <button
                key={tid}
                type="button"
                onClick={() => setTab(tid)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  tab === tid
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground active:text-foreground'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {tFallback(`gymHub.tab.${tid}`, label)}
              </button>
            ))}
          </div>

          {tab === 'feed' && (
            <Suspense fallback={<div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}>
              <GymFeedTab gymId={id} gymOwnerId={gym?.owner_id} />
            </Suspense>
          )}
          {/* Only the gym owner can create/delete events. The previous
              hardcoded canCreate={true} let every member spin up + delete
              events — confusing at best, abusable at worst. (Audit 12 #7.) */}
          {tab === 'events'      && <EventsTab      gymId={id} canCreate={!!user?.id && gym?.owner_id === user.id} gymOwnerId={gym?.owner_id} />}
          {tab === 'equipment' && (
            <Suspense fallback={<div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}>
              <GymEquipmentTab gymId={id} gymOwnerId={gym?.owner_id} isMember={isMember} />
            </Suspense>
          )}
          {tab === 'leaderboard' && <LeaderboardTab gymId={id} meUserId={user?.id} />}
        </>
      )}

      {signageOpen && (
        <Suspense fallback={null}>
          <GymSignageCard
            open={signageOpen}
            onClose={() => setSignageOpen(false)}
            gym={gym}
          />
        </Suspense>
      )}
      {membersOpen && (
        <Suspense fallback={null}>
          <MemberDirectoryModal
            open={membersOpen}
            onClose={() => setMembersOpen(false)}
            gymId={gym.id}
            gymOwnerId={gym.owner_id}
          />
        </Suspense>
      )}
    </motion.div>
  );
}

// ── Events Tab ──────────────────────────────────────────────────────
function EventsTab({ gymId, canCreate, gymOwnerId }) {
  const { tFallback } = useLanguage();
  const { user } = useAuth();
  const isOwner = !!(user?.id && gymOwnerId && user.id === gymOwnerId);
  const [events, setEvents] = useState([]);
  const [rsvps, setRsvps] = useState({}); // eventId → { going, maybe, cant, byUser }
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', starts_at: '', location_note: '' });
  const [rsvpBusy, setRsvpBusy] = useState(null);
  const [scope, setScope] = useState('upcoming'); // 'upcoming' | 'past'

  const refresh = async () => {
    setLoading(true);
    const rows = await listEvents(gymId, { scope });
    setEvents(rows);
    if (rows.length > 0) {
      const { listEventRsvps } = await import('@/lib/data/gymBusinesses');
      setRsvps(await listEventRsvps(rows.map(r => r.id)));
    } else {
      setRsvps({});
    }
    setLoading(false);
  };
  useEffect(() => { refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [gymId, scope]);

  const handleRsvp = async (eventId, nextStatus) => {
    if (rsvpBusy === eventId) return;
    setRsvpBusy(eventId);
    const { setEventRsvp } = await import('@/lib/data/gymBusinesses');
    const currentStatus = rsvps[eventId]?.byUser?.[user?.id];
    const targetStatus = currentStatus === nextStatus ? null : nextStatus;
    // Optimistic local update so the chip responds instantly even on
    // slow networks (audit C-12).
    setRsvps(prev => {
      const next = { ...prev };
      const slot = { ...(next[eventId] || { going: 0, maybe: 0, cant: 0, byUser: {} }) };
      slot.byUser = { ...slot.byUser };
      if (currentStatus) slot[currentStatus] = Math.max(0, (slot[currentStatus] || 0) - 1);
      if (targetStatus) {
        slot[targetStatus] = (slot[targetStatus] || 0) + 1;
        slot.byUser[user?.id] = targetStatus;
      } else {
        delete slot.byUser[user?.id];
      }
      next[eventId] = slot;
      return next;
    });
    const res = await setEventRsvp(eventId, targetStatus);
    setRsvpBusy(null);
    if (!res.ok) {
      toast.error("Couldn't RSVP.");
      refresh();
    }
  };

  const handleDeleteEvent = async (eventId) => {
    if (!confirm(tFallback("gymHub.deleteThisEvent", "Delete this event?"))) return;
    const { deleteEvent } = await import('@/lib/data/gymBusinesses');
    const res = await deleteEvent(eventId);
    if (res.ok) refresh();
    else toast.error("Couldn't delete event.");
  };

  const handleCreate = async () => {
    // The disabled-button gate covers most paths, but if the user
    // clears the title after enabling the button via focus changes,
    // the silent return surprises. Surface a toast so the tap always
    // produces feedback. (Audit 12 #8.)
    if (!form.title.trim() || !form.starts_at) {
      toast.error('Add a title and start time before creating the event.');
      return;
    }
    const res = await createEvent(gymId, form);
    if (res.ok) {
      setForm({ title: '', body: '', starts_at: '', location_note: '' });
      setComposing(false);
      refresh();
    } else if (res.error === 'INVALID_START') {
      toast.error('Pick a valid date and time.');
    } else {
      toast.error(res.error || "Couldn't create event.");
    }
  };

  return (
    <div>
      {/* Upcoming / Past scope toggle (audit C-7) */}
      <div className="flex gap-1 mb-3">
        {[
          { id: 'upcoming', label: 'Upcoming' },
          { id: 'past',     label: 'Past' },
        ].map(opt => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setScope(opt.id)}
            className={`px-2.5 py-1 rounded-full text-micro font-bold uppercase tracking-wider transition-colors ${
              scope === opt.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary/60 text-foreground hover:bg-secondary active:bg-secondary'
            }`}
          >
            {tFallback(`gymHub.eventScope.${opt.id}`, opt.label)}
          </button>
        ))}
      </div>
      {canCreate && !composing && scope === 'upcoming' && (
        <Button variant="outline" onClick={() => setComposing(true)} className="w-full mb-3 gap-1.5">
          <Plus className="w-4 h-4" /> {tFallback("gymHub.newEvent", "New event")}
        </Button>
      )}
      {composing && (
        <div className="rounded-2xl border border-border bg-card p-3 mb-3 space-y-2">
          <Input
            placeholder={tFallback("cardioPlanned.title", "Title")}
            value={form.title}
            onChange={(e) => setForm(f => ({ ...f, title: e.target.value.slice(0, 80) }))}
          />
          <Input
            type="datetime-local"
            value={form.starts_at}
            onChange={(e) => setForm(f => ({ ...f, starts_at: e.target.value }))}
          />
          <Input
            placeholder="Location note (e.g. Squat rack 3)"
            value={form.location_note}
            onChange={(e) => setForm(f => ({ ...f, location_note: e.target.value.slice(0, 80) }))}
          />
          <Textarea
            placeholder={tFallback("gymHub.detailsOptional", "Details (optional)")}
            value={form.body}
            onChange={(e) => setForm(f => ({ ...f, body: e.target.value.slice(0, 500) }))}
            rows={2}
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setComposing(false)} className="flex-1">{tFallback("coach.plan.cancel", "Cancel")}</Button>
            <Button onClick={handleCreate} disabled={!form.title.trim() || !form.starts_at} className="flex-1">{tFallback("workout.templates.createBtn", "Create")}</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : events.length === 0 ? (
        <EmptyState icon={Calendar} title={tFallback("gymHub.noEventsScheduled", "No events scheduled")} body="Owners or members can post events here." />
      ) : (
        <div className="space-y-2">
          {events.map(e => {
            const slot = rsvps[e.id] || { going: 0, maybe: 0, cant: 0, byUser: {} };
            const myStatus = slot.byUser?.[user?.id] || null;
            const busy = rsvpBusy === e.id;
            const canDelete = isOwner || (user?.id && e.created_by === user.id);
            const parsed = (() => {
              try { const d = parseISO(e.starts_at); return Number.isNaN(d.getTime()) ? null : d; }
              catch { return null; }
            })();
            const isPast = parsed ? parsed.getTime() < Date.now() : false;
            return (
              <div key={e.id} className={`rounded-xl border bg-card p-3 ${isPast ? 'border-border/60 opacity-80' : 'border-border'}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-heading font-bold text-sm">{e.title}</p>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => handleDeleteEvent(e.id)}
                      className="w-6 h-6 rounded-full text-muted-foreground hover:text-destructive active:text-destructive flex items-center justify-center"
                      aria-label={tFallback("gymHub.deleteEvent", "Delete event")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {parsed ? format(parsed, "EEE MMM d 'at' h:mm a") : 'Date unavailable'}
                  {e.location_note && ` · ${e.location_note}`}
                  {isPast && ' · ended'}
                </p>
                {e.body && <p className="text-sm text-foreground/85 mt-1.5 whitespace-pre-wrap">{e.body}</p>}
                {/* RSVP row — disabled on past events */}
                <div className="flex items-center gap-1.5 mt-3">
                  {[
                    { id: 'going', label: 'Going',   activeClass: 'bg-emerald-500 text-white border-emerald-500' },
                    { id: 'maybe', label: 'Maybe',   activeClass: 'bg-amber-500 text-white border-amber-500' },
                    { id: 'cant',  label: "Can't",   activeClass: 'bg-secondary text-foreground border-border' },
                  ].map(opt => {
                    const isActive = myStatus === opt.id;
                    const disabled = busy || isPast;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => handleRsvp(e.id, opt.id)}
                        className={`px-2.5 py-1 rounded-full border text-micro font-bold uppercase tracking-wider transition-colors ${
                          isActive
                            ? opt.activeClass
                            : 'border-border text-muted-foreground hover:bg-secondary active:bg-secondary'
                        } ${disabled ? 'opacity-60' : ''}`}
                      >
                        {tFallback(`gymHub.rsvp.${opt.id}`, opt.label)}
                      </button>
                    );
                  })}
                  {slot.going > 0 && (
                    <span className="ms-auto text-micro text-muted-foreground tabular-nums flex items-center gap-1">
                      <Users className="w-3 h-3" /> {slot.going} going
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Leaderboard Tab ─────────────────────────────────────────────────
function LeaderboardTab({ gymId, meUserId }) {
  const { tFallback } = useLanguage();
  const [mode, setMode] = useState('volume');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getLeaderboard(gymId, { mode }).then(r => {
      setRows(r);
      setLoading(false);
    });
  }, [gymId, mode]);

  const modeMeta = useMemo(() => LB_MODES.find(m => m.id === mode), [mode]);
  const myRow = rows.find(r => r.user_id === meUserId);

  return (
    <div>
      <div className="flex gap-1 mb-3">
        {LB_MODES.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={`px-2.5 py-1 rounded-full text-micro font-bold uppercase tracking-wider transition-colors ${
              mode === m.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary/60 text-foreground hover:bg-secondary active:bg-secondary'
            }`}
          >
            {tFallback(`gymHub.lbMode.${m.id}`, m.label)}
          </button>
        ))}
      </div>

      {/* Always show "Your rank" banner so users in the top 3 see their
          standing too, and unranked members get a clear nudge (audit
          C-10, B-5 client side). */}
      {meUserId && !loading && (
        myRow ? (
          <div className="rounded-xl bg-primary/10 border border-primary/30 p-3 mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="text-micro font-bold uppercase tracking-wider text-primary">{tFallback("league.yourRank", "Your rank")}</span>
              <span className="font-heading font-bold tabular-nums">#{myRow.rank}</span>
            </span>
            <span className="font-bold tabular-nums">{Math.round(myRow.value).toLocaleString()} {modeMeta?.suffix}</span>
          </div>
        ) : rows.length > 0 ? (
          <div className="rounded-xl bg-secondary/40 border border-border p-3 mb-3 text-xs text-muted-foreground">
            Log a {mode === 'volume' ? 'lift' : 'workout'} to appear on the board.
          </div>
        ) : null
      )}

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Trophy} title={tFallback("progress.noData", "No data yet")} body="Members will appear here as they log workouts." />
      ) : (
        <div className="space-y-1.5">
          {rows.map(r => {
            const isMe = r.user_id === meUserId;
            const podium = r.rank <= 3;
            return (
              <div
                key={r.user_id}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl ${
                  podium ? 'bg-card border-2 border-amber-400/40' :
                  isMe   ? 'bg-primary/10 border border-primary/30' :
                  'bg-card border border-border'
                }`}
              >
                <span className={`w-7 text-center font-heading font-bold tabular-nums text-sm ${
                  r.rank === 1 ? 'text-amber-400' :
                  r.rank === 2 ? 'text-slate-400' :
                  r.rank === 3 ? 'text-orange-500' : 'text-muted-foreground'
                }`}>
                  #{r.rank}
                </span>
                {r.avatar_url
                  ? <img loading="lazy" src={r.avatar_url} alt="" className="w-8 h-8 rounded-full" />
                  : <div className="w-8 h-8 rounded-full bg-secondary" />}
                <span className="flex-1 text-sm font-medium truncate">
                  @{r.username || '—'}
                </span>
                <span className="text-sm font-bold tabular-nums">
                  {Math.round(r.value).toLocaleString()} <span className="text-xs text-muted-foreground">{modeMeta?.suffix}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
