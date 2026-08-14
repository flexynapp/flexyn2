// src/components/gauntlet/GauntletStatsModal.jsx
// Completion stats overlay shown after finishing a path challenge or weekly gauntlet.
// Share button generates a PNG snapshot via html2canvas.
import { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Share2, Trophy, Star, Zap } from 'lucide-react';
import { useNumberFormatter } from '@/lib/intl';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

function StatPill({ label, value, accent }) {
  return (
    <div className="flex flex-col items-center gap-1 flex-1">
      <span className={`text-xl font-black ${accent}`}>{value}</span>
      <span className="text-micro text-muted-foreground uppercase tracking-wider leading-tight text-center">{label}</span>
    </div>
  );
}

/**
 * Props:
 *  open           — boolean
 *  onClose()
 *  type           — 'path' | 'weekly'
 *  challengeTitle — string
 *  xpAwarded      — number
 *  coinsAwarded   — number
 *  stats          — { completion_rate_pct, attempt_count, completion_count, user_rank }
 *  pathCompleted  — boolean (for type==='path', whether all 10 done)
 */
export default function GauntletStatsModal({
  open, onClose,
  type = 'path',
  challengeTitle = '',
  xpAwarded = 0,
  coinsAwarded = 0,
  stats = {},
  pathCompleted = false,
}) {
  const { tFallback } = useLanguage();
  const cardRef = useRef(null);
  const fmt = useNumberFormatter();
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);

  const { completion_rate_pct = 0, attempt_count = 0, completion_count = 0, user_rank = null } = stats;

  async function handleShare() {
    if (!cardRef.current) return;
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: '#0f0f13',
        scale: 2,
        useCORS: true,
      });
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const file = new File([blob], 'gauntlet-complete.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Flexyn Gauntlet', text: `I just cleared "${challengeTitle}" on Flexyn! 🏆` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'gauntlet-complete.png'; a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // Swallow AbortError (user cancelled share sheet)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            onClick={onClose}
          />

          {/* Card */}
          <motion.div
            className="relative w-full max-w-sm z-10"
            initial={{ scale: 0.88, y: 40 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.88, y: 40 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          >
            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              className="absolute -top-3 -end-3 z-20 w-8 h-8 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground active:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Shareable card area */}
            <div
              ref={cardRef}
              className="rounded-2xl overflow-hidden border border-border bg-[#0f0f13]"
            >
              {/* Header gradient */}
              <div
                className="px-5 pt-6 pb-4 text-center"
                style={{ background: 'linear-gradient(160deg, #7c3aed33, #db277733, #f5930022)' }}
              >
                {pathCompleted ? (
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <Trophy className="w-10 h-10 text-amber-400" />
                    <Trophy className="w-14 h-14 text-amber-400" />
                    <Trophy className="w-10 h-10 text-amber-400" />
                  </div>
                ) : (
                  <motion.div
                    className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center"
                    style={{ background: 'linear-gradient(135deg, #7c3aed, #db2777)' }}
                    animate={{ rotate: [0, 6, -6, 0] }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                  >
                    <Trophy className="w-8 h-8 text-white" />
                  </motion.div>
                )}

                <p className="text-xs font-bold uppercase tracking-widest text-purple-400 mb-1">
                  {type === 'weekly' ? 'Community Gauntlet' : 'Gauntlet Path'}
                </p>
                <h2 className="text-xl font-black text-white leading-tight mb-1">
                  {pathCompleted ? 'Path Complete.' : 'Challenge Clear.'}
                </h2>
                <p className="text-sm text-muted-foreground">"{challengeTitle}"</p>
              </div>

              {/* XP + Coins row */}
              <div className="flex divide-x divide-border border-t border-b border-border">
                <div className="flex-1 flex flex-col items-center py-3 gap-0.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Zap className="w-3 h-3 text-amber-400" /> XP
                  </span>
                  <span className="text-lg font-black text-amber-400">+{xpAwarded}</span>
                </div>
                <div className="flex-1 flex flex-col items-center py-3 gap-0.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    🪙 Coins
                  </span>
                  <span className="text-lg font-black text-yellow-400">+{coinsAwarded}</span>
                </div>
              </div>

              {/* Global stats */}
              <div className="px-5 py-4">
                <p className="text-micro font-bold uppercase tracking-widest text-muted-foreground mb-3 text-center">
                  Community Stats
                </p>
                <div className="flex gap-2">
                  <StatPill
                    label="Completion Rate"
                    value={`${completion_rate_pct}%`}
                    accent={completion_rate_pct < 20 ? 'text-rose-400' : completion_rate_pct < 50 ? 'text-amber-400' : 'text-emerald-400'}
                  />
                  <StatPill
                    label="Total Attempts"
                    value={fmt(attempt_count)}
                    accent="text-purple-400"
                  />
                  {user_rank != null && (
                    <StatPill
                      label="Your Rank"
                      value={`#${user_rank}`}
                      accent="text-amber-400"
                    />
                  )}
                </div>

                {/* Contextual quip. The "Less than 5%" branch used to
                    fire for `completion_rate_pct === 0` too, which is
                    actually a more notable moment (literally first) —
                    surface it with a "You're the FIRST" copy instead.
                    (Audit 15 #M18.) */}
                <p className="text-xs text-muted-foreground text-center mt-3 italic">
                  {completion_rate_pct === 0
                    ? "You're the FIRST to clear this. Legendary."
                    : completion_rate_pct <= 5
                      ? 'Less than 5% of athletes have done this. Rare.'
                      : completion_rate_pct <= 20
                        ? `Only ${completion_rate_pct}% of athletes have cleared this.`
                        : completion_rate_pct <= 50
                          ? `${completion_rate_pct}% completion rate. You're in the majority — keep climbing.`
                          : `${completion_rate_pct}% of athletes cleared this. Solid.`}
                </p>
              </div>

              {/* Branding for share */}
              <div className="flex items-center justify-center gap-2 pb-4 text-micro text-muted-foreground/50">
                <Star className="w-3 h-3" /> Flexyn Gauntlet
              </div>
            </div>

            {/* Share button — outside the captured card */}
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={handleShare}
              className="w-full mt-3 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 text-white"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #db2777)' }}
            >
              <Share2 className="w-4 h-4" />
              Share Result
            </motion.button>

            <button
              type="button"
              onClick={onClose}
              className="w-full mt-2 py-2.5 text-sm text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
            >
              Continue
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
