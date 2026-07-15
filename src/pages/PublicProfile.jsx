// src/pages/PublicProfile.jsx
//
// Public-facing user profile page — accessible WITHOUT signing in.
//
// Route: /@:username  (bypasses the auth gate in App.jsx)
//
// States handled:
//   • unauthenticated visitor  — full profile content + "Join Flexyn to
//     Compete" CTA in place of private action buttons.
//   • authenticated visitor    — same profile content + social action
//     buttons (Message, View in Hub).
//   • viewing own profile      — "Go to my Hub" button only.
//   • private profile          — shield icon + "This profile is private"
//     message; no stats revealed.
//   • not found                — friendly 404 state.
//
// Data:
//   • Reads via the get_public_profile_by_username RPC (migration 206), a
//     SECURITY DEFINER function that returns just the public display fields
//     for one username. It exposes email ONLY to authenticated callers, so
//     the anon key cannot bulk-harvest emails through the public_profiles
//     view (anon SELECT on that view is revoked in migration 207).

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Shield, Flame, Star, Trophy, Users,
  Dumbbell, MessageCircle, ExternalLink, Loader2,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';

// Tier → accent colour for the league badge
const TIER_COLORS = {
  bronze:   'text-orange-400',
  silver:   'text-slate-400',
  gold:     'text-yellow-400',
  platinum: 'text-cyan-400',
  diamond:  'text-violet-400',
  legend:   'text-rose-400',
};

const TIER_LABELS = {
  bronze: 'Bronze', silver: 'Silver', gold: 'Gold',
  platinum: 'Platinum', diamond: 'Diamond', legend: 'Legend',
};

// Prestige flame colour (prestige_level 0-9)
function PrestigeBadge({ level }) {
  if (!level || level < 1) return null;
  const colors = ['text-orange-400','text-yellow-400','text-lime-400',
                  'text-cyan-400','text-violet-400','text-rose-400',
                  'text-pink-400','text-fuchsia-400','text-indigo-400','text-amber-300'];
  return (
    <span className={`text-xs font-bold ${colors[(level - 1) % colors.length]} flex items-center gap-0.5`}>
      <Flame className="w-3 h-3" />P{level}
    </span>
  );
}

// Mini stat pill used in the stats row
function StatPill({ icon: Icon, value, label, className = '' }) {
  return (
    <div className={`flex flex-col items-center gap-0.5 ${className}`}>
      <div className="flex items-center gap-1">
        <Icon className="w-3.5 h-3.5 text-primary" />
        <span className="font-heading font-bold text-sm tabular-nums">{value ?? 0}</span>
      </div>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
    </div>
  );
}

export default function PublicProfile() {
  const { username } = useParams();
  const navigate = useNavigate();
  const { user, isLoadingAuth } = useAuth();

  const [profile, setProfile] = useState(null);   // null = loading
  const [notFound, setNotFound] = useState(false);

  const cleanUsername = (username || '').replace(/^@/, '');

  // Fetch profile by username via the anon-safe RPC (returns only public
  // display fields; email is included for authenticated callers only).
  useEffect(() => {
    if (!cleanUsername) { setNotFound(true); return; }
    supabase
      .rpc('get_public_profile_by_username', { p_username: cleanUsername })
      .then(({ data, error }) => {
        if (error || !data) { setNotFound(true); return; }
        setProfile(data);
      });
  }, [cleanUsername]);

  // Derived auth state
  const isOwnProfile  = !isLoadingAuth && user && profile && user.id === profile.id;
  const isAuthed      = !isLoadingAuth && !!user;

  // ── Loading state ──────────────────────────────────────────────────
  if (profile === null && !notFound) {
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
          <Users className="w-8 h-8 text-muted-foreground" />
        </div>
        <div>
          <p className="font-heading font-bold text-lg">Profile not found</p>
          <p className="text-sm text-muted-foreground mt-1">
            @{cleanUsername} doesn't exist on Flexyn yet.
          </p>
        </div>
        <Button onClick={() => window.location.href = 'https://flexyn.app'} variant="outline">
          Discover Flexyn
        </Button>
      </div>
    );
  }

  const isPrivate = profile.is_private && !isOwnProfile && !isAuthed;

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
        <span className="font-heading font-bold text-sm">@{profile.username}</span>
        <div className="w-8" />
      </div>

      {/* ── Hero card ─────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="px-4 pt-6 pb-4 flex flex-col items-center text-center gap-3"
      >
        {/* Avatar */}
        <div className="relative">
          {profile.avatar_url ? (
            <img loading="lazy" src={profile.avatar_url}
              alt={profile.username}
              className="w-24 h-24 rounded-full object-cover border-4 border-background shadow-xl"
            />
          ) : (
            <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center border-4 border-background shadow-xl">
              <span className="text-3xl font-bold text-primary">
                {(profile.full_name || profile.username || '?')[0].toUpperCase()}
              </span>
            </div>
          )}
          {/* Level badge */}
          <div className="absolute -bottom-1 -end-1 w-7 h-7 rounded-full bg-primary flex items-center justify-center border-2 border-background">
            <span className="text-[10px] font-bold text-primary-foreground">
              {profile.current_level ?? 1}
            </span>
          </div>
        </div>

        {/* Name + username */}
        <div>
          <div className="flex items-center justify-center gap-2">
            <h1 className="font-heading font-bold text-xl">
              {profile.full_name || profile.username}
            </h1>
            <PrestigeBadge level={profile.prestige_level} />
          </div>
          {profile.full_name && (
            <p className="text-sm text-muted-foreground">@{profile.username}</p>
          )}
          {profile.league_tier && (
            <p className={`text-xs font-semibold mt-0.5 ${TIER_COLORS[profile.league_tier] || 'text-muted-foreground'}`}>
              {TIER_LABELS[profile.league_tier] || profile.league_tier} League
            </p>
          )}
        </div>

        {/* Bio */}
        {profile.bio && !isPrivate && (
          <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
            {profile.bio}
          </p>
        )}
      </motion.div>

      {/* ── Private gate ──────────────────────────────────────────── */}
      {isPrivate ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center"
        >
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
            <Shield className="w-7 h-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-heading font-bold">This profile is private</p>
            <p className="text-sm text-muted-foreground mt-1">
              Sign in and follow @{profile.username} to see their stats and workouts.
            </p>
          </div>
          <Button onClick={() => window.location.href = '/'} className="w-full max-w-xs">
            Join Flexyn to Follow
          </Button>
        </motion.div>
      ) : (
        <>
          {/* ── Stats row ─────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="mx-4 rounded-2xl bg-card border border-border p-4"
          >
            <div className="grid grid-cols-4 gap-2 divide-x divide-border">
              <StatPill icon={Star}     value={profile.current_level ?? 1}                     label="Level"        />
              <StatPill icon={Flame}    value={profile.workout_streak ?? 0}                    label="Streak"       className="ps-2" />
              <StatPill icon={Trophy}   value={profile.achievements_unlocked_count ?? 0}       label="Badges"       className="ps-2" />
              <StatPill icon={Dumbbell} value={profile.longest_workout_streak ?? 0}            label="Best streak"  className="ps-2" />
            </div>
          </motion.div>

          {/* ── Streak callout ────────────────────────────────────── */}
          {(profile.workout_streak ?? 0) > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14 }}
              className="mx-4 mt-3 rounded-xl bg-orange-500/10 border border-orange-500/20 px-4 py-3 flex items-center gap-3"
            >
              <Flame className="w-5 h-5 text-orange-400 shrink-0" />
              <p className="text-sm font-semibold">
                <span className="text-orange-400 tabular-nums">{profile.workout_streak}</span>-day workout streak 🔥
              </p>
            </motion.div>
          )}

          {/* ── CTA block ─────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mx-4 mt-4 flex flex-col gap-2"
          >
            {isOwnProfile ? (
              // Viewing own profile
              <Button
                onClick={() => navigate('/hub')}
                className="w-full"
              >
                Go to my Hub <ChevronRight className="w-4 h-4 ms-1" />
              </Button>
            ) : isAuthed ? (
              // Authenticated visitor viewing someone else
              <>
                <Button
                  onClick={() => navigate(`/hub?profile=${encodeURIComponent(profile.id || profile.username)}`)}
                  className="w-full"
                >
                  <ExternalLink className="w-4 h-4 me-2" />
                  View full profile
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate('/messages')}
                  className="w-full"
                >
                  <MessageCircle className="w-4 h-4 me-2" />
                  Send message
                </Button>
              </>
            ) : (
              // Unauthenticated visitor
              <>
                <div className="rounded-2xl bg-primary/5 border border-primary/20 p-4 text-center mb-1">
                  <p className="font-heading font-bold text-base mb-1">
                    Compete with @{profile.username}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Log workouts, build streaks, earn XP, and battle for the top of the leaderboard.
                    Flexyn is free to join.
                  </p>
                </div>
                <Button
                  onClick={() => window.location.href = '/'}
                  className="w-full"
                  size="lg"
                >
                  Join Flexyn to Compete 🏆
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

          {/* ── Footer spacer ─────────────────────────────────────── */}
          <div className="h-10" />
        </>
      )}
    </div>
  );
}
