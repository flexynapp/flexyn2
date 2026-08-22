// src/pages/PublicGymLanding.jsx
//
// Unauthenticated-friendly gym landing page.
//
// Route: /p/gym/:id  (bypasses the auth gate in App.jsx)
//
// This is the shareable gym URL surface — gym owners paste it in their
// bio, Instagram, etc. Unauthenticated visitors see the gym's key info
// and are prompted to join Flexyn. Authenticated users get a prominent
// "Enter Hub" button that takes them to the full /gym/:id experience.
//
// Data: get_gym_public_card(id) — one anon-callable RPC (mig 325).
//
// It used to SELECT gym_businesses directly, under a blanket anon policy
// that also handed out every gym's join code, street address, phone and
// coordinates to anyone with the anon key. That policy is gone; the card
// is the subset a signed-out visitor has a use for. Nothing else on this
// page reads the database.

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Building2, MapPin, Users, Loader2,
  ChevronRight, CheckCircle2, Dumbbell, WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { getGymPublicCard } from '@/lib/data/gymBusinesses';
import { useLanguage } from '@/lib/LanguageContext';

// Amenity slug → display label
const AMENITY_LABELS = {
  parking:           'Parking',
  showers:           'Showers',
  sauna:             'Sauna',
  lockers:           'Lockers',
  cardio_zone:       'Cardio zone',
  free_weights:      'Free weights',
  classes:           'Group classes',
  personal_training: 'Personal training',
  pool:              'Pool',
  basketball:        'Basketball',
  boxing:            'Boxing',
  yoga:              'Yoga',
  childcare:         'Childcare',
  cafe:              'Café',
};

export default function PublicGymLanding() {
  const { tFallback } = useLanguage();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isLoadingAuth } = useAuth();

  const [gym, setGym] = useState(null);
  const [notFound, setNotFound] = useState(false);
  // Distinct from notFound on purpose. "This gym isn't on Flexyn" is a claim
  // about the world, and we may only make it when the lookup actually
  // succeeded — same rule the gym picker follows for Overpass failures.
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const isAuthed = !isLoadingAuth && !!user;

  useEffect(() => {
    if (!id) { setNotFound(true); return; }
    let cancelled = false;
    setLoadFailed(false);
    // Through get_gym_public_card (mig 325), not the table. The blanket
    // anon SELECT this used to rely on handed out every gym's join code,
    // street address, phone and coordinates to anyone with the anon key —
    // which is in the bundle. The card is the subset a signed-out visitor
    // has any use for, and inactive gyms return no row at all, so the
    // is_active check that used to live here now lives in the function.
    getGymPublicCard(id)
      .then((data) => {
        if (cancelled) return;
        // A thrown error is a failed lookup, not an absent gym. Only a
        // clean response with no row means "not found".
        if (!data) { setNotFound(true); return; }
        setGym(data);
      })
      // THE FIX. There was no catch here, so a network failure rejected the
      // promise, the .then never ran, and both flags stayed false — leaving
      // the component wedged in its loading branch forever. That is what an
      // audit measured as "a completely blank page, 8 DOM nodes, zero
      // characters": it was the spinner, spinning indefinitely. The other
      // three public routes all degraded gracefully under the identical
      // induced failure because they handle this path.
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [id, retryNonce]);

  // ── Couldn't load ──────────────────────────────────────────────────
  if (loadFailed) {
    return (
      <div className="fixed inset-0 bg-background flex flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
          <WifiOff className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
        </div>
        <div>
          <p className="font-heading font-bold text-lg">{tFallback('publicGym.loadFailed', "Couldn't load this gym")}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {tFallback('notifications.error.desc', 'Check your connection and try again.')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setRetryNonce(n => n + 1)}>{tFallback("errorBoundary.tryAgain", "Try again")}</Button>
          <Button onClick={() => { window.location.href = '/'; }} variant="outline">
            {tFallback("publicGymLanding.discoverFlexyn", "Discover Flexyn")}
          </Button>
        </div>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────
  if (gym === null && !notFound) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Not found ──────────────────────────────────────────────────────
  if (notFound) {
    return (
      <div className="fixed inset-0 bg-background flex flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
          <Building2 className="w-8 h-8 text-muted-foreground" />
        </div>
        <div>
          <p className="font-heading font-bold text-lg">{tFallback("gymEdit.gymNotFound", "Gym not found")}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {tFallback('publicGym.maybeNotOnFlexyn', 'This gym may not be on Flexyn yet.')}
          </p>
        </div>
        <Button onClick={() => window.location.href = '/'} variant="outline">
          {tFallback("publicGymLanding.discoverFlexyn", "Discover Flexyn")}
        </Button>
      </div>
    );
  }

  const amenities = Array.isArray(gym.amenities) ? gym.amenities : [];
  const photos = Array.isArray(gym.photo_urls) ? gym.photo_urls.slice(0, 4) : [];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center"
          aria-label={tFallback("achievements.vault.back", "Back")}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-heading font-bold text-sm truncate max-w-[200px]">{gym.name}</span>
        <div className="w-8" />
      </div>

      {/* ── Cover photo ───────────────────────────────────────────── */}
      <div className="relative h-48 bg-gradient-to-br from-primary/20 to-primary/5 overflow-hidden">
        {gym.cover_url ? (
          <img loading="lazy" src={gym.cover_url} alt={gym.name} className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center opacity-20">
            <Dumbbell className="w-24 h-24 text-primary" />
          </div>
        )}
        {/* Logo overlay */}
        {gym.logo_url && (
          <div className="absolute bottom-0 start-4 translate-y-1/2">
            <div className="w-16 h-16 rounded-2xl border-4 border-background shadow-lg overflow-hidden bg-card">
              <img loading="lazy" src={gym.logo_url} alt="" className="w-full h-full object-cover" />
            </div>
          </div>
        )}
      </div>

      {/* ── Name + location ───────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="px-4 pt-10 pb-2"
      >
        <h1 className="font-heading font-bold text-2xl">{gym.name}</h1>
        {(gym.city || gym.state_code) && (
          <p className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            {[gym.city, gym.state_code].filter(Boolean).join(', ')}
          </p>
        )}
        <p className="flex items-center gap-1.5 text-sm font-semibold mt-1.5">
          <Users className="w-3.5 h-3.5 text-primary" />
          <span className="tabular-nums text-primary">{gym.member_count ?? 0}</span>
          <span className="text-muted-foreground font-normal">{tFallback("publicGymLanding.flexynMembers", "Flexyn members")}</span>
        </p>
      </motion.div>

      {/* ── Amenities ─────────────────────────────────────────────── */}
      {amenities.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06 }}
          className="px-4 mt-4"
        >
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            {tFallback("publicGymLanding.amenities", "Amenities")}
          </p>
          <div className="flex flex-wrap gap-2">
            {amenities.slice(0, 10).map(slug => (
              <span
                key={slug}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary text-xs font-medium"
              >
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                {AMENITY_LABELS[slug] || slug}
              </span>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── Gallery ───────────────────────────────────────────────── */}
      {photos.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="px-4 mt-5"
        >
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            {tFallback("publicGymLanding.gallery", "Gallery")}
          </p>
          <div className={`grid gap-2 ${photos.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {photos.map((url, i) => (
              <div key={i} className="aspect-video rounded-xl overflow-hidden bg-muted">
                <img loading="lazy" src={url} alt="" className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── CTA block ─────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="mx-4 mt-6 mb-8 flex flex-col gap-2"
      >
        {isAuthed ? (
          <Button
            onClick={() => navigate(`/gym/${id}`)}
            className="w-full"
            size="lg"
          >
            {tFallback("publicGymLanding.enterHub", "Enter Hub")} <ChevronRight className="w-4 h-4 ms-1" />
          </Button>
        ) : (
          <>
            <div className="rounded-2xl bg-primary/5 border border-primary/20 p-4 text-center mb-1">
              <p className="font-heading font-bold text-base mb-1">
                {gym.member_count > 0
                  ? `Join ${gym.member_count.toLocaleString()} members on Flexyn`
                  : 'This gym is on Flexyn'}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Track workouts, compete on leaderboards, and connect with members at {gym.name}.
                Flexyn is free.
              </p>
            </div>
            <Button
              onClick={() => window.location.href = '/'}
              className="w-full"
              size="lg"
            >
              Join Flexyn — It's Free 🏋
            </Button>
            <p className="text-center text-xs text-muted-foreground mt-1">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => window.location.href = '/'}
                className="text-primary underline"
              >
                {tFallback("profile.signIn", "Sign in")}
              </button>
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}
