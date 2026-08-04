// src/components/BugReportDialog.jsx
// In-app bug / feedback form. Stores reports to the bug_reports Supabase table.

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Bug, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { fileBugReport } from '@/lib/data/hubReports';

export default function BugReportDialog({ open, onClose }) {
  const { t } = useLanguage();
  const { user } = useAuth();

  const [description, setDescription] = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [submitted, setSubmitted]     = useState(false);
  const textareaRef = useRef(null);

  // Reset when dialog closes.
  useEffect(() => {
    if (!open) {
      setDescription('');
      setSubmitting(false);
      setSubmitted(false);
    }
  }, [open]);

  // Auto-focus the textarea on open so users can start typing without
  // a tap. 80ms delay lets the entrance animation settle so the mobile
  // keyboard doesn't appear before the dialog is in position.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => textareaRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open]);

  const handleSubmit = async () => {
    if (!description.trim() || submitting) return;
    setSubmitting(true);
    try {
      await fileBugReport({
        reporterEmail:   user?.email  || null,
        reporterUserId:  user?.id     || null,
        description:     description,
        pageContext:     window.location.pathname,
      });
      setSubmitted(true);
    } catch (err) {
      console.error('[BugReport] failed:', err);
      toast.error(t('bugReport.submitError'));
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="bug-report-overlay"
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
                <Bug className="w-4 h-4 text-primary" />
                <h2 className="font-heading font-bold text-base">{t('bugReport.title')}</h2>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
                aria-label={t('common.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4">
              {submitted ? (
                <div className="flex flex-col items-center text-center py-4 gap-3">
                  <CheckCircle2 className="w-10 h-10 text-green-500" />
                  <p className="font-heading font-bold text-base">{t('bugReport.thankYou')}</p>
                  <p className="text-sm text-muted-foreground">{t('bugReport.thankYouDesc')}</p>
                  <button
                    onClick={onClose}
                    className="mt-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold"
                  >
                    {t('common.close')}
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground mb-3">{t('bugReport.desc')}</p>
                  <textarea
                    ref={textareaRef}
                    value={description}
                    onChange={(e) => setDescription(e.target.value.slice(0, 1000))}
                    placeholder={t('bugReport.placeholder')}
                    rows={5}
                    className="w-full px-3 py-2 bg-secondary/40 border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 mb-1"
                    autoFocus
                  />
                  <p className="text-micro text-muted-foreground text-end mb-4">
                    {description.length}/1000
                  </p>
                  <button
                    onClick={handleSubmit}
                    disabled={!description.trim() || submitting}
                    className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
                  >
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    {t('bugReport.submit')}
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
