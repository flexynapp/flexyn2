// src/components/gauntlet/WeeklyGauntletCard.jsx
// Featured community gauntlet card shown at the top of the Gauntlet screen.
import { motion } from 'framer-motion';
import { Users, Zap, Clock, CheckCircle, Trophy } from 'lucide-react';

function timeUntil(dateStr) {
  const diff = new Date(dateStr) - Date.now();
  if (diff <= 0) return 'Ended';
  const days  = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h left`;
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

function formatVolume(v) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${Math.round(v / 1_000)}K`;
  return `${v}`;
}

/**
 * Props:
 *  gauntlet  — weekly_gauntlets row
 *  attempt   — weekly_gauntlet_attempts row | null
 *  onStart() — called when user taps "Enter Gauntlet"
 */
export default function WeeklyGauntletCard({ gauntlet, attempt, onStart }) {
  if (!gauntlet) return null;

  const passed   = attempt?.status === 'completed';
  const failed   = attempt?.status === 'failed';
  const started  = !!attempt;
  const timeLeft = timeUntil(gauntlet.week_end + 'T23:59:59');
  const ending   = timeLeft.includes('d') ? false : true;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="relative overflow-hidden rounded-2xl border border-border bg-card mb-5"
    >
      {/* Gradient header band */}
      <div
        className="px-4 pt-4 pb-3"
        style={{ background: 'linear-gradient(135deg, #7c3aed22, #db277722)' }}
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-purple-400 mb-1 block">
              Community Gauntlet
            </span>
            <h3 className="text-base font-bold leading-tight">{gauntlet.title}</h3>
          </div>
          <div className="shrink-0">
            {passed ? (
              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold">
                <CheckCircle className="w-3.5 h-3.5" /> Cleared
              </div>
            ) : failed ? (
              <div className="px-2 py-1 rounded-full bg-rose-500/20 text-rose-400 text-xs font-bold">
                Failed
              </div>
            ) : (
              <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                ending ? 'bg-rose-500/20 text-rose-400' : 'bg-purple-500/15 text-purple-400'
              }`}>
                <Clock className="w-3 h-3" />
                {timeLeft}
              </div>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          {gauntlet.description}
        </p>
      </div>

      {/* Stats row */}
      <div className="flex divide-x divide-border border-t border-border">
        <div className="flex-1 flex flex-col items-center py-3 gap-0.5">
          <span className="text-xs text-muted-foreground">Goal</span>
          <span className="text-sm font-bold text-foreground">
            {formatVolume(gauntlet.passing_threshold)} lbs
          </span>
        </div>
        <div className="flex-1 flex flex-col items-center py-3 gap-0.5">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Users className="w-3 h-3" /> Attempts
          </span>
          <span className="text-sm font-bold text-foreground">{gauntlet.attempt_count ?? 0}</span>
        </div>
        <div className="flex-1 flex flex-col items-center py-3 gap-0.5">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Trophy className="w-3 h-3 text-amber-400" /> Cleared
          </span>
          <span className="text-sm font-bold text-foreground">{gauntlet.completion_count ?? 0}</span>
        </div>
      </div>

      {/* CTA */}
      {!passed && !failed && (
        <div className="px-4 pb-4 pt-1">
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={onStart}
            className="w-full py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #db2777)' }}
          >
            <Zap className="w-4 h-4" />
            {started ? 'Continue Gauntlet' : 'Enter Gauntlet'}
          </motion.button>
        </div>
      )}

      {passed && (
        <div className="px-4 pb-4 pt-1">
          <div className="w-full py-2.5 rounded-xl text-sm font-bold text-emerald-400 bg-emerald-500/10 text-center">
            ✓ You cleared this week's gauntlet!
          </div>
        </div>
      )}

      {/* flavor text */}
      <div className="px-4 pb-3">
        <p className="text-[11px] italic text-muted-foreground/60 text-center">
          "{gauntlet.flavor_text}"
        </p>
      </div>
    </motion.div>
  );
}
