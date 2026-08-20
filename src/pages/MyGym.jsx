// src/pages/MyGym.jsx
//
// "My Gym" (route: /my-gym) — ONE page for every gym relationship a
// user has. Merged from /my-gym + /my-gyms on 2026-08-09; the design is
// the Penpot page "My Gym — one page (merge of /my-gym + /my-gyms)",
// boards A (full scroll), B (no home gym yet) and C (the element
// ledger).
//
// Two pages, two profile-menu entries one line apart, both about gyms,
// both reachable only from that menu — the split was invisible from the
// outside and the plural/singular labels were the only thing telling
// them apart. The page is now one scroll with a single break in it:
//
//   ── your floor ──
//   1. The gym you train at. How am I doing against the people on it
//      (leaderboard) and how is it doing as a whole (community bar).
//   ── 32px break ──
//   2. Every other gym you've joined, joining another, the map, and the
//      owner's way in.
//
// /my-gyms redirects here (App.jsx) rather than 404ing: the 8-character
// Flexyn Code printed on gym signage tells people to open it, GymHub's
// back link pointed at it, and neither of those can be recalled.
//
// The leaderboard is ranked by CONSISTENCY — distinct days trained in
// the last 7 — not by volume. Ranking a local gym board by weight moved
// sorts it by bodyweight and training age and tells a beginner they're
// last, which is exactly the person a gym-floor social feature needs to
// keep. Days shown up is something anyone can win. Same reasoning as
// mig 150.
//
// Both home-gym data calls are members-only server-side (mig 158 / 275),
// so a user who left the gym in another tab gets empty state rather than
// a render-time throw.

import React, { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Building2, Users, Loader2, MapPin, ArrowRight, Flame,
  CalendarCheck, Dumbbell, Trophy, Pencil, Plus, QrCode, ScanLine,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import {
  getHomeGym, getCommunityProgress, getGymConsistencyBoard, resolveHomeGymId,
  setHomeGym, setHomeGymFromOsm,
} from '@/lib/data/homeGym';
import { listMyGyms, joinByCode } from '@/lib/data/gymBusinesses';
import NearbyGymPicker from '@/components/gyms/NearbyGymPicker';
import { toast } from '@/lib/toast';

const QrCodeScanner = lazy(() => import('@/components/gyms/QrCodeScanner'));

// ── Community progress ──────────────────────────────────────────────
//
// The shared number. "X of Y trained this week" is the honest headline:
// it's participation, which is the thing a gym community can actually
// move together, rather than a volume total that one big lifter
// dominates.
//
// Lives INSIDE the gym card, under a hairline, rather than in a card of
// its own — it isn't a separate object, it's what that gym is doing this
// week, and a card inside a card is the thing the UI rules ban outright.
function CommunityProgress({ progress, tFallback }) {
  if (!progress) return null;

  const { memberCount, activeMembers, workoutCount, activeDays, totalVolume } = progress;
  const pct = memberCount > 0
    ? Math.min(100, Math.round((activeMembers / memberCount) * 100))
    : 0;

  return (
    <div className="border-t border-border px-4 py-4">
      <div className="flex items-center gap-2 mb-2">
        <Flame className="w-4 h-4 text-orange-500" />
        <p className="text-sm font-semibold">
          {tFallback('myGym.communityProgress', 'Community progress')}
        </p>
        <span className="ms-auto text-micro text-muted-foreground">
          {tFallback("progress.last7Days", "Last 7 days")}
        </span>
      </div>

      <div className="flex items-baseline gap-2 mb-2">
        <span className="font-heading text-2xl font-bold tabular-nums">{activeMembers}</span>
        <span className="text-sm text-muted-foreground">
          of {memberCount} members trained this week
        </span>
      </div>

      <div
        className="w-full h-1.5 rounded-full bg-secondary overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={tFallback('myGym.communityProgress', 'Community progress')}
      >
        <div
          className="h-full rounded-full bg-primary transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Three read-only figures — divided by hairlines, not boxed into
          tiles. Fixed count (always three), so a grid is correct here;
          tileRow() is for collections whose count comes from data. */}
      <div className="mt-6 grid grid-cols-3 divide-x divide-border">
        {[
          { id: 'sessions', icon: Dumbbell, value: workoutCount, label: 'sessions' },
          { id: 'gymDays', icon: CalendarCheck, value: activeDays, label: 'gym days' },
          {
            id: 'volume',
            icon: Trophy,
            value: totalVolume >= 1000
              ? `${Math.round(totalVolume / 1000)}k`
              : Math.round(totalVolume),
            label: 'lbs moved',
          },
        ].map(({ id, icon: Icon, value, label }, i) => (
          <div key={id} className={i === 0 ? 'pe-2' : 'px-2 last:pe-0'}>
            <p className="font-heading font-bold text-sm tabular-nums leading-none flex items-center gap-2">
              <Icon className="w-3.5 h-3.5 text-muted-foreground" />
              {value}
            </p>
            <p className="text-micro text-muted-foreground mt-2">{tFallback(`myGym.stat.${id}`, label)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Leaderboard row ─────────────────────────────────────────────────
function BoardRow({ entry, isMe, maxDays, delay }) {
  const rank = Number(entry.rank);
  const days = Number(entry.value) || 0;
  const pct = maxDays > 0 ? Math.min(100, (days / maxDays) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className={`flex items-center gap-2 px-2 py-2 rounded-lg ${
        isMe ? 'bg-primary/10' : ''
      }`}
    >
      {/* Numeral for every rank, including the podium. Medals put three
          emoji in a column whose job is to be scannable, and they render
          at three different widths across platforms. Weight and colour
          carry the top three instead. */}
      <div className="w-6 flex justify-center shrink-0">
        <span className={`text-xs font-bold tabular-nums ${
          rank <= 3 ? 'text-foreground' : 'text-muted-foreground'
        }`}>
          {rank}
        </span>
      </div>

      <div className="w-7 h-7 rounded-full overflow-hidden bg-secondary shrink-0 flex items-center justify-center">
        {entry.avatar_url
          ? <img loading="lazy" src={entry.avatar_url} alt="" className="w-full h-full object-cover" />
          : <Users className="w-3.5 h-3.5 text-muted-foreground" />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">
          {entry.username || 'Member'}
          {isMe && (
            <span className="ms-2 text-micro font-bold text-primary">
              YOU
            </span>
          )}
        </p>
        <div className="mt-2 h-[3px] rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              isMe ? 'bg-primary' : 'bg-muted-foreground/40'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="text-end shrink-0">
        <p className="font-heading font-bold text-sm tabular-nums leading-none">{days}</p>
        <p className="text-micro text-muted-foreground mt-1">
          {days === 1 ? 'day' : 'days'}
        </p>
      </div>
    </motion.div>
  );
}

export default function MyGym() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const navigate = useNavigate();

  // ── Home-gym half ──
  const [gym, setGym] = useState(null);
  const [board, setBoard] = useState([]);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [homeGymId, setHomeGymId] = useState(null);
  // Empty-state picker: `pending` is the row currently being written.
  const [pending, setPending] = useState(null);
  const [saving, setSaving] = useState(false);

  // ── Joined-gyms half ──
  //
  // Loaded independently of the home gym so a slow membership read never
  // holds up the leaderboard, and vice versa. They fail independently
  // too: an empty list under a working hero is a truthful screen.
  const [gyms, setGyms] = useState([]);
  const [gymsLoading, setGymsLoading] = useState(true);
  const [codeInput, setCodeInput] = useState('');
  const [joining, setJoining] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // Never read user.home_gym_id alone — see resolveHomeGymId. Straight
    // after onboarding the context still holds the pre-pick profile, and
    // trusting it renders "you haven't picked a gym yet" at someone who
    // picked one sixty seconds ago.
    const id = await resolveHomeGymId(user?.home_gym_id);
    setHomeGymId(id);
    if (!id) { setGym(null); setBoard([]); setProgress(null); setLoading(false); return; }

    // One await for all three — the leaderboard and the community bar
    // are independent reads and there's no reason to stagger them.
    const [g, b, p] = await Promise.all([
      getHomeGym(id),
      getGymConsistencyBoard(id),
      getCommunityProgress(id),
    ]);
    setGym(g);
    setBoard(b);
    setProgress(p);
    setLoading(false);
  }, [user?.home_gym_id]);

  const refreshGyms = useCallback(async () => {
    if (!user?.id) return;
    setGymsLoading(true);
    const rows = await listMyGyms(user.id);
    setGyms(rows);
    setGymsLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { refreshGyms(); }, [refreshGyms]);

  // Tapping a gym SAVES it. There is no confirm step.
  //
  // It used to be select-then-press-a-button, and the selected row got a
  // ✓ — which reads as "saved" when it only meant "highlighted". That
  // cost a real round trip: the pick sat uncommitted while everything
  // looked done. One choice on a single-purpose screen doesn't need a
  // two-step commit; mis-taps are recoverable via Undo below and the
  // Change control on the loaded page.
  //
  // Unlike onboarding — which holds the pick until final save so an
  // abandoned signup leaves no stray community gym behind — there is no
  // later save step here, so this writes immediately.
  const handlePick = useCallback(async (choice) => {
    if (!choice || saving) return;
    setPending(choice);
    setSaving(true);
    const res = choice.osm
      ? await setHomeGymFromOsm(choice.osm)
      : await setHomeGym(choice.gymId);
    setSaving(false);

    if (!res.ok) {
      const msg = {
        NAME_REJECTED: "That gym's name can't be added automatically.",
        CREATE_LIMIT: "You've added a lot of gyms already — pick an existing one.",
        GYM_INACTIVE: 'That gym is no longer active on Flexyn.',
        GYM_NOT_FOUND: "We couldn't find that gym any more.",
      }[res.error];
      toast.error(msg || "Couldn't set your gym — try again.");
      setPending(null);
      return;
    }

    // The `action` is not decoration — src/lib/toast.js suppresses every
    // non-error toast UNLESS it carries one. A plain toast.success here
    // renders NOTHING, which is exactly how a working save came to look
    // identical to a broken one. Undo is genuinely useful anyway now
    // that a single tap commits.
    toast.success(tFallback('myGym.nowYourGym', '{name} is now your gym.', { name: choice.name }), {
      action: {
        label: tFallback('common.undo', 'Undo'),
        onClick: async () => {
          await setHomeGym(null);
          setPending(null);
          load();
          refreshGyms();
        },
      },
    });

    setPending(null);
    // setHomeGym patched the profile cache, so resolveHomeGymId picks
    // the new id up on this reload without waiting for AuthContext. The
    // RPC also joins the gym, so the list below has changed too.
    load();
    refreshGyms();
  }, [saving, load, refreshGyms]);

  // Shared join handler — used by both the typed-code form submit and
  // the QR scanner's onDetect. Wraps the same joinByCode + UX flow so
  // a scanned code is identical to a typed one from the user's POV.
  const joinWithCode = async (code) => {
    if (joining) return;
    setJoining(true);
    const res = await joinByCode(code);
    setJoining(false);
    if (res.ok) {
      if (res.alreadyMember) toast.info(tFallback('myGym.alreadyMember', 'You are already a member of this gym.'));
      else toast.success(tFallback('myGym.joined', 'Joined! Welcome to the local community.'));
      setCodeInput('');
      setScannerOpen(false);
      // Navigate first so we don't fire a refresh on a soon-to-unmount
      // page (audit B-19). The destination's own data fetch handles the
      // joined state.
      if (res.gymId) navigate(`/gym/${res.gymId}`);
      else refreshGyms();
    } else {
      const map = {
        INVALID_CODE: "That code doesn't look right (8 letters/numbers).",
        CODE_NOT_FOUND: 'No gym matches that code.',
        PIPELINE_MISSING: 'Gym features are rolling out — try again shortly.',
      };
      toast.error(map[res.error] || `Couldn't join: ${res.error || 'try again'}`);
    }
  };

  const handleJoin = (e) => {
    e?.preventDefault?.();
    joinWithCode(codeInput);
  };

  // The home gym is the hero; it must not appear a second time in the
  // list underneath. Setting a home gym joins it (see homeGym.js), so
  // without this filter every user sees their own gym twice.
  const otherGyms = gyms.filter(g => g.id !== homeGymId);
  const maxDays = board.length > 0 ? Math.max(...board.map(r => Number(r.value) || 0)) : 0;
  const isCommunity = gym?.source === 'community';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto p-4 pb-24"
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2 mb-6">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold tracking-tight truncate">
            {tFallback('myGym.title', 'My Gym')}
          </h1>
          <p className="text-sm text-muted-foreground truncate">
            {tFallback('myGym.subtitle', "Your floor, your people, and every gym you've joined.")}
          </p>
        </div>
        {/* Nothing to change until there's a home gym to change. */}
        {homeGymId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/gym-map')}
            className="gap-2 shrink-0"
          >
            <Pencil className="w-3.5 h-3.5" />
            {tFallback("myGym.changeGym", "Change gym")}
          </Button>
        )}
      </div>

      {/* ── Hero: the gym you train at ──────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : !homeGymId ? (
        // Pick in place, rather than only pointing at the map. Everyone
        // who signed up before mig 275 shipped never sees the onboarding
        // gym step, so for them the map was the ONLY way to set a home
        // gym — and nothing on this screen said so. That is the whole
        // reason this prompt exists; don't reduce it back to a link.
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="w-4 h-4 text-primary shrink-0" />
            <p className="font-heading font-bold text-base">
              {tFallback('myGym.pickTitle', 'Which gym do you train at?')}
            </p>
          </div>
          <p className="text-xs text-muted-foreground mb-6">
            {tFallback(
              'myGym.pickBody',
              "Tap it below and you'll get a leaderboard with everyone else who trains there, plus a bubble on the Flexyn map. You can change it any time.",
            )}
          </p>

          {/* One tap commits — no confirm button. `deselectable={false}`
              because with save-on-tap, tapping your current gym again
              must not read as "unset my home gym". */}
          <NearbyGymPicker
            value={pending}
            onChange={handlePick}
            disabled={saving}
            deselectable={false}
            busyKey={saving ? pending?.key : null}
            emptyHint={tFallback(
              'myGym.pickEmptyHint',
              'Try the map instead. You can search anywhere in the country.',
            )}
          />

          {/* Same control, same words, same weight as the one above the
              onboarding picker. It read "Browse the map instead" in
              muted text here and "Browse map" as a button there — one
              destination described two ways in the two places a user
              actually meets it. */}
          <button
            type="button"
            onClick={() => navigate('/gym-map')}
            className="w-full mt-6 py-2.5 rounded-lg text-sm font-bold border border-border bg-card text-primary hover:border-primary/40 active:border-primary/40 transition-all"
          >
            {tFallback("myGym.browseTheMap", "Browse the map")}
          </button>
        </div>
      ) : !gym ? (
        // Home gym id set but the row is gone — the gym was deactivated,
        // or deleted and the FK nulled on a row we've already cached.
        // Offer the way out rather than an infinite spinner, and leave
        // the rest of the page standing.
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
            <p className="font-heading font-bold text-base">
              {tFallback('myGym.goneTitle', 'That gym is no longer listed')}
            </p>
          </div>
          <p className="text-xs text-muted-foreground mb-6">
            {tFallback(
              'myGym.goneBody',
              'The gym you picked is no longer active on Flexyn. Pick another from the map.',
            )}
          </p>
          <button
            type="button"
            onClick={() => navigate('/gym-map')}
            className="w-full py-2.5 rounded-lg text-sm font-bold border border-border bg-card text-primary hover:border-primary/40 active:border-primary/40 transition-all"
          >
            {tFallback('myGym.emptyCta', 'Find my gym')}
          </button>
        </div>
      ) : (
        // The one dominant element on the page: the only filled card,
        // and the only place two things share a surface. The identity
        // row is the button; the progress block under the hairline is
        // not interactive, so nothing nests inside a control.
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => navigate(`/gym/${gym.id}`)}
            className="w-full text-start p-4 hover:bg-secondary/30 active:bg-secondary/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 overflow-hidden ${
                isCommunity ? 'bg-muted' : 'bg-primary/10'
              }`}>
                {gym.logo_url
                  ? <img loading="lazy" src={gym.logo_url} alt="" className="w-full h-full object-cover" />
                  : <Building2 className={`w-5 h-5 ${isCommunity ? 'text-muted-foreground' : 'text-primary'}`} />}
              </div>
              <div className="flex-1 min-w-0 ms-2">
                <p className="font-heading font-bold text-base truncate">{gym.name}</p>
                <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                  <MapPin className="w-3 h-3 shrink-0" />
                  {[gym.city, gym.state_code].filter(Boolean).join(', ') || '—'}
                  <span aria-hidden="true">·</span>
                  <Users className="w-3 h-3 shrink-0" />
                  <span className="tabular-nums">{gym.member_count ?? 0}</span>
                  on Flexyn
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </div>

            {/* A community gym has no verified owner. Saying so — and
                saying it can be claimed — is what keeps a grey bubble
                from reading as a broken business listing. */}
            {isCommunity && (
              <p className="mt-2 inline-flex rounded-full border border-border px-2 py-1 text-micro text-muted-foreground">
                {tFallback(
                  'myGym.communityNote',
                  'Community gym. Added by Flexyn members, not claimed by the business yet.',
                )}
              </p>
            )}
          </button>

          <CommunityProgress progress={progress} tFallback={tFallback} />
        </div>
      )}

      {/* ── Gym leaderboard ─────────────────────────────────────── */}
      {!loading && gym && (
        <div className="mt-6">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <h2 className="font-heading text-base font-bold">
              {tFallback('myGym.leaderboard', 'Gym leaderboard')}
            </h2>
            <p className="text-micro text-muted-foreground shrink-0">
              {tFallback('myGym.rankedBy', 'Days trained · last 7 days')}
            </p>
          </div>

          {board.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {tFallback(
                'myGym.boardEmpty',
                "Nobody here has logged a workout this week. Be the first. You'll take the top spot.",
              )}
            </p>
          ) : (
            <>
              {/* Read-only data, so no surface around it — the rows are
                  divided by hairlines and only "you" gets a fill. */}
              <div className="divide-y divide-border">
                {board.map((entry, i) => (
                  <BoardRow
                    key={entry.user_id}
                    entry={entry}
                    isMe={entry.user_id === user?.id}
                    maxDays={maxDays}
                    delay={i * 0.03}
                  />
                ))}
              </div>
              <p className="text-micro text-muted-foreground text-center mt-6">
                {tFallback(
                  'myGym.footer',
                  'Ranked by days trained, so showing up is what counts.',
                )}
              </p>
            </>
          )}
        </div>
      )}

      {/* ── The one 32px break on this page ─────────────────────────
          Above it: the floor you train on. Below it: managing which
          gyms you belong to. A second break of this size would mean
          neither reads as the break. */}
      <div className="mt-8">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h2 className="font-heading text-base font-bold">{tFallback("myGym.otherGyms", "Other gyms")}</h2>
          {!gymsLoading && otherGyms.length > 0 && (
            <p className="text-micro text-muted-foreground shrink-0 tabular-nums">
              {otherGyms.length} joined
            </p>
          )}
        </div>

        {gymsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : otherGyms.length === 0 ? (
          // A single muted line, not an empty-state block: the two ways
          // to fix it are the next two things on the screen, so an
          // illustration and a CTA would just repeat them.
          <p className="text-sm text-muted-foreground">
            {tFallback('myGym.noneYet', 'Nothing yet. Join with a code below, or find one on the map.')}
          </p>
        ) : (
          <div className="divide-y divide-border">
            {otherGyms.map(g => (
              <button
                key={g.id}
                type="button"
                onClick={() => navigate(`/gym/${g.id}`)}
                className="w-full text-start py-2 flex items-center gap-2 hover:bg-secondary/30 active:bg-secondary/30 transition-colors"
              >
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                  {g.logo_url
                    ? <img loading="lazy" src={g.logo_url} alt="" className="w-full h-full object-cover" />
                    : <Building2 className="w-4 h-4 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0 ms-2">
                  <p className="font-semibold text-sm truncate">{g.name}</p>
                  <p className="text-micro text-muted-foreground truncate">
                    {[g.city, g.state_code].filter(Boolean).join(', ') || '—'}
                    {' · '}
                    <span className="tabular-nums">{g.member_count ?? 0}</span>
                    {' members'}
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Join another gym ────────────────────────────────────── */}
      <form onSubmit={handleJoin} className="mt-6 rounded-2xl border border-border p-4">
        <div className="flex items-center gap-2 mb-2">
          <QrCode className="w-4 h-4 text-muted-foreground" />
          <p className="text-sm font-semibold">{tFallback("myGym.joinAnotherGym", "Join another gym")}</p>
        </div>
        <p className="text-xs text-muted-foreground mb-6">
          {tFallback('myGym.joinHint', 'Scan the QR code or type the {n} character Flexyn Code printed inside the gym.', { n: 8 })}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setScannerOpen(true)}
            className="shrink-0"
            aria-label={tFallback("myGym.scanQrCode", "Scan QR code")}
          >
            <ScanLine className="w-4 h-4" />
          </Button>
          <Input
            value={codeInput}
            onChange={(e) => {
              // Tolerate URL-shaped pastes. If the user pastes a
              // flexyn://gym/CODE or https://flexyn.app/g/CODE link,
              // extract just the 8-character code. Previously the
              // strict char-allowlist stripped to e.g. "FLXYN" from
              // "flexyn://gym/ABCD2345" and the join failed silently.
              // (Audit 12 #12.)
              const raw = e.target.value || '';
              const urlMatch = raw.match(/(?:[\\/]|^)([A-HJ-NP-Z2-9]{8})(?:[^A-Z0-9]|$)/i);
              const next = urlMatch
                ? urlMatch[1].toUpperCase()
                : raw.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 8);
              setCodeInput(next);
            }}
            placeholder={tFallback("myGym.abcd2345", "ABCD2345")}
            maxLength={8}
            className="font-mono tracking-[0.3em] text-center text-lg uppercase"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button type="submit" disabled={joining || codeInput.length !== 8}>
            {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </Button>
        </div>
      </form>

      {scannerOpen && (
        <Suspense fallback={null}>
          <QrCodeScanner
            open={scannerOpen}
            onClose={() => setScannerOpen(false)}
            onDetect={joinWithCode}
          />
        </Suspense>
      )}

      {/* Discovery, as opposed to "Change gym" in the header, which
          swaps the ONE gym you train at.
          Hidden while the hero is the picker or the "no longer listed"
          notice, because both of those end in a map control of their
          own — two identical buttons a screen apart read as a bug. */}
      {!loading && gym && (
      <button
        type="button"
        onClick={() => navigate('/gym-map')}
        className="mt-6 w-full py-2.5 rounded-lg text-sm font-bold border border-border bg-card text-primary hover:border-primary/40 active:border-primary/40 transition-all inline-flex items-center justify-center gap-2"
      >
        <MapPin className="w-4 h-4" />
        {tFallback("myGym.browseTheMap", "Browse the map")}
      </button>
      )}

      {/* Owner CTA — discoverable from every user's gym page so business
          owners can self-serve the verification flow without a separate
          signup path. This route is the canonical entry to the whole gym
          ecosystem; this keeps everything one tap away. */}
      <button
        type="button"
        onClick={() => navigate('/register-gym')}
        className="mt-6 w-full rounded-2xl border border-dashed border-border bg-card hover:bg-secondary/30 active:bg-secondary/30 transition-colors p-4 text-start"
      >
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-violet-500" />
          </div>
          <div className="flex-1 min-w-0 ms-2">
            <p className="font-heading font-bold text-sm">{tFallback("myGym.ownAGym", "Own a gym?")}</p>
            <p className="text-xs text-muted-foreground">
              {tFallback('myGym.ownAGymBody', 'Register your location so members can join and you show up on the national map.')}
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </div>
      </button>
    </motion.div>
  );
}
