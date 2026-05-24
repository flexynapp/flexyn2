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
// Data:
//   • gym_businesses: anon SELECT allowed by migration 142 policy.
//   • gym_members: anon SELECT allowed by migration 142 policy.
//     We read count(*) only — no PII exposed.

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Building2, MapPin, Users, Loader2,
  ChevronRight, CheckCircle2, Dumbbell,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';

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
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isLoadingAuth } = useAuth();

  const [gym, setGym] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const isAuthed = !isLoadingAuth && !!user;

  useEffect(() => {
    if (!id) { setNotFound(true); return; }
    supabase
      .from('gym_businesses')
      .select('id, name, logo_url, cover_url, city, state_code, member_count, amenities, photo_urls, is_active')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data || !data.is_active) { setNotFound(true); return; }
        setGym(data);
      });
  }, [id]);

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
          <p className="font-heading font-bold text-lg">Gym not found</p>
          <p className="text-sm text-muted-foreground mt-1">
            This gym may not be on Flexyn yet.
          </p>
        </div>
        <Button onClick={() => window.location.href = '/'} variant="outline">
          Discover Flexyn
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
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-heading font-bold text-sm truncate max-w-[200px]">{gym.name}</span>
        <div className="w-8" />
      </div>

      {/* ── Cover photo ───────────────────────────────────────────── */}
      <div className="relative h-48 bg-gradient-to-br from-primary/20 to-primary/5 overflow-hidden">
        {gym.cover_url ? (
          <img src={gym.cover_url} alt={gym.name} className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center opacity-20">
            <Dumbbell className="w-24 h-24 text-primary" />
          </div>
        )}
        {/* Logo overlay */}
        {gym.logo_url && (
          <div className="absolute bottom-0 left-4 translate-y-1/2">
            <div className="w-16 h-16 rounded-2xl border-4 border-background shadow-lg overflow-hidden bg-card">
              <img src={gym.logo_url} alt="" className="w-full h-full object-cover" />
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
          <span className="text-muted-foreground font-normal">Flexyn members</span>
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
            Amenities
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
            Gallery
          </p>
          <div className={`grid gap-2 ${photos.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {photos.map((url, i) => (
              <div key={i} className="aspect-video rounded-xl overflow-hidden bg-muted">
                <img src={url} alt="" className="w-full h-full object-cover" />
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
            Enter Hub <ChevronRight className="w-4 h-4 ml-1" />
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
                Sign in
              </button>
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}
