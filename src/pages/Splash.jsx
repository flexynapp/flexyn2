import { useEffect } from 'react';
import { LOGO_URL } from '@/lib/constants';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { db } from '@/api/db';
import { markReturningUser } from '@/lib/firstLaunch';

export default function Splash() {
  const navigate = useNavigate();

  useEffect(() => {
    const check = async () => {
      // With Supabase, a valid session means we already have a JWT token.
      // The old Base44 localStorage key check has been removed — it was
      // causing an infinite OAuth redirect loop on every page load.
      const isAuthed = await db.auth.isAuthenticated();

      if (!isAuthed) {
        // Brand-new visitor or signed-out user — go to the welcome screen.
        navigate('/onboarding', { replace: true });
        return;
      }

      // Authenticated — check if onboarding is done.
      const user = await db.auth.me().catch(() => null);
      const onboardingDone =
        user?.onboarding_complete || user?.onboarding_completed || user?.username;

      if (!user || !onboardingDone) {
        navigate('/onboarding', { replace: true });
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
          <img src={LOGO_URL} alt="Flexyn" className="w-full h-full object-contain" />
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
