// src/pages/MyGym.jsx
//
// "My Gym" (route: /my-gym) — the home gym a user picked in onboarding.
//
// Distinct from /my-gyms (plural), which lists every gym they've ever
// joined. This is the ONE they train at, and it answers two questions:
//
//   1. How am I doing against the people on my floor?  → leaderboard
//   2. How is my floor doing as a whole?               → community bar
//
// Ranked by CONSISTENCY — distinct days trained in the last 7 — not by
// volume. Ranking a local gym board by weight moved sorts it by
// bodyweight and training age and tells a beginner they're last, which
// is exactly the person a gym-floor social feature needs to keep. Days
// shown up is something anyone can win. Same reasoning as mig 150.
//
// Both data calls are members-only server-side (mig 158 / 275), so a
// user who left the gym in another tab gets empty state rather than a
// render-time throw.

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Building2, Users, Loader2, MapPin, ArrowRight, Flame,
  CalendarCheck, Dumbbell, Trophy, Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import EmptyState from '@/components/EmptyState';
import { useLanguage } from '@/lib/LanguageContext';
import {
  getHomeGym, getCommunityProgress, getGymConsistencyBoard, resolveHomeGymId,
  setHomeGym, setHomeGymFromOsm, setHomeGymCustom,
} from '@/lib/data/homeGym';
import NearbyGymPicker from '@/components/gyms/NearbyGymPicker';
import { toast } from '@/lib/toast';

// ── Community progress ──────────────────────────────────────────────
//
// The shared number. "X of Y trained this week" is the honest headline:
// it's participation, which is the thing a gym community can actually
// move together, rather than a volume total that one big lifter
// dominates.
function CommunityProgress({ progress, tFallback }) {
  if (!progress) return null;

  const { memberCount, activeMembers, workoutCount, activeDays, totalVolume } = progress;
  const pct = memberCount > 0
    ? Math.min(100, Math.round((activeMembers / memberCount) * 100))
    : 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Flame className="w-4 h-4 text-orange-500" />
        <p className="text-sm font-semibold">
          {tFallback('myGym.communityProgress', 'Community progress')}
        </p>
        <span className="ms-auto text-micro text-muted-foreground">
          Last 7 days
        </span>
      </div>

      <div className="flex items-baseline gap-1.5 mb-1">
        <span className="font-heading text-2xl font-bold tabular-nums">{activeMembers}</span>
        <span className="text-sm text-muted-foreground">
          of {memberCount} 
          members trained this week
        </span>
      </div>

      <div
        className="w-full h-2 rounded-full bg-secondary overflow-hidden mb-3"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={tFallback('myGym.communityProgress', 'Community progress')}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-orange-500 to-primary transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: Dumbbell, value: workoutCount, label: 'sessions' },
          { icon: CalendarCheck, value: activeDays, label: 'gym days' },
          {
            icon: Trophy,
            value: totalVolume >= 1000
              ? `${Math.round(totalVolume / 1000)}k`
              : Math.round(totalVolume),
            label: 'lbs moved',
          },
        ].map(({ icon: Icon, value, label }) => (
          <div key={label} className="rounded-xl bg-secondary/50 px-2 py-2 text-center">
            <Icon className="w-3.5 h-3.5 text-muted-foreground mx-auto mb-1" />
            <p className="font-heading font-bold text-sm tabular-nums leading-none">{value}</p>
            <p className="text-micro text-muted-foreground mt-0.5">{label}</p>
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

  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${
        isMe ? 'bg-primary/10 border border-primary/30' : ''
      }`}
    >
      <div className="w-7 flex justify-center shrink-0">
        {medal
          ? <span className="text-lg leading-none">{medal}</span>
          : (
            <span className="text-xs font-bold tabular-nums text-muted-foreground">
              {rank}
            </span>
          )}
      </div>

      <div className="w-8 h-8 rounded-full overflow-hidden bg-secondary shrink-0 flex items-center justify-center">
        {entry.avatar_url
          ? <img loading="lazy" src={entry.avatar_url} alt="" className="w-full h-full object-cover" />
          : <Users className="w-3.5 h-3.5 text-muted-foreground" />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">
          {entry.username || 'Member'}
          {isMe && (
            <span className="ms-1.5 text-micro font-bold text-primary">
              YOU
            </span>
          )}
        </p>
        <div className="mt-1 h-1 rounded-full bg-secondary overflow-hidden">
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
        <p className="text-micro text-muted-foreground">
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

  const [gym, setGym] = useState(null);
  const [board, setBoard] = useState([]);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [homeGymId, setHomeGymId] = useState(null);
  // Empty-state picker: `pending` is the highlighted row, committed by
  // confirmPick. Kept separate from `homeGymId` so tapping a row never
  // writes until the button is pressed.
  const [pending, setPending] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // Never read user.home_gym_id alone — see resolveHomeGymId. Straight
    // after onboarding the context still holds the pre-pick profile, and
    // trusting it renders "you haven't picked a gym yet" at someone who
    // picked one sixty seconds ago.
    const id = await resolveHomeGymId(user?.home_gym_id);
    setHomeGymId(id);
    if (!id) { setLoading(false); return; }

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

  useEffect(() => { load(); }, [load]);

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
    const res = choice.custom
      ? await setHomeGymCustom(choice.custom)
      : choice.osm
        ? await setHomeGymFromOsm(choice.osm)
        : await setHomeGym(choice.gymId);
    setSaving(false);

    if (!res.ok) {
      const msg = {
        NAME_REJECTED: "That gym's name can't be added automatically.",
        CREATE_LIMIT: "You've added a lot of gyms already — pick an existing one.",
        GYM_INACTIVE: 'That gym is no longer active on Flexyn.',
        GYM_NOT_FOUND: "We couldn't find that gym any more.",
        NAME_REQUIRED: 'Give the gym a name first.',
        BAD_COORDS: "We couldn't tell where you are — turn location on and retry.",
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
    toast.success(`${choice.name} is now your gym.`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          await setHomeGym(null);
          setPending(null);
          load();
        },
      },
    });

    setPending(null);
    // setHomeGym patched the profile cache, so resolveHomeGymId picks
    // the new id up on this reload without waiting for AuthContext.
    load();
  }, [saving, load]);

  // ── No home gym picked ────────────────────────────────────────────
  if (!loading && !homeGymId) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl mx-auto p-4 pb-24"
      >
        <h1 className="font-heading text-2xl font-bold tracking-tight mb-1">
          {tFallback('myGym.title', 'My Gym')}
        </h1>
        <p className="text-sm text-muted-foreground mb-4">
          {tFallback('myGym.subtitle', 'Your home gym and the people who train there.')}
        </p>
        {/* Pick in place, rather than only pointing at the map.
            Everyone who signed up before mig 275 shipped never sees the
            onboarding gym step, so for them the map was the ONLY way to
            set a home gym — and nothing on this screen said so. That is
            the whole reason this prompt exists; don't reduce it back to
            a link. */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="w-4 h-4 text-primary shrink-0" />
            <p className="font-heading font-bold text-base">
              {tFallback('myGym.pickTitle', 'Which gym do you train at?')}
            </p>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            {tFallback(
              'myGym.pickBody',
              "Tap it below and you'll get a leaderboard with everyone else who trains there — plus a bubble on the Flexyn map. You can change it any time.",
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
              'Nothing is mapped within a few kilometres of you. Try the map instead — you can search anywhere in the country.',
            )}
          />

          <button
            type="button"
            onClick={() => navigate('/gym-map')}
            className="w-full mt-2 py-2 text-sm text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
          >
            Browse the map instead
          </button>
        </div>
      </motion.div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Home gym id set but the row is gone — the gym was deactivated, or
  // deleted and the FK nulled on a row we've already cached. Offer the
  // way out rather than an infinite spinner.
  if (!gym) {
    return (
      <div className="max-w-2xl mx-auto p-4 pb-24">
        <EmptyState
          icon={Building2}
          title={tFallback('myGym.goneTitle', 'That gym is no longer listed')}
          body={tFallback(
            'myGym.goneBody',
            'The gym you picked is no longer active on Flexyn. Pick another from the map.',
          )}
          action={{
            label: tFallback('myGym.emptyCta', 'Find my gym'),
            onClick: () => navigate('/gym-map'),
          }}
        />
      </div>
    );
  }

  const maxDays = board.length > 0 ? Math.max(...board.map(r => Number(r.value) || 0)) : 0;
  const isCommunity = gym.source === 'community';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto p-4 pb-24"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold tracking-tight truncate">
            {tFallback('myGym.title', 'My Gym')}
          </h1>
          <p className="text-sm text-muted-foreground truncate">
            {tFallback('myGym.subtitle', 'Your home gym and the people who train there.')}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/gym-map')}
          className="gap-1.5 shrink-0"
        >
          <Pencil className="w-3.5 h-3.5" />
          Change
        </Button>
      </div>

      {/* Gym card */}
      <button
        type="button"
        onClick={() => navigate(`/gym/${gym.id}`)}
        className="w-full text-start rounded-2xl border border-border bg-card p-4 mb-4 hover:border-primary/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 overflow-hidden ${
            isCommunity ? 'bg-muted' : 'bg-primary/10'
          }`}>
            {gym.logo_url
              ? <img loading="lazy" src={gym.logo_url} alt="" className="w-full h-full object-cover" />
              : <Building2 className={`w-5 h-5 ${isCommunity ? 'text-muted-foreground' : 'text-primary'}`} />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-heading font-bold text-base truncate">{gym.name}</p>
            <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
              <MapPin className="w-3 h-3 shrink-0" />
              {[gym.city, gym.state_code].filter(Boolean).join(', ') || '—'}
            </p>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <Users className="w-3 h-3" />
              <span className="tabular-nums">{gym.member_count ?? 0}</span>
               on Flexyn
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </div>

        {/* A community gym has no verified owner. Saying so — and saying
            it can be claimed — is what keeps a grey bubble from reading
            as a broken business listing. */}
        {isCommunity && (
          <p className="mt-3 rounded-xl bg-secondary/60 px-3 py-2 text-micro text-muted-foreground">
            {tFallback(
              'myGym.communityNote',
              'Community gym — added by Flexyn members, not claimed by the business yet.',
            )}
          </p>
        )}
      </button>

      <CommunityProgress progress={progress} tFallback={tFallback} />

      {/* Leaderboard */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Trophy className="w-4 h-4 text-yellow-500" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {tFallback('myGym.leaderboard', 'Gym leaderboard')}
            </p>
            <p className="text-micro text-muted-foreground">
              {tFallback('myGym.rankedBy', 'Days trained · last 7 days')}
            </p>
          </div>
        </div>

        {board.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {tFallback(
              'myGym.boardEmpty',
              "Nobody here has logged a workout this week. Be the first — you'll take the top spot.",
            )}
          </p>
        ) : (
          <div className="p-2 space-y-1">
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
        )}
      </div>

      <p className="text-micro text-muted-foreground text-center mt-4">
        {tFallback(
          'myGym.footer',
          'Ranked by days trained, so showing up is what counts.',
        )}
      </p>
    </motion.div>
  );
}
