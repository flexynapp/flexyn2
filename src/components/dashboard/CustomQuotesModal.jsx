// src/components/dashboard/CustomQuotesModal.jsx
//
// Manage your custom "quote of the day" entries (up to 20). They cycle into
// the Dashboard rotation alongside the built-in quotes. Opened from the star
// under the quote card while the dashboard is in edit mode.

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Trash2, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { listMyQuotes, addQuote, removeQuote, MAX_CUSTOM_QUOTES } from '@/lib/data/customQuotes';

export default function CustomQuotesModal({ open, onClose }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [author, setAuthor] = useState('');
  // Synchronous in-flight guard. The `addMut.isPending` check is set
  // AFTER React's next render, so a double-tap in the same render tick
  // slips through and fires two inserts — burning two of the user's
  // 20-quote budget on one logical add. The ref takes effect within
  // the click handler itself. Pattern from CrewCreationFlow / Wave 48.
  const addingRef = useRef(false);

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ['customQuotes', user?.id],
    queryFn: listMyQuotes,
    enabled: !!user?.id && open,
  });

  const atLimit = quotes.length >= MAX_CUSTOM_QUOTES;

  const addMut = useMutation({
    mutationFn: () => addQuote(text, author),
    onSuccess: () => {
      setText(''); setAuthor('');
      qc.invalidateQueries({ queryKey: ['customQuotes', user?.id] });
    },
    onError: (err) => {
      if (err?.message === 'limit') toast.error(tFallback('quotes.limit', `You can have up to ${MAX_CUSTOM_QUOTES} custom quotes.`));
      else if (err?.message === 'empty') toast.error(tFallback('quotes.empty', 'Write something first.'));
      else if (err?.message === 'profanity') toast.error(tFallback('quotes.profanity', 'That quote contains prohibited content — edit it and try again.'));
      else toast.error(tFallback('quotes.addFailed', 'Could not save — try again.'));
    },
    onSettled: () => { addingRef.current = false; },
  });

  const handleAdd = () => {
    if (addingRef.current || !canAdd) return;
    addingRef.current = true;
    addMut.mutate();
  };

  const removeMut = useMutation({
    mutationFn: (id) => removeQuote(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customQuotes', user?.id] }),
    onError: () => toast.error(tFallback('quotes.removeFailed', 'Could not remove — try again.')),
  });

  const canAdd = text.trim().length > 0 && !atLimit && !addMut.isPending;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%', opacity: 0.5 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '100%', opacity: 0.5 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl max-h-[85vh] flex flex-col"
            style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
            // Tie the panel to its header via aria-labelledby so a screen
            // reader announces the modal title on focus. This is a raw
            // styled <motion.div> rather than a Radix Dialog, so without
            // explicit role + label the panel was reading as 'group'
            // with no name.
            role="dialog"
            aria-modal="true"
            aria-labelledby="custom-quotes-title"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <h2 id="custom-quotes-title" className="font-heading font-bold text-base">{tFallback('quotes.title', 'Your custom quotes')}</h2>
              </div>
              <button onClick={onClose} aria-label={tFallback('common.close', 'Close')} className="p-1.5 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Composer */}
            <div className="px-4 py-3 border-b border-border shrink-0 space-y-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 280))}
                placeholder={tFallback('quotes.placeholder', 'Write a quote that keeps you going…')}
                rows={2}
                maxLength={280}
                disabled={atLimit}
                className="w-full px-3 py-2 bg-secondary/40 border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
              />
              <div className="flex items-center gap-2">
                <input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value.slice(0, 80))}
                  placeholder={tFallback('quotes.authorPlaceholder', 'Author (optional)')}
                  maxLength={80}
                  disabled={atLimit}
                  className="flex-1 min-w-0 px-3 py-2 bg-secondary/40 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                />
                <button
                  onClick={handleAdd}
                  disabled={!canAdd}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                >
                  {addMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {tFallback('quotes.add', 'Add')}
                </button>
              </div>
              <p className={`text-[11px] text-end ${atLimit ? 'text-amber-500 font-semibold' : 'text-muted-foreground'}`}>
                {quotes.length} / {MAX_CUSTOM_QUOTES}
              </p>
            </div>

            {/* List */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2">
              {isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : quotes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {tFallback('quotes.emptyState', 'No custom quotes yet — add one above and it’ll join your daily rotation.')}
                </p>
              ) : (
                quotes
                  // Filter rows without a stable id — react-key
                  // collisions on `undefined` ids would lose the
                  // animation state on duplicates AND make the
                  // remove button send `undefined` to the RPC,
                  // which would 400. The data layer SHOULD always
                  // return ids; this is defensive against future drift.
                  .filter(q => q && q.id != null)
                  .map((q) => (
                  <div key={q.id} className="flex items-start gap-2 p-3 rounded-lg border border-border/60 bg-background/40">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug break-words">“{q.text}”</p>
                      {q.author && <p className="text-[11px] text-muted-foreground mt-1">— {q.author}</p>}
                    </div>
                    <button
                      onClick={() => removeMut.mutate(q.id)}
                      disabled={removeMut.isPending}
                      aria-label={tFallback('quotes.deleteQuote', 'Delete quote')}
                      className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
