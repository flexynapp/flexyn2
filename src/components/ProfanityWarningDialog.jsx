// src/components/ProfanityWarningDialog.jsx
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

export default function ProfanityWarningDialog({ open, onContinue }) {
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          {/* Card */}
          <motion.div
            className="relative bg-card border border-border rounded-2xl shadow-2xl p-6 max-w-sm w-full text-center z-10"
            initial={{ opacity: 0, scale: 0.88, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.88, y: 16 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          >
            <div className="text-4xl mb-3">🧼</div>
            <h2 className="font-heading font-bold text-xl mb-2 text-foreground">
              Watch your language :)
            </h2>
            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
              That word isn't allowed here. Tap Continue and we'll clear it for you.
            </p>
            <Button className="w-full" onClick={onContinue}>
              Continue
            </Button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}