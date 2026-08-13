// src/components/TwoFactorSection.jsx
//
// Settings section that surfaces the user's current 2FA status and
// gates the enrollment + disable flows behind a single CTA.
//
// States rendered:
//   • Loading  — small spinner while listFactors() is in-flight
//   • Enabled  — green dot + "On" + Disable button
//   • Disabled — muted dot + "Off" + Enable button → enrollment modal
//
// Enrollment modal flow:
//   1. enrollTotp() returns a QR + secret
//   2. User scans into Authenticator / Authy / 1Password
//   3. User types the 6-digit code → verifyEnrollment(code)
//   4. On success → mark enabled, refetch list, close modal

import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { Shield, ShieldCheck, Loader2, X, Check } from 'lucide-react';
import { toast } from '@/lib/toast';
import { listFactors, enrollTotp, verifyEnrollment, unenroll } from '@/lib/data/twoFactor';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

export default function TwoFactorSection() {
  const [loading, setLoading] = useState(true);
  const [factors, setFactors] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollment, setEnrollment] = useState(null); // { factorId, qr, secret }
  // Hold the page behind the enrollment modal — see @/lib/scrollLock. The
  // condition mirrors the `modalOpen && enrollment` render gate below, so
  // the lock and the overlay come and go together.
  useBodyScrollLock(modalOpen && !!enrollment);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableFactorId, setDisableFactorId] = useState(null);
  const codeInputRef = useRef(null);

  const refresh = async () => {
    setLoading(true);
    const res = await listFactors();
    if (res.ok) {
      // Only show VERIFIED totp factors as "enabled" — unverified
      // enrollments shouldn't be counted.
      setFactors((res.totp || []).filter(f => f.status === 'verified'));
    }
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const startEnroll = async () => {
    setEnrolling(true);
    const res = await enrollTotp('Flexyn');
    setEnrolling(false);
    if (!res.ok) {
      // A guest gets a sentence about their account, not GoTrue's wording.
      // The raw string is "Anonymous user not allowed to perform these
      // actions", which names a concept the product never uses.
      toast.error(res.reason === 'anonymous'
        ? 'Two-factor auth needs an account you can sign back in to. Guest sessions can\'t use it.'
        : `Couldn't start 2FA: ${res.message || 'try again'}`);
      return;
    }
    setEnrollment(res);
    setModalOpen(true);
  };

  const submitCode = async () => {
    if (!enrollment?.factorId || code.length < 6) return;
    setVerifying(true);
    const res = await verifyEnrollment({ factorId: enrollment.factorId, code });
    setVerifying(false);
    if (!res.ok) {
      const msg = res.reason === 'invalid_code' ? 'Wrong code — try again.' : 'Verification failed.';
      toast.error(msg);
      // Clear the input and refocus so the user can paste a fresh code
      // without first selecting the stale 6 digits. (Audit 14 #23.)
      setCode('');
      setTimeout(() => { codeInputRef.current?.focus(); }, 20);
      return;
    }
    toast.success('Two-factor authentication enabled.');
    setModalOpen(false);
    setEnrollment(null);
    setCode('');
    refresh();
  };

  // Replaced the native `confirm()` dialog with the AlertDialog used
  // elsewhere in Settings so the disable flow matches the rest of the
  // visual language and works correctly inside iOS PWA standalone mode
  // (where native confirm has historically been janky). (Audit 14 #22.)
  const requestDisable = (factorId) => {
    setDisableFactorId(factorId);
    setDisableOpen(true);
  };

  const confirmDisable = async () => {
    const factorId = disableFactorId;
    setDisableOpen(false);
    setDisableFactorId(null);
    if (!factorId) return;
    const res = await unenroll(factorId);
    if (!res.ok) {
      toast.error(`Couldn't disable: ${res.message || 'try again'}`);
      return;
    }
    toast.success('Two-factor disabled.');
    refresh();
  };

  const enabled = factors.length > 0;

  return (
    <div className="border-t border-border pt-3 mt-1">
      <div className="flex items-center gap-2 mb-2">
        <Shield className="w-3.5 h-3.5 text-muted-foreground" />
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Two-factor auth</h3>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          {loading ? (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Checking…
            </p>
          ) : enabled ? (
            <p className="text-xs text-foreground flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <ShieldCheck className="w-3 h-3 text-emerald-500" />
              On — sign-in requires a code from your authenticator app.
            </p>
          ) : (
            <p className="text-xs text-foreground flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-muted-foreground/50" />
              {/* Not "only your password protects your account", which is what
                  this said and which is false: Flexyn has no password in any
                  layer. signInWithPassword, resetPasswordForEmail and
                  updateUser({ password }) appear nowhere in src/ — the four
                  ways in are a magic link, Google, Apple and guest. Telling
                  someone a credential they do not have is protecting them is
                  worse than saying nothing, because it names the wrong thing
                  to go and secure. */}
              Off — Flexyn has no password; however you sign in is all that protects this account.
            </p>
          )}
        </div>
        {!loading && (enabled ? (
          <button
            onClick={() => requestDisable(factors[0].id)}
            className="px-2.5 py-1 rounded-md border border-border text-micro font-bold uppercase tracking-wide hover:bg-secondary active:bg-secondary"
          >
            Disable
          </button>
        ) : (
          <button
            onClick={startEnroll}
            disabled={enrolling}
            className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-micro font-bold uppercase tracking-wide flex items-center gap-1 disabled:opacity-50"
          >
            {enrolling && <Loader2 className="w-3 h-3 animate-spin" />}
            Enable
          </button>
        ))}
      </div>

      {/* Enrollment modal */}
      <AnimatePresence>
        {modalOpen && enrollment && createPortal(
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setModalOpen(false)}
            className="fixed inset-0 z-[9999] bg-black/55 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-card border border-border rounded-2xl p-5 shadow-xl"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-heading font-bold text-base flex items-center gap-2">
                  <Shield className="w-4 h-4" /> Set up 2FA
                </h3>
                <button onClick={() => setModalOpen(false)} aria-label="Close" className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <ol className="text-xs text-muted-foreground space-y-1 mb-3 list-decimal ps-4">
                <li>Open an authenticator app (Google Authenticator, Authy, 1Password).</li>
                <li>Scan the QR code below — or enter the secret manually.</li>
                <li>Type the 6-digit code the app shows.</li>
              </ol>
              {enrollment.qr && (
                <div className="flex justify-center mb-3">
                  <img loading="lazy" src={enrollment.qr} alt="2FA QR code" className="w-40 h-40 rounded-md bg-white p-2" />
                </div>
              )}
              {enrollment.secret && (
                <div className="mb-3 text-center">
                  <p className="text-micro text-muted-foreground uppercase tracking-wide">Manual key</p>
                  <p className="text-xs font-mono tracking-wide break-all">{enrollment.secret}</p>
                </div>
              )}
              <input
                ref={codeInputRef}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123 456"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="w-full text-center text-2xl tracking-[0.4em] tabular-nums py-2 bg-secondary/40 border border-border rounded-lg outline-none focus:border-primary/50 mb-3"
              />
              <button
                onClick={submitCode}
                disabled={verifying || code.length < 6}
                className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Verify & enable
              </button>
            </motion.div>
          </motion.div>,
          document.body
        )}
      </AnimatePresence>

      {/* Disable confirmation — Radix AlertDialog so it matches the
          rest of Settings' visual language and behaves correctly on
          iOS PWA standalone. (Audit 14 #22.) */}
      <AlertDialog open={disableOpen} onOpenChange={setDisableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off two-factor authentication?</AlertDialogTitle>
            <AlertDialogDescription>
              Your account will be less protected. You can re-enable 2FA at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep on</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDisable} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/90">
              Turn off
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
