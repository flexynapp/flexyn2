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

import React, { useCallback, useEffect, useState } from 'react';
import { getGymsInBbox } from '@/lib/data/gymBusinesses';
import { fetchOsmGymsNear, distanceKm } from '@/lib/osmGyms';

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
  // Widen on demand. The default box is only ~11 km N-S by ~8 km E-W,
  // which is a reasonable "my gym" radius in a city and too small in a
  // suburb.
  const [radiusDeg, setRadiusDeg] = useState(0.05);

  // `radius` is always passed explicitly. It deliberately has no default
  // reading radiusDeg: this callback has empty deps (it must stay stable
  // or the mount effect re-fires), so a default would capture the FIRST
  // radius forever and silently ignore every widen.
  const load = useCallback((radius) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('denied');
      return undefined;
    }
    setStatus('locating');
    setOsmFailed(false);
    const ac = new AbortController();
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        try {
          // Both sources in parallel, each catching its own failure, so
          // Overpass being down can never hide the Flexyn gyms — but the
          // OSM failure is now RECORDED rather than discarded.
          const [flexyn, osm] = await Promise.all([
            getGymsInBbox({
              minLat: lat - (radius + 0.01), maxLat: lat + (radius + 0.01),
              minLng: lng - (radius + 0.01), maxLng: lng + (radius + 0.01),
              limit: 40,
            }).catch(() => []),
            fetchOsmGymsNear(lat, lng, { radiusDeg: radius, signal: ac.signal })
              .catch((e) => {
                if (e?.name !== 'AbortError') setOsmFailed(true);
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

          setRows([...dbRows, ...osmRows].sort((a, b) => a.distance - b.distance));
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

  // Mount-only: `load` closes over radiusDeg, and listing it here would
  // re-fetch on every widen in addition to the explicit call.
  useEffect(() => { load(0.05); }, [load]);

  const widen = () => {
    const next = Math.min(0.25, radiusDeg * 3);
    setRadiusDeg(next);
    load(next);
  };

  const q = query.trim().toLowerCase();
  const visible = (q
    ? rows.filter(r => r.name.toLowerCase().includes(q) || (r.sub || '').toLowerCase().includes(q))
    : rows
  ).slice(0, 40);

  const isSelected = (r) => (
    r.kind === 'db' ? value?.gymId === r.gymId : value?.osm?.osmId === r.osm?.osmId
  );

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
        <button
          type="button"
          onClick={load}
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
      <div className="rounded-2xl border border-border bg-card p-4 text-center">
        <p className="text-sm font-semibold mb-1">
          {lookupBroke ? "Couldn't search for gyms" : 'No gyms found nearby'}
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          {lookupBroke
            ? "The gym directory (OpenStreetMap) didn't respond, so we couldn't check what's around you. It's usually brief — try again."
            : (emptyHint || 'Nothing is mapped within a few kilometres of you.')}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => load(radiusDeg)}
            className="flex-1 py-2 rounded-xl text-sm font-bold border border-border bg-secondary hover:border-primary/40 transition-all"
          >
            Try again
          </button>
          {radiusDeg < 0.25 && (
            <button
              type="button"
              onClick={widen}
              className="flex-1 py-2 rounded-xl text-sm font-bold border border-border bg-secondary hover:border-primary/40 transition-all"
            >
              Search wider
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* We have SOME rows but the OSM half failed, so the list is
          missing every unregistered gym — which is most of them. Saying
          so is what stops a user concluding their gym isn't on Flexyn
          and giving up. */}
      {osmFailed && (
        <div className="mb-3 rounded-xl border border-border bg-secondary/50 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            Some nearby gyms couldn't be loaded — the OpenStreetMap directory
            didn't respond.{' '}
            <button
              type="button"
              onClick={() => load(radiusDeg)}
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
                <p className="text-[11px] text-muted-foreground truncate">
                  {r.distance < 1
                    ? `${Math.round(r.distance * 1000)} m`
                    : `${r.distance.toFixed(1)} km`}
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
      {radiusDeg < 0.25 && (
        <button
          type="button"
          onClick={widen}
          disabled={disabled}
          className="w-full mt-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          Don't see your gym? Search a wider area
        </button>
      )}
    </>
  );
}
