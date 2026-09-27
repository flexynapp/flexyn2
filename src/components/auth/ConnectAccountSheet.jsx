// src/components/auth/ConnectAccountSheet.jsx
//
// The flyout a guest sees when they try something only real accounts can do
// (Rival, first). Kegan, 2026-09-27: guests do not compete; they are asked to
// connect an account instead.
//
// Connecting LINKS the guest rather than signing in fresh, so the same user
// id carries on and nothing the guest logged is lost. See accountLink.js.
//
// Provider buttons come from the project's live settings (authProviders.js),
// never a hardcoded list: a button for a provider the project has not
// enabled dead-ends on a raw JSON error page. Email always works.

import React, { useEffect, useState } from 'react';
import { Loader2, Mail, ShieldAlert } from 'lucide-react';
import BottomSheet from '@/components/ui/BottomSheet';
import { useLanguage } from '@/lib/LanguageContext';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/reportError';
import { cachedProviders, fetchEnabledProviders } from '@/lib/authProviders';
import { linkGuestToProvider, linkGuestToEmail, isLinkingDisabled, isIdentityTaken } from '@/lib/data/accountLink';

const PROVIDER_LABEL = { google: 'Google', apple: 'Apple' };

export default function ConnectAccountSheet({ open, onClose, reason, returnPath = '/' }) {
  const { tFallback } = useLanguage();
  const [providers, setProviders] = useState(() => cachedProviders() || []);
  const [busy, setBusy] = useState(null);
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState(null);

  useEffect(() => {
    if (!open) return;
    fetchEnabledProviders().then(setProviders).catch(() => { /* keep the cached list; email still works */ });
  }, [open]);

  useEffect(() => { if (!open) { setSentTo(null); setBusy(null); } }, [open]);

  const failed = (err, feature) => {
    if (isLinkingDisabled(err)) {
      toast.error(tFallback('connectAccount.linkingOff', 'Connecting that way is not switched on yet. Use your email for now.'));
    } else if (isIdentityTaken(err)) {
      toast.error(tFallback('connectAccount.taken', 'That account is already in use on Flexyn. Try a different one.'));
    } else {
      reportError(err, { feature, level: 'warning' });
      toast.error(tFallback('connectAccount.failed', 'Could not connect. Try again.'));
    }
  };

  const onProvider = async (provider) => {
    if (busy) return;
    setBusy(provider);
    try {
      await linkGuestToProvider(provider, returnPath);
      // Web: the page leaves for the provider. Native: the system browser is
      // open and the deep link finishes it, so release the button.
      setBusy(null);
    } catch (err) {
      setBusy(null);
      failed(err, 'account.link-provider');
    }
  };

  const onEmail = async (e) => {
    e?.preventDefault?.();
    const trimmed = email.trim();
    if (busy || !trimmed) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error(tFallback('signIn.invalidEmail', "That doesn't look like a valid email address."));
      return;
    }
    setBusy('email');
    try {
      await linkGuestToEmail(trimmed);
      setSentTo(trimmed);
    } catch (err) {
      failed(err, 'account.link-email');
    } finally {
      setBusy(null);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={tFallback('connectAccount.title', 'Connect an account')}>
      <div className="px-4 pb-6">
        <div className="flex items-start gap-2 mb-6">
          <ShieldAlert className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-bold">
              {reason || tFallback('connectAccount.rivalReason', "Guest accounts can't compete in Rival.")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {tFallback('connectAccount.keepsData', 'Connect an account to join in. Everything you have logged as a guest stays with you.')}
            </p>
          </div>
        </div>

        {sentTo ? (
          <div className="rounded-2xl border border-border p-4 text-center">
            <Mail className="w-6 h-6 text-primary mx-auto mb-2" />
            <p className="text-sm font-bold">{tFallback('connectAccount.checkInbox', 'Check your inbox')}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {tFallback('connectAccount.sentTo', 'Open the link we sent to {email} to finish connecting.', { email: sentTo })}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {providers.map((p) => (
              <button key={p} type="button" onClick={() => onProvider(p)} disabled={!!busy}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl border border-border bg-card text-sm font-bold hover:bg-secondary active:bg-secondary disabled:opacity-50 transition-colors">
                {busy === p && <Loader2 className="w-4 h-4 animate-spin" />}
                {tFallback('connectAccount.continueWith', 'Continue with {provider}', { provider: PROVIDER_LABEL[p] || p })}
              </button>
            ))}

            <form onSubmit={onEmail} className="flex flex-col gap-2 mt-6">
              <label htmlFor="connect-email" className="text-micro font-black uppercase tracking-wider text-muted-foreground">
                {tFallback('connectAccount.orEmail', 'Or use your email')}
              </label>
              <input id="connect-email" type="email" inputMode="email" autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder={tFallback('signIn.emailPlaceholder', 'you@example.com')}
                className="w-full h-12 px-4 rounded-xl border border-border bg-background text-sm" />
              <button type="submit" disabled={!!busy || !email.trim()}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-white text-sm font-black disabled:opacity-50 transition-colors">
                {busy === 'email' && <Loader2 className="w-4 h-4 animate-spin" />}
                {tFallback('connectAccount.sendLink', 'Send me a link')}
              </button>
            </form>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
