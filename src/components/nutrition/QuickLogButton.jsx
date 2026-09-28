// src/components/nutrition/QuickLogButton.jsx
//
// The round "+" on a food search result, which logs that food to today in
// one tap. It used to fire "Logged <food>!" the moment it was pressed, before
// the save had even been sent, so a failed save announced success and then
// an error on top of it. Now the button itself turns into a drawn check once
// the row is actually saved, and goes back after a moment so the same food
// can be logged again. A failure is left to the feedback pill, which says
// why; a 32px circle has no room for a reason.

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import DrawnCheck from '@/components/feedback/DrawnCheck';
import { useButtonAnswer } from '@/components/feedback/buttonAnswer';

export default function QuickLogButton({ onLog, disabled, label, doneLabel }) {
  const answer = useButtonAnswer();
  const [announce, setAnnounce] = useState('');
  const done = answer.phase === 'done';

  const press = () => {
    answer.reset();
    onLog({
      onSuccess: () => {
        answer.succeed();
        setAnnounce(doneLabel);
      },
    });
  };

  return (
    <>
      <motion.button
        type="button"
        whileTap={{ scale: 0.88 }}
        onClick={press}
        disabled={disabled}
        aria-label={label}
        title={label}
        className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 ${done
          ? 'bg-success text-success-foreground'
          : 'bg-primary/10 hover:bg-primary active:bg-primary text-primary hover:text-primary-foreground active:text-primary-foreground'}`}
      >
        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.span key="done" className="flex" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <DrawnCheck className="w-5 h-5" halo={false} />
            </motion.span>
          ) : (
            <motion.span key="idle" className="flex" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Plus className="w-4 h-4" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
      <span role="status" className="sr-only">{announce}</span>
    </>
  );
}
