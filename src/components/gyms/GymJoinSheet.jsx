// src/components/gyms/GymJoinSheet.jsx
//
// Confirm a gym pick, join it, and show what joining got you.
//
// Picking used to commit silently and advance the step, so the moment a
// user chose their gym — the one social commitment onboarding asks for —
// nothing acknowledged it. This puts a beat there: who you picked, a way
// out, and then the floor you just joined.
//
// ── This writes, and onboarding otherwise doesn't ────────────────────
//
// The home_gym step deliberately holds its pick in state and applies it
// in handleRevealNext, so abandoning signup halfway leaves no community
// gym and no membership behind. Join breaks that on purpose, because the
// leaderboard is the payoff and it CANNOT be shown before the write:
// get_gym_consistency_leaderboard is gated on is_gym_member_or_owner
// (mig 158) and answers a non-member with 42501. Showing a real floor
// means being on it.
//
// The cost is real and accepted (Kegan, 2026-08-06): someone who taps
// Join and then abandons signup leaves a membership behind, and for an
// OSM or custom pick, a community gym row they created. Consequences:
//
//   • The onboarding draft records that the pick was already applied, so
//     handleRevealNext must not write it a second time.
//   • Cancel after joining is a real leave, not just closing a sheet.
//
// ── Why a static map and not a real one ──────────────────────────────
//
// The first-member card shows tiles from src/lib/staticMap.js rather than
// a MapLibre instance. vite.config keeps maplibre-gl out of vendor-misc
// so it stays a lazy chunk; importing it here would put a map engine on
// the most latency-sensitive screen in the app for a card nobody touches.

import React, { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import BottomSheet from '@/components/ui/BottomSheet';
import { staticMapCard } from '@/lib/staticMap';
import {
  setHomeGym, setHomeGymFromOsm, getGymConsistencyBoard,
} from '@/lib/data/homeGym';
import { leaveGym } from '@/lib/data/gymBusinesses';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { reportError } from '@/lib/reportError';
import { useLanguage } from '@/lib/LanguageContext';
import TransText from '@/components/TransText';

const KM_PER_MILE = 1.609344;

/** Route a pick shape to the RPC that commits it. */
function commit(pick) {
  if (pick?.osm) return setHomeGymFromOsm(pick.osm);
  return setHomeGym(pick?.gymId);
}

function StaticMapCard({ lat, lng, label }) {
  const { tFallback } = useLanguage();
  const card = staticMapCard(lat, lng, { width: 320, height: 150 });
  if (!card) return null;
  return (
    <div>
      <div
        className="relative w-full rounded-xl overflow-hidden border border-border bg-secondary"
        style={{ height: card.height }}
        role="img"
        aria-label={tFallback('gymJoinSheet.mapAria', 'Map showing {name}', { name: label })}
      >
        <div
          className="absolute"
          style={{
            width: card.blockSize,
            height: card.blockSize,
            transform: `translate(${card.offsetX}px, ${card.offsetY}px)`,
          }}
        >
          {card.tiles.map(t => (
            <img
              key={t.key}
              src={t.url}
              alt=""
              aria-hidden="true"
              loading="lazy"
              width={256}
              height={256}
              className="absolute select-none"
              style={{ left: t.left, top: t.top }}
            />
          ))}
        </div>
        {/* The pin sits at the card's centre because that is exactly where
            staticMapCard puts the point. */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="w-4 h-4 rounded-full bg-primary border-2 border-white shadow-md" />
        </div>
      </div>
      {/* ODbL. There is no MapLibre attribution control on an image grid,
          so the credit has to be ours. */}
      <p className="text-micro text-muted-foreground mt-1">{card.attribution}</p>
    </div>
  );
}

/**
 * @param {object}   pick      picker output + display fields
 * @param {boolean}  open
 * @param {Function} onCancel  user backed out; the pick is cleared
 * @param {Function} onJoined  (gymId) => void — committed, host records it
 * @param {Function} onContinue advance the step
 */
export default function GymJoinSheet({ pick, open, onCancel, onJoined, onContinue }) {
  const { tFallback } = useLanguage();
  const { distanceUnit } = useDistanceUnit();
  const imperial = distanceUnit !== 'km';

  const [stage, setStage] = useState('confirm'); // confirm | joining | joined
  const [error, setError] = useState(null);
  const [gymId, setGymId] = useState(null);
  const [board, setBoard] = useState([]);
  const [firstMember, setFirstMember] = useState(false);

  const reset = useCallback(() => {
    setStage('confirm'); setError(null); setGymId(null);
    setBoard([]); setFirstMember(false);
  }, []);

  const fmtDistance = (km) => (imperial
    ? `${(km / KM_PER_MILE).toFixed(1)} mi`
    : (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`));

  const join = async () => {
    setStage('joining');
    setError(null);
    const res = await commit(pick);
    if (!res.ok) {
      setError({
        NAME_REJECTED: tFallback('gymJoinSheet.error.nameRejected', "That gym's name can't be added automatically."),
        CREATE_LIMIT: tFallback('gymJoinSheet.error.createLimit', "You've added a lot of gyms already. Pick an existing one."),
      }[res.error] || tFallback('gymJoinSheet.error.generic', "Couldn't join that gym. Try again."));
      setStage('confirm');
      return;
    }

    setGymId(res.gymId);
    onJoined?.(res.gymId);

    // `created` means this row did not exist a moment ago, so the caller
    // is definitionally its first member. For an existing row, the count
    // the picker already fetched answers it without another round trip.
    const alone = res.created === true || (pick?.memberCount ?? 0) === 0;
    setFirstMember(alone);

    if (!alone) {
      try {
        setBoard(await getGymConsistencyBoard(res.gymId, 10));
      } catch (err) {
        // A board that won't load is not a failed join. Fall through to
        // the first-member layout rather than stranding the user on a
        // spinner over something already committed.
        reportError(err, { feature: 'gym-join.board' });
        setFirstMember(true);
      }
    }
    setStage('joined');
  };

  const cancel = async () => {
    // Cancelling AFTER a join is a real leave — the row exists now.
    if (gymId) {
      await setHomeGym(null).catch(() => {});
      await leaveGym(gymId).catch(() => {});
    }
    reset();
    onCancel?.();
  };

  const coords = pick?.osm
    ? { lat: pick.osm.lat, lng: pick.osm.lon }
    : { lat: pick?.latitude, lng: pick?.longitude };

  return (
    <BottomSheet
      open={open}
      onClose={stage === 'joining' ? () => {} : cancel}
      title={stage !== 'joined'
        ? tFallback('gymJoinSheet.title.confirm', 'Your gym')
        : firstMember
          ? tFallback('gymJoinSheet.title.founding', 'Founding member')
          : tFallback('gymJoinSheet.title.joined', 'You’re on the floor')}
    >
      <div className="space-y-4 pb-2">
        {/* Identity block — the same on every stage, so the thing the
            user picked never leaves the screen while they decide. */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center shrink-0 text-lg">
            🏋
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold truncate">{pick?.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {Number.isFinite(pick?.distance) && `${fmtDistance(pick.distance)} · `}
              {pick?.sub || tFallback('gymJoinSheet.onTheMap', 'On the map')}
            </p>
          </div>
        </div>

        {error && (
          <p className="text-xs text-destructive" role="alert">{error}</p>
        )}

        {stage !== 'joined' ? (
          <>
            <p className="text-sm text-muted-foreground">
              {tFallback('gymJoinSheet.confirmBody', 'Joining puts you on this gym’s leaderboard and shows you on the Flexyn map here. You can change it any time.')}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={cancel}
                disabled={stage === 'joining'}
                className="flex-1 py-3 rounded-xl text-sm font-bold border border-border bg-secondary disabled:opacity-50 transition-all"
              >
                {tFallback("coach.plan.cancel", "Cancel")}
              </button>
              <button
                type="button"
                onClick={join}
                disabled={stage === 'joining'}
                className="flex-1 py-3 rounded-xl text-sm font-bold bg-primary text-primary-foreground disabled:opacity-60 transition-all"
              >
                {stage === 'joining' ? tFallback('gymJoinSheet.joining', 'Joining…') : tFallback('gymJoinSheet.join', 'Join gym')}
              </button>
            </div>
          </>
        ) : firstMember ? (
          <>
            {/* Nobody to rank against yet, so the payoff is the place
                plus being first to it.

                Carefully NOT possessive. This said "your gym", "it's
                yours" and "your leaderboard", which reads as ownership
                and control — claiming the place, running the board,
                deciding who is on it. None of that is true: joining
                sets a home gym, and owner_id stays NULL precisely
                because nobody has proven they own anything (mig 275).
                The board is shared by everyone who makes this their
                home gym, and this user is simply the first name on it.
                "Founding member" is the honest word for that. */}
            <p className="text-sm text-muted-foreground">
              {tFallback('gymJoinSheet.foundingBody', 'You’re the first person on Flexyn who trains here. The gym belongs to everyone who shows up. As others make it their home gym they join this leaderboard alongside you, and it starts filling from the day they do.')}
            </p>
            {/* The colour rule, said once, where it is first true. */}
            <p className="text-xs text-muted-foreground">
              <TransText
                k="gymJoinSheet.mapColourRule"
                en="On the map it’s {orange} because you’ve joined it. Gyms other people have joined show blue."
                values={{ orange: <span className="font-semibold text-primary">{tFallback("gymJoinSheet.orange", "orange")}</span> }}
              />
            </p>
            <StaticMapCard lat={coords.lat} lng={coords.lng} label={pick?.name} />
            <button
              type="button"
              onClick={onContinue}
              className="w-full py-3 rounded-xl text-sm font-bold bg-primary text-primary-foreground transition-all"
            >
              {tFallback("levelUp.continue", "Continue")}
            </button>
          </>
        ) : (
          <>
            <p className="text-micro font-semibold tracking-wide uppercase text-muted-foreground">
              {tFallback('gymJoinSheet.thisWeekAt', 'This week at {name}', { name: pick?.name })}
            </p>
            {/* Ranked by active days, not volume — mig 275's reasoning:
                ranking a local floor by weight moved sorts it by bodyweight
                and training age, and tells a beginner they're last. */}
            <div className="space-y-1">
              {board.slice(0, 5).map((row, i) => (
                <motion.div
                  key={row.user_id || row.username || i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 * i, duration: 0.25 }}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2"
                >
                  <span className="w-5 text-sm font-bold text-muted-foreground tabular-nums">
                    {i + 1}
                  </span>
                  <span className="flex-1 min-w-0 text-sm font-semibold truncate">
                    {row.username || tFallback('gymJoinSheet.member', 'Member')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {tFallback('gymJoinSheet.days', '{n} days', { n: row.active_days ?? 0 })}
                  </span>
                </motion.div>
              ))}
              {board.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {tFallback('gymJoin.nobodyTrained', 'Nobody here has trained in the last 7 days. Be the one who does.')}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onContinue}
              className="w-full py-3 rounded-xl text-sm font-bold bg-primary text-primary-foreground transition-all"
            >
              {tFallback("levelUp.continue", "Continue")}
            </button>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
