// src/pages/GymHub.jsx
//
// Individual Gym Hub page (route: /gym/:id). Three tabs:
//   • Feed       — local community posts (gym_feed_posts, member-only RLS)
//   • Events     — upcoming events (gym_events)
//   • Leaderboard — local ranking by volume / XP / streak
//
// Header: gym name + city/state + member count + Flexyn Code (shown
// to the owner, hidden from regular members for cleanliness).

import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Building2, Users, MapPin, Trophy, Calendar, MessageSquare,
  Loader2, Plus, Crown, Printer, Share2, Pencil, LogOut, Trash2,
} from 'lucide-react';
import { leaveGym } from '@/lib/data/gymBusinesses';

const GymSignageCard = lazy(() => import('@/components/gyms/GymSignageCard'));
const GymFeedTab            = lazy(() => import('@/components/gyms/GymFeedTab'));
const MemberDirectoryModal  = lazy(() => import('@/components/gyms/MemberDirectoryModal'));
const GymAboutCard          = lazy(() => import('@/components/gyms/GymAboutCard'));
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import EmptyState from '@/components/EmptyState';
import {
  getGym, getLeaderboard, listEvents, createEvent,
} from '@/lib/data/gymBusinesses';

const TABS = [
  { id: 'feed',       label: 'Feed',        Icon: MessageSquare },
  { id: 'events',     label: 'Events',      Icon: Calendar },
  { id: 'leaderboard', label: 'Leaderboard', Icon: Trophy },
];

const LB_MODES = [
  { id: 'volume',      label: 'Volume',      suffix: 'lb' },
  { id: 'consistency', label: 'Consistency', suffix: 'days' },
  { id: 'xp',          label: 'XP',          suffix: 'xp' },
  { id: 'streak',      label: 'Streak',      suffix: 'd' },
];

export default function GymHub() {
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
  const [membershipChecked, setMembershipChecked] = useState(false);
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
      toast.error("Couldn't join — try again.");
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
        <EmptyState icon={Building2} title="Gym not found" body="That gym ID doesn't exist or has been deactivated." />
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
        onClick={() => navigate('/my-gyms')}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="w-4 h-4" /> My Gyms
      </button>

      {/* Header card */}
      <div className="rounded-2xl overflow-hidden border border-border bg-card mb-4">
        {gym.cover_url && (
          <div className="h-32 bg-gradient-to-br from-primary/20 to-violet-500/20 relative">
            <img src={gym.cover_url} alt="" className="w-full h-full object-cover" />
          </div>
        )}
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              {gym.logo_url
                ? <img src={gym.logo_url} alt="" className="w-full h-full rounded-2xl object-cover" />
                : <Building2 className="w-6 h-6 text-primary" />}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-heading text-xl font-bold tracking-tight">{gym.name}</h1>
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3" />
                {[gym.street_address, gym.city, gym.state_code].filter(Boolean).join(', ')}
              </p>
              <div className="flex items-center gap-3 mt-2 text-xs">
                <button
                  type="button"
                  onClick={() => setMembersOpen(true)}
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="View members"
                >
                  <Users className="w-3 h-3" /> <span className="tabular-nums">{gym.member_count}</span> members
                </button>
                {isOwner && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-600 dark:text-amber-300 border border-amber-400/30 font-bold uppercase tracking-wide text-[10px]">
                    <Crown className="w-2.5 h-2.5" /> Owner
                  </span>
                )}
              </div>
              {isOwner && (
                <div className="mt-3 rounded-xl bg-primary/8 border border-primary/20 p-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-primary mb-0.5">Your Flexyn Code</p>
                  <p className="font-mono text-lg tracking-[0.3em] font-bold text-foreground">{gym.flexyn_code}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 mb-2">
                    Print this. Members scan or type it inside the gym to join.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSignageOpen(true)}
                    className="gap-1.5 h-7"
                  >
                    <Printer className="w-3 h-3" />
                    Open printable signage
                  </Button>
                </div>
              )}
            </div>
          </div>

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
              <Share2 className="w-3.5 h-3.5" /> Share
            </Button>
            {isOwner && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/gym/${gym.id}/edit`)}
                className="gap-1.5"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
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
                    navigate('/my-gyms');
                  } else {
                    toast.error("Couldn't leave — try again.");
                  }
                }}
                className="gap-1.5 text-muted-foreground hover:text-destructive"
              >
                <LogOut className="w-3.5 h-3.5" /> Leave
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
      {membershipChecked && !isMember && !isOwner && (
        <div className="rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-5 text-center">
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
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
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
    if (!confirm('Delete this event?')) return;
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
            className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${
              scope === opt.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary/60 text-foreground hover:bg-secondary'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {canCreate && !composing && scope === 'upcoming' && (
        <Button variant="outline" onClick={() => setComposing(true)} className="w-full mb-3 gap-1.5">
          <Plus className="w-4 h-4" /> New event
        </Button>
      )}
      {composing && (
        <div className="rounded-2xl border border-border bg-card p-3 mb-3 space-y-2">
          <Input
            placeholder="Title"
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
            placeholder="Details (optional)"
            value={form.body}
            onChange={(e) => setForm(f => ({ ...f, body: e.target.value.slice(0, 500) }))}
            rows={2}
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setComposing(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.title.trim() || !form.starts_at} className="flex-1">Create</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : events.length === 0 ? (
        <EmptyState icon={Calendar} title="No events scheduled" body="Owners or members can post events here." />
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
                      className="w-6 h-6 rounded-full text-muted-foreground hover:text-destructive flex items-center justify-center"
                      aria-label="Delete event"
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
                        className={`px-2.5 py-1 rounded-full border text-[11px] font-bold uppercase tracking-wider transition-colors ${
                          isActive
                            ? opt.activeClass
                            : 'border-border text-muted-foreground hover:bg-secondary'
                        } ${disabled ? 'opacity-60' : ''}`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                  {slot.going > 0 && (
                    <span className="ms-auto text-[11px] text-muted-foreground tabular-nums flex items-center gap-1">
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
            className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${
              mode === m.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary/60 text-foreground hover:bg-secondary'
            }`}
          >
            {m.label}
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
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Your rank</span>
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
        <EmptyState icon={Trophy} title="No data yet" body="Members will appear here as they log workouts." />
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
                  ? <img src={r.avatar_url} alt="" className="w-8 h-8 rounded-full" />
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
