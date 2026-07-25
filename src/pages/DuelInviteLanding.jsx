// src/pages/DuelInviteLanding.jsx
//
// Public landing page for an external duel invite URL like
// /duel-invite/<token>. Handles three audiences in one component:
//
//   1. Anonymous visitor (not logged in) — sees a polished pitch
//      with the challenger's name + avatar + duel type, plus a
//      "Sign up to accept" CTA. Stashes the token in localStorage
//      so the App can resume the landing flow after onboarding.
//
//   2. Authenticated user who is NOT the challenger — sees an
//      "Accept the challenge" button that calls claim_pending_duel_invite
//      and routes them to /duels.
//
//   3. Authenticated user who IS the challenger — sees a "this is
//      your own invite" notice with a copy-link affordance instead
//      of an accept button (you can't claim your own invite).
//
// The page is registered in App.jsx OUTSIDE the auth gate so case (1)
// can reach it without being bounced to the sign-in screen first.

import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, Swords, AlertTriangle, Trophy, Copy, Share2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { db } from '@/api/db';
import {
  getInvitePublic,
  claimInvite,
  buildInviteUrl,
  stashPendingToken,
  clearPendingToken,
} from '@/lib/data/duelInvites';

const DUEL_TYPE_LABEL = {
  open:     'Open duel — most total volume wins',
  mirror:   'Mirror duel — same workout, who completes it best',
  exercise: 'Exercise duel — head-to-head on one lift',
};

export default function DuelInviteLanding() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, isLoadingAuth } = useAuth();
  // Pull the canonical user profile so we can compare usernames the
  // server actually has, not whatever the auth user object provides.
  // The previous check read `user.username` (Supabase auth user has
  // no such field) so `isOwnInvite` was always false, and a challenger
  // opening their own invite saw the Accept button + a server error.
  // (Audit 15 #M14.)
  const { data: myProfile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
  });

  const [invite, setInvite]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  // ── Fetch the invite via the anon-safe RPC ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!token) { setLoading(false); return; }
    getInvitePublic(token)
      .then(data => { if (!cancelled) { setInvite(data); setLoading(false); } })
      .catch(() => { if (!cancelled) { setInvite(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [token]);

  // ── Stash the token for the post-signup resume ─────────────────────────
  // If the visitor isn't logged in yet, save the token so the App's
  // post-auth handler can route them back here once they finish
  // onboarding. Cleared when they successfully claim OR navigate away
  // to avoid sticking around forever.
  useEffect(() => {
    if (!token) return;
    if (isLoadingAuth) return;
    if (!user) {
      stashPendingToken(token);
    }
  }, [token, user, isLoadingAuth]);

  const handleAccept = async () => {
    if (!token || accepting) return;
    setAccepting(true);
    try {
      const result = await claimInvite(token);
      clearPendingToken();
      if (result?.duel_id) {
        toast.success('Duel accepted! Time to lift.');
        navigate('/duels', { replace: true });
      }
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('cannot_claim_own_invite')) {
        toast.error("That's your own invite — share the link with someone else.");
      } else if (msg.includes('invite_already_claimed')) {
        toast.error('This invite has already been used.');
      } else if (msg.includes('invite_expired')) {
        toast.error('This invite has expired. Ask for a new one.');
      } else if (msg.includes('invite_not_found')) {
        toast.error("Invite not found — the link may be wrong.");
      } else {
        toast.error('Could not accept — try again.');
      }
      setAccepting(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildInviteUrl(token));
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  const handleNativeShare = async () => {
    if (typeof navigator.share !== 'function') return handleCopy();
    try {
      await navigator.share({
        title: 'Flexyn duel',
        text: 'Accept my duel on Flexyn:',
        url: buildInviteUrl(token),
      });
    } catch { /* user cancelled */ }
  };

  // ── Render states ──────────────────────────────────────────────────────

  if (loading || isLoadingAuth) {
    return (
      <Shell>
        <Loader2 className="w-8 h-8 animate-spin text-primary" aria-label="Loading" />
      </Shell>
    );
  }

  if (!invite) {
    return (
      <Shell>
        <AlertTriangle className="w-10 h-10 text-amber-500" />
        <h1 className="font-heading font-bold text-2xl">Invite not found</h1>
        <p className="text-sm text-muted-foreground max-w-xs">
          This duel-invite link is invalid or has been deleted. Ask the
          challenger to send a new one.
        </p>
      </Shell>
    );
  }

  if (invite.is_expired) {
    return (
      <Shell>
        <AlertTriangle className="w-10 h-10 text-amber-500" />
        <h1 className="font-heading font-bold text-2xl">Invite expired</h1>
        <p className="text-sm text-muted-foreground max-w-xs">
          This invite has expired. Ask {invite.challenger_username || 'them'} for a new one.
        </p>
      </Shell>
    );
  }

  if (invite.is_claimed) {
    return (
      <Shell>
        <Trophy className="w-10 h-10 text-amber-500" />
        <h1 className="font-heading font-bold text-2xl">Already accepted</h1>
        <p className="text-sm text-muted-foreground max-w-xs">
          Someone already accepted this invite. Ask {invite.challenger_username || 'them'} for a fresh one.
        </p>
      </Shell>
    );
  }

  const isOwnInvite = (
    // Match by id when the invite carries challenger_id (preferred —
    // immune to username changes).
    (invite.challenger_id && user?.id && invite.challenger_id === user.id) ||
    // Fallback: case-insensitive username from the canonical profile.
    (myProfile?.username && invite.challenger_username &&
      myProfile.username.toLowerCase() === invite.challenger_username.toLowerCase())
  );

  return (
    <Shell>
      <ChallengerHeader invite={invite} />

      <p className="text-sm text-muted-foreground max-w-xs text-center">
        {DUEL_TYPE_LABEL[invite.duel_type] || 'A duel — most stats wins'}
      </p>
      <p className="text-xs text-muted-foreground/80">
        {invite.window_hours}h window after accept
      </p>

      {/* Action area — depends on who's looking */}
      <div className="w-full max-w-xs mt-4">
        {isOwnInvite ? (
          <div className="space-y-2">
            <p className="text-xs text-center text-muted-foreground">
              This is your own invite — share it with someone:
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-secondary text-sm font-bold border border-border hover:bg-secondary/80 transition-colors"
              >
                <Copy className="w-4 h-4" /> Copy
              </button>
              <button
                onClick={handleNativeShare}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors"
              >
                <Share2 className="w-4 h-4" /> Share
              </button>
            </div>
          </div>
        ) : user ? (
          <button
            onClick={handleAccept}
            disabled={accepting}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-rose-500 text-white text-base font-bold hover:bg-rose-600 disabled:opacity-50 transition-colors shadow-lg shadow-rose-500/30"
          >
            {accepting
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <Swords className="w-5 h-5" />}
            {accepting ? 'Accepting…' : 'Accept the duel'}
          </button>
        ) : (
          <div className="space-y-3">
            <button
              onClick={() => {
                // The token is already stashed by the effect above. Routing
                // to "/" enters the App's auth flow → SignIn → Onboarding.
                // The App's post-auth handler reads PENDING_INVITE_LS_KEY
                // and bounces back here once the user has an account.
                navigate('/');
              }}
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-rose-500 text-white text-base font-bold hover:bg-rose-600 transition-colors shadow-lg shadow-rose-500/30"
            >
              <Swords className="w-5 h-5" />
              Sign up to accept
            </button>
            <p className="text-[11px] text-center text-muted-foreground">
              Free. Takes ~30 seconds. We'll bring you back here.
            </p>
          </div>
        )}
      </div>
    </Shell>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function Shell({ children }) {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-6 bg-background">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md rounded-3xl bg-card border border-border shadow-xl p-8 flex flex-col items-center gap-4"
      >
        {children}
      </motion.div>
    </div>
  );
}

function ChallengerHeader({ invite }) {
  const initials = (invite.challenger_username || '?').slice(0, 2).toUpperCase();
  return (
    <div className="flex flex-col items-center gap-3">
      {/* Avatar */}
      <div className="relative">
        <div className="w-20 h-20 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center font-heading font-bold text-primary text-2xl">
          {invite.challenger_avatar_url ? (
            <img loading="lazy" src={invite.challenger_avatar_url}
              alt=""
              width="80"
              height="80"
              className="w-full h-full object-cover"
            />
          ) : initials}
        </div>
        <div className="absolute -bottom-1 -end-1 w-8 h-8 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-md ring-2 ring-background">
          <Swords className="w-4 h-4" />
        </div>
      </div>

      <div className="text-center">
        <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-rose-500">
          Duel challenge
        </span>
        <h1 className="font-heading font-bold text-2xl mt-1">
          {invite.challenger_username || 'Someone'}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">wants to challenge you</p>
      </div>
    </div>
  );
}
