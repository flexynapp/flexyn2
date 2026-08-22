// src/pages/CheckInPage.jsx
// Landing for the gym signage QR (/checkin/<CODE>). Auto-checks the
// signed-in user into the gym, unlocking a 1.2x XP multiplier on today's
// workouts. Standalone full-screen page (outside the app shell) so a
// fresh camera-scan lands somewhere clean.
import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, AlertTriangle, Dumbbell, Zap } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { db } from '@/api/db';
import { checkInWithCode, GYM_CHECKIN_XP_MULTIPLIER } from '@/lib/data/gymCheckins';
import { getGymByCode } from '@/lib/data/gymBusinesses';
import { publicGymUrl } from '@/lib/appOrigin';
import { useLanguage } from '@/lib/LanguageContext';

export default function CheckInPage() {
  const { tFallback } = useLanguage();
  const { code } = useParams();
  const navigate = useNavigate();
  const { user, isLoadingAuth } = useAuth();
  const [status, setStatus] = useState('pending'); // pending | ok | already | error | unauth
  const [gymName, setGymName] = useState('');
  const ran = useRef(null);

  // Re-run when `code` changes (SPA nav between two checkin URLs)
  // while still guarding against the same code being re-checked-in
  // within the same mount. The previous boolean ran-ref was sticky
  // forever after the first code, so a second scan never registered.
  useEffect(() => {
    if (isLoadingAuth) return;
    // Signed out — almost always someone who does not have Flexyn scanning
    // the poster on the wall in front of them. Checking in is meaningless
    // without an account, and so is most of what the app could show them,
    // so send them to that gym's public page: the marketing site once
    // VITE_MARKETING_ORIGIN is set (App Store / Play links live there), and
    // this app's own /p/gym until then. See publicGymUrl.
    //
    // The bare sign-in prompt below is only the fallback for a code that
    // resolves to nothing.
    if (!user) {
      if (ran.current === code) return;
      ran.current = code;
      (async () => {
        const gym = await getGymByCode(code);
        if (gym?.id && typeof window !== 'undefined') {
          window.location.replace(publicGymUrl(gym.id));
          return;
        }
        setStatus('unauth');
      })();
      return;
    }
    if (ran.current === code) return;
    ran.current = code;
    setStatus('pending');
    setGymName('');
    (async () => {
      try {
        const res = await checkInWithCode(code);
        if (!res?.ok) { setStatus('error'); return; }
        setGymName(res.gym_name || '');
        // The QR's destination is the gym's own page. Checking in is what
        // the scan DOES; it isn't somewhere to be left standing. The result
        // rides along in ?checkin= so GymHub can still announce the 1.2x
        // day and offer "Start your workout".
        //
        // A hard replace, not navigate(): App.jsx picks this route tree off
        // window.location.pathname without subscribing to it, so a
        // client-side push would change the URL and leave this page mounted
        // underneath it. `replace` also keeps /checkin/<CODE> out of history
        // — a back tap should not re-run a check-in.
        if (res.gym_id && typeof window !== 'undefined') {
          window.location.replace(`/gym/${res.gym_id}?checkin=${res.already ? 'already' : 'ok'}`);
          return;
        }
        // No gym id came back — stay put rather than navigating nowhere.
        setStatus(res.already ? 'already' : 'ok');
      } catch {
        setStatus('error');
      }
    })();
  }, [user, isLoadingAuth, code]);

  const multiplierLabel = `${GYM_CHECKIN_XP_MULTIPLIER}x`;

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-6 text-center">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', damping: 24, stiffness: 300 }}
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 flex flex-col items-center gap-3"
      >
        {(status === 'pending' || isLoadingAuth) && (
          <>
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <p className="font-heading font-bold text-lg">Checking you in…</p>
          </>
        )}

        {status === 'ok' && (
          <>
            <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 className="w-9 h-9 text-emerald-500" />
            </div>
            <p className="font-heading font-black text-xl">{tFallback("checkInPage.checked", "Checked in!")}</p>
            {gymName && <p className="text-sm text-muted-foreground">{gymName}</p>}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 text-amber-500 text-sm font-bold">
              <Zap className="w-4 h-4" /> {multiplierLabel} XP on today's workouts
            </div>
            <button
              type="button"
              onClick={() => navigate('/workout')}
              className="mt-2 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-bold hover:opacity-90 transition-opacity"
            >
              <Dumbbell className="w-4 h-4" /> {tFallback("checkInPage.startYourWorkout", "Start your workout")}
            </button>
            <button type="button" onClick={() => navigate('/dashboard')} className="text-sm text-muted-foreground hover:text-foreground active:text-foreground">
              {tFallback("header.goToDashboard", "Go to dashboard")}
            </button>
          </>
        )}

        {status === 'already' && (
          <>
            <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 className="w-9 h-9 text-emerald-500" />
            </div>
            <p className="font-heading font-bold text-lg">{tFallback("checkInPage.youReAlreadyChecked", "You're already checked in")}</p>
            {gymName && <p className="text-sm text-muted-foreground">{gymName}</p>}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 text-amber-500 text-sm font-bold">
              <Zap className="w-4 h-4" /> {multiplierLabel} XP active today
            </div>
            <button type="button" onClick={() => navigate('/workout')} className="mt-2 w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold hover:opacity-90 transition-opacity">
              {tFallback("checkInPage.startYourWorkout", "Start your workout")}
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-16 h-16 rounded-full bg-rose-500/15 flex items-center justify-center">
              <AlertTriangle className="w-9 h-9 text-rose-500" />
            </div>
            <p className="font-heading font-bold text-lg">{tFallback("checkInPage.couldnTCheck", "Couldn't check in")}</p>
            <p className="text-sm text-muted-foreground">{tFallback('checkIn.codeNotFound', "That code didn't match an active gym. Double-check the signage code.")}</p>
            <button type="button" onClick={() => navigate('/dashboard')} className="mt-2 w-full py-3 rounded-xl bg-secondary font-semibold hover:bg-secondary/70 active:bg-secondary/70 transition-colors">
              {tFallback("header.goToDashboard", "Go to dashboard")}
            </button>
          </>
        )}

        {status === 'unauth' && (
          <>
            <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center">
              <Dumbbell className="w-9 h-9 text-primary" />
            </div>
            <p className="font-heading font-bold text-lg">{tFallback("checkInPage.signInToCheck", "Sign in to check in")}</p>
            <p className="text-sm text-muted-foreground">Log in to Flexyn, then scan again to claim your {multiplierLabel} XP.</p>
            <button type="button" onClick={() => db.auth.redirectToLogin()} className="mt-2 w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold hover:opacity-90 transition-opacity">
              {tFallback("profile.signIn", "Sign in")}
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
}
