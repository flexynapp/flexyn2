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
import { useLanguage } from '@/lib/LanguageContext';
import { isGuestAccount } from '@/lib/guestIdentity';
import ConnectAccountSheet from '@/components/auth/ConnectAccountSheet';

// An Exercise invite minted before the lockdown migration is played as an
// Open duel when claimed, so it is described as one.
const DUEL_TYPE_LABEL = {
  open:     ['duelInviteLanding.type.open', 'Open duel. Most total volume wins.'],
  mirror:   ['duelInviteLanding.type.mirror', 'Mirror duel. Same workout, best completion wins.'],
};

export default function DuelInviteLanding() {
  const { tFallback } = useLanguage();
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
  const [connectOpen, setConnectOpen] = useState(false);

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
    // Guests do not compete (same rule as Rival). Ask them to connect first;
    // linking keeps the same account, so the stashed token still works.
    if (isGuestAccount(user)) { setConnectOpen(true); return; }
    setAccepting(true);
    try {
      const result = await claimInvite(token);
      clearPendingToken();
      if (result?.duel_id) {
        toast.success(tFallback('duelInviteLanding.accepted', 'Duel accepted! Time to lift.'));
        navigate('/duels', { replace: true });
      }
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('guest_account')) {
        setConnectOpen(true);
      } else if (msg.includes('cannot_claim_own_invite')) {
        toast.error(tFallback('duelInviteLanding.ownInvite', 'That is your own invite. Share the link with someone else.'));
      } else if (msg.includes('invite_already_claimed')) {
        toast.error(tFallback('duelInviteLanding.alreadyUsed', 'This invite has already been used.'));
      } else if (msg.includes('invite_expired')) {
        toast.error(tFallback('duelInviteLanding.expired', 'This invite has expired. Ask for a new one.'));
      } else if (msg.includes('invite_not_found')) {
        toast.error(tFallback('duelInviteLanding.notFound', 'Invite not found. The link may be wrong.'));
      } else {
        toast.error(tFallback('duelInviteLanding.acceptFailed', 'Could not accept. Try again.'));
      }
      setAccepting(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildInviteUrl(token));
      toast.success(tFallback("referral.copied", "Link copied"));
    } catch {
      toast.error(tFallback("duelInviteLanding.couldNotCopy", "Could not copy"));
    }
  };

  const handleNativeShare = async () => {
    if (typeof navigator.share !== 'function') return handleCopy();
    try {
      await navigator.share({
        title: tFallback('createInviteLinkModal.shareTitle', 'Flexyn duel'),
        text: tFallback('duelInviteLanding.shareText', 'Accept my duel on Flexyn:'),
        url: buildInviteUrl(token),
      });
    } catch { /* user cancelled */ }
  };

  // ── Render states ──────────────────────────────────────────────────────

  if (loading || isLoadingAuth) {
    return (
      <Shell>
        <Loader2 className="w-8 h-8 animate-spin text-primary" aria-label={tFallback("duelInviteLanding.loading", "Loading")} />
      </Shell>
    );
  }

  if (!invite) {
    return (
      <Shell>
        <AlertTriangle className="w-10 h-10 text-amber-500" />
        <h1 className="font-heading font-bold text-2xl">{tFallback("duelInviteLanding.inviteNotFound", "Invite not found")}</h1>
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
        <h1 className="font-heading font-bold text-2xl">{tFallback("duelInviteLanding.inviteExpired", "Invite expired")}</h1>
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
        <h1 className="font-heading font-bold text-2xl">{tFallback("duelInviteLanding.alreadyAccepted", "Already accepted")}</h1>
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
        {tFallback(...(DUEL_TYPE_LABEL[invite.duel_type] || DUEL_TYPE_LABEL.open))}
      </p>
      <p className="text-xs text-muted-foreground/80">
        {tFallback('duelInviteLanding.windowAfterAccept', '{n}h window after accept', { n: invite.window_hours })}
      </p>

      {/* Action area — depends on who's looking */}
      <div className="w-full max-w-xs mt-4">
        {isOwnInvite ? (
          <div className="space-y-2">
            <p className="text-xs text-center text-muted-foreground">
              {tFallback('duelInviteLanding.ownInviteShare', 'This is your own invite. Share it with someone.')}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-secondary text-sm font-bold border border-border hover:bg-secondary/80 active:bg-secondary/80 transition-colors"
              >
                <Copy className="w-4 h-4" /> {tFallback("common.copy", "Copy")}
              </button>
              <button
                onClick={handleNativeShare}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 active:bg-primary/90 transition-colors"
              >
                <Share2 className="w-4 h-4" /> {tFallback("common.share", "Share")}
              </button>
            </div>
          </div>
        ) : user ? (
          <button
            onClick={handleAccept}
            disabled={accepting}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-rose-500 text-white text-base font-bold hover:bg-rose-600 active:bg-rose-600 disabled:opacity-50 transition-colors shadow-md"
          >
            {accepting
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <Swords className="w-5 h-5" />}
            {tFallback('duelInviteLanding.acceptTheDuel', 'Accept the duel')}
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
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-rose-500 text-white text-base font-bold hover:bg-rose-600 active:bg-rose-600 transition-colors shadow-md"
            >
              <Swords className="w-5 h-5" />
              {tFallback("duelInviteLanding.signUpToAccept", "Sign up to accept")}
            </button>
            <p className="text-micro text-center text-muted-foreground">
              {tFallback('duelInviteLanding.signUpHint', "Free. Takes about 30 seconds. We'll bring you back here.")}
            </p>
          </div>
        )}
      </div>
      <ConnectAccountSheet
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        reason={tFallback('duels.error.guest', 'Connect an account to duel. Guest accounts cannot compete.')}
        returnPath={`/duel-invite/${token}`}
      />
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
  const { tFallback } = useLanguage();
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
        <span className="text-micro font-semibold tracking-[0.2em] uppercase text-rose-500">
          {tFallback("duelInviteLanding.duelChallenge", "Duel challenge")}
        </span>
        <h1 className="font-heading font-bold text-2xl mt-1">
          {invite.challenger_username || tFallback('duelInviteLanding.someone', 'Someone')}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{tFallback('duelInviteLanding.wantsToChallenge', 'wants to challenge you')}</p>
      </div>
    </div>
  );
}
