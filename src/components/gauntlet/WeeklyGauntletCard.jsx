// src/components/gauntlet/WeeklyGauntletCard.jsx
// Featured community gauntlet card shown at the top of the Gauntlet screen.
import { motion } from 'framer-motion';
import { Users, Zap, Clock, CheckCircle, Trophy, Loader2 } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { formatDuration } from '@/lib/intlFormat';

// Milliseconds until the gauntlet closes, or 0 once it has. The label is
// built in the component so the units and "left" follow the app language;
// this rendered "3d 4h left" under Spanish and French.
function msUntil(dateStr) {
  const diff = new Date(dateStr) - Date.now();
  return Number.isFinite(diff) && diff > 0 ? diff : 0;
}

function formatVolume(v) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${Math.round(v / 1_000)}K`;
  return `${v}`;
}

/**
 * Props:
 *  gauntlet       — weekly_gauntlets row
 *  attempt        — weekly_gauntlet_attempts row | null
 *  onStart()      — enter the gauntlet (creates the in-progress attempt)
 *  onLogWorkout() — go log a workout (shown once entered, below threshold)
 *  onSubmit()     — submit the qualifying session as the attempt score
 *  submitting     — submit in flight
 *  canSubmit      — best session already clears the threshold
 *  bestScore      — best in-week single-session score, or null
 */
export default function WeeklyGauntletCard({
  gauntlet, attempt, onStart, onLogWorkout, onSubmit, submitting, canSubmit, bestScore,
}) {
  const { tFallback, language } = useLanguage();
  if (!gauntlet) return null;

  const passed   = attempt?.status === 'completed';
  const failed   = attempt?.status === 'failed';
  const started  = !!attempt;
  // Build the end-of-week timestamp defensively: only append the
  // T23:59:59 suffix when week_end is a bare YYYY-MM-DD. If the column
  // ever ships as a full ISO timestamp, the prior concat produced
  // `2026-05-25T00:00:00ZT23:59:59` which parses to NaN and rendered
  // a permanent "Ended" pill. (Audit 15 #M9.)
  const weekEndIso = (() => {
    const raw = String(gauntlet.week_end || '');
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T23:59:59`;
    return raw;
  })();
  const msLeft   = weekEndIso ? msUntil(weekEndIso) : null;
  const timeLeft = msLeft == null
    ? '—'
    : msLeft === 0
      ? tFallback('weeklyGauntletCard.ended', 'Ended')
      : tFallback('crewWars.timeLeft', '{t} left', { t: formatDuration(msLeft, language) });
  // Under a day to go. This used to test the English label for a "d".
  const ending   = msLeft != null && msLeft < 86_400_000;
  // Unit suffix depends on what the gauntlet measures. Previously
  // hardcoded "lbs" so a consecutive_days / sessions_in_7_days
  // gauntlet displayed "7 lbs". (Audit 15 #M10.)
  const metric = String(gauntlet.metric || 'volume');
  const goalUnit =
    metric === 'consecutive_days'   ? 'days'     :
    metric === 'sessions_in_7_days' ? 'sessions' :
    metric === 'reps'               ? 'reps'     :
    metric === 'minutes'            ? 'min'      :
    metric === 'distance_meters'    ? 'm'        :
    'lbs';

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
            <span className="eyebrow text-purple-400 mb-1 block">
              {tFallback("weeklyGauntletCard.communityGauntlet", "Community Gauntlet")}
            </span>
            <h3 className="text-base font-bold leading-tight">{gauntlet.title}</h3>
          </div>
          <div className="shrink-0">
            {passed ? (
              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold">
                <CheckCircle className="w-3.5 h-3.5" /> {tFallback("injuries.section.cleared", "Cleared")}
              </div>
            ) : failed ? (
              <div className="px-2 py-1 rounded-full bg-rose-500/20 text-rose-400 text-xs font-bold">
                {tFallback("weeklyGauntletCard.failed", "Failed")}
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
          <span className="text-xs text-muted-foreground">{tFallback("achievementDefs.cat.goal", "Goal")}</span>
          <span className="text-sm font-bold text-foreground">
            {formatVolume(gauntlet.passing_threshold)} {goalUnit}
          </span>
        </div>
        <div className="flex-1 flex flex-col items-center py-3 gap-0.5">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Users className="w-3 h-3" /> {tFallback("weeklyGauntletCard.attempts", "Attempts")}
          </span>
          <span className="text-sm font-bold text-foreground">{gauntlet.attempt_count ?? 0}</span>
        </div>
        <div className="flex-1 flex flex-col items-center py-3 gap-0.5">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Trophy className="w-3 h-3 text-amber-400" /> {tFallback("injuries.section.cleared", "Cleared")}
          </span>
          <span className="text-sm font-bold text-foreground">{gauntlet.completion_count ?? 0}</span>
        </div>
      </div>

      {/* CTA */}
      {!passed && !failed && (
        <div className="px-4 pb-4 pt-1 space-y-2">
          {/* Progress toward the goal, once entered (total_volume scoring). */}
          {started && bestScore != null && (
            <p className="text-center text-xs text-muted-foreground">
              Best session this week:{' '}
              <span className="font-bold text-foreground tabular-nums">{formatVolume(bestScore)}</span>
              {' / '}
              <span className="tabular-nums">{formatVolume(gauntlet.passing_threshold)}</span> {goalUnit}
            </p>
          )}

          {started && canSubmit ? (
            // Best session already clears the bar — submitting always wins.
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={onSubmit}
              disabled={submitting}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {submitting ? 'Submitting…' : 'Submit & clear the gauntlet'}
            </motion.button>
          ) : (
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={started ? (onLogWorkout || onStart) : onStart}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #db2777)' }}
            >
              <Zap className="w-4 h-4" />
              {started ? 'Log a qualifying session' : 'Enter Gauntlet'}
            </motion.button>
          )}
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
        <p className="text-micro italic text-muted-foreground/60 text-center">
          "{gauntlet.flavor_text}"
        </p>
      </div>
    </motion.div>
  );
}
