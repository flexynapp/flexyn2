// NOTE: window.close() only works on tabs that were opened programmatically via window.open().
// Browsers block it on tabs the user opened directly — this is a security restriction.
// The farewell screen below is the real UI; the close attempt is best-effort only.

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/LanguageContext';

export default function AccountDeletedScreen() {
  const { t } = useLanguage();
  const [closeAttempted, setCloseAttempted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      try { window.close(); } catch {}
      setCloseAttempted(true);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col items-center justify-center p-6">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center mb-6"
      >
        <CheckCircle2 className="w-10 h-10 text-emerald-500" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.5, ease: 'easeOut' }}
        className="text-center max-w-sm"
      >
        <h2 className="font-heading text-2xl font-bold tracking-tight mb-3">
          {t('accountDeleted.title')}
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t('accountDeleted.description')}
        </p>

        {closeAttempted && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="mt-8 flex flex-col items-center gap-3"
          >
            <p className="text-sm text-muted-foreground">{t('accountDeleted.canCloseTab')}</p>
            <Button
              variant="outline"
              onClick={() => { try { window.close(); } catch {} }}
            >
              <X className="w-4 h-4 me-2" />
              {t('accountDeleted.closeTabBtn')}
            </Button>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}