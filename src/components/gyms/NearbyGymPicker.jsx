// src/components/gyms/NearbyGymPicker.jsx
//
// "Which gym do you train at?" — the shared list behind both places a
// user can set a home gym (mig 275):
//
//   • the onboarding `home_gym` step (new signups)
//   • the My Gym empty state (everyone who signed up before this
//     shipped, and so never sees the onboarding step)
//
// Extracted rather than duplicated because the interesting part is the
// MERGE, not the markup: nearby gym_businesses rows and live
// OpenStreetMap results are two views of the same street, and an OSM
// entry that has already been promoted to a community gym must appear
// ONCE — as the database row. Two copies would offer the user a choice
// between joining the existing community and forking a second one at
// the same address, which is the failure this whole feature is built to
// avoid. Keeping that rule in one file is the point.
//
// Purely presentational about *what happens next*: it reports the pick
// via onChange and never writes. Onboarding defers the write to its
// final save; My Gym writes immediately. Both use the same shape:
//   { gymId, name }        an existing gym_businesses row
//   { osm, name }          an OSM feature to promote on save

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getGymsInBbox } from '@/lib/data/gymBusinesses';
import {
  fetchOsmGymsNear, distanceKm, bboxAround, DEFAULT_NEAR_RADIUS_KM,
} from '@/lib/osmGyms';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';

const KM_PER_MILE = 1.609344;

/**
 * Widen steps, in km — 5 / 15 / 30 miles.
 *
 * The 30-mile ceiling is not arbitrary: outside a city, 5 miles can be
 * genuinely empty. Sanford, Maine has five mapped gyms within 3 miles
 * but the next cluster is 13 miles out, and a beta tester there was
 * shown "no gyms found" with a button they had to notice and press.
 */
const RADIUS_STEPS_KM = [DEFAULT_NEAR_RADIUS_KM, 24, 48];
const MAX_RADIUS_KM = RADIUS_STEPS_KM[RADIUS_STEPS_KM.length - 1];

/**
 * @param {object|null} value      current pick — { gymId } or { osm }
 * @param {(v:object|null)=>void} onChange
 * @param {boolean} [disabled]     freeze the list while a save is in flight
 * @param {string}  [emptyHint]    copy for "nothing mapped near you"
 * @param {boolean} [deselectable] whether tapping the current pick clears
 *                                 it. True for onboarding (the pick is
 *                                 provisional and skippable); false where
 *                                 a tap commits immediately, since there
 *                                 "tap it again" must not mean "unset my
 *                                 home gym".
 * @param {string|null} [busyKey]  row key currently being saved — renders
 *                                 a spinner on that row instead of a ✓
 */
export default function NearbyGymPicker({
  value, onChange, disabled = false, emptyHint,
  deselectable = true, busyKey = null,
}) {
  const [status, setStatus] = useState('locating'); // locating | ready | denied | failed
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  // Did the OpenStreetMap half fail, as opposed to returning nothing?
  //
  // These are NOT the same thing and conflating them is what shipped a
  // bug: the catch below used to swallow the error, leaving rows empty,
  // and the empty branch then told the user "No gyms found nearby" —
  // a confident false statement, with no retry offered. Overpass is
  // genuinely unreliable (audited 2026-08-01: one mirror 406s browsers
  // outright and sends no CORS header, another was timing out on every
  // request), so this path is hit for real, not theoretically.
  const [osmFailed, setOsmFailed] = useState(false);
  // The geolocation fix, kept after the lookup finishes. "Add my gym"
  // places the new gym exactly where the user is standing, which is the
  // whole basis for trusting a typed name: the person adding it is the
  // person who trains there.
  const [fix, setFix] = useState(null);
  const [adding, setAdding] = useState(false);
  const [customName, setCustomName] = useState('');
  // Widen on demand, in KILOMETRES. It used to be a raw degree offset
  // applied to both axes, which made the real east-west reach shrink with
  // latitude — 0.05° is 3.0 miles in Houston and 2.3 in Seattle — so a
  // gym three miles away was never fetched. See bboxAround().
  const [radiusKm, setRadiusKm] = useState(DEFAULT_NEAR_RADIUS_KM);
  // `load` has empty deps and cannot read radiusKm. This is how a
  // finishing request knows whether it is still the newest one — a
  // manual widen mid-flight must not be overridden by the older load's
  // auto-escalation.
  const radiusRef = useRef(DEFAULT_NEAR_RADIUS_KM);

  // The app has a distance-unit preference of its own — synced to the
  // profile, settable in Settings, and already read by the cardio,
  // goals and leaderboard surfaces. Use it.
  //
  // This originally derived miles-vs-km from the WEIGHT unit, on the
  // reasoning that lbs implies miles. It does, but it was reinventing a
  // preference the user may have set explicitly, and disagreeing with
  // every other distance in the app the moment they set one.
  const { distanceUnit } = useDistanceUnit();
  const imperial = distanceUnit !== 'km';
  const fmtRadius = (km) => (imperial
    ? `${Math.round(km / KM_PER_MILE)} mi`
    : `${Math.round(km)} km`);

  // `radius` is always passed explicitly. It deliberately has no default
  // reading radiusKm: this callback has empty deps (it must stay stable
  // or the mount effect re-fires), so a default would capture the FIRST
  // radius forever and silently ignore every widen.
  const load = useCallback((radius) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('denied');
      return undefined;
    }
    radiusRef.current = radius;
    setStatus('locating');
    setOsmFailed(false);
    const ac = new AbortController();
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setFix({ lat, lng });
        let osmBroke = false;
        try {
          // Both sources in parallel, each catching its own failure, so
          // Overpass being down can never hide the Flexyn gyms — but the
          // OSM failure is now RECORDED rather than discarded.
          // The Flexyn half searches 1 km wider so a registered gym that
          // sits just past the OSM edge still shows up.
          const box = bboxAround(lat, lng, radius + 1);
          const [flexyn, osm] = await Promise.all([
            getGymsInBbox({
              minLat: box.south, maxLat: box.north,
              minLng: box.west,  maxLng: box.east,
              limit: 40,
            }).catch(() => []),
            fetchOsmGymsNear(lat, lng, { radiusKm: radius, signal: ac.signal })
              .catch((e) => {
                if (e?.name !== 'AbortError') { osmBroke = true; setOsmFailed(true); }
                return [];
              }),
          ]);

          const dbRows = (flexyn || []).map(g => ({
            key: `db:${g.id}`,
            kind: 'db',
            gymId: g.id,
            name: g.name,
            sub: [g.city, g.state_code].filter(Boolean).join(', '),
            memberCount: g.member_count ?? 0,
            source: g.source || 'owner',
            osmKey: g.osm_id != null ? `${g.osm_type || 'node'}/${g.osm_id}` : null,
            distance: distanceKm(lat, lng, g.latitude, g.longitude),
          }));

          // The dedupe that matters — see the head comment.
          const claimed = new Set(dbRows.map(r => r.osmKey).filter(Boolean));

          const osmRows = (osm || [])
            .filter(g => !claimed.has(`${g.osmType || 'node'}/${g.osmId}`))
            .map(g => ({
              key: `osm:${g.osmType}/${g.osmId}`,
              kind: 'osm',
              osm: g,
              name: g.name,
              sub: g.brand || 'On OpenStreetMap',
              memberCount: 0,
              source: 'osm',
              distance: distanceKm(lat, lng, g.lat, g.lon),
            }));

          const merged = [...dbRows, ...osmRows]
            .sort((a, b) => a.distance - b.distance);

          // Nothing within the default radius, and the lookup WORKED —
          // so this is a real "there is nothing here", which outside a
          // city is normal. Go straight out to the maximum rather than
          // rendering an empty state and a button the user has to
          // notice: the whole screen exists to hand them a list.
          //
          // Gated on `osmBroke` — widening a FAILED lookup just fails
          // again, more slowly, and tells them "nothing within 30 miles"
          // about a query that never ran. That claim has to be earned.
          //
          // Reads the ref, not `radius`: two loads can be in flight
          // after a manual widen and only the newest may escalate.
          if (merged.length === 0 && !osmBroke && radius < MAX_RADIUS_KM
              && radiusRef.current === radius) {
            setRadiusKm(MAX_RADIUS_KM);
            load(MAX_RADIUS_KM);
            return;
          }

          setRows(merged);
          setStatus('ready');
        } catch {
          setStatus('failed');
        }
      },
      () => setStatus('denied'),
      { timeout: 8_000, maximumAge: 600_000 },
    );
    return () => ac.abort();
  }, []);

  // Mount-only: listing radiusKm here would re-fetch on every widen in
  // addition to the explicit call.
  useEffect(() => { load(DEFAULT_NEAR_RADIUS_KM); }, [load]);

  const widen = () => {
    const next = RADIUS_STEPS_KM.find(km => km > radiusKm) ?? MAX_RADIUS_KM;
    setRadiusKm(next);
    load(next);
  };

  // ── "My gym isn't listed" (mig 299) ──────────────────────────────────
  //
  // Not every gym is in OpenStreetMap, and no radius reaches one that
  // isn't. A tester's Planet Fitness three miles away appears in no tag
  // on any of the 1,905 named objects within five miles of him — so
  // before this, the feature simply did not work where OSM coverage is
  // thin, which is where a local gym community is worth the most.
  //
  // The name is typed; the POSITION is the user's own geolocation fix,
  // never an address they type. That is what makes the row trustworthy
  // enough to share: whoever adds it is standing in it.
  const canAddCustom = !!fix && !disabled;
  const trimmedCustom = customName.trim();

  const submitCustom = () => {
    if (!canAddCustom || trimmedCustom.length < 2) return;
    onChange({
      custom: { name: trimmedCustom, lat: fix.lat, lng: fix.lng },
      name: trimmedCustom,
      key: `custom:${trimmedCustom.toLowerCase()}`,
    });
    setAdding(false);
    setCustomName('');
  };

  /** The add-your-gym form, and the button that opens it. */
  const addCustomBlock = (
    <div className="mt-3">
      {adding ? (
        <div className="rounded-xl border border-border bg-card p-3">
          <label htmlFor="custom-gym-name" className="text-micro text-muted-foreground">
            We&apos;ll add it at your current location.
          </label>
          <input
            id="custom-gym-name"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitCustom(); }}
            placeholder="Gym name"
            maxLength={120}
            autoFocus
            className="w-full mt-2 px-3 py-2 rounded-xl border border-border bg-background text-sm outline-none focus:border-primary/50 transition-colors"
          />
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={submitCustom}
              disabled={trimmedCustom.length < 2}
              className="flex-1 py-2 rounded-xl text-sm font-bold bg-primary text-primary-foreground disabled:opacity-50 transition-all"
            >
              Add gym
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setCustomName(''); }}
              className="px-4 py-2 rounded-xl text-sm font-bold border border-border bg-secondary transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={!canAddCustom}
          className="w-full py-2 text-xs text-muted-foreground hover:text-foreground active:text-foreground transition-colors disabled:opacity-50"
        >
          My gym isn&apos;t listed — add it
        </button>
      )}
    </div>
  );

  const q = query.trim().toLowerCase();
  const visible = (q
    ? rows.filter(r => r.name.toLowerCase().includes(q) || (r.sub || '').toLowerCase().includes(q))
    : rows
  ).slice(0, 40);

  const isSelected = (r) => (
    r.kind === 'db' ? value?.gymId === r.gymId : value?.osm?.osmId === r.osm?.osmId
  );

  // A custom pick has no row in the list to carry its ✓ — it doesn't
  // exist anywhere yet. Onboarding holds the pick until final save, so
  // without this the user types a name, taps Add, and the screen looks
  // exactly as it did before: the same failure mode the My Gym picker
  // already had once, where "highlighted" was mistaken for "saved".
  const customPick = value?.custom
    ? (
      <button
        type="button"
        onClick={() => { if (deselectable && !disabled) onChange(null); }}
        aria-pressed="true"
        className="w-full text-start rounded-xl border border-primary bg-primary/10 p-3 mb-2 flex items-center gap-3"
      >
        <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0 text-sm">
          🏋
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{value.custom.name}</p>
          <p className="text-micro text-muted-foreground truncate">
            Adding at your location
          </p>
        </div>
        {busyKey === value.key
          ? (
            <span
              className="w-4 h-4 shrink-0 rounded-full border-2 border-primary border-t-transparent animate-spin"
              role="status"
              aria-label="Saving"
            />
          )
          : <span className="text-primary text-lg leading-none shrink-0">✓</span>}
      </button>
    )
    : null;

  const pick = (r) => {
    if (disabled) return;
    if (isSelected(r)) {
      if (!deselectable) return;
      onChange(null);
      return;
    }
    onChange(r.kind === 'db'
      ? { gymId: r.gymId, name: r.name, key: r.key }
      : { osm: r.osm, name: r.name, key: r.key });
  };

  if (status === 'locating') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground">Finding gyms near you…</p>
      </div>
    );
  }

  if (status === 'denied' || status === 'failed') {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-center">
        <p className="text-sm font-semibold mb-1">
          {status === 'denied' ? 'Location is off' : "Couldn't load gyms"}
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          {status === 'denied'
            ? 'We need your location to find gyms near you. Turn it on and retry, or pick your gym from the map instead.'
            : 'The gym directory did not respond. Retry, or pick your gym from the map instead.'}
        </p>
        {/* `onClick={load}` handed React's click event straight to the
            radius argument. `lat - <SyntheticEvent>` is NaN, so Retry
            built a bbox of "NaN" strings and every retry after granting
            location permission failed on a malformed query — the one
            button on the one screen where a user has just fixed the
            problem themselves. */}
        <button
          type="button"
          onClick={() => load(radiusKm)}
          className="w-full py-2 rounded-xl text-sm font-bold border border-border bg-secondary hover:border-primary/40 transition-all"
        >
          Retry
        </button>
      </div>
    );
  }

  // Nothing to show. Two very different reasons, and saying the wrong
  // one is the bug this branch exists to prevent: "there are no gyms
  // near you" is a claim about the world, and we only get to make it
  // when the lookup actually succeeded.
  if (rows.length === 0) {
    const lookupBroke = osmFailed;
    return (
      <>
      {customPick}
      <div className="rounded-2xl border border-border bg-card p-4 text-center">
        <p className="text-sm font-semibold mb-1">
          {lookupBroke ? "Couldn't search for gyms" : 'No gyms found nearby'}
        </p>
        {lookupBroke ? (
          <p className="text-xs text-muted-foreground mb-3">
            The gym directory (OpenStreetMap) didn&apos;t respond, so we couldn&apos;t
            check what&apos;s around you. It&apos;s usually brief — try again.
          </p>
        ) : (
          <>
            {/* The radius is a FACT about what just happened and it always
                renders. It used to be `emptyHint || <radius line>`, and
                both hosts pass an emptyHint — so the radius sentence I
                added to make this claim checkable had never once appeared
                in the app. It only showed up in a test, which passes no
                hint. A fallback that every real caller overrides isn't a
                fallback, it's dead code.
                It costs a diagnosis, too: with the screen saying the same
                thing before and after a fix, neither we nor the user can
                tell which build a phone is running. */}
            <p className="text-xs text-muted-foreground mb-1">
              Nothing is mapped within <span className="font-semibold">{fmtRadius(radiusKm)}</span> of you.
            </p>
            {/* The host's line is ADVICE — "skip for now", "try the map" —
                which complements the fact rather than replacing it. */}
            {emptyHint && (
              <p className="text-xs text-muted-foreground mb-3">{emptyHint}</p>
            )}
          </>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => load(radiusKm)}
            className="flex-1 py-2 rounded-xl text-sm font-bold border border-border bg-secondary hover:border-primary/40 transition-all"
          >
            Try again
          </button>
          {radiusKm < MAX_RADIUS_KM && (
            <button
              type="button"
              onClick={widen}
              className="flex-1 py-2 rounded-xl text-sm font-bold border border-border bg-secondary hover:border-primary/40 transition-all"
            >
              Search wider
            </button>
          )}
        </div>
        {/* The point of this whole path. An empty list is exactly when
            "my gym isn't listed" is the true answer, and before mig 299
            it was a dead end — no radius reaches a gym that isn't in
            OpenStreetMap. */}
        {addCustomBlock}
      </div>
      </>
    );
  }

  return (
    <>
      {customPick}
      {/* We have SOME rows but the OSM half failed, so the list is
          missing every unregistered gym — which is most of them. Saying
          so is what stops a user concluding their gym isn't on Flexyn
          and giving up. */}
      {osmFailed && (
        <div className="mb-3 rounded-xl border border-border bg-secondary/50 px-3 py-2">
          <p className="text-micro text-muted-foreground">
            Some nearby gyms couldn't be loaded — the OpenStreetMap directory
            didn't respond.{' '}
            <button
              type="button"
              onClick={() => load(radiusKm)}
              className="font-semibold text-primary underline underline-offset-2"
            >
              Retry
            </button>
          </p>
        </div>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search nearby gyms"
        disabled={disabled}
        className="w-full mb-3 px-3 py-2 rounded-xl border border-border bg-card text-sm outline-none focus:border-primary/50 transition-colors disabled:opacity-50"
      />
      <div className="space-y-2">
        {visible.map(r => {
          const sel = isSelected(r);
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => pick(r)}
              disabled={disabled}
              aria-pressed={sel}
              className={[
                'w-full text-start rounded-xl border p-3 transition-all flex items-center gap-3',
                'disabled:opacity-60 disabled:cursor-not-allowed',
                sel ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40',
              ].join(' ')}
            >
              <div className={[
                'w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-sm',
                r.source === 'owner' ? 'bg-primary/15' : 'bg-secondary',
              ].join(' ')}>
                🏋
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{r.name}</p>
                <p className="text-micro text-muted-foreground truncate">
                  {imperial
                    ? `${(r.distance / KM_PER_MILE).toFixed(1)} mi`
                    : (r.distance < 1
                      ? `${Math.round(r.distance * 1000)} m`
                      : `${r.distance.toFixed(1)} km`)}
                  {r.sub ? ` · ${r.sub}` : ''}
                  {r.memberCount > 0 ? ` · ${r.memberCount} on Flexyn` : ''}
                </p>
              </div>
              {busyKey === r.key
                ? (
                  <span
                    className="w-4 h-4 shrink-0 rounded-full border-2 border-primary border-t-transparent animate-spin"
                    role="status"
                    aria-label="Saving"
                  />
                )
                : sel && <span className="text-primary text-lg leading-none shrink-0">✓</span>}
            </button>
          );
        })}
      </div>
      {visible.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-6">
          No nearby gym matches “{query}”.
        </p>
      )}

      {/* Always reachable, not just on the empty state — the most common
          "my gym isn't here" cause is a radius that's too small, and a
          user who can see a list has no other way to widen it. */}
      {radiusKm < MAX_RADIUS_KM && (
        <button
          type="button"
          onClick={widen}
          disabled={disabled}
          className="w-full mt-3 py-2 text-xs text-muted-foreground hover:text-foreground active:text-foreground transition-colors disabled:opacity-50"
        >
          Showing gyms within {fmtRadius(radiusKm)} — search wider
        </button>
      )}
      {addCustomBlock}
    </>
  );
}
