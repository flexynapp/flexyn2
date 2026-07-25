// src/pages/MyGyms.jsx
//
// User's "My Gyms" dashboard. Lists every gym the user has joined,
// plus the two entry points to add a new one:
//   1. "Join by code" — type/scan the 8-char Flexyn Code printed
//      inside the gym
//   2. "Browse map" — opens the national map (/gym-map) for discovery
//
// Empty state is the most common case for v1 — explain the value +
// CTA into both add paths.

import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, MapPin, Loader2, Building2, QrCode, Users, ArrowRight, ScanLine } from 'lucide-react';

const QrCodeScanner = lazy(() => import('@/components/gyms/QrCodeScanner'));
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import EmptyState from '@/components/EmptyState';
import { listMyGyms, joinByCode, getGymsInBbox } from '@/lib/data/gymBusinesses';

export default function MyGyms() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [gyms, setGyms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [codeInput, setCodeInput] = useState('');
  const [joining, setJoining] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  // Discovery rail when the user has no joined gyms — uses browser
  // geolocation to pull the 6 nearest demo + real gyms in a ~50km
  // radius. Soft-fails on permission denial; the rail simply hides.
  const [nearby, setNearby] = useState([]);

  // Shared join handler — used by both the typed-code form submit and
  // the QR scanner's onDetect. Wraps the same joinByCode + UX flow so
  // a scanned code is identical to a typed one from the user's POV.
  const joinWithCode = async (code) => {
    if (joining) return;
    setJoining(true);
    const res = await joinByCode(code);
    setJoining(false);
    if (res.ok) {
      if (res.alreadyMember) toast.info("You're already a member of this gym.");
      else toast.success('Joined! Welcome to the local community.');
      setCodeInput('');
      setScannerOpen(false);
      // Navigate first so we don't fire a refresh on a soon-to-unmount
      // page (audit B-19). The destination's own data fetch handles the
      // joined state.
      if (res.gymId) navigate(`/gym/${res.gymId}`);
      else refresh();
    } else {
      const map = {
        INVALID_CODE: "That code doesn't look right (8 letters/numbers).",
        CODE_NOT_FOUND: 'No gym matches that code.',
        PIPELINE_MISSING: 'Gym features are rolling out — try again shortly.',
      };
      toast.error(map[res.error] || `Couldn't join: ${res.error || 'try again'}`);
    }
  };

  const refresh = async () => {
    if (!user?.id) return;
    setLoading(true);
    const rows = await listMyGyms(user.id);
    setGyms(rows);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [user?.id]);

  // When the user has no joined gyms yet, try to pull a handful of
  // nearby ones using their current location. Doesn't run if they
  // already joined gyms (those are the priority surface) OR if they
  // deny location. ~50km bbox = roughly "your metro."
  useEffect(() => {
    if (loading || gyms.length > 0) { setNearby([]); return; }
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        // ~0.5° lat × 0.5° lng ≈ 55 km × (40-55 km depending on
        // latitude). Wider than the user's neighborhood, narrow
        // enough to feel local.
        const rows = await getGymsInBbox({
          minLat: lat - 0.5, maxLat: lat + 0.5,
          minLng: lng - 0.5, maxLng: lng + 0.5,
          limit: 6,
        });
        if (!cancelled) setNearby(rows);
      },
      () => { /* permission denied — rail stays hidden */ },
      { timeout: 5_000, maximumAge: 600_000 },
    );
    return () => { cancelled = true; };
  }, [loading, gyms.length]);

  const handleJoin = (e) => {
    e?.preventDefault?.();
    joinWithCode(codeInput);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto p-4 pb-24"
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">My Gyms</h1>
          <p className="text-sm text-muted-foreground">Every Flexyn gym you've joined.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/gym-map')}
          className="gap-1.5"
        >
          <MapPin className="w-3.5 h-3.5" /> Browse map
        </Button>
      </div>

      {/* Code entry */}
      <form onSubmit={handleJoin} className="rounded-2xl border border-border bg-card p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <QrCode className="w-4 h-4 text-primary" />
          <p className="text-sm font-semibold">Join by code</p>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Scan the QR code or type the 8-character Flexyn Code printed inside the gym.
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setScannerOpen(true)}
            className="shrink-0"
            aria-label="Scan QR code"
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
            placeholder="ABCD2345"
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

      {/* Joined gym list */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : gyms.length === 0 ? (
        <>
          <EmptyState
            icon={Building2}
            title="No gyms joined yet"
            body="Scan the QR code or type the Flexyn Code at your gym to join its community, or browse the map to find one near you."
            action={{ label: 'Browse map', onClick: () => navigate('/gym-map') }}
          />
          {nearby.length > 0 && (
            <div className="mt-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                Near you
              </p>
              <div className="space-y-2">
                {nearby.map(g => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => navigate(`/gym/${g.id}`)}
                    className="w-full text-start rounded-2xl border border-border bg-card p-3 hover:border-primary/30 transition-colors flex items-center gap-3"
                  >
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-heading font-bold text-sm truncate">{g.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {[g.city, g.state_code].filter(Boolean).join(', ')} · {g.member_count ?? 0} members
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2">
          {gyms.map(g => (
            <motion.button
              key={g.id}
              type="button"
              onClick={() => navigate(`/gym/${g.id}`)}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.99 }}
              className="w-full text-start rounded-2xl border border-border bg-card p-4 hover:border-primary/30 hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  {g.logo_url
                    ? <img loading="lazy" src={g.logo_url} alt="" className="w-full h-full rounded-xl object-cover" />
                    : <Building2 className="w-5 h-5 text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-heading font-bold text-base truncate">{g.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[g.city, g.state_code].filter(Boolean).join(', ') || '—'}
                  </p>
                </div>
                <div className="text-end">
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="w-3 h-3" />
                    <span className="tabular-nums">{g.member_count ?? 0}</span>
                  </p>
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      )}

      {/* Owner CTA — discoverable from every user's My Gyms page so
          business owners can self-serve the verification flow without
          a separate signup path. The MyGyms route is the canonical
          entry to the whole gym ecosystem; this keeps everything one
          tap away. */}
      <button
        type="button"
        onClick={() => navigate('/register-gym')}
        className="mt-6 w-full rounded-2xl border border-dashed border-border bg-card hover:bg-secondary/30 transition-colors p-4 text-start"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-violet-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-heading font-bold text-sm">Own a gym?</p>
            <p className="text-xs text-muted-foreground">
              Register your location so members can join + show up on the national map.
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
        </div>
      </button>
    </motion.div>
  );
}
