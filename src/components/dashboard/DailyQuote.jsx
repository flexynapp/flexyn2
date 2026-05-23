import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Quote } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { getDailyQuote } from '@/lib/dailyQuotes';

// Milliseconds until the next local-midnight rollover.
function msUntilLocalMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}

export default function DailyQuote() {
  const { t } = useLanguage();
  const [quote, setQuote] = useState(() => getDailyQuote());

  useEffect(() => {
    let timer = null;
    const schedule = () => {
      timer = setTimeout(() => {
        setQuote(getDailyQuote());
        schedule();
      }, msUntilLocalMidnight());
    };
    schedule();
    return () => { if (timer) clearTimeout(timer); };
  }, []);

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
    </motion.div>
  );
}