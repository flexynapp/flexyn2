import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
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
          {/* No card — board 01 and the ledger on board 04 both draw this as a
              hairline block. "A daily quote isn't something the user arranged,
              so it doesn't get a surface." The card was breaking the surface
              rule twice: a card around read-only decoration, and a bg-primary/5
              tint on top of it. A rule above does the separating the card was
              really there for.

              sm:px-7 stays: the prev/next chevrons are absolutely positioned at
              start-0/end-0 of the wrapper and are `hidden sm:flex`, so without
              that inset they would sit on top of the text at desktop widths.
              Mobile needs none — the page inset already provides it. */}
          <div className="border-t border-border pt-4 select-none">
            <Quote className="w-3.5 h-3.5 text-primary/40 mb-1.5 sm:ms-7" aria-hidden="true" />
            <p className="font-heading text-base md:text-lg italic leading-snug text-foreground/90 sm:px-7 break-words">
              "{current.text}"
            </p>
            {current.author && (
              <p className="mt-2 text-xs font-medium tracking-wide text-muted-foreground sm:px-7">
                — {current.author}
              </p>
            )}
          </div>

          {/* Chevrons — primarily for desktop; mobile uses the swipe gesture. */}
          {!editMode && ordered.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => paginate(-1)}
                aria-label={tFallback('quotes.prev', 'Previous quote')}
                className="absolute start-0 top-1/2 -translate-y-1/2 w-8 h-8 hidden sm:flex items-center justify-center rounded-full text-muted-foreground/50 hover:text-foreground active:text-foreground hover:bg-foreground/5 active:bg-foreground/10 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => paginate(1)}
                aria-label={tFallback('quotes.next', 'Next quote')}
                className="absolute end-0 top-1/2 -translate-y-1/2 w-8 h-8 hidden sm:flex items-center justify-center rounded-full text-muted-foreground/50 hover:text-foreground active:text-foreground hover:bg-foreground/5 active:bg-foreground/10 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}
        </motion.div>

        {/* Caption. Board 01 draws one under the quote, and with the card gone
            it stops being optional: an unlabelled italic line on a bare page
            reads as a stray string rather than a slot that refills daily.
            Left-aligned to the quote above it, not centred as the old hint was.

            The board's caption says "tap to shuffle". Tapping does nothing here
            — paging is a swipe, plus chevrons at desktop widths — so the hint
            names the control that exists rather than the one that was drawn.
            Worth settling in the board either way; a caption that teaches the
            wrong gesture is worse than none. */}
        <div className="mt-2 flex items-center gap-1.5 sm:px-7">
          <span className="text-micro text-muted-foreground/60 tracking-wide">
            {tFallback('quotes.caption', 'Daily quote')}
          </span>
          {ordered.length > 1 && (
            <>
              <span className="text-micro text-muted-foreground/40" aria-hidden="true">·</span>
              <span className="text-micro text-muted-foreground/60 tracking-wide tabular-nums">
                {onDay
                  ? tFallback('quotes.swipeHint', 'Swipe for more')
                  : `${safeIndex + 1} / ${ordered.length}`}
              </span>
            </>
          )}
        </div>
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
