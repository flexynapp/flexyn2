// src/components/hub/ReportDialog.jsx
// Modal for reporting a post or comment to moderators.
// Shows reason options and an optional detail field.
// Gracefully handles "already reported" state.

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Flag, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { fileReport, checkAlreadyReported } from '@/lib/data/hubReports';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

const REASONS = [
  { value: 'harassment',     labelKey: 'report.reason.harassment'     },
  { value: 'hate_speech',    labelKey: 'report.reason.hate_speech'    },
  { value: 'spam',           labelKey: 'report.reason.spam'           },
  { value: 'inappropriate',  labelKey: 'report.reason.inappropriate'  },
  { value: 'impersonation',  labelKey: 'report.reason.impersonation'  },
  { value: 'other',          labelKey: 'report.reason.other'          },
];

/**
 * @param {boolean}           open
 * @param {()=>void}          onClose
 * @param {'post'|'comment'}  reportedType
 * @param {string}            reportedId       — post.id or comment.id
 * @param {string}            reportedAuthorEmail
 */
export default function ReportDialog({ open, onClose, reportedType, reportedId, reportedAuthorEmail }) {
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);
  const { t } = useLanguage();
  const { user } = useAuth();

  const [reason, setReason]     = useState('');
  const [detail, setDetail]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [alreadyReported, setAlreadyReported] = useState(false);

  // Check whether this content was already reported whenever the dialog opens.
  useEffect(() => {
    if (!open || !user?.email || !reportedId) return;
    let cancelled = false;
    checkAlreadyReported(user.email, reportedType, reportedId).then(yes => {
      if (!cancelled) setAlreadyReported(yes);
    });
    return () => { cancelled = true; };
  }, [open, user?.email, reportedType, reportedId]);

  // Reset state when dialog closes.
  useEffect(() => {
    if (!open) {
      setReason('');
      setDetail('');
      setSubmitting(false);
      setSubmitted(false);
      setAlreadyReported(false);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    try {
      await fileReport({
        reporterEmail:       user.email,
        reporterUserId:      user.id,
        reportedType,
        reportedId,
        reportedAuthorEmail,
        reason,
        detail,
      });
      setSubmitted(true);
    } catch (err) {
      console.error('[Report] failed:', err);
      toast.error(t('report.submitError'));
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="report-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 32, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 32, scale: 0.97 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Flag className="w-4 h-4 text-destructive" />
                <h2 className="font-heading font-bold text-base">
                  {reportedType === 'post' ? t('report.titlePost') : t('report.titleComment')}
                </h2>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-secondary active:bg-secondary transition-colors"
                aria-label={t('common.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4">
              {submitted ? (
                /* ── Confirmation ── */
                <div className="flex flex-col items-center text-center py-4 gap-3">
                  <CheckCircle2 className="w-10 h-10 text-success" />
                  <p className="font-heading font-bold text-base">{t('report.thankYou')}</p>
                  <p className="text-sm text-muted-foreground">{t('report.thankYouDesc')}</p>
                  <button
                    onClick={onClose}
                    className="mt-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold"
                  >
                    {t('common.close')}
                  </button>
                </div>
              ) : alreadyReported ? (
                /* ── Already reported ── */
                <div className="flex flex-col items-center text-center py-4 gap-3">
                  <Flag className="w-10 h-10 text-muted-foreground" />
                  <p className="font-heading font-bold text-base">{t('report.alreadyReported')}</p>
                  <p className="text-sm text-muted-foreground">{t('report.alreadyReportedDesc')}</p>
                  <button
                    onClick={onClose}
                    className="mt-2 px-5 py-2 rounded-lg bg-secondary text-foreground text-sm font-bold"
                  >
                    {t('common.close')}
                  </button>
                </div>
              ) : (
                /* ── Report form ── */
                <>
                  <p className="text-sm text-muted-foreground mb-4">{t('report.selectReason')}</p>

                  <div className="space-y-2 mb-4">
                    {REASONS.map(r => (
                      <button
                        key={r.value}
                        onClick={() => setReason(r.value)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm text-start transition-colors ${
                          reason === r.value
                            ? 'border-primary bg-primary/10 text-foreground font-medium'
                            : 'border-border text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-foreground active:text-foreground'
                        }`}
                      >
                        <span
                          className={`w-4 h-4 rounded-full border-2 flex-shrink-0 transition-colors ${
                            reason === r.value ? 'border-primary bg-primary' : 'border-muted-foreground'
                          }`}
                        />
                        {t(r.labelKey)}
                      </button>
                    ))}
                  </div>

                  {/* Optional detail */}
                  <textarea
                    value={detail}
                    onChange={(e) => setDetail(e.target.value.slice(0, 400))}
                    placeholder={t('report.detailPlaceholder')}
                    rows={2}
                    className="w-full px-3 py-2 bg-secondary/40 border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 mb-4"
                  />

                  <button
                    onClick={handleSubmit}
                    disabled={!reason || submitting}
                    className="w-full py-2.5 rounded-lg bg-destructive text-destructive-foreground text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
                  >
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    {t('report.submit')}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
