import { motion } from 'framer-motion';
import { LOGO_URL } from '@/lib/constants';
import { LogIn, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { db } from '@/api/db';

export default function SignInToContinue() {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-between p-6 pb-10">
      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="pt-10 flex flex-col items-center gap-2"
      >
        <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-lg shadow-primary/30">
          <img
            src={LOGO_URL}
            alt="Flexyn"
            className="w-full h-full object-contain"
          />
        </div>
        <p className="font-heading text-2xl font-bold tracking-tight">Flexyn</p>
      </motion.div>

      {/* Center content */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15, ease: 'easeOut' }}
        className="flex flex-col items-center text-center px-4"
      >
        <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-6">
          <LogIn className="w-10 h-10 text-primary" />
        </div>
        <h2 className="font-heading text-2xl font-bold tracking-tight mb-3">Sign in to continue</h2>
        <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
          It looks like you've been signed out. Sign back in to pick up right where you left off and recover all your data.
        </p>
      </motion.div>

      {/* Bottom CTA */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3, ease: 'easeOut' }}
        className="w-full max-w-sm"
      >
        <Button
          className="w-full h-12 font-heading font-bold text-base"
          onClick={() => db.auth.redirectToLogin('/')}
        >
          Sign in <ArrowRight className="w-5 h-5 ml-1" />
        </Button>
      </motion.div>
    </div>
  );
}