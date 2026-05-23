// src/pages/GymHub.jsx
//
// Individual Gym Hub page (route: /gym/:id). Three tabs:
//   • Feed       — local community posts (gym_feed_posts, member-only RLS)
//   • Events     — upcoming events (gym_events)
//   • Leaderboard — local ranking by volume / XP / streak
//
// Header: gym name + city/state + member count + Flexyn Code (shown
// to the owner, hidden from regular members for cleanliness).

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Building2, Users, MapPin, Trophy, Calendar, MessageSquare,
  Send, Loader2, Plus, Crown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import EmptyState from '@/components/EmptyState';
import {
  getGym, getLeaderboard, listEvents, createEvent,
  listFeedPosts, postToFeed,
} from '@/lib/data/gymBusinesses';

const TABS = [
  { id: 'feed',       label: 'Feed',        Icon: MessageSquare },
  { id: 'events',     label: 'Events',      Icon: Calendar },
  { id: 'leaderboard', label: 'Leaderboard', Icon: Trophy },
];

const LB_MODES = [
  { id: 'volume', label: 'Volume',  suffix: 'lb' },
  { id: 'xp',     label: 'XP',      suffix: 'xp' },
  { id: 'streak', label: 'Streak',  suffix: 'd' },
];

export default function GymHub() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [gym, setGym] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('feed');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getGym(id).then(g => { setGym(g); setLoading(false); });
  }, [id]);

  const isOwner = !!(gym && user?.id && gym.owner_id === user.id);

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
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Users className="w-3 h-3" /> <span className="tabular-nums">{gym.member_count}</span> members
                </span>
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
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Print this. Members scan or type it inside the gym to join.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
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

      {tab === 'feed'        && <FeedTab        gymId={id} />}
      {tab === 'events'      && <EventsTab      gymId={id} canCreate={true} />}
      {tab === 'leaderboard' && <LeaderboardTab gymId={id} meUserId={user?.id} />}
    </motion.div>
  );
}

// ── Feed Tab ────────────────────────────────────────────────────────
function FeedTab({ gymId }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setPosts(await listFeedPosts(gymId));
    setLoading(false);
  };
  useEffect(() => { refresh(); }, [gymId]);

  const handlePost = async () => {
    if (!body.trim() || posting) return;
    setPosting(true);
    const res = await postToFeed(gymId, body);
    setPosting(false);
    if (res.ok) {
      setBody('');
      refresh();
    } else {
      toast.error("Couldn't post — try again.");
    }
  };

  return (
    <div>
      <div className="rounded-2xl border border-border bg-card p-3 mb-3">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 500))}
          placeholder="Share with your local community…"
          rows={2}
          className="resize-none border-0 focus-visible:ring-0 px-0"
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground tabular-nums">{body.length}/500</span>
          <Button size="sm" onClick={handlePost} disabled={!body.trim() || posting} className="gap-1.5">
            {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Post
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : posts.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No posts yet" body="Be the first to post to your local community." />
      ) : (
        <div className="space-y-2">
          {posts.map(p => (
            <div key={p.id} className="rounded-xl border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground mb-1">
                @{p.author_email?.split('@')[0]} · {formatDistanceToNow(parseISO(p.created_at), { addSuffix: true })}
              </p>
              <p className="text-sm whitespace-pre-wrap">{p.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Events Tab ──────────────────────────────────────────────────────
function EventsTab({ gymId, canCreate }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', starts_at: '', location_note: '' });

  const refresh = async () => {
    setLoading(true);
    setEvents(await listEvents(gymId));
    setLoading(false);
  };
  useEffect(() => { refresh(); }, [gymId]);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.starts_at) return;
    const res = await createEvent(gymId, form);
    if (res.ok) {
      setForm({ title: '', body: '', starts_at: '', location_note: '' });
      setComposing(false);
      refresh();
    } else {
      toast.error(res.error || "Couldn't create event.");
    }
  };

  return (
    <div>
      {canCreate && !composing && (
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
          {events.map(e => (
            <div key={e.id} className="rounded-xl border border-border bg-card p-3">
              <p className="font-heading font-bold text-sm">{e.title}</p>
              <p className="text-xs text-muted-foreground">
                {format(parseISO(e.starts_at), "EEE MMM d 'at' h:mm a")}
                {e.location_note && ` · ${e.location_note}`}
              </p>
              {e.body && <p className="text-sm text-foreground/85 mt-1.5 whitespace-pre-wrap">{e.body}</p>}
            </div>
          ))}
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

      {myRow && myRow.rank > 3 && (
        <div className="rounded-xl bg-primary/10 border border-primary/30 p-3 mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Your rank</span>
            <span className="font-heading font-bold tabular-nums">#{myRow.rank}</span>
          </span>
          <span className="font-bold tabular-nums">{Math.round(myRow.value).toLocaleString()} {modeMeta?.suffix}</span>
        </div>
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
