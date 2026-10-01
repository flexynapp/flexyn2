// src/components/report/ReportPlayerSheet.jsx
//
// Report a player: suspected cheating, sessions that never happened,
// harassment. Opened from the ⋯ beside a name in a league bracket, a
// leaderboard, a duel, a rival card or a crew war (PlayerMenu), and from the
// profile menu.
//
// Feedback stays in the dialog rather than in a toast: the button turns into
// a drawn check and the dialog says what happens next, so the person can see
// the report went somewhere. A reason they already reported shows as sent and
// cannot be picked again (the server would answer 'already' anyway).

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/lib/LanguageContext';
import { reportError } from '@/lib/reportError';
import prefersReducedMotion from '@/lib/reducedMotion';
import {
  PLAYER_REPORT_REASONS,
  reportPlayer,
  myOpenReportReasons,
} from '@/lib/data/playerReports';

const REASON_COPY = {
  cheating:      ['reportPlayer.reason.cheating', 'Impossible lifts or numbers'],
  fake_activity: ['reportPlayer.reason.fakeActivity', 'Fake workouts or cardio'],
  harassment:    ['reportPlayer.reason.harassment', 'Harassment or bullying'],
  inappropriate: ['reportPlayer.reason.inappropriate', 'Offensive name or profile'],
  spam:          ['reportPlayer.reason.spam', 'Spam'],
  other:         ['reportPlayer.reason.other', 'Something else'],
};

/**
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {string} userId     the player being reported
 * @param {string} [username]
 * @param {'league'|'leaderboard'|'duel'|'gym_rival'|'cardio_rival'|'crew_war'|'gym'|'profile'} [context]
 * @param {string} [contextId] e.g. the duel or crew war id
 */
export default function ReportPlayerSheet({ open, onClose, userId, username, context = null, contextId = null }) {
  const { tFallback } = useLanguage();
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [phase, setPhase] = useState('form'); // form | sending | sent
  const [error, setError] = useState('');
  const [sentReasons, setSentReasons] = useState(() => new Set());

  useEffect(() => {
    if (!open) return undefined;
    setReason('');
    setDetail('');
    setPhase('form');
    setError('');
    let cancelled = false;
    myOpenReportReasons(userId).then((s) => { if (!cancelled) setSentReasons(s); });
    return () => { cancelled = true; };
  }, [open, userId]);

  const name = username ? `@${username}` : tFallback('reportPlayer.thisPlayer', 'this player');

  const submit = async () => {
    if (!reason || phase !== 'form') return;
    setPhase('sending');
    setError('');
    try {
      await reportPlayer({ userId, reason, context, contextId, detail });
      setSentReasons((s) => new Set(s).add(reason));
      setPhase('sent');
    } catch (err) {
      if (err?.code === 'rate_limited') {
        setError(tFallback('reportPlayer.rateLimited', 'You have sent a lot of reports today. Try again tomorrow.'));
      } else {
        reportError(err, { feature: 'report.player' });
        setError(tFallback('reportPlayer.failed', 'That did not send. Try again.'));
      }
      setPhase('form');
    }
  };

  return (
    // A Radix Dialog rather than BottomSheet, on purpose: this opens from
    // inside other Radix dialogs (the league standings) and from the
    // full-screen rival view. Radix stacks nested dialogs and keeps the
    // parent open; a hand-rolled overlay is an "outside click" to the parent
    // and closed it along with the report. z-[10000] clears the rival view.
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="z-[10000] max-w-sm gap-0 p-5"
        overlayClassName="z-[10000]"
      >
        <DialogTitle className="font-heading font-bold text-base pe-8 truncate">
          {tFallback('reportPlayer.title', 'Report {name}', { name })}
        </DialogTitle>
      <AnimatePresence mode="wait" initial={false}>
        {phase === 'sent' ? (
          <SentState key="sent" name={name} onClose={onClose} />
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col gap-6 pt-3"
          >
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                {tFallback('reportPlayer.lede', 'What did you see? They will not know who reported them.')}
              </p>
              <div role="radiogroup" aria-label={tFallback('reportPlayer.reasonLabel', 'Reason')} className="flex flex-col">
                {PLAYER_REPORT_REASONS.map((r) => {
                  const [key, en] = REASON_COPY[r];
                  const sent = sentReasons.has(r);
                  const selected = reason === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={sent || phase === 'sending'}
                      onClick={() => setReason(r)}
                      className="flex items-center gap-3 min-h-[48px] border-b border-border/60 last:border-b-0 text-start text-sm disabled:cursor-default"
                    >
                      <span
                        aria-hidden="true"
                        className={`w-[18px] h-[18px] rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                          selected ? 'border-destructive' : 'border-muted-foreground/50'
                        } ${sent ? 'opacity-40' : ''}`}
                      >
                        <motion.span
                          initial={false}
                          animate={{ scale: selected ? 1 : 0 }}
                          transition={{ type: 'spring', stiffness: 600, damping: 30 }}
                          className="w-2 h-2 rounded-full bg-destructive"
                        />
                      </span>
                      <span className={`flex-1 ${sent ? 'text-muted-foreground' : selected ? 'font-semibold' : ''}`}>
                        {tFallback(key, en)}
                      </span>
                      {sent && (
                        <span className="text-micro text-muted-foreground">
                          {tFallback('reportPlayer.alreadySent', 'Sent')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value.slice(0, 400))}
                placeholder={tFallback('reportPlayer.detailPlaceholder', 'What gave it away? Optional')}
                rows={2}
                disabled={phase === 'sending'}
                className="w-full px-3 py-2 bg-secondary/40 border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <motion.button
                type="button"
                onClick={submit}
                disabled={!reason || phase === 'sending'}
                whileTap={reason ? { scale: 0.98 } : undefined}
                className="w-full h-12 rounded-lg bg-destructive text-destructive-foreground text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {phase === 'sending' && <Loader2 className="w-4 h-4 animate-spin" />}
                {tFallback('reportPlayer.send', 'Send report')}
              </motion.button>
              <AnimatePresence>
                {error && (
                  <motion.p
                    key={error}
                    role="alert"
                    initial={{ opacity: 0, x: 0 }}
                    animate={{ opacity: 1, x: [0, -6, 6, -3, 3, 0] }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35 }}
                    className="text-sm text-destructive text-center"
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

function SentState({ name, onClose }) {
  const { tFallback } = useLanguage();
  const reduced = prefersReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: reduced ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center text-center gap-2 pt-4 pb-2"
      role="status"
    >
      <svg viewBox="0 0 52 52" className="w-14 h-14 text-success" aria-hidden="true">
        <motion.circle
          cx="26" cy="26" r="23" fill="none" stroke="currentColor" strokeWidth="3"
          initial={{ pathLength: reduced ? 1 : 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
        />
        <motion.path
          d="M15 27 l7 7 l15 -16" fill="none" stroke="currentColor" strokeWidth="3.5"
          strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: reduced ? 1 : 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.3, delay: reduced ? 0 : 0.35, ease: 'easeOut' }}
        />
      </svg>
      <p className="font-heading font-bold text-base mt-2">
        {tFallback('reportPlayer.sentTitle', 'Report sent')}
      </p>
      <p className="text-sm text-muted-foreground max-w-xs">
        {tFallback('reportPlayer.sentBody', 'We will look at the sessions behind {name}. They will not know it was you.', { name })}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="mt-6 w-full h-12 rounded-lg bg-secondary text-foreground text-sm font-bold"
      >
        {tFallback('reportPlayer.done', 'Done')}
      </button>
    </motion.div>
  );
}
