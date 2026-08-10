// src/components/hub/RowActionSheet.jsx
//
// Quick actions for a conversation or crew row, as a bottom sheet.
//
// WHY THIS EXISTS: pin / mute / archive / unarchive / leave lived only in
// a three-dot menu declared `hidden lg:flex`, and this app ships to iOS
// and Android. On every device a real user holds, none of the five could
// be reached — which also meant nothing could ever be archived, so the
// Archived filter chip had never once appeared and conversationArchive.js
// was dead code on the only platform that matters.
//
// Long-press is the trigger, not swipe. It is the gesture this app
// already uses for exactly this job: the bottom tabs long-press to quick
// actions (useLongPress → TabQuickActionMenu, taught by LONG_PRESS_TABS)
// and DM bubbles long-press to a context menu. A swipe-to-reveal would
// have been a second vocabulary for one job, and it would have fought the
// row's existing horizontal clusters — a Requests row already renders
// Accept / Delete / Block inline, and an outgoing-pending row renders
// Unsend plus its armed confirm pair.
//
// The same sheet backs the desktop three-dot button, so there is one
// action list with two triggers rather than two implementations that
// drift.
//
// SHAPE: chrome comes from ui/BottomSheet (drag-to-dismiss, safe-area
// padding, backdrop). Rows copy TabQuickActionMenu's px-4 py-3 + text-sm,
// which lands at a 44px target — the same one the Header's h-11 controls
// use. No shadow: the backdrop is what separates the sheet from the page.

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import BottomSheet from '@/components/ui/BottomSheet';
import { triggerHaptic } from '@/lib/haptic';
import { useLanguage } from '@/lib/LanguageContext';

// How long a destructive action stays armed before it disarms itself.
// Same 5s HubMessages uses for the Delete-request confirm.
const ARM_TIMEOUT_MS = 5000;

/**
 * @param {object}   props
 * @param {boolean}  props.open
 * @param {Function} props.onClose
 * @param {object}   props.header        { avatarUrl, initials, icon, label, sublabel }
 * @param {Array}    props.actions       [{ id, icon, label, destructive, confirmLabel,
 *                                          confirmWarning, onSelect }]
 * @param {object}   [props.returnFocusRef]  focused again once the sheet closes
 */
export default function RowActionSheet({
  open,
  onClose,
  header = null,
  actions = [],
  returnFocusRef = null,
}) {
  const { tFallback } = useLanguage();
  const [armedId, setArmedId] = useState(null);
  const armTimerRef = useRef(null);
  const firstActionRef = useRef(null);

  const disarm = useCallback(() => {
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    setArmedId(null);
  }, []);

  const arm = useCallback((id) => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    // A different pulse from the one that opened the sheet, so the
    // escalation is felt rather than only read.
    triggerHaptic('warning');
    setArmedId(id);
    armTimerRef.current = setTimeout(() => setArmedId(null), ARM_TIMEOUT_MS);
  }, []);

  // Never reopen still armed — a sheet that opens with a destructive
  // action already primed is one mis-tap from doing it.
  useEffect(() => { if (!open) disarm(); }, [open, disarm]);
  useEffect(() => () => { if (armTimerRef.current) clearTimeout(armTimerRef.current); }, []);

  // Focus into the sheet on open, and hand focus back to the row that
  // opened it on close — otherwise a keyboard user lands at the top of
  // the document every time.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => firstActionRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const handleClose = useCallback(() => {
    onClose?.();
    // After the sheet unmounts, not during — focusing a node under an
    // open overlay does nothing useful.
    setTimeout(() => returnFocusRef?.current?.focus?.(), 0);
  }, [onClose, returnFocusRef]);

  const select = useCallback((action) => {
    if (action.destructive && armedId !== action.id) {
      arm(action.id);
      return;
    }
    disarm();
    try { action.onSelect?.(); } catch { /* the sheet dispatches; it doesn't own errors */ }
    handleClose();
  }, [armedId, arm, disarm, handleClose]);

  if (!open) return null;

  return (
    <BottomSheet open={open} onClose={handleClose}>
      {/* Identity header. Load-bearing, not decoration: after a
          long-press on a dense list you have to be able to confirm which
          row you actually grabbed before tapping Archive. */}
      {header && (
        <div className="flex items-center gap-2 pb-3 border-b border-border">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center font-heading font-bold text-primary text-sm overflow-hidden shrink-0">
            {header.avatarUrl
              ? <img loading="lazy" src={header.avatarUrl} alt="" className="w-full h-full object-cover" />
              : header.icon
                ? <header.icon className="w-4 h-4" />
                : (header.initials || '?')}
          </div>
          <div className="min-w-0">
            <p className="font-heading font-bold text-sm truncate">{header.label}</p>
            {header.sublabel && (
              <p className="text-micro text-muted-foreground truncate">{header.sublabel}</p>
            )}
          </div>
        </div>
      )}

      {/* Full-bleed rows: BottomSheet's content wrapper insets by px-4, so
          the list pulls back out and each row re-applies it. That keeps
          the hairlines running edge to edge. */}
      <div className="-mx-4" role="menu" aria-label={header?.label || undefined}>
        {actions.map((action, i) => {
          const isArmed = action.destructive && armedId === action.id;
          return (
            <div key={action.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                role="menuitem"
                ref={i === 0 ? firstActionRef : undefined}
                onClick={() => select(action)}
                className={`w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-start transition-colors ${
                  action.destructive
                    ? 'text-destructive hover:bg-destructive/10 active:bg-destructive/10'
                    : 'text-foreground hover:bg-secondary active:bg-secondary'
                }`}
              >
                {action.icon && (
                  <action.icon className={`w-4 h-4 shrink-0 ${action.destructive ? '' : 'text-primary'}`} />
                )}
                <span className="flex-1">
                  {isArmed ? (action.confirmLabel || action.label) : action.label}
                </span>
              </button>
              {/* The warning appears under the armed row rather than
                  replacing it, so the confirm target does not move out
                  from under the finger that just armed it. */}
              {isArmed && action.confirmWarning && (
                <p className="px-4 pb-2 -mt-1 text-micro text-muted-foreground">
                  {action.confirmWarning}
                </p>
              )}
            </div>
          );
        })}

        <button
          type="button"
          role="menuitem"
          onClick={handleClose}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-muted-foreground text-start hover:bg-secondary active:bg-secondary transition-colors border-t border-border"
        >
          <X className="w-4 h-4 shrink-0" />
          <span className="flex-1">{tFallback('common.cancel', 'Cancel')}</span>
        </button>
      </div>
    </BottomSheet>
  );
}
