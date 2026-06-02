import { useState } from 'react';
import { motion } from 'framer-motion';
import { LOGO_URL } from '@/lib/constants';
import { LogIn, ArrowRight, ArrowLeft, Mail, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { db } from '@/api/db';

// Inline SVG glyphs for the OAuth buttons — keeps us off of brand-asset
// CDN fetches and lets the buttons render before any external request.
function GoogleGlyph(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" fill="#34A853" />
      <path d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.12-1.44.34-2.11V7.05H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.95l3.66-2.84Z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" fill="#EA4335" />
    </svg>
  );
}

function AppleGlyph(props) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path fill="currentColor" d="M16.5 1.5c.1 1.3-.4 2.6-1.2 3.5-.8.9-2.1 1.6-3.4 1.5-.1-1.3.5-2.6 1.3-3.5C14 2.1 15.3 1.4 16.5 1.5Zm4 16.7c-.5 1.2-.8 1.7-1.5 2.7-1 1.5-2.4 3.3-4.1 3.3-1.6 0-2-1-4.1-1-2.1 0-2.6 1-4.1 1-1.8 0-3-1.7-4-3.2C-.6 16.6-.9 9.7 4 8c2-.7 3.7-.4 5 .7 1.6 1.2 2.2 1.2 3.5.3 1.8-1.2 5-1.2 6.7 1.2-5.5 3-3.5 9 1.3 8Z" />
    </svg>
  );
}

export default function SignInToContinue({
  onBack = null,
  heading = 'Sign in to continue',
  subtext = 'Pick up right where you left off — your workouts, streaks, and progress are waiting.',
}) {
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);

  const handleProvider = async (provider, setter) => {
    setter(true);
    try {
      await db.auth.signInWithProvider(provider, '/');
      // OAuth redirects the page; the spinner stays until the redirect.
    } catch (err) {
      setter(false);
      toast.error(`Couldn't start ${provider} sign-in. Try again.`);
    }
  };

  const handleMagicLink = async (e) => {
    e?.preventDefault?.();
    const trimmed = email.trim();
    if (!trimmed || sendingMagicLink) return;
    // Basic email format check so users get an inline error before we
    // round-trip to Supabase Auth and back with an opaque "invalid
    // grant" message. Catches typos like "youexample.com" or "you@"
    // without trying to validate every RFC quirk.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("That doesn't look like a valid email address.");
      return;
    }
    setSendingMagicLink(true);
    try {
      await db.auth.signInWithMagicLink(trimmed, '/');
      setEmailSent(true);
    } catch (err) {
      toast.error(err?.message || 'Could not send magic link. Try again.');
    } finally {
      setSendingMagicLink(false);
    }
  };

  // Reset the "Check your inbox" state so the user can re-send to a
  // corrected email. Previously emailSent=true was terminal — the form
  // disappeared with no way to fix a typo'd address without navigating
  // away and back.
  const handleResetEmail = () => {
    setEmailSent(false);
    setEmail('');
  };

  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-between p-6 pb-10 overflow-y-auto">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="absolute top-5 start-5 z-20 w-9 h-9 rounded-xl border border-border bg-card flex items-center justify-center text-foreground hover:bg-secondary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
      )}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="pt-10 flex flex-col items-center gap-2"
      >
        <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-lg shadow-primary/30">
          <img loading="lazy" src={LOGO_URL} alt="Flexyn" className="w-full h-full object-contain" />
        </div>
        <p className="font-heading text-2xl font-bold tracking-tight">Flexyn</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15, ease: 'easeOut' }}
        className="flex flex-col items-center text-center px-4"
      >
        <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-6">
          <LogIn className="w-10 h-10 text-primary" />
        </div>
        <h2 className="font-heading text-2xl font-bold tracking-tight mb-3">{heading}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
          {subtext}
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3, ease: 'easeOut' }}
        className="w-full max-w-sm space-y-3"
      >
        {/* OAuth providers — Google + Apple */}
        <Button
          variant="outline"
          className="w-full h-12 font-medium text-sm gap-2 bg-white text-gray-900 hover:bg-gray-50 hover:text-gray-900 border-gray-300"
          onClick={() => handleProvider('google', setGoogleLoading)}
          disabled={googleLoading || appleLoading || sendingMagicLink}
        >
          {googleLoading
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <GoogleGlyph className="w-4 h-4" />}
          Continue with Google
        </Button>

        <Button
          className="w-full h-12 font-medium text-sm gap-2 bg-black text-white hover:bg-zinc-900"
          onClick={() => handleProvider('apple', setAppleLoading)}
          disabled={googleLoading || appleLoading || sendingMagicLink}
        >
          {appleLoading
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <AppleGlyph className="w-4 h-4 text-white" />}
          Continue with Apple
        </Button>

        {/* Divider */}
        <div className="flex items-center gap-3 py-1">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Magic link */}
        {emailSent ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 text-sm">
              <Check className="w-4 h-4 shrink-0" />
              <span>Check your inbox — we sent a sign-in link to <strong>{email}</strong>.</span>
            </div>
            <button
              type="button"
              onClick={handleResetEmail}
              className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5"
            >
              Wrong email? Send another link
            </button>
          </div>
        ) : (
          <form onSubmit={handleMagicLink} className="flex flex-col gap-2">
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="h-12"
              required
            />
            <Button
              type="submit"
              variant="outline"
              className="w-full h-12 font-medium text-sm gap-2"
              disabled={!email.trim() || sendingMagicLink || googleLoading || appleLoading}
            >
              {sendingMagicLink
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Mail className="w-4 h-4" />}
              {sendingMagicLink ? 'Sending…' : 'Send magic link'}
              {!sendingMagicLink && <ArrowRight className="w-4 h-4 ms-auto" />}
            </Button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
