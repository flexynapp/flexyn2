import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Quote, Star, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { getDailyQuote, getQuotePool } from '@/lib/dailyQuotes';
import { listMyQuotes } from '@/lib/data/customQuotes';
import CustomQuotesModal from './CustomQuotesModal';

// Milliseconds until the next local-midnight rollover.
function msUntilLocalMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}

const slideVariants = {
  enter: (dir) => ({ x: dir >= 0 ? 64 : -64, opacity: 0 }),
  center: { x: 0, opacity: 1 },
};

// Module-level constant so the "no custom quotes yet" fallback is
// referentially STABLE. An inline `= []` destructure default mints a new
// array on every render while the query is loading — which made the
// [customQuotes] effect below re-fire each render, and since getDailyQuote
// returns a fresh object, each setQuote re-rendered, looping until React's
// "Maximum update depth exceeded" bailout on every Dashboard load.
const NO_CUSTOM_QUOTES = [];

export default function DailyQuote({ editMode = false }) {
  const { tFallback } = useLanguage();
  const { user } = useAuth();
  const [manageOpen, setManageOpen] = useState(false);

  // The user's custom quotes cycle in alongside the built-in pool.
  const { data: customQuotes = NO_CUSTOM_QUOTES } = useQuery({
    queryKey: ['customQuotes', user?.id],
    queryFn: listMyQuotes,
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  const [quote, setQuote] = useState(() => getDailyQuote([]));

  // Re-evaluate when the custom list loads/changes (same-day cache keeps it
  // stable; a freshly-added quote only changes today's pick if the cache
  // was empty) and roll over at local midnight. Idempotent setter: keep the
  // previous object when the pick hasn't actually changed, so referential
  // churn upstream can never re-loop the render.
  useEffect(() => {
    setQuote(prev => {
      const next = getDailyQuote(customQuotes);
      return prev && next && prev.key === next.key && prev.text === next.text ? prev : next;
    });
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

  // Swipe carousel: today's quote sits at index 0, every other quote follows.
  const pool = useMemo(() => getQuotePool(customQuotes), [customQuotes]);
  const ordered = useMemo(() => {
    if (!quote) return [];
    const rest = pool.filter(p => p.key !== quote.key);
    return [{ key: quote.key, text: quote.text, author: quote.author }, ...rest];
  }, [quote, pool]);

  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(0);

  // Reset to the daily quote whenever the day's pick changes.
  useEffect(() => { setIndex(0); setDirection(0); }, [quote?.key]);

  if (!quote || ordered.length === 0) return null;

  const safeIndex = Math.min(index, ordered.length - 1);
  const current = ordered[safeIndex];

  const paginate = (dir) => {
    if (ordered.length < 2) return;
    setDirection(dir);
    setIndex(i => (i + dir + ordered.length) % ordered.length);
  };

  const onDragEnd = (_e, info) => {
    const { offset, velocity } = info;
    if (offset.x < -50 || velocity.x < -350) paginate(1);
    else if (offset.x > 50 || velocity.x > 350) paginate(-1);
  };

  const onDay = safeIndex === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="relative">
        <motion.div
          key={current.key}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          drag={editMode || ordered.length < 2 ? false : 'x'}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.45}
          onDragEnd={onDragEnd}
          style={{ touchAction: 'pan-y' }}
        >
          <Card className="relative overflow-hidden p-5 md:p-6 border-border/60 bg-primary/5 select-none">
            <Quote className="absolute top-3 end-3 w-5 h-5 text-primary/30" />
            <p className="font-heading text-base md:text-lg leading-snug text-foreground/90 px-1 sm:px-7 break-words">
              "{current.text}"
            </p>
            {current.author && (
              <p className="mt-2 text-xs font-medium tracking-wide text-muted-foreground px-1 sm:px-7">
                — {current.author}
              </p>
            )}
          </Card>

          {/* Chevrons — primarily for desktop; mobile uses the swipe gesture. */}
          {!editMode && ordered.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => paginate(-1)}
                aria-label={tFallback('quotes.prev', 'Previous quote')}
                className="absolute start-0 top-1/2 -translate-y-1/2 w-8 h-8 hidden sm:flex items-center justify-center rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-foreground/5 active:bg-foreground/10 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => paginate(1)}
                aria-label={tFallback('quotes.next', 'Next quote')}
                className="absolute end-0 top-1/2 -translate-y-1/2 w-8 h-8 hidden sm:flex items-center justify-center rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-foreground/5 active:bg-foreground/10 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}
        </motion.div>

        {/* Position hint — keeps swipe discoverable without cluttering the card. */}
        {ordered.length > 1 && (
          <div className="mt-2 flex items-center justify-center gap-2">
            {onDay ? (
              <span className="text-micro text-muted-foreground/60 tracking-wide">
                {tFallback('quotes.swipeHint', 'Swipe for more')}
              </span>
            ) : (
              <span className="text-micro text-muted-foreground/60 tracking-wide tabular-nums">
                {safeIndex + 1} / {ordered.length}
              </span>
            )}
          </div>
        )}
      </div>

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
