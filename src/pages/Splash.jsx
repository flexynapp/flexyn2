import { useEffect } from 'react';
import { LOGO_URL } from '@/lib/constants';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { markReturningUser } from '@/lib/firstLaunch';

export default function Splash() {
  const navigate = useNavigate();

  useEffect(() => {
    const check = async () => {
      const isAuthed = await base44.auth.isAuthenticated();

      // A JWT access token is required for write operations (updateMe, entities).
      // Cookie-based sessions allow reads but not writes, which causes onboarding
      // to silently fail on external deployments (e.g. Netlify). If the user is
      // "authenticated" via cookie only, trigger the proper OAuth flow so they
      // receive a write-capable JWT token. Base44 auto-approves returning users
      // instantly, so this is seamless for anyone already logged in.
      const hasToken = !!(
        localStorage.getItem('base44_access_token') ||
        localStorage.getItem('token')
      );

      if (!isAuthed) {
        // Brand-new visitor — show welcome / sign-up flow.
        navigate('/onboarding', { replace: true });
        return;
      }

      if (!hasToken) {
        // Cookie session present but no JWT — force OAuth to get a write token.
        // Base44 redirects back to '/' with ?access_token=... in the URL.
        base44.auth.redirectToLogin('/');
        return;
      }

      const user = await base44.auth.me().catch(() => null);
      if (!user || (!user.onboarding_complete && !user.username)) {
        // Authenticated with a token but onboarding not done yet.
        navigate('/onboarding?step=demographics', { replace: true });
      } else {
        markReturningUser();
        navigate('/dashboard', { replace: true, state: { fromSplash: true } });
      }
    };
    check();
  }, [navigate]);

  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="flex flex-col items-center gap-3"
      >
        <div className="w-20 h-20 rounded-2xl overflow-hidden shadow-2xl">
          <img src="{LOGO_URL}" alt="Flexyn" className="w-full h-full object-contain" />
        </div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="text-center"
        >
          <p className="font-heading text-3xl font-bold tracking-tight">Flexyn</p>
          <p className="text-sm text-muted-foreground mt-1">Your personal fitness companion</p>
        </motion.div>
      </motion.div>
    </div>
  );
}
