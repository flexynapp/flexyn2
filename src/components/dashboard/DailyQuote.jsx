import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Quote, Star } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { getDailyQuote } from '@/lib/dailyQuotes';
import { listMyQuotes } from '@/lib/data/customQuotes';
import CustomQuotesModal from './CustomQuotesModal';

// Milliseconds until the next local-midnight rollover.
function msUntilLocalMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}

export default function DailyQuote({ editMode = false }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const [manageOpen, setManageOpen] = useState(false);

  // The user's custom quotes cycle in alongside the built-in pool.
  const { data: customQuotes = [] } = useQuery({
    queryKey: ['customQuotes', user?.id],
    queryFn: listMyQuotes,
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  const [quote, setQuote] = useState(() => getDailyQuote([]));

  // Re-evaluate when the custom list loads/changes (same-day cache keeps it
  // stable; a freshly-added quote only changes today's pick if the cache
  // was empty) and roll over at local midnight.
  useEffect(() => {
    setQuote(getDailyQuote(customQuotes));
  }, [customQuotes]);

  useEffect(() => {
    let timer = null;
    const schedule = () => {
      timer = setTimeout(() => {
        setQuote(getDailyQuote(customQuotes));
        schedule();
      }, msUntilLocalMidnight());
    };
    schedule();
    return () => { if (timer) clearTimeout(timer); };
  }, [customQuotes]);

  if (!quote) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <p className="block text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-3 px-1">
        {t('dashboard.quoteOfTheDay')}
      </p>
      <Card className="relative overflow-hidden p-5 md:p-6 border-border/60 bg-gradient-to-br from-primary/[0.04] to-transparent">
        <Quote className="absolute top-3 end-3 w-5 h-5 text-primary/30" />
        <p className="font-heading text-base md:text-lg leading-snug text-foreground/90 pe-6 break-words">
          "{quote.text}"
        </p>
        {quote.author && (
          <p className="mt-2 text-xs font-medium tracking-wide text-muted-foreground">
            — {quote.author}
          </p>
        )}
      </Card>

      {/* Edit-mode affordance: add/manage your own quotes that cycle in. */}
      {editMode && (
        <button
          onClick={() => setManageOpen(true)}
          className="mt-2 flex items-center gap-1.5 px-1 text-xs font-semibold text-primary hover:opacity-80 transition-opacity"
        >
          <Star className="w-3.5 h-3.5" />
          {tFallback('quotes.addCustom', 'Add custom quote')}
        </button>
      )}

      <CustomQuotesModal open={manageOpen} onClose={() => setManageOpen(false)} />
    </motion.div>
  );
}
